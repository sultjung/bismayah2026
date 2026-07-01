#!/usr/bin/env python3
"""
Bismayah News Monitor v9
- 국내 언론사 / 글로벌 언론사 섹션 분리
- 국내: Google News 한국어 결과만 사용
- 글로벌: Google News(아랍어/영어) + 핵심 RSS
- 1주일 기사 중심
- OpenAI로 한국어 제목/요약 생성
- v9: 국내 기사 점수제 필터 + 야구/축구 뉴스 강제 제외
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
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError
from urllib.parse import quote_plus, urljoin, urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "news.json"

OPENAI_API_KEY = re.sub(r"\s+", "", os.getenv("OPENAI_API_KEY", ""))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

FETCH_DAYS = int(os.getenv("FETCH_DAYS", "7"))
MAX_TRANSLATIONS_PER_RUN = int(os.getenv("MAX_TRANSLATIONS_PER_RUN", "5"))
TRANSLATION_BATCH_SIZE = int(os.getenv("TRANSLATION_BATCH_SIZE", "3"))
OPENAI_SLEEP_SECONDS = float(os.getenv("OPENAI_SLEEP_SECONDS", "5"))
MAX_ITEMS_PER_FEED = int(os.getenv("MAX_ITEMS_PER_FEED", "25"))

ENABLE_DIRECT_RSS = os.getenv("ENABLE_DIRECT_RSS", "true").lower() == "true"
ENABLE_RSS_INDEX = os.getenv("ENABLE_RSS_INDEX", "true").lower() == "true"
ENABLE_SITE_GOOGLE_SEARCH = os.getenv("ENABLE_SITE_GOOGLE_SEARCH", "false").lower() == "true"

DOMESTIC_KEYWORDS = [
    # 최우선
    "비스마야",
    "\"한화\" \"이라크\"",
    "\"한화건설\" \"이라크\"",
    "\"이라크\" \"사업\"",
    "\"이라크\" \"건설\"",
    "\"이라크\" \"투자\"",

    # 평소에도 보고 싶은 한화 건설/인프라 기사
    "\"한화\" \"건설\"",
    "\"한화 건설부문\"",
    "\"한화\" \"인프라\"",
    "\"한화\" \"플랜트\"",
    "\"한화\" \"주택\"",
]

# 국내 기사 최소 점수
# 너무 많이 잡히면 25~30으로 올리고, 너무 적게 잡히면 10~15로 낮추면 됩니다.
DOMESTIC_MIN_SCORE = int(os.getenv("DOMESTIC_MIN_SCORE", "15"))

# 최우선 관련 기사: 점수가 높아서 상단에 올라갑니다.
DOMESTIC_PRIORITY_RULES = [
    (["비스마야"], 100, "비스마야"),
    (["bismayah"], 100, "Bismayah"),
    (["한화", "이라크"], 90, "한화+이라크"),
    (["한화건설", "이라크"], 90, "한화건설+이라크"),
    (["이라크", "비스마야"], 90, "이라크+비스마야"),
    (["이라크", "신도시"], 75, "이라크+신도시"),
    (["이라크", "사업"], 60, "이라크+사업"),
    (["이라크", "건설"], 60, "이라크+건설"),
    (["이라크", "투자"], 55, "이라크+투자"),
    (["이라크", "인프라"], 55, "이라크+인프라"),
]

# 일반 관련 기사: 평소에도 끌어올 기사입니다.
DOMESTIC_GENERAL_RULES = [
    (["한화", "건설"], 35, "한화+건설"),
    (["한화건설"], 35, "한화건설"),
    (["한화", "건설부문"], 40, "한화+건설부문"),
    (["한화", "인프라"], 25, "한화+인프라"),
    (["한화", "플랜트"], 25, "한화+플랜트"),
    (["한화", "주택"], 20, "한화+주택"),
    (["한화", "부동산"], 20, "한화+부동산"),
    (["이라크"], 18, "이라크 단독"),
]

# 국내 스포츠/야구/축구 뉴스는 무조건 제외합니다.
# 직접 추가하고 싶으면 여기에 단어를 계속 넣으면 됩니다.
DOMESTIC_SPORTS_EXCLUDE_PATTERNS = [
    # 한화 야구
    "한화이글스", "한화 이글스", "이글스", "한화생명 볼파크",
    "야구", "프로야구", "kbo", "류현진", "문동주", "채은성", "노시환",
    "페라자", "와이스", "폰세", "김경문", "최원호",
    "투수", "타자", "홈런", "타율", "타점", "안타", "이닝", "삼진",
    "불펜", "선발", "마운드", "포수", "내야수", "외야수", "구단",
    "라인업", "타선", "마무리", "끝내기", "연승", "연패", "승리", "패배",

    # 축구/대표팀/스포츠 일반
    "축구", "월드컵", "이라크전", "대표팀", "평가전", "예선", "손흥민",
    "경기 일정", "스코어", "득점", "실점", "감독 선임", "선수단",
    "라드브록스", "ladbrokes", "베팅", "오즈", "odds",
]

GLOBAL_KEYWORDS = [
    "Bismayah",
    "Bismaya",
    "\"BNCP\"",
    "بسماية",
    "\"مشروع بسماية\"",
    "\"Hanwha Iraq\"",
    "\"Hanwha Bismayah\"",
    "\"National Investment Commission Iraq\"",
    "\"NIC Iraq\"",
    "\"Iraq housing project\"",
    "\"Iraq residential\"",
    "\"الهيئة الوطنية للاستثمار\"",
    "\"مشروع سكني\"",
]

RELEVANCE_KEYWORDS = [
    "bismayah", "bismaya", "bncp",
    "hanwha", "national investment commission", " nic ",
    "housing project", "iraq residential",
    "بسماية", "مدينة بسماية", "مشروع بسماية",
    "الهيئة الوطنية للاستثمار", "مشروع سكني",
    "비스마야", "한화 이라크", "이라크 사업",
]

EXCLUDED_SOURCE_NAMES = [
    "team-bhp", "carwale", "autocar", "zigwheels", "motorbeam", "rushlane",
    "cricbuzz", "espncricinfo", "bollywood",
]

EXCLUDED_TEXT_PATTERNS = [
    "kiger", "baleno", "which car", "car cools", "ac test", "indian summers",
    "renault", "maruti", "suzuki", "hyundai", "mahindra", "toyota", "honda",
    "bike", "motorcycle", "scooter", "cricket", "ipl", "football transfer",
    "movie review", "celebrity", "box office",

    # 국내 스포츠/야구/축구 잡음
    "한화이글스", "한화 이글스", "이글스", "한화생명 볼파크",
    "야구", "프로야구", "kbo", "류현진", "문동주", "채은성", "노시환",
    "투수", "타자", "홈런", "타율", "타점", "안타", "이닝", "삼진",
    "불펜", "선발", "마운드", "포수", "내야수", "외야수", "구단",
    "축구", "월드컵", "이라크전", "대표팀", "평가전", "예선",
    "라드브록스", "ladbrokes", "베팅", "odds",
]

FOREIGN_SOURCES_FOR_DOMESTIC = [
    "alsumaria", "shafaq", "iraqi news agency", "iraq business news", "al jazeera",
    "rudaw", "kurdistan24", "ina.iq", "alsumaria.tv", "shafaq.com", "aljazeera.com",
]

KOREAN_MEDIA_PATTERN = re.compile(
    r"newsis|yna|yonhap|연합뉴스|뉴시스|조선|중앙|동아|매일경제|한국경제|머니투데이|"
    r"헤럴드|서울경제|아주경제|이데일리|파이낸셜뉴스|한국일보|서울신문|매일신문|"
    r"부산일보|kbs|mbc|sbs|ytn|jtbc|chosun|joongang|donga|mk\.co|hankyung",
    re.I,
)


def normalize_for_match(text: str | None) -> str:
    text = clean_text(text)
    text = text.lower()
    text = re.sub(r"[·ㆍ|,，.。:：;；/\\()[\]{}<>「」『』【】\\-–—_]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def has_all_terms(text: str, terms: list[str]) -> bool:
    normalized = normalize_for_match(text)
    return all(normalize_for_match(term) in normalized for term in terms)


def is_domestic_sports_noise(text: str) -> bool:
    normalized = normalize_for_match(text)
    return any(normalize_for_match(pattern) in normalized for pattern in DOMESTIC_SPORTS_EXCLUDE_PATTERNS)


def score_domestic_relevance(title: str, desc: str = "", source: str = "", url: str = "") -> tuple[int, list[str], list[str]]:
    """
    국내 기사 관련성 점수.
    - 야구/축구/스포츠성 뉴스는 -999점으로 강제 제외
    - 비스마야/한화+이라크/이라크 사업·건설·투자는 높은 점수
    - 한화 건설부문/건설/인프라/플랜트는 일반 점수
    """
    title = clean_text(title)
    desc = clean_text(desc)
    source = clean_text(source)
    url = clean_text(url)

    combined = f"{title} {desc} {source} {url}"
    if is_domestic_sports_noise(combined):
        return -999, [], ["sports/baseball/soccer"]

    score = 0
    hits: list[str] = []

    for terms, points, label in DOMESTIC_PRIORITY_RULES:
        if has_all_terms(title, terms):
            score += points
            hits.append(f"제목:{label}")
        elif has_all_terms(desc, terms):
            score += round(points * 0.55)
            hits.append(f"요약:{label}")

    for terms, points, label in DOMESTIC_GENERAL_RULES:
        if has_all_terms(title, terms):
            score += points
            hits.append(f"제목:{label}")
        elif has_all_terms(desc, terms):
            score += round(points * 0.45)
            hits.append(f"요약:{label}")

    return score, hits, []


def is_domestic_original_article(title: str, desc: str = "", source: str = "", url: str = "", language: str = "") -> bool:
    """
    국내 언론사 판별은 AI 번역문이 아니라 원문 제목/요약/출처 기준으로만 합니다.
    v9에서는 제목만 보지 않고 Google News 요약도 보되, 야구/축구는 강제 제외합니다.
    """
    title = clean_text(title)
    desc = clean_text(desc)
    source = clean_text(source)
    url = clean_text(url)

    source_l = source.lower()
    url_l = url.lower()

    if any(x in source_l or x in url_l for x in FOREIGN_SOURCES_FOR_DOMESTIC):
        return False

    original_text = f"{title} {desc}"
    has_korean_original = (
        has_korean(original_text)
        or language.lower() == "ko"
        or bool(KOREAN_MEDIA_PATTERN.search(source_l))
        or bool(KOREAN_MEDIA_PATTERN.search(url_l))
    )

    if not has_korean_original:
        return False

    score, _, _ = score_domestic_relevance(title, desc, source, url)
    return score >= DOMESTIC_MIN_SCORE


DOMESTIC_GOOGLE_ENDPOINTS = [
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=ko&gl=KR&ceid=KR:ko",
]

GLOBAL_GOOGLE_ENDPOINTS = [
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=ar&gl=IQ&ceid=IQ:ar",
    "https://news.google.com/rss/search?q={query}+when:{days}d&hl=en-US&gl=US&ceid=US:en",
]

DIRECT_RSS_FEEDS = [
    {"source_name": "Iraqi News Agency", "url": "https://ina.iq/rss_feed.xml", "language": "en", "source_country": "Iraq"},
    {"source_name": "Iraq Business News", "url": "https://www.iraq-businessnews.com/feed", "language": "en", "source_country": "Iraq"},
    {"source_name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml", "language": "en", "source_country": "Qatar"},
]

RSS_INDEX_PAGES = [
    {"source_name": "Alsumaria", "url": "https://www.alsumaria.tv/Rss", "language": "ar", "source_country": "Iraq"},
    {"source_name": "Shafaq News English", "url": "https://www.shafaq.com/en/rss", "language": "en", "source_country": "Iraq"},
]

SITE_SPECIFIC_GOOGLE_SOURCES = [
    {"source_name": "Alsumaria", "domain": "alsumaria.tv", "source_country": "Iraq"},
    {"source_name": "Shafaq News", "domain": "shafaq.com", "source_country": "Iraq"},
    {"source_name": "Iraqi News Agency", "domain": "ina.iq", "source_country": "Iraq"},
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
    segment: str = "global"


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def cutoff_datetime() -> datetime:
    return datetime.now(timezone.utc).astimezone() - timedelta(days=FETCH_DAYS + 1)


def fetch_url(url: str, timeout: int = 12) -> bytes:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 BismayahNewsMonitor/8.0",
            "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*",
        },
    )
    with urlopen(req, timeout=timeout) as res:
        return res.read()


def post_json(url: str, payload: dict, headers: dict, timeout: int = 120) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def post_json_with_retry(url: str, payload: dict, headers: dict, max_retries: int = 4) -> dict:
    wait = OPENAI_SLEEP_SECONDS
    for attempt in range(1, max_retries + 1):
        try:
            return post_json(url, payload, headers=headers)
        except HTTPError as exc:
            if exc.code == 429 and attempt < max_retries:
                print(f"WARNING: OpenAI 429, retry after {wait:.0f}s")
                time.sleep(wait)
                wait *= 2
                continue
            try:
                body = exc.read().decode("utf-8")
            except Exception:
                body = str(exc)
            raise RuntimeError(f"OpenAI HTTP Error {exc.code}: {body}") from exc


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

    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(value[:25], fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone().isoformat(timespec="seconds")
        except Exception:
            continue
    return now_iso()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone()
    except Exception:
        return None


def is_recent(value: str | None) -> bool:
    dt = parse_iso(value)
    return True if dt is None else dt >= cutoff_datetime()


def has_korean(text: str | None) -> bool:
    return bool(text and re.search(r"[가-힣]", text))


def detect_language(text: str) -> str:
    if re.search(r"[가-힣]", text):
        return "ko"
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar"
    return "en"


def infer_country(text: str, segment: str) -> str:
    t = text.lower()
    if segment == "domestic":
        return "Korea"
    if any(x in t for x in ["iraq", "baghdad", "bismayah", "bismaya", "العراق", "بغداد", "بسماية"]):
        return "Iraq"
    if "korea" in t or "한화" in t:
        return "Korea"
    return "Unclassified"


def infer_org(text: str) -> str:
    t = f" {text.lower()} "
    if any(x in t for x in ["bismayah", "bismaya", "bncp", "بسماية"]):
        return "BNCP"
    if any(x in t for x in ["hanwha", "هانوا", "한화"]):
        return "Hanwha"
    if any(x in t for x in ["national investment commission", " nic ", "الهيئة الوطنية للاستثمار"]):
        return "NIC"
    if any(x in t for x in ["council of ministers", "cabinet", "مجلس الوزراء"]):
        return "Council of Ministers"
    if any(x in t for x in ["parliament", "lawmakers", "البرلمان", "نواب"]):
        return "Iraq Parliament"
    return "General"


def infer_category(text: str) -> str:
    t = text.lower()
    if any(x in t for x in ["contract", "agreement", "claim", "lawsuit", "عقد", "اتفاق"]):
        return "계약/법무"
    if any(x in t for x in ["investment", "commission", "cabinet", "minister", "استثمار", "مجلس الوزراء"]):
        return "정부/정책"
    if any(x in t for x in ["housing", "construction", "project", "city", "مشروع", "السكن", "مدينة"]):
        return "건설/인프라"
    if any(x in t for x in ["corruption", "arrest", "lawmakers", "فساد", "اعتقال", "نواب"]):
        return "정치/리스크"
    return "일반"


def matched_keywords(text: str) -> list[str]:
    hits = []
    t = text.lower()
    raw = [
        "Bismayah", "Bismaya", "BNCP", "Hanwha", "NIC",
        "National Investment Commission", "Iraq housing project",
        "بسماية", "مدينة بسماية", "مشروع بسماية", "الهيئة الوطنية للاستثمار", "مشروع سكني",
        "비스마야", "한화 이라크", "이라크 사업",
    ]
    for kw in raw:
        if kw.lower().replace('"', "") in t:
            hits.append(kw.replace('"', ""))
    return sorted(set(hits))


def is_relevant(text: str, segment: str) -> bool:
    if segment == "domestic":
        score, _, _ = score_domestic_relevance(text, "", "", "")
        return score >= DOMESTIC_MIN_SCORE
    t = f" {text.lower()} "
    return any(kw.lower().replace('"', "") in t for kw in RELEVANCE_KEYWORDS)


def direct_project_level(text: str) -> int:
    t = f" {text.lower()} "
    if any(x in t for x in ["bismayah", "bismaya", "bncp", "بسماية", "مدينة بسماية", "مشروع بسماية", "비스마야"]):
        return 4
    if any(x in t for x in ["hanwha iraq", "hanwha bismayah", "هانوا", "national investment commission", " nic ", "الهيئة الوطنية للاستثمار", "مشروع سكني", "housing project"]):
        return 3
    if any(x in t for x in ["council of ministers", "cabinet", "construction project", "investment project", "مجلس الوزراء"]):
        return 2
    if any(x in t for x in ["parliament", "lawmakers", "corruption", "arrest", "البرلمان", "نواب", "فساد", "اعتقال"]):
        return 1
    return 0


def score_importance(text: str, hits: list[str]) -> int:
    t = text.lower()
    level = direct_project_level(text)

    if level == 4:
        score = 88
    elif level == 3:
        score = 76
    elif level == 2:
        score = 62
    elif level == 1:
        score = 48
    else:
        score = 30

    if any(x in t for x in ["bismayah", "bismaya", "bncp", "بسماية", "비스마야"]):
        score += 8
    if any(x in t for x in ["hanwha", "هانوا", "한화"]):
        score += 5
    if any(x in t for x in ["national investment commission", " nic ", "الهيئة الوطنية للاستثمار"]):
        score += 5
    if any(x in t for x in ["contract", "agreement", "payment", "cabinet", "council of ministers", "عقد", "اتفاق", "مجلس الوزراء"]):
        score += 4
    if any(x in t for x in ["arrest", "corruption", "suspension", "termination", "فساد", "اعتقال", "إيقاف", "إنهاء"]):
        score += 3

    caps = {4: 100, 3: 88, 2: 76, 1: 65, 0: 45}
    return max(1, min(caps[level], score))


def make_id(title: str, url: str, segment: str) -> str:
    return hashlib.sha1(f"{segment}|{title}|{url}".encode("utf-8")).hexdigest()[:16]


def make_summary(title: str, desc: str) -> str:
    if desc and desc.lower() != title.lower():
        return desc[:420]
    return f"자동 수집된 기사입니다: {title}"[:420]


def find_text_any(parent: ET.Element, names: list[str]) -> str:
    for name in names:
        value = parent.findtext(name)
        if value:
            return value
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
    title = clean_text(find_text_any(item, ["title"]))
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip()
    return default_source


def article_from_parts(*, title: str, url: str, desc: str, published: str, source: str,
                       language: str = "", source_country: str = "", collection_method: str = "",
                       segment: str = "global") -> Article | None:
    title = clean_text(title)
    desc = clean_text(desc)
    url = clean_text(url)
    if not title or not url:
        return None

    text = f"{title} {desc} {source}"

    if segment == "domestic" and not is_domestic_original_article(title, desc, source, url, language):
        return None

    if not is_relevant(text, segment):
        return None
    if not is_recent(published):
        return None

    hits = matched_keywords(text)
    importance = score_importance(text, hits)

    if segment == "domestic":
        domestic_score, domestic_hits, _ = score_domestic_relevance(title, desc, source, url)
        importance = max(importance, min(100, domestic_score))
        hits = sorted(set(hits + domestic_hits))

    lang = language or detect_language(text)

    return Article(
        id=make_id(title, url, segment),
        date_found=now_iso(),
        published_date=published or now_iso(),
        source=source or "Unknown",
        title_original=title,
        title_ko=title,
        summary_ko=make_summary(title, desc),
        url=url,
        language=lang,
        country=infer_country(text, segment),
        organization=infer_org(text),
        keywords=hits,
        importance_score=importance,
        category=infer_category(text),
        source_country=source_country,
        collection_method=collection_method,
        segment=segment,
    )


def parse_xml_feed(xml_bytes: bytes, feed_url: str, default_source: str, language: str = "",
                   source_country: str = "", method: str = "direct_rss", segment: str = "global") -> list[Article]:
    articles: list[Article] = []
    root = ET.fromstring(xml_bytes)
    items = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
    for item in items[:MAX_ITEMS_PER_FEED]:
        article = article_from_parts(
            title=clean_text(find_text_any(item, ["title"])),
            url=get_link_from_item(item, feed_url),
            desc=clean_text(find_text_any(item, ["description", "summary", "content", "encoded"])),
            published=parse_date(find_text_any(item, ["pubDate", "published", "updated", "date"])),
            source=extract_source(item, default_source),
            language=language,
            source_country=source_country,
            collection_method=method,
            segment=segment,
        )
        if article:
            articles.append(article)
    return articles


def parse_rss_index_links(html_bytes: bytes, base_url: str) -> list[str]:
    text = html_bytes.decode("utf-8", errors="ignore")
    links = set()
    for href in re.findall(r'href=["\']([^"\']+)["\']', text, flags=re.I):
        href = html.unescape(href).strip()
        lower = href.lower()
        if any(x in lower for x in ["rss", "feed", "xml"]):
            links.add(urljoin(base_url, href))
    return sorted(links)


def collect_google_news_by_keywords(keywords: list[str], endpoints: list[str], segment: str) -> list[Article]:
    collected: list[Article] = []
    print(f"Google News search uses {len(endpoints)} endpoint(s) for {segment}.")
    for keyword in keywords:
        for endpoint in endpoints:
            url = endpoint.format(query=quote_plus(keyword), days=FETCH_DAYS)
            try:
                print(f"Google News [{segment}] keyword: {keyword}")
                xml = fetch_url(url)
                items = parse_xml_feed(xml, url, "Google News", method="google_news", segment=segment)
                for a in items:
                    if segment == "domestic":
                        a.language = "ko"
                        a.country = "Korea"
                collected.extend(items)
                time.sleep(0.4)
            except Exception as exc:
                print(f"WARNING: Google News failed for [{segment}] {keyword}: {exc}", file=sys.stderr)
    return collected


def collect_domestic_google_news() -> list[Article]:
    return collect_google_news_by_keywords(DOMESTIC_KEYWORDS, DOMESTIC_GOOGLE_ENDPOINTS, "domestic")


def collect_global_google_news() -> list[Article]:
    return collect_google_news_by_keywords(GLOBAL_KEYWORDS, GLOBAL_GOOGLE_ENDPOINTS, "global")


def collect_direct_rss() -> list[Article]:
    collected: list[Article] = []
    for feed in DIRECT_RSS_FEEDS:
        try:
            print(f"Direct RSS: {feed['source_name']}")
            xml = fetch_url(feed["url"])
            collected.extend(parse_xml_feed(
                xml, feed["url"], feed["source_name"],
                language=feed.get("language", ""),
                source_country=feed.get("source_country", ""),
                method="direct_rss",
                segment="global",
            ))
            time.sleep(0.5)
        except Exception as exc:
            print(f"WARNING: direct RSS failed for {feed['source_name']}: {exc}", file=sys.stderr)
    return collected


def collect_rss_index_pages() -> list[Article]:
    collected: list[Article] = []
    for page in RSS_INDEX_PAGES:
        try:
            print(f"RSS index: {page['source_name']}")
            html_bytes = fetch_url(page["url"])
            # 페이지가 XML인 경우
            try:
                collected.extend(parse_xml_feed(
                    html_bytes, page["url"], page["source_name"],
                    language=page.get("language", ""),
                    source_country=page.get("source_country", ""),
                    method="rss_index_direct",
                    segment="global",
                ))
            except Exception:
                pass

            feed_links = parse_rss_index_links(html_bytes, page["url"])
            for link in feed_links[:4]:
                try:
                    xml = fetch_url(link)
                    collected.extend(parse_xml_feed(
                        xml, link, page["source_name"],
                        language=page.get("language", ""),
                        source_country=page.get("source_country", ""),
                        method="rss_index_discovered",
                        segment="global",
                    ))
                    time.sleep(0.3)
                except Exception:
                    pass
            time.sleep(0.5)
        except Exception as exc:
            print(f"WARNING: RSS index failed for {page['source_name']}: {exc}", file=sys.stderr)
    return collected


def collect_site_google_news() -> list[Article]:
    collected: list[Article] = []
    for source in SITE_SPECIFIC_GOOGLE_SOURCES:
        for keyword in ["Bismayah", "\"Hanwha Iraq\"", "\"National Investment Commission Iraq\""]:
            query = f"site:{source['domain']} {keyword}"
            endpoint = GLOBAL_GOOGLE_ENDPOINTS[0]
            url = endpoint.format(query=quote_plus(query), days=FETCH_DAYS)
            try:
                print(f"Google site search: {source['source_name']} / {keyword}")
                xml = fetch_url(url)
                articles = parse_xml_feed(
                    xml, url, source["source_name"],
                    source_country=source.get("source_country", ""),
                    method="google_news_site",
                    segment="global",
                )
                for a in articles:
                    if a.source == "Google News":
                        a.source = source["source_name"]
                collected.extend(articles)
                time.sleep(0.4)
            except Exception as exc:
                print(f"WARNING: Google site search failed for {source['source_name']}: {exc}", file=sys.stderr)
    return collected


def load_existing() -> list[dict]:
    if not DATA_PATH.exists():
        return []
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        articles = data.get("articles", [])
        for a in articles:
            a["segment"] = a.get("segment") or "global"
        return articles
    except Exception:
        return []


def normalize_title_for_dedupe(title: str) -> str:
    title = clean_text(title).lower()
    if " - " in title:
        title = title.rsplit(" - ", 1)[0]
    title = re.sub(r"[^a-z0-9가-힣\u0600-\u06FF]+", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title[:160]


def canonical_url_for_dedupe(url: str) -> str:
    url = (url or "").strip().lower()
    if not url:
        return ""
    parsed = urlparse(url)
    host = parsed.netloc.replace("www.", "")
    path = re.sub(r"/+$", "", parsed.path)
    if "news.google.com" in host:
        return ""
    return f"{host}{path}"


def enforce_importance_policy(article: dict) -> dict:
    text = " ".join([
        str(article.get("title_original") or ""),
        str(article.get("title_ko") or ""),
        str(article.get("summary_ko") or ""),
        " ".join(str(x) for x in article.get("keywords", []) if x),
    ])
    deterministic = score_importance(text, matched_keywords(text))
    try:
        ai_score = int(article.get("importance_score") or deterministic)
    except Exception:
        ai_score = deterministic
    level = direct_project_level(text)
    article["importance_score"] = max(deterministic, ai_score) if level == 4 else min(ai_score, deterministic)
    return article


def dedupe(articles: Iterable[dict]) -> list[dict]:
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    out: list[dict] = []
    for article in articles:
        segment = article.get("segment") or "global"
        url_key_base = canonical_url_for_dedupe(article.get("url") or "")
        url_key = f"{segment}|{url_key_base}" if url_key_base else ""
        title_key = normalize_title_for_dedupe(article.get("title_original") or article.get("title_ko") or "")
        source_key = clean_text(article.get("source") or "").lower()
        title_source_key = f"{segment}|{title_key}|{source_key}" if len(title_key) >= 18 else ""

        if url_key and url_key in seen_urls:
            continue
        if title_source_key and title_source_key in seen_titles:
            continue

        if url_key:
            seen_urls.add(url_key)
        if title_source_key:
            seen_titles.add(title_source_key)

        out.append(enforce_importance_policy(article))

    out.sort(key=lambda a: (a.get("published_date") or a.get("date_found") or ""), reverse=True)
    return out[:1200]


def is_noise_article_dict(article: dict) -> bool:
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


def final_article_filter(articles: list[dict]) -> list[dict]:
    cleaned = []
    for article in articles:
        segment = article.get("segment") or "global"

        if segment == "domestic" and not is_domestic_original_article(
            article.get("title_original") or "",
            article.get("summary_ko") or "",
            article.get("source") or "",
            article.get("url") or "",
            article.get("language") or "",
        ):
            # 기존 news.json에 잘못 domestic으로 들어간 이라크/외신 기사는 global로 되돌립니다.
            segment = "global"

        article["segment"] = segment

        if is_noise_article_dict(article):
            continue

        text = " ".join([
            str(article.get("title_original") or ""),
            str(article.get("title_ko") or ""),
            str(article.get("summary_ko") or ""),
            str(article.get("source") or ""),
            " ".join(str(x) for x in article.get("keywords", []) if x),
        ])

        if not is_relevant(text, segment):
            continue

        if not is_recent(article.get("published_date") or article.get("date_found")):
            continue

        cleaned.append(enforce_importance_policy(article))
    return cleaned


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

    def priority(a: dict):
        text = " ".join([
            str(a.get("title_original") or ""),
            str(a.get("summary_ko") or ""),
            " ".join(str(x) for x in a.get("keywords", []) if x),
        ])
        dt = parse_iso(str(a.get("published_date") or a.get("date_found") or ""))
        return (
            1 if (a.get("segment") == "domestic") else 0,
            direct_project_level(text),
            int(a.get("importance_score") or 0),
            dt.timestamp() if dt else 0,
        )

    targets = sorted(targets, key=priority, reverse=True)[:MAX_TRANSLATIONS_PER_RUN]
    if not targets:
        print("No articles require Korean translation.")
        return articles

    print(f"Translating {len(targets)} articles with OpenAI model: {OPENAI_MODEL}")

    by_id = {a["id"]: a for a in articles if a.get("id")}

    system_prompt = (
        "You are a Korean business intelligence analyst for an Iraq construction project. "
        "Translate and rewrite news titles and short descriptions into clear Korean. "
        "Preserve proper nouns such as Bismayah, Hanwha, NIC, Iraq, Baghdad. "
        "Return only valid JSON."
    )

    for batch in chunks(targets, TRANSLATION_BATCH_SIZE):
        payload = {
            "model": OPENAI_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps({
                    "task": "Return Korean dashboard fields for each article.",
                    "rules": [
                        "title_ko must be natural Korean.",
                        "summary_ko must be 1-2 Korean sentences.",
                        "importance_score: 90-100 only for direct Bismayah/BNCP issues. 75-88 for Hanwha Iraq, NIC, Iraq housing/new city. 60-74 for general Iraq construction/investment policy. 45-59 for indirect political risk. Below 45 if weakly relevant.",
                        "category must be one of 정부/정책, 건설/인프라, 계약/법무, 정치/리스크, 금융/경제, 일반.",
                        "country should be Iraq, Korea, or Unclassified.",
                        "keywords should be 3-8 concise strings."
                    ],
                    "articles": [{
                        "id": a.get("id"),
                        "segment": a.get("segment"),
                        "source": a.get("source"),
                        "published_date": a.get("published_date"),
                        "title_original": a.get("title_original"),
                        "summary_source": a.get("summary_ko"),
                        "url": a.get("url"),
                        "language": a.get("language"),
                        "current_country": a.get("country"),
                        "current_organization": a.get("organization"),
                        "current_keywords": a.get("keywords"),
                    } for a in batch],
                    "return_format": {
                        "items": [{
                            "id": "same id",
                            "title_ko": "Korean title",
                            "summary_ko": "Korean summary",
                            "country": "Iraq",
                            "organization": "BNCP",
                            "keywords": ["Bismayah", "Iraq"],
                            "importance_score": 70,
                            "category": "건설/인프라"
                        }]
                    }
                }, ensure_ascii=False)},
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
            for item in data.get("items", []):
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
                enforce_importance_policy(article)
            time.sleep(OPENAI_SLEEP_SECONDS)
        except Exception as exc:
            print(f"WARNING: translation batch failed: {exc}", file=sys.stderr)

    return articles


def main() -> int:
    existing = final_article_filter(load_existing())

    collected: list[Article] = []
    collected.extend(collect_domestic_google_news())
    collected.extend(collect_global_google_news())

    if ENABLE_DIRECT_RSS:
        collected.extend(collect_direct_rss())
    else:
        print("Skipped direct RSS feeds.")

    if ENABLE_RSS_INDEX:
        collected.extend(collect_rss_index_pages())
    else:
        print("Skipped RSS index pages.")

    if ENABLE_SITE_GOOGLE_SEARCH:
        collected.extend(collect_site_google_news())
    else:
        print("Skipped site-specific Google News search.")

    collected_dicts = [asdict(a) for a in collected]
    merged = dedupe(collected_dicts + existing)
    merged = final_article_filter(merged)
    merged = translate_articles_with_openai(merged)
    merged = final_article_filter(merged)

    def section_sort_key(a: dict):
        dt = parse_iso(str(a.get("published_date") or a.get("date_found") or ""))
        return (int(a.get("importance_score") or 0), dt.timestamp() if dt else 0)

    sections = {
        "domestic": sorted(
            [a for a in merged if (a.get("segment") or "global") == "domestic"],
            key=section_sort_key,
            reverse=True,
        ),
        "global": sorted(
            [a for a in merged if (a.get("segment") or "global") == "global"],
            key=section_sort_key,
            reverse=True,
        ),
        "sns": [],
        "com": [],
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(
        json.dumps({
            "last_updated": now_iso(),
            "articles": merged,
            "sections": sections,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Collected {len(collected_dicts)} candidate articles.")
    print(f"Saved {len(merged)} articles to {DATA_PATH}")
    print(f"Domestic: {len(sections['domestic'])} / Global: {len(sections['global'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())