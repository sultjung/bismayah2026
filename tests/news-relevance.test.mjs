import assert from 'node:assert/strict';
import {scoreOverseasArticle, extractStructuredArticleBody} from '../scripts/collect-news.mjs';
const contaminated = {
 title: 'برشلونة يضرب أستون فيلا بثلاثية ويقفز لوصافة دوري أبطال أوروبا',
 description: 'بغداد العراق النفط مشروع شركة', collection_method: 'iraq-media-direct',
};
assert.equal(scoreOverseasArticle(contaminated).score, -999);
assert.equal(scoreOverseasArticle({...contaminated, title:'قصة ثقافية جديدة'}).score, -999);
assert.equal(scoreOverseasArticle({title:'مشروع بسماية السكني في العراق',collection_method:'iraq-media-direct'}).score,100);
assert.equal(scoreOverseasArticle({title:'Iraq housing project',description:'Iraq launches housing project'}).score >= 35,true);
assert.equal(extractStructuredArticleBody('<script type="application/ld+json">{"@graph":[{"articleBody":"Real article"}]}</script><aside>Related project</aside>'),'Real article');
console.log('News relevance regressions passed');
