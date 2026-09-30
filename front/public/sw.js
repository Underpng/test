// shelf service worker: lets the app open without a connection and serves
// books saved on this device (see src/lib/offline.ts).
//
// - Book files saved on the device answer from Cache Storage first, online
//   or not, so a saved volume costs no data away from home.
// - The app shell (index.html, hashed scripts and styles, icons) is kept so
//   the home-screen app still starts offline.
// - The API always goes to the network.

const SHELL = "shelf-shell-v1";
const BOOKS = "shelf-books-v1";
const HASHED = /\.[0-9a-f]{8}(-[0-9a-f]{6})?\.(js|css|jpg|png|webp|svg|wasm)$/;

// Keep in step with cacheKey in src/lib/offline.ts.
function cacheKey(u) {
    const p = u.pathname;
    const path = encodeURIComponent(u.searchParams.get("path") || "");
    if (/^\/book\/(cbz|cbr)$/.test(p)) return `${u.origin}${p}?path=${path}&page=${u.searchParams.get("page") || ""}`;
    if (/^\/book\/(cbz|cbr)\/pages$/.test(p) || p === "/book/epub" || p === "/book/pdf") return `${u.origin}${p}?path=${path}`;
    if (p.startsWith("/cover/")) return `${u.origin}${p}`;
    return null;
}

// Cache the page and everything it references, so the first offline start
// works even before the reader browsed around.
async function cacheShell() {
    const cache = await caches.open(SHELL);
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put("/", res);
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
    await Promise.all(refs.map((u) => cache.add(u).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
    event.waitUntil(cacheShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const key = cacheKey(url);
    if (key) {
        event.respondWith(fromBooks(req, key));
        return;
    }
    if (url.pathname.startsWith("/api/")) return;

    if (req.mode === "navigate") {
        event.respondWith(page(event));
        return;
    }
    if (HASHED.test(url.pathname)) {
        event.respondWith(cacheFirst(req));
        return;
    }
    event.respondWith(staleWhileRevalidate(req));
});

async function fromBooks(req, key) {
    const hit = await caches.open(BOOKS).then((c) => c.match(key));
    return hit || fetch(req);
}

// A connection that neither answers nor fails (weak Wi-Fi, a stalled mobile
// link) would keep the home-screen app on a blank screen, so the kept copy
// takes over after this long.
const PAGE_TIMEOUT_MS = 3000;

// Navigations: fresh from the server when possible, the kept copy otherwise.
async function page(event) {
    const cache = await caches.open(SHELL);
    const fresh = fetch(event.request).then((res) => {
        if (res.ok && (res.headers.get("Content-Type") || "").includes("text/html")) cache.put("/", res.clone());
        return res;
    });
    const hit = await cache.match("/");
    if (!hit) return fresh;
    // Let a slow answer still refresh the kept copy for next time.
    event.waitUntil(fresh.catch(() => undefined));
    let timer;
    const slow = new Promise((resolve) => {
        timer = setTimeout(() => resolve(hit), PAGE_TIMEOUT_MS);
    });
    try {
        return await Promise.race([fresh, slow]);
    } catch {
        return hit;
    } finally {
        clearTimeout(timer);
    }
}

async function cacheFirst(req) {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    const fresh = fetch(req)
        .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
        })
        .catch(() => hit);
    return hit || fresh;
}
