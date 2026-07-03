import os
import re
import json
import time
from pathlib import Path
from datetime import datetime, timezone

import requests
from openai import OpenAI


X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent"

QUERY = (
    '("مدينة بسماية" OR "شركة هانوا" OR "مجمع بسماية" OR "مشروع بسماية" '
    'OR "حيدر مكية" OR "Bismayah" OR "Bismaya" OR "Bismayah City") '
    '-is:retweet lang:ar'
)

OUT_FILE = Path("data/sns-activities.json")

MAX_RESULTS = int(os.getenv("X_MAX_RESULTS", "25"))
MAX_KEEP_ITEMS = int(os.getenv("SNS_MAX_KEEP_ITEMS", "200"))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


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


def save_items(items):
    OUT_FILE.parent.mkdir(exist_ok=True)

    payload = {
        "updated_at": now_iso(),
        "source": "X Recent Search API",
        "query": QUERY,
        "count": len(items),
        "items": items,
    }

    OUT_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


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
        "tweet.fields": "created_at,author_id,lang,public_metrics,conversation_id",
        "expansions": "author_id",
        "user.fields": "username,name,verified,public_metrics",
    }

    response = requests.get(
        X_SEARCH_URL,
        headers=headers,
        params=params,
        timeout=30,
    )

    print("X API status:", response.status_code)

    if not response.ok:
        print(response.text)
        raise RuntimeError(f"X API request failed: {response.status_code}")

    data = response.json()

    posts = data.get("data", [])
    users = data.get("includes", {}).get("users", [])
    user_map = {user.get("id"): user for user in users}

    print(f"Fetched {len(posts)} posts from X.")
    return posts, user_map


def clean_json_text(text):
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def fallback_analysis(text):
    short = text.replace("\n", " ").strip()
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
        "keywords_ko": ["비스마야"],
        "action_note_ko": "AI 분석 실패로 원문 기준 저장됨",
    }


def analyze_with_openai(text, metrics):
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        print("OPENAI_API_KEY is missing. Saving without AI analysis.")
        return fallback_analysis(text)

    client = OpenAI(api_key=api_key)

    system_prompt = """
You analyze Arabic, Iraqi Arabic dialect, and English social media posts about the Bismayah New City Project in Iraq.

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
  "keywords_ko": ["keyword1", "keyword2"],
  "action_note_ko": "Short Korean note on why this matters"
}

Rules:
- importance: 1 low, 5 very important.
- relevance: 1 weakly related to Bismayah, 5 directly related.
- If the post is unrelated or unclear, set relevance low.
- Translate Iraqi Arabic naturally, not literally.
"""

    user_payload = {
        "post_text": text,
        "public_metrics": metrics,
    }

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": json.dumps(user_payload, ensure_ascii=False),
                },
            ],
        )

        content = response.choices[0].message.content or "{}"
        parsed = json.loads(clean_json_text(content))

        base = fallback_analysis(text)
        base.update(parsed)

        base["importance"] = int(base.get("importance", 3))
        base["relevance"] = int(base.get("relevance", 3))

        base["importance"] = max(1, min(5, base["importance"]))
        base["relevance"] = max(1, min(5, base["relevance"]))

        if not isinstance(base.get("keywords_ko"), list):
            base["keywords_ko"] = ["비스마야"]

        return base

    except Exception as e:
        print("OpenAI analysis failed:", str(e))
        return fallback_analysis(text)


def make_post_url(tweet_id, user):
    username = user.get("username") if user else None
    if username:
        return f"https://x.com/{username}/status/{tweet_id}"
    return f"https://x.com/i/web/status/{tweet_id}"


def build_item(tweet, user):
    tweet_id = tweet.get("id")
    text = tweet.get("text", "")
    metrics = tweet.get("public_metrics", {}) or {}

    analysis = analyze_with_openai(text, metrics)

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
        },
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

    posts, user_map = fetch_x_posts()

    new_items = []
    seen_ids = set()

    for tweet in posts:
        tweet_id = tweet.get("id")
        item_id = f"x-{tweet_id}"
        user = user_map.get(tweet.get("author_id"))

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

            new_items.append(old_item)
            seen_ids.add(item_id)
            continue

        item = build_item(tweet, user)
        new_items.append(item)
        seen_ids.add(item_id)

        time.sleep(0.4)

    for item in existing_items:
        item_id = item.get("id")
        if item_id and item_id not in seen_ids:
            new_items.append(item)

    new_items.sort(
        key=lambda x: x.get("created_at") or "",
        reverse=True,
    )

    new_items = new_items[:MAX_KEEP_ITEMS]

    save_items(new_items)

    print(f"Saved {len(new_items)} total SNS items to {OUT_FILE}")


if __name__ == "__main__":
    main()
