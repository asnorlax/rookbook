/* Rookbook service worker.
   Strategy: NETWORK FIRST for everything. When you're online you always get the newest
   deploy — the cache never serves you a stale site. The cache only answers when the
   network can't (offline, flaky wifi), which lets the installed app open anywhere and
   browse the stats already saved on the device.
   You should never need to edit this file. If you ever change it, bump CACHE below. */
const CACHE = "rookbook-v3";

const PRECACHE = [
  "/",
  "/og.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
  "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // best-effort: a failed precache item shouldn't block install
      Promise.allSettled(PRECACHE.map((u) => c.add(u)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isOurs = url.origin === self.location.origin;
  const isChessJs = url.href.startsWith("https://cdnjs.cloudflare.com/ajax/libs/chess.js/");
  // Everything else — chess.com API, Stockfish, fonts, GoatCounter — passes straight through.
  if (e.request.method !== "GET" || (!isOurs && !isChessJs)) return;

  // Is this the page itself? Navigations are where a stale copy is actually visible.
  const isPage = e.request.mode === "navigate" || e.request.destination === "document";

  e.respondWith((async () => {
    try {
      /* THE IMPORTANT BIT. `fetch(request)` uses the request's default cache mode, which
         consults the browser's HTTP cache BEFORE the network. So if the host serves
         index.html with any max-age, this "network first" fetch quietly returns the
         browser's stale copy, we store that, and hand it back — a deploy then never
         reaches anyone on a normal refresh, only on a hard one (which bypasses both the
         HTTP cache and this worker). `cache: "no-cache"` forces a real network trip.

         NOT "no-store": that bypasses the HTTP cache in BOTH directions, so no validator
         is ever stored and If-None-Match is never sent — a 304 becomes impossible and every
         visit re-downloads the whole page (~400KB gzipped). "no-cache" still revalidates on
         every navigation, so a deploy always wins and a stale copy is never served, but an
         unchanged page costs a ~300-byte 304 instead of the full body.

         Only the page needs it. Fonts, icons and chess.js barely change, so letting them
         come from the HTTP cache is free speed.

         We refetch by URL rather than passing e.request: a Request whose mode is
         "navigate" cannot be reconstructed with new options, which throws in some
         browsers. Navigations are same-origin GETs, so the URL is enough. */
      const fresh = isPage
        ? await fetch(url.href, { cache: "no-cache", credentials: "same-origin" })
        : await fetch(e.request);

      // Don't poison the cache with 404s or 500s. Opaque responses (status 0) are the
      // no-cors CDN copy of chess.js, worth keeping for offline use.
      if (fresh && (fresh.ok || fresh.type === "opaque")) {
        const c = await caches.open(CACHE);
        c.put(e.request, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      // A navigation with nothing cached for this URL still deserves the app shell
      // rather than the browser's offline error page.
      if (isPage) {
        const shell = await caches.match("/", { ignoreSearch: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
