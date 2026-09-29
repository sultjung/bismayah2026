import os
import re
import json
import time
from pathlib import Path
from datetime import datetime, timezone

import requests
from openai import OpenAI


X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent"

# 핵심 원칙:
# - 단독 بسما / بسماه / بسماها / بسماي 는 제외
# - 정확한 بسماية / بسمايه 또는 Bismayah/Bismaya 중심
# - 한화/하이더 마키야는 이라크 맥락이 있을 때만 보조적으로 인정
QUERY = (
    '("مدينة بسماية" OR "مدينة بسمايه" OR "شقق بسماية" OR "شقق بسمايه" '
    'OR "مجمع بسماية" OR "شركة كورية" OR "مشروع بسماية" OR "مشروع بسمايه" '
    'OR "شركة هانوا" OR "بسمايه السكني" '
    'OR "Bismayah" OR "Bismaya" OR "Bismayah City" '
    'OR "شركة هانوا" OR "حيدر مكية") '
    '-is:retweet lang:ar'
)

OUT_FILE = Path("data/sns-activities.json")

MAX_RESULTS = int(os.getenv("X_MAX_RESULTS", "25"))
MAX_KEEP_ITEMS = int(os.getenv("SNS_MAX_KEEP_ITEMS", "200"))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
MIN_RELEVANCE = int(os.getenv("SNS_MIN_RELEVANCE", "3"))


BISMAYAH_REGEX = re.compile(
    r"(?<![\u0600-\u06FFA-Za-z])("
    r"بسماي[ةه]"
    r"|مدينة\s+بسماي[ةه]"
    r"|شقق\s+بسماي[ةه]"
    r"|مجمع\s+بسماي[ةه]"
    r"|مشروع\s+بسماي[ةه]"
    r"|Bismayah"
    r"|Bismaya"
    r"|Bismayah\s+City"
    r")(?![\u0600-\u06FFA-Za-z])",
    re.IGNORECASE,
)

HANWHA_OR_PERSON_REGEX = re.compile(
    r"(شركة\s+هانوا|هانوا|Hanwha|حيدر\s+مكية|Haydar\s+Makkiya|Haider\s+Makkiya)",
    re.IGNORECASE,
)

IRAQ_CONTEXT_REGEX = re.compile(
    r"(العراق|عراقي|العراقية|بغداد|Baghdad|Iraq|NIC|الهيئة\s+الوطنية\s+للاستثمار|"
    r"الاستثمار|السكني|سكني|شقق|مجمع|مدينة|مشروع|بسماي[ةه])",
    re.IGNORECASE,
)

FALSE_POSITIVE_REGEX = re.compile(
    r"(بسماها|بسماه|بسماي\s*=|بِسماي|بسما\s|بسما$|SAMAcares|SAMA)",
    re.IGNORECASE,
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value):
    text = str(value or "")
    text = text.replace("&amp;", "&")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def has_bismayah_keyword(text):
    return bool(BISMAYAH_REGEX.search(normalize_text(text)))


def has_hanwha_or_person_with_iraq_context(text, author_location=""):
    combined = normalize_text(f"{text} {author_location}")
    return bool(HANWHA_OR_PERSON_REGEX.search(combined)) and bool(IRAQ_CONTEXT_REGEX.search(combined))


def looks_like_false_positive(text):
    clean = normalize_text(text)

    if has_bismayah_keyword(clean):
        return False

    return bool(FALSE_POSITIVE_REGEX.search(clean))


def is_candidate_text(text, author_location=""):
    clean = normalize_text(text)

    if not clean:
        return False

    if looks_like_false_positive(clean):
        return False

    if has_bismayah_keyword(clean):
        return True

    if has_hanwha_or_person_with_iraq_context(clean, author_location):
        return True

    return False


def load_existing_items():
    if not OUT_FILE.exists():
        return []

    try:
        data = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data.get("items", [])
        if isinstance(data, list):
            return data
    except Exception:
        return []

    return []


def item_passes_final_filter(item):
    text = item.get("original_text", "")
    author = item.get("author") or {}
    author_location = author.get("location") or ""

    if not is_candidate_text(text, author_location):
        return False

    analysis = item.get("analysis") or {}

    try:
        relevance = int(analysis.get("relevance", 0))
    except Exception:
        relevance = 0

    if relevance < MIN_RELEVANCE:
        return False

    if analysis.get("is_bismayah_related") is False:
        return False

    if analysis.get("iraq_related") is False:
        return False

    return True


