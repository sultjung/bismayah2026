#!/usr/bin/env python3
"""
Bismayah News Monitor - RSS collector + Korean AI translation

v2:
- Google News RSS에서 키워드별 기사 수집
- 기존 data/news.json과 병합
- URL/제목 기준 중복 제거
- OPENAI_API_KEY가 있으면 제목/요약을 한국어로 번역·정리
- OPENAI_API_KEY가 없으면 기존처럼 원문 제목 그대로 표시
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import quote_plus
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "news.json"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
MAX_TRANSLATIONS_PER_RUN = int(os.getenv("MAX_TRANSLATIONS_PER_RUN", "80"))

KEYWORDS = [# 1. Bismayah / BNCP 핵심
    "Bismayah",
    "Bismaya",
    "\"Bismayah New City\"",
    "\"Bismaya New City\"",
    "\"Bismayah project\"",
    "\"Bismaya project\"",
    "\"Bismayah housing\"",
    "\"Bismaya housing\"",
    "\"Bismayah residential city\"",
    "\"Bismayah New City Project\"",
    "\"BNCP\"",

    # 2. Hanwha 관련
    "\"Hanwha Iraq\"",
    "\"Hanwha Bismayah\"",
    "\"Hanwha construction Iraq\"",
    "\"Hanwha Engineering Construction Iraq\"",
    "\"Hanwha E&C Iraq\"",
    "\"Hanwha residential city Iraq\"",
    "\"Hanwha Company\"",

    # 3. NIC / 이라크 정부 관련
    "\"National Investment Commission Iraq\"",
    "\"NIC Iraq\"",
    "\"Iraq National Investment Commission\"",
    "\"Iraqi National Investment Commission\"",
    "\"Iraq investment commission\"",
    "\"Iraq Council of Ministers housing\"",
    "\"Iraq cabinet housing project\"",

    # 4. 이라크 주택/신도시/건설 관련
    "\"Iraq housing project\"",
    "\"Iraq new city\"",
    "\"Iraq residential city\"",
    "\"Baghdad new city\"",
    "\"Iraq housing investment\"",
    "\"Iraq construction project\"",
    "\"Iraq investment project\"",
    "\"Iraq infrastructure project\"",

    # 5. 아랍어 키워드
    "بسماية",
    "\"مدينة بسماية\"",
    "\"مدينة بسماية الجديدة\"",
    "\"مشروع بسماية\"",
    "\"مشروع مدينة بسماية\"",
    "\"الهيئة الوطنية للاستثمار\"",
    "\"هيئة الاستثمار\"",
    "\"مجلس الوزراء العراقي\"",
    "\"مشاريع السكن\"",
    "\"المجمعات السكنية\"",
    "\"المدن الجديدة\"",
    "\"شركة هانوا\"",
    "\"رئيس الهيئة الوطنية للاسمتثمار\"",
    "\"حيدر مكية\"",
    

    # 6. 한국어 키워드
    "\"비스마야\"",
    "\"비스마야 신도시\"",
    "\"이라크 비스마야\"",
    "\"한화 이라크\"",
    "\"한화 비스마야\"",
]

GOOGLE_NEWS_ENDPOINTS = [
    "https://news.google.com/rss/search?q={query}+when:30d&hl=en-US&gl=US&ceid=US:en",
    "https://news.google.com/rss/search?q={query}+when:30d&hl=ar&gl=IQ&ceid=IQ:ar",
]


@dataclass
class Article:
    id: str
    date_found: str
    published_date: str
    source: str
    title_original: str
    title_ko: str
    summary_ko: str
    url: str
    language: str
    country: str
    organization: str
    keywords: list[str]
    importance_score: int
    category: str


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def fetch_url(url: str, timeout: int = 20) -> bytes:
    req = Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 BismayahNewsMonitor/2.0"},
    )
    with urlopen(req, timeout=timeout) as res:
        return res.read()


def post_json(url: str, payload: dict, headers: dict, timeout: int = 90) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            **headers,
        },
        method="POST",
    )
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_date(value: str | None) -> str:
    if not value:
        return now_iso()
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone().isoformat(timespec="seconds")
    except Exception:
        return now_iso()


def has_korean(text: str | None) -> bool:
    return bool(text and re.search(r"[가-힣]", text))


def detect_language(text: str) -> str:
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar"
    if re.search(r"[가-힣]", text):
        return "ko"
    return "en"


def infer_country(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["iraq", "baghdad", "bismayah", "bismaya", "بغداد", "العراق", "بسماية"]):
        return "Iraq"
    if any(x in t for x in ["korea", "seoul", "hanwha", "كوريا"]):
        return "Korea"
    return "Unclassified"


def infer_org(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["hanwha", "هانوا"]):
        return "Hanwha"
    if any(x in t for x in ["national investment commission", " nic ", "الهيئة الوطنية للاستثمار"]):
        return "NIC"
    if any(x in t for x in ["council of ministers", "مجلس الوزراء"]):
        return "Council of Ministers"
    if any(x in t for x in ["bismayah", "bismaya", "بسماية"]):
        return "BNCP"
    return "General"


def infer_category(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["contract", "agreement", "lawsuit", "fidic", "claim", "arbitration", "عقد"]):
        return "계약/법무"
    if any(x in t for x in ["investment", "commission", "cabinet", "minister", "government", "استثمار", "مجلس الوزراء"]):
        return "정부/정책"
    if any(x in t for x in ["housing", "construction", "project", "infrastructure", "city", "مدينة", "مشروع"]):
        return "건설/인프라"
    if any(x in t for x in ["security", "protest", "corruption", "arrest", "فساد", "اعتقال"]):
        return "정치/리스크"
    return "일반"


def extract_source(item: ET.Element) -> str:
    source = item.find("source")
    if source is not None and source.text:
        return clean_text(source.text)

    title = clean_text(item.findtext("title"))
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip()
    return "Google News"


def matched_keywords(text: str) -> list[str]:
    normalized = text.lower()
    hits = []
    raw_keywords = [
        "Bismayah", "Bismaya", "Hanwha", "NIC", "National Investment Commission",
        "Iraq", "Baghdad", "housing", "investment", "construction",
        "بسماية", "مدينة بسماية", "الهيئة الوطنية للاستثمار", "مشروع"
    ]
    for kw in raw_keywords:
        if kw.lower().replace('"', "") in normalized:
            hits.append(kw.replace('"', ""))
    return sorted(set(hits))


def score_importance(text: str, hits: list[str]) -> int:
    t = text.lower()
    score = 35 + len(hits) * 6

    high_signals = [
        "bismayah", "bismaya", "hanwha", "national investment commission",
        "council of ministers", "cabinet", "contract", "agreement",
        "بسماية", "هانوا", "الهيئة الوطنية للاستثمار", "مجلس الوزراء"
    ]

    risk_signals = [
        "arrest", "corruption", "suspension", "termination", "lawsuit",
        "فساد", "اعتقال", "إيقاف", "إنهاء"
    ]

    for word in high_signals:
        if word in t:
            score += 7
    for word in risk_signals:
        if word in t:
            score += 8

    return max(1, min(100, score))


def make_id(title: str, url: str) -> str:
    raw = f"{title}|{url}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def make_summary(title: str, desc: str) -> str:
    if desc and desc.lower() != title.lower():
        return desc[:350]
    return f"자동 수집된 기사입니다. 제목과 원문 링크를 기준으로 비스마야/Bismayah 관련성을 확인하세요: {title}"[:350]


def parse_rss(xml_bytes: bytes) -> list[Article]:
    root = ET.fromstring(xml_bytes)
    items = root.findall(".//item")
    articles: list[Article] = []

    for item in items:
        title = clean_text(item.findtext("title"))
        link = clean_text(item.findtext("link"))
        desc = clean_text(item.findtext("description"))
        published = parse_date(item.findtext("pubDate"))
        source = extract_source(item)

        if not title or not link:
            continue

        text = f"{title} {desc} {source}"
        hits = matched_keywords(text)
        lang = detect_language(text)

        article = Article(
            id=make_id(title, link),
            date_found=now_iso(),
            published_date=published,
            source=source,
            title_original=title,
            title_ko=title,
            summary_ko=make_summary(title, desc),
            url=link,
            language=lang,
            country=infer_country(text),
            organization=infer_org(f" {text} "),
            keywords=hits,
            importance_score=score_importance(text, hits),
            category=infer_category(text),
        )
        articles.append(article)

    return articles


def load_existing() -> list[dict]:
    if not DATA_PATH.exists():
        return []
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        return data.get("articles", [])
    except Exception:
        return []


def dedupe(articles: Iterable[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []

    def key(a: dict) -> str:
        url = (a.get("url") or "").strip().lower()
        title = re.sub(r"\s+", " ", (a.get("title_original") or a.get("title_ko") or "").strip().lower())
        return url or title

    for article in articles:
        k = key(article)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(article)

    out.sort(key=lambda a: (a.get("published_date") or a.get("date_found") or ""), reverse=True)
    return out[:1000]


def chunks(items: list[dict], size: int) -> Iterable[list[dict]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def needs_korean(article: dict) -> bool:
    title_ko = article.get("title_ko") or ""
    summary_ko = article.get("summary_ko") or ""
    title_original = article.get("title_original") or ""
    if not title_original:
        return False
    if title_ko.strip() == title_original.strip():
        return True
    if not has_korean(title_ko):
        return True
    if summary_ko and not has_korean(summary_ko):
        return True
    return False


def translate_articles_with_openai(articles: list[dict]) -> list[dict]:
    if not OPENAI_API_KEY:
        print("OPENAI_API_KEY is not set. Skipping Korean translation.")
        return articles

    targets = [a for a in articles if needs_korean(a)]
    targets = targets[:MAX_TRANSLATIONS_PER_RUN]

    if not targets:
        print("No articles require Korean translation.")
        return articles

    print(f"Translating {len(targets)} articles with OpenAI model: {OPENAI_MODEL}")

    by_id = {a["id"]: a for a in articles if a.get("id")}

    system_prompt = (
        "You are a Korean business intelligence analyst for an Iraq construction project. "
        "Translate and rewrite news titles and short descriptions into clear Korean. "
        "Do not exaggerate. Preserve proper nouns such as Bismayah, Hanwha, NIC, Iraq, Baghdad. "
        "Return only valid JSON."
    )

    for batch in chunks(targets, 20):
        input_items = []
        for a in batch:
            input_items.append({
                "id": a.get("id"),
                "source": a.get("source"),
                "published_date": a.get("published_date"),
                "title_original": a.get("title_original"),
                "summary_source": a.get("summary_ko"),
                "url": a.get("url"),
                "language": a.get("language"),
                "current_country": a.get("country"),
                "current_organization": a.get("organization"),
                "current_keywords": a.get("keywords"),
            })

        user_prompt = {
            "task": "For each article, produce Korean dashboard fields.",
            "rules": [
                "title_ko must be natural Korean, not a literal machine translation.",
                "summary_ko must be 1-2 Korean sentences, concise and useful for a Korean construction company employee.",
                "If relevance to Bismayah/Hanwha/NIC/Iraq construction is weak, say that briefly in summary_ko.",
                "importance_score must be 1-100. 90+ means direct Bismayah/Hanwha/NIC contract or government decision. 70+ means Iraq housing/construction/investment issue. Lower if indirect.",
                "category must be one of: 정부/정책, 건설/인프라, 계약/법무, 정치/리스크, 금융/경제, 일반.",
                "organization should be one of: BNCP, Hanwha, NIC, Council of Ministers, Iraq Government, General, or another short label.",
                "country should be Iraq, Korea, or Unclassified.",
                "keywords should be 3-8 concise strings."
            ],
            "return_format": {
                "items": [
                    {
                        "id": "same id",
                        "title_ko": "Korean title",
                        "summary_ko": "Korean summary",
                        "country": "Iraq",
                        "organization": "BNCP",
                        "keywords": ["Bismayah", "Iraq"],
                        "importance_score": 70,
                        "category": "건설/인프라"
                    }
                ]
            },
            "articles": input_items,
        }

        payload = {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
        }

        try:
            response = post_json(
                "https://api.openai.com/v1/chat/completions",
                payload,
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            )
            content = response["choices"][0]["message"]["content"]
            data = json.loads(content)
            items = data.get("items", [])

            for item in items:
                article_id = item.get("id")
                if not article_id or article_id not in by_id:
                    continue

                article = by_id[article_id]
                for field in ["title_ko", "summary_ko", "country", "organization", "category"]:
                    if item.get(field):
                        article[field] = item[field]

                if isinstance(item.get("keywords"), list):
                    article["keywords"] = [str(x) for x in item["keywords"][:8]]

                if item.get("importance_score") is not None:
                    try:
                        article["importance_score"] = max(1, min(100, int(item["importance_score"])))
                    except Exception:
                        pass

            time.sleep(0.8)

        except Exception as exc:
            print(f"WARNING: translation batch failed: {exc}", file=sys.stderr)

    return articles


def main() -> int:
    existing = load_existing()
    collected: list[Article] = []

    for keyword in KEYWORDS:
        for endpoint in GOOGLE_NEWS_ENDPOINTS:
            url = endpoint.format(query=quote_plus(keyword))
            try:
                print(f"Fetching: {keyword}")
                xml = fetch_url(url)
                collected.extend(parse_rss(xml))
                time.sleep(0.8)
            except Exception as exc:
                print(f"WARNING: failed to fetch {keyword}: {exc}", file=sys.stderr)

    collected_dicts = [asdict(a) for a in collected]

    existing = [a for a in existing if not str(a.get("id", "")).startswith("demo-")]

    merged = dedupe(collected_dicts + existing)
    merged = translate_articles_with_openai(merged)

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(
        json.dumps(
            {
                "last_updated": now_iso(),
                "articles": merged,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Saved {len(merged)} articles to {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
