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

const MIN_IMPORTANCE = Number(process.env.IMPORTANT_SUMMARY_MIN_SCORE || 85);
const MIN_LINES = Number(process.env.IMPORTANT_SUMMARY_MIN_LINES || 4);
const MAX_LINES = Number(process.env.IMPORTANT_SUMMARY_MAX_LINES || 6);
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

function buildImportantSummary(item = {}) {
  const candidateLines = uniqueLines([
    ...splitLines(item.summaryKo || ""),
    ...linesFromArrayOrString(item.detailsKo),
    ...linesFromArrayOrString(item.reportSubBullets),
    ...splitLines(item.weeklySignal || ""),
    ...splitLines(item.possibleImpact || ""),
    ...splitLines(item.reportImplication || "")
  ]);

  const lines = uniqueLines([...candidateLines, ...fallbackLines(item)]).slice(0, Math.max(MIN_LINES, MAX_LINES));
  return lines.slice(0, Math.max(MIN_LINES, Math.min(MAX_LINES, lines.length))).join("\n");
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
    if (importance < MIN_IMPORTANCE) return item;

    const nextSummary = buildImportantSummary(item);
    const lineCount = splitLines(nextSummary).length;
    if (lineCount < MIN_LINES || nextSummary === String(item.summaryKo || "")) return item;

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
