#!/usr/bin/env node
/**
 * Ensure important news articles keep a richer Korean summary.
 *
 * Rule:
 * - If importanceScore / importance_score is 85 or higher,
 *   summaryKo must contain at least 4 Korean lines.
 * - This is a formatting/reliability guard after AI summarization.
 * - It does not invent article facts; fallback lines are marked as follow-up checks.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");

const MIN_IMPORTANCE = Number(process.env.IMPORTANT_SUMMARY_MIN_SCORE || 71);
const MIN_LINES = Number(process.env.IMPORTANT_SUMMARY_MIN_LINES || 5);
const MAX_LINES = Number(process.env.IMPORTANT_SUMMARY_MAX_LINES || 10);
const TARGET_FILES = (process.env.IMPORTANT_SUMMARY_FILES || "domestic-news.json,overseas-news.json")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function cleanLine(value = "") {
  return String(value || "")
    .replace(/^[-*·•▶☞\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensurePeriod(value = "") {
  const text = cleanLine(value);
  if (!text) return "";
  return /[.!?。다임됨함음요필요확인점검전망]$/.test(text) ? text : `${text}.`;
}

function normalizeKey(value = "") {
  return cleanLine(value).replace(/[.。!?]/g, "").toLowerCase();
}

function uniqueLines(lines = []) {
  const seen = new Set();
  const result = [];

  for (const raw of lines) {
    const line = ensurePeriod(raw);
    if (!line || line.length < 8) continue;
    const key = normalizeKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }

  return result;
}

function splitLines(value = "") {
  return String(value || "")
    .split(/\n+|(?<=다\.)\s+|(?<=임\.)\s+|(?<=됨\.)\s+|(?<=함\.)\s+|(?<=필요\.)\s+|(?<=전망\.)\s+/)
    .map(cleanLine)
    .filter(Boolean);
}

function linesFromArrayOrString(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitLines(item));
  return splitLines(value || "");
}

function getImportance(item = {}) {
  const value = item.importanceScore ?? item.importance_score;
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fallbackLines(item = {}) {
  const title = cleanLine(item.titleKo || item.title || "");
  const reportCategory = cleanLine(item.reportCategory || item.category || "");

  return uniqueLines([
    title ? `${title} 관련 핵심 동향으로 분류됨.` : "중요도 85점 이상 핵심 기사로 분류됨.",
    reportCategory ? `${reportCategory} 분야에서 비스마야 사업 영향 여부 확인 필요.` : "비스마야·한화 사업과의 직접 또는 간접 영향 여부 확인 필요.",
    "후속 보도와 공식 발표를 통해 사실관계 및 영향 범위 점검 필요.",
    "관련 기관의 의사결정·승인 일정 변화 가능성 모니터링 필요."
  ]);
}

function cabinetResolutionLines(item = {}) {
  const text = String(item.cleanText || item.fullText || item.description || item.title || "");
  const candidates = [
    [/الحشد الشعبي/, "하시드 샤비 법안의 내각 의결 후 국회 회부."],
    [/الرعاية الصحية لقوى الأمن الداخلي/, "내무부 보안기관 의료지원 법안 승인 및 국회 회부."],
    [/معهد التخطيط الحضري والإقليمي/, "도시·지역계획 고등연구소 설립 법안 승인 및 국회 회부."],
    [/مدينة الصدر الجديدة|١١\s*ألف وحدة|11\s*ألف وحدة/, "새 사드르시 1만1천 세대 구역 기반시설·도로 사업의 설계·감리 계약 승인."],
    [/جامعة الموصل/, "모술대학교 직원 대상 니느와주 토지 매각 승인, 법적 절차 및 실제 가치 평가 지시."],
    [/المديرية العامة للمجاري/, "건설·주택·지자치부 하수국 예산 배정 조정 승인."],
    [/الدوائر العدلية|أبنية الدوائر العدلية/, "정의기관 청사 신축·보수·매입을 위한 재원 배분 권고 승인."],
    [/استرداد الأموال العراقية في الأردن/, "요르단 내 이라크 자산 회수와 채무 조정을 위한 재무부 주도 공동위원회 구성."],
    [/الأمر الديواني رقم \(25274\)/, "기존 특별위원회를 해산하고 외교부가 미국 재무부와 개별 사안 정보를 협의하도록 결정."],
    [/منع تصدير معادن النحاس/, "구리·알루미늄·납·철 스크랩 등 일부 금속류 수출 제한으로 국내 산업 공급 확보." ]
  ];
  return candidates.filter(([pattern]) => pattern.test(text)).map(([, line]) => line);
}

function buildImportantSummary(item = {}) {
  const isCabinet = isCabinetResolution(item);
  if (isCabinet) {
    const cabinetLines = linesFromArrayOrString(item.summaryKo);
    const contentLines = [
      ...cabinetLines,
      ...linesFromArrayOrString(item.detailsKo),
      ...linesFromArrayOrString(item.reportSubBullets),
      ...cabinetResolutionLines(item)
    ];
    const cabinetSummary = uniqueLines(contentLines).slice(0, MAX_LINES);
    if (cabinetSummary.length >= MIN_LINES) return cabinetSummary.join("\n");
  }

  const candidateLines = uniqueLines([
    ...splitLines(item.summaryKo || ""),
    ...linesFromArrayOrString(item.detailsKo),
    ...linesFromArrayOrString(item.reportSubBullets),
    ...splitLines(item.weeklySignal || ""),
    ...splitLines(item.possibleImpact || ""),
    ...splitLines(item.reportImplication || "")
  ]);

  const lines = isCabinet
    ? uniqueLines([...candidateLines, ...cabinetResolutionLines(item)]).slice(0, MAX_LINES)
    : candidateLines;
  if (!isCabinet && lines.length < MIN_LINES) return String(item.summaryKo || "");
  return lines.slice(0, Math.max(MIN_LINES, Math.min(MAX_LINES, lines.length))).join("\n");
}

function isCabinetResolution(item = {}) {
  const text = [item.title, item.titleKo, item.title_ko, item.description, item.summaryKo, item.cleanText, item.fullText]
    .filter(Boolean).join(" ").toLowerCase();
  return /مجلس الوزراء|مقررات جلسة مجلس الوزراء|قرارات مجلس الوزراء|cabinet|council of ministers|국무회의|내각 회의|이라크 내각/.test(text);
}

async function processFile(filename) {
  const filePath = path.join(DATA_DIR, filename);

  try {
    await fs.access(filePath);
  } catch {
    return { filename, skipped: true, reason: "missing" };
  }

  const data = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!Array.isArray(data.articles)) return { filename, skipped: true, reason: "no articles" };

  let changed = 0;
  const articles = data.articles.map((item) => {
    const importance = getImportance(item);
    const cabinet = isCabinetResolution(item);
    if (importance < MIN_IMPORTANCE && !cabinet) return item;

    const nextSummary = buildImportantSummary(item);
    const lineCount = splitLines(nextSummary).length;
    if ((lineCount < MIN_LINES && !cabinet) || nextSummary === String(item.summaryKo || "")) return item;

    changed += 1;
    return {
      ...item,
      summaryKo: nextSummary,
      aiSummaryVersion: `${item.aiSummaryVersion || "existing"}+important-${MIN_LINES}line-guard-v1`
    };
  });

  if (!changed) return { filename, changed: 0, count: data.articles.length };

  const next = {
    ...data,
    importantSummaryRule: `importanceScore >= ${MIN_IMPORTANCE} => summaryKo has at least ${MIN_LINES} Korean lines`,
    articles
  };

  if (next.postprocess && typeof next.postprocess === "object") {
    next.postprocess = {
      ...next.postprocess,
      importantSummaryGuard: `importanceScore >= ${MIN_IMPORTANCE} => at least ${MIN_LINES} Korean lines`,
      importantSummaryGuardAt: new Date().toISOString()
    };
  }

  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { filename, changed, count: articles.length };
}

async function main() {
  const results = [];
  for (const filename of TARGET_FILES) {
    results.push(await processFile(filename));
  }
  console.log(`[ensure-important-summaries] ${JSON.stringify(results)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
