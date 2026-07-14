#!/usr/bin/env node
/**
 * Runtime optimizer and evidence-first pipeline patch for collect-news.mjs.
 *
 * The generated collector keeps deterministic keyword/rule filtering first,
 * then tries to obtain article text only for selected articles, and finally
 * creates a Korean summary directly from the available source evidence.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "scripts", "collect-news.mjs");
const OUT = path.join(ROOT, "scripts", "collect-news.fast.mjs");

function replaceOnce(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return src.replace(search, replacement);
}

function replaceRegexOnce(src, regex, replacement, label) {
  if (!regex.test(src)) throw new Error(`Patch regex not found: ${label}`);
  return src.replace(regex, replacement);
}

let code = await fs.readFile(SRC, "utf8");

code = code.replace(
  " * Bismayah / Hanwha Iraq News Collector v12",
  " * Bismayah / Hanwha Iraq News Collector v12-evidence-first"
);

code = replaceOnce(
  code,
  'const MAX_ARTICLE_TEXT_FOR_AI = Number(process.env.MAX_ARTICLE_TEXT_FOR_AI || 10000);',
  `const MAX_ARTICLE_TEXT_FOR_AI = Number(process.env.MAX_ARTICLE_TEXT_FOR_AI || 10000);\n\n// Runtime and evidence-first knobs. Keyword coverage is unchanged; AI is used only after selection.\nconst FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);\nconst GOOGLE_NEWS_QUERY_CONCURRENCY = Number(process.env.GOOGLE_NEWS_QUERY_CONCURRENCY || 6);\nconst IRAQ_MEDIA_SOURCE_CONCURRENCY = Number(process.env.IRAQ_MEDIA_SOURCE_CONCURRENCY || 3);\nconst TRANSLATION_CONCURRENCY = Number(process.env.TRANSLATION_CONCURRENCY || 5);\nconst FULLTEXT_HYDRATION_CONCURRENCY = Number(process.env.FULLTEXT_HYDRATION_CONCURRENCY || 4);\nconst MIN_FULLTEXT_CHARS_FOR_AI = Number(process.env.MIN_FULLTEXT_CHARS_FOR_AI || 500);\nconst MIN_RSS_DESCRIPTION_CHARS_FOR_AI = Number(process.env.MIN_RSS_DESCRIPTION_CHARS_FOR_AI || 220);\nconst HIGH_PRIORITY_RSS_FALLBACK_SCORE = Number(process.env.HIGH_PRIORITY_RSS_FALLBACK_SCORE || 85);\nconst MAX_NEW_AI_ITEMS_PER_CATEGORY = Number(process.env.MAX_NEW_AI_ITEMS_PER_CATEGORY || 100);`,
  "performance and evidence constants"
);

code = replaceRegexOnce(
  code,
  /async function fetchText\(url\) \{[\s\S]*?\n\}\n\n\nasync function readJsonFile/,
  `async function fetchHtmlWithFinalUrl(url) {\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);\n\n  try {\n    const res = await fetch(url, {\n      redirect: "follow",\n      signal: controller.signal,\n      headers: {\n        "user-agent": "Mozilla/5.0 Bismayah News Monitor GitHub Actions",\n        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"\n      }\n    });\n\n    if (!res.ok) throw new Error(\`HTTP \${res.status} \${res.statusText}\`);\n    return { html: await res.text(), finalUrl: res.url || url };\n  } catch (err) {\n    if (err && err.name === "AbortError") throw new Error(\`Timeout after \${FETCH_TIMEOUT_MS}ms\`);\n    throw err;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function fetchText(url) {\n  return (await fetchHtmlWithFinalUrl(url)).html;\n}\n\n\nasync function readJsonFile`,
  "fetch timeout and final URL"
);

const helperInsertAfter = `function canonicalKey(item) {\n  const urlKey = normalizeUrl(item.url || "")\n    .replace(/^https?:\\/\\//, "")\n    .replace(/\\/$/, "");\n\n  const titleKey = String(item.title || "")\n    .toLowerCase()\n    .replace(/\\s+/g, " ")\n    .trim();\n\n  return urlKey || titleKey;\n}\n`;

code = replaceOnce(
  code,
  helperInsertAfter,
  `${helperInsertAfter}\nfunction articleEvidenceText(item = {}) {\n  return normalizeText(item.cleanText || item.fullText || item.description || "");\n}\n\nfunction hasUsableFullText(item = {}) {\n  return normalizeText(item.cleanText || item.fullText || "").length >= MIN_FULLTEXT_CHARS_FOR_AI;\n}\n\nfunction articleRuleScore(item = {}) {\n  return Number(item.importanceScore || item.importance_score || item.relevanceScore || 0);\n}\n\nfunction evidenceLevelFor(item = {}) {\n  if (hasUsableFullText(item)) return "fulltext";\n  if (normalizeText(item.description || "").length >= MIN_RSS_DESCRIPTION_CHARS_FOR_AI) return "rss-description";\n  return "insufficient";\n}\n\nasync function hydrateSelectedArticle(item = {}) {\n  if (hasUsableFullText(item)) {\n    return { ...item, sourceEvidenceLevel: "fulltext", sourceEvidenceChars: articleEvidenceText(item).length };\n  }\n\n  if (!item.url || !/^https?:/i.test(item.url)) {\n    return { ...item, sourceEvidenceLevel: evidenceLevelFor(item), sourceEvidenceChars: articleEvidenceText(item).length };\n  }\n\n  try {\n    const fetched = await fetchHtmlWithFinalUrl(item.url);\n    const finalHost = hostnameOf(fetched.finalUrl || item.url);\n    if (finalHost && finalHost !== "news.google.com") {\n      const parsed = parseArticleHtml(\n        fetched.html,\n        fetched.finalUrl || item.url,\n        { name: item.source || finalHost || "Iraq media", id: "selected-fulltext" },\n        item.publishedAt || ""\n      );\n\n      if (parsed && hasUsableFullText(parsed)) {\n        return {\n          ...item,\n          title: parsed.title || item.title,\n          description: parsed.description || item.description,\n          cleanText: parsed.cleanText,\n          fullText: parsed.fullText,\n          originalTextLength: parsed.originalTextLength,\n          resolvedUrl: parsed.url || fetched.finalUrl,\n          sourceEvidenceLevel: "fulltext",\n          sourceEvidenceChars: articleEvidenceText(parsed).length\n        };\n      }\n    }\n  } catch (err) {\n    console.warn(\`[fulltext] \${String(item.title || "").slice(0, 70)}: \${err.message || err}\`);\n  }\n\n  return { ...item, sourceEvidenceLevel: evidenceLevelFor(item), sourceEvidenceChars: articleEvidenceText(item).length };\n}\n\nfunction canSummarizeFromEvidence(item = {}) {\n  if (item.sourceEvidenceLevel === "fulltext") return true;\n  return item.sourceEvidenceLevel === "rss-description" && articleRuleScore(item) >= HIGH_PRIORITY_RSS_FALLBACK_SCORE;\n}\n\nfunction hasReusableAiSummary(item = {}) {\n  const evidenceBacked = item.sourceEvidenceLevel === "fulltext" || hasUsableFullText(item);\n  return !!(\n    item && evidenceBacked && item.titleKo && item.summaryKo &&\n    !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) && !item.translationFailed &&\n    !responseIntroducesUnsupportedIran(item, item)\n  );\n}\n\nfunction buildPreviousArticleMap(category, cfg) {\n  const out = new Map();\n  try {\n    const raw = JSON.parse(globalThis.__previousDataCache?.get(cfg.output) || "null");\n    const articles = Array.isArray(raw?.articles) ? raw.articles : [];\n    for (const item of articles) {\n      if (hasReusableAiSummary(item)) out.set(canonicalKey(item), item);\n    }\n  } catch {}\n  return out;\n}\n\nfunction reuseAiSummaryIfPossible(item, previousMap) {\n  const cached = previousMap.get(canonicalKey(item));\n  if (!cached || !hasReusableAiSummary(cached)) return { ...item, aiCacheHit: false };\n\n  return {\n    ...item,\n    titleKo: cached.titleKo,\n    summaryKo: cached.summaryKo,\n    detailsKo: Array.isArray(cached.detailsKo) ? cached.detailsKo : item.detailsKo,\n    reportBullet: cached.reportBullet || item.reportBullet,\n    reportSubBullets: Array.isArray(cached.reportSubBullets) ? cached.reportSubBullets : item.reportSubBullets,\n    reportImplication: cached.reportImplication || item.reportImplication,\n    politicalActors: Array.isArray(cached.politicalActors) ? cached.politicalActors : item.politicalActors,\n    weeklySignal: cached.weeklySignal || item.weeklySignal,\n    possibleImpact: cached.possibleImpact || item.possibleImpact,\n    reportCategory: cached.reportCategory || item.reportCategory,\n    importanceScore: cached.importanceScore ?? cached.importance_score ?? item.importanceScore,\n    importance_score: cached.importance_score ?? cached.importanceScore ?? item.importance_score,\n    bismayahRelevance: cached.bismayahRelevance || item.bismayahRelevance,\n    constructionImpact: cached.constructionImpact || item.constructionImpact,\n    reportUsefulness: cached.reportUsefulness || item.reportUsefulness,\n    aiSummaryVersion: cached.aiSummaryVersion || item.aiSummaryVersion,\n    priority: cached.priority || item.priority,\n    sourceEvidenceLevel: cached.sourceEvidenceLevel || "fulltext",\n    sourceEvidenceChars: cached.sourceEvidenceChars || articleEvidenceText(cached).length,\n    aiCacheHit: true\n  };\n}\n`,
  "evidence and cache helpers"
);

code = replaceRegexOnce(
  code,
  /async function collectIraqMediaSites\(\) \{[\s\S]*?\n\}\n\nfunction uniqueRecent/,
  `async function collectIraqMediaSites() {\n  const sources = (await readJsonFile(IRAQ_MEDIA_SOURCES_FILE, []))\n    .filter((source) => source && source.enabled !== false && source.baseUrl);\n\n  const results = await mapLimit(sources, IRAQ_MEDIA_SOURCE_CONCURRENCY, async (source) => {\n    const sourceResult = await collectCandidateUrlsFromSource(source);\n    const rawItems = await mapLimit(sourceResult.candidates, 4, (candidate) => fetchLocalArticle(source, candidate));\n    const validItems = rawItems.filter(Boolean);\n    const filteredItems = validItems.filter(overseasArticleMatches);\n\n    console.log(\`[iraq-media] \${source.name || source.id}: \${filteredItems.length}/\${validItems.length} matched\`);\n\n    return {\n      articles: filteredItems,\n      debug: {\n        ...sourceResult.debug,\n        candidateCount: sourceResult.candidates.length,\n        parsedCount: validItems.length,\n        matchedCount: filteredItems.length\n      }\n    };\n  });\n\n  const all = results.flatMap((item) => item.articles || []);\n  const debug = results.map((item) => item.debug);\n\n  return {\n    sourceCount: sources.length,\n    beforeFilter: debug.reduce((sum, item) => sum + Number(item.parsedCount || 0), 0),\n    articles: uniqueRecent(all, MAX_LOCAL_ARTICLES_TOTAL),\n    debug\n  };\n}\n\nfunction uniqueRecent`,
  "parallel iraq media sources"
);

code = replaceRegexOnce(
  code,
  /async function collectGoogleNews\(category, cfg\) \{[\s\S]*?\n  \}\n\n  if \(category === "overseas"\) \{/,
  `async function collectGoogleNews(category, cfg) {\n  const startedAt = Date.now();\n  const previousPath = path.join(DATA_DIR, cfg.output);\n  globalThis.__previousDataCache ||= new Map();\n  if (!globalThis.__previousDataCache.has(cfg.output)) {\n    try {\n      globalThis.__previousDataCache.set(cfg.output, await fs.readFile(previousPath, "utf8"));\n    } catch {\n      globalThis.__previousDataCache.set(cfg.output, "null");\n    }\n  }\n\n  const queryResults = await mapLimit(cfg.queries, GOOGLE_NEWS_QUERY_CONCURRENCY, async (query) => {\n    const url = googleNewsRssUrl(query, cfg);\n\n    try {\n      const xml = await fetchText(url);\n      let items = parseRssItems(xml, query, category).slice(0, MAX_PER_QUERY);\n      const beforeFilter = items.length;\n\n      if (category === "domestic") items = items.filter(domesticArticleMatches);\n      if (category === "overseas") items = items.filter(overseasArticleMatches);\n      if (category === "weeklyContext") items = items.filter(weeklyContextArticleMatches);\n      if (category === "politicalActors") items = items.filter(politicalActorArticleMatches);\n\n      console.log(\`[\${category}] \${query}: \${items.length}/\${beforeFilter}\`);\n      return { items, debug: { query, ok: true, beforeFilter, afterFilter: items.length } };\n    } catch (err) {\n      console.warn(\`[\${category}] \${query}: \${err.message || err}\`);\n      return { items: [], debug: { query, ok: false, error: String(err.message || err) } };\n    }\n  });\n\n  const all = queryResults.flatMap((item) => item.items || []);\n  const debug = queryResults.map((item) => item.debug);\n\n  if (category === "overseas") {`,
  "parallel google news queries"
);

code = replaceOnce(
  code,
  `  if (OPENAI_API_KEY && ["overseas", "weeklyContext", "politicalActors"].includes(category)) {\n    articles = await mapLimit(articles, 3, enrichArticleKorean);\n\n    articles = articles.filter((item) => {`,
  `  if (OPENAI_API_KEY && ["overseas", "weeklyContext", "politicalActors"].includes(category)) {\n    const previousMap = buildPreviousArticleMap(category, cfg);\n    const beforeCache = articles.length;\n    articles = articles.map((item) => reuseAiSummaryIfPossible(item, previousMap));\n\n    const cacheHits = articles.filter((item) => item.aiCacheHit).length;\n    const uncached = articles.filter((item) => !item.aiCacheHit);\n    const hydrated = await mapLimit(uncached, FULLTEXT_HYDRATION_CONCURRENCY, hydrateSelectedArticle);\n    const hydratedByKey = new Map(hydrated.map((item) => [canonicalKey(item), item]));\n    articles = articles.map((item) => item.aiCacheHit ? item : (hydratedByKey.get(canonicalKey(item)) || item));\n\n    const eligible = articles\n      .filter((item) => !item.aiCacheHit && canSummarizeFromEvidence(item))\n      .sort((a, b) => articleRuleScore(b) - articleRuleScore(a) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))\n      .slice(0, MAX_NEW_AI_ITEMS_PER_CATEGORY);\n\n    const translated = await mapLimit(eligible, TRANSLATION_CONCURRENCY, enrichArticleKorean);\n    const translatedByKey = new Map(translated.map((item) => [canonicalKey(item), item]));\n    articles = articles.map((item) => item.aiCacheHit ? item : (translatedByKey.get(canonicalKey(item)) || item));\n\n    const fulltextCount = articles.filter((item) => item.sourceEvidenceLevel === "fulltext").length;\n    const rssFallbackCount = eligible.filter((item) => item.sourceEvidenceLevel === "rss-description").length;\n    const skippedInsufficient = articles.filter((item) => !item.aiCacheHit && !canSummarizeFromEvidence(item)).length;\n    console.log(\`[\${category}] evidence-first: cache=\${cacheHits}/\${beforeCache}, fulltext=\${fulltextCount}, rssFallback=\${rssFallbackCount}, translated=\${eligible.length}, skippedInsufficient=\${skippedInsufficient}\`);\n\n    articles = articles.filter((item) => {`,
  "evidence-first AI block"
);

code = replaceOnce(
  code,
  `  return {\n    category,`,
  `  console.log(\`[\${category}] completed in \${Math.round((Date.now() - startedAt) / 1000)}s\`);\n\n  return {\n    category,`,
  "category timing log"
);

code = replaceOnce(
  code,
  `  for (const [category, cfg] of Object.entries(CATEGORIES)) {\n    const result = await collectGoogleNews(category, cfg);\n    const outputPath = path.join(DATA_DIR, cfg.output);\n\n    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");\n\n    index.categories[category] = {\n      file: \`data/\${cfg.output}\`,\n      count: result.count,\n      generatedAt: result.generatedAt\n    };\n  }`,
  `  const categoryEntries = Object.entries(CATEGORIES);\n  const categoryResults = await mapLimit(categoryEntries, Number(process.env.CATEGORY_CONCURRENCY || 2), async ([category, cfg]) => {\n    const result = await collectGoogleNews(category, cfg);\n    return { category, cfg, result };\n  });\n\n  for (const { category, cfg, result } of categoryResults) {\n    const outputPath = path.join(DATA_DIR, cfg.output);\n    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");\n    index.categories[category] = {\n      file: \`data/\${cfg.output}\`,\n      count: result.count,\n      generatedAt: result.generatedAt\n    };\n  }`,
  "category concurrency"
);

code = replaceOnce(
  code,
  `async function enrichArticleKorean(item) {`,
  `function sourceMentionsIran(item = {}) {\n  return /إيران|ايران|إيراني|ايراني|طهران|\\biran(?:ian)?\\b|\\btehran\\b|이란|테헤란/i.test(\n    [item.title, item.description, item.cleanText, item.fullText].filter(Boolean).join("\\n")\n  );\n}\n\nfunction responseIntroducesUnsupportedIran(item = {}, parsed = {}) {\n  if (sourceMentionsIran(item)) return false;\n  const output = [\n    parsed.titleKo, parsed.summaryKo, parsed.reportBullet, parsed.reportImplication,\n    ...(Array.isArray(parsed.detailsKo) ? parsed.detailsKo : []),\n    ...(Array.isArray(parsed.reportSubBullets) ? parsed.reportSubBullets : [])\n  ].filter(Boolean).join("\\n");\n  return /이란|테헤란/.test(output);\n}\n\nasync function enrichArticleKorean(item) {`
);

code = replaceOnce(
  code,
  `    \`원문 제목: \${item.title}\`,`,
  `    \`원문 제목: \${item.title}\`,\n    item.sourceEvidenceLevel ? \`근거 수준: \${item.sourceEvidenceLevel} (\${item.sourceEvidenceChars || articleEvidenceText(item).length}자)\` : "",`
);

code = replaceOnce(
  code,
  `      "아래 이라크/중동 관련 기사 본문을 읽고, 한국 기업의 이라크 건설사업 주간보고서에 활용할 수 있도록 구조화하세요.",`,
  `      "아래는 키워드·규칙으로 먼저 선별된 이라크/중동 기사입니다. 제공된 원문 근거만 읽고 한국 기업의 이라크 건설사업 주간보고서용 한국어 요약을 한 번에 작성하세요.",`
);

code = replaceOnce(
  code,
  `      "- 제목만 보지 말고 기사 원문/본문을 기준으로 판단하세요.",`,
  `      "- 제목만 보지 말고 기사 원문/본문을 기준으로 판단하세요.",\n      "- 원문 언어로 별도 요약한 뒤 번역하지 말고, 제공된 근거에서 바로 한국어 핵심 요약을 작성하세요.",\n      "- 국가명·기관명·인명·날짜·수치는 원문과 대조해 그대로 보존하고, 원문에 없는 국가나 주체를 새로 넣지 마세요.",\n      "- 근거 수준이 rss-description이면 제목·설명에서 확인되는 사실만 쓰고 인과관계나 시사점을 확대하지 마세요.",`
);

code = replaceOnce(
  code,
  `      "기사에 없는 내용은 만들지 마세요."`,
  `      "기사에 없는 내용은 만들지 마세요. 특히 국가명·기관명·인명·숫자를 원문과 다시 대조하세요."`
);

code = replaceOnce(
  code,
  `    if (isGoodKoreanTranslation(parsed)) {`,
  `    if (isGoodKoreanTranslation(parsed) && !responseIntroducesUnsupportedIran(item, parsed)) {`
);

code = code.replace(
  'aiSummaryVersion: "report-structured-v2-fulltext-politics"',
  'aiSummaryVersion: `evidence-first-v3-${item.sourceEvidenceLevel || "unknown"}`'
);

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared evidence-first collector: ${path.relative(ROOT, OUT)}`);
console.log(`AI policy: filter first, hydrate selected articles, summarize directly in Korean, no forced country-name replacement.`);
