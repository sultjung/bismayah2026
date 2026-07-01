#!/usr/bin/env node
/**
 * Bismayah / Hanwha Iraq News Collector v7
 *
 * Output:
 *   data/domestic-news.json   Korean media
 *   data/overseas-news.json   Arabic / Iraq-focused media
 *   data/sns-news.json        Curated SNS only; no noisy generic search
 *   data/com-news.json        Iraqi Cabinet daily government activities
 *   data/news-index.json
 *
 * v6 fixes:
 *   - Domestic keywords are editable at the top of this file.
 *   - Domestic results are post-filtered by article title to avoid false positives from related links.
 *
 * Optional:
 *   If GitHub Secret OPENAI_API_KEY exists, titles/summaries are translated/summarized to Korean.
 *   If it does not exist, collection still works but Korean summaries may be empty.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 7);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 10);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 80);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================
// 사용자가 직접 수정하는 영역
// ============================================================

// 국내 언론 검색어.
// 원칙:
// 1) 비스마야 / 한화+이라크 / 이라크+사업·건설·투자 → 최우선
// 2) 이라크 관련 경제·건설·투자 기사 → 수집
// 3) 한화 건설부문·건설·인프라 관련 기사 → 수집
// 4) 축구, 야구, 한화이글스 등 스포츠성 기사는 제외
const DOMESTIC_KEYWORDS = [
  "비스마야",
  "\"한화\" \"이라크\"",
  "\"이라크\" \"사업\"",
  "\"이라크\" \"건설\"",
  "\"이라크\" \"투자\"",
  "\"한화\" \"건설\"",
  "\"한화 건설부문\"",
  "\"한화\" \"인프라\"",
  "\"한화\" \"플랜트\""
];

// 국내 언론 검색 결과를 채택하기 위한 최소 관련성 점수
// 너무 많이 잡히면 20~25로 올리고, 너무 적게 잡히면 10~15로 낮추세요.
const DOMESTIC_MIN_SCORE = 15;

// 최우선 관련 키워드: 발견되면 높은 점수
const DOMESTIC_PRIORITY_RULES = [
  { terms: ["비스마야"], score: 100, label: "비스마야" },
  { terms: ["bismayah"], score: 100, label: "Bismayah" },
  { terms: ["한화", "이라크"], score: 90, label: "한화+이라크" },
  { terms: ["한화건설", "이라크"], score: 90, label: "한화건설+이라크" },
  { terms: ["이라크", "비스마야"], score: 90, label: "이라크+비스마야" },
  { terms: ["이라크", "신도시"], score: 75, label: "이라크+신도시" },
  { terms: ["이라크", "사업"], score: 60, label: "이라크+사업" },
  { terms: ["이라크", "건설"], score: 60, label: "이라크+건설" },
  { terms: ["이라크", "투자"], score: 55, label: "이라크+투자" },
  { terms: ["이라크", "인프라"], score: 55, label: "이라크+인프라" }
];

// 일반 관련 키워드: 평소에도 보고 싶은 기사
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

// 제외 키워드: 스포츠/야구/축구 등 잡음 제거
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

// 글로벌 언론 검색어. 아랍어 기사만 원하면 영어 검색어를 지우고 아랍어만 남기세요.
const OVERSEAS_KEYWORDS = [
  "\"بسماية\"",
  "\"بسماية\" \"هانوا\"",
  "\"بسماية\" \"شركة هانوا\"",
  "\"مشروع بسماية\"",
  "\"مدينة بسماية الجديدة\"",
  "\"الهيئة الوطنية للاستثمار\" \"بسماية\"",
  "\"العراق\" \"بسماية\"",
  "\"بغداد\" \"بسماية\"",
  "\"السوداني\" \"بسماية\""
];


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

const COM_CONFIG = {
  output: "com-news.json",
  sourceUrl: "https://cabinet.iq/ar/category/activities",
  categoryLabel: "COM 주요활동",
  priorityKeywordsAr: [
    "إعمار", "اعمار", "بناء", "إنشاء", "انشاء", "مشروع", "مشاريع", "استثمار",
    "سكن", "إسكان", "اسكان", "بنى تحتية", "البنى التحتية", "طرق", "جسور",
    "مجاري", "صرف صحي", "بلديات", "إحالة", "احالة", "عقد", "تنفيذ",
    "وزارة الإعمار", "وزارة التخطيط", "هيئة الاستثمار", "الهيئة الوطنية للاستثمار"
  ]
};

function cutoffDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - DAYS);
  return d;
}

function hasArabic(s = "") {
  return /[\u0600-\u06FF]/.test(s);
}

function decodeHtml(s = "") {
  return String(s)
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

function stripTags(s = "") {
  return decodeHtml(String(s).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function extractTag(xml, tag) {
  const m = String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1]) : "";
}

function normalizeSearchText(s = "") {
  return decodeHtml(s)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[·ㆍ|,，.。:：;；/\\()[\]{}<>「」『』【】\\-–—_]+/g, " ")
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

function scoreDomesticArticle(item) {
  // Google News RSS만으로는 실제 기사 본문 전체를 안정적으로 읽기 어렵습니다.
  // 그래서 제목(title)과 Google News 설명(description)을 함께 보되,
  // 제목에 걸린 경우 더 높은 가중치를 줍니다.
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

function normalizeUrl(url) {
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

function canonicalKey(item) {
  const urlKey = normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const titleKey = (item.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  return urlKey || titleKey;
}

function googleNewsRssUrl(query, cfg) {
  const q = `${query} when:${DAYS}d`;
  const params = new URLSearchParams({ q, hl: cfg.lang, gl: cfg.gl, ceid: cfg.ceid });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function guessSourceFromTitle(title = "") {
  const parts = title.split(" - ");
  return parts.length >= 2 ? parts[parts.length - 1].trim() : "";
}

function parseRssItems(xml, query, category) {
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
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
      description
    };
  }).filter((item) => item.title && item.url);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Bismayah News Monitor GitHub Actions",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function uniqueRecent(items) {
  const cutoff = cutoffDate();
  const map = new Map();

  for (const item of items) {
    if (item.publishedAt) {
      const d = new Date(item.publishedAt);
      if (!Number.isNaN(d.getTime()) && d < cutoff) continue;
    }
    const key = canonicalKey(item);
    if (!map.has(key)) map.set(key, item);
  }

  return [...map.values()]
    .sort((a, b) => {
      const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
      if (scoreDiff) return scoreDiff;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, MAX_TOTAL);
}

async function aiKorean(prompt, input) {
  if (!OPENAI_API_KEY) return "";

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
            content: "You translate and summarize Arabic, English, and Korean news into concise business Korean. Do not invent facts."
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
    if (data.output_text) return String(data.output_text).trim();

    const chunks = [];
    for (const out of data.output || []) {
      for (const c of out.content || []) {
        if (c.text) chunks.push(c.text);
      }
    }
    return chunks.join("\n").trim();
  } catch (err) {
    console.warn(`[openai] ${err.message || err}`);
    return "";
  }
}

async function enrichArticleKorean(item) {
  const sourceText = [
    `제목: ${item.title}`,
    item.description ? `설명: ${item.description}` : "",
    item.source ? `출처: ${item.source}` : ""
  ].filter(Boolean).join("\n");

  if (!OPENAI_API_KEY) return item;

  const ko = await aiKorean(
    "아래 뉴스 항목을 한국어로 번역/요약해줘. 출력은 JSON이 아니라 두 줄만:\n제목: ...\n요약: ...",
    sourceText
  );

  const titleMatch = ko.match(/제목\s*:\s*(.+)/);
  const summaryMatch = ko.match(/요약\s*:\s*([\s\S]+)/);
  return {
    ...item,
    titleKo: titleMatch ? titleMatch[1].trim() : "",
    summaryKo: summaryMatch ? summaryMatch[1].trim() : ""
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
        // Google News RSS can return a page because related links contain the keyword.
        // To avoid that, domestic news is accepted only when the article title itself matches.
        items = items.filter(domesticArticleMatches);
      }

      if (category === "overseas") {
        // Keep Arabic/Iraq-focused results. Allow Bismayah/Hanwha English terms, but reject obvious sports/betting noise.
        items = items.filter((it) => {
          const blob = `${it.title} ${it.description} ${it.source}`.toLowerCase();
          if (/ladbrokes|betting|odds|fixture|score|vs iraq|senegal vs iraq|youtube|tiktok/.test(blob)) return false;
          return hasArabic(blob) || /bismayah|hanwha|bncp/i.test(blob);
        });
      }

      all.push(...items);
      debug.push({ query, ok: true, beforeFilter, afterFilter: items.length });
      console.log(`[${category}] ${query}: ${items.length}/${beforeFilter}`);
    } catch (err) {
      debug.push({ query, ok: false, error: String(err.message || err) });
      console.warn(`[${category}] ${query}: ${err.message || err}`);
    }
  }

  let articles = uniqueRecent(all);

  if (OPENAI_API_KEY && category === "overseas") {
    articles = await mapLimit(articles, 3, enrichArticleKorean);
  }

  return {
    category,
    label: cfg.categoryLabel,
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: cfg.type,
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    domesticMinScore: category === "domestic" ? DOMESTIC_MIN_SCORE : undefined,
    count: articles.length,
    queries: cfg.queries,
    debug,
    articles
  };
}

function parseCabinetDate(title = "", fallback = "") {
  // Arabic dates on cabinet.iq look like: 24- 6- 2026 or 28-6-2026
  const m = title.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(20\d{2})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00.000Z`;
  }

  const d = new Date(fallback);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function parseLinksFromHtml(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = stripTags(m[2]);
    if (!href || !text) continue;
    try {
      const url = new URL(href, baseUrl).toString();
      links.push({ url: normalizeUrl(url), title: text });
    } catch {}
  }
  return links;
}

function parseMetaDate(html) {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /datetime=["']([^"']+)["']/i
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return "";
}

function extractMainText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

  // Prefer Arabic paragraphs/list items.
  const chunks = [];
  const re = /<(p|li|h1|h2|h3|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(text))) {
    const s = stripTags(m[2]);
    if (s && hasArabic(s) && s.length > 15) chunks.push(s);
  }
  return [...new Set(chunks)].join("\n").slice(0, 8000);
}

function priorityScore(text = "") {
  const t = text.toLowerCase();
  let score = 0;
  for (const kw of COM_CONFIG.priorityKeywordsAr) {
    if (t.includes(kw.toLowerCase())) score += 1;
  }
  return score;
}

function fallbackArabicBullets(text = "") {
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const preferred = lines.filter(line => priorityScore(line) > 0).slice(0, 3);
  const picked = preferred.length ? preferred : lines.slice(0, 3);
  return picked.join("\n");
}

async function summarizeComItem(item) {
  const blob = `제목: ${item.title}\n본문:\n${item.rawText}`;

  if (!OPENAI_API_KEY) {
    return {
      ...item,
      summaryKo: "",
      rawSummary: fallbackArabicBullets(item.rawText)
    };
  }

  const summaryKo = await aiKorean(
    [
      "아래 이라크 내각 사무처의 일일 정부활동 내용을 한국어로 3줄 이내로 요약해줘.",
      "우선순위는 1) 건설사업 2) 투자사업 3) 주택/도시/인프라 사업 4) 그 외 주요 부처활동 순서야.",
      "관련 내용이 없으면 전체 주요활동만 간단히 요약해.",
      "출력은 한국어 bullet 3개 이하만."
    ].join("\n"),
    blob
  );

  return { ...item, summaryKo };
}

async function collectComActivities() {
  const debug = [];
  let html = "";
  try {
    html = await fetchText(COM_CONFIG.sourceUrl);
  } catch (err) {
    return {
      category: "com",
      label: COM_CONFIG.categoryLabel,
      generatedAt: new Date().toISOString(),
      lookbackDays: DAYS,
      sourceType: "cabinet.iq",
      translatedBy: OPENAI_API_KEY ? "openai" : "none",
      count: 0,
      sourceUrl: COM_CONFIG.sourceUrl,
      debug: [{ ok: false, error: String(err.message || err) }],
      articles: []
    };
  }

  const links = parseLinksFromHtml(html, COM_CONFIG.sourceUrl)
    .filter((l) => /تقرير|النشاطات|الحكومية|يوم/i.test(l.title) || /category\//.test(l.url))
    .filter((l) => !l.url.endsWith("/activities"))
    .slice(0, 12);

  const seen = new Set();
  let items = [];
  for (const l of links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);

    try {
      const page = await fetchText(l.url);
      const metaDate = parseMetaDate(page);
      const publishedAt = parseCabinetDate(l.title, metaDate);
      const rawText = extractMainText(page);
      const score = priorityScore(`${l.title}\n${rawText}`);

      if (!rawText && !l.title) continue;

      items.push({
        title: l.title,
        titleKo: "",
        summaryKo: "",
        rawSummary: "",
        source: "الأمانة العامة لمجلس الوزراء",
        publishedAt,
        url: l.url,
        query: "cabinet.iq/ar/category/activities",
        category: "com",
        priorityScore: score,
        rawText
      });

      debug.push({ title: l.title, ok: true, url: l.url, priorityScore: score });
    } catch (err) {
      debug.push({ title: l.title, ok: false, url: l.url, error: String(err.message || err) });
    }
  }

  items = uniqueRecent(items)
    .sort((a, b) => (b.priorityScore - a.priorityScore) || (new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)))
    .slice(0, 10);

  items = await mapLimit(items, 2, summarizeComItem);

  return {
    category: "com",
    label: COM_CONFIG.categoryLabel,
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: "cabinet.iq",
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    count: items.length,
    sourceUrl: COM_CONFIG.sourceUrl,
    priorityKeywords: COM_CONFIG.priorityKeywordsAr,
    debug,
    articles: items
  };
}

async function collectSns() {
  // Public Facebook/X/Instagram scraping is noisy and frequently blocked.
  // This intentionally avoids generic Google search like "Hanwha Iraq site:youtube.com".
  // Add official/curated RSS or API sources here later.
  return {
    category: "sns",
    label: "SNS",
    generatedAt: new Date().toISOString(),
    lookbackDays: DAYS,
    sourceType: "curated-sources-required",
    translatedBy: OPENAI_API_KEY ? "openai" : "none",
    count: 0,
    messageKo: "SNS는 관련 없는 유튜브/스포츠/광고 결과가 섞이지 않도록 일반 검색 수집을 중단했습니다. 이라크 공식 계정 또는 감시할 Facebook/X/Instagram/YouTube 계정 목록을 등록한 뒤 API/RSS 방식으로 수집하도록 연결해야 합니다.",
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
    await fs.writeFile(path.join(DATA_DIR, cfg.output), JSON.stringify(result, null, 2), "utf8");
    index.categories[category] = {
      file: `data/${cfg.output}`,
      count: result.count,
      generatedAt: result.generatedAt
    };
  }

  const sns = await collectSns();
  await fs.writeFile(path.join(DATA_DIR, "sns-news.json"), JSON.stringify(sns, null, 2), "utf8");
  index.categories.sns = { file: "data/sns-news.json", count: sns.count, generatedAt: sns.generatedAt };

  const com = await collectComActivities();
  await fs.writeFile(path.join(DATA_DIR, "com-news.json"), JSON.stringify(com, null, 2), "utf8");
  index.categories.com = { file: "data/com-news.json", count: com.count, generatedAt: com.generatedAt };

  await fs.writeFile(path.join(DATA_DIR, "news-index.json"), JSON.stringify(index, null, 2), "utf8");

  console.log("Collection complete:", index);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
