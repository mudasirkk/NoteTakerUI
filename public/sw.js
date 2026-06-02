// Minimal offline app-shell service worker for the NoteTaker web build. It is
// registered ONLY by the production web build (see main.tsx) — never in dev and
// never in the Tauri desktop shell. Strategy:
//   - navigations:        network-first, fall back to the cached index (offline shell)
//   - same-origin assets: stale-while-revalidate (Vite hashes them, so this is safe
//                         and still picks up new files after a deploy)
//   - cross-origin:       ignored entirely (Firebase auth, YouTube, Google Fonts) so
//                         the SW never sits between the app and the network there.
// Bump CACHE when the precache list changes to retire the old cache on activate.

const CACHE = "notetaker-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Leave cross-origin (auth, video, fonts) to the network, untouched.
  if (url.origin !== self.location.origin) return;

  // App navigations: try the network first so a fresh deploy is picked up, but fall
  // back to the cached shell when offline so the SPA still boots.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Static same-origin assets: serve from cache immediately, refresh in the
  // background. Only cache successful, basic (non-opaque) responses.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
