#!/usr/bin/env node
/**
 * AI Weekly Iraq Situation Report Generator - human-style v2.1
 *
 * Goals:
 * - Match the legacy human weekly report structure and tone.
 * - Select fewer, higher-signal events and keep them in chronological order.
 * - Treat cabinet/COM tables as optional: include only when that week's cabinet decision is selected as a major item.
 */

import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
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
const TEMPLATES_DIR = path.join(ROOT, "templates");
const REFERENCE_REPORTS_DIR = path.join(TEMPLATES_DIR, "reference-reports");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_REPORT_MODEL = process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";
const REPORT_DAYS = Number(process.env.REPORT_DAYS || 7);
const MAX_AI_ITEMS = Number(process.env.MAX_AI_REPORT_ITEMS || 120);
const REPORT_TIMEZONE = "Asia/Seoul";

const SOURCE_FILES = [
  { file: "overseas-news.json", label: "이라크 언론사", type: "iraqMedia" },
  { file: "weekly-context-news.json", label: "이라크 주간 맥락", type: "weeklyContext" },
  { file: "iraq-political-actors.json", label: "이라크 정치세력 동향", type: "politicalActors" },
  { file: "domestic-news.json", label: "국내 언론사", type: "domestic" },
  { file: "com-activities.json", label: "COM 주요활동", type: "com" },
  { file: "sns-activities.json", label: "SNS", type: "sns" }
];

const MAX_SOURCE_TEXT_ITEMS = Number(process.env.MAX_SOURCE_TEXT_ITEMS || 36);
const MAX_SOURCE_TEXT_CHARS = Number(process.env.MAX_SOURCE_TEXT_CHARS || 3600);
const MAX_REFERENCE_REPORTS = Number(process.env.MAX_REFERENCE_REPORTS || 3);
const MAX_REFERENCE_REPORT_CHARS = Number(process.env.MAX_REFERENCE_REPORT_CHARS || 4500);

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
function toYmd(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }

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

function koreanReportDate(date) { return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`; }
function shortLegacyDate(date) { return `΄${String(date.getUTCFullYear()).slice(2)}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`; }
function fileDateName(date) { return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`; }
function periodTitle(period) { return `건설, 이라크 주간 종합 상황보고(${shortLegacyDate(period.start)} ~ ${shortLegacyDate(period.end)})`; }

async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")); } catch { return fallback; }
}
function parseDate(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }
function withinPeriod(value, period) {
  const d = parseDate(value);
  if (!d) return false;
  const day = dateFromYmd(toYmd(d));
  return day >= period.start && day <= period.end;
}
function normalizeText(value = "") { return String(value || "").replace(/\s+/g, " ").trim(); }

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
    const baseTitle = article.title_ko || article.title_original || "COM 주요활동";
    const baseSummary = article.summary_ko || "";
    out.push({
      id: `com-day-${article.id || date}`,
      sourceType: source.type,
      sourceLabel: source.label,
      source: article.source || source.label,
      title: baseTitle,
      originalTitle: article.title_original || "",
      summary: baseSummary,
      details: ministries.map((m) => normalizeText(`${m.ministry_ko || m.ministry_ar || "기관"}: ${m.summary_ko || ""}`)).filter(Boolean),
      category: classifyPlainText(`${baseTitle} ${baseSummary}`),
      importance: Number(article.importance_score || 75),
      bismayahRelevance: /비스마야|BNCP|NIC|투자|주택|건설|인프라/.test(`${baseTitle} ${baseSummary}`) ? "indirect" : "none",
      constructionImpact: /투자|주택|건설|인프라|프로젝트|계약|재건|노동허가|감리/.test(`${baseTitle} ${baseSummary}`) ? "medium" : "low",
      reportUsefulness: "include",
      date,
      url: article.url || "",
      ministries
    });
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
        constructionImpact: /투자|주택|건설|인프라|프로젝트|계약|재건|노동허가|감리/.test(text) ? "medium" : "low",
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
  if (/비스마야|bismayah|hanwha|한화|national investment commission|\bnic\b|هيئة الاستثمار|بسماية|بسمايه/.test(t)) return "bismayah";
  if (/주택|건설|인프라|프로젝트|재건|노동허가|감리|housing|construction|infrastructure|labou?r permit|مشروع|إعمار|اعمار|سكن|اجازة عمل/.test(t)) return "construction";
  if (/테러|치안|안보|납치|공습|로켓|isis|داعش|هجوم|اشتباك|security|militia|pmf|الحشد|خطف|قصف|صاروخ/.test(t)) return "security";
  if (/유가|원유|예산|경제|호르무즈|oil|opec|budget|economy|hormuz|نفط|موازنة|اقتصاد|هرمز/.test(t)) return "economy";
  if (/이란|시리아|이스라엘|가자|하마스|후티|미군|iran|syria|israel|gaza|hamas|houthi|إيران|سوريا|إسرائيل|غزة|حماس|الحوثي|القواعد الأمريكية/.test(t)) return "regional";
  if (/총리|내각|의회|정부|선거|반부패|부패|parliament|cabinet|government|election|corruption|مجلس الوزراء|البرلمان|حكومة|انتخابات|فساد|النزاهة/.test(t)) return "politics";
  return "other";
}

