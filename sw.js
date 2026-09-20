/* Schat service worker —— 静态资源缓存，API 请求不拦截 */
const VER = 'schat-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './sun_duo.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // API 等跨域请求放行
  if (url.pathname.endsWith('index.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    // HTML：网络优先，失败回缓存
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(VER).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VER).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});
