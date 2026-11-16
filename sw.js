/* MeadEvil service worker — makes the app open with no signal.
 *
 * The app is local-first: recipes, the active batch and the Vault all live in
 * localStorage. But the SHELL (index.html, CSS, JS, fonts) came from the network
 * on every launch, so in a basement or garage with no reception the home-screen
 * icon opened a browser error page and none of that local data was reachable.
 *
 * There is no build step and so no content-hashed filenames. A cache-first
 * worker would therefore pin every user to whatever version they first loaded
 * until someone remembered to bump a version string. This worker is
 * NETWORK-FIRST for everything same-origin: online you always get the deployed
 * files; the cache is only what you fall back to when the network is absent or
 * too slow to be useful.
 */
const CACHE = "meadevil-shell-v1";
const NETWORK_TIMEOUT_MS = 4000;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/css/styles.css",
  "assets/js/mead-logic.js",
  "assets/js/yeast-data.js",
  "assets/js/firebase-config-loader.js",
  "assets/js/firebase-sync.js",
  "assets/js/state-schema.js",
  "assets/js/app.js",
  "assets/js/meadevil-mentor.js",
  "assets/icons/icon-180.png",
  "assets/icons/icon-192.png"
];

// Version-pinned third-party files. Fetched best-effort: failing to reach
// Google at install time must not stop the worker installing.
const THIRD_PARTY = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await Promise.all(THIRD_PARTY.map((url) =>
      fetch(url, { mode: "cors", credentials: "omit" })
        .then((response) => (response.ok ? cache.put(url, response) : null))
        .catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("meadevil-") && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isCacheable(response) {
  return Boolean(response) && response.ok && (response.type === "basic" || response.type === "cors");
}

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  const key = cacheKey || request;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS); });
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(key, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  const first = await Promise.race([network, timeout]);
  clearTimeout(timer);
  if (first) return first;
  const cached = await cache.match(key);
  if (cached) return cached;
  // Nothing cached: the slow network is still the only hope.
  const late = await network;
  if (late) return late;
  return new Response("Offline and not cached yet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request.url, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);
  return cached || (await refresh) || new Response("", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/.netlify/functions/")) {
      // The mentor and the RAPT bridge are live services: never answer them
      // from a cache. The Firebase config is the exception — it is public,
      // static, and without it an offline launch cannot start sync at all, so
      // edits made offline would wait for a full reload instead of reconnect.
      if (url.pathname.endsWith("/firebase-config")) event.respondWith(networkFirst(request));
      return;
    }
    // Any navigation gets the app shell, whatever query string it carried.
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, "index.html"));
      return;
    }
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request));
  }
  // Everything else (Firestore, auth) goes straight to the network.
});
