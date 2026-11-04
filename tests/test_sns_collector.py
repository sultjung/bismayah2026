import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('sns', Path(__file__).parents[1] / 'scripts/fetch_sns_x.py')
sns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sns)

class CollectorTests(unittest.TestCase):
    def test_exact_names_and_variants(self):
        for text in ('بسماية', 'بِسْمَايَة', 'بسمايه', 'بسمایة', 'Bismayah', 'Basmaya'):
            self.assertTrue(sns.is_candidate_text(text), text)
        for text in ('بسماها', 'رفعت شكوى بسما', 'برشلونة دوري أبطال أوروبا'):
            self.assertFalse(sns.is_candidate_text(text), text)
        self.assertNotIn('lang:ar', sns.QUERY)

    def test_402_uses_independent_fallback(self):
        expected = ([{'id':'123'}], {}, {})
        with patch.object(sns, 'fetch_x_posts', side_effect=RuntimeError('X API request failed: 402')), patch.object(sns, 'fetch_indexed_x_posts', return_value=expected) as fallback:
            self.assertEqual(sns.collect_posts(), expected)
            fallback.assert_called_once()
            self.assertFalse(sns.COLLECTION_STATUS['x_api']['ok'])

    def test_indexed_post_keeps_real_url_and_excludes_search_date(self):
        import time
        tweet_id = str((int(time.time() * 1000) - 1288834974657 - 10000) << 22)
        class Response:
            content = (f'<rss><channel><item><link>https://x.com/test/status/{tweet_id}</link><title>Bismayah water services</title><pubDate>wrong search date</pubDate></item></channel></rss>').encode()
            def raise_for_status(self): pass
        with patch.object(sns.requests, 'get', return_value=Response()):
            posts, _, _ = sns.fetch_indexed_x_posts()
            self.assertEqual(len(posts), 1)
            self.assertEqual(posts[0]['_url'], f'https://x.com/test/status/{tweet_id}')
            self.assertEqual(posts[0]['_source'], 'public-search-excerpt')
            self.assertNotEqual(posts[0]['created_at'], 'wrong search date')

    def test_search_pages_and_unrelated_snippets_rejected(self):
        class Response:
            content = b'<rss><channel><item><link>https://x.com/search?q=Bismayah</link><title>Bismayah</title></item><item><link>https://example.com/a/status/123</link><title>Bismayah</title></item></channel></rss>'
            def raise_for_status(self): pass
        with patch.object(sns.requests, 'get', return_value=Response()):
            self.assertEqual(sns.fetch_indexed_x_posts()[0], [])

if __name__ == '__main__':
    unittest.main()
