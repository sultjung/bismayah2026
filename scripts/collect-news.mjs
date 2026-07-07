#!/usr/bin/env node
/**
 * Bismayah / Hanwha Iraq News Collector v12
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 60);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 30);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 250);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";

const IRAQ_MEDIA_SOURCES_FILE = path.join(DATA_DIR, "iraq-media-sources.json");
const MAX_LOCAL_URLS_PER_SOURCE = Number(process.env.MAX_LOCAL_URLS_PER_SOURCE || 45);
const MAX_LOCAL_ARTICLES_TOTAL = Number(process.env.MAX_LOCAL_ARTICLES_TOTAL || 160);
const LOCAL_FETCH_DELAY_MS = Number(process.env.LOCAL_FETCH_DELAY_MS || 150);
const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 14000);
const MAX_ARTICLE_TEXT_FOR_AI = Number(process.env.MAX_ARTICLE_TEXT_FOR_AI || 10000);


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

const OVERSEAS_KEYWORDS = [
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

  "\"هانوا\" \"العراق\"",
  "\"شركة هانوا\" \"العراق\"",
  "\"Hanwha\" \"Iraq\"",
  "\"Hanwha\" \"Bismayah\"",
  "\"Bismayah\" \"Hanwha\"",

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

  "\"الهيئة الوطنية للاستثمار\" \"مشروع سكني\"",
  "\"الهيئة الوطنية للاستثمار\" \"مشاريع سكنية\"",
  "\"الهيئة الوطنية للاستثمار\" \"مدن سكنية\"",
  "\"هيئة الاستثمار\" \"مشروع سكني\"",
  "\"هيئة الاستثمار\" \"سكني\"",

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
  "\"Iraq\" \"construction contract\"",

  "\"رئيس هيئة الاستثمار\"",
  "\"رئيس الهيئة الوطنية للاستثمار\"",
  "\"حيدر مكية\"",
  "\"حيدر مكيه\"",
  "\"هيئة الاستثمار\" \"البرلمان\"",
  "\"الهيئة الوطنية للاستثمار\" \"البرلمان\"",
  "\"هيئة الاستثمار\" \"مجلس النواب\"",
  "\"الهيئة الوطنية للاستثمار\" \"مجلس النواب\"",
  "\"هيئة الاستثمار\" \"استجواب\"",
  "\"الهيئة الوطنية للاستثمار\" \"استجواب\""
];

const OVERSEAS_MIN_SCORE = 40;


const WEEKLY_CONTEXT_KEYWORDS = [
  '"العراق" "مجلس الوزراء"',
  '"العراق" "السوداني"',
  '"العراق" "البرلمان"',
  '"العراق" "الانتخابات"',
  '"العراق" "الحشد الشعبي"',
  '"العراق" "داعش"',
  '"بغداد" "داعش"',
  '"العراق" "الوضع الأمني"',
  '"العراق" "تظاهرات"',
  '"العراق" "النفط" "أوبك"',
  '"العراق" "الموازنة"',
  '"العراق" "الكهرباء"',
  '"العراق" "وزارة الإعمار"',
  '"العراق" "مشاريع البنى التحتية"',
  '"العراق" "أزمة السكن"',
  '"Iraq" "Council of Ministers"',
  '"Iraq" "Al-Sudani"',
  '"Iraq" "parliament" "election"',
  '"Iraq" "ISIS"',
  '"Iraq" "security situation"',
  '"Iraq" "oil" "OPEC"',
  '"Iraq" "budget"',
  '"Iraq" "housing project"',
  '"Iraq" "infrastructure project"'
];

const WEEKLY_CONTEXT_MIN_SCORE = 35;

const IRAQ_POLITICAL_ACTOR_KEYWORDS = [
  '"الإطار التنسيقي"',
  '"قوى الإطار التنسيقي"',
  '"تحالف الإطار التنسيقي"',
  '"Coordination Framework" "Iraq"',
  '"ائتلاف دولة القانون"',
  '"دولة القانون" "العراق"',
  '"نوري المالكي"',
  '"Nouri al-Maliki"',
  '"حزب الدعوة الإسلامية"',
  '"ائتلاف الإعمار والتنمية"',
  '"تحالف الإعمار والتنمية"',
  '"تيار الفراتين"',
  '"محمد شياع السوداني"',
  '"التيار الصدري"',
  '"مقتدى الصدر"',
  '"الكتلة الصدرية"',
  '"عصائب أهل الحق"',
  '"قيس الخزعلي"',
  '"منظمة بدر"',
  '"هادي العامري"',
  '"كتائب حزب الله" "العراق"',
  '"الحشد الشعبي" "السياسة"',
  '"تحالف السيادة"',
  '"خميس الخنجر"',
  '"محمد الحلبوسي"',
  '"حزب تقدم" "العراق"',
  '"الحزب الديمقراطي الكردستاني"',
  '"مسعود بارزاني"',
  '"الاتحاد الوطني الكردستاني"',
  '"بافل طالباني"',
  '"مجلس النواب" "استجواب"',
  '"لجنة النزاهة" "العراق"',
  '"لجنة الاستثمار" "مجلس النواب"',
  '"الانتخابات العراقية"',
  '"المفوضية العليا للانتخابات"'
];

const IRAQ_POLITICAL_ACTOR_MIN_SCORE = 38;


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
    type: "google-news-rss+iraq-media-sites",
    lang: "ar",
    gl: "IQ",
    ceid: "IQ:ar",
    categoryLabel: "이라크 언론사",
    queries: OVERSEAS_KEYWORDS
  },
  weeklyContext: {
    output: "weekly-context-news.json",
    type: "google-news-rss",
    lang: "ar",
    gl: "IQ",
    ceid: "IQ:ar",
    categoryLabel: "이라크 주간 보고서 참고자료",
    maxTotal: 80,
    queries: WEEKLY_CONTEXT_KEYWORDS
  },
  politicalActors: {
    output: "iraq-political-actors.json",
    type: "google-news-rss",
    lang: "ar",
    gl: "IQ",
    ceid: "IQ:ar",
    categoryLabel: "이라크 정치세력 동향",
    maxTotal: 90,
    queries: IRAQ_POLITICAL_ACTOR_KEYWORDS
  }
};

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



function normalizeText(value = "") {
  return decodeHtml(String(value || ""))
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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


async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    return normalizeUrl(new URL(decodeHtml(href), baseUrl).toString());
  } catch {
    return "";
  }
}

function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sameHost(url, baseUrl) {
  const a = hostnameOf(url);
  const b = hostnameOf(baseUrl);
  return a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

function looksLikeArticleUrl(url = "") {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || "").toLowerCase();
    const q = decodeURIComponent(u.search || "").toLowerCase();

    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|rar|mp4|mp3|woff2?)$/i.test(p)) return false;
    if (/\/(tag|tags|category|categories|section|sections|author|authors|search|login|privacy|about|contact)(\/|$)/i.test(p)) return false;
    if (u.hash) return false;

    if (/(^|[?&])(id|key|newsid|articleid)=\d+/i.test(q)) return true;
    if (/\/(article|articles|news|story|stories|details|detail|reports?|iraq|politics|economy|security)\//i.test(p) && /\d{3,}/.test(`${p}${q}`)) return true;
    if (/\d{4,}/.test(p)) return true;
    if (/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//.test(p)) return true;

    return false;
  } catch {
    return false;
  }
}

function buildProbeUrls(source, kind) {
  const base = source.baseUrl || "";
  const urls = [];

  if (kind === "rss") {
    urls.push(...(source.rssUrls || []));
    urls.push(toAbsoluteUrl("/rss.xml", base), toAbsoluteUrl("/feed/", base));
  }

  if (kind === "sitemap") {
    urls.push(...(source.sitemapUrls || []));
    urls.push(toAbsoluteUrl("/sitemap.xml", base));
  }

  if (kind === "list") {
    urls.push(...(source.listPages || []));
    urls.push(base);
  }

  return uniqueStrings(urls.map((u) => normalizeUrl(u))).filter((u) => sameHost(u, base));
}

function extractUrlsFromHtml(html = "", baseUrl = "") {
  const urls = [];
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;

  while ((match = re.exec(html))) {
    const href = match[1];
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    const url = toAbsoluteUrl(href, baseUrl);
    if (url) urls.push(url);
  }

  return uniqueStrings(urls);
}

function parseSitemapEntries(xml = "") {
  const entries = [];
  const blocks = String(xml || "").match(/<(url|sitemap)>[\s\S]*?<\/\1>/gi) || [];

  for (const block of blocks) {
    const loc = extractTag(block, "loc");
    const lastmod = extractTag(block, "lastmod");
    if (loc) entries.push({ url: normalizeUrl(loc), lastmod });
  }

  return entries;
}

function extractMetaContent(html = "", names = []) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
    ];

    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match && match[1]) return decodeHtml(match[1]);
    }
  }

  return "";
}

function extractFirstTagText(html = "", tag = "h1") {
  const match = String(html || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function extractPublishedAt(html = "", fallback = "") {
  const meta = extractMetaContent(html, [
    "article:published_time",
    "article:modified_time",
    "pubdate",
    "publishdate",
    "date",
    "datePublished",
    "dateModified"
  ]);

  const jsonLdDate =
    (String(html || "").match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1] ||
    (String(html || "").match(/"dateModified"\s*:\s*"([^"]+)"/i) || [])[1] ||
    "";

  const timeDate =
    (String(html || "").match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i) || [])[1] || "";

  for (const value of [meta, jsonLdDate, timeDate, fallback]) {
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return "";
}

function extractReadableText(html = "") {
  let src = String(html || "");
  src = src
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  const articleMatch =
    src.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    src.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const body = articleMatch ? articleMatch[1] : src;
  const paragraphs = [...body.matchAll(/<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => stripTags(m[2]))
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length >= 20)
    .filter((text) => !/cookie|subscribe|newsletter|advertisement|privacy|حقوق النشر|اشترك|إعلان/i.test(text))
    .slice(0, 100);

  const text = paragraphs.length >= 3 ? paragraphs.join("\n") : stripTags(body);
  return decodeHtml(text)
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_ARTICLE_TEXT_CHARS);
}

function extractArticleDescription(html = "") {
  const meta = extractMetaContent(html, ["og:description", "twitter:description", "description"]);
  const fullText = extractReadableText(html);
  return [meta, fullText.slice(0, 2800)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 3500);
}

function parseArticleHtml(html = "", url = "", source = {}, fallbackDate = "") {
  const title =
    extractMetaContent(html, ["og:title", "twitter:title", "title"]) ||
    extractFirstTagText(html, "h1") ||
    extractFirstTagText(html, "title");

  const cleanText = extractReadableText(html);
  const description = extractArticleDescription(html);
  const publishedAt = extractPublishedAt(html, fallbackDate);

  if (!title || title.length < 4) return null;

  return {
    title,
    titleKo: "",
    summaryKo: "",
    source: source.name || hostnameOf(url) || "Iraq media",
    publishedAt,
    url: normalizeUrl(url),
    query: `iraq-media-site:${source.id || source.name || hostnameOf(url)}`,
    category: "overseas",
    description,
    cleanText,
    fullText: cleanText,
    originalTextLength: cleanText.length,
    relevanceScore: 0,
    priority: "low",
    matchedRules: [],
    excludedRules: [],
    language: hasArabic(`${title} ${description}`) ? "ar" : "en",
    country: "Iraq",
    collection_method: "iraq-media-direct",
    sourceType: "iraq-media-direct"
  };
}

function parseLocalRssItems(xml = "", source = {}, feedUrl = "") {
  return parseRssItems(xml, `iraq-media-rss:${source.id || source.name || feedUrl}`, "overseas")
    .map((item) => ({
      ...item,
      source: item.source || source.name || hostnameOf(item.url) || "Iraq media",
      country: "Iraq",
      language: hasArabic(`${item.title} ${item.description}`) ? "ar" : "en",
      collection_method: "iraq-media-rss",
      sourceType: "iraq-media-rss"
    }));
}

async function collectCandidateUrlsFromSource(source) {
  const candidates = [];
  const debug = { id: source.id, name: source.name, rss: [], sitemap: [], list: [] };

  for (const rssUrl of buildProbeUrls(source, "rss")) {
    try {
      const xml = await fetchText(rssUrl);
      const items = parseLocalRssItems(xml, source, rssUrl);
      candidates.push(...items.map((item) => ({ url: item.url, rssItem: item, method: "rss" })));
      debug.rss.push({ url: rssUrl, ok: true, count: items.length });
    } catch (err) {
      debug.rss.push({ url: rssUrl, ok: false, error: String(err.message || err).slice(0, 120) });
    }
  }

  for (const sitemapUrl of buildProbeUrls(source, "sitemap")) {
    try {
      const xml = await fetchText(sitemapUrl);
      let entries = parseSitemapEntries(xml).filter((entry) => sameHost(entry.url, source.baseUrl));

      const nested = entries
        .filter((entry) => /sitemap/i.test(entry.url) && !looksLikeArticleUrl(entry.url))
        .slice(0, 5);

      for (const child of nested) {
        try {
          const childXml = await fetchText(child.url);
          entries.push(...parseSitemapEntries(childXml).filter((entry) => sameHost(entry.url, source.baseUrl)));
        } catch {}
      }

      entries = entries
        .filter((entry) => looksLikeArticleUrl(entry.url))
        .sort((a, b) => new Date(b.lastmod || 0) - new Date(a.lastmod || 0))
        .slice(0, MAX_LOCAL_URLS_PER_SOURCE);

      candidates.push(...entries.map((entry) => ({ ...entry, method: "sitemap" })));
      debug.sitemap.push({ url: sitemapUrl, ok: true, count: entries.length });
    } catch (err) {
      debug.sitemap.push({ url: sitemapUrl, ok: false, error: String(err.message || err).slice(0, 120) });
    }
  }

  for (const listUrl of buildProbeUrls(source, "list")) {
    try {
      const html = await fetchText(listUrl);
      const urls = extractUrlsFromHtml(html, listUrl)
        .filter((url) => sameHost(url, source.baseUrl))
        .filter(looksLikeArticleUrl)
        .slice(0, MAX_LOCAL_URLS_PER_SOURCE);

      candidates.push(...urls.map((url) => ({ url, method: "list" })));
      debug.list.push({ url: listUrl, ok: true, count: urls.length });
    } catch (err) {
      debug.list.push({ url: listUrl, ok: false, error: String(err.message || err).slice(0, 120) });
    }
  }

  const seen = new Set();
  const unique = [];

  for (const candidate of candidates) {
    const key = normalizeUrl(candidate.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...candidate, url: key });
  }

  return { candidates: unique.slice(0, MAX_LOCAL_URLS_PER_SOURCE), debug };
}

async function fetchLocalArticle(source, candidate) {
  await delay(LOCAL_FETCH_DELAY_MS);

  if (candidate.rssItem) {
    try {
      const html = await fetchText(candidate.rssItem.url);
      const parsed = parseArticleHtml(html, candidate.rssItem.url, source, candidate.rssItem.publishedAt || "");
      if (parsed) {
        return {
          ...candidate.rssItem,
          ...parsed,
          title: parsed.title || candidate.rssItem.title,
          description: parsed.description || candidate.rssItem.description,
          collection_method: candidate.rssItem.collection_method || "iraq-media-rss+article",
          sourceType: candidate.rssItem.sourceType || "iraq-media-rss"
        };
      }
    } catch (err) {
      // RSS item itself is still useful when the article page blocks direct access.
    }
    return candidate.rssItem;
  }

  try {
    const html = await fetchText(candidate.url);
    return parseArticleHtml(html, candidate.url, source, candidate.lastmod || "");
  } catch (err) {
    console.warn(`[iraq-media] ${source.name || source.id} ${candidate.url}: ${err.message || err}`);
    return null;
  }
}

async function collectIraqMediaSites() {
  const sources = (await readJsonFile(IRAQ_MEDIA_SOURCES_FILE, []))
    .filter((source) => source && source.enabled !== false && source.baseUrl);

  const all = [];
  const debug = [];

  for (const source of sources) {
    const sourceResult = await collectCandidateUrlsFromSource(source);
    const rawItems = await mapLimit(sourceResult.candidates, 4, (candidate) => fetchLocalArticle(source, candidate));
    const validItems = rawItems.filter(Boolean);
    const filteredItems = validItems.filter(overseasArticleMatches);

    all.push(...filteredItems);

    debug.push({
      ...sourceResult.debug,
      candidateCount: sourceResult.candidates.length,
      parsedCount: validItems.length,
      matchedCount: filteredItems.length
    });

    console.log(`[iraq-media] ${source.name || source.id}: ${filteredItems.length}/${validItems.length} matched`);
  }

  return {
    sourceCount: sources.length,
    beforeFilter: debug.reduce((sum, item) => sum + Number(item.parsedCount || 0), 0),
    articles: uniqueRecent(all, MAX_LOCAL_ARTICLES_TOTAL),
    debug
  };
}

function uniqueRecent(items, limit = MAX_TOTAL) {
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
    .slice(0, limit);
}

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

const BODY_BUSINESS_TERMS = [
  "مشروع سكني",
  "مشاريع سكنية",
  "مجمع سكني",
  "مجمعات سكنية",
  "وحدات سكنية",
  "مدينة سكنية",
  "مدن سكنية",
  "شقق",
  "أزمة السكن",
  "ازمة السكن",
  "الإسكان",
  "الاسكان",
  "السكن",
  "توزيع الأراضي",
  "توزيع الاراضي",
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
  "استثمار",
  "عقد",
  "إحالة",
  "احالة",
  "توقيع",
  "تنفيذ",
  "مشروع",
  "مشاريع",
  "شركة",
  "وزارة الإعمار",
  "وزارة الاعمار",
  "الهيئة الوطنية للاستثمار",
  "هيئة الاستثمار",
  "رئيس هيئة الاستثمار",
  "رئيس الهيئة الوطنية للاستثمار",
  "حيدر مكية",
  "حيدر مكيه",
  "البرلمان",
  "مجلس النواب",
  "استجواب",
  "يستجوب",
  "مساءلة",
  "استضافة",
  "لجنة الاستثمار",
  "housing",
  "residential",
  "construction",
  "infrastructure",
  "investment",
  "contract",
  "awarded",
  "project",
  "주택",
  "신도시",
  "건설",
  "인프라",
  "투자",
  "계약",
  "수주",
  "발주"
];

const QUERY_STRATEGIC_TERMS = [
  "العراق",
  "iraq",
  "بغداد",
  "baghdad",
  "مشروع سكني",
  "مشاريع سكنية",
  "مجمع سكني",
  "مجمعات سكنية",
  "وحدات سكنية",
  "أزمة السكن",
  "ازمة السكن",
  "الإسكان",
  "الاسكان",
  "وزارة الإعمار",
  "وزارة الاعمار",
  "الهيئة الوطنية للاستثمار",
  "هيئة الاستثمار",
  "رئيس هيئة الاستثمار",
  "رئيس الهيئة الوطنية للاستثمار",
  "حيدر مكية",
  "حيدر مكيه",
  "البرلمان",
  "مجلس النواب",
  "استجواب",
  "يستجوب",
  "مساءلة",
  "استضافة",
  "لجنة الاستثمار",
  "housing",
  "residential",
  "construction",
  "infrastructure",
  "investment",
  "project",
  "주택",
  "건설",
  "인프라",
  "투자"
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
    label: "NIC/투자위원회 의회 감시·심문",
    score: 85,
    test: (text) =>
      hasAny(text, [
        "الهيئة الوطنية للاستثمار",
        "هيئة الاستثمار",
        "رئيس هيئة الاستثمار",
        "رئيس الهيئة الوطنية للاستثمار",
        "حيدر مكية",
        "حيدر مكيه",
        "national investment commission",
        "nic"
      ]) &&
      hasAny(text, [
        "البرلمان",
        "مجلس النواب",
        "استجواب",
        "يستجوب",
        "مساءلة",
        "استضافة",
        "لجنة",
        "parliament",
        "questioning",
        "interrogation",
        "hearing"
      ])
  },
  {
    label: "NIC/투자위원장 직접 언급",
    score: 78,
    test: (text) =>
      hasAny(text, [
        "رئيس هيئة الاستثمار",
        "رئيس الهيئة الوطنية للاستثمار",
        "حيدر مكية",
        "حيدر مكيه"
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
  const bodyText = `${item.title || ""}\n${item.description || ""}\n${item.source || ""}`;
  const queryText = `${item.query || ""}`;
  const fullText = `${bodyText}\n${queryText}`;

  const matched = [];
  const excluded = [];

  for (const rule of OVERSEAS_EXCLUDE_RULES) {
    if (rule.pattern.test(bodyText)) {
      if (!hasBismayahKeyword(bodyText) && !hasHanwhaIraqKeyword(bodyText)) {
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

  if (hasBismayahKeyword(bodyText)) {
    score = Math.max(score, 100);
    matched.push("비스마야 직접 언급");
  }

  if (hasHanwhaIraqKeyword(bodyText)) {
    score = Math.max(score, 90);
    matched.push("한화+이라크 직접 언급");
  }

  for (const rule of OVERSEAS_SCORE_RULES) {
    if (rule.test(bodyText)) {
      score = Math.max(score, rule.score);
      matched.push(rule.label);
    }
  }

  const queryIsStrategic =
    hasAny(queryText, QUERY_STRATEGIC_TERMS) ||
    hasBismayahKeyword(queryText) ||
    hasHanwhaIraqKeyword(queryText);

  const bodyHasBusinessKeyword =
    hasAny(bodyText, BODY_BUSINESS_TERMS) ||
    hasBismayahKeyword(bodyText) ||
    hasHanwhaIraqKeyword(bodyText);

  if (queryIsStrategic && bodyHasBusinessKeyword) {
    score = Math.max(score, 55);
    matched.push("검색어+본문 주택/건설/투자 관련");
  }

  if (bodyHasBusinessKeyword) {
    for (const rule of OVERSEAS_SCORE_RULES) {
      if (rule.test(fullText)) {
        const adjustedScore = Math.max(OVERSEAS_MIN_SCORE, Math.round(rule.score * 0.75));
        score = Math.max(score, adjustedScore);
        matched.push(`검색어 보조:${rule.label}`);
      }
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


const WEEKLY_CONTEXT_EXCLUDE_RULES = [
  { pattern: /ladbrokes|betting|odds|fixture|score|vs iraq|senegal vs iraq|youtube|tiktok|football|soccer|match|cup|world cup|كأس|مباراة|منتخب|الدوري|كرة/i, label: "스포츠/베팅" }
];

const WEEKLY_CONTEXT_SCORE_RULES = [
  {
    label: "이라크 정국/정부",
    score: 70,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, ["السوداني", "مجلس الوزراء", "البرلمان", "انتخابات", "حكومة", "رئيس الوزراء", "cabinet", "parliament", "election", "prime minister", "government", "총리", "내각", "의회", "선거", "정부"])
  },
  {
    label: "이라크 안보/테러",
    score: 75,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, ["داعش", "إرهاب", "ارهاب", "الحشد الشعبي", "هجوم", "اشتباك", "قصف", "صاروخ", "مليشيا", "ميليشيا", "security", "isis", "terror", "militia", "pmf", "attack", "rocket", "drone", "테러", "치안", "무장", "공격", "인민동원군"])
  },
  {
    label: "이라크 경제/유가/예산",
    score: 62,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الغاز", "الاقتصاد", "oil", "opec", "budget", "electricity", "gas", "economy", "유가", "원유", "예산", "전력", "가스", "경제"])
  },
  {
    label: "이라크 건설/주택/인프라",
    score: 68,
    test: (text) =>
      hasAny(text, ["العراق", "بغداد", "iraq", "baghdad", "이라크"]) &&
      hasAny(text, ["وزارة الإعمار", "وزارة الاعمار", "الإسكان", "الاسكان", "مشروع", "مشاريع", "البنى التحتية", "سكن", "سكني", "أزمة السكن", "infrastructure", "housing", "construction", "project", "주택", "건설", "인프라", "프로젝트", "신도시"])
  },
  {
    label: "중동 정세와 이라크 영향",
    score: 55,
    test: (text) =>
      hasAny(text, ["العراق", "iraq", "이라크"]) &&
      hasAny(text, ["إيران", "ايران", "سوريا", "إسرائيل", "اسرائيل", "غزة", "حماس", "الحوثي", "أمريكا", "ترامب", "iran", "syria", "israel", "gaza", "hamas", "houthi", "trump", "이란", "시리아", "이스라엘", "가자", "하마스", "후티", "미국"])
  }
];

function scoreWeeklyContextArticle(item) {
  const bodyText = `${item.title || ""}\n${item.description || ""}\n${item.source || ""}`;
  const queryText = `${item.query || ""}`;
  const fullText = `${bodyText}\n${queryText}`;
  const matched = [];
  const excluded = [];

  for (const rule of WEEKLY_CONTEXT_EXCLUDE_RULES) {
    if (rule.pattern.test(bodyText)) {
      excluded.push(rule.label);
    }
  }

  if (excluded.length) {
    return { score: -999, priority: "excluded", matched, excluded };
  }

  let score = 0;

  for (const rule of WEEKLY_CONTEXT_SCORE_RULES) {
    if (rule.test(bodyText)) {
      score = Math.max(score, rule.score);
      matched.push(rule.label);
    } else if (rule.test(fullText)) {
      score = Math.max(score, Math.round(rule.score * 0.72));
      matched.push(`검색어 보조:${rule.label}`);
    }
  }

  if (hasBismayahKeyword(bodyText)) {
    score = Math.max(score, 95);
    matched.push("비스마야 직접 언급");
  }

  if (hasHanwhaIraqKeyword(bodyText)) {
    score = Math.max(score, 90);
    matched.push("한화+이라크 직접 언급");
  }

  let priority = "low";
  if (score >= 80) priority = "top";
  else if (score >= 65) priority = "high";
  else if (score >= 50) priority = "normal";
  else if (score >= WEEKLY_CONTEXT_MIN_SCORE) priority = "watch";

  return { score, priority, matched, excluded };
}

function weeklyContextArticleMatches(item) {
  const result = scoreWeeklyContextArticle(item);

  item.relevanceScore = result.score;
  item.priority = result.priority;
  item.matchedRules = result.matched;
  item.excludedRules = result.excluded;

  return result.score >= WEEKLY_CONTEXT_MIN_SCORE;
}

const POLITICAL_ACTOR_PATTERNS = [
  { label: "조정프레임워크", terms: ["الإطار التنسيقي", "قوى الإطار التنسيقي", "تحالف الإطار التنسيقي", "coordination framework"] },
  { label: "법치국가연합/말리키", terms: ["ائتلاف دولة القانون", "دولة القانون", "نوري المالكي", "nouri al-maliki", "state of law"] },
  { label: "알수다니/재건발전", terms: ["محمد شياع السوداني", "ائتلاف الإعمار والتنمية", "تحالف الإعمار والتنمية", "تيار الفراتين", "al-sudani"] },
  { label: "사드르계", terms: ["مقتدى الصدر", "التيار الصدري", "الكتلة الصدرية", "sadr"] },
  { label: "친이란/PMF", terms: ["عصائب أهل الحق", "قيس الخزعلي", "منظمة بدر", "هادي العامري", "كتائب حزب الله", "الحشد الشعبي"] },
  { label: "수니 정치권", terms: ["تحالف السيادة", "خميس الخنجر", "محمد الحلبوسي", "حزب تقدم"] },
  { label: "쿠르드 정치권", terms: ["الحزب الديمقراطي الكردستاني", "مسعود بارزاني", "الاتحاد الوطني الكردستاني", "بافل طالباني"] },
  { label: "의회/감사", terms: ["مجلس النواب", "البرلمان العراقي", "لجنة النزاهة", "لجنة الاستثمار", "استجواب", "مساءلة"] }
];

const POLITICAL_ACTION_TERMS = [
  "استجواب",
  "مساءلة",
  "اتهام",
  "اتهم",
  "فساد",
  "النزاهة",
  "انتخابات",
  "تحالف",
  "اجتماع",
  "بيان",
  "البرلمان",
  "مجلس النواب",
  "الحكومة",
  "مجلس الوزراء",
  "استقالة",
  "إقالة",
  "اقالة",
  "questioning",
  "parliament",
  "corruption",
  "election",
  "coalition",
  "government",
  "cabinet"
];

function detectPoliticalActors(text = "") {
  const normalized = normalizeBismayahText(stripArabicDiacritics(String(text || "").toLowerCase()));
  const actors = [];

  for (const actor of POLITICAL_ACTOR_PATTERNS) {
    if (actor.terms.some((term) => normalized.includes(normalizeBismayahText(stripArabicDiacritics(term.toLowerCase()))))) {
      actors.push(actor.label);
    }
  }

  return uniqueStrings(actors);
}

function scorePoliticalActorArticle(item) {
  const bodyText = `${item.title || ""}\n${item.description || ""}\n${item.source || ""}`;
  const queryText = `${item.query || ""}`;
  const fullText = `${bodyText}\n${queryText}`;
  const matched = [];
  const excluded = [];

  for (const rule of WEEKLY_CONTEXT_EXCLUDE_RULES) {
    if (rule.pattern.test(bodyText)) {
      excluded.push(rule.label);
    }
  }

  if (excluded.length) return { score: -999, priority: "excluded", matched, excluded, actors: [] };

  const actors = detectPoliticalActors(fullText);
  let score = actors.length ? 58 : 0;
  if (actors.length) matched.push(...actors.map((actor) => `정치세력:${actor}`));

  if (hasAny(bodyText, POLITICAL_ACTION_TERMS)) {
    score += 18;
    matched.push("정치행위/의회/선거/부패 키워드");
  }

  if (hasAny(bodyText, ["الهيئة الوطنية للاستثمار", "هيئة الاستثمار", "حيدر مكية", "حيدر مكيه", "nic", "national investment commission"])) {
    score += 20;
    matched.push("NIC/투자위원회 연계");
  }

  if (hasAny(bodyText, ["العراق", "بغداد", "iraq", "baghdad"])) score += 8;
  if (hasAny(bodyText, ["مشروع", "استثمار", "سكن", "إعمار", "اعمار", "construction", "investment", "housing"])) score += 8;

  let priority = "low";
  if (score >= 85) priority = "top";
  else if (score >= 70) priority = "high";
  else if (score >= 52) priority = "normal";
  else if (score >= IRAQ_POLITICAL_ACTOR_MIN_SCORE) priority = "watch";

  return { score, priority, matched, excluded, actors };
}

function politicalActorArticleMatches(item) {
  const result = scorePoliticalActorArticle(item);

  item.relevanceScore = result.score;
  item.priority = result.priority;
  item.matchedRules = result.matched;
  item.excludedRules = result.excluded;
  item.politicalActors = result.actors;
  item.reportCategory = "politics";

  return result.score >= IRAQ_POLITICAL_ACTOR_MIN_SCORE;
}

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
        model: OPENAI_SUMMARY_MODEL,
        temperature: 0.2,
        input: [
          {
            role: "system",
            content: [
              "You are a Korean-language Iraq construction and security monitoring analyst.",
              "Read Arabic, English, and Korean news text carefully and prepare structured Korean notes for a weekly construction situation report.",
              "Never invent facts. If the article does not support a point, leave it out or mark it as low relevance.",
              "Return valid JSON only when the user asks for JSON."
            ].join(" ")
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

function normalizeAiArray(value, limit = 3) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanAiText(item)).filter(Boolean).slice(0, limit);
  }

  if (typeof value === "string") {
    return value
      .split(/\n+|(?<=다\.)\s+/)
      .map((item) => cleanAiText(item))
      .filter(Boolean)
      .slice(0, limit);
  }

  return [];
}

function cleanAiText(value = "") {
  return normalizeBismayahText(
    String(value || "")
      .replace(/^[-*·•\s]+/, "")
      .replace(/^☞\s*/, "")
      .replace(/^\*\s*/, "")
      .replace(/^·\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeReportCategory(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (["bismayah", "construction", "politics", "security", "economy", "regional", "other"].includes(v)) return v;
  if (/비스마야|한화|nic|bncp/.test(v)) return "bismayah";
  if (/건설|주택|인프라|construction|housing/.test(v)) return "construction";
  if (/정국|정치|정부|의회|politic|government|parliament/.test(v)) return "politics";
  if (/치안|테러|안보|security|terror|isis|pmf/.test(v)) return "security";
  if (/경제|유가|예산|economy|oil|budget/.test(v)) return "economy";
  if (/국제|중동|regional|iran|syria|israel/.test(v)) return "regional";
  return "other";
}

function normalizeRelevanceValue(value = "", allowed = []) {
  const v = String(value || "").trim().toLowerCase();
  return allowed.includes(v) ? v : allowed[allowed.length - 1];
}

async function enrichArticleKorean(item) {
  if (!OPENAI_API_KEY) {
    return item;
  }

  const articleText = normalizeText(item.cleanText || item.fullText || item.description || "").slice(0, MAX_ARTICLE_TEXT_FOR_AI);
  const sourceText = [
    `원문 제목: ${item.title}`,
    articleText ? `기사 원문/본문: ${articleText}` : "",
    item.description && !articleText ? `기사 설명: ${String(item.description).slice(0, 3500)}` : "",
    item.source ? `출처: ${item.source}` : "",
    item.publishedAt ? `게재일: ${item.publishedAt}` : "",
    item.url ? `URL: ${item.url}` : "",
    item.politicalActors && item.politicalActors.length ? `탐지된 정치세력: ${item.politicalActors.join(", ")}` : "",
    item.matchedRules && item.matchedRules.length
      ? `기계적 관련성 판단: ${item.matchedRules.join(", ")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n");

  const prompts = [
    [
      "아래 이라크/중동 관련 기사 본문을 읽고, 한국 기업의 이라크 건설사업 주간보고서에 활용할 수 있도록 구조화하세요.",
      "반드시 JSON 객체만 출력하세요. 마크다운 코드블록, 설명문, 주석은 금지합니다.",
      "필수 키:",
      "titleKo: 자연스러운 한국어 기사 제목 1개",
      "summaryKo: 기사 핵심을 2~3문장으로 요약. 제목 반복 금지. 원문에 근거한 내용만 작성",
      "detailsKo: 핵심 세부내용 1~3개 배열",
      "reportBullet: 기존 보고서 문체의 본문 bullet 1개. 반드시 '· M.D, 주체, 핵심행위 명사형.' 형태",
      "reportSubBullets: 세부 설명 bullet 0~2개 배열. 각 항목은 '* ...'에 들어갈 문장",
      "reportImplication: 시사점 1문장. '☞'에 들어갈 문장",
      "reportCategory: bismayah/construction/politics/security/economy/regional/other 중 하나",
      "importanceScore: 0~100 정수. 주간보고서 반영 필요성이 높을수록 높게 평가",
      "bismayahRelevance: direct/indirect/none 중 하나",
      "constructionImpact: high/medium/low/none 중 하나",
      "reportUsefulness: include/watch/exclude 중 하나",
      "politicalActors: 기사에 등장한 이라크 정치세력/정당/주요 인물 한국어 배열. 없으면 []",
      "weeklySignal: 이번 주 정세 흐름을 읽는 데 필요한 신호 1문장. 없으면 빈 문자열",
      "possibleImpact: 건설·투자사업 또는 현장운영 영향 1문장. 없으면 빈 문자열",
      "보고서 문체 기준:",
      "- 일반 서술형 종결 금지: '~하였다', '~했다', '~하고 있다', '~하기로 결정하였다' 사용 금지.",
      "- 사건 제목은 '· 7.1, 이라크 의회, NIC 의장 심문 결정.'처럼 '날짜, 주체, 행위 명사형'으로 작성.",
      "- 세부 설명은 '... 조치로 해석', '... 가능성', '... 필요', '... 확대 전망' 등 보고서형 종결 사용.",
      "판단 기준:",
      "- 제목만 보지 말고 기사 원문/본문을 기준으로 판단하세요.",
      "- 비스마야, 한화, NIC, COM, 국가투자위원회, 이라크 주택사업, 건설·인프라, 바그다드 치안, IS, PMF, 의회, 내각회의, 국제유가, 이란·시리아·이스라엘 정세는 중요도 상향.",
      "- 조정프레임워크, 법치국가연합/말리키, 알수다니 측, 사드르계, PMF/친이란 세력, 수니·쿠르드 정당 활동은 politics로 분류하고 weeklySignal을 작성.",
      "- 단순 사건사고, 스포츠, 일반 범죄, 사업 영향이 약한 단신은 importanceScore를 낮추고 reportUsefulness를 watch 또는 exclude로 설정하세요.",
      "- 기사에 없는 사실, 숫자, 인과관계는 절대 만들지 마세요.",
      "- 아랍어 원문을 titleKo/summaryKo/detailsKo/reportBullet/reportSubBullets/reportImplication에 그대로 남기지 마세요.",
      "- بسماية, بسمايه, بسمایه, Bismayah, Bismaya, Basmaya는 항상 '비스마야'로 번역하세요."
    ].join("\n"),
    [
      "이전 응답 형식이 잘못되었거나 한국어 보고서용 요약이 부족합니다. 다시 작성하세요.",
      "반드시 JSON 객체만 출력하세요.",
      "titleKo, summaryKo, detailsKo, reportBullet, reportSubBullets, reportImplication, reportCategory, importanceScore, bismayahRelevance, constructionImpact, reportUsefulness, politicalActors, weeklySignal, possibleImpact를 모두 포함하세요.",
      "한국어 필드에는 아랍어 문자가 절대 포함되면 안 됩니다.",
      "기사에 없는 내용은 만들지 마세요."
    ].join("\n")
  ];

  for (const prompt of prompts) {
    const raw = await aiKorean(prompt, sourceText);
    const parsed = parseJsonObject(raw);

    if (isGoodKoreanTranslation(parsed)) {
      const importanceScore = clampNumber(parsed.importanceScore, 0, 100, Number(item.relevanceScore || 50));
      const reportCategory = normalizeReportCategory(parsed.reportCategory);
      const parsedUsefulness = String(parsed.reportUsefulness || "").trim().toLowerCase();
      const reportUsefulness = ["include", "watch", "exclude"].includes(parsedUsefulness) ? parsedUsefulness : "watch";

      return {
        ...item,
        titleKo: cleanAiText(parsed.titleKo),
        summaryKo: cleanAiText(parsed.summaryKo),
        detailsKo: normalizeAiArray(parsed.detailsKo, 3),
        reportBullet: cleanAiText(parsed.reportBullet),
        reportSubBullets: normalizeAiArray(parsed.reportSubBullets, 2),
        reportImplication: cleanAiText(parsed.reportImplication),
        politicalActors: normalizeAiArray(parsed.politicalActors || item.politicalActors, 8),
        weeklySignal: cleanAiText(parsed.weeklySignal),
        possibleImpact: cleanAiText(parsed.possibleImpact),
        reportCategory,
        importanceScore,
        importance_score: importanceScore,
        bismayahRelevance: normalizeRelevanceValue(parsed.bismayahRelevance, ["direct", "indirect", "none"]),
        constructionImpact: normalizeRelevanceValue(parsed.constructionImpact, ["high", "medium", "low", "none"]),
        reportUsefulness,
        aiSummaryVersion: "report-structured-v2-fulltext-politics",
        priority: importanceScore >= 85 ? "top" : importanceScore >= 70 ? "high" : importanceScore >= 50 ? "normal" : "watch"
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

      if (category === "weeklyContext") {
        items = items.filter(weeklyContextArticleMatches);
      }

      if (category === "politicalActors") {
        items = items.filter(politicalActorArticleMatches);
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

  if (category === "overseas") {
    try {
      const local = await collectIraqMediaSites();
      all.push(...local.articles);
      debug.push({
        source: "iraq-media-sites",
        ok: true,
        sourceCount: local.sourceCount,
        beforeFilter: local.beforeFilter,
        afterFilter: local.articles.length,
        details: local.debug
      });
      console.log(`[overseas] iraq-media-sites: ${local.articles.length}/${local.beforeFilter}`);
    } catch (err) {
      debug.push({
        source: "iraq-media-sites",
        ok: false,
        error: String(err.message || err)
      });
      console.warn(`[overseas] iraq-media-sites: ${err.message || err}`);
    }
  }

  let articles = uniqueRecent(all, cfg.maxTotal || MAX_TOTAL);

  if (OPENAI_API_KEY && ["overseas", "weeklyContext", "politicalActors"].includes(category)) {
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
    maxTotal: cfg.maxTotal || MAX_TOTAL,
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    summaryModel: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none",
    domesticMinScore: category === "domestic" ? DOMESTIC_MIN_SCORE : undefined,
    overseasMinScore: category === "overseas" ? OVERSEAS_MIN_SCORE : undefined,
    weeklyContextMinScore: category === "weeklyContext" ? WEEKLY_CONTEXT_MIN_SCORE : undefined,
    politicalActorMinScore: category === "politicalActors" ? IRAQ_POLITICAL_ACTOR_MIN_SCORE : undefined,
    count: articles.length,
    queries: cfg.queries,
    debug,
    articles
  };
}

async function collectSnsPlaceholder() {
  return {
    category: "sns",
    label: "SNS",
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: "curated-sources-required",
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    summaryModel: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none",
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
    summaryModel: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none",
    count: 0,
    messageKo:
      "COM 주요활동은 data/com-activities.json 및 assets/com-patch.js 기준으로 별도 수집/표시합니다. 이 파일은 과거 호환용 placeholder입니다.",
    articles: []
  };
}

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

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const index = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    summaryModel: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none",
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
