#!/usr/bin/env node
/**
 * Lightweight overseas-news post processor.
 * Runs inside the existing Collect BNCP News workflow after collect-news.mjs.
 *
 * Purpose:
 * 1) Add a small set of critical NIC dismissal / integrity queries.
 * 2) Remove list / pagination URLs that were mistaken for articles.
 * 3) Make important articles, importanceScore >= 85, show a richer 4-line Korean summary.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OVERSEAS_FILE = path.join(DATA_DIR, "overseas-news.json");

const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_EXTRA_ITEMS = Number(process.env.EXTRA_CRITICAL_NEWS_LIMIT || 12);

const EXTRA_CRITICAL_QUERIES = [
  "\"رئيس الهيئة الوطنية للاستثمار\" \"إعفاء\"",
  "\"رئيس الهيئة الوطنية للاستثمار\" \"اعفاء\"",
  "\"الهيئة الوطنية للاستثمار\" \"إعفاء\"",
  "\"الهيئة الوطنية للاستثمار\" \"اعفاء\"",
  "\"الهيئة الوطنية للاستثمار\" \"النزاهة\"",
  "\"حيدر مكية\" \"إعفاء\"",
  "\"حيدر مكية\" \"النزاهة\"",
  "\"مجلس النواب\" \"الهيئة الوطنية للاستثمار\" \"إعفاء\"",
  "\"مجلس النواب\" \"حيدر مكية\""
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
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function stripArabicDiacritics(value = "") {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "");
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
  return normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || String(item.title || "").toLowerCase().trim();
}

function hasAny(text = "", terms = []) {
  const normalized = stripArabicDiacritics(String(text || "")).toLowerCase();
  return terms.some((term) => normalized.includes(stripArabicDiacritics(String(term || "")).toLowerCase()));
}

function hasArabic(value = "") {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function hasBismayahKeyword(value = "") {
  const text = stripArabicDiacritics(String(value || ""));
  const arabicBismayah = /(^|[^\u0600-\u06FF])ب[\u0640\s]*س[\u0640\s]*م[\u0640\s]*ا[\u0640\s]*[يىی][\u0640\s]*[ةه](?=$|[^\u0600-\u06FF])/;
  return arabicBismayah.test(text) || /\b(bismayah|bismaya|basmaya|bncp)\b/i.test(text) || /비스마야/.test(text);
}

function hasHanwhaKeyword(value = "") {
  return /hanwha|هانوا|한화/i.test(stripArabicDiacritics(String(value || "")));
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

function isOlderThanLookback(publishedAt = "") {
  if (!publishedAt) return false;
  const d = new Date(publishedAt);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - DAYS);
  return d < cutoff;
}

function articleText(item = {}) {
  return [item.title, item.description, item.summaryKo, item.detailsKo?.join("\n"), item.fullText, item.cleanText]
    .filter(Boolean)
    .join("\n");
}

function shouldKeepArticle(item = {}) {
  if (isPaginationOrListUrl(item.url || "")) return false;
  if (isUnrelatedNonTargetArticle(articleText(item))) return false;

  if (isOlderThanLookback(item.publishedAt)) {
    const text = articleText(item);
    return hasBismayahKeyword(text) || hasHanwhaKeyword(text);
  }

  return true;
}

function googleNewsRssUrl(query) {
  const q = `${query} when:${DAYS}d`;
  const params = new URLSearchParams({ q, hl: "ar", gl: "IQ", ceid: "IQ:ar" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function extractTag(xml = "", tag = "") {
  const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function parseRssItems(xml = "", query = "") {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const rawTitle = extractTag(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeHtml(sourceMatch[1]) : "Google News";
    const pubDate = extractTag(block, "pubDate");
    return {
      title: rawTitle,
      titleKo: "",
      summaryKo: "",
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
      url: normalizeUrl(extractTag(block, "link")),
      query,
      category: "overseas",
      description: stripTags(extractTag(block, "description")),
      relevanceScore: 0,
      priority: "low",
      matchedRules: [],
      excludedRules: [],
      collection_method: "extra-critical-google-news",
      sourceType: "extra-critical-google-news",
      country: "Iraq",
      language: "ar"
    };
  }).filter((item) => item.title && item.url);
}

function scoreExtraCritical(item = {}) {
  const text = articleText(item);
  const matched = [];
  let score = 0;

  if (hasBismayahKeyword(text)) {
    score = Math.max(score, 100);
    matched.push("비스마야 직접 언급");
  }

  if (hasHanwhaKeyword(text) && hasAny(text, ["العراق", "iraq", "بغداد", "이라크"])) {
    score = Math.max(score, 95);
    matched.push("한화+이라크 직접 언급");
  }

  const hasNic = hasAny(text, [
    "الهيئة الوطنية للاستثمار",
    "هيئة الاستثمار",
    "رئيس هيئة الاستثمار",
    "رئيس الهيئة الوطنية للاستثمار",
    "حيدر مكية",
    "حيدر مكيه",
    "national investment commission",
    "nic"
  ]);
  const hasOversight = hasAny(text, [
    "مجلس النواب",
    "البرلمان",
    "استجواب",
    "إعفاء",
    "اعفاء",
    "إقالة",
    "اقالة",
    "النزاهة",
    "فساد",
    "questioning",
    "dismissal",
    "integrity",
    "corruption"
  ]);

  if (hasNic && hasOversight) {
    score = Math.max(score, 95);
    matched.push("NIC/투자위원회 의회 감시·해임·청렴위 이첩");
  } else if (hasNic) {
    score = Math.max(score, 78);
    matched.push("NIC/투자위원회 직접 언급");
  }

  return { score, matched };
}

async function fetchExtraCriticalItems() {
  const found = [];
  const debug = [];

  for (const query of EXTRA_CRITICAL_QUERIES) {
    try {
      const res = await fetch(googleNewsRssUrl(query), {
        headers: { "user-agent": "Mozilla/5.0 Bismayah News Monitor" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const xml = await res.text();
      const items = parseRssItems(xml, query).slice(0, 10);
      let kept = 0;

      for (const item of items) {
        if (!shouldKeepArticle(item)) continue;
        const scored = scoreExtraCritical(item);
        if (scored.score < 85) continue;
        item.relevanceScore = scored.score;
        item.importanceScore = scored.score;
        item.importance_score = scored.score;
        item.priority = "top";
        item.matchedRules = scored.matched;
        item.reportCategory = "politics";
        item.bismayahRelevance = hasBismayahKeyword(articleText(item)) || hasHanwhaKeyword(articleText(item)) ? "direct" : "indirect";
        item.constructionImpact = "high";
        item.reportUsefulness = "include";
        found.push(item);
        kept += 1;
      }

      debug.push({ query, ok: true, beforeFilter: items.length, afterFilter: kept });
    } catch (err) {
      debug.push({ query, ok: false, error: String(err.message || err) });
    }
  }

  return { items: found.slice(0, MAX_EXTRA_ITEMS), debug };
}

function cleanLine(value = "") {
  return String(value || "")
    .replace(/^[-*·•\s]+/, "")
    .replace(/^☞\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSummaryLines(value = "") {
  return String(value || "")
    .split(/\n+|(?<=다\.)\s+|(?<=음\.)\s+|(?<=됨\.)\s+|(?<=전망\.)\s+|(?<=필요\.)\s+/)
    .map(cleanLine)
    .filter(Boolean);
}

function uniqueLines(lines = []) {
  const seen = new Set();
  const result = [];
  for (const line of lines.map(cleanLine).filter(Boolean)) {
    const key = line.replace(/[.。]/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function fallbackKoreanForCritical(item = {}) {
  const text = articleText(item);
  const hasRemoval = hasAny(text, ["إعفاء", "اعفاء", "إقالة", "اقالة", "منصبه"]);
  const hasIntegrity = hasAny(text, ["النزاهة", "فساد", "integrity", "corruption"]);

  if (hasRemoval && hasAny(text, ["الهيئة الوطنية للاستثمار", "رئيس الهيئة الوطنية للاستثمار", "حيدر مكية", "حيدر مكيه"])) {
    return {
      titleKo: "이라크 의회, 국가투자위원회 의장 해임 표결",
      summaryKo: uniqueLines([
        "이라크 의회가 국가투자위원회(NIC) 의장 해임을 표결한 사안임.",
        hasIntegrity ? "관련 파일이 청렴위원회로 이첩된 것으로 보도됨." : "의회 차원의 투자기관 책임 추궁 흐름으로 해석됨.",
        "NIC는 비스마야·한화 관련 투자 행정의 직접 상대 기관임.",
        "향후 승인·협의 일정과 투자 행정 의사결정 라인 변동 가능성 점검 필요."
      ]).join("\n"),
      detailsKo: [
        "국가투자위원회 의장 해임 관련 의회 표결.",
        hasIntegrity ? "청렴위원회 이첩 보도 포함." : "투자기관 책임 추궁 흐름.",
        "비스마야 관련 행정 리스크와 간접 연계."
      ],
      reportBullet: "7.9, 이라크 의회, NIC 의장 해임 표결.",
      reportSubBullets: [
        "국가투자위원회 의장 해임 및 관련 파일 이첩 조치로 해석.",
        "비스마야·한화 관련 투자 행정의 의사결정 라인 변동 가능성."
      ],
      reportImplication: "NIC 수장 공백 및 후속 조사 흐름에 따른 행정 처리 지연 가능성 점검 필요."
    };
  }

  return {
    titleKo: "이라크 투자기관 관련 핵심 보도",
    summaryKo: uniqueLines([
      "이라크 투자기관 또는 NIC 관련 핵심 보도임.",
      "의회·정부 차원의 투자 행정 점검 흐름과 연계 가능성 있음.",
      "비스마야·한화 관련 행정 리스크에 간접 영향 가능성 있음.",
      "후속 공식 발표 및 관련 기관 인사·조사 동향 확인 필요."
    ]).join("\n"),
    detailsKo: ["이라크 투자기관 관련 기사.", "비스마야 사업 간접 영향 가능성 확인 필요."],
    reportBullet: "이라크 투자기관 관련 핵심 보도 확인.",
    reportSubBullets: ["투자 행정 변화 가능성 점검 필요."],
    reportImplication: "비스마야 관련 행정·정책 영향 가능성 확인 필요."
  };
}

async function aiSummarizeCritical(item = {}) {
  if (!OPENAI_API_KEY) return null;

  const input = [
    `원문 제목: ${item.title || ""}`,
    `원문 설명: ${item.description || ""}`,
    `출처: ${item.source || ""}`,
    `게재일: ${item.publishedAt || ""}`,
    `URL: ${item.url || ""}`
  ].join("\n");

  const prompt = [
    "아래 이라크 현지 기사 또는 RSS 설명을 한국어로 구조화하세요.",
    "반드시 JSON 객체만 출력하세요.",
    "titleKo: 한국어 제목 1개",
    "summaryKo: 중요도 85점 이상 핵심 기사이므로 반드시 4줄 요약으로 작성. 줄바꿈으로 4개 문장 구분. 제목 반복 금지.",
    "detailsKo: 핵심 세부내용 3~4개 배열",
    "reportBullet: 보고서 문체 bullet 1개",
    "reportSubBullets: 세부 bullet 1~3개 배열",
    "reportImplication: 시사점 1문장",
    "importanceScore: 85~100 정수",
    "기사에 없는 사실은 만들지 마세요. 아랍어 원문을 한국어 필드에 남기지 마세요."
  ].join("\n");

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_SUMMARY_MODEL,
        temperature: 0.2,
        input: [
          { role: "system", content: "You are a Korean-language Iraq construction and political risk monitoring analyst. Return valid JSON only." },
          { role: "user", content: `${prompt}\n\n${input}` }
        ]
      })
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.output_text || (data.output || []).flatMap((out) => out.content || []).map((c) => c.text || "").join("\n");
    const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    if (!parsed || !parsed.titleKo || !parsed.summaryKo || hasArabic(`${parsed.titleKo} ${parsed.summaryKo}`)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function enrichExtraItem(item = {}) {
  const ai = await aiSummarizeCritical(item);
  const fallback = fallbackKoreanForCritical(item);
  const parsed = ai || fallback;
  const importanceScore = Math.max(85, Math.min(100, Number(parsed.importanceScore || item.importanceScore || item.relevanceScore || 95)));

  return {
    ...item,
    titleKo: cleanLine(parsed.titleKo || fallback.titleKo),
    summaryKo: ensureDetailedSummary({ ...item, ...parsed, importanceScore }),
    detailsKo: Array.isArray(parsed.detailsKo) ? parsed.detailsKo.map(cleanLine).filter(Boolean).slice(0, 4) : fallback.detailsKo,
    reportBullet: cleanLine(parsed.reportBullet || fallback.reportBullet),
    reportSubBullets: Array.isArray(parsed.reportSubBullets) ? parsed.reportSubBullets.map(cleanLine).filter(Boolean).slice(0, 3) : fallback.reportSubBullets,
    reportImplication: cleanLine(parsed.reportImplication || fallback.reportImplication),
    importanceScore,
    importance_score: importanceScore,
    priority: "top",
    reportUsefulness: "include",
    aiSummaryVersion: ai ? "extra-critical-4line-v1" : "extra-critical-fallback-4line-v1"
  };
}

function ensureDetailedSummary(item = {}) {
  const importance = Number(item.importanceScore || item.importance_score || item.relevanceScore || 0);
  const summary = cleanLine(item.summaryKo || "");
  if (importance < 85) return summary;

  const existingLines = splitSummaryLines(item.summaryKo || "");
  const detailLines = Array.isArray(item.detailsKo) ? item.detailsKo.map(cleanLine) : [];
  const subLines = Array.isArray(item.reportSubBullets) ? item.reportSubBullets.map(cleanLine) : [];
  const extraLines = [item.weeklySignal, item.possibleImpact, item.reportImplication].map(cleanLine);

  const lines = uniqueLines([...existingLines, ...detailLines, ...subLines, ...extraLines])
    .filter((line) => line.length >= 8)
    .slice(0, 4);

  if (lines.length >= 4) return lines.join("\n");
  if (lines.length >= 2) return lines.join("\n");
  return summary;
}

async function main() {
  const data = JSON.parse(await fs.readFile(OVERSEAS_FILE, "utf8"));
  const existing = Array.isArray(data.articles) ? data.articles : [];

  const extra = await fetchExtraCriticalItems();
  const map = new Map();

  let removedBadUrls = 0;
  let removedOld = 0;
  for (const item of existing) {
    if (isPaginationOrListUrl(item.url || "")) {
      removedBadUrls += 1;
      continue;
    }
    if (!shouldKeepArticle(item)) {
      removedOld += 1;
      continue;
    }
    map.set(canonicalKey(item), item);
  }

  let addedExtra = 0;
  for (const raw of extra.items) {
    const key = canonicalKey(raw);
    if (map.has(key)) continue;
    const enriched = await enrichExtraItem(raw);
    map.set(key, enriched);
    addedExtra += 1;
  }

  const maxTotal = Number(data.maxTotal || 250);
  const articles = [...map.values()]
    .map((item) => {
      const importanceScore = Number(item.importanceScore || item.importance_score || item.relevanceScore || 0);
      const summaryKo = ensureDetailedSummary({ ...item, importanceScore });
      return {
        ...item,
        summaryKo,
        aiSummaryVersion: importanceScore >= 85
          ? `${item.aiSummaryVersion || "existing"}+4line-important-v1`
          : item.aiSummaryVersion
      };
    })
    .sort((a, b) => {
      const importanceDiff = Number(b.importanceScore || b.importance_score || b.relevanceScore || 0) - Number(a.importanceScore || a.importance_score || a.relevanceScore || 0);
      if (importanceDiff) return importanceDiff;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    })
    .slice(0, maxTotal);

  const next = {
    ...data,
    generatedAt: new Date().toISOString(),
    count: articles.length,
    postprocess: {
      version: "overseas-postprocess-v1",
      generatedAt: new Date().toISOString(),
      removedBadUrls,
      removedOld,
      addedExtra,
      extraCriticalQueries: EXTRA_CRITICAL_QUERIES,
      extraDebug: extra.debug,
      importantSummaryRule: "importanceScore >= 85 => summaryKo expanded up to 4 Korean lines"
    },
    queries: Array.from(new Set([...(data.queries || []), ...EXTRA_CRITICAL_QUERIES])),
    articles
  };

  await fs.writeFile(OVERSEAS_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[postprocess-overseas] removedBadUrls=${removedBadUrls}, removedOld=${removedOld}, addedExtra=${addedExtra}, count=${articles.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