function reportScore(item) {
  let score = Number(item.importance || 0);
  if (item.reportUsefulness === "include") score += 18;
  if (item.reportUsefulness === "exclude") score -= 60;
  if (item.sourceType === "com") score += 10;
  if (item.sourceType === "weeklyContext") score += 10;
  if (item.sourceType === "politicalActors") score += 8;
  if (Array.isArray(item.politicalActors) && item.politicalActors.length) score += 8;
  if (item.weeklySignal) score += 8;
  if (item.bismayahRelevance === "direct") score += 22;
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
    all.push(...normalizeArticlePayload(data, source));
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
    .sort((a, b) => b.reportScore - a.reportScore || new Date(a.date || 0) - new Date(b.date || 0))
    .slice(0, MAX_AI_ITEMS);
}

function itemDateYmd(value) { const d = parseDate(value); return d ? toYmd(d) : String(value || "").slice(0, 10); }
function monthDayFromValue(value = "") { const d = parseDate(value); return d ? `${d.getUTCMonth() + 1}.${d.getUTCDate()}` : ""; }
function truncateText(value = "", limit = MAX_SOURCE_TEXT_CHARS) { const text = normalizeText(value); return text.length > limit ? `${text.slice(0, limit)} ...` : text; }

function summarizePoliticalActors(items) {
  const map = new Map();
  for (const item of items) {
    for (const actor of item.politicalActors || []) {
      const old = map.get(actor) || { actor, count: 0, signals: [] };
      old.count += 1;
      old.signals.push(item.weeklySignal || item.summary || "");
      map.set(actor, old);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10).map((entry) => ({ actor: entry.actor, count: entry.count, signals: [...new Set(entry.signals.filter(Boolean))].slice(0, 4) }));
}

function buildComDigest(items) {
  return items
    .filter((item) => item.sourceType === "com")
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
    .slice(0, 20)
    .map((item) => ({
      date: monthDayFromValue(item.date),
      title: item.title,
      summary: item.summary,
      details: item.details,
      ministries: Array.isArray(item.ministries) ? item.ministries.map((m) => ({ ministry: m.ministry_ko || m.ministry_ar || "", summary: m.summary_ko || "", category: m.category || "" })) : []
    }));
}

function buildHumanStylePriorityHints() {
  return [
    "보고서 기간은 금요일부터 목요일까지이며, 해당 1주일 안에서 주요하다고 판단되는 뉴스만 선별한다.",
    "정치권 동향은 최신순이 아니라 날짜 흐름순으로 배치한다. 같은 날짜 내에서는 정국 영향이 큰 순서로 둔다.",
    "정치권 동향은 6~8개만 선별한다. 각 항목은 - 본문 1개, 필요 시 * 1~2개, 아주 중요한 경우에만 ☞ 1개로 쓴다.",
    "내각회의/COM 결과는 매주 고정으로 넣지 않는다. 그 주 의결사항 중 사업·투자·치안·대외관계에 영향이 큰 경우에만 정치권 동향에 포함하고, 그때만 cabinetTable을 작성한다.",
    "내각회의가 중요하지 않거나 정치권 동향의 주요 항목으로 선택되지 않았다면 cabinetTable은 반드시 빈 배열로 둔다.",
    "테러·치안은 실제 사건만 적는다. 숫자 집계가 없으면 표는 확인 필요로 두되, 사건 문단은 날짜·장소·주체·행위 중심으로 적는다.",
    "경제는 국제유가/예산/전력/주택정책 등 숫자와 정책을 우선한다. 숫자가 없으면 표에는 '-'를 사용한다.",
    "그룹/건설 영향은 2개 항목만, 안전관리와 투자행정 리스크 중심으로 작성한다."
  ];
}

function buildAiInput(items, period, referenceReports = []) {
  const textEligible = new Set(items.filter((item) => item.cleanText || item.fullText).sort((a, b) => b.reportScore - a.reportScore).slice(0, MAX_SOURCE_TEXT_ITEMS).map((item) => item.id));
  return {
    reportTitle: periodTitle(period),
    reportDate: koreanReportDate(period.reportDate),
    periodStart: toYmd(period.start),
    periodEnd: toYmd(period.end),
    humanStylePriorityHints: buildHumanStylePriorityHints(),
    styleGuide: {
      structure: ["1. 이라크 국내 상황", "1) 정국 / 치안", "• 정치권 동향", "• 이라크 주간 테러 상황", "2) 경제", "• 국제유가 관련 동향", "2. 국제사회", "• 해당 주 핵심 국제 이슈", "3. 그룹 / 건설에 미치는 영향"],
      writing: ["보고서형 음슴체. '- 7.2, 주체, 핵심행위' 구조", "세부 설명은 '* ...'로 1~2개만", "분석은 꼭 필요할 때만 '☞ ... 분석/제기/필요/전망'으로 작성", "'중요하다/주목된다/긍정적 영향' 같은 일반론 금지", "없는 숫자·없는 사실 작성 금지", "중복 기사 병합", "인간 보고서 문체처럼 짧게 압축"]
    },
    politicalActorSignals: summarizePoliticalActors(items),
    comDigest: buildComDigest(items),
    referenceReports,
    items: items.map((item) => ({
      date: itemDateYmd(item.date),
      displayDate: monthDayFromValue(item.date),
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

async function loadReferenceReports() {
  try {
    const entries = await fs.readdir(REFERENCE_REPORTS_DIR, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => /\.(docx|txt)$/i.test(name) && !name.startsWith("~$")).sort().slice(0, MAX_REFERENCE_REPORTS);
    const reports = [];
    for (const file of files) {
      const fullPath = path.join(REFERENCE_REPORTS_DIR, file);
      let text = "";
      if (/\.docx$/i.test(file)) text = (await mammoth.extractRawText({ path: fullPath })).value || "";
      else text = await fs.readFile(fullPath, "utf8");
      text = normalizeText(text);
      if (text) reports.push({ file, excerpt: text.length > MAX_REFERENCE_REPORT_CHARS ? `${text.slice(0, MAX_REFERENCE_REPORT_CHARS)} ...` : text });
    }
    return reports;
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    console.warn("Reference report loading skipped:", err.message || err);
    return [];
  }
}

async function callOpenAiForReport(payload) {
  const prompt = [
    "너는 한화 건설부문 비스마야 사업을 담당하는 이라크 정치·경제 주간 상황보고 실무자다.",
    "아래 최근 7일치 기사/정부활동/SNS/정치세력 동향을 바탕으로, 인간이 작성한 기존 보고서와 같은 수준의 보고서 내용을 작성하라.",
    "핵심은 길게 쓰는 것이 아니라, 사업 영향이 있는 사건을 선별·압축하고 시간 흐름순으로 배치하는 것이다.",
    "내각회의/COM 결과는 매주 강제로 넣지 않는다. 해당 주에 사업 영향이 큰 주요 의결이 있을 때만 정치권 동향 항목으로 선택하고, 그 경우에만 cabinetTable을 작성한다.",
    "반드시 JSON 객체만 출력하라. 마크다운 금지. 설명문 금지.",
    "JSON 스키마:",
    "{",
    '  "title": "건설, 이라크 주간 종합 상황보고(΄YY.M.D ~ ΄YY.M.D)",',
    '  "reportDate": "YYYY. M. D.",',
    '  "politicsItems": [{"main":"M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "cabinetTable": [],',
    '  "securityItems": [{"main":"M.D, 주체/장소, 핵심 사건.", "subs":["세부 설명"], "implication":""}],',
    '  "terrorTable": {"total":"확인 필요", "armed":"-", "ied":"-", "assassination":"-", "protest":"-", "shooting":"-", "suicide":"-"},',
    '  "economyItems": [{"main":"M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":"☞ 시사점"}],',
    '  "oilTable": [{"date":"M.D", "dubai":"-", "brent":"-", "wti":"-"}],',
    '  "regionalHeading": "美·이스라엘-이란 분쟁 관련",',
    '  "regionalItems": [{"main":"M.D, 주체, 핵심행위 명사형.", "subs":["세부 설명"], "implication":""}],',
    '  "impactItems": ["현장 운영·외부활동 관련 영향", "투자사업 일정·행정 리스크 관련 영향"]',
    "}",
    "cabinetTable 작성 규칙:",
    "- cabinetTable은 기본값이 빈 배열이다.",
    "- politicsItems에 'M.D, 제N회 내각회의 결과.' 또는 COM 주요 의결 항목을 실제 주요 뉴스로 선택한 경우에만 cabinetTable을 작성한다.",
    "- 내각회의/COM 자료가 입력에 있어도 그 주 보고서의 주요 뉴스가 아니면 cabinetTable은 빈 배열로 둔다.",
    "- cabinetTable을 작성할 때만 [{no, topic, contents}] 형식을 사용한다.",
    "핵심 작성 규칙:",
    "- politics/security/economy/regionalItems는 각 섹션 안에서 반드시 날짜 오름차순으로 작성한다.",
    "- politicsItems는 6~8개 이내. 동일 이슈 반복 기사는 하나로 병합한다.",
    "- main에는 앞 기호를 넣지 말고 'M.D, 주체, 핵심행위 명사형.' 구조로 작성한다. Word 생성 시 자동으로 '- '가 붙는다.",
    "- subs는 '* ' 없이 문장만 쓰되, 실제 보고서에서는 '* '로 표시될 세부 설명이다.",
    "- subs도 '~하였다/했다/하고 있다/하기로 결정하였다/해석된다'를 피하고 '~조치로 해석', '~가능성', '~필요', '~전망' 등 보고서형 종결을 사용한다.",
    "- implication은 있으면 '☞ '로 시작한다. 없으면 빈 문자열.",
    "- 인명·정당명은 가능하면 Al-Sadr, Al-Zaidi, Al-Maliki, Al-Sudani, Baghdad, Teheran처럼 영문 표기한다.",
    "- 국가투자위원회는 본문에서 NIC로 표기한다. 'NIC(NIC)' 금지. '부패방지위원회'보다 '청렴위원회'를 사용한다.",
    "- 기사에 명시되지 않은 테러 건수/유가 숫자는 만들지 말고 '확인 필요' 또는 '-'로 둔다.",
    "- 정치권 동향에는 총리/내각/의회/NIC/반부패/주택정책과 함께 SCF, Al-Maliki, Al-Sadr, PMF/친이란 세력 흐름을 반영한다.",
    "- 치안에는 실제 사건(납치, IS 소탕, 로켓 공격 등)만 작성한다. 비스마야 안전사고는 사업 직접성은 있으나 테러 상황과 혼동하지 않는다.",
    "- 경제에는 국제유가, 예산, 전력, 투자, 주택정책을 배치한다.",
    "- 국제사회에는 이란, 이스라엘, 미국, 후티, 미군 등 이라크 현장 안전에 영향을 줄 수 있는 정세를 배치한다.",
    "- 그룹/건설 영향은 반드시 2개 항목만 작성하며, 현장 안전관리와 투자행정/승인 일정 리스크 관점으로 작성한다.",
    "- '주목된다', '중요한 역할', '긍정적 영향' 같은 일반론 금지. 짧고 실무적으로 작성한다."
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_REPORT_MODEL,
      temperature: 0.15,
      input: [
        { role: "system", content: "You write concise Korean construction risk situation reports. Do not invent facts. Output valid JSON only." },
        { role: "user", content: `${prompt}\n\n입력 데이터:\n${JSON.stringify(payload, null, 2)}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.output_text || (data.output || []).flatMap((out) => out.content || []).map((c) => c.text || "").join("\n");
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error(`AI report was not valid JSON: ${String(text).slice(0, 800)}`);
  return normalizeReport(parsed, payload);
}

function parseJsonObject(text = "") {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}
function ensureArray(value) { return Array.isArray(value) ? value : []; }
function stripFinalPeriod(text = "") { return String(text || "").replace(/[.。]+$/g, "").trim(); }
function humanizeTerms(text = "") {
  return String(text || "")
    .replace(/NIC\s*\(\s*NIC\s*\)/gi, "NIC")
    .replace(/국가투자위원회/g, "NIC")
    .replace(/투자위원장/g, "NIC 의장")
    .replace(/투자위원회 위원장/g, "NIC 의장")
    .replace(/국가투자위원장/g, "NIC 의장")
    .replace(/국가투자위원회 위원장/g, "NIC 의장")
    .replace(/투자청장/g, "NIC 의장")
    .replace(/투자청/g, "NIC")
    .replace(/부패방지위원회/g, "청렴위원회")
    .replace(/조정프레임워크/g, "시아조정기구(SCF)")
    .replace(/법치국가연합·?말리키/g, "Al-Maliki 前 총리")
    .replace(/말리키/g, "Al-Maliki")
    .replace(/알수다니/g, "Al-Sudani")
    .replace(/사드르계/g, "Al-Sadr 계열")
    .replace(/바그다드/g, "Baghdad")
    .replace(/테헤란/g, "Teheran");
}
function applyLegacyReportStyle(value = "", kind = "body", marker = "-") {
  let text = normalizeText(value).replace(/^[·•-]\s*/, "").replace(/^\*\s*/, "").replace(/^☞\s*/, kind === "implication" ? "" : "").trim();
  if (!text) return "";
  text = humanizeTerms(text)
    .replace(/이라크 의회가\s+(.+?)을\s+심문하기로 결정하였?다/g, "이라크 의회, $1 심문 결정")
    .replace(/이라크 의회가\s+(.+?)를\s+심문하기로 결정하였?다/g, "이라크 의회, $1 심문 결정")
    .replace(/(.+?)가\s+(.+?)을\s+(.+?)하기로 결정하였?다/g, "$1, $2 $3 결정")
    .replace(/(.+?)가\s+(.+?)를\s+(.+?)하기로 결정하였?다/g, "$1, $2 $3 결정")
    .replace(/하기로 결정하였?다/g, "결정").replace(/하기로 했?다/g, "결정").replace(/상정하였?다/g, "상정").replace(/의결하였?다/g, "의결")
    .replace(/발표하였?다/g, "발표").replace(/강화하고 있다/g, "강화").replace(/추진하고 있다/g, "추진").replace(/진행하고 있다/g, "진행")
    .replace(/확대하고 있다/g, "확대").replace(/논의하였?다/g, "논의").replace(/승인하였?다/g, "승인").replace(/체포하였?다/g, "체포")
    .replace(/실시하였?다/g, "실시").replace(/해석된다/g, "해석").replace(/판단된다/g, "판단").replace(/예상된다/g, "예상")
    .replace(/전망된다/g, "전망").replace(/필요하다/g, "필요").replace(/가능성이 있다/g, "가능성").replace(/영향을 미칠 수 있다/g, "영향 가능성")
    .replace(/중요한 역할을 할 것이다/g, "연계 가능성").replace(/주목된다/g, "주시 필요").replace(/하였다/g, "함").replace(/했다/g, "함");
  text = text.replace(/NIC\(NIC\)/g, "NIC").replace(/\s+/g, " ").trim();
  if (kind === "main") return `${marker} ${stripFinalPeriod(text)}.`;
  if (kind === "implication") return stripFinalPeriod(text) ? `☞ ${stripFinalPeriod(text)}.` : "";
  return stripFinalPeriod(text) ? `${stripFinalPeriod(text)}.` : "";
}
function ensureMain(value, marker = "-") { return applyLegacyReportStyle(value, "main", marker); }
function ensureSub(value) { return applyLegacyReportStyle(value, "sub"); }
function ensureImplication(value) { return applyLegacyReportStyle(value, "implication"); }
function extractMonthDay(text = "") { const m = String(text || "").match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\D|$)/); return m ? Number(m[1]) * 100 + Number(m[2]) : 9999; }
function sortByReportDate(items = []) { return [...items].sort((a, b) => extractMonthDay(a.main || a.date || "") - extractMonthDay(b.main || b.date || "")); }
function normalizeItems(items, marker = "-", limit = 12) {
  return sortByReportDate(ensureArray(items).map((item) => ({ main: ensureMain(item.main || item.title || "", marker), subs: ensureArray(item.subs || item.details).map(ensureSub).filter(Boolean).slice(0, 2), implication: ensureImplication(item.implication || item.note || "") })).filter((item) => item.main)).slice(0, limit);
}
function normalizeCabinetTable(rows) {
  return ensureArray(rows).map((row, index) => ({ no: normalizeText(row.no || row.number || String(index + 1)), topic: normalizeText(row.topic || row.subject || row.title || ""), contents: ensureArray(row.contents || row.items || row.details).map((x) => stripFinalPeriod(humanizeTerms(normalizeText(x)))).filter(Boolean).slice(0, 4) })).filter((row) => row.topic && row.contents.length).slice(0, 5);
}
function hasCabinetMainItem(items = []) { return items.some((item) => /내각회의|COM|Council of Ministers|مجلس الوزراء|국무회의/.test(item.main || "")); }
function normalizeReport(report, payload) {
  const politicsItems = normalizeItems(report.politicsItems, "-", 8);
  const cabinetTable = hasCabinetMainItem(politicsItems) ? normalizeCabinetTable(report.cabinetTable) : [];
  return {
    title: normalizeText(report.title || payload.reportTitle),
    reportDate: normalizeText(report.reportDate || payload.reportDate),
    politicsItems,
    cabinetTable,
    securityItems: normalizeItems(report.securityItems, "-", 4),
    terrorTable: report.terrorTable || {},
    economyItems: normalizeItems(report.economyItems, "-", 4),
    oilTable: ensureArray(report.oilTable).slice(0, 3).sort((a, b) => extractMonthDay(a.date || a.day) - extractMonthDay(b.date || b.day)),
    regionalHeading: normalizeText(report.regionalHeading || "중동 주요 정세"),
    regionalItems: normalizeItems(report.regionalItems, "-", 6),
    impactItems: ensureArray(report.impactItems).map((item) => ensureMain(item, "•")).filter(Boolean).slice(0, 2)
  };
}

const REPORT_LINE = { single: 240, relaxed: 276, table: 240 };
const REPORT_INDENT = { level2: 567, category: 792, main: 1276, sub: 1450, impact: 792 };
function p(text = "", options = {}) {
  const run = new TextRun({ text: String(text || ""), bold: !!options.bold, italics: !!options.italics, size: options.size || 28, font: options.font || "Batang", underline: options.underline ? { type: "single" } : undefined });
  return new Paragraph({ alignment: options.align || AlignmentType.LEFT, spacing: { before: options.before ?? 0, after: options.after ?? 0, line: options.line ?? REPORT_LINE.single }, indent: options.indent ? { left: options.indent } : undefined, children: [run] });
}
function heading(text, level = 1) { return level === 1 ? p(text, { bold: true, size: 32, before: 220, after: 220, line: REPORT_LINE.single }) : p(text, { bold: true, size: 28, indent: REPORT_INDENT.level2, before: 220, after: 140, line: REPORT_LINE.relaxed }); }
function categoryHeading(text) { return p(text, { bold: true, size: 28, indent: REPORT_INDENT.category, before: 160, after: 120, line: REPORT_LINE.relaxed }); }
function itemParagraphs(items, options = {}) {
  const out = [];
  const mainIndent = options.mainIndent ?? REPORT_INDENT.main;
  const subIndent = options.subIndent ?? REPORT_INDENT.sub;
  const emptyPrefix = options.emptyPrefix || "-";
  if (!items.length) { out.push(p(`${emptyPrefix} 특이사항 없음`, { size: 28, indent: mainIndent, after: 160, line: REPORT_LINE.single })); return out; }
  for (const item of items) {
    out.push(p(item.main, { size: 28, indent: mainIndent, after: 80, line: REPORT_LINE.single }));
    for (const sub of item.subs || []) out.push(p(`* ${sub}`, { size: 28, indent: subIndent, after: 70, line: REPORT_LINE.single }));
    if (item.implication) out.push(p(item.implication, { size: 28, indent: subIndent, italics: true, after: 120, line: REPORT_LINE.single }));
    else out.push(p("", { size: 4, indent: mainIndent, after: 25, line: REPORT_LINE.single }));
  }
  return out;
}
function itemParagraphsWithOptionalCabinet(items, cabinetRows = []) {
  const out = [];
  let inserted = false;
  for (const item of items) {
    out.push(...itemParagraphs([item]));
    if (!inserted && cabinetRows.length && /내각회의|COM|Council of Ministers|مجلس الوزراء|국무회의/.test(item.main)) {
      out.push(cabinetDecisionTable(cabinetRows));
      out.push(p("", { after: 100, line: REPORT_LINE.single }));
      inserted = true;
    }
  }
  return out;
}
function tableBorders() { return { top: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, left: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, right: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "777777" }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "777777" } }; }
function tc(text, options = {}) { return new TableCell({ width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined, shading: options.shading ? { fill: options.shading } : undefined, margins: { top: 45, bottom: 45, left: 70, right: 70 }, children: [p(text, { align: options.align || AlignmentType.CENTER, bold: options.bold, size: options.size || 22, after: 0, line: REPORT_LINE.table })] }); }
function tr(children) { return new TableRow({ children }); }
function contentCell(lines = [], options = {}) { return new TableCell({ width: { size: options.width || 68, type: WidthType.PERCENTAGE }, margins: { top: 45, bottom: 45, left: 90, right: 70 }, children: lines.length ? lines.map((line) => p(`• ${line}`, { align: AlignmentType.LEFT, size: 22, after: 0, line: REPORT_LINE.table })) : [p("-", { size: 22, after: 0 })] }); }
function cabinetDecisionTable(rows = []) {
  const safe = normalizeCabinetTable(rows);
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(), rows: [tr([tc("구 분", { bold: true, shading: "F2F2F2", width: 10 }), tc("주 제", { bold: true, shading: "F2F2F2", width: 22 }), tc("내 용", { bold: true, shading: "F2F2F2", width: 68 })]), ...safe.map((row) => tr([tc(row.no, { width: 10 }), tc(row.topic, { width: 22 }), contentCell(row.contents, { width: 68 })]))] });
}
function terrorTable(data = {}) {
  const values = { total: data.total ?? "확인 필요", armed: data.armed ?? "-", ied: data.ied ?? "-", assassination: data.assassination ?? "-", protest: data.protest ?? "-", shooting: data.shooting ?? "-", suicide: data.suicide ?? "-" };
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(), rows: [tr(["구분", "계", "무장세력공격", "IED", "암 살", "시 위", "총 격", "자살폭탄테러"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))), tr(["건수", values.total, values.armed, values.ied, values.assassination, values.protest, values.shooting, values.suicide].map((x) => tc(String(x))))] });
}
function oilTable(rows = []) {
  const safeRows = rows.length ? rows : [{ date: "확인 필요", dubai: "-", brent: "-", wti: "-" }];
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(), rows: [tr(["구 분", "두바이유", "브렌트유", "서부텍사스유(WTI)"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))), ...safeRows.slice(0, 3).map((row) => tr([tc(row.date || row.day || "-"), tc(row.dubai || row.dubaiOil || "-"), tc(row.brent || "-"), tc(row.wti || row.WTI || "-")]))] });
}

async function saveDocx(report, period, items) {
  const children = [
    p(report.title, { bold: true, underline: true, size: 32, align: AlignmentType.LEFT, after: 90, line: REPORT_LINE.relaxed }),
    p(report.reportDate, { size: 28, align: AlignmentType.RIGHT, after: 260, line: REPORT_LINE.single }),
    heading("1. 이라크 국내 상황", 1),
    heading("1) 정국 / 치안", 2),
    categoryHeading("• 정치권 동향"),
    ...itemParagraphsWithOptionalCabinet(report.politicsItems, report.cabinetTable),
    categoryHeading("• 이라크 주간 테러 상황"),
    terrorTable(report.terrorTable),
    p("", { after: 100, line: REPORT_LINE.single }),
    ...itemParagraphs(report.securityItems),
    heading("2) 경제", 2),
    categoryHeading("• 국제유가 관련 동향"),
    ...itemParagraphs(report.economyItems),
    oilTable(report.oilTable),
    p("", { after: 100, line: REPORT_LINE.single }),
    heading("2. 국제사회", 1),
    categoryHeading(`• ${report.regionalHeading || "중동 주요 정세"}`),
    ...itemParagraphs(report.regionalItems),
    heading("3. 그룹 / 건설에 미치는 영향", 1),
    ...itemParagraphs(report.impactItems.map((main) => ({ main, subs: [], implication: "" })), { mainIndent: REPORT_INDENT.impact, subIndent: REPORT_INDENT.sub, emptyPrefix: "•" })
  ];
  const doc = new Document({
    styles: { default: { document: { run: { font: "Batang", size: 28 }, paragraph: { spacing: { line: REPORT_LINE.single } } } } },
    sections: [{ properties: { page: { margin: { top: 850, right: 900, bottom: 850, left: 900 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: "Batang", size: 20 })] })] }) }, children }]
  });
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  const datedFile = `건설_이라크 주간 종합상황보고(${fileDateName(period.reportDate)}).docx`;
  await fs.writeFile(path.join(GENERATED_DIR, datedFile), buffer);
  await fs.writeFile(path.join(REPORTS_DIR, "latest.docx"), buffer);
  const meta = { generatedAt: new Date().toISOString(), model: OPENAI_REPORT_MODEL, styleVersion: "human-style-v2.1", periodStart: toYmd(period.start), periodEnd: toYmd(period.end), reportDate: toYmd(period.reportDate), title: report.title, itemCount: items.length, file: `reports/generated/${datedFile}`, latest: "reports/latest.docx" };
  await fs.writeFile(path.join(REPORTS_DIR, "latest.json"), JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(path.join(GENERATED_DIR, datedFile.replace(/\.docx$/i, ".json")), JSON.stringify({ meta, report, sourceItems: items }, null, 2), "utf8");
  return meta;
}

async function main() {
  const period = resolvePeriod();
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const items = await loadWeeklyItems(period);
  if (!items.length) console.warn(`No source items found for ${toYmd(period.start)} ~ ${toYmd(period.end)}.`);
  const referenceReports = await loadReferenceReports();
  if (referenceReports.length) console.log(`Loaded ${referenceReports.length} reference report(s) for style guidance.`);
  const payload = buildAiInput(items, period, referenceReports);
  const report = await callOpenAiForReport(payload);
  const meta = await saveDocx(report, period, items);
  console.log("AI weekly report generated:", meta);
}

main().catch((err) => { console.error(err); process.exit(1); });
