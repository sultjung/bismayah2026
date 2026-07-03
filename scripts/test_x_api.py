import os
import json
from pathlib import Path

import requests


X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent"

QUERY = (
    '("مدينة بسماية" OR بسماية OR Bismayah OR Bismaya OR "Bismayah City" OR "شقق بسماية") '
    "-is:retweet"
)

OUT_FILE = Path("data/x-api-test.json")


def main():
    bearer = os.getenv("X_BEARER_TOKEN")

    if not bearer:
        raise RuntimeError("X_BEARER_TOKEN is missing. Add it to GitHub Actions Secrets.")

    headers = {
        "Authorization": f"Bearer {bearer}",
        "User-Agent": "bismayah-x-api-test/1.0",
    }

    params = {
        "query": QUERY,
        "max_results": "10",
        "sort_order": "recency",
        "tweet.fields": "created_at,author_id,lang,public_metrics,conversation_id",
        "expansions": "author_id",
        "user.fields": "username,name,verified",
    }

    response = requests.get(
        X_SEARCH_URL,
        headers=headers,
        params=params,
        timeout=30,
    )

    print("Status code:", response.status_code)

    if not response.ok:
        print(response.text)
        raise RuntimeError(f"X API request failed: {response.status_code}")

    data = response.json()

    OUT_FILE.parent.mkdir(exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    tweets = data.get("data", [])
    print(f"Saved {len(tweets)} posts to {OUT_FILE}")

    for t in tweets[:3]:
        print("-" * 60)
        print("ID:", t.get("id"))
        print("Date:", t.get("created_at"))
        print("Text:", t.get("text", "")[:200])
        print("Metrics:", t.get("public_metrics", {}))


if __name__ == "__main__":
    main()
