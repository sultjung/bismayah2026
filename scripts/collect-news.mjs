#!/usr/bin/env node
/**
 * Bismayah / Hanwha Iraq News Collector v11
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 60);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 30);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 250);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const IRAQ_MEDIA_SOURCES_FILE = path.join(DATA_DIR, "iraq-media-sources.json");
const MAX_LOCAL_URLS_PER_SOURCE = Number(process.env.MAX_LOCAL_URLS_PER_SOURCE || 45);
const MAX_LOCAL_ARTICLES_TOTAL = Number(process.env.MAX_LOCAL_ARTICLES_TOTAL || 120);
const LOCAL_FETCH_DELAY_MS = Number(process.env.LOCAL_FETCH_DELAY_MS || 150);


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

function extractArticleDescription(html = "") {
  const meta = extractMetaContent(html, ["og:description", "twitter:description", "description"]);
  const paragraphs = [...String(html || "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((text) => text.length >= 25)
    .slice(0, 10)
    .join(" ");

  const fallback = stripTags(html).slice(0, 2500);
  return [meta, paragraphs || fallback].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 3000);
}

function parseArticleHtml(html = "", url = "", source = {}, fallbackDate = "") {
  const title =
    extractMetaContent(html, ["og:title", "twitter:title", "title"]) ||
    extractFirstTagText(html, "h1") ||
    extractFirstTagText(html, "title");

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
  if (candidate.rssItem) return candidate.rssItem;

  await delay(LOCAL_FETCH_DELAY_MS);

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

  if (OPENAI_API_KEY && ["overseas", "weeklyContext"].includes(category)) {
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
    domesticMinScore: category === "domestic" ? DOMESTIC_MIN_SCORE : undefined,
    overseasMinScore: category === "overseas" ? OVERSEAS_MIN_SCORE : undefined,
    weeklyContextMinScore: category === "weeklyContext" ? WEEKLY_CONTEXT_MIN_SCORE : undefined,
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
