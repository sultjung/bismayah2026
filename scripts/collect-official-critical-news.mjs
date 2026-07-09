#!/usr/bin/env node
/**
 * Official / critical Iraq news watcher for Bismayah monitor.
 *
 * This small companion collector catches high-impact official and local-media
 * articles that may be missed by Google News RSS or by generic sitemap limits.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OVERSEAS_FILE = path.join(DATA_DIR, "overseas-news.json");
const LOOKBACK_DAYS = Number(process.env.OFFICIAL_CRITICAL_LOOKBACK_DAYS || 14);
const MAX_URLS_PER_SOURCE = Number(process.env.OFFICIAL_CRITICAL_MAX_URLS_PER_SOURCE || 80);
const FETCH_DELAY_MS = Number(process.env.OFFICIAL_CRITICAL_FETCH_DELAY_MS || 120);

const CRITICAL_SOURCES = [
  {
    id: "alsumaria-politics",
    name: "Al-Sumaria TV",
    baseUrl: "https://www.alsumaria.tv/",
    seedUrls: [
      "https://www.alsumaria.tv/news/politics/569565/%D8%A7%D9%84%D8%A8%D8%B1%D9%84%D9%85%D8%A7%D9%86-%D9%8A%D9%8F%D8%B5%D9%88%D8%AA-%D8%B9%D9%84%D9%89-%D8%A5%D8%B9%D9%81%D8%A7%D8%A1-%D8%B1%D8%A6%D9%8A%D8%B3-%D8%A7%D9%84%D9%87%D9%8A%D8%A6%D8%A9-%D8%A7%D9%84%D9%88%D8%B7%D9%86%D9%8A%D8%A9-%D9%84%D9%84%D8%A7%D8%B3%D8%AA%D8%AB%D9%85%D8%A7%D8%B1-%D9%85%D9%86-%D9%85%D9%86%D8%B5%D8%A8%D9%87-%D9%88%D8%A5%D8%AD%D8%A7%D9%84%D8%A9"
    ],
    listPages: [
      "https://www.alsumaria.tv/news",
      "https://www.alsumaria.tv/news/politics"
    ]
  },
  {
    id: "iraq-parliament",
    name: "Iraqi Parliament",
    baseUrl: "https://iq.parliament.iq/",
    seedUrls: [
      "https://iq.parliament.iq/blog/%d9%85%d8%ac%d9%84%d8%b3-%d8%a7%d9%84%d9%86%d9%88%d8%a7%d8%a8-%d9%8a%d8%b5%d9%88%d8%aa-%d8%b9%d9%84%d9%89-%d8%a7%d8%b9%d9%81%d8%a7%d8%a1-%d8%b1%d8%a6%d9%8a%d8%b3-%d8%a7%d9%84%d9%87%d9%8a%d8%a6%d8%a9/"
    ],
    listPages: [
      "https://iq.parliament.iq/",
      "https://iq.parliament.iq/blog/"
    ]
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeUrl(url = "") {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url || "";
  }
}

function hostnameOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sameHost(url = "", baseUrl = "") {
  const a = hostnameOf(url);
  const b = hostnameOf(baseUrl);
  return a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

function toAbsoluteUrl(href = "", baseUrl = "") {
  try {
    return normalizeUrl(new URL(decodeHtml(href), baseUrl).toString());
  } catch {
    return "";
  }
}

function stripArabicDiacritics(value = "") {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "");
}

function hasAny(value = "", terms = []) {
  const hay = stripArabicDiacritics(String(value || "")).toLowerCase();
  return terms.some((term) => {
    const needle = stripArabicDiacritics(String(term || "")).toLowerCase();
    return needle && hay.includes(needle);
  });
}

function hasBismayah(value = "") {
  const text = stripArabicDiacritics(String(value || ""));
  return (
    /(^|[^\u0600-\u06FF])ب[\u0640\s]*س[\u0640\s]*م[\u0640\s]*ا[\u0640\s]*[يىی][\u0640\s]*[ةه](?=$|[^\u0600-\u06FF])/.test(text) ||
    /\b(bismayah|bismaya|basmaya|bncp)\b/i.test(text) ||
    /비스마야/.test(text)
  );
}

function hasHanwha(value = "") {
  return /hanwha|هانوا|한화/i.test(stripArabicDiacritics(String(value || "")));
}

function looksLikeCriticalArticleUrl(url = "", source = {}) {
  if (!sameHost(url, source.baseUrl || "")) return false;

  try {
    const u = new URL(url);
    const pathName = decodeURIComponent(u.pathname || "").toLowerCase();

    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|rar|mp4|mp3|woff2?)$/i.test(pathName)) return false;
    if (/\/(tag|tags|category|author|search|login|privacy|about|contact)(\/|$)/i.test(pathName)) return false;

    if (source.id === "alsumaria-politics") {
      return /\/news\//i.test(pathName) && /\d{3,}/.test(pathName);
    }

    if (source.id === "iraq-parliament") {
      return /\/blog\//i.test(pathName) && pathName.split("/").filter(Boolean).length >= 2;
    }

    return /\/(article|articles|news|story|details|blog)\//i.test(pathName) && /\d{3,}|[\u0600-\u06FF]/.test(pathName);
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Bismayah Official Critical News Watcher GitHub Actions",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
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
  return [...new Set(urls)];
}\n
function extractMetaContent(html = "", names = []) {
  for (const name of names) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, "i")
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
  const candidates = [
    extractMetaContent(html, ["article:published_time", "article:modified_time", "datePublished", "dateModified", "pubdate", "date"]),
    (String(html || "").match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1] || "",
    (String(html || "").match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i) || [])[1] || "",
    fallback
  ];

  for (const value of candidates) {
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const text = stripTags(html);
  const numericDate = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (numericDate) {
    const [, y, m, d] = numericDate;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 9, 0, 0));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
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
    .slice(0, 120);

  const text = paragraphs.length >= 2 ? paragraphs.join("\n") : stripTags(body);
  return decodeHtml(text)
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 12000);
}

function parseArticle(html = "", url = "", source = {}) {
  const title =
    extractMetaContent(html, ["og:title", "twitter:title", "title"]) ||
    extractFirstTagText(html, "h1") ||
    extractFirstTagText(html, "title");
  const cleanText = extractReadableText(html);
  const description = [
    extractMetaContent(html, ["og:description", "twitter:description", "description"]),
    cleanText.slice(0, 2400)
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 3200);

  if (!title || title.length < 4) return null;

  return {
    title,
    source: source.name,
    publishedAt: extractPublishedAt(html),
    url: normalizeUrl(url),
    description,
    cleanText,
    fullText: cleanText,
    originalTextLength: cleanText.length
  };
}

function isRecent(publishedAt = "") {
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  return d >= cutoff;
}

function classifyCritical(article = {}) {
  const text = `${article.title || ""}\n${article.description || ""}\n${article.fullText || ""}`;
  const bismayah = hasBismayah(text);
  const hanwha = hasHanwha(text);
  const nic = hasAny(text, [
    "الهيئة الوطنية للاستثمار",
    "هيئة الاستثمار",
    "رئيس هيئة الاستثمار",
    "رئيس الهيئة الوطنية للاستثمار",
    "حيدر مكية",
    "حيدر مكيه",
    "National Investment Commission",
    "NIC",
    "국가투자위원회"
  ]);
  const oversight = hasAny(text, [
    "مجلس النواب",
    "البرلمان",
    "استجواب",
    "يستجوب",
    "إعفاء",
    "اعفاء",
    "إقالة",
    "اقالة",
    "النزاهة",
    "فساد",
    "لجنة الاستثمار",
    "parliament",
    "questioning",
    "interrogation",
    "dismissal",
    "integrity",
    "corruption",
    "의회",
    "심문",
    "해임"
  ]);

  if (bismayah || hanwha || (nic && oversight)) {
    return { matched: true, bismayah, hanwha, nic, oversight };
  }
  return { matched: false, bismayah, hanwha, nic, oversight };
}

function koFields(article = {}, signal = {}) {
  const text = `${article.title || ""}\n${article.description || ""}\n${article.fullText || ""}`;
  const removal = hasAny(text, ["إعفاء", "اعفاء", "إقالة", "اقالة", "منصبه"]);
  const questioning = hasAny(text, ["استجواب", "يستجوب", "مساءلة", "questioning", "interrogation"]);
  const integrity = hasAny(text, ["النزاهة", "integrity", "corruption", "فساد"]);

  if (signal.nic && removal) {
    return {
      titleKo: "이라크 의회, 국가투자위원회 의장 해임 표결",
      summaryKo: "이라크 의회가 국가투자위원회(NIC) 의장 하이더 마키야 해임을 표결하고 관련 파일을 연방청렴위원회에 이첩했다는 내용이다. NIC는 비스마야·한화 관련 투자 행정의 직접 상대 기관이므로 최상위 중요 뉴스로 분류된다.",
      detailsKo: [
        "이라크 의회가 NIC 의장 해임을 표결함.",
        integrity ? "관련 파일을 연방청렴위원회에 이첩한 것으로 보도됨." : "의회 차원의 투자기관 책임 추궁 흐름으로 해석됨.",
        "비스마야 및 한화 관련 투자 행정 리스크와 직접 연계되는 사안임."
      ],
      reportBullet: "7.9, 이라크 의회, NIC 의장 해임 표결.",
      reportSubBullets: [
        "국가투자위원회 의장 하이더 마키야 해임 및 관련 파일 이첩 조치.",
        "비스마야·한화 관련 투자 행정의 의사결정 라인 변동 가능성 확대."
      ],
      reportImplication: "NIC 수장 공백 및 후속 조사 흐름에 따라 비스마야 관련 행정 처리 지연 또는 정책 방향 변경 가능성 점검 필요."
    };
  }

  if (signal.nic && questioning) {
    return {
      titleKo: "이라크 의회, 국가투자위원회 의장 심문 진행",
      summaryKo: "이라크 의회가 국가투자위원회(NIC) 의장에 대한 심문·감시 절차를 진행했다는 내용이다. 투자기관 운영과 비스마야 관련 행정 리스크를 확인해야 하는 중요 뉴스로 분류된다.",
      detailsKo: [
        "이라크 의회가 NIC 의장에 대한 심문 절차를 진행함.",
        "투자기관 운영상 위법·행정 리스크 점검 흐름으로 해석됨.",
        "비스마야 관련 후속 승인·협의 일정에 영향 가능성 있음."
      ],
      reportBullet: "7.9, 이라크 의회, NIC 의장 심문 진행.",
      reportSubBullets: [
        "NIC 의장에 대한 의회 감시·심문 절차 진행.",
        "투자 행정 신뢰도 및 후속 의사결정에 영향 가능."
      ],
      reportImplication: "NIC 관련 정치·행정 리스크 확대 가능성이 있어 비스마야 현안 처리 동향 모니터링 필요."
    };
  }

  if (signal.bismayah) {
    return {
      titleKo: "비스마야 관련 이라크 현지 핵심 보도",
      summaryKo: "비스마야를 직접 언급한 이라크 현지 보도이다. 사업 영향 가능성이 있어 우선 확인 대상으로 분류된다.",
      detailsKo: ["비스마야 직접 언급 기사.", "사업 영향 가능성 확인 필요."],
      reportBullet: "비스마야 관련 이라크 현지 보도 확인.",
      reportSubBullets: ["비스마야 직접 언급으로 우선 모니터링 필요."],
      reportImplication: "사업 관련 영향 여부 확인 필요."
    };
  }

  return {
    titleKo: "이라크 투자기관 관련 핵심 보도",
    summaryKo: "이라크 투자기관 또는 투자 행정과 관련된 핵심 보도이다. 비스마야 사업과 간접 연관성이 있어 모니터링 대상으로 분류된다.",
    detailsKo: ["이라크 투자기관 관련 기사.", "비스마야 사업 간접 영향 가능성 확인 필요."],
    reportBullet: "이라크 투자기관 관련 핵심 보도 확인.",
    reportSubBullets: ["투자 행정 변화 가능성 점검 필요."],
    reportImplication: "비스마야 관련 행정·정책 영향 가능성 확인 필요."
  };
}

function toNewsItem(article = {}, source = {}, signal = {}) {
  const ko = koFields(article, signal);
  const relevanceScore = signal.bismayah || signal.hanwha ? 100 : 95;
  const priority = relevanceScore >= 95 ? "top" : "high";

  return {
    title: article.title,
    titleKo: ko.titleKo,
    summaryKo: ko.summaryKo,
    source: article.source || source.name || "Official Iraq source",
    publishedAt: article.publishedAt,
    url: article.url,
    query: "official-critical-watch",
    category: "overseas",
    description: article.description,
    cleanText: article.cleanText,
    fullText: article.fullText,
    originalTextLength: article.originalTextLength,
    relevanceScore,
    priority,
    matchedRules: [
      "공식/현지 핵심 소스 직접 감시",
      signal.bismayah ? "비스마야 직접 언급" : "NIC/투자위원회 의회 감시·해임",
      signal.hanwha ? "한화 직접 언급" : "투자 행정 리스크"
    ].filter(Boolean),
    excludedRules: [],
    detailsKo: ko.detailsKo,
    reportBullet: ko.reportBullet,
    reportSubBullets: ko.reportSubBullets,
    reportImplication: ko.reportImplication,
    politicalActors: ["이라크 의회", "국가투자위원회", "하이더 마키야"],
    weeklySignal: "이라크 투자 행정 및 NIC 관련 정치 리스크 확대 신호.",
    possibleImpact: "비스마야·한화 관련 승인, 협의, 행정 처리 일정에 영향 가능성 있음.",
    reportCategory: "politics",
    importanceScore: 95,
    importance_score: 95,
    bismayahRelevance: signal.bismayah || signal.hanwha ? "direct" : "indirect",
    constructionImpact: "high",
    reportUsefulness: "include",
    country: "Iraq",
    language: "ar",
    collection_method: "official-critical-direct",
    sourceType: "official-critical-direct",
    aiSummaryVersion: "official-critical-v1"
  };
}

async function collectSource(source) {
  const debug = { id: source.id, name: source.name, candidates: 0, parsed: 0, matched: 0, errors: [] };
  const candidates = new Set((source.seedUrls || []).map(normalizeUrl));

  for (const listUrl of source.listPages || []) {
    try {
      await sleep(FETCH_DELAY_MS);
      if (looksLikeCriticalArticleUrl(listUrl, source)) candidates.add(normalizeUrl(listUrl));
      const html = await fetchText(listUrl);
      for (const url of extractUrlsFromHtml(html, listUrl)) {
        if (looksLikeCriticalArticleUrl(url, source)) candidates.add(normalizeUrl(url));
        if (candidates.size >= MAX_URLS_PER_SOURCE) break;
      }
    } catch (err) {
      debug.errors.push({ url: listUrl, error: String(err.message || err).slice(0, 180) });
    }
  }

  const items = [];
  debug.candidates = candidates.size;

  for (const url of [...candidates].slice(0, MAX_URLS_PER_SOURCE)) {
    try {
      await sleep(FETCH_DELAY_MS);
      const html = await fetchText(url);
      const article = parseArticle(html, url, source);
      if (!article) continue;
      debug.parsed += 1;
      if (!isRecent(article.publishedAt)) continue;
      const signal = classifyCritical(article);
      if (!signal.matched) continue;
      debug.matched += 1;
      items.push(toNewsItem(article, source, signal));
    } catch (err) {
      debug.errors.push({ url, error: String(err.message || err).slice(0, 180) });
    }
  }

  return { items, debug };
}

function itemKey(item = {}) {
  return normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || String(item.title || "").toLowerCase().trim();
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const collected = [];
  const debug = [];
  for (const source of CRITICAL_SOURCES) {
    const result = await collectSource(source);
    collected.push(...result.items);
    debug.push(result.debug);
    console.log(`[official-critical] ${source.name}: ${result.debug.matched}/${result.debug.parsed} matched`);
  }

  if (!collected.length) {
    console.log("[official-critical] no new critical items matched");
    return;
  }

  const data = await readJson(OVERSEAS_FILE, {
    category: "overseas",
    label: "이라크 언론사",
    sourceType: "google-news-rss+iraq-media-sites+official-critical",
    articles: []
  });

  const existingArticles = Array.isArray(data.articles) ? data.articles : [];
  const map = new Map();
  for (const item of existingArticles) map.set(itemKey(item), item);
  for (const item of collected) map.set(itemKey(item), item);

  const maxTotal = Number(data.maxTotal || 250);
  const articles = [...map.values()]
    .sort((a, b) => {
      const ia = Number(b.importanceScore || b.importance_score || b.relevanceScore || 0) - Number(a.importanceScore || a.importance_score || a.relevanceScore || 0);
      if (ia) return ia;
      const rs = Number(b.relevanceScore || 0) - Number(a.relevanceScore || 0);
      if (rs) return rs;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, maxTotal);

  const next = {
    ...data,
    category: "overseas",
    label: data.label || "이라크 언론사",
    generatedAt: new Date().toISOString(),
    sourceType: String(data.sourceType || "google-news-rss+iraq-media-sites") + (String(data.sourceType || "").includes("official-critical") ? "" : "+official-critical"),
    count: articles.length,
    officialCriticalCount: collected.length,
    officialCriticalDebug: debug,
    articles
  };

  await fs.writeFile(OVERSEAS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[official-critical] merged ${collected.length} critical items into ${OVERSEAS_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
