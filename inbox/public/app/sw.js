// Watchtower on a phone: the app opens at once and says something useful when
// there is no network. The page's own files are kept (their names carry a hash,
// so one is never stale), and the page itself comes from the network and is kept
// for the next time it is not there. The numbers are never kept here: the app
// holds its own last good answer and says how old it is. (Notifications are
// the next milestone's.)
const CACHE = "watchtower-app-1";
const PAGE = "/stats/next/";

// (hashed files of old deploys pile up: keep the newest sixty)
const trim = (cache) => cache.keys().then((keys) => (keys.length > 60 ? Promise.all(keys.slice(0, keys.length - 60).map((k) => cache.delete(k))) : undefined));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate" && url.pathname.startsWith(PAGE.slice(0, -1))) {
    event.respondWith(
      fetch(req).then(
        (res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(PAGE, copy));
          }
          return res;
        },
        () => caches.match(PAGE).then((hit) => hit || new Response("Offline. The numbers come back with the network.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } })),
      ),
    );
  } else if (url.pathname.startsWith("/app/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c)));
            }
            return res;
          }),
      ),
    );
  }
});
