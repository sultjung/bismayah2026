#!/usr/bin/env python3
"""
Bismayah News Monitor - RSS collector

1차 MVP:
- Google News RSS에서 키워드별 기사 수집
- 기존 data/news.json과 병합
- URL/제목 기준 중복 제거
- 중요도, 국가, 기관, 카테고리 간단 분류
- 별도 API 키 없이 동작

주의:
Google News RSS는 편리하지만 완전한 원문 DB는 아닙니다.
업무상 중요한 판단은 원문과 공식 출처로 재확인해야 합니다.
"""

from __future__ import annotations

import hashlib
import html
import json
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

KEYWORDS = [
    "Bismayah",
    "Bismaya",
    "\"Bismayah New City\"",
    "\"Bismaya New City\"",
    "\"Hanwha Iraq\"",
    "\"Hanwha Bismayah\"",
    "\"National Investment Commission Iraq\"",
    "\"NIC Iraq\"",
    "\"Iraq housing project\"",
    "\"Iraq new city\"",
    "بسماية",
    "\"مدينة بسماية\"",
    "\"مشروع بسماية\"",
    "\"الهيئة الوطنية للاستثمار\"",
]

# 너무 오래된 데이터가 계속 들어오는 것을 막기 위해 최근 30일 검색을 기본값으로 둡니다.
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
        headers={
            "User-Agent": "Mozilla/5.0 BismayahNewsMonitor/1.0"
        },
    )
    with urlopen(req, timeout=timeout) as res:
        return res.read()


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
    # Google News RSS title format often: "Title - Source"
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
        return desc[:280]
    return f"자동 수집된 기사입니다. 제목과 원문 링크를 기준으로 비스마야/Bismayah 관련성을 확인하세요: {title}"[:280]


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
            # 1차 MVP에서는 번역 API를 쓰지 않으므로 원제목을 그대로 보여줍니다.
            # 다음 단계에서 OpenAI API를 붙이면 title_ko를 실제 한국어로 바꿀 수 있습니다.
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

    # 데모 데이터는 실제 수집이 시작되면 제거합니다.
    existing = [a for a in existing if not str(a.get("id", "")).startswith("demo-")]

    merged = dedupe(collected_dicts + existing)

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
