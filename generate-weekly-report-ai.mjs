#!/usr/bin/env node
/**
 * AI Weekly Iraq Situation Report Generator
 *
 * This script is intended to run inside GitHub Actions, not in the browser.
 * It reads the accumulated news JSON files, asks OpenAI to write a weekly
 * situation report in the same style as the uploaded legacy samples, and saves
 * a downloadable Word file under reports/latest.docx.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const REPORTS_DIR = path.join(ROOT, "reports");
const GENERATED_DIR = path.join(REPORTS_DIR, "generated");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const REPORT_DAYS = Number(process.env.REPORT_DAYS || 7);
const MAX_AI_ITEMS = Number(process.env.MAX_AI_REPORT_ITEMS || 90);
const REPORT_TIMEZONE = "Asia/Seoul";

const SOURCE_FILES = [
  { file: "overseas-news.json", label: "이라크 언론사", type: "iraqMedia" },
  { file: "weekly-context-news.json", label: "이라크 주간 맥락", type: "weeklyContext" },
  { file: "iraq-political-actors.json", label: "이라크 정치세력 동향", type: "politicalActors" },
  { file: "domestic-news.json", label: "국내 언론사", type: "domestic" },
  { file: "com-activities.json", label: "COM 주요활동", type: "com" },
  { file: "sns-activities.json", label: "SNS", type: "sns" }
];

const MAX_SOURCE_TEXT_ITEMS = Number(process.env.MAX_SOURCE_TEXT_ITEMS || 28);
const MAX_SOURCE_TEXT_CHARS = Number(process.env.MAX_SOURCE_TEXT_CHARS || 3200);

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required. Set it in GitHub Secrets.");
  process.exit(1);
}

function kstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function dateFromYmd(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function resolvePeriod() {
  const reportEndEnv = process.env.REPORT_END_DATE || "";
  const reportStartEnv = process.env.REPORT_START_DATE || "";

  if (reportStartEnv && reportEndEnv) {
    const start = dateFromYmd(reportStartEnv);
    const end = dateFromYmd(reportEndEnv);
    return { start, end, reportDate: addDays(end, 1) };
  }

  if (reportEndEnv) {
    const end = dateFromYmd(reportEndEnv);
    const start = addDays(end, -(REPORT_DAYS - 1));
    return { start, end, reportDate: addDays(end, 1) };
  }

  const nowParts = kstDateParts(new Date());
  const todayKst = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 0, 0, 0));
  const end = addDays(todayKst, -1);
  const start = addDays(end, -(REPORT_DAYS - 1));
  return { start, end, reportDate: todayKst };
}

function koreanReportDate(date) {
  return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`;
}

function shortLegacyDate(date) {
  const yy = String(date.getUTCFullYear()).slice(2);
  return `΄${yy}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
}

function monthDay(date) {
  return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`;
}

function fileDateName(date) {
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

function periodTitle(period) {
  return `건설, 이라크 주간 종합 상황보고(${shortLegacyDate(period.start)} ~ ${shortLegacyDate(period.end)})`;
}

async function readJsonSafe(file, fallback) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function withinPeriod(value, period) {
  const d = parseDate(value);
  if (!d) return false;
  const ymd = toYmd(d);
  const day = dateFromYmd(ymd);
  return day >= period.start && day <= period.end;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeArticlePayload(data, source) {
  if (source.type === "com") return normalizeComPayload(data, source);
  if (source.type === "sns") return normalizeSnsPayload(data, source);

  const articles = Array.isArray(data.articles) ? data.articles : [];
  return articles.map((article, index) => {
    const date = article.publishedAt || article.published_date || article.date_found || data.generatedAt || "";
    return {
      id: `${source.type}-${index}-${article.url || article.title || article.titleKo || "item"}`,
      sourceType: source.type,
      sourceLabel: source.label,
      source: article.source || source.label,
      title: normalizeText(article.titleKo || article.title_ko || article.title || article.title_original || ""),
      originalTitle: normalizeText(article.title || article.title_original || ""),
      summary: normalizeText(article.summaryKo || article.summary_ko || article.summary || article.description || ""),
      details: Array.isArray(article.detailsKo) ? article.detailsKo.map(normalizeText).filter(Boolean) : [],
      reportBullet: normalizeText(article.reportBullet || ""),
      reportSubBullets: Array.isArray(article.reportSubBullets) ? article.reportSubBullets.map(normalizeText).filter(Boolean) : [],
      reportImplication: normalizeText(article.reportImplication || ""),
      category: article.reportCategory || article.category || "other",
      importance: Number(article.importanceScore || article.importance_score || article.relevanceScore || 50),
      bismayahRelevance: article.bismayahRelevance || "none",
      constructionImpact: article.constructionImpact || "none",
      reportUsefulness: article.reportUsefulness || "watch",
      politicalActors: Array.isArray(article.politicalActors) ? article.politicalActors.map(normalizeText).filter(Boolean) : [],
      weeklySignal: normalizeText(article.weeklySignal || ""),
      possibleImpact: normalizeText(article.possibleImpact || ""),
      cleanText: normalizeText(article.cleanText || article.fullText || ""),
      fullText: normalizeText(article.fullText || article.cleanText || ""),
      date,
      url: article.url || "",
      matchedRules: article.matchedRules || article.keywords || []
    };
  });
}

function normalizeComPayload(data, source) {
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const out = [];

  for (const article of articles) {
    const date = article.published_date || article.date_found || data.generated_at || "";
    const ministries = Array.isArray(article.ministries) ? article.ministries : [];

    if (!ministries.length) {
      out.push({
        id: `com-${article.id || article.title_ko || date}`,
        sourceType: source.type,
        sourceLabel: source.label,
        source: article.source || source.label,
        title: article.title_ko || article.title_original || "COM 주요활동",
        originalTitle: article.title_original || "",
        summary: article.summary_ko || "",
        details: [],
        category: "politics",
        importance: Number(article.importance_score || 70),
        bismayahRelevance: "indirect",
        constructionImpact: "medium",
        reportUsefulness: "include",
        date,
        url: article.url || ""
      });
      continue;
    }

    for (const ministry of ministries) {
      const text = [ministry.ministry_ko, ministry.summary_ko, ministry.category, ...(ministry.keyword_hits || [])].join(" ");
      out.push({
        id: `com-${article.id || date}-${ministry.ministry_ko || ministry.ministry_ar}`,
        sourceType: source.type,
        sourceLabel: source.label,
        source: article.source || source.label,
        title: `COM 주요활동: ${ministry.ministry_ko || ministry.ministry_ar || "정부기관"}`,
        originalTitle: ministry.ministry_ar || article.title_original || "",
        summary: ministry.summary_ko || article.summary_ko || "",
        details: [],
        category: classifyPlainText(text),
        importance: Number(ministry.priority_score || article.importance_score || 70),
        bismayahRelevance: /비스마야|BNCP|NIC|투자|주택|건설|인프라/.test(text) ? "indirect" : "none",
        constructionImpact: /투자|주택|건설|인프라|프로젝트|계약|재건/.test(text) ? "medium" : "low",
        reportUsefulness: "include",
        date,
        url: article.url || ""
      });
    }
  }

  return out;
}

function normalizeSnsPayload(data, source) {
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.articles) ? data.articles : [];
  return items.map((item, index) => ({
    id: `sns-${index}-${item.url || item.id || item.title || "item"}`,
    sourceType: source.type,
    sourceLabel: source.label,
    source: item.source || item.author || source.label,
    title: normalizeText(item.title_ko || item.titleKo || item.title || item.text_ko || "SNS 동향"),
    originalTitle: normalizeText(item.text || item.title || ""),
    summary: normalizeText(item.summary_ko || item.summaryKo || item.summary || item.text_ko || item.text || ""),
    details: [],
    category: classifyPlainText(`${item.title || ""} ${item.summary || ""} ${item.text || ""}`),
    importance: Number(item.importance_score || item.relevance_score || item.score || 45),
    bismayahRelevance: /비스마야|بسماية|بسمايه|bismayah/i.test(`${item.title || ""} ${item.summary || ""} ${item.text || ""}`) ? "direct" : "none",
    constructionImpact: "low",
    reportUsefulness: "watch",
    date: item.publishedAt || item.date || item.created_at || data.updated_at || "",
    url: item.url || ""
  }));
}

function classifyPlainText(text = "") {
  const t = String(text || "").toLowerCase();
  if (/비스마야|bismayah|hanwha|한화|national investment commission|nic|هيئة الاستثمار|بسماية|بسمايه/.test(t)) return "bismayah";
  if (/주택|건설|인프라|프로젝트|재건|housing|construction|infrastructure|مشروع|إعمار|اعمار|سكن/.test(t)) return "construction";
  if (/테러|치안|안보|isis|داعش|هجوم|اشتباك|security|militia|pmf|الحشد/.test(t)) return "security";
  if (/유가|원유|예산|경제|oil|opec|budget|economy|نفط|موازنة|اقتصاد/.test(t)) return "economy";
  if (/이란|시리아|이스라엘|가자|하마스|후티|iran|syria|israel|gaza|hamas|houthi|إيران|سوريا|إسرائيل|غزة|حماس|الحوثي/.test(t)) return "regional";
  if (/총리|내각|의회|정부|선거|parliament|cabinet|government|election|مجلس الوزراء|البرلمان|حكومة|انتخابات/.test(t)) return "politics";
  return "other";
}

function reportScore(item) {
  let score = Number(item.importance || 0);
  if (item.reportUsefulness === "include") score += 15;
  if (item.reportUsefulness === "exclude") score -= 60;
  if (item.sourceType === "politicalActors") score += 12;
  if (Array.isArray(item.politicalActors) && item.politicalActors.length) score += 10;
  if (item.weeklySignal) score += 8;
  if (item.bismayahRelevance === "direct") score += 20;
  if (item.bismayahRelevance === "indirect") score += 10;
  if (item.constructionImpact === "high") score += 15;
  if (item.constructionImpact === "medium") score += 8;
  if (["bismayah", "construction", "politics", "security", "economy", "regional"].includes(item.category)) score += 5;
  return score;
}

async function loadWeeklyItems(period) {
  const all = [];
  for (const source of SOURCE_FILES) {
    const data = await readJsonSafe(source.file, {});
    const items = normalizeArticlePayload(data, source);
    all.push(...items);
  }

  const dedup = new Map();
  for (const item of all) {
    if (!withinPeriod(item.date, period)) continue;
    if (!item.title && !item.summary) continue;
    const key = item.url || `${item.title}-${item.date}`;
    const enriched = { ...item, reportScore: reportScore(item), category: item.category || classifyPlainText(`${item.title} ${item.summary}`) };
    const old = dedup.get(key);
    if (!old || enriched.reportScore > old.reportScore) dedup.set(key, enriched);
  }

  return [...dedup.values()]
    .filter((item) => item.reportScore >= 35)
    .sort((a, b) => b.reportScore - a.reportScore || new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, MAX_AI_ITEMS);
}

function itemDateYmd(value) {
  const d = parseDate(value);
  return d ? toYmd(d) : String(value || "").slice(0, 10);
}

function truncateText(value = "", limit = MAX_SOURCE_TEXT_CHARS) {
  const text = normalizeText(value);
  return text.length > limit ? `${text.slice(0, limit)} ...` : text;
}

function summarizePoliticalActors(items) {
  const map = new Map();
  for (const item of items) {
    for (const actor of item.politicalActors || []) {
      const old = map.get(actor) || { actor, count: 0, signals: [] };
      old.count += 1;
      if (item.weeklySignal) old.signals.push(item.weeklySignal);
      else if (item.summary) old.signals.push(item.summary);
      map.set(actor, old);
    }
  }

  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => ({
      actor: entry.actor,
      count: entry.count,
      signals: [...new Set(entry.signals)].slice(0, 4)
    }));
}

function buildAiInput(items, period) {
  const textEligible = new Set(
    items
      .filter((item) => item.cleanText || item.fullText)
      .sort((a, b) => b.reportScore - a.reportScore)
      .slice(0, MAX_SOURCE_TEXT_ITEMS)
      .map((item) => item.id)
  );

  return {
    reportTitle: periodTitle(period),
    reportDate: koreanReportDate(period.reportDate),
    periodStart: toYmd(period.start),
    periodEnd: toYmd(period.end),
    styleGuide: {
      structure: [
        "1. 이라크 국내 상황",
        "1) 정국 / 치안",
        "· 정치권 동향",
        "· 이라크 주간 테러 상황",
        "2) 경제",
        "· 국제유가 관련 동향",
        "2. 국제사회",
        "· 중동 주요 정세 또는 해당 주 핵심 국제 이슈",
        "3. 그룹 / 건설에 미치는 영향"
      ],
      writing: [
        "기존 보고서처럼 간결한 한국어 보고체로 작성",
        "각 항목은 '· 날짜, 주체, 핵심행위 명사형.'으로 시작",
        "세부 설명은 '* ...' 형식",
        "분석/시사점은 '☞ ...' 형식",
        "기사에 없는 사실과 숫자는 만들지 않음",
        "중복 기사는 하나로 병합",
        "필터된 기사 원문/본문이 제공된 경우 요약문보다 원문을 우선 참고",
        "조정프레임워크, 법치국가연합/말리키, 알수다니 측, 사드르계, PMF/친이란 세력, 수니·쿠르드 정당의 1주일 활동 흐름을 정치권 동향에 반영",
        "비스마야, 한화, NIC, COM, 주택·건설·인프라, 바그다드 치안, IS/PMF, 이란·시리아·이스라엘 정세를 우선 반영",
        "그룹/건설 영향은 현장 운영, 외부 업무, 이동경호, 투자사업 일정, 정부 행정 리스크 관점에서 2개 문장으로 정리"
      ]
    },
    politicalActorSignals: summarizePoliticalActors(items),
    items: items.map((item) => ({
      date: itemDateYmd(item.date),
      source: item.source,
      sourceType: item.sourceType,
      category: item.category,
      title: item.title,
      originalTitle: item.originalTitle,
      summary: item.summary,
      details: item.details,
      reportBullet: item.reportBullet,
      reportSubBullets: item.reportSubBullets,
      reportImplication: item.reportImplication,
      politicalActors: item.politicalActors || [],
      weeklySignal: item.weeklySignal,
      possibleImpact: item.possibleImpact,
      sourceText: textEligible.has(item.id) ? truncateText(item.cleanText || item.fullText || "") : "",
      importance: item.importance,
      reportScore: item.reportScore,
      bismayahRelevance: item.bismayahRelevance,
      constructionImpact: item.constructionImpact,
      url: item.url
    }))
  };
}

async function callOpenAiForReport(payload) {
  const prompt = [
    "너는 한국 기업의 이라크 건설사업 주간 종합상황보고를 작성하는 실무자다.",
    "아래 최근 7일치 기사/정부활동/SNS/정치세력 동향을 바탕으로 기존 샘플과 같은 문체의 보고서 내용을 작성하라.",
    "단순 요약문이 아니라, 필터된 기사 원문과 정치세력별 반복 신호를 읽고 1주일간의 이라크 정국 흐름을 판단하라.",
    "반드시 JSON 객체만 출력하라. 마크다운 금지. 설명문 금지.",
    "JSON 스키마:",
    "{",
    '  "title": "건설, 이라크 주간 종합 상황보고(΄YY.M.D ~ ΄YY.M.D)",',
    '  "reportDate": "YYYY. M. D.",',
    '  "politicsItems": [{"main":"· M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "securityItems": [{"main":"· M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "terrorTable": {"total":"확인 필요", "armed":"-", "ied":"-", "assassination":"-", "protest":"-", "shooting":"-", "suicide":"-"},',
    '  "economyItems": [{"main":"· M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "oilTable": [{"date":"M.D", "dubai":"-", "brent":"-", "wti":"-"}],',
    '  "regionalHeading": "중동 주요 정세",',
    '  "regionalItems": [{"main":"· M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "impactItems": ["· ...", "· ..."]',
    "}",
    "핵심 작성 규칙:",
    "- 기사에 명시되지 않은 테러 건수/유가 숫자는 만들지 말고 '확인 필요' 또는 '-'로 둔다.",
    "- 모든 main은 반드시 '· '로 시작한다.",
    "- 모든 main은 '· M.D, 주체, 핵심행위 명사형.' 구조로 작성한다.",
    "- 나쁜 예: · 7.1, 이라크 의회가 투자위원장을 심문하기로 결정하였다.",
    "- 좋은 예: · 7.1, 이라크 의회, NIC 의장 심문 결정.",
    "- 나쁜 예: · 6.28, 이라크 정부가 부패 척결을 위한 새로운 조치를 강화하고 있다.",
    "- 좋은 예: · 6.28, 이라크 정부, 부패 척결 조치 강화.",
    "- subs는 '* ' 없이 문장만 쓰되, 실제 보고서에서는 '* '로 표시될 세부 설명이다.",
    "- subs도 '~하였다/했다/하고 있다/하기로 결정하였다/해석된다'를 피하고 '~조치로 해석', '~가능성', '~필요', '~확대 전망' 등 보고서형 종결을 사용한다.",
    "- implication은 있으면 '☞ '로 시작한다. 없으면 빈 문자열.",
    "- 정치권 동향에는 총리/내각/의회/NIC/선거/반부패/주택정책과 함께 조정프레임워크, 법치국가연합/말리키, 알수다니 측, 사드르계, PMF/친이란 세력, 수니·쿠르드 정당 활동을 우선 배치한다.",
    "- 정치세력 관련 기사는 단순 나열하지 말고, 이번 주 반복된 압박·방어·연합 재편·의회 견제 흐름으로 묶어 해석한다.",
    "- NIC/투자위원회/의회 심문은 '긍정적 영향'으로 단정하지 말고, 행정절차 부담, 정치적 압박, 승인 지연, 투자사업 관리 강화 관점에서 작성한다.",
    "- 치안에는 IS, PMF, 시위, 납치, 외국인 안전, 바그다드·현장 인근 리스크를 배치한다.",
    "- 경제에는 국제유가, 예산, 전력, 투자, 경제개혁을 배치한다.",
    "- 국제사회에는 이란, 시리아, 이스라엘, 가자, 후티, 미군 등 이라크에 영향을 줄 수 있는 중동 정세를 배치한다.",
    "- 그룹/건설 영향은 반드시 2개 항목만 작성하며, 현장 운영·외부 업무·이동경호·투자사업 일정·정부 행정 리스크 관점으로 작성한다.",
    "- '긍정적인 영향을 미칠 수 있다', '중요한 역할을 할 것이다', '주목된다' 같은 일반론 표현은 금지한다.",
    "- 과장하지 말고, 기존 보고서처럼 짧고 실무적으로 작성한다."
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      input: [
        {
          role: "system",
          content: "You write concise Korean situation reports from provided source notes. Do not invent facts. Output valid JSON only."
        },
        {
          role: "user",
          content: `${prompt}\n\n입력 데이터:\n${JSON.stringify(payload, null, 2)}`
        }
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.output_text || (data.output || [])
    .flatMap((out) => out.content || [])
    .map((c) => c.text || "")
    .join("\n");

  const parsed = parseJsonObject(text);
  if (!parsed) {
    throw new Error(`AI report was not valid JSON: ${String(text).slice(0, 800)}`);
  }

  return normalizeReport(parsed, payload);
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

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function stripFinalPeriod(text = "") {
  return String(text || "").replace(/[.。]+$/g, "").trim();
}

function applyLegacyReportStyle(value = "", kind = "body") {
  let text = normalizeText(value)
    .replace(/^[-•]\s*/, "")
    .replace(/^\*\s*/, "")
    .replace(/^☞\s*/, kind === "implication" ? "" : "")
    .trim();

  if (!text) return "";

  text = text
    .replace(/국가투자위원회/g, "NIC")
    .replace(/투자위원장/g, "NIC 의장")
    .replace(/투자위원회 위원장/g, "NIC 의장")
    .replace(/국가투자위원장/g, "NIC 의장")
    .replace(/국가투자위원회 위원장/g, "NIC 의장")
    .replace(/이라크 의회가\s+(.+?)을\s+심문하기로 결정하였?다/g, "이라크 의회, $1 심문 결정")
    .replace(/이라크 의회가\s+(.+?)를\s+심문하기로 결정하였?다/g, "이라크 의회, $1 심문 결정")
    .replace(/(.+?)가\s+(.+?)을\s+(.+?)하기로 결정하였?다/g, "$1, $2 $3 결정")
    .replace(/(.+?)가\s+(.+?)를\s+(.+?)하기로 결정하였?다/g, "$1, $2 $3 결정")
    .replace(/하기로 결정하였?다/g, "결정")
    .replace(/하기로 했?다/g, "결정")
    .replace(/발표하였?다/g, "발표")
    .replace(/강화하고 있다/g, "강화")
    .replace(/추진하고 있다/g, "추진")
    .replace(/진행하고 있다/g, "진행")
    .replace(/확대하고 있다/g, "확대")
    .replace(/논의하였?다/g, "논의")
    .replace(/승인하였?다/g, "승인")
    .replace(/체포하였?다/g, "체포")
    .replace(/실시하였?다/g, "실시")
    .replace(/해석된다/g, "해석")
    .replace(/판단된다/g, "판단")
    .replace(/예상된다/g, "예상")
    .replace(/전망된다/g, "전망")
    .replace(/필요하다/g, "필요")
    .replace(/가능성이 있다/g, "가능성")
    .replace(/영향을 미칠 수 있다/g, "영향 가능성")
    .replace(/중요한 역할을 할 것이다/g, "연계 가능성")
    .replace(/주목된다/g, "주시 필요")
    .replace(/하였다/g, "함")
    .replace(/했다/g, "함");

  text = text.replace(/\s+/g, " ").trim();

  if (kind === "main") {
    text = text.replace(/^·\s*/, "");
    text = stripFinalPeriod(text);
    return `· ${text}.`;
  }

  if (kind === "implication") {
    text = stripFinalPeriod(text);
    return text ? `☞ ${text}.` : "";
  }

  text = stripFinalPeriod(text);
  return text ? `${text}.` : "";
}

