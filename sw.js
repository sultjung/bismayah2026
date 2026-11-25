// Network-first by design: never serve stale news JSON or scripts.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, {cache:'no-cache'}).catch(() => new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BNCP News</title><body style="font-family:sans-serif;padding:2rem"><h1>인터넷 연결이 필요합니다</h1><p>최신 뉴스를 확인하려면 연결 후 다시 시도하세요.</p><button onclick="location.reload()">다시 시도</button></body></html>', {headers:{'Content-Type':'text/html; charset=utf-8'},status:503})));
  } else if (url.pathname.includes('/data/') || url.pathname.endsWith('.json')) {
    event.respondWith(fetch(event.request,{cache:'no-store'}));
  }
});