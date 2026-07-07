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
  UnderlineType,
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
  { file: "domestic-news.json", label: "국내 언론사", type: "domestic" },
  { file: "com-activities.json", label: "COM 주요활동", type: "com" },
  { file: "sns-activities.json", label: "SNS", type: "sns" }
];

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

function buildAiInput(items, period) {
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
        "각 항목은 '· 날짜, 핵심내용'으로 시작",
        "세부 설명은 '* ...' 형식",
        "분석/시사점은 '☞ ...' 형식",
        "기사에 없는 사실과 숫자는 만들지 않음",
        "중복 기사는 하나로 병합",
        "비스마야, 한화, NIC, COM, 주택·건설·인프라, 바그다드 치안, IS/PMF, 이란·시리아·이스라엘 정세를 우선 반영",
        "그룹/건설 영향은 현장 운영, 외부 업무, 이동경호, 투자사업 일정, 정부 행정 리스크 관점에서 2개 문장으로 정리"
      ]
    },
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
    "목표는 사람이 작성한 기존 샘플과 최대한 같은 판단 기준·문체·보고서 구조로 쓰는 것이다.",
    "아래 최근 7일치 기사/정부활동/SNS 요약을 근거로 중요 사건만 선별·병합해 보고서 내용을 작성하라.",
    "반드시 JSON 객체만 출력하라. 마크다운, 설명문, 주석 금지.",
    "",
    "JSON 스키마:",
    "{",
    '  "title": "건설, 이라크 주간 종합 상황보고(΄YY.M.D ~ ΄YY.M.D)",',
    '  "reportDate": "YYYY. M. D.",',
    '  "politicsItems": [{"main":"M.D, ...", "subs":["..."], "implication":"..."}],',
    '  "securityItems": [{"main":"M.D, ...", "subs":["..."], "implication":"..."}],',
    '  "terrorTable": {"total":"확인 필요", "armed":"-", "ied":"-", "assassination":"-", "protest":"-", "shooting":"-", "suicide":"-"},',
    '  "economyItems": [{"main":"M.D, ...", "subs":["..."], "implication":"..."}],',
    '  "oilTable": [{"date":"M.D", "dubai":"-", "brent":"-", "wti":"-"}],',
    '  "regionalHeading": "美·이스라엘-이란 분쟁 관련 또는 중동 주요 정세",',
    '  "regionalItems": [{"main":"M.D, ...", "subs":["..."], "implication":"..."}],',
    '  "impactItems": ["...", "..."]',
    "}",
    "",
    "내용 선별 기준:",
    "- 모든 기사를 넣지 말고, 기존 보고서처럼 주간 핵심 사건만 압축하라.",
    "- 정치권 동향은 5~8건 내외로 작성한다. 총리/내각/의회/NIC/투자위원회/반부패/주택정책/선거를 우선한다.",
    "- 치안은 구체적 사건만 1~4건 작성한다. 특정 지역·기관·작전·체포·폭발·시위가 없는 일반론은 제외한다.",
    "- 경제는 1~3건 작성한다. 국제유가, 예산, 투자, 전력, 주택·인프라 재원 관련 내용을 우선한다.",
    "- 국제사회는 4~8건 내외로 작성한다. 이란, 시리아, 이스라엘, 가자, 후티, 미군, GCC 등 이라크 안전·물류·외교에 영향을 줄 사안을 우선한다.",
    "- 비슷한 기사는 하나의 항목으로 병합하고, 날짜 범위는 '7.1~7.3'처럼 표시한다.",
    "- 단순 홍보성 기사, 스포츠, 연예, 생활정보, 출처가 불명확한 단신은 제외한다.",
    "- Nabd 같은 뉴스 aggregator 또는 중복성 기사는 원출처·내용이 불명확하면 제외한다.",
    "",
    "문체 규칙:",
    "- main에는 '·' 또는 '-'를 붙이지 말고 'M.D, 내용'만 작성한다. docx 생성 단계에서 기존 양식에 맞춰 '-' 글머리로 표시한다.",
    "- subs에는 '*'를 붙이지 말고 세부설명 문장만 작성한다.",
    "- implication에는 '☞'를 붙이지 말고 분석 문장만 작성한다. 불필요하면 빈 문자열.",
    "- 기존 보고서처럼 간결한 보고체로 작성한다. '~하였다', '~발표', '~추진', '~지시', '~경고' 등 사실 중심 표현을 사용한다.",
    "- '긍정적인 영향을 미칠 수 있다', '중요한 절차로 여겨진다', '주목된다' 같은 일반론·반복 표현은 금지한다.",
    "- NIC/투자위원회/의회 심문은 '투자사업 행정절차, 승인 지연, 정치적 압박, 사업 리스크' 관점으로 해석한다. 근거 없이 긍정적으로 평가하지 말라.",
    "- 그룹/건설 영향은 반드시 2개 항목만 작성하고, 외부활동 안전관리·이동경호·정부 행정 리스크·투자사업 일정·계약/승인 지연 가능성 관점으로 쓴다.",
    "",
    "사실성 규칙:",
    "- 기사에 없는 사실, 숫자, 원인·결과는 만들지 말라.",
    "- 테러표 숫자와 유가표 숫자는 입력에 명시된 경우에만 사용한다. 없으면 '확인 필요' 또는 '-'로 둔다.",
    "- 날짜는 입력 데이터의 date 기준으로 작성하되, 불명확하면 해당 항목을 제외한다.",
    "- 출처가 서로 충돌하면 단정하지 말고 신중한 표현을 사용한다."
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.12,
      input: [
        {
          role: "system",
          content: "You write concise Korean weekly Iraq situation reports for a construction company. Use only provided source notes. Do not invent facts. Output valid JSON only."
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

function ensureMain(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.startsWith("·") ? text : `· ${text}`;
}

function ensureSub(value) {
  const text = normalizeText(value).replace(/^\*\s*/, "");
  return text;
}

function ensureImplication(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.startsWith("☞") ? text : `☞ ${text}`;
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

const FONT = { ascii: "Batang", hAnsi: "Batang", eastAsia: "Batang", cs: "Batang" };
const BODY_SIZE = 28;       // 14pt, 기존 보고서 본문 기준
const SECTION_SIZE = 32;    // 16pt
const TITLE_SIZE = 36;      // 18pt
const FOOTER_SIZE = 20;     // 10pt
const LEFT_BODY = 720;
const LEFT_SUB = 1080;
const LEFT_TOPIC = 560;

function cleanLead(text = "") {
  return normalizeText(text).replace(/^[-*·•☞\s]+/, "").trim();
}

function makeRun(text = "", options = {}) {
  const runOptions = {
    text: String(text || ""),
    bold: !!options.bold,
    italics: !!options.italic,
    size: options.size || BODY_SIZE,
    font: FONT
  };
  if (options.underline) {
    runOptions.underline = { type: UnderlineType.SINGLE };
  }
  return new TextRun(runOptions);
}

function p(text = "", options = {}) {
  return new Paragraph({
    alignment: options.align || AlignmentType.LEFT,
    spacing: {
      before: options.before ?? 0,
      after: options.after ?? 80,
      line: options.line ?? 300
    },
    indent: {
      left: options.left ?? 0,
      firstLine: options.firstLine,
      hanging: options.hanging
    },
    keepNext: !!options.keepNext,
    children: [
      makeRun(text, {
        bold: options.bold,
        italic: options.italic,
        underline: options.underline,
        size: options.size || BODY_SIZE
      })
    ]
  });
}

function titleParagraph(text) {
  return p(text, {
    bold: true,
    underline: true,
    size: TITLE_SIZE,
    align: AlignmentType.LEFT,
    after: 220,
    line: 300
  });
}

function heading(text, level = 1) {
  return p(text, {
    bold: true,
    size: level === 1 ? SECTION_SIZE : BODY_SIZE,
    left: level === 1 ? 0 : 260,
    before: level === 1 ? 240 : 160,
    after: level === 1 ? 170 : 120,
    line: 300,
    keepNext: true
  });
}

function topic(text) {
  return p(`• ${cleanLead(text)}`, {
    bold: true,
    size: BODY_SIZE,
    left: LEFT_TOPIC,
    before: 80,
    after: 90,
    line: 300,
    keepNext: true
  });
}

function mainBullet(text) {
  return p(`-    ${cleanLead(text)}`, {
    size: BODY_SIZE,
    left: LEFT_BODY,
    after: 55,
    line: 310,
    keepNext: true
  });
}

function subBullet(text) {
  return p(`* ${cleanLead(text)}`, {
    size: BODY_SIZE,
    left: LEFT_SUB,
    after: 45,
    line: 310
  });
}

function implication(text) {
  const value = cleanLead(text);
  if (!value) return null;
  return p(`☞ ${value}`, {
    size: BODY_SIZE,
    left: LEFT_SUB,
    after: 115,
    line: 310,
    italic: true
  });
}

function itemParagraphs(items, fallback = "특이사항 없음") {
  const out = [];
  if (!items.length) {
    out.push(mainBullet(fallback));
    return out;
  }

  for (const item of items) {
    out.push(mainBullet(item.main));
    for (const sub of item.subs || []) {
      out.push(subBullet(sub));
    }
    const imp = implication(item.implication);
    if (imp) out.push(imp);
  }

  return out;
}

function tr(children) {
  return new TableRow({ children });
}

function tc(text, options = {}) {
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    shading: options.shading ? { fill: options.shading } : undefined,
    margins: { top: 60, bottom: 60, left: 70, right: 70 },
    children: [p(text, {
      align: options.align || AlignmentType.CENTER,
      bold: options.bold,
      size: options.size || BODY_SIZE,
      after: 0,
      line: 260
    })]
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: "444444" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "444444" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "444444" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "444444" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "777777" },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "777777" }
  };
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
    width: { size: 94, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
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
    width: { size: 80, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
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

async function saveDocx(report, period, items) {
  const children = [
    titleParagraph(report.title),
    p(report.reportDate, { size: BODY_SIZE, align: AlignmentType.RIGHT, after: 280, line: 280 }),

    heading("1. 이라크 국내 상황", 1),
    heading("1) 정국 / 치안", 2),
    topic("정치권 동향"),
    ...itemParagraphs(report.politicsItems),
    topic("이라크 주간 테러 상황"),
    terrorTable(report.terrorTable),
    p("", { after: 150, line: 240 }),
    ...itemParagraphs(report.securityItems, "주요 치안 특이사항 확인 필요"),

    heading("2) 경제", 2),
    topic("국제유가 관련 동향"),
    ...itemParagraphs(report.economyItems, "국제유가 및 경제 관련 주요 동향 확인 필요"),
    oilTable(report.oilTable),
    p("", { after: 160, line: 240 }),

    heading("2. 국제사회", 1),
    topic(report.regionalHeading || "중동 주요 정세"),
    ...itemParagraphs(report.regionalItems),

    heading("3. 그룹 / 건설에 미치는 영향", 1),
    ...itemParagraphs(report.impactItems.map((main) => ({ main, subs: [], implication: "" })))
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
          paragraph: { spacing: { line: 300 } }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
          }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: FOOTER_SIZE })]
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