function ensureMain(value) {
  const text = applyLegacyReportStyle(value, "main");
  return text;
}

function ensureSub(value) {
  return applyLegacyReportStyle(value, "sub");
}

function ensureImplication(value) {
  return applyLegacyReportStyle(value, "implication");
}

function normalizeItems(items) {
  return ensureArray(items)
    .map((item) => ({
      main: ensureMain(item.main || item.title || ""),
      subs: ensureArray(item.subs || item.details).map(ensureSub).filter(Boolean).slice(0, 3),
      implication: ensureImplication(item.implication || item.note || "")
    }))
    .filter((item) => item.main)
    .slice(0, 12);
}

function normalizeReport(report, payload) {
  return {
    title: normalizeText(report.title || payload.reportTitle),
    reportDate: normalizeText(report.reportDate || payload.reportDate),
    politicsItems: normalizeItems(report.politicsItems),
    securityItems: normalizeItems(report.securityItems),
    terrorTable: report.terrorTable || {},
    economyItems: normalizeItems(report.economyItems),
    oilTable: ensureArray(report.oilTable).slice(0, 3),
    regionalHeading: normalizeText(report.regionalHeading || "중동 주요 정세"),
    regionalItems: normalizeItems(report.regionalItems),
    impactItems: ensureArray(report.impactItems).map(ensureMain).filter(Boolean).slice(0, 2)
  };
}

