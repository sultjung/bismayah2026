import os
import re
import json
import time
import html
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
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
    '("بسماية" OR "بسمايه" OR "بسمایة" OR "Bismayah" OR "Bismaya" '
    'OR "Basmaya" OR "شركة هانوا") -is:retweet'
)
COLLECTION_STATUS = {}
LAST_DATA_UPDATE = None


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
    r"|Basmaya"
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
    text = html.unescape(text)
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", text)
    text = text.replace("ی", "ي").replace("ى", "ي")
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
        "updated_at": now_iso() if COLLECTION_STATUS.get("new_posts") else LAST_DATA_UPDATE,
        "last_checked_at": now_iso(),
        "source": "X Recent Search API + public indexed X posts",
        "query": QUERY,
        "min_relevance": MIN_RELEVANCE,
        "raw_count": len(items),
        "count": len(filtered_items),
        "items": filtered_items,
        "collection_status": COLLECTION_STATUS,
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


def fetch_indexed_x_posts():
    """Public search fallback; only actual status URLs, never search-page links.

    Snippets are explicitly labelled and translated as excerpts. Search engine
    timestamps are not post dates: X's status ID provides the creation time.
    """
    posts = {}
    successes = 0
    for domain in ("x.com", "twitter.com"):
        for keyword in ('"بسماية"', '"بسمايه"', '"Bismayah"', '"Bismaya"'):
            try:
                response = requests.get(
                    "https://www.bing.com/search",
                    params={"q": f"site:{domain} {keyword}", "format": "rss", "count": "30"},
                    headers={"User-Agent": "Mozilla/5.0 Bismayah SNS Monitor"}, timeout=25,
                )
                response.raise_for_status()
                root = ET.fromstring(response.content)
                successes += 1
                for node in root.findall(".//item"):
                    link = node.findtext("link", "").strip()
                    parsed = urlparse(link)
                    match = re.fullmatch(r"/([A-Za-z0-9_]+)/status/(\d+)(?:/.*)?", parsed.path)
                    if parsed.hostname not in ("x.com", "www.x.com", "twitter.com", "www.twitter.com") or not match:
                        continue
                    username, tweet_id = match.groups()
                    excerpt = normalize_text(re.sub(r"<[^>]+>", " ",
                        node.findtext("title", "") + " " + node.findtext("description", "")))
                    if not has_bismayah_keyword(excerpt):
                        continue
                    timestamp = ((int(tweet_id) >> 22) + 1288834974657) / 1000
                    created = datetime.fromtimestamp(timestamp, timezone.utc)
                    if created > datetime.now(timezone.utc) or (datetime.now(timezone.utc) - created).days > 60:
                        continue
                    posts[tweet_id] = {
                        "id": tweet_id, "text": excerpt, "created_at": created.isoformat(),
                        "author_id": username, "_username": username,
                        "_source": "public-search-excerpt",
                        "_url": f"https://x.com/{username}/status/{tweet_id}",
                    }
            except (requests.RequestException, ET.ParseError, ValueError, OverflowError) as error:
                print(f"Public SNS search failed: {domain}, {type(error).__name__}")
    COLLECTION_STATUS["public_search"] = {"successful_queries": successes, "found": len(posts)}
    users = {post["author_id"]: {"username": post["_username"]} for post in posts.values()}
    return list(posts.values()), users, {}


def collect_posts():
    try:
        result = fetch_x_posts()
        COLLECTION_STATUS["x_api"] = {"ok": True}
        return result
    except (RuntimeError, requests.RequestException) as error:
        # No token, depleted credits (402), or an API outage must not disable
        # the independent public search route or erase the verified archive.
        message = str(error)
        COLLECTION_STATUS["x_api"] = {"ok": False, "error": message}
        print(f"X API unavailable; trying public indexed posts: {message}")
        return fetch_indexed_x_posts()


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


def has_arabic_script(value):
    return bool(re.search(r"[\u0600-\u06ff]", str(value or "")))


def has_complete_korean_analysis(analysis):
    required = ("title_ko", "summary_ko", "translation_ko", "action_note_ko")
    values = [str(analysis.get(field) or "").strip() for field in required]
    if not all(values):
        return False
    if any(not re.search(r"[\uac00-\ud7af]", value) for value in values):
        return False
    if any(has_arabic_script(value) for value in values):
        return False
    keywords = analysis.get("keywords_ko") or []
    if not isinstance(keywords, list) or any(has_arabic_script(keyword) for keyword in keywords):
        return False
    return not has_arabic_script(analysis.get("reject_reason_ko", ""))


def analysis_is_grounded(analysis, original_text):
    korean_fields = ("title_ko", "summary_ko", "translation_ko", "action_note_ko", "reject_reason_ko")
    output = " ".join(str(analysis.get(field) or "") for field in korean_fields)
    source = str(original_text or "")
    # A country must not be invented from the generic Arabic term for an
    # investment authority. Apply this to cached analyses as well as new ones.
    if "이스라엘" in output and not re.search(r"إسرائيل|اسرائيل|إسرائي[لي]|اسرائي[لي]|israel|israeli", source, re.IGNORECASE):
        return False
    return True

