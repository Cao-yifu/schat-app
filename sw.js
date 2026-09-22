const CACHE_NAME = 'schat-v2-v3';
const PRECACHE = [
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name !== CACHE_NAME && name.indexOf('schat-v2-') === 0) {
            return caches.delete(name);
          }
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function cached(request, isNavigation) {
  return caches.match(request).then(function (response) {
    if (response) return response;
    if (isNavigation) return caches.match('./index.html');
    return undefined;
  });
}

function networkFirst(request, isNavigation) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.put(request, copy);
      });
    }
    return response;
  }).catch(function () {
    return cached(request, isNavigation);
  });
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol === 'data:' || request.destination === 'image') return;

  const isNavigation = request.mode === 'navigate';
  const isStaticCode = url.origin === self.location.origin && /\.(?:js|css|json)$/i.test(url.pathname);
  if (!isNavigation && !isStaticCode) return;

  event.respondWith(networkFirst(request, isNavigation));
});
