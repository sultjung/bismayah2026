#!/usr/bin/env python3
"""
Bismayah News Monitor - expanded Iraq media collector + Korean AI translation

v4:
- Google News RSS keyword search 유지
- Google News RSS site:source 검색 추가
- 이라크/쿠르드/중동 주요 언론사 직접 RSS 추가
- RSS 페이지가 XML이 아니라 HTML 안내페이지인 경우, 그 안의 RSS 링크를 자동 발견
- RSS가 없는 사이트는 최신뉴스 HTML 페이지에서 기사 링크를 보조 추출
- 기사 제목/요약 기준 relevance filter 적용
- OpenAI API가 있으면 한국어 제목/요약 생성
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
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "news.json"

OPENAI_API_KEY = re.sub(r"\s+", "", os.getenv("OPENAI_API_KEY", ""))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

# 신규 API 계정은 낮게 시작하세요. 성공하면 5 → 10 → 20 순으로 올리면 됩니다.
MAX_TRANSLATIONS_PER_RUN = int(os.getenv("MAX_TRANSLATIONS_PER_RUN", "5"))
TRANSLATION_BATCH_SIZE = int(os.getenv("TRANSLATION_BATCH_SIZE", "3"))
OPENAI_SLEEP_SECONDS = float(os.getenv("OPENAI_SLEEP_SECONDS", "8"))

# 최근 며칠치 기사를 수집할지. GitHub Actions가 매일 돌면 7일이면 충분합니다.
FETCH_DAYS = int(os.getenv("FETCH_DAYS", "7"))

# 사이트가 너무 느리거나 RSS가 큰 경우를 막기 위한 제한
MAX_ITEMS_PER_FEED = int(os.getenv("MAX_ITEMS_PER_FEED", "40"))
MAX_HTML_LINKS_PER_PAGE = int(os.getenv("MAX_HTML_LINKS_PER_PAGE", "30"))

# True면 우리 사업/이라크 정책/건설/투자 키워드에 걸린 기사만 저장합니다.
STRICT_RELEVANCE = os.getenv("STRICT_RELEVANCE", "true").lower() != "false"


# ---------------------------------------------------------------------
# 1) 검색 키워드
# ---------------------------------------------------------------------

KEYWORDS = [
    # Bismayah / BNCP
    "Bismayah",
    "Bismaya",
    "\"Bismayah New City\"",
    "\"Bismaya New City\"",
    "\"Bismayah New City Project\"",
    "\"Bismayah project\"",
    "\"Bismayah housing\"",
    "\"BNCP\"",

    # Hanwha
    "\"Hanwha Iraq\"",
    "\"Hanwha Bismayah\"",
    "\"Hanwha construction Iraq\"",
    "\"Hanwha Engineering Construction Iraq\"",
    "\"Hanwha E&C Iraq\"",

    # NIC / Government
    "\"National Investment Commission Iraq\"",
    "\"NIC Iraq\"",
    "\"Iraq National Investment Commission\"",
    "\"Iraqi National Investment Commission\"",
    "\"Iraq Council of Ministers housing\"",
    "\"Iraq cabinet housing project\"",

    # Iraq construction / investment
    "\"Iraq housing project\"",
    "\"Iraq new city\"",
    "\"Iraq residential city\"",
    "\"Baghdad new city\"",
    "\"Iraq housing investment\"",
    "\"Iraq construction project\"",
    "\"Iraq investment project\"",

    # Arabic
    "بسماية",
    "\"مدينة بسماية\"",
    "\"مدينة بسماية الجديدة\"",
    "\"مشروع بسماية\"",
    "\"الهيئة الوطنية للاستثمار\"",
    "\"مجلس الوزراء العراقي\"",
    "\"مشاريع السكن\"",
    "\"المدن الجديدة\"",
    "\"مشاريع الاستثمار\"",
    "\"المشاريع الاستثمارية\"",

    # Korean
    "\"비스마야\"",
    "\"비스마야 신도시\"",
    "\"이라크 비스마야\"",
    "\"한화 이라크\"",
    "\"한화 비스마야\"",
]

# 사이트별 Google News 보조 검색은 너무 많이 돌리면 느려지므로 핵심 키워드만 사용합니다.
SITE_SEARCH_KEYWORDS = [
    "Bismayah",
    "Bismaya",
    "\"Hanwha Iraq\"",
    "\"National Investment Commission Iraq\"",
    "\"Iraq housing project\"",
    "بسماية",
    "\"الهيئة الوطنية للاستثمار\"",
    "\"مشاريع السكن\"",
]

# Direct RSS/HTML에서 가져온 기사 중 저장할지 판단하는 relevance 키워드입니다.
# "Iraq" 단독은 너무 넓어서 일부러 제외했습니다.
RELEVANCE_KEYWORDS = [
    "bismayah", "bismaya", "bncp",
    "hanwha",
    "national investment commission", " nic ", "iraq investment commission",
    "council of ministers", "cabinet",
    "housing project", "housing investment", "residential city", "new city",
    "construction project", "investment project", "infrastructure project",
    "baghdad new city",
    "corruption crackdown", "anti-corruption", "arrest", "detained", "lawmakers", "parliament", "mp",
    "contract", "agreement", "suspension", "termination",

    "بسماية", "مدينة بسماية", "مشروع بسماية",
    "هانوا",
    "الهيئة الوطنية للاستثمار", "هيئة الاستثمار",
    "مجلس الوزراء", "مجلس الوزراء العراقي",
    "مشاريع السكن", "المجمعات السكنية", "المدن الجديدة",
    "مشاريع الاستثمار", "المشاريع الاستثمارية",
    "مشروع استثماري", "الإعمار", "البنى التحتية",
    "مكافحة الفساد", "اعتقال", "نواب", "البرلمان", "عقد", "اتفاق",

    "비스마야", "한화", "이라크 신도시", "이라크 주택", "이라크 투자", "이라크 국회",
]

# 전혀 무관한 기사 유입 방지용 블랙리스트입니다.
# Google News가 간혹 검색어와 무관한 자동차/스포츠/연예 기사를 섞어 넣거나,
# 이전 실행에서 저장된 무관 기사가 news.json에 남아 있을 수 있어서 최종 정리 단계에서 제거합니다.
EXCLUDED_SOURCE_NAMES = [
    "team-bhp",
    "carwale",
    "autocar",
    "zigwheels",
    "motorbeam",
    "rushlane",
    "cricbuzz",
    "espncricinfo",
    "bollywood",
]

EXCLUDED_TEXT_PATTERNS = [
    "kiger", "baleno", "which car", "car cools", "ac test", "indian summers",
    "renault", "maruti", "suzuki", "hyundai", "mahindra", "toyota", "honda",
    "bike", "motorcycle", "scooter", "cricket", "ipl", "football transfer",
    "movie review", "bollywood", "celebrity", "box office",
]



# ---------------------------------------------------------------------
# 2) 수집 소스
# ---------------------------------------------------------------------

GOOGLE_NEWS_ENDPOINTS = [
    # 글로벌/영문
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=en-US&gl=US&ceid=US:en",

    # 이라크/아랍어
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=ar&gl=IQ&ceid=IQ:ar",

    # 한국/한국어
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=ko&gl=KR&ceid=KR:ko",

    # 중동 영문권
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=en-AE&gl=AE&ceid=AE:en",
]

# RSS XML을 직접 제공하거나 feed URL 가능성이 높은 소스들
DIRECT_RSS_FEEDS = [
    {"source_name": "Iraqi News Agency", "url": "https://ina.iq/rss_feed.xml", "language": "en", "source_country": "Iraq"},
    {"source_name": "Iraq Business News", "url": "https://www.iraq-businessnews.com/feed", "language": "en", "source_country": "Iraq"},
    {"source_name": "Noon News Agency", "url": "https://non14.net/services/rss", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Kitabat", "url": "https://kitabat.com/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Iraq News Network", "url": "https://aliraqnews.com/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Mangish Net", "url": "https://mangish.net/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Xebat", "url": "https://xebat.net/ku/?feed=rss2", "language": "ku", "source_country": "Iraq"},
    {"source_name": "Voice of Iraq", "url": "https://sotaliraq.com/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Azzaman", "url": "https://www.azzaman.com/feed/", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Almasalah", "url": "https://almasalah.com/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Al-Mada", "url": "https://almadapaper.net/feed", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml", "language": "en", "source_country": "Qatar"},
]

# RSS 안내 페이지. XML이 아니라 HTML인 경우 내부 RSS 링크를 발견해서 가져옵니다.
RSS_INDEX_PAGES = [
    {"source_name": "Alsumaria", "url": "https://www.alsumaria.tv/Rss", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Shafaq News Arabic", "url": "https://www.shafaq.com/ar/rss", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Shafaq News English", "url": "https://www.shafaq.com/en/rss", "language": "en", "source_country": "Iraq"},
]

# RSS가 없거나 불안정한 소스는 최신 페이지 HTML 링크를 보조 추출합니다.
HTML_NEWS_PAGES = [
    {"source_name": "Alsumaria Latest", "url": "https://www.alsumaria.tv/iraq-latest-news", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Shafaq News English", "url": "https://shafaq.com/en/All-News", "language": "en", "source_country": "Iraq"},
    {"source_name": "Shafaq News Arabic", "url": "https://www.shafaq.com/ar/كل-الأخبار", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Rudaw English", "url": "https://rudaw.net/english", "language": "en", "source_country": "Iraq"},
    {"source_name": "Rudaw Iraq", "url": "https://rudaw.net/english/middleeast/iraq", "language": "en", "source_country": "Iraq"},
    {"source_name": "Kurdistan24 English", "url": "https://www.kurdistan24.net/en", "language": "en", "source_country": "Iraq"},
    {"source_name": "Iraqi News Agency Latest", "url": "https://ina.iq/en/latest/", "language": "en", "source_country": "Iraq"},
    {"source_name": "Al Jazeera Iraq", "url": "https://www.aljazeera.com/where/iraq/", "language": "en", "source_country": "Qatar"},
]

# 특정 언론사 사이트 안에서만 Google News 검색하는 보조 소스
SITE_SPECIFIC_GOOGLE_SOURCES = [
    {"source_name": "Alsumaria", "domain": "alsumaria.tv", "source_country": "Iraq"},
    {"source_name": "Shafaq News", "domain": "shafaq.com", "source_country": "Iraq"},
    {"source_name": "Iraqi News Agency", "domain": "ina.iq", "source_country": "Iraq"},
    {"source_name": "Rudaw", "domain": "rudaw.net", "source_country": "Iraq"},
    {"source_name": "Kurdistan24", "domain": "kurdistan24.net", "source_country": "Iraq"},
    {"source_name": "Iraq Business News", "domain": "iraq-businessnews.com", "source_country": "Iraq"},
    {"source_name": "Kitabat", "domain": "kitabat.com", "source_country": "Iraq"},
    {"source_name": "Iraq News Network", "domain": "aliraqnews.com", "source_country": "Iraq"},
    {"source_name": "Al-Mada", "domain": "almadapaper.net", "source_country": "Iraq"},
    {"source_name": "Voice of Iraq", "domain": "sotaliraq.com", "source_country": "Iraq"},
    {"source_name": "Al Jazeera Iraq", "domain": "aljazeera.com", "source_country": "Qatar"},
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
    source_country: str = ""
    collection_method: str = ""


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def cutoff_datetime() -> datetime:
    return datetime.now(timezone.utc).astimezone() - timedelta(days=FETCH_DAYS + 1)


def fetch_url(url: str, timeout: int = 25) -> bytes:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 BismayahNewsMonitor/4.0 (+https://github.com/sultjung/bismayah2026)",
            "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*",
        },
    )
    with urlopen(req, timeout=timeout) as res:
        return res.read()


def post_json(url: str, payload: dict, headers: dict, timeout: int = 120) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def post_json_with_retry(url: str, payload: dict, headers: dict, max_retries: int = 4) -> dict:
    wait = OPENAI_SLEEP_SECONDS

    for attempt in range(1, max_retries + 1):
        try:
            return post_json(url, payload, headers=headers)

        except HTTPError as exc:
            if exc.code == 429 and attempt < max_retries:
                print(f"WARNING: OpenAI 429 rate limit. Retry {attempt}/{max_retries - 1} after {wait:.0f}s")
                time.sleep(wait)
                wait *= 2
                continue

            try:
                error_body = exc.read().decode("utf-8")
            except Exception:
                error_body = str(exc)
            raise RuntimeError(f"OpenAI HTTP Error {exc.code}: {error_body}") from exc


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(str(value))
    value = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", value, flags=re.S)
    value = re.sub(r"<script.*?</script>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<style.*?</style>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_date(value: str | None) -> str:
    if not value:
        return now_iso()
    value = clean_text(value)
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone().isoformat(timespec="seconds")
    except Exception:
        pass

    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(value[:25], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone().isoformat(timespec="seconds")
        except Exception:
            continue

    return now_iso()


def is_recent(value: str | None) -> bool:
    if not value:
        return True
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone() >= cutoff_datetime()
    except Exception:
        return True


def has_korean(text: str | None) -> bool:
    return bool(text and re.search(r"[가-힣]", text))


def detect_language(text: str) -> str:
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar"
    if re.search(r"[가-힣]", text):
        return "ko"
    if re.search(r"[\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]", text):
        return "ku"
    return "en"


def infer_country(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["iraq", "baghdad", "bismayah", "bismaya", "basra", "erbil", "kurdistan", "بغداد", "العراق", "بسماية", "البصرة", "أربيل", "كوردستان"]):
        return "Iraq"
    if any(x in t for x in ["korea", "seoul", "hanwha", "كوريا", "هانوا"]):
        return "Korea"
    return "Unclassified"


def infer_org(text: str) -> str:
    t = f" {text.lower()} "
    if any(x in t for x in ["hanwha", "هانوا"]):
        return "Hanwha"
    if any(x in t for x in ["national investment commission", " nic ", "الهيئة الوطنية للاستثمار", "هيئة الاستثمار"]):
        return "NIC"
    if any(x in t for x in ["council of ministers", "cabinet", "مجلس الوزراء"]):
        return "Council of Ministers"
    if any(x in t for x in ["parliament", "lawmakers", "mp", "البرلمان", "نواب"]):
        return "Iraq Parliament"
    if any(x in t for x in ["bismayah", "bismaya", "بسماية"]):
        return "BNCP"
    return "General"


def infer_category(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["contract", "agreement", "lawsuit", "fidic", "claim", "arbitration", "عقد", "اتفاق"]):
        return "계약/법무"
    if any(x in t for x in ["investment", "commission", "cabinet", "minister", "government", "استثمار", "مجلس الوزراء", "الحكومة"]):
        return "정부/정책"
    if any(x in t for x in ["housing", "construction", "project", "infrastructure", "city", "مدينة", "مشروع", "إعمار", "السكن"]):
        return "건설/인프라"
    if any(x in t for x in ["security", "protest", "corruption", "arrest", "detained", "lawmakers", "فساد", "اعتقال", "نواب"]):
        return "정치/리스크"
    if any(x in t for x in ["oil", "budget", "finance", "economy", "اقتصاد", "موازنة", "نفط"]):
        return "금융/경제"
    return "일반"


def matched_keywords(text: str) -> list[str]:
    normalized = text.lower()
    hits = []
    raw_keywords = [
        "Bismayah", "Bismaya", "BNCP", "Hanwha", "NIC", "National Investment Commission",
        "Council of Ministers", "Iraq Parliament", "lawmakers", "housing", "investment", "construction",
        "corruption", "arrest",
        "بسماية", "مدينة بسماية", "الهيئة الوطنية للاستثمار", "مجلس الوزراء", "مشاريع السكن", "البرلمان", "نواب"
    ]
    for kw in raw_keywords:
        if kw.lower().replace('"', "") in normalized:
            hits.append(kw.replace('"', ""))
    return sorted(set(hits))


def is_relevant(text: str) -> bool:
    if not STRICT_RELEVANCE:
        return True
    t = f" {text.lower()} "
    return any(kw.lower() in t for kw in RELEVANCE_KEYWORDS)


def is_noise_article_dict(article: dict) -> bool:
    """자동차/스포츠/연예 등 명백한 무관 기사 제거."""
    source = str(article.get("source") or "").lower()
    url = str(article.get("url") or "").lower()
    text = " ".join([
        str(article.get("title_original") or ""),
        str(article.get("title_ko") or ""),
        str(article.get("summary_ko") or ""),
        str(article.get("source") or ""),
        str(article.get("url") or ""),
    ]).lower()

    if any(bad in source for bad in EXCLUDED_SOURCE_NAMES):
        return True
    if any(bad in url for bad in EXCLUDED_SOURCE_NAMES):
        return True
    if any(bad in text for bad in EXCLUDED_TEXT_PATTERNS):
        return True

    return False


def has_business_relevance_article_dict(article: dict) -> bool:
    """저장된 기존 기사까지 포함해서 최종 관련성 재검증."""
    text = " ".join([
        str(article.get("title_original") or ""),
        str(article.get("title_ko") or ""),
        str(article.get("summary_ko") or ""),
        str(article.get("source") or ""),
        str(article.get("organization") or ""),
        str(article.get("category") or ""),
        " ".join(str(x) for x in article.get("keywords", []) if x),
    ])

    return is_relevant(text)


def final_article_filter(articles: list[dict]) -> list[dict]:
    """news.json에 최종 저장하기 전 무관 기사 제거."""
    cleaned = []
    removed = []

    for article in articles:
        if is_noise_article_dict(article):
            removed.append(article)
            continue

        if not has_business_relevance_article_dict(article):
            removed.append(article)
            continue

        cleaned.append(article)

    if removed:
        print(f"Removed {len(removed)} irrelevant/noise articles before saving.")
        for a in removed[:10]:
            print(f"  - removed: {a.get('source', 'Unknown')} / {a.get('title_original') or a.get('title_ko')}")

    return cleaned



def score_importance(text: str, hits: list[str]) -> int:
    t = text.lower()
    score = 35 + len(hits) * 5

    high_signals = [
        "bismayah", "bismaya", "hanwha", "national investment commission",
        "council of ministers", "cabinet", "contract", "agreement",
        "بسماية", "هانوا", "الهيئة الوطنية للاستثمار", "مجلس الوزراء"
    ]

    risk_signals = [
        "arrest", "corruption", "suspension", "termination", "lawsuit", "lawmakers",
        "فساد", "اعتقال", "إيقاف", "إنهاء", "نواب"
    ]

    for word in high_signals:
        if word in t:
            score += 7
    for word in risk_signals:
        if word in t:
            score += 7

    return max(1, min(100, score))


def make_id(title: str, url: str) -> str:
    raw = f"{title}|{url}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


def make_summary(title: str, desc: str) -> str:
    if desc and desc.lower() != title.lower():
        return desc[:420]
    return f"자동 수집된 기사입니다. 제목과 원문 링크를 기준으로 비스마야/Bismayah 및 이라크 사업 관련성을 확인하세요: {title}"[:420]


def find_text_any(parent: ET.Element, names: list[str]) -> str:
    # 일반 태그
    for name in names:
        value = parent.findtext(name)
        if value:
            return value

    # namespace 태그
    for elem in list(parent):
        tag = elem.tag.split("}")[-1].lower()
        if tag in [n.lower() for n in names] and elem.text:
            return elem.text

    return ""


def get_link_from_item(item: ET.Element, base_url: str = "") -> str:
    link = find_text_any(item, ["link"])
    if link:
        return urljoin(base_url, clean_text(link))

    for elem in list(item):
        tag = elem.tag.split("}")[-1].lower()
        if tag == "link":
            href = elem.attrib.get("href")
            if href:
                return urljoin(base_url, href)

    return ""


def extract_source(item: ET.Element, default_source: str = "Unknown") -> str:
    source = item.find("source")
    if source is not None and source.text:
        return clean_text(source.text)

    for elem in list(item):
        tag = elem.tag.split("}")[-1].lower()
        if tag == "source" and elem.text:
            return clean_text(elem.text)

    title = clean_text(find_text_any(item, ["title"]))
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip()
    return default_source


def article_from_parts(
    *,
    title: str,
    url: str,
    desc: str,
    published: str,
    source: str,
    language: str = "",
    source_country: str = "",
    collection_method: str = "",
) -> Article | None:
    title = clean_text(title)
    desc = clean_text(desc)
    url = clean_text(url)

    if not title or not url:
        return None

    text = f"{title} {desc} {source}"

    if not is_relevant(text):
        return None

    if not is_recent(published):
        return None

    hits = matched_keywords(text)
    lang = language or detect_language(text)

    return Article(
        id=make_id(title, url),
        date_found=now_iso(),
        published_date=published or now_iso(),
        source=source or "Unknown",
        title_original=title,
        title_ko=title,
        summary_ko=make_summary(title, desc),
        url=url,
        language=lang,
        country=infer_country(text),
        organization=infer_org(text),
        keywords=hits,
        importance_score=score_importance(text, hits),
        category=infer_category(text),
        source_country=source_country,
        collection_method=collection_method,
    )


def parse_xml_feed(xml_bytes: bytes, feed_url: str, default_source: str, language: str = "", source_country: str = "", method: str = "direct_rss") -> list[Article]:
    articles: list[Article] = []

    try:
        root = ET.fromstring(xml_bytes)
    except Exception as exc:
        raise ValueError(f"Not XML or invalid XML: {exc}") from exc

    # RSS
    items = root.findall(".//item")

    # Atom
    if not items:
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    for item in items[:MAX_ITEMS_PER_FEED]:
        title = clean_text(find_text_any(item, ["title"]))
        link = get_link_from_item(item, feed_url)
        desc = clean_text(find_text_any(item, ["description", "summary", "content", "encoded"]))
        published = parse_date(find_text_any(item, ["pubDate", "published", "updated", "date"]))
        source = extract_source(item, default_source)

        article = article_from_parts(
            title=title,
            url=link,
            desc=desc,
            published=published,
            source=source or default_source,
            language=language,
            source_country=source_country,
            collection_method=method,
        )
        if article:
            articles.append(article)

    return articles


def parse_rss_index_links(html_bytes: bytes, base_url: str) -> list[str]:
    text = html_bytes.decode("utf-8", errors="ignore")
    links = set()

    # href="..."
    for href in re.findall(r'href=["\']([^"\']+)["\']', text, flags=re.I):
        href_clean = html.unescape(href).strip()
        lower = href_clean.lower()
        if any(x in lower for x in ["rss", "feed", "xml"]):
            links.add(urljoin(base_url, href_clean))

    # plain URLs
    for url in re.findall(r'https?://[^\s"\'<>]+', text):
        lower = url.lower()
        if any(x in lower for x in ["rss", "feed", "xml"]):
            links.add(url)

    return sorted(links)


def parse_html_article_links(html_bytes: bytes, page_url: str, source_name: str, language: str = "", source_country: str = "") -> list[Article]:
    text = html_bytes.decode("utf-8", errors="ignore")
    articles: list[Article] = []

    # 단순하지만 GitHub Actions에서 외부 패키지 없이 돌아가게 만든 HTML 링크 추출
    # <a href="...">title</a>
    pattern = re.compile(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', flags=re.I | re.S)
    seen_links = set()

    for href, inner in pattern.findall(text):
        url = urljoin(page_url, html.unescape(href).strip())
        parsed = urlparse(url)

        if not parsed.scheme.startswith("http"):
            continue

        title = clean_text(inner)
        if len(title) < 8:
            continue

        # 메뉴/버튼/소셜 링크 제외
        bad_fragments = ["facebook", "twitter", "instagram", "youtube", "whatsapp", "privacy", "terms", "contact", "live-tv", "app"]
        if any(x in url.lower() for x in bad_fragments):
            continue

        if url in seen_links:
            continue
        seen_links.add(url)

        article = article_from_parts(
            title=title,
            url=url,
            desc="",
            published=now_iso(),
            source=source_name,
            language=language,
            source_country=source_country,
            collection_method="html_page",
        )

        if article:
            articles.append(article)

        if len(articles) >= MAX_HTML_LINKS_PER_PAGE:
            break

    return articles


def collect_google_news() -> list[Article]:
    collected: list[Article] = []

    for keyword in KEYWORDS:
        for endpoint in GOOGLE_NEWS_ENDPOINTS:
            url = endpoint.format(query=quote_plus(keyword), days=FETCH_DAYS)
            try:
                print(f"Google News keyword: {keyword}")
                xml = fetch_url(url)
                collected.extend(parse_xml_feed(xml, url, "Google News", method="google_news"))
                time.sleep(0.5)
            except Exception as exc:
                print(f"WARNING: Google News failed for {keyword}: {exc}", file=sys.stderr)

    return collected


def collect_site_google_news() -> list[Article]:
    collected: list[Article] = []

    for source in SITE_SPECIFIC_GOOGLE_SOURCES:
        domain = source["domain"]
        source_name = source["source_name"]
        source_country = source.get("source_country", "")

        for keyword in SITE_SEARCH_KEYWORDS:
            query = f"site:{domain} {keyword}"
            endpoint = GOOGLE_NEWS_ENDPOINTS[0]
            url = endpoint.format(query=quote_plus(query), days=FETCH_DAYS)

            try:
                print(f"Google News site search: {source_name} / {keyword}")
                xml = fetch_url(url)
                articles = parse_xml_feed(xml, url, source_name, source_country=source_country, method="google_news_site")
                for a in articles:
                    if a.source == "Google News":
                        a.source = source_name
                    if not a.source_country:
                        a.source_country = source_country
                collected.extend(articles)
                time.sleep(0.5)
            except Exception as exc:
                print(f"WARNING: Google site search failed for {source_name} / {keyword}: {exc}", file=sys.stderr)

    return collected


def collect_direct_rss() -> list[Article]:
    collected: list[Article] = []

    for feed in DIRECT_RSS_FEEDS:
        try:
            print(f"Direct RSS: {feed['source_name']} / {feed['url']}")
            xml = fetch_url(feed["url"])
            collected.extend(parse_xml_feed(
                xml,
                feed["url"],
                feed["source_name"],
                language=feed.get("language", ""),
                source_country=feed.get("source_country", ""),
                method="direct_rss",
            ))
            time.sleep(0.6)
        except Exception as exc:
            print(f"WARNING: direct RSS failed for {feed['source_name']}: {exc}", file=sys.stderr)

    return collected


def collect_rss_index_pages() -> list[Article]:
    collected: list[Article] = []

    for page in RSS_INDEX_PAGES:
        try:
            print(f"RSS index page: {page['source_name']} / {page['url']}")
            html_bytes = fetch_url(page["url"])
            feed_links = parse_rss_index_links(html_bytes, page["url"])

            # 페이지 자체가 XML인 경우도 있으므로 먼저 시도
            try:
                collected.extend(parse_xml_feed(
                    html_bytes,
                    page["url"],
                    page["source_name"],
                    language=page.get("language", ""),
                    source_country=page.get("source_country", ""),
                    method="rss_index_direct",
                ))
            except Exception:
                pass

            for link in feed_links[:12]:
                try:
                    print(f"  discovered RSS: {link}")
                    xml = fetch_url(link)
                    collected.extend(parse_xml_feed(
                        xml,
                        link,
                        page["source_name"],
                        language=page.get("language", ""),
                        source_country=page.get("source_country", ""),
                        method="rss_index_discovered",
                    ))
                    time.sleep(0.4)
                except Exception as exc:
                    print(f"WARNING: discovered RSS failed for {link}: {exc}", file=sys.stderr)

            time.sleep(0.6)
        except Exception as exc:
            print(f"WARNING: RSS index page failed for {page['source_name']}: {exc}", file=sys.stderr)

    return collected


def collect_html_pages() -> list[Article]:
    collected: list[Article] = []

    for page in HTML_NEWS_PAGES:
        try:
            print(f"HTML page: {page['source_name']} / {page['url']}")
            html_bytes = fetch_url(page["url"])
            collected.extend(parse_html_article_links(
                html_bytes,
                page["url"],
                page["source_name"],
                language=page.get("language", ""),
                source_country=page.get("source_country", ""),
            ))
            time.sleep(0.6)
        except Exception as exc:
            print(f"WARNING: HTML page failed for {page['source_name']}: {exc}", file=sys.stderr)

    return collected


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
        if url:
            # Google News redirect URL은 중복이 생기지만 일단 URL 기준으로 처리
            return url

        title = re.sub(r"\s+", " ", (a.get("title_original") or a.get("title_ko") or "").strip().lower())
        return title

    for article in articles:
        k = key(article)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(article)

    out.sort(key=lambda a: (a.get("published_date") or a.get("date_found") or ""), reverse=True)
    return out[:1200]


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

    print(
        f"Translating {len(targets)} articles with OpenAI model: {OPENAI_MODEL} "
        f"(batch={TRANSLATION_BATCH_SIZE}, sleep={OPENAI_SLEEP_SECONDS}s)"
    )

    by_id = {a["id"]: a for a in articles if a.get("id")}

    system_prompt = (
        "You are a Korean business intelligence analyst for an Iraq construction project. "
        "Translate and rewrite news titles and short descriptions into clear Korean. "
        "Do not exaggerate. Preserve proper nouns such as Bismayah, Hanwha, NIC, Iraq, Baghdad. "
        "Return only valid JSON."
    )

    for batch in chunks(targets, TRANSLATION_BATCH_SIZE):
        input_items = []
        for a in batch:
            input_items.append({
                "id": a.get("id"),
                "source": a.get("source"),
                "source_country": a.get("source_country"),
                "published_date": a.get("published_date"),
                "title_original": a.get("title_original"),
                "summary_source": a.get("summary_ko"),
                "url": a.get("url"),
                "language": a.get("language"),
                "current_country": a.get("country"),
                "current_organization": a.get("organization"),
                "current_keywords": a.get("keywords"),
                "collection_method": a.get("collection_method"),
            })

        user_prompt = {
            "task": "For each article, produce Korean dashboard fields.",
            "rules": [
                "title_ko must be natural Korean, not a literal machine translation.",
                "summary_ko must be 1-2 Korean sentences, concise and useful for a Korean construction company employee.",
                "If relevance to Bismayah/Hanwha/NIC/Iraq construction is weak, say that briefly in summary_ko.",
                "importance_score must be 1-100. 90+ means direct Bismayah/Hanwha/NIC contract, Iraqi cabinet/government decision, or direct BNCP issue. 70+ means Iraq housing/construction/investment or important political-risk issue. Lower if indirect.",
                "category must be one of: 정부/정책, 건설/인프라, 계약/법무, 정치/리스크, 금융/경제, 일반.",
                "organization should be one of: BNCP, Hanwha, NIC, Council of Ministers, Iraq Parliament, Iraq Government, General, or another short label.",
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
            response = post_json_with_retry(
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

            time.sleep(OPENAI_SLEEP_SECONDS)

        except Exception as exc:
            print(f"WARNING: translation batch failed: {exc}", file=sys.stderr)

    return articles


def main() -> int:
    existing = load_existing()
    existing = [a for a in existing if not str(a.get("id", "")).startswith("demo-")]

    # 기존 news.json에 이미 들어간 무관 기사도 이번 실행에서 같이 청소합니다.
    existing = final_article_filter(existing)

    collected_articles: list[Article] = []

    # 1. 기존 Google News 키워드 검색
    collected_articles.extend(collect_google_news())

    # 2. 이라크/중동 언론사 직접 RSS
    collected_articles.extend(collect_direct_rss())

    # 3. RSS 안내 페이지에서 RSS 링크 자동 발견
    collected_articles.extend(collect_rss_index_pages())

    # 4. RSS가 불안정한 사이트는 최신 HTML 페이지 보조 추출
    collected_articles.extend(collect_html_pages())

    # 5. 특정 언론사 사이트 Google News 보조 검색
    collected_articles.extend(collect_site_google_news())

    collected_dicts = [asdict(a) for a in collected_articles]
    merged = dedupe(collected_dicts + existing)

    # 새로 들어온 기사와 기존 기사 모두 저장 전 최종 관련성 검증
    merged = final_article_filter(merged)

    # OpenAI API가 있으면 새 기사/미번역 기사부터 한국어화
    merged = translate_articles_with_openai(merged)

    # AI 번역 후에도 한 번 더 정리. General/Unclassified 무관 기사가 남는 것을 방지합니다.
    merged = final_article_filter(merged)

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(
        json.dumps({"last_updated": now_iso(), "articles": merged}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Collected {len(collected_dicts)} candidate articles.")
    print(f"Saved {len(merged)} articles to {DATA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