function tr(children) {
  return new TableRow({ children });
}

function tc(text, options = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { fill: options.shading } : undefined,
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    children: [p(text, { align: options.align || AlignmentType.CENTER, bold: options.bold, size: options.size || 20 })]
  });
}

function p(text = "", options = {}) {
  const run = new TextRun({
    text: String(text || ""),
    bold: !!options.bold,
    size: options.size || 24,
    font: options.font || "Batang"
  });

  return new Paragraph({
    alignment: options.align || AlignmentType.LEFT,
    spacing: { before: options.before || 0, after: options.after ?? 80, line: options.line || 300 },
    indent: options.indent ? { left: options.indent } : undefined,
    children: [run]
  });
}

function heading(text, level = 1) {
  return p(text, { bold: true, size: level === 1 ? 28 : 25, before: level === 1 ? 260 : 160, after: 120 });
}

function itemParagraphs(items) {
  const out = [];
  if (!items.length) {
    out.push(p("· 특이사항 없음", { size: 24 }));
    return out;
  }

  for (const item of items) {
    out.push(p(item.main, { size: 24, after: 40 }));
    for (const sub of item.subs || []) {
      out.push(p(`* ${sub}`, { size: 23, indent: 320, after: 30 }));
    }
    if (item.implication) {
      out.push(p(item.implication, { size: 23, indent: 320, after: 80 }));
    }
  }

  return out;
}

