#!/usr/bin/env node
/**
 * Runtime optimizer for collect-news.mjs.
 *
 * This does not reduce keyword coverage, item limits, or model quality.
 * It generates scripts/collect-news.fast.mjs with:
 * - fetch timeout
 * - Google News query concurrency
 * - Iraq media source concurrency
 * - OpenAI summary cache reuse
 * - configurable AI translation concurrency
 * - lightweight timing logs
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "scripts", "collect-news.mjs");
const OUT = path.join(ROOT, "scripts", "collect-news.fast.mjs");

function replaceOnce(src, search, replacement, label) {
  if (!src.includes(search)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return src.replace(search, replacement);
}

function replaceRegexOnce(src, regex, replacement, label) {
  if (!regex.test(src)) {
    throw new Error(`Patch regex not found: ${label}`);
  }
  return src.replace(regex, replacement);
}

let code = await fs.readFile(SRC, "utf8");

code = code.replace(
  " * Bismayah / Hanwha Iraq News Collector v12",
  " * Bismayah / Hanwha Iraq News Collector v12-fast-runtime"
);

code = replaceOnce(
  code,
  'const MAX_ARTICLE_TEXT_FOR_AI = Number(process.env.MAX_ARTICLE_TEXT_FOR_AI || 10000);',
  `const MAX_ARTICLE_TEXT_FOR_AI = Number(process.env.MAX_ARTICLE_TEXT_FOR_AI || 10000);\n\n// Runtime performance knobs. Coverage/model quality are intentionally unchanged.\nconst FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);\nconst GOOGLE_NEWS_QUERY_CONCURRENCY = Number(process.env.GOOGLE_NEWS_QUERY_CONCURRENCY || 6);\nconst IRAQ_MEDIA_SOURCE_CONCURRENCY = Number(process.env.IRAQ_MEDIA_SOURCE_CONCURRENCY || 3);\nconst TRANSLATION_CONCURRENCY = Number(process.env.TRANSLATION_CONCURRENCY || 5);`,
  "performance constants"
);

code = replaceRegexOnce(
  code,
  /async function fetchText\(url\) \{[\s\S]*?\n\}\n\n\nasync function readJsonFile/,
  `async function fetchText(url) {\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);\n\n  try {\n    const res = await fetch(url, {\n      signal: controller.signal,\n      headers: {\n        "user-agent": "Mozilla/5.0 Bismayah News Monitor GitHub Actions",\n        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"\n      }\n    });\n\n    if (!res.ok) {\n      throw new Error(\`HTTP \${res.status} \${res.statusText}\`);\n    }\n\n    return await res.text();\n  } catch (err) {\n    if (err && err.name === "AbortError") {\n      throw new Error(\`Timeout after \${FETCH_TIMEOUT_MS}ms\`);\n    }\n    throw err;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\n\nasync function readJsonFile`,
  "fetchText timeout"
);

const helperInsertAfter = `function canonicalKey(item) {\n  const urlKey = normalizeUrl(item.url || "")\n    .replace(/^https?:\\/\\//, "")\n    .replace(/\\/$/, "");\n\n  const titleKey = String(item.title || "")\n    .toLowerCase()\n    .replace(/\\s+/g, " ")\n    .trim();\n\n  return urlKey || titleKey;\n}\n`;

code = replaceOnce(
  code,
  helperInsertAfter,
  `${helperInsertAfter}\nfunction hasReusableAiSummary(item = {}) {\n  return !!(\n    item &&\n    item.titleKo &&\n    item.summaryKo &&\n    !hasArabic(item.titleKo) &&\n    !hasArabic(item.summaryKo) &&\n    !item.translationFailed\n  );\n}\n\nfunction buildPreviousArticleMap(category, cfg) {\n  const out = new Map();\n  try {\n    const raw = JSON.parse(globalThis.__previousDataCache?.get(cfg.output) || "null");\n    const articles = Array.isArray(raw?.articles) ? raw.articles : [];\n    for (const item of articles) {\n      if (hasReusableAiSummary(item)) out.set(canonicalKey(item), item);\n    }\n  } catch {}\n  return out;\n}\n\nfunction reuseAiSummaryIfPossible(item, previousMap) {\n  const cached = previousMap.get(canonicalKey(item));\n  if (!cached || !hasReusableAiSummary(cached)) return { ...item, aiCacheHit: false };\n\n  return {\n    ...item,\n    titleKo: cached.titleKo,\n    summaryKo: cached.summaryKo,\n    detailsKo: Array.isArray(cached.detailsKo) ? cached.detailsKo : item.detailsKo,\n    reportBullet: cached.reportBullet || item.reportBullet,\n    reportSubBullets: Array.isArray(cached.reportSubBullets) ? cached.reportSubBullets : item.reportSubBullets,\n    reportImplication: cached.reportImplication || item.reportImplication,\n    politicalActors: Array.isArray(cached.politicalActors) ? cached.politicalActors : item.politicalActors,\n    weeklySignal: cached.weeklySignal || item.weeklySignal,\n    possibleImpact: cached.possibleImpact || item.possibleImpact,\n    reportCategory: cached.reportCategory || item.reportCategory,\n    importanceScore: cached.importanceScore ?? cached.importance_score ?? item.importanceScore,\n    importance_score: cached.importance_score ?? cached.importanceScore ?? item.importance_score,\n    bismayahRelevance: cached.bismayahRelevance || item.bismayahRelevance,\n    constructionImpact: cached.constructionImpact || item.constructionImpact,\n    reportUsefulness: cached.reportUsefulness || item.reportUsefulness,\n    aiSummaryVersion: cached.aiSummaryVersion || item.aiSummaryVersion,\n    priority: cached.priority || item.priority,\n    aiCacheHit: true\n  };\n}\n`,
  "cache helper insertion"
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
  `async function collectGoogleNews(category, cfg) {\n  const startedAt = Date.now();\n  const previousPath = path.join(DATA_DIR, cfg.output);\n  globalThis.__previousDataCache ||= new Map();\n  if (!globalThis.__previousDataCache.has(cfg.output)) {\n    try {\n      globalThis.__previousDataCache.set(cfg.output, await fs.readFile(previousPath, "utf8"));\n    } catch {\n      globalThis.__previousDataCache.set(cfg.output, "null");\n    }\n  }\n\n  const queryResults = await mapLimit(cfg.queries, GOOGLE_NEWS_QUERY_CONCURRENCY, async (query) => {\n    const url = googleNewsRssUrl(query, cfg);\n\n    try {\n      const xml = await fetchText(url);\n      let items = parseRssItems(xml, query, category).slice(0, MAX_PER_QUERY);\n      const beforeFilter = items.length;\n\n      if (category === "domestic") {\n        items = items.filter(domesticArticleMatches);\n      }\n\n      if (category === "overseas") {\n        items = items.filter(overseasArticleMatches);\n      }\n\n      if (category === "weeklyContext") {\n        items = items.filter(weeklyContextArticleMatches);\n      }\n\n      if (category === "politicalActors") {\n        items = items.filter(politicalActorArticleMatches);\n      }\n\n      console.log(\`[\${category}] \${query}: \${items.length}/\${beforeFilter}\`);\n      return { items, debug: { query, ok: true, beforeFilter, afterFilter: items.length } };\n    } catch (err) {\n      console.warn(\`[\${category}] \${query}: \${err.message || err}\`);\n      return { items: [], debug: { query, ok: false, error: String(err.message || err) } };\n    }\n  });\n\n  const all = queryResults.flatMap((item) => item.items || []);\n  const debug = queryResults.map((item) => item.debug);\n\n  if (category === "overseas") {`,
  "parallel google news queries"
);

code = replaceOnce(
  code,
  `  if (OPENAI_API_KEY && ["overseas", "weeklyContext", "politicalActors"].includes(category)) {\n    articles = await mapLimit(articles, 3, enrichArticleKorean);\n\n    articles = articles.filter((item) => {`,
  `  if (OPENAI_API_KEY && ["overseas", "weeklyContext", "politicalActors"].includes(category)) {\n    const previousMap = buildPreviousArticleMap(category, cfg);\n    const beforeCache = articles.length;\n    articles = articles.map((item) => reuseAiSummaryIfPossible(item, previousMap));\n    const cacheHits = articles.filter((item) => item.aiCacheHit).length;\n    const toTranslate = articles.filter((item) => !item.aiCacheHit);\n    const translated = await mapLimit(toTranslate, TRANSLATION_CONCURRENCY, enrichArticleKorean);\n    const translatedByKey = new Map(translated.map((item) => [canonicalKey(item), item]));\n    articles = articles.map((item) => item.aiCacheHit ? item : (translatedByKey.get(canonicalKey(item)) || item));\n    console.log(\`[\${category}] AI summary cache hits: \${cacheHits}/\${beforeCache}, translated: \${toTranslate.length}, concurrency: \${TRANSLATION_CONCURRENCY}\`);\n\n    articles = articles.filter((item) => {`,
  "AI cache and translation concurrency"
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

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared optimized collector: ${path.relative(ROOT, OUT)}`);
console.log(`Performance knobs: FETCH_TIMEOUT_MS=${process.env.FETCH_TIMEOUT_MS || 12000}, GOOGLE_NEWS_QUERY_CONCURRENCY=${process.env.GOOGLE_NEWS_QUERY_CONCURRENCY || 6}, IRAQ_MEDIA_SOURCE_CONCURRENCY=${process.env.IRAQ_MEDIA_SOURCE_CONCURRENCY || 3}, TRANSLATION_CONCURRENCY=${process.env.TRANSLATION_CONCURRENCY || 5}`);