def save_items(items):
    OUT_FILE.parent.mkdir(exist_ok=True)

    filtered_items = [item for item in items if item_passes_final_filter(item)]

    payload = {
        "updated_at": now_iso(),
        "source": "X Recent Search API",
        "query": QUERY,
        "min_relevance": MIN_RELEVANCE,
        "raw_count": len(items),
        "count": len(filtered_items),
        "items": filtered_items,
    }

    OUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Filtered SNS items: {len(filtered_items)} / raw {len(items)}")


def fetch_x_posts():
    bearer = os.getenv("X_BEARER_TOKEN")

    if not bearer:
        raise RuntimeError("X_BEARER_TOKEN is missing.")

    headers = {
        "Authorization": f"Bearer {bearer}",
        "User-Agent": "bismayah-sns-x-collector/1.0",
    }

    params = {
        "query": QUERY,
        "max_results": str(MAX_RESULTS),
        "sort_order": "recency",
        "tweet.fields": "created_at,author_id,lang,public_metrics,conversation_id,geo",
        "expansions": "author_id,geo.place_id",
        "user.fields": "username,name,verified,location,description,public_metrics",
        "place.fields": "country,country_code,full_name,geo,id,name,place_type",
    }

    max_attempts = 4

    for attempt in range(1, max_attempts + 1):
        response = requests.get(
            X_SEARCH_URL,
            headers=headers,
            params=params,
            timeout=30,
        )

        print(f"X API status: {response.status_code} / attempt {attempt}/{max_attempts}")

        if response.ok:
            data = response.json()

            posts = data.get("data", [])
            users = data.get("includes", {}).get("users", [])
            places = data.get("includes", {}).get("places", [])

            user_map = {user.get("id"): user for user in users}
            place_map = {place.get("id"): place for place in places}

            print(f"Fetched {len(posts)} posts from X.")
            return posts, user_map, place_map

        if response.status_code in (429, 500, 502, 503, 504):
            retry_after = response.headers.get("retry-after")

            if retry_after and retry_after.isdigit():
                wait_seconds = int(retry_after)
            else:
                wait_seconds = min(10 * (2 ** (attempt - 1)), 60)

            print(response.text)
            print(f"Temporary X API error. Waiting {wait_seconds} seconds before retry...")

            if attempt < max_attempts:
                time.sleep(wait_seconds)
                continue

        print(response.text)
        raise RuntimeError(f"X API request failed: {response.status_code}")

    raise RuntimeError("X API request failed after retries.")


def clean_json_text(text):
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def fallback_analysis(text):
    short = normalize_text(text)
    if len(short) > 120:
        short = short[:120] + "..."

    return {
        "title_ko": "비스마야 관련 X 게시글",
        "summary_ko": short,
        "translation_ko": text,
        "sentiment": "unknown",
        "issue_type": "general",
        "importance": 3,
        "relevance": 3,
        "is_bismayah_related": has_bismayah_keyword(text),
        "iraq_related": has_bismayah_keyword(text),
        "keywords_ko": ["비스마야"],
        "reject_reason_ko": "",
        "action_note_ko": "AI 분석 실패로 원문 기준 저장됨",
    }


def has_complete_korean_analysis(analysis):
    required = ("title_ko", "summary_ko", "translation_ko", "action_note_ko")
    values = [str(analysis.get(field) or "").strip() for field in required]
    if not all(values):
        return False
    if any(not re.search(r"[\uac00-\ud7af]", value) for value in values):
        return False
    if any(re.search(r"[\u0600-\u06ff]", value) for value in values):
        return False
    keywords = analysis.get("keywords_ko") or []
    return isinstance(keywords, list) and all(
        not re.search(r"[\u0600-\u06ff]", str(keyword)) for keyword in keywords
    )


