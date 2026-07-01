#!/usr/bin/env node
/**
 * BNCP / Hanwha Iraq News Collector
 * - Generates static JSON files for GitHub Pages.
 * - No API key required.
 * - Uses Google News RSS at build time, not browser scraping.
 *
 * Output:
 *   data/domestic-news.json
 *   data/overseas-news.json
 *   data/sns-news.json
 *   data/com-news.json
 *   data/news-index.json
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const MAX_PER_QUERY = 10;
const MAX_TOTAL_PER_CATEGORY = 80;
const DEFAULT_DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 7);

const CATEGORIES = {
  domestic: {
    output: "domestic-news.json",
    lang: "ko",
    gl: "KR",
    ceid: "KR:ko",
    queries: [
      '"한화" "이라크"',
      '"한화건설" "이라크"',
      '"한화 건설" "이라크"',
      '"비스마야"',
      '"비스마야 신도시"',
      '"한화" "비스마야"',
      '"한화" "BNCP"',
      '"Bismayah" "한화"',
      '"이라크 신도시" "한화"',
      '"이라크 사업" "한화"'
    ]
  },

  overseas: {
    output: "overseas-news.json",
    lang: "en",
    gl: "US",
    ceid: "US:en",
    queries: [
      '"Hanwha" "Iraq"',
      '"Hanwha" "Bismayah"',
      '"Hanwha Engineering" "Iraq"',
      '"Hanwha E&C" "Iraq"',
      '"Bismayah New City"',
      '"Bismaya New City"',
      '"BNCP" "Iraq"',
      '"National Investment Commission" "Bismayah"',
      '"Iraq" "Bismayah" "Hanwha"'
    ]
  },

  sns: {
    output: "sns-news.json",
    lang: "en",
    gl: "US",
    ceid: "US:en",
    queries: [
      '"Bismayah" site:youtube.com',
      '"Bismayah" site:x.com',
      '"Bismayah" site:twitter.com',
      '"Bismayah" site:facebook.com',
      '"Hanwha" "Iraq" site:youtube.com',
      '"비스마야" site:youtube.com',
      '"비스마야" site:facebook.com'
    ]
  },

  com: {
    output: "com-news.json",
    lang: "ar",
    gl: "IQ",
    ceid: "IQ:ar",
    queries: [
      '"بسماية" "مجلس الوزراء"',
      '"بسماية" "الأمانة العامة لمجلس الوزراء"',
      '"بسماية" "هيئة الاستثمار الوطنية"',
      '"بسماية" "العراق"',
      '"Bismayah" "Council of Ministers"',
      '"Bismayah" "National Investment Commission"',
      '"Bismayah" "Iraq"'
    ]
  }
};

function daysAgoDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function googleNewsRssUrl(query, cfg) {
  // Google News RSS supports normal search operators. "when:7d" is intentionally
  // included in the query so the feed is already time-filtered before our own filter.
  const q = `${query} when:${DEFAULT_DAYS}d`;
  const params = new URLSearchParams({
    q,
    hl: cfg.lang,
    gl: cfg.gl,
    ceid: cfg.ceid
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function decodeHtml(s = "") {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function stripTags(s = "") {
  return decodeHtml(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1]) : "";
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
  const titleKey = (item.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  const urlKey = normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return urlKey || titleKey;
}

function guessSourceFromTitle(title = "") {
  // Google News RSS often returns: "Actual title - Publisher"
  const parts = title.split(" - ");
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  return "";
}

function parseRssItems(xml, query, category) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const rawTitle = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeHtml(sourceMatch[1]) : guessSourceFromTitle(rawTitle);
    const description = stripTags(extractTag(block, "description"));
    return {
      title: rawTitle,
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
      url: normalizeUrl(link),
      query,
      category,
      description
    };
  }).filter((item) => item.title && item.url);
}

async function fetchRss(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 BNCP News Monitor GitHub Actions"
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

function sortAndFilter(items, days) {
  const cutoff = daysAgoDate(days);
  const map = new Map();

  for (const item of items) {
    if (item.publishedAt) {
      const d = new Date(item.publishedAt);
      if (!Number.isNaN(d.getTime()) && d < cutoff) continue;
    }

    const key = canonicalKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()]
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_TOTAL_PER_CATEGORY);
}

async function collectCategory(category, cfg) {
  const all = [];
  const debug = [];

  for (const query of cfg.queries) {
    const url = googleNewsRssUrl(query, cfg);
    try {
      const xml = await fetchRss(url);
      const items = parseRssItems(xml, query, category).slice(0, MAX_PER_QUERY);
      all.push(...items);
      debug.push({ query, ok: true, count: items.length });
      console.log(`[${category}] ${query}: ${items.length}`);
    } catch (err) {
      debug.push({ query, ok: false, error: String(err.message || err) });
      console.warn(`[${category}] ${query}: ${err.message || err}`);
    }
  }

  const articles = sortAndFilter(all, DEFAULT_DAYS);
  return {
    category,
    generatedAt: new Date().toISOString(),
    lookbackDays: DEFAULT_DAYS,
    sourceType: "google-news-rss",
    count: articles.length,
    queries: cfg.queries,
    debug,
    articles
  };
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const index = {
    generatedAt: new Date().toISOString(),
    lookbackDays: DEFAULT_DAYS,
    categories: {}
  };

  for (const [category, cfg] of Object.entries(CATEGORIES)) {
    const result = await collectCategory(category, cfg);
    const outPath = path.join(DATA_DIR, cfg.output);
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
    index.categories[category] = {
      file: `data/${cfg.output}`,
      count: result.count,
      generatedAt: result.generatedAt
    };
  }

  await fs.writeFile(path.join(DATA_DIR, "news-index.json"), JSON.stringify(index, null, 2), "utf8");
  console.log("News collection complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
