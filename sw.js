const CACHE = "torisetsu-box-v5";
const SHELL = [
  "./", "index.html", "manifest.json",
  "css/app.css",
  "js/app.js", "js/db.js", "js/export.js", "js/util.js", "js/image.js",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// データはIndexedDB(端末内)にあり、このアプリはアプリシェルだけをキャッシュして
// 完全オフラインで動く(サーバーへの問い合わせが無いため)。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