def analyze_with_openai(text, metrics, author_location="", place_info=None):
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        print("OPENAI_API_KEY is missing. Saving without AI analysis.")
        return fallback_analysis(text)

    client = OpenAI(api_key=api_key)

    system_prompt = """
You analyze Arabic, Iraqi Arabic dialect, and English social media posts.

Your task is to decide whether a post is truly related to the Bismayah New City Project in Iraq.

VERY IMPORTANT:
- "بسماية" and "بسمايه" can mean Bismayah.
- "مدينة بسماية", "شقق بسماية", "مجمع بسماية", "مشروع بسماية" are strong Bismayah indicators.
- "Bismayah", "Bismaya", and "Bismayah City" are strong Bismayah indicators.
- "بسماها", "بسماه", "بِسماي", "بسماي = في سمائي", "بسما" alone are usually NOT Bismayah.
- "رفعت شكوى بسما" may refer to SAMA, not Bismayah.
- Arabic is used across many countries. Do not assume a post is about Iraq unless the text, user location, place, or context supports Iraq/Bismayah/Baghdad.
- If the post is poetry, romance, religion, Egypt songs, Syria politics, personal insults, or generic Arabic text that only contains بسماها/بسماه/بسماي, mark it unrelated.

Return JSON only. Do not include markdown.

Required JSON keys:
{
  "title_ko": "Korean short title",
  "summary_ko": "Korean summary in 1-2 sentences",
  "translation_ko": "Natural Korean translation of the post",
  "sentiment": "positive | neutral | negative | mixed | unknown",
  "issue_type": "drainage | electricity | water | maintenance | defects | security | transportation | price | occupancy | policy | general | other",
  "importance": 1,
  "relevance": 1,
  "is_bismayah_related": true,
  "iraq_related": true,
  "keywords_ko": ["keyword1", "keyword2"],
  "reject_reason_ko": "If unrelated, explain briefly in Korean. Otherwise empty string.",
  "action_note_ko": "Short Korean note on why this matters"
}

Rules:
- relevance 1: unrelated or only accidental keyword match.
- relevance 2: weak or unclear relation.
- relevance 3: possibly related to Bismayah/Iraq but not strong.
- relevance 4: directly related to Bismayah project/residents/issues.
- relevance 5: highly important direct Bismayah issue.
- If the post does not clearly refer to Bismayah New City in Iraq, set is_bismayah_related=false, iraq_related=false, relevance=1.
- Be strict. It is better to exclude weak posts than to include unrelated Arabic posts.
- Translate Iraqi Arabic naturally, not literally.
- Every Korean output field must contain no Arabic-script characters. This includes title_ko, summary_ko, translation_ko, keywords_ko, reject_reason_ko, and action_note_ko.
- Translate Arabic names and place names into Korean; never copy Arabic words into Korean fields. Always write بسماية/بسمايه as 비스마야.
"""

    user_payload = {
        "post_text": text,
        "public_metrics": metrics,
        "author_location": author_location,
        "place_info": place_info or {},
    }

    last_error = None
    for attempt in range(2):
        request_payload = dict(user_payload)
        if attempt:
            request_payload["correction"] = (
                "Your previous output contained Arabic-script characters in Korean fields. "
                "Rewrite every required Korean field entirely in Korean, including names. "
                "Do not include any Arabic-script characters anywhere in the output."
            )
        try:
            response = client.chat.completions.create(
                model=OPENAI_MODEL,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(request_payload, ensure_ascii=False),
                    },
                ],
            )
            content = response.choices[0].message.content or "{}"
            parsed = json.loads(clean_json_text(content))
            base = fallback_analysis(text)
            base.update(parsed)
            base["importance"] = max(1, min(5, int(base.get("importance", 3))))
            base["relevance"] = max(1, min(5, int(base.get("relevance", 3))))
            if not isinstance(base.get("keywords_ko"), list):
                base["keywords_ko"] = ["비스마야"]
            if not isinstance(base.get("is_bismayah_related"), bool):
                base["is_bismayah_related"] = base["relevance"] >= 3
            if not isinstance(base.get("iraq_related"), bool):
                base["iraq_related"] = base["relevance"] >= 3
            if has_complete_korean_analysis(base):
                base["translation_verified"] = True
                return base
            last_error = ValueError("Arabic text or missing Korean output remained in a Korean field")
            print(f"OpenAI SNS translation failed Korean-only validation; retry={attempt + 1}/2")
        except Exception as error:
            last_error = error
            print(f"OpenAI SNS analysis attempt={attempt + 1}/2 failed: {type(error).__name__}")

    raise RuntimeError("SNS Korean translation failed validation after retry; refusing to save untranslated data") from last_error


def make_post_url(tweet_id, user):
    username = user.get("username") if user else None

    if username:
        return f"https://x.com/{username}/status/{tweet_id}"

    return f"https://x.com/i/web/status/{tweet_id}"


