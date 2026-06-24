/* LostWeightNow service worker.
   Network-first for the app shell (HTML/JS/CSS) so updates are picked up as
   soon as you're online; cache-first for icons/manifest; cache is the offline
   fallback for everything. Bump CACHE on any change to retire old caches. */
const CACHE = "lwn-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/util.js",
  "./js/store.js",
  "./js/domain.js",
  "./js/render.js",
  "./js/sync.js",
  "./js/ui.js",
  "./manifest.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Treat navigations and our own HTML/JS/CSS as "fresh-preferred".
function isAppShell(request, url) {
  return request.mode === "navigate" || /\.(html|js|css)$/.test(url.pathname);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through

  if (isAppShell(request, url)) {
    // network-first: try the live version, fall back to cache when offline
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true })
          .then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // everything else (icons, manifest): cache-first, then network
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
    )
  );
});
