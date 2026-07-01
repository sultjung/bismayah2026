#!/usr/bin/env python3
"""
COM Activities Compact Collector

- cabinet.iq API에서 COM 주요활동 최신 날짜별 목록 수집
- 상세 본문을 부처/기관별로 분리
- OpenAI API Key가 있으면 한국어 요약 생성
- 화면용 compact JSON만 저장
- 기존 국내/글로벌 뉴스 수집 스크립트(fetch_news.py)는 건드리지 않음
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_PATH = DATA_DIR / "com-activities.json"
DEBUG_PATH = DATA_DIR / "com-debug.json"

COM_SITE_CATEGORY_URL = "https://cabinet.iq/ar/category/activities"
COM_API_BASE = os.getenv("COM_API_BASE", "https://api.cabinet.iq").rstrip("/")
COM_MAX_PAGES = int(os.getenv("COM_MAX_PAGES", "5"))
COM_MAX_SECTIONS_PER_PAGE = int(os.getenv("COM_MAX_SECTIONS_PER_PAGE", "22"))
COM_KEEP_RAW = os.getenv("COM_KEEP_RAW", "false").lower() == "true"

OPENAI_API_KEY = re.sub(r"\s+", "", os.getenv("OPENAI_API_KEY", ""))
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_SLEEP_SECONDS = float(os.getenv("OPENAI_SLEEP_SECONDS", "3"))

USER_AGENT = "Mozilla/5.0 BismayahCOMActivities/3.0"

HEADING_WORDS = [
    "وزارة", "هيئة", "الهيئة", "ديوان", "محافظة", "مجلس",
    "جهاز", "الأمانة", "الامانة", "البنك", "مصرف", "مؤسسة"
]

PRIORITY_TERMS = {
    "direct": ["بسماية", "bismayah", "bismaya", "bncp", "هانوا"],
    "nic": ["الهيئة الوطنية للاستثمار", "هيئة الاستثمار الوطنية", "national investment commission", " nic "],
    "housing": ["المدن السكنية", "مدينة سكنية", "أراض سكنية", "اراض سكنية", "أرض سكنية", "ارض سكنية", "قطع أراض", "قطع اراض", "توزيع قطع", "الجمعيات السكنية", "السكني", "السكنية", "إسكان", "اسكان"],
    "infra": ["إعمار", "اعمار", "البنى التحتية", "بنى تحتية", "مشروع", "مشاريع", "الطرق", "طرق", "جسور", "مجاري", "الصرف الصحي", "ماء", "تبليط", "كهرباء", "البلديات"],
    "contract": ["عقد", "العقود", "إحالة", "احالة", "مذكرة تفاهم", "استثمار", "تمويل", "تخصيص", "مصادقة"],
    "risk": ["فساد", "نزاهة", "تحقيق", "استرداد الأموال", "القضاء", "إيقاف", "ايقاف", "مخالفة"]
}

MINISTRY_MAP = [
    ("وزارة الإعمار", "재건주택부"),
    ("وزارة الاعمار", "재건주택부"),
    ("وزارة المالية", "재무부"),
    ("وزارة العدل", "법무부"),
    ("وزارة الدفاع", "국방부"),
    ("وزارة الداخلية", "내무부"),
    ("وزارة الخارجية", "외교부"),
    ("وزارة التخطيط", "기획부"),
    ("وزارة التربية", "교육부"),
    ("وزارة التعليم العالي", "고등교육부"),
    ("وزارة الصحة", "보건부"),
    ("وزارة النفط", "석유부"),
    ("وزارة الكهرباء", "전기부"),
    ("وزارة التجارة", "상업부"),
    ("وزارة الزراعة", "농업부"),
    ("وزارة الموارد المائية", "수자원부"),
    ("وزارة الصناعة", "산업광물부"),
    ("وزارة العمل", "노동사회부"),
    ("وزارة البيئة", "환경부"),
    ("وزارة النقل", "교통부"),
    ("وزارة الاتصالات", "통신부"),
    ("وزارة الهجرة", "이주난민부"),
    ("وزارة الشباب", "청년체육부"),
    ("وزارة الثقافة", "문화관광유물부"),
    ("هيئة الحشد الشعبي", "인민동원위원회"),
    ("هيئة الاوراق المالية", "증권위원회"),
    ("هيئة الأوراق المالية", "증권위원회"),
    ("هيئة المنافذ الحدودية", "국경출입국위원회"),
    ("هيئة دعاوى الملكية", "재산청구위원회"),
    ("هيئة النزاهة", "청렴위원회"),
    ("ديوان الوقف السني", "수니파 종교재단청"),
    ("ديوان الوقف الشيعي", "시아파 종교재단청"),
    ("ديوان الرقابة المالية", "연방회계감사원"),
    ("مجلس الخدمة", "연방공무원위원회"),
    ("محافظة بغداد", "바그다드주"),
    ("محافظة البصرة", "바스라주"),
    ("محافظة نينوى", "니네와주"),
    ("محافظة الأنبار", "안바르주"),
    ("محافظة الانبار", "안바르주"),
    ("محافظة النجف", "나자프주"),
    ("محافظة كربلاء", "카르발라주"),
    ("محافظة المثنى", "무탄나주"),
    ("محافظة الديوانية", "디와니야주"),
    ("محافظة واسط", "와시트주"),
    ("محافظة بابل", "바빌주"),
    ("محافظة ذي قار", "디카르주"),
    ("محافظة صلاح الدين", "살라딘주"),
    ("محافظة ديالى", "디얄라주"),
    ("محافظة كركوك", "키르쿠크주"),
    ("محافظة ميسان", "미산주"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(str(value))
    value = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", value, flags=re.S)
    value = re.sub(r"<\s*br\s*/?\s*>", "\n", value, flags=re.I)
    value = re.sub(r"</\s*(p|div|li|h[1-6]|tr|section|article)\s*>", "\n", value, flags=re.I)
    value = re.sub(r"<script.*?</script>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<style.*?</style>", " ", value, flags=re.S | re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r"\n\s+", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalize_ar_digits(text: str) -> str:
    trans = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
    return str(text or "").translate(trans)


def norm(text: str | None) -> str:
    text = clean_text(text).lower()
    text = normalize_ar_digits(text)
    text = re.sub(r"[·ㆍ|,，.。:：;؛/\\()[\]{}<>「」『』【】\-–—_]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_bytes(url: str, timeout: int = 25) -> bytes:
    req = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(req, timeout=timeout) as res:
        return res.read()


def fetch_json(url: str, timeout: int = 30) -> dict | list:
    raw = fetch_bytes(url, timeout=timeout)
    return json.loads(raw.decode("utf-8", errors="ignore"))


def post_json(url: str, payload: dict, headers: dict, timeout: int = 120) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def walk_json(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk_json(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from walk_json(item)


def all_strings(obj) -> list[str]:
    out = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            out.extend(all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(all_strings(v))
    return out


def first_string_field(obj: dict, candidates: list[str]) -> str:
    lower_map = {str(k).lower(): k for k in obj.keys()}
    for c in candidates:
        key = lower_map.get(c.lower())
        if key is not None and isinstance(obj.get(key), str) and obj.get(key).strip():
            return obj.get(key).strip()
    return ""


def first_slug(obj: dict) -> str:
    for k, v in obj.items():
        key = str(k).lower()
        if isinstance(v, str) and "slug" in key and len(v.strip()) >= 5:
            return v.strip()
    # URL에서 /ar/category/{slug}/{slug} 형태 추출
    for v in obj.values():
        if isinstance(v, str) and "/ar/category/" in v:
            m = re.search(r"/ar/category/([^/?#]+)/", v)
            if m:
                return html.unescape(m.group(1)).strip()
    return ""


def parse_activity_date(text: str) -> str:
    raw = normalize_ar_digits(clean_text(text))

    for pattern in [
        r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})",
        r"(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(20\d{2})",
    ]:
        m = re.search(pattern, raw)
        if m:
            nums = list(map(int, m.groups()))
            if nums[0] > 1900:
                year, month, day = nums
            else:
                day, month, year = nums
            try:
                return datetime(year, month, day, tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
            except Exception:
                pass

    month_map = {
        "كانون الثاني": 1, "يناير": 1,
        "شباط": 2, "فبراير": 2,
        "آذار": 3, "اذار": 3, "مارس": 3,
        "نيسان": 4, "ابريل": 4, "أبريل": 4,
        "أيار": 5, "ايار": 5, "مايو": 5,
        "حزيران": 6, "يونيو": 6,
        "تموز": 7, "يوليو": 7,
        "آب": 8, "اب": 8, "أغسطس": 8,
        "أيلول": 9, "ايلول": 9, "سبتمبر": 9,
        "تشرين الأول": 10, "تشرين الاول": 10, "أكتوبر": 10,
        "تشرين الثاني": 11, "نوفمبر": 11,
        "كانون الأول": 12, "كانون الاول": 12, "ديسمبر": 12,
    }
    for name, month in month_map.items():
        m = re.search(rf"(\d{{1,2}})\s+{re.escape(name)}\s+(20\d{{2}})", raw)
        if m:
            day, year = int(m.group(1)), int(m.group(2))
            try:
                return datetime(year, month, day, tzinfo=timezone.utc).astimezone().isoformat(timespec="seconds")
            except Exception:
                pass

    return now_iso()


def format_date(value: str) -> str:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return value[:10] if value else ""


def make_id(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]


def collect_activity_list() -> tuple[list[dict], dict]:
    url = f"{COM_API_BASE}/api/app/dynamic-content/by-filters?Language=ar&CategorySlug=activities&MaxResultCount={COM_MAX_PAGES}"
    debug = {
        "list_api_url": url,
        "list_method": "api",
        "api_candidates": 0,
        "warnings": [],
    }

    try:
        data = fetch_json(url)
    except Exception as exc:
        debug["warnings"].append(f"list_api_failed: {exc}")
        return [], debug

    candidates = []
    seen = set()

    for obj in walk_json(data):
        blob = clean_text(" ".join(all_strings(obj)))
        if "تقرير النشاطات الحكومية" not in blob and "النشاط الحكومي اليومي" not in blob:
            continue

        slug = first_slug(obj)
        if not slug:
            continue

        title = first_string_field(obj, [
            "title", "name", "displayName", "subject", "caption",
            "titleAr", "title_AR", "heading"
        ])

        if not title:
            m = re.search(r"(تقرير النشاطات الحكومية[^0-9\n\r]*(?:\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*20\d{2}|20\d{2}[-/]\d{1,2}[-/]\d{1,2})?)", blob)
            title = m.group(1).strip() if m else "تقرير النشاطات الحكومية"

        date_text = first_string_field(obj, [
            "publishDate", "publishedDate", "creationTime", "date", "createdAt", "created"
        ]) or blob

        published = parse_activity_date(f"{title} {date_text}")
        key = slug
        if key in seen:
            continue
        seen.add(key)

        candidates.append({
            "title_original": clean_text(title),
            "slug": slug,
            "published_date": published,
            "url": f"https://cabinet.iq/ar/category/{slug}/{slug}",
            "api_detail_url": f"{COM_API_BASE}/api/app/dynamic-content/by-filters?Language=ar&DynamicContentSlug={quote(slug, safe='!')}",
        })

    candidates.sort(key=lambda x: x.get("published_date", ""), reverse=True)
    candidates = candidates[:COM_MAX_PAGES]
    debug["api_candidates"] = len(candidates)

    return candidates, debug


def extract_detail_content(detail_json: dict | list) -> tuple[str, str, str]:
    title = ""
    date_text = ""
    content = ""

    # 제목/날짜 후보
    for obj in walk_json(detail_json):
        if not title:
            title = first_string_field(obj, [
                "title", "name", "displayName", "subject", "caption",
                "titleAr", "title_AR", "heading"
            ])
        if not date_text:
            date_text = first_string_field(obj, [
                "publishDate", "publishedDate", "creationTime", "date", "createdAt", "created"
            ])

    # 본문 후보: 가장 긴 아랍어 텍스트/HTML
    strings = all_strings(detail_json)
    candidates = []
    for s in strings:
        cleaned = clean_text(s)
        if len(cleaned) < 200:
            continue
        if not re.search(r"[\u0600-\u06FF]", cleaned):
            continue
        score = len(cleaned)
        if "وزارة" in cleaned or "محافظة" in cleaned or "هيئة" in cleaned:
            score += 2000
        if "تقرير النشاطات الحكومية" in cleaned:
            score += 500
        candidates.append((score, cleaned))

    if candidates:
        candidates.sort(reverse=True, key=lambda x: x[0])
        content = candidates[0][1]

    return clean_text(title), date_text, clean_text(content)


def get_activity_detail(item: dict) -> tuple[str, str, str, dict]:
    debug = {
        "slug": item.get("slug"),
        "api_detail_url": item.get("api_detail_url"),
        "method": "api",
        "warnings": [],
    }

    try:
        data = fetch_json(item["api_detail_url"])
        title, date_text, content = extract_detail_content(data)
        if not content or len(content) < 300:
            debug["warnings"].append("api_content_too_short")
        else:
            published = parse_activity_date(f"{title} {date_text} {item.get('published_date','')}")
            return title or item.get("title_original", ""), published, content, debug
    except Exception as exc:
        debug["warnings"].append(f"detail_api_failed: {exc}")

    # 최후 fallback: 공개 HTML 직접 요청
    try:
        html_text = fetch_bytes(item["url"]).decode("utf-8", errors="ignore")
        content = clean_text(html_text)
        debug["method"] = "html_fallback"
        return item.get("title_original", ""), item.get("published_date", now_iso()), content, debug
    except Exception as exc:
        debug["warnings"].append(f"html_fallback_failed: {exc}")
        return item.get("title_original", ""), item.get("published_date", now_iso()), "", debug


def heading_regex():
    words = "|".join(re.escape(w) for w in HEADING_WORDS)
    # 제목 뒤에 번호/불릿이 붙는 경우를 기준으로 잡음: وزارة الكهرباء 1. ...
    return re.compile(
        rf"(?<![\u0600-\u06FF])((?:{words})\s+[^\n\r\d٠-٩]{{2,110}}?)(?=\s*(?:\d+|[٠-٩]+)\s*[\.\-]|[\n\r]|$)",
        flags=re.I,
    )


def split_sections(text: str) -> list[dict]:
    text = clean_text(text)
    text = re.sub(r"(اخر الاخبار|قرارات مجلس الوزراء|دوائر الأمانة العامة|نشرة النشاط الحكومي|اعلانات|ارشيف)", " ", text)
    text = re.sub(r"(موقع رئاسة الوزراء|موقع رئاسة الجمهورية|موقع رئاسة البرلمان|بوابة أور|حكومة المواطن الالكترونية|كل الحقوق محفوظة).*", " ", text, flags=re.S)
    text = clean_text(text)

    matches = list(heading_regex().finditer(text))
    sections = []

    for idx, m in enumerate(matches):
        start = m.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        block = clean_text(text[start:end])
        ministry = clean_text(m.group(1))

        # ministry 안에 번호가 섞였으면 정리
        ministry = re.sub(r"\s*(?:\d+|[٠-٩]+)\s*[\.\-].*$", "", ministry).strip()
        raw = clean_text(block[len(m.group(1)):])

        if len(raw) < 80:
            continue
        if "كل الحقوق محفوظة" in raw:
            continue

        sections.append({
            "ministry_ar": ministry,
            "raw_ar": raw[:6000],
            "raw_chars": len(raw),
        })

    # fallback: 섹션 분리 실패 시 전체 본문 저장
    if not sections and len(text) > 200:
        sections.append({
            "ministry_ar": "مجلس الوزراء",
            "raw_ar": text[:6000],
            "raw_chars": len(text),
        })

    # 중복 제거
    out = []
    seen = set()
    for sec in sections:
        key = norm(sec["ministry_ar"]) + "|" + norm(sec["raw_ar"])[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append(sec)

    return out[:COM_MAX_SECTIONS_PER_PAGE]


def ministry_ko(ministry_ar: str) -> str:
    target = norm(ministry_ar)
    for ar, ko in MINISTRY_MAP:
        if norm(ar) in target:
            return ko
    if target.startswith("محافظة "):
        name = clean_text(ministry_ar).replace("محافظة", "").strip()
        return f"{name}주"
    return clean_text(ministry_ar)


def keyword_hits(text: str) -> list[str]:
    t = norm(text)
    hits = []
    for group_terms in PRIORITY_TERMS.values():
        for term in group_terms:
            if norm(term) and norm(term) in t:
                hits.append(term)
    return sorted(set(hits))


def priority_score(text: str) -> int:
    t = norm(text)
    score = 50

    if any(norm(x) in t for x in PRIORITY_TERMS["direct"]):
        return 100
    if any(norm(x) in t for x in PRIORITY_TERMS["nic"]):
        score = max(score, 92)
    if any(norm(x) in t for x in PRIORITY_TERMS["housing"]):
        score = max(score, 86)
    if any(norm(x) in t for x in PRIORITY_TERMS["infra"]):
        score = max(score, 76)
    if any(norm(x) in t for x in PRIORITY_TERMS["contract"]):
        score = max(score, 70)
    if any(norm(x) in t for x in PRIORITY_TERMS["risk"]):
        score = max(score, 62)

    # 키워드 개수에 따라 소폭 가산
    score += min(8, len(keyword_hits(text)) * 2)
    return max(1, min(100, score))


def infer_category(text: str) -> str:
    t = norm(text)
    if any(norm(x) in t for x in PRIORITY_TERMS["direct"] + PRIORITY_TERMS["housing"]):
        return "주택/신도시"
    if any(norm(x) in t for x in ["مجاري", "طرق", "جسور", "كهرباء", "ماء", "البنى التحتية", "تبليط"]):
        return "건설/인프라"
    if any(norm(x) in t for x in ["عقد", "إحالة", "احالة", "مذكرة تفاهم"]):
        return "계약/법무"
    if any(norm(x) in t for x in ["استثمار", "تمويل", "تخصيص"]):
        return "투자/재정"
    if any(norm(x) in t for x in PRIORITY_TERMS["risk"]):
        return "리스크/반부패"
    return "정부활동"


def fallback_summary(sec: dict) -> str:
    return clean_text(sec.get("raw_ar", ""))[:260]


def enrich_sections_with_openai(page_title: str, page_date: str, sections: list[dict]) -> tuple[str, list[dict]]:
    prepared = []
    for idx, sec in enumerate(sections, start=1):
        sec["id"] = f"s{idx:02d}"
        sec["ministry_ko"] = ministry_ko(sec["ministry_ar"])
        blob = f"{sec['ministry_ar']} {sec['raw_ar']}"
        sec["keyword_hits"] = keyword_hits(blob)
        sec["priority_score"] = priority_score(blob)
        sec["category"] = infer_category(blob)
        sec["summary_ko"] = fallback_summary(sec)

        prepared.append({
            "id": sec["id"],
            "ministry_ar": sec["ministry_ar"],
            "ministry_ko": sec["ministry_ko"],
            "category": sec["category"],
            "priority_score": sec["priority_score"],
            "raw_ar": sec["raw_ar"][:1800],
        })

    if not OPENAI_API_KEY or not prepared:
        return "OpenAI 요약 없이 COM 원문 기준으로 부처별 항목을 정리했습니다.", sections

    payload = {
        "model": OPENAI_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You summarize Iraqi Council of Ministers daily activity reports for a Korean dashboard. "
                    "Return only valid JSON. Do not invent facts. Preserve IDs exactly."
                )
            },
            {
                "role": "user",
                "content": json.dumps({
                    "task": "부처/기관별 주요활동을 한국어로 요약한다.",
                    "rules": [
                        "각 item의 id를 반드시 그대로 유지한다.",
                        "ministry_ko는 제공된 값을 그대로 사용하거나 명백한 오역만 정정한다.",
                        "summary_ko는 해당 raw_ar 안의 사실만 사용해서 한국어 1문장으로 작성한다.",
                        "건설, 주택, 신도시, 인프라, 계약, 투자, NIC 관련 내용은 더 구체적으로 쓴다.",
                        "불필요한 수식어 없이 실무자가 빠르게 읽을 수 있게 쓴다.",
                    ],
                    "page_title_ar": page_title,
                    "published_date": page_date,
                    "sections": prepared,
                    "return_format": {
                        "day_summary_ko": "그날 전체 활동 요약 1~2문장",
                        "items": [
                            {
                                "id": "s01",
                                "ministry_ko": "재무부",
                                "summary_ko": "한국어 요약",
                                "category": "정부활동",
                                "priority_score": 70
                            }
                        ]
                    }
                }, ensure_ascii=False)
            }
        ],
        "response_format": {"type": "json_object"},
    }

    try:
        result = post_json(
            "https://api.openai.com/v1/chat/completions",
            payload,
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        )
        data = json.loads(result["choices"][0]["message"]["content"])
        by_id = {str(item.get("id")): item for item in data.get("items", []) if item.get("id")}

        for sec in sections:
            item = by_id.get(sec["id"])
            if not item:
                continue
            if item.get("ministry_ko"):
                sec["ministry_ko"] = clean_text(item["ministry_ko"])
            if item.get("summary_ko"):
                sec["summary_ko"] = clean_text(item["summary_ko"])[:500]
            if item.get("category"):
                sec["category"] = clean_text(item["category"])
            try:
                ai_score = int(item.get("priority_score", sec["priority_score"]))
                sec["priority_score"] = max(1, min(100, ai_score))
            except Exception:
                pass

        day_summary = clean_text(data.get("day_summary_ko") or "")
        return day_summary, sections

    except Exception as exc:
        print(f"WARNING: OpenAI COM summary failed: {exc}", file=sys.stderr)
        time.sleep(OPENAI_SLEEP_SECONDS)
        return "COM 주요활동을 자동 수집했으며, 일부 요약은 원문 기반으로 표시됩니다.", sections


def compact_section(sec: dict) -> dict:
    out = {
        "ministry_ar": clean_text(sec.get("ministry_ar", "")),
        "ministry_ko": clean_text(sec.get("ministry_ko", "")),
        "summary_ko": clean_text(sec.get("summary_ko", "")),
        "category": clean_text(sec.get("category", "정부활동")),
        "priority_score": int(sec.get("priority_score", 50)),
        "keyword_hits": sec.get("keyword_hits", [])[:10],
    }
    if COM_KEEP_RAW:
        out["raw_ar"] = clean_text(sec.get("raw_ar", ""))[:1500]
    return out


def build_article(item: dict, title: str, published: str, sections: list[dict], day_summary: str) -> dict:
    ministries = [compact_section(sec) for sec in sections]
    max_score = max([m["priority_score"] for m in ministries] or [50])
    date_label = format_date(published)

    return {
        "id": make_id("com", title or item.get("title_original", ""), item.get("url", "")),
        "date_found": now_iso(),
        "published_date": published,
        "source": "الأمانة العامة لمجلس الوزراء",
        "title_original": title or item.get("title_original", "تقرير النشاطات الحكومية"),
        "title_ko": f"COM 주요활동: {date_label}",
        "summary_ko": day_summary or f"{date_label} 이라크 정부 주요활동 {len(ministries)}개 부처/기관 항목을 수집했습니다.",
        "url": item.get("url", ""),
        "language": "ar",
        "country": "Iraq",
        "organization": "Council of Ministers",
        "keywords": ["COM", "이라크 내각", "정부활동"],
        "importance_score": max_score,
        "category": "정부/정책",
        "source_country": "Iraq",
        "collection_method": "com_activities_api_compact_v3",
        "segment": "com",
        "ministries": ministries,
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    items, list_debug = collect_activity_list()
    articles = []
    page_debug = []

    for item in items:
        title, published, body_text, detail_debug = get_activity_detail(item)
        if not body_text:
            page_debug.append({
                "url": item.get("url"),
                "title": item.get("title_original"),
                "section_count": 0,
                "warnings": detail_debug.get("warnings", []),
            })
            continue

        sections = split_sections(body_text)
        day_summary, sections = enrich_sections_with_openai(title or item.get("title_original", ""), published, sections)

        article = build_article(item, title or item.get("title_original", ""), published, sections, day_summary)
        articles.append(article)

        page_debug.append({
            "url": item.get("url"),
            "api_detail_url": item.get("api_detail_url"),
            "title": article["title_original"],
            "published_date": article["published_date"],
            "method": detail_debug.get("method"),
            "body_chars": len(body_text),
            "section_count": len(sections),
            "top_sections": [
                {
                    "ministry_ko": s.get("ministry_ko"),
                    "ministry_ar": s.get("ministry_ar"),
                    "priority_score": s.get("priority_score"),
                    "category": s.get("category"),
                }
                for s in sorted(sections, key=lambda x: int(x.get("priority_score", 50)), reverse=True)[:5]
            ],
            "warnings": detail_debug.get("warnings", []),
        })

        time.sleep(0.4)

    articles.sort(key=lambda a: a.get("published_date", ""), reverse=True)

    output = {
        "generated_at": now_iso(),
        "source_url": COM_SITE_CATEGORY_URL,
        "count": len(articles),
        "articles": articles,
        "sections": {
            "com": articles
        },
    }

    debug = {
        "generated_at": now_iso(),
        "source_url": COM_SITE_CATEGORY_URL,
        "list_debug": list_debug,
        "list_count": len(items),
        "articles_count": len(articles),
        "pages": page_debug,
    }

    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    DEBUG_PATH.write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Saved {OUTPUT_PATH} ({len(articles)} articles)")
    print(f"Saved {DEBUG_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