def get_place_for_tweet(tweet, place_map):
    geo = tweet.get("geo") or {}
    place_id = geo.get("place_id")

    if not place_id:
        return {}

    return place_map.get(place_id, {}) or {}


def build_item(tweet, user, place_info):
    tweet_id = tweet.get("id")
    text = tweet.get("text", "")
    metrics = tweet.get("public_metrics", {}) or {}
    author_location = user.get("location") if user else ""

    analysis = analyze_with_openai(
        text=text,
        metrics=metrics,
        author_location=author_location,
        place_info=place_info,
    )

    return {
        "id": f"x-{tweet_id}",
        "platform": "X",
        "source": "X Recent Search",
        "tweet_id": tweet_id,
        "url": make_post_url(tweet_id, user),
        "created_at": tweet.get("created_at"),
        "collected_at": now_iso(),
        "lang": tweet.get("lang"),
        "author": {
            "id": tweet.get("author_id"),
            "name": user.get("name") if user else None,
            "username": user.get("username") if user else None,
            "verified": user.get("verified") if user else None,
            "location": user.get("location") if user else None,
            "description": user.get("description") if user else None,
        },
        "place": place_info,
        "original_text": text,
        "metrics": {
            "likes": metrics.get("like_count", 0),
            "replies": metrics.get("reply_count", 0),
            "reposts": metrics.get("retweet_count", 0),
            "quotes": metrics.get("quote_count", 0),
            "bookmarks": metrics.get("bookmark_count", 0),
            "impressions": metrics.get("impression_count", 0),
        },
        "analysis": analysis,
    }


def main():
    existing_items = load_existing_items()
    existing_by_id = {
        item.get("id"): item
        for item in existing_items
        if item.get("id")
    }

    posts, user_map, place_map = fetch_x_posts()

    new_items = []
    seen_ids = set()

    skipped_before_ai = 0
    skipped_existing = 0

    for tweet in posts:
        tweet_id = tweet.get("id")
        item_id = f"x-{tweet_id}"
        user = user_map.get(tweet.get("author_id")) or {}
        place_info = get_place_for_tweet(tweet, place_map)

        text = tweet.get("text", "")
        author_location = user.get("location") or ""

        if not is_candidate_text(text, author_location):
            skipped_before_ai += 1
            print(f"Skipped before AI: {tweet_id}")
            continue

        if item_id in existing_by_id:
            old_item = existing_by_id[item_id]
            metrics = tweet.get("public_metrics", {}) or {}

            old_item["collected_at"] = now_iso()
            old_item["metrics"] = {
                "likes": metrics.get("like_count", 0),
                "replies": metrics.get("reply_count", 0),
                "reposts": metrics.get("retweet_count", 0),
                "quotes": metrics.get("quote_count", 0),
                "bookmarks": metrics.get("bookmark_count", 0),
                "impressions": metrics.get("impression_count", 0),
            }

            if not has_complete_korean_analysis(old_item.get("analysis") or {}):
                old_item["analysis"] = analyze_with_openai(
                    text=old_item.get("original_text", ""),
                    metrics=metrics,
                    author_location=(old_item.get("author") or {}).get("location") or "",
                    place_info=old_item.get("place") or {},
                )

            if item_passes_final_filter(old_item):
                new_items.append(old_item)
                seen_ids.add(item_id)
            else:
                skipped_existing += 1

            continue

        item = build_item(tweet, user, place_info)

        if item_passes_final_filter(item):
            new_items.append(item)
            seen_ids.add(item_id)
        else:
            print(f"Skipped after AI: {tweet_id}")

        time.sleep(0.4)

    for item in existing_items:
        item_id = item.get("id")

        if not item_id:
            continue

        if item_id in seen_ids:
            continue

        if item_passes_final_filter(item):
            new_items.append(item)
        else:
            skipped_existing += 1

    new_items.sort(
        key=lambda x: x.get("created_at") or "",
        reverse=True,
    )

    new_items = new_items[:MAX_KEEP_ITEMS]

    save_items(new_items)

    print(f"Skipped before AI: {skipped_before_ai}")
    print(f"Skipped existing unrelated items: {skipped_existing}")
    print(f"Saved {len(new_items)} candidate SNS items to {OUT_FILE}")


if __name__ == "__main__":
    main()