def analyze_with_openai(text, metrics, author_location="", place_info=None):
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        print("OPENAI_API_KEY is missing. Saving without AI analysis.")
        return fallback_analysis(text)

    client = OpenAI(api_key=api_key)

    system_prompt = """
You analyze Arabic, Iraqi Arabic dialect, and English social media posts.

Input may be a public search excerpt, not a complete post. Only translate visible text; never infer missing content.\nYour task is to decide whether a post is truly related to the Bismayah New City Project in Iraq.

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
- In this Iraqi Bismayah context, هيئة الاستثمار and الهيئة الوطنية للاستثمار refer to 이라크 국가투자위원회 (NIC), never 이스라엘 투자청. Do not introduce a country or institution absent from the post.
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
                "Your previous output failed Korean-only or source-grounding validation. "
                "Rewrite every Korean field from the original post only. "
                "هيئة الاستثمار is the Iraqi investment authority, not Israel. "
                "Do not add Israel unless the source explicitly says Israel."
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
            if has_complete_korean_analysis(base) and analysis_is_grounded(base, text):
                base["translation_verified"] = True
                return base
            last_error = ValueError("Korean-only or source-grounding validation failed")
            print(f"OpenAI SNS translation failed validation; retry={attempt + 1}/2")
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
    global LAST_DATA_UPDATE
    if OUT_FILE.exists():
        previous = json.loads(OUT_FILE.read_text(encoding="utf-8"))
        LAST_DATA_UPDATE = previous.get("updated_at") if isinstance(previous, dict) else None
    existing_items = load_existing_items()
    existing_by_id = {item.get("id"): item for item in existing_items if item.get("id")}

    posts, user_map, place_map = collect_posts()
    candidates = []
    seen_ids = set()
    skipped_before_ai = 0

    # Always process the newest search results, updating stale translations where available.
    for tweet in posts:
        tweet_id = tweet.get("id")
        item_id = f"x-{tweet_id}"
        user = user_map.get(tweet.get("author_id")) or {}
        place_info = get_place_for_tweet(tweet, place_map)
        text = tweet.get("text", "")
        author_location = user.get("location") or ""
        if not is_candidate_text(text, author_location):
            skipped_before_ai += 1
            continue

        metrics = tweet.get("public_metrics", {}) or {}
        old_item = existing_by_id.get(item_id)
        if old_item:
            old_item["collected_at"] = now_iso()
            old_item["metrics"] = {
                "likes": metrics.get("like_count", 0), "replies": metrics.get("reply_count", 0),
                "reposts": metrics.get("retweet_count", 0), "quotes": metrics.get("quote_count", 0),
                "bookmarks": metrics.get("bookmark_count", 0), "impressions": metrics.get("impression_count", 0),
            }
            item = old_item
            if not has_complete_korean_analysis(item.get("analysis") or {}) or not analysis_is_grounded(item.get("analysis") or {}, item.get("original_text", text)):
                item["analysis"] = analyze_with_openai(
                    text=item.get("original_text", text), metrics=metrics,
                    author_location=(item.get("author") or {}).get("location") or author_location,
                    place_info=item.get("place") or place_info,
                )
        else:
            try:
                item = build_item(tweet, user, place_info)
            except Exception as error:
                print(f"Skipping failed SNS translation {tweet_id}: {type(error).__name__}")
                continue
            if tweet.get("_source"):
                item["source"] = "Public search excerpt (X)"
                item["collection_method"] = tweet["_source"]
                item["content_scope"] = "search_excerpt"
                item["url"] = tweet["_url"]
        seen_ids.add(item_id)
        if has_complete_korean_analysis(item.get("analysis") or {}) and analysis_is_grounded(item.get("analysis") or {}, item.get("original_text", text)) and item_passes_final_filter(item):
            candidates.append(item)
        else:
            print(f"Skipped untranslated or irrelevant item: {tweet_id}")
        time.sleep(0.4)

    # The Recent Search API only exposes a short window. Preserve verified older items;
    # omit old untranslated records instead of continuing to publish Arabic as Korean.
    for item in existing_items:
        item_id = item.get("id")
        if not item_id or item_id in seen_ids:
            continue
        if has_complete_korean_analysis(item.get("analysis") or {}) and analysis_is_grounded(item.get("analysis") or {}, item.get("original_text", "")) and item_passes_final_filter(item):
            candidates.append(item)

    candidates.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    COLLECTION_STATUS["returned_posts"] = len(posts)
    COLLECTION_STATUS["new_posts"] = sum(1 for item in candidates if item.get("id") not in existing_by_id)
    save_items(candidates[:MAX_KEEP_ITEMS])
    print(f"Skipped before AI: {skipped_before_ai}")
    print(f"Saved {min(len(candidates), MAX_KEEP_ITEMS)} candidate SNS items to {OUT_FILE}")


if __name__ == "__main__":
    main()

