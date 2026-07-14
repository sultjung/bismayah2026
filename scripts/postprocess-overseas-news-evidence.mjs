#!/usr/bin/env node
/**
 * Evidence-preserving overseas-news cleanup.
 *
 * This script intentionally makes no OpenAI calls. Critical NIC/Bismayah
 * queries are already part of the main collector and therefore pass through
 * the same keyword -> full-text hydration -> Korean summary pipeline.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OVERSEAS_FILE = path.join(DATA_DIR, "overseas-news.json");
const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

function canonicalKey(item = {}) {
  return normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") ||
    decodeHtml(item.title || item.titleKo || "").toLowerCase();
}

function isPaginationOrListUrl(url = "") {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || "").toLowerCase();
    const q = decodeURIComponent(u.search || "").toLowerCase();
    if (/\/page\/\d+\/?$/i.test(p)) return true;
    if (/(^|[?&])page=\d+/i.test(q)) return true;
    if (/\/(tag|tags|category|categories|section|sections|author|authors|search|login|privacy|about|contact)(\/|$)/i.test(p)) return true;
    if (/\/(iraq|politics|economy|business|security)\/?$/i.test(p)) return true;
    return false;
  } catch {
    return false;
  }
}

function hasDirectProjectSignal(item = {}) {
  const text = [item.title, item.titleKo, item.summaryKo, item.description, item.cleanText, item.fullText]
    .filter(Boolean)
    .join("\n");
  return /بسماية|بسمايه|بسمایه|bismayah|bismaya|basmaya|bncp|هانوا|hanwha|비스마야|한화/i.test(text);
}

function isOlderThanLookback(publishedAt = "") {
  if (!publishedAt) return false;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - DAYS);
  return date < cutoff;
}

function hasUsableKoreanSummary(item = {}) {
  return String(item.titleKo || "").trim().length >= 4 && String(item.summaryKo || "").trim().length >= 8 && !item.translationFailed;
}

async function main() {
  const data = JSON.parse(await fs.readFile(OVERSEAS_FILE, "utf8"));
  const existing = Array.isArray(data.articles) ? data.articles : [];
  const map = new Map();
  let removedBadUrls = 0;
  let removedOld = 0;
  let removedWithoutEvidenceSummary = 0;

  for (const item of existing) {
    if (isPaginationOrListUrl(item.url || "")) {
      removedBadUrls += 1;
      continue;
    }
    if (isOlderThanLookback(item.publishedAt) && !hasDirectProjectSignal(item)) {
      removedOld += 1;
      continue;
    }
    if (!hasUsableKoreanSummary(item)) {
      removedWithoutEvidenceSummary += 1;
      continue;
    }

    const key = canonicalKey(item);
    const previous = map.get(key);
    if (!previous) {
      map.set(key, item);
      continue;
    }

    const previousScore = Number(previous.importanceScore || previous.importance_score || previous.relevanceScore || 0);
    const nextScore = Number(item.importanceScore || item.importance_score || item.relevanceScore || 0);
    if (nextScore > previousScore) map.set(key, item);
  }

  const maxTotal = Number(data.maxTotal || 250);
  const articles = [...map.values()]
    .sort((a, b) => {
      const scoreDiff = Number(b.importanceScore || b.importance_score || b.relevanceScore || 0) -
        Number(a.importanceScore || a.importance_score || a.relevanceScore || 0);
      if (scoreDiff) return scoreDiff;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, maxTotal);

  const next = {
    ...data,
    generatedAt: new Date().toISOString(),
    count: articles.length,
    postprocess: {
      version: "evidence-preserving-v2",
      generatedAt: new Date().toISOString(),
      openAiCalls: 0,
      removedBadUrls,
      removedOld,
      removedWithoutEvidenceSummary,
      policy: "No separate RSS-only AI summary; preserve evidence-first collector output"
    },
    articles
  };

  await fs.writeFile(OVERSEAS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[postprocess-overseas-evidence] removedBadUrls=${removedBadUrls}, removedOld=${removedOld}, removedWithoutEvidenceSummary=${removedWithoutEvidenceSummary}, count=${articles.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
