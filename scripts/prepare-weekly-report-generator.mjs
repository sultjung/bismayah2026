#!/usr/bin/env node
/**
 * Builds a source-faithful weekly-report generator without changing the
 * original generator file. The patch keeps country names and actors tied to
 * each source item and prefers evidence-backed article summaries.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "scripts", "generate-weekly-report-ai.mjs");
const OUT = path.join(ROOT, "scripts", "generate-weekly-report-ai.safe.mjs");

function replaceOnce(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return src.replace(search, replacement);
}

let code = await fs.readFile(SRC, "utf8");

code = code.replace(
  " * AI Weekly Iraq Situation Report Generator - human-style v2.1",
  " * AI Weekly Iraq Situation Report Generator - human-style v2.2 source-faithful"
);

code = replaceOnce(
  code,
  `      fullText: normalizeText(article.fullText || article.cleanText || ""),\n      date,`,
  `      fullText: normalizeText(article.fullText || article.cleanText || ""),\n      sourceEvidenceLevel: normalizeText(article.sourceEvidenceLevel || ""),\n      sourceEvidenceChars: Number(article.sourceEvidenceChars || article.originalTextLength || 0),\n      aiSummaryVersion: normalizeText(article.aiSummaryVersion || ""),\n      date,`,
  "article evidence metadata"
);

code = replaceOnce(
  code,
  `      sourceText: textEligible.has(item.id) ? truncateText(item.cleanText || item.fullText || "") : "",\n      importance: item.importance,`,
  `      sourceText: textEligible.has(item.id) ? truncateText(item.cleanText || item.fullText || "") : "",\n      sourceEvidenceLevel: item.sourceEvidenceLevel || "",\n      sourceEvidenceChars: Number(item.sourceEvidenceChars || 0),\n      aiSummaryVersion: item.aiSummaryVersion || "",\n      importance: item.importance,`,
  "AI input evidence metadata"
);

code = replaceOnce(
  code,
  `    "- 정치권 동향에는 총리/내각/의회/NIC/반부패/주택정책과 함께 SCF, Al-Maliki, Al-Sadr, PMF/친이란 세력 흐름을 반영한다.",`,
  `    "- 정치권 동향에는 총리/내각/의회/NIC/반부패/주택정책과 함께 SCF, Al-Maliki, Al-Sadr, PMF/친이란 세력 흐름을 반영한다.",\n    "- 각 보고서 항목은 하나의 입력 기사 또는 동일 사건의 중복 기사 묶음에만 근거한다. 서로 다른 기사에서 국가명·주체·투자 대상을 섞지 않는다.",\n    "- 국가명·기관명·인명·날짜·수치는 입력 title/summary/reportBullet/sourceText의 표기를 그대로 유지한다. 이라크를 이란으로, 이란을 이라크로 바꾸지 않는다.",\n    "- sourceEvidenceLevel이 fulltext인 자료를 우선하고, rss-description 자료는 제목·설명에서 확인되는 사실 이상으로 확대 해석하지 않는다.",`,
  "source-faithful report rules"
);

code = code.replace("temperature: 0.15,", "temperature: 0.1,");
code = code.replace('styleVersion: "human-style-v2.1"', 'styleVersion: "human-style-v2.2-source-faithful"');

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared source-faithful weekly report generator: ${path.relative(ROOT, OUT)}`);