function terrorTable(data = {}) {
  const values = {
    total: data.total ?? "확인 필요",
    armed: data.armed ?? "-",
    ied: data.ied ?? "-",
    assassination: data.assassination ?? "-",
    protest: data.protest ?? "-",
    shooting: data.shooting ?? "-",
    suicide: data.suicide ?? "-"
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      tr(["구분", "계", "무장세력공격", "IED", "암 살", "시 위", "총 격", "자살폭탄테러"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))),
      tr(["건수", values.total, values.armed, values.ied, values.assassination, values.protest, values.shooting, values.suicide].map((x) => tc(String(x))))
    ]
  });
}

function oilTable(rows = []) {
  const safeRows = rows.length ? rows : [{ date: "확인 필요", dubai: "-", brent: "-", wti: "-" }];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      tr(["구 분", "두바이유", "브렌트유", "서부텍사스유(WTI)"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))),
      ...safeRows.slice(0, 3).map((row) => tr([
        tc(row.date || row.day || "-"),
        tc(row.dubai || row.dubaiOil || "-"),
        tc(row.brent || "-"),
        tc(row.wti || row.WTI || "-")
      ]))
    ]
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: "777777" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "777777" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "777777" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "777777" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "999999" }
  };
}

async function saveDocx(report, period, items) {
  const children = [
    p(report.title, { bold: true, size: 31, align: AlignmentType.CENTER, after: 260 }),
    p(report.reportDate, { size: 24, align: AlignmentType.RIGHT, after: 320 }),

    heading("1. 이라크 국내 상황", 1),
    heading("1) 정국 / 치안", 2),
    p("· 정치권 동향", { size: 24, after: 80 }),
    ...itemParagraphs(report.politicsItems),
    p("· 이라크 주간 테러 상황", { size: 24, after: 80 }),
    terrorTable(report.terrorTable),
    p("", { after: 120 }),
    ...itemParagraphs(report.securityItems),

    heading("2) 경제", 2),
    p("· 국제유가 관련 동향", { size: 24, after: 80 }),
    ...itemParagraphs(report.economyItems),
    oilTable(report.oilTable),
    p("", { after: 120 }),

    heading("2. 국제사회", 1),
    p(`· ${report.regionalHeading || "중동 주요 정세"}`, { size: 24, after: 80 }),
    ...itemParagraphs(report.regionalItems),

    heading("3. 그룹 / 건설에 미치는 영향", 1),
    ...itemParagraphs(report.impactItems.map((main) => ({ main, subs: [], implication: "" })))
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Batang", size: 24 },
          paragraph: { spacing: { line: 300 } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, right: 900, bottom: 900, left: 900 }
          }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], font: "Batang", size: 20 })]
              })
            ]
          })
        },
        children
      }
    ]
  });

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  const datedFile = `건설_이라크 주간 종합상황보고(${fileDateName(period.reportDate)}).docx`;
  const datedPath = path.join(GENERATED_DIR, datedFile);
  const latestPath = path.join(REPORTS_DIR, "latest.docx");
  await fs.writeFile(datedPath, buffer);
  await fs.writeFile(latestPath, buffer);

  const meta = {
    generatedAt: new Date().toISOString(),
    model: OPENAI_MODEL,
    periodStart: toYmd(period.start),
    periodEnd: toYmd(period.end),
    reportDate: toYmd(period.reportDate),
    title: report.title,
    itemCount: items.length,
    file: `reports/generated/${datedFile}`,
    latest: "reports/latest.docx"
  };
  await fs.writeFile(path.join(REPORTS_DIR, "latest.json"), JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(path.join(GENERATED_DIR, datedFile.replace(/\.docx$/i, ".json")), JSON.stringify({ meta, report, sourceItems: items }, null, 2), "utf8");

  return meta;
}

async function main() {
  const period = resolvePeriod();
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const items = await loadWeeklyItems(period);

  if (!items.length) {
    console.warn(`No source items found for ${toYmd(period.start)} ~ ${toYmd(period.end)}. The AI will create an empty report shell.`);
  }

  const payload = buildAiInput(items, period);
  const report = await callOpenAiForReport(payload);
  const meta = await saveDocx(report, period, items);
  console.log("AI weekly report generated:", meta);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
