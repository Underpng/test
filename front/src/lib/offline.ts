import { useSyncExternalStore } from "react";
import type { BookEntry } from "@/api/interface";

// Books saved on this device for reading without a connection.
//
// The files live in Cache Storage under canonical keys (see cacheKey, and
// the same function in public/sw.js); the service worker answers book
// requests from there first, online or not, which also saves data away
// from home. The list of saved books lives in localStorage.
//
// Service workers and Cache Storage only exist on https (or localhost), so
// on plain http://192.168.x.x the feature explains itself instead.

export const BOOK_CACHE = "shelf-books-v1";
const LIST_KEY = "offlineBooks";
const QUALITY_KEY = "offlineQuality";
const CONCURRENCY = 3;

export type SaveQuality = "saver" | "original";

export type SavedBook = {
    book: BookEntry;
    savedAt: number;
    bytes: number;
    files: number;
    total: number;
    complete: boolean;
};

export type Download = { done: number; total: number; error?: string };

type State = { saved: Record<string, SavedBook>; downloads: Record<string, Download>; quality: SaveQuality };

export function offlineSupported(): boolean {
    return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "caches" in window;
}

export function registerServiceWorker() {
    if (!offlineSupported()) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker not registered", e));
}

// cacheKey reduces a book file URL to what identifies the file, ignoring the
// quality and cache-busting parameters. Keep in step with public/sw.js.
export function cacheKey(input: string): string | null {
    const u = new URL(input, location.origin);
    const p = u.pathname;
    const path = encodeURIComponent(u.searchParams.get("path") ?? "");
    if (/^\/book\/(cbz|cbr)$/.test(p)) return `${u.origin}${p}?path=${path}&page=${u.searchParams.get("page") ?? ""}`;
    if (/^\/book\/(cbz|cbr)\/pages$/.test(p) || p === "/book/epub" || p === "/book/pdf") return `${u.origin}${p}?path=${path}`;
    if (p.startsWith("/cover/")) return `${u.origin}${p}`;
    return null;
}

// ----- store -----

function readList(): Record<string, SavedBook> {
    try {
        return JSON.parse(localStorage.getItem(LIST_KEY) ?? "{}") as Record<string, SavedBook>;
    } catch {
        return {};
    }
}

function readQuality(): SaveQuality {
    try {
        return localStorage.getItem(QUALITY_KEY) === "original" ? "original" : "saver";
    } catch {
        return "saver";
    }
}

let state: State = { saved: readList(), downloads: {}, quality: readQuality() };
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
}

function writeSaved(saved: Record<string, SavedBook>) {
    try {
        localStorage.setItem(LIST_KEY, JSON.stringify(saved));
    } catch {
        /* storage blocked: the list lives for this session only */
    }
    emit({ saved });
}

function setDownload(path: string, d: Download | null) {
    const downloads = { ...state.downloads };
    if (d) downloads[path] = d;
    else delete downloads[path];
    emit({ downloads });
}

const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};

export function useOffline(): State {
    return useSyncExternalStore(subscribe, () => state);
}

export function setSaveQuality(quality: SaveQuality) {
    try {
        localStorage.setItem(QUALITY_KEY, quality);
    } catch {
        /* ignore */
    }
    emit({ quality });
}

// rememberProgress keeps a saved book's reading position current, so it
// resumes in the right place even when opened offline.
export function rememberProgress(path: string, position: string, progress: number) {
    const s = state.saved[path];
    if (!s) return;
    writeSaved({ ...state.saved, [path]: { ...s, book: { ...s.book, currentPosition: position, progress } } });
}

// ----- downloading -----

const cancelled = new Set<string>();

function fileUrls(book: BookEntry, pages: number, quality: SaveQuality): string[] {
    const path = encodeURIComponent(book.path);
    const urls: string[] = [];
    switch (book.type) {
        case "CBZ":
        case "CBR": {
            const kind = book.type.toLowerCase();
            for (let n = 1; n <= pages; n++) urls.push(`/book/${kind}?path=${path}&page=${n}&q=${quality}`);
            break;
        }
        case "EPUB":
            urls.push(`/book/epub?path=${path}`);
            break;
        case "PDF":
            urls.push(`/book/pdf?path=${path}`);
            break;
    }
    if (book.cover) urls.push(`/cover${book.cover}`);
    return urls;
}

export function canSave(book: BookEntry): boolean {
    return ["CBZ", "CBR", "EPUB", "PDF"].includes(book.type);
}

// saveBook downloads every file of a book into the device cache. Files
// already there are skipped, so a failed or interrupted save resumes.
export async function saveBook(book: BookEntry): Promise<void> {
    const path = book.path;
    if (!offlineSupported() || !canSave(book)) return;
    const running = state.downloads[path];
    if (running && !running.error) return;
    cancelled.delete(path);
    setDownload(path, { done: 0, total: 0 });
    navigator.storage?.persist?.().catch(() => undefined);

    try {
        const cache = await caches.open(BOOK_CACHE);
        let pages = 0;
        if (book.type === "CBZ" || book.type === "CBR") {
            const listUrl = `/book/${book.type.toLowerCase()}/pages?path=${encodeURIComponent(path)}`;
            const res = await fetch(listUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as { pages: number };
            pages = data.pages;
            await cache.put(cacheKey(listUrl)!, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));
        }
        const urls = fileUrls(book, pages, state.quality);
        const prev = state.saved[path];
        let bytes = prev?.bytes ?? 0;
        writeSaved({
            ...state.saved,
            [path]: { book: prev?.book ?? book, savedAt: Date.now(), bytes, files: prev?.files ?? 0, total: urls.length, complete: false },
        });

        let done = 0;
        let next = 0;
        setDownload(path, { done, total: urls.length });
        const worker = async () => {
            while (next < urls.length) {
                if (cancelled.has(path)) return;
                const url = urls[next++];
                const key = cacheKey(url)!;
                if (!(await cache.match(key))) {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    bytes += blob.size;
                    await cache.put(key, new Response(blob, { headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream" } }));
                }
                done++;
                setDownload(path, { done, total: urls.length });
            }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        if (cancelled.has(path)) return;
        const cur = state.saved[path];
        if (cur) writeSaved({ ...state.saved, [path]: { ...cur, bytes, files: done, complete: true } });
        setDownload(path, null);
    } catch (e) {
        if (cancelled.has(path)) return;
        const quota = e instanceof DOMException && e.name === "QuotaExceededError";
        const d = state.downloads[path];
        setDownload(path, {
            done: d?.done ?? 0,
            total: d?.total ?? 0,
            error: quota ? "端末の空き容量が足りません。" : !navigator.onLine || e instanceof TypeError ? "通信が途切れました。" : "保存できませんでした。",
        });
    }
}

// removeBook deletes a saved book's files, stopping a running download.
export async function removeBook(path: string): Promise<void> {
    cancelled.add(path);
    setDownload(path, null);
    const saved = { ...state.saved };
    const book = saved[path]?.book;
    delete saved[path];
    writeSaved(saved);
    if (!offlineSupported()) return;
    const cache = await caches.open(BOOK_CACHE);
    const encoded = encodeURIComponent(path);
    const cover = book?.cover ? cacheKey(`/cover${book.cover}`) : null;
    for (const req of await cache.keys()) {
        if (req.url.includes(`path=${encoded}&`) || req.url.endsWith(`path=${encoded}`) || req.url === cover) await cache.delete(req);
    }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    try {
        const e = await navigator.storage?.estimate?.();
        return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
    } catch {
        return null;
    }
}

export function formatBytes(n: number): string {
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
    if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
}
