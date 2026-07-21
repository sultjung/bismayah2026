#!/usr/bin/env node
/**
 * Human-style weekly context collector.
 *
 * This small supplemental collector targets the kinds of items that human Iraq
 * weekly reports usually pick: cabinet meeting decisions, housing policy,
 * anti-corruption politics, security incidents, oil/Hormuz, and regional tension.
 * It appends those results into data/weekly-context-news.json so the weekly
 * report generator can select them.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const TARGET_FILE = path.join(DATA_DIR, "weekly-context-news.json");
const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const MAX_PER_QUERY = Number(process.env.HUMAN_STYLE_MAX_PER_QUERY || 8);
const MAX_APPEND_TOTAL = Number(process.env.HUMAN_STYLE_MAX_TOTAL || 120);

const HUMAN_STYLE_QUERIES = [
  '"مقتدى الصدر" "مكافحة الفساد"',
  '"التيار الصدري" "مكافحة الفساد"',
  '"وزارة الإعمار والإسكان" "معايير" "بيئية"',
  '"وزارة الإعمار والإسكان" "مدن سكنية"',
  '"مجلس الوزراء" "الجلسة التاسعة" "العراق"',
  '"مجلس الوزراء" "إجازات العمل"',
  '"مجلس الوزراء" "مكافحة الفساد"',
  '"مجلس الوزراء" "المشاريع الاستثمارية"',
  '"وزارة التخطيط" "المشاريع" "العراق"',
  '"الإطار التنسيقي" "الكابينة الوزارية"',
  '"الإطار التنسيقي" "خلافات"',
  '"مجلس النواب" "رئيس الهيئة الوطنية للاستثمار"',
  '"السوداني" "مليون قطعة أرض"',
  '"السوداني" "الأراضي السكنية"',
  '"نوري المالكي" "فساد"',
  '"السوداني" "زيارة واشنطن"',
  '"قيادة العمليات المشتركة" "كركوك" "داعش"',
  '"كركوك" "داعش" "ضربة جوية"',
  '"بغداد" "الزعفرانية" "خطف"',
  '"ميسان" "شركة صينية" "صاروخ"',
  '"ميسان" "مشروع ماء" "صاروخ"',
  '"مضيق هرمز" "أسعار النفط"',
  '"خام دبي" "برنت" "غرب تكساس"',
  '"إيران" "إسرائيل" "الولايات المتحدة" "مضيق هرمز"',
  '"الحرس الثوري" "القواعد الأمريكية" "البحرين"',
  '"الحرس الثوري" "القواعد الأمريكية" "الكويت"'
];

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
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function normalizeUrl(url = "") {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url || "";
  }
}

const NON_TARGET_TOPIC_RULES = [
  /بطاطا|بطاطس|زراعة|الزراعية|زراعي|محاصيل|بذور|مزارع|الفلاحة|الثروة الحيوانية|الدواجن|القمح|الأرز|التمور|صيد الأسماك|agriculture|potato|seed|farming|crop/i,
  /صحة|الصحة|مستشفى|مستشفيات|مرض|وباء|لقاح|health|hospital|disease|vaccine/i,
  /تعليم|مدرسة|جامع[ةة]|طلاب|التربية|education|school|university|students/i,
  /طقس|أمطار|درجات الحرارة|weather|rain|temperature/i,
  /فنون|ثقافة|مهرجان|مسلسل|سينما|culture|festival|film|music/i
];
const STRONG_MONITORING_SIGNAL = /بسماية|بسمایه|bismayah|bismaya|bncp|hanwha|هانوا|هيئة الاستثمار|الهيئة الوطنية للاستثمار|حيدر مكية|وزارة الإعمار|وزارة الاعمار|الإسكان|الاسكان|مشروع سكني|مشاريع سكنية|البنى التحتية|بنى تحتية|construction|housing|infrastructure|مجلس الوزراء|مجلس النواب|البرلمان|السوداني|داعش|الحشد الشعبي|الوضع الأمني|أمن|امن|نفط|النفط|أوبك|اوبك|الموازنة|الكهرباء|الغاز|oil|opec|budget|electricity|security|isis|pmf|corruption|election/i;
function isUnrelatedNonTargetArticle(text = "") {
  const value = String(text || "");
  return NON_TARGET_TOPIC_RULES.some((pattern) => pattern.test(value)) && !STRONG_MONITORING_SIGNAL.test(value);
}

function extractTag(xml = "", tag = "") {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function googleNewsRssUrl(query) {
  const params = new URLSearchParams({ q: `${query} when:${DAYS}d`, hl: "ar", gl: "IQ", ceid: "IQ:ar" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function classify(text = "") {
  const t = String(text || "").toLowerCase();
  if (/هرمز|نفط|برنت|دبي|غرب تكساس|oil|brent|wti/.test(t)) return "economy";
  if (/داعش|خطف|صاروخ|قصف|اشتباك|security|rocket|kidnap|isis/.test(t)) return "security";
  if (/إيران|اسرائيل|إسرائيل|الولايات المتحدة|الحرس الثوري|قواعد أمريكية|gaza|israel|iran/.test(t)) return "regional";
  if (/الإعمار|الإسكان|مشروع|استثمار|إجازات العمل|مدن سكنية|سكن|planning|ministry/.test(t)) return "construction";
  return "politics";
}

function score(text = "") {
  let s = 55;
  if (/مجلس الوزراء|الجلسة التاسعة|إجازات العمل|مكافحة الفساد|المشاريع الاستثمارية/.test(text)) s += 25;
  if (/وزارة الإعمار|وزارة التخطيط|مدن سكنية|مليون قطعة أرض|الأراضي السكنية/.test(text)) s += 22;
  if (/رئيس الهيئة الوطنية للاستثمار|هيئة الاستثمار|مجلس النواب|النزاهة/.test(text)) s += 25;
  if (/الصدر|المالكي|الإطار التنسيقي|السوداني/.test(text)) s += 15;
  if (/داعش|خطف|صاروخ|قصف|كركوك|ميسان|الزعفرانية/.test(text)) s += 18;
  if (/هرمز|أسعار النفط|خام دبي|برنت|غرب تكساس/.test(text)) s += 18;
  if (/إيران|إسرائيل|الولايات المتحدة|الحرس الثوري|القواعد الأمريكية/.test(text)) s += 15;
  return Math.min(100, s);
}

function parseItems(xml = "", query = "") {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const title = extractTag(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeHtml(sourceMatch[1]) : "Google News";
    const pubDate = extractTag(block, "pubDate");
    const description = stripTags(extractTag(block, "description"));
    const text = `${title} ${description}`;
    const relevanceScore = score(text);
    return {
      title,
      titleKo: "",
      summaryKo: description,
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
      url: normalizeUrl(extractTag(block, "link")),
      query,
      category: "weeklyContext",
      reportCategory: classify(text),
      relevanceScore,
      importanceScore: relevanceScore,
      importance_score: relevanceScore,
      priority: relevanceScore >= 85 ? "top" : relevanceScore >= 70 ? "high" : "normal",
      reportUsefulness: "include",
      bismayahRelevance: /بسماية|bismayah|hanwha|هانوا|هيئة الاستثمار/.test(text) ? "indirect" : "none",
      constructionImpact: /استثمار|الإعمار|الإسكان|مشروع|سكن|بنى|إجازات العمل|هيئة الاستثمار/.test(text) ? "medium" : "low",
      matchedRules: ["human-style-weekly-context"],
      excludedRules: [],
      collection_method: "human-style-weekly-google-news",
      sourceType: "human-style-weekly-google-news",
      country: "Iraq",
      language: /[\u0600-\u06FF]/.test(text) ? "ar" : "en"
    };
  }).filter((item) => item.title && item.url && !isUnrelatedNonTargetArticle(`${item.title}\n${item.description}`));
}

function canonicalKey(item = {}) {
  return normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || String(item.title || "").toLowerCase().trim();
}

async function readTarget() {
  try {
    return JSON.parse(await fs.readFile(TARGET_FILE, "utf8"));
  } catch {
    return { category: "weeklyContext", label: "이라크 주간 보고서 참고자료", articles: [], queries: [] };
  }
}

async function main() {
  const data = await readTarget();
  const map = new Map();
  const existing = Array.isArray(data.articles) ? data.articles : [];
  for (const item of existing) map.set(canonicalKey(item), item);

  const debug = [];
  let added = 0;

  for (const query of HUMAN_STYLE_QUERIES) {
    try {
      const res = await fetch(googleNewsRssUrl(query), { headers: { "user-agent": "Mozilla/5.0 Bismayah Human Style Weekly Collector" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const xml = await res.text();
      const items = parseItems(xml, query).slice(0, MAX_PER_QUERY);
      let kept = 0;
      for (const item of items) {
        const key = canonicalKey(item);
        if (map.has(key)) continue;
        map.set(key, item);
        kept += 1;
        added += 1;
        if (added >= MAX_APPEND_TOTAL) break;
      }
      debug.push({ query, ok: true, beforeFilter: items.length, added: kept });
      if (added >= MAX_APPEND_TOTAL) break;
    } catch (err) {
      debug.push({ query, ok: false, error: String(err.message || err).slice(0, 160) });
    }
  }

  const articles = [...map.values()]
    .sort((a, b) => Number(b.importanceScore || b.importance_score || b.relevanceScore || 0) - Number(a.importanceScore || a.importance_score || a.relevanceScore || 0) || new Date(b.publishedAt || b.published_date || 0) - new Date(a.publishedAt || a.published_date || 0))
    .slice(0, Math.max(160, Number(data.maxTotal || 100)));

  const next = {
    ...data,
    category: data.category || "weeklyContext",
    label: data.label || "이라크 주간 보고서 참고자료",
    generatedAt: data.generatedAt || new Date().toISOString(),
    humanStyleContext: {
      version: "human-style-weekly-context-v1",
      generatedAt: new Date().toISOString(),
      added,
      debug
    },
    queries: Array.from(new Set([...(data.queries || []), ...HUMAN_STYLE_QUERIES])),
    count: articles.length,
    articles
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(TARGET_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[human-style-weekly-context] added=${added}, count=${articles.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
