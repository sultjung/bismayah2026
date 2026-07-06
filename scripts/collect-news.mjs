#!/usr/bin/env node
/**
 * Bismayah / Hanwha Iraq News Collector v9
 *
 * Output:
 *   data/domestic-news.json
 *   data/overseas-news.json
 *   data/sns-news.json
 *   data/com-news.json
 *   data/news-index.json
 *
 * Purpose:
 *   - 비스마야 / 한화 이라크 / BNCP 직접 관련 뉴스는 최우선 수집
 *   - 이라크 주택사업, 주택정책, 주택난, 신도시, 건설, 인프라, 투자, 수주 흐름도 수집
 *   - 단순히 아랍어 기사라는 이유만으로는 통과시키지 않음
 *   - 스포츠, 베팅, 마약, 테러, 일반 범죄성 잡음은 제외
 *   - 글로벌 뉴스는 OpenAI로 한국어 번역/요약
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 7);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 10);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 120);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================
// 1. 국내 언론 검색 설정
// ============================================================

const DOMESTIC_KEYWORDS = [
  "비스마야",
  "\"한화\" \"이라크\"",
  "\"이라크\" \"사업\"",
  "\"이라크\" \"건설\"",
  "\"이라크\" \"투자\"",
  "\"이라크\" \"주택\"",
  "\"이라크\" \"신도시\"",
  "\"한화\" \"건설\"",
  "\"한화 건설부문\"",
  "\"한화\" \"인프라\"",
  "\"한화\" \"플랜트\""
];

const DOMESTIC_MIN_SCORE = 15;

const DOMESTIC_PRIORITY_RULES = [
  { terms: ["비스마야"], score: 100, label: "비스마야" },
  { terms: ["bismayah"], score: 100, label: "Bismayah" },
  { terms: ["한화", "이라크"], score: 90, label: "한화+이라크" },
  { terms: ["한화건설", "이라크"], score: 90, label: "한화건설+이라크" },
  { terms: ["이라크", "비스마야"], score: 90, label: "이라크+비스마야" },
  { terms: ["이라크", "신도시"], score: 75, label: "이라크+신도시" },
  { terms: ["이라크", "주택"], score: 70, label: "이라크+주택" },
  { terms: ["이라크", "사업"], score: 60, label: "이라크+사업" },
  { terms: ["이라크", "건설"], score: 60, label: "이라크+건설" },
  { terms: ["이라크", "투자"], score: 55, label: "이라크+투자" },
  { terms: ["이라크", "인프라"], score: 55, label: "이라크+인프라" }
];

const DOMESTIC_GENERAL_RULES = [
  { terms: ["한화", "건설"], score: 35, label: "한화+건설" },
  { terms: ["한화건설"], score: 35, label: "한화건설" },
  { terms: ["한화", "건설부문"], score: 40, label: "한화+건설부문" },
  { terms: ["한화", "인프라"], score: 25, label: "한화+인프라" },
  { terms: ["한화", "플랜트"], score: 25, label: "한화+플랜트" },
  { terms: ["한화", "주택"], score: 20, label: "한화+주택" },
  { terms: ["한화", "부동산"], score: 20, label: "한화+부동산" },
  { terms: ["이라크"], score: 18, label: "이라크 단독" }
];

const DOMESTIC_EXCLUDE_RULES = [
  { terms: ["한화", "이글스"], label: "한화이글스" },
  { terms: ["한화이글스"], label: "한화이글스" },
  { terms: ["야구"], label: "야구" },
  { terms: ["kbo"], label: "KBO" },
  { terms: ["류현진"], label: "류현진" },
  { terms: ["프로야구"], label: "프로야구" },
  { terms: ["투수"], label: "야구 투수" },
  { terms: ["타자"], label: "야구 타자" },
  { terms: ["홈런"], label: "홈런" },
  { terms: ["축구"], label: "축구" },
  { terms: ["월드컵"], label: "월드컵" },
  { terms: ["손흥민"], label: "손흥민" },
  { terms: ["이라크전"], label: "축구 이라크전" },
  { terms: ["이라크", "대표팀"], label: "이라크 대표팀" },
  { terms: ["경기"], label: "스포츠 경기" },
  { terms: ["라드브록스"], label: "베팅/스포츠" },
  { terms: ["ladbrokes"], label: "베팅/스포츠" }
];

// ============================================================
// 2. 글로벌 언론 검색 설정
// ============================================================

const OVERSEAS_KEYWORDS = [
  // 비스마야 직접 관련
  "\"بسماية\"",
  "\"بسمايه\"",
  "\"بسمایه\"",
  "\"مشروع بسماية\"",
  "\"مدينة بسماية الجديدة\"",
  "\"مجمع بسماية\"",
  "\"شقق بسماية\"",
  "\"خدمات بسماية\"",
  "\"كهرباء بسماية\"",
  "\"ماء بسماية\"",
  "\"الهيئة الوطنية للاستثمار\" \"بسماية\"",
  "\"العراق\" \"بسماية\"",
  "\"بغداد\" \"بسماية\"",
  "\"السوداني\" \"بسماية\"",

  // 한화 이라크
  "\"هانوا\" \"العراق\"",
  "\"شركة هانوا\" \"العراق\"",
  "\"Hanwha\" \"Iraq\"",
  "\"Hanwha\" \"Bismayah\"",
  "\"Bismayah\" \"Hanwha\"",

  // 이라크 주택사업 / 주택정책 / 주택난
  "\"العراق\" \"مشاريع سكنية\"",
  "\"العراق\" \"مشروع سكني\"",
  "\"العراق\" \"مجمع سكني\"",
  "\"العراق\" \"مجمعات سكنية\"",
  "\"العراق\" \"وحدات سكنية\"",
  "\"العراق\" \"أزمة السكن\"",
  "\"العراق\" \"ازمة السكن\"",
  "\"العراق\" \"حل أزمة السكن\"",
  "\"العراق\" \"حل ازمة السكن\"",
  "\"العراق\" \"مدن سكنية\"",
  "\"العراق\" \"مدن جديدة\"",
  "\"العراق\" \"توزيع الأراضي\"",
  "\"العراق\" \"توزيع الاراضي\"",
  "\"العراق\" \"وزارة الإعمار والإسكان\"",
  "\"العراق\" \"وزارة الاعمار والاسكان\"",

  // 투자위원회 / 주택 투자
  "\"الهيئة الوطنية للاستثمار\" \"مشروع سكني\"",
  "\"الهيئة الوطنية للاستثمار\" \"مشاريع سكنية\"",
  "\"الهيئة الوطنية للاستثمار\" \"مدن سكنية\"",
  "\"هيئة الاستثمار\" \"مشروع سكني\"",
  "\"هيئة الاستثمار\" \"سكني\"",

  // 건설 / 인프라 / 수주 / 계약
  "\"العراق\" \"إحالة مشروع\" \"سكني\"",
  "\"العراق\" \"احالة مشروع\" \"سكني\"",
  "\"العراق\" \"عقد\" \"سكني\"",
  "\"العراق\" \"استثمار\" \"سكني\"",
  "\"العراق\" \"البنى التحتية\" \"مشروع\"",
  "\"العراق\" \"بنى تحتية\" \"مشروع\"",
  "\"العراق\" \"إعمار\" \"مشروع\"",
  "\"العراق\" \"اعمار\" \"مشروع\"",
  "\"Iraq\" \"housing project\"",
  "\"Iraq\" \"residential project\"",
  "\"Iraq\" \"new city\"",
  "\"Iraq\" \"infrastructure project\"",
  "\"Iraq\" \"construction contract\""
];

const OVERSEAS_MIN_SCORE = 45;

const CATEGORIES = {
  domestic: {
    output: "domestic-news.json",
    type: "google-news-rss",
    lang: "ko",
    gl: "KR",
    ceid: "KR:ko",
    categoryLabel: "국내 언론사",
    queries: DOMESTIC_KEYWORDS
  },
  overseas: {
    output: "overseas-news.json",
    type: "google-news-rss",
    lang: "ar",
    gl: "IQ",
    ceid: "IQ:ar",
    categoryLabel: "글로벌 언론사",
    queries: OVERSEAS_KEYWORDS
  }
};

// ============================================================
// 3. 공통 유틸
// ============================================================

function cutoffDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DAYS);
  return d;
}

function hasArabic(value = "") {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function stripArabicDiacritics(value = "") {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "");
}

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value = "") {
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractTag(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1]) : "";
}

function normalizeSearchText(value = "") {
  return decodeHtml(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[·ㆍ|,，.。:：;；/\\()[\]{}<>「」『』【】\-–—_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function termInText(text, term) {
  const hay = normalizeSearchText(text);
  const needle = normalizeSearchText(term);
  return needle && hay.includes(needle);
}

function ruleMatches(text, rule) {
  return rule.terms.every((term) => termInText(text, term));
}

function hasAny(text, terms) {
  const normalized = stripArabicDiacritics(String(text || "")).toLowerCase();
  return terms.some((term) => {
    const needle = stripArabicDiacritics(String(term || "")).toLowerCase();
    return needle && normalized.includes(needle);
  });
}

function normalizeBismayahText(value) {
  if (!value) return value;

  return String(value)
    .replace(
      /(^|[^\u0600-\u06FF])ب[\u0640\s\u064B-\u065F\u0670]*س[\u0640\s\u064B-\u065F\u0670]*م[\u0640\s\u064B-\u065F\u0670]*ا[\u0640\s\u064B-\u065F\u0670]*[يىی][\u0640\s\u064B-\u065F\u0670]*[ةه](?=$|[^\u0600-\u06FF])/g,
      "$1비스마야"
    )
    .replace(/\bBismayah\b/gi, "비스마야")
    .replace(/\bBismaya\b/gi, "비스마야")
    .replace(/\bBasmaya\b/gi, "비스마야");
}

function hasBismayahKeyword(value = "") {
  const text = stripArabicDiacritics(String(value || ""));

  const arabicBismayah =
    /(^|[^\u0600-\u06FF])ب[\u0640\s]*س[\u0640\s]*م[\u0640\s]*ا[\u0640\s]*[يىی][\u0640\s]*[ةه](?=$|[^\u0600-\u06FF])/;

  return (
    arabicBismayah.test(text) ||
    /\b(bismayah|bismaya|basmaya|bncp)\b/i.test(text) ||
    /비스마야/.test(text)
  );
}

function hasHanwhaIraqKeyword(value = "") {
  const text = stripArabicDiacritics(String(value || "")).toLowerCase();
  const hasHanwha = /hanwha|هانوا|한화/.test(text);
  const hasIraq = /iraq|العراق|عراقي|بغداد|이라크/.test(text);
  return hasHanwha && hasIraq;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url || "";
  }
}

function canonicalKey(item) {
  const urlKey = normalizeUrl(item.url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  const titleKey = String(item.title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return urlKey || titleKey;
}

function googleNewsRssUrl(query, cfg) {
  const q = `${query} when:${DAYS}d`;
  const params = new URLSearchParams({
    q,
    hl: cfg.lang,
    gl: cfg.gl,
    ceid: cfg.ceid
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
}

function guessSourceFromTitle(title = "") {
  const parts = String(title || "").split(" - ");
  return parts.length >= 2 ? parts[parts.length - 1].trim() : "";
}

function parseRssItems(xml, query, category) {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];

  return blocks
    .map((block) => {
      const rawTitle = extractTag(block, "title");
      const link = extractTag(block, "link");
      const pubDate = extractTag(block, "pubDate");
      const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const source = sourceMatch ? decodeHtml(sourceMatch[1]) : guessSourceFromTitle(rawTitle);
      const description = stripTags(extractTag(block, "description"));

      return {
        title: rawTitle,
        titleKo: "",
        summaryKo: "",
        source,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
        url: normalizeUrl(link),
        query,
        category,
        description,
        relevanceScore: 0,
        priority: "low",
        matchedRules: [],
        excludedRules: []
      };
    })
    .filter((item) => item.title && item.url);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Bismayah News Monitor GitHub Actions",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  return await res.text();
}

function uniqueRecent(items) {
  const cutoff = cutoffDate();
  const map = new Map();

  for (const item of items) {
    if (item.publishedAt) {
      const d = new Date(item.publishedAt);
      if (!Number.isNaN(d.getTime()) && d < cutoff) {
        continue;
      }
    }

    const key = canonicalKey(item);
    if (!map.has(key)) {
      map.set(key, item);
      continue;
    }

    const old = map.get(key);
    if (Number(item.relevanceScore || 0) > Number(old.relevanceScore || 0)) {
      map.set(key, item);
    }
  }

  return [...map.values()]
    .sort((a, b) => {
      const scoreDiff = Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
      if (scoreDiff) return scoreDiff;

      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, MAX_TOTAL);
}

// ============================================================
// 4. 국내 언론 점수 계산
// ============================================================

function scoreDomesticArticle(item) {
  const title = item.title || "";
  const desc = item.description || "";
  const combined = `${title}\n${desc}`;

  const matched = [];
  const excluded = [];

  for (const rule of DOMESTIC_EXCLUDE_RULES) {
    if (ruleMatches(combined, rule)) {
      excluded.push(rule.label);
    }
  }

  if (excluded.length) {
    return {
      score: -999,
      priority: "excluded",
      matched,
      excluded
    };
  }

  let score = 0;

  for (const rule of DOMESTIC_PRIORITY_RULES) {
    if (ruleMatches(title, rule)) {
      score += rule.score;
      matched.push(`제목:${rule.label}`);
    } else if (ruleMatches(desc, rule)) {
      score += Math.round(rule.score * 0.55);
      matched.push(`설명:${rule.label}`);
    }
  }

  for (const rule of DOMESTIC_GENERAL_RULES) {
    if (ruleMatches(title, rule)) {
      score += rule.score;
      matched.push(`제목:${rule.label}`);
    } else if (ruleMatches(desc, rule)) {
      score += Math.round(rule.score * 0.45);
      matched.push(`설명:${rule.label}`);
    }
  }

  let priority = "low";
  if (score >= 80) priority = "top";
  else if (score >= 40) priority = "high";
  else if (score >= DOMESTIC_MIN_SCORE) priority = "normal";

  return {
    score,
    priority,
    matched,
    excluded
  };
}

function domesticArticleMatches(item) {
  const result = scoreDomesticArticle(item);

  item.relevanceScore = result.score;
  item.priority = result.priority;
  item.matchedRules = result.matched;
  item.excludedRules = result.excluded;

  return result.score >= DOMESTIC_MIN_SCORE;
}

// ============================================================
// 5. 글로벌 언론 점수 계산
// ============================================================

const OVERSEAS_EXCLUDE_RULES = [
  {
    pattern:
      /ladbrokes|betting|odds|fixture|score|vs iraq|senegal vs iraq|youtube|tiktok|football|soccer|match|cup|world cup|كأس|مباراة|منتخب|الدوري|كرة/i,
    label: "스포츠/베팅"
  },
  {
    pattern:
      /كبتاغون|مخدرات|مخدر|داعش|إرهاب|ارهاب|اغتيال|جثة|اعتقال|قبض|سرقة|تهريب|مسلح|انتحار/i,
    label: "마약/테러/일반 범죄"
  }
];

const OVERSEAS_SCORE_RULES = [
  {
    label: "비스마야 직접 언급",
    score: 100,
    test: (text) => hasBismayahKeyword(text)
  },
  {
    label: "한화+이라크",
    score: 90,
    test: (text) => hasHanwhaIraqKeyword(text)
  },
  {
    label: "이라크+주택사업",
    score: 75,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, [
        "مشروع سكني",
        "مشاريع سكنية",
        "مجمع سكني",
        "مجمعات سكنية",
        "وحدات سكنية",
        "مدينة سكنية",
        "مدن سكنية",
        "شقق",
        "housing project",
        "residential project",
        "new city",
        "주택사업",
        "주거단지",
        "신도시"
      ])
  },
  {
    label: "이라크+주택정책/주택난",
    score: 65,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, [
        "أزمة السكن",
        "ازمة السكن",
        "حل أزمة السكن",
        "حل ازمة السكن",
        "سياسة الإسكان",
        "سياسة الاسكان",
        "الإسكان",
        "الاسكان",
        "السكن",
        "توزيع الأراضي",
        "توزيع الاراضي",
        "housing crisis",
        "housing policy",
        "주택난",
        "주택정책",
        "주택 공급"
      ])
  },
  {
    label: "NIC/투자위원회+주택/투자",
    score: 60,
    test: (text) =>
      hasAny(text, [
        "الهيئة الوطنية للاستثمار",
        "هيئة الاستثمار",
        "national investment commission",
        "nic"
      ]) &&
      hasAny(text, [
        "سكن",
        "سكني",
        "استثمار",
        "مشروع",
        "مشاريع",
        "housing",
        "investment",
        "project"
      ])
  },
  {
    label: "이라크+건설/인프라/도시개발",
    score: 50,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, [
        "إعمار",
        "اعمار",
        "إنشاء",
        "انشاء",
        "بناء",
        "البنى التحتية",
        "بنى تحتية",
        "طرق",
        "جسور",
        "صرف صحي",
        "ماء",
        "كهرباء",
        "مدينة جديدة",
        "مدن جديدة",
        "construction",
        "infrastructure",
        "urban development",
        "건설",
        "인프라",
        "도시개발"
      ])
  },
  {
    label: "이라크+계약/수주/프로젝트 발주",
    score: 45,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, [
        "إحالة",
        "احالة",
        "عقد",
        "توقيع",
        "تنفيذ",
        "مشروع",
        "مشاريع",
        "شركة",
        "contract",
        "awarded",
        "project",
        "수주",
        "계약",
        "발주"
      ])
  }
];

function scoreOverseasArticle(item) {
  const blob = `${item.title || ""}\n${item.description || ""}\n${item.source || ""}`;

  const matched = [];
  const excluded = [];

  for (const rule of OVERSEAS_EXCLUDE_RULES) {
    if (rule.pattern.test(blob)) {
      // 비스마야나 한화+이라크 직접 언급이 있으면 사건사고라도 사업 리스크로 볼 수 있으므로 유지.
      if (!hasBismayahKeyword(blob) && !hasHanwhaIraqKeyword(blob)) {
        excluded.push(rule.label);
      }
    }
  }

  if (excluded.length) {
    return {
      score: -999,
      priority: "excluded",
      matched,
      excluded
    };
  }

  let score = 0;

  for (const rule of OVERSEAS_SCORE_RULES) {
    if (rule.test(blob)) {
      score = Math.max(score, rule.score);
      matched.push(rule.label);
    }
  }

  let priority = "low";
  if (score >= 90) priority = "top";
  else if (score >= 70) priority = "high";
  else if (score >= 55) priority = "normal";
  else if (score >= OVERSEAS_MIN_SCORE) priority = "watch";

  return {
    score,
    priority,
    matched,
    excluded
  };
}

function overseasArticleMatches(item) {
  const result = scoreOverseasArticle(item);

  item.relevanceScore = result.score;
  item.priority = result.priority;
  item.matchedRules = result.matched;
  item.excludedRules = result.excluded;

  return result.score >= OVERSEAS_MIN_SCORE;
}

// ============================================================
// 6. OpenAI 번역
// ============================================================

async function aiKorean(prompt, input) {
  if (!OPENAI_API_KEY) {
    return "";
  }

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content:
              "You translate and summarize Arabic, English, and Korean news into concise business Korean. Do not invent facts."
          },
          {
            role: "user",
            content: `${prompt}\n\n${input}`
          }
        ]
      })
    });

    if (!res.ok) {
      console.warn(`[openai] ${res.status} ${await res.text()}`);
      return "";
    }

    const data = await res.json();

    if (data.output_text) {
      return String(data.output_text).trim();
    }

    const chunks = [];
    for (const out of data.output || []) {
      for (const c of out.content || []) {
        if (c.text) {
          chunks.push(c.text);
        }
      }
    }

    return chunks.join("\n").trim();
  } catch (err) {
    console.warn(`[openai] ${err.message || err}`);
    return "";
  }
}

function parseJsonObject(text = "") {
  const raw = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return null;
}

function isGoodKoreanTranslation(obj) {
  const titleKo = String(obj && obj.titleKo ? obj.titleKo : "").trim();
  const summaryKo = String(obj && obj.summaryKo ? obj.summaryKo : "").trim();

  if (titleKo.length < 4 || summaryKo.length < 8) {
    return false;
  }

  if (hasArabic(titleKo) || hasArabic(summaryKo)) {
    return false;
  }

  if (/^제목\s*:/i.test(titleKo) || /^요약\s*:/i.test(summaryKo)) {
    return false;
  }

  return true;
}

async function enrichArticleKorean(item) {
  if (!OPENAI_API_KEY) {
    return item;
  }

  const sourceText = [
    `원문 제목: ${item.title}`,
    item.description ? `원문 설명: ${item.description}` : "",
    item.source ? `출처: ${item.source}` : "",
    item.matchedRules && item.matchedRules.length
      ? `관련성 판단: ${item.matchedRules.join(", ")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const prompts = [
    [
      "아래 뉴스 항목을 한국어로 번역/요약하세요.",
      "반드시 JSON 객체만 출력하세요. 마크다운 코드블록, 설명문, 주석은 금지합니다.",
      "필수 키는 titleKo, summaryKo 입니다.",
      "titleKo는 자연스러운 한국어 기사 제목 1개로 작성하세요.",
      "summaryKo는 자연스러운 한국어 1문장으로 작성하세요.",
      "아랍어 원문을 titleKo 또는 summaryKo에 그대로 남기지 마세요.",
      "بسماية, بسمايه, بسمایه, Bismayah, Bismaya, Basmaya는 항상 '비스마야'로 번역하세요.",
      "출처명은 제목에 넣지 마세요.",
      "주택사업, 주택정책, 건설, 인프라, 투자, 수주 관련 맥락은 회사 모니터링 관점으로 자연스럽게 표현하세요.",
      "예시: {\"titleKo\":\"이라크 주택사업 관련 제목\",\"summaryKo\":\"이라크 주택사업 관련 내용을 한국어로 요약했습니다.\"}"
    ].join("\n"),
    [
      "이전 응답에 아랍어가 남았거나 형식이 잘못되었습니다. 다시 번역하세요.",
      "반드시 JSON 객체만 출력하세요.",
      "titleKo와 summaryKo 값에는 아랍어 문자가 절대 포함되면 안 됩니다.",
      "بسماية, بسمايه, بسمایه, Bismayah, Bismaya, Basmaya는 반드시 '비스마야'로 표기하세요.",
      "summaryKo는 한국어 완성문 1문장으로 작성하세요."
    ].join("\n")
  ];

  for (const prompt of prompts) {
    const raw = await aiKorean(prompt, sourceText);
    const parsed = parseJsonObject(raw);

    if (isGoodKoreanTranslation(parsed)) {
      return {
        ...item,
        titleKo: normalizeBismayahText(parsed.titleKo.trim()),
        summaryKo: normalizeBismayahText(parsed.summaryKo.trim())
      };
    }
  }

  console.warn(`[translate] failed or Arabic remained: ${item.title}`);

  return {
    ...item,
    titleKo: "",
    summaryKo: "",
    translationFailed: true
  };
}

// ============================================================
// 7. Google News 수집
// ============================================================

async function collectGoogleNews(category, cfg) {
  const all = [];
  const debug = [];

  for (const query of cfg.queries) {
    const url = googleNewsRssUrl(query, cfg);

    try {
      const xml = await fetchText(url);
      let items = parseRssItems(xml, query, category).slice(0, MAX_PER_QUERY);
      const beforeFilter = items.length;

      if (category === "domestic") {
        items = items.filter(domesticArticleMatches);
      }

      if (category === "overseas") {
        items = items.filter(overseasArticleMatches);
      }

      all.push(...items);

      debug.push({
        query,
        ok: true,
        beforeFilter,
        afterFilter: items.length
      });

      console.log(`[${category}] ${query}: ${items.length}/${beforeFilter}`);
    } catch (err) {
      debug.push({
        query,
        ok: false,
        error: String(err.message || err)
      });

      console.warn(`[${category}] ${query}: ${err.message || err}`);
    }
  }

  let articles = uniqueRecent(all);

  if (OPENAI_API_KEY && category === "overseas") {
    articles = await mapLimit(articles, 3, enrichArticleKorean);

    articles = articles.filter((item) => {
      if (item.translationFailed) return false;
      if (!item.titleKo || !item.summaryKo) return false;
      if (hasArabic(item.titleKo) || hasArabic(item.summaryKo)) return false;
      return true;
    });
  }

  return {
    category,
    label: cfg.categoryLabel,
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: cfg.type,
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    domesticMinScore: category === "domestic" ? DOMESTIC_MIN_SCORE : undefined,
    overseasMinScore: category === "overseas" ? OVERSEAS_MIN_SCORE : undefined,
    count: articles.length,
    queries: cfg.queries,
    debug,
    articles
  };
}

// ============================================================
// 8. 현재 사용하지 않는 보조 출력
// ============================================================

async function collectSnsPlaceholder() {
  return {
    category: "sns",
    label: "SNS",
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: "curated-sources-required",
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    count: 0,
    messageKo:
      "SNS는 data/sns-activities.json 및 assets/sns-patch.js 기준으로 별도 수집/표시합니다. 이 파일은 과거 호환용 placeholder입니다.",
    articles: []
  };
}

async function collectComPlaceholder() {
  return {
    category: "com",
    label: "COM 주요활동",
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: "separate-com-collector",
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    count: 0,
    messageKo:
      "COM 주요활동은 data/com-activities.json 및 assets/com-patch.js 기준으로 별도 수집/표시합니다. 이 파일은 과거 호환용 placeholder입니다.",
    articles: []
  };
}

// ============================================================
// 9. 동시 실행 제한
// ============================================================

async function mapLimit(arr, limit, fn) {
  const ret = [];
  let idx = 0;

  async function worker() {
    while (idx < arr.length) {
      const cur = idx++;
      ret[cur] = await fn(arr[cur], cur);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return ret;
}

// ============================================================
// 10. main
// ============================================================

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const index = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    categories: {}
  };

  for (const [category, cfg] of Object.entries(CATEGORIES)) {
    const result = await collectGoogleNews(category, cfg);
    const outputPath = path.join(DATA_DIR, cfg.output);

    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

    index.categories[category] = {
      file: `data/${cfg.output}`,
      count: result.count,
      generatedAt: result.generatedAt
    };
  }

  const sns = await collectSnsPlaceholder();
  await fs.writeFile(path.join(DATA_DIR, "sns-news.json"), JSON.stringify(sns, null, 2), "utf8");

  index.categories.sns = {
    file: "data/sns-news.json",
    count: sns.count,
    generatedAt: sns.generatedAt
  };

  const com = await collectComPlaceholder();
  await fs.writeFile(path.join(DATA_DIR, "com-news.json"), JSON.stringify(com, null, 2), "utf8");

  index.categories.com = {
    file: "data/com-news.json",
    count: com.count,
    generatedAt: com.generatedAt
  };

  await fs.writeFile(path.join(DATA_DIR, "news-index.json"), JSON.stringify(index, null, 2), "utf8");

  console.log("Collection complete:", index);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
