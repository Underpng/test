import { useEffect, useSyncExternalStore } from "react";
import type { BookEntry } from "@/api/interface";
import { rememberProgress } from "@/lib/offline";

// Changes made from the shelf (read / unread) show on every card at once
// through these overrides, and pages that group books (home) reload.

type Override = { progress: number; finished?: number; currentPosition?: string };

let overrides: Record<string, Override> = {};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};

export function useOverride(path: string): Override | undefined {
    return useSyncExternalStore(subscribe, () => overrides[path]);
}

// withOverride applies a pending change to a book entry.
export function withOverride(book: BookEntry, o: Override | undefined): BookEntry {
    return o ? { ...book, ...o } : book;
}

// clearOverride drops a pending change once the book was read again.
export function clearOverride(path: string) {
    if (!overrides[path]) return;
    const next = { ...overrides };
    delete next[path];
    overrides = next;
    listeners.forEach((l) => l());
}

const CHANGED = "shelf:changed";

// useLibraryChanged runs fn after a read state changed somewhere.
export function useLibraryChanged(fn: () => void) {
    useEffect(() => {
        window.addEventListener(CHANGED, fn);
        return () => window.removeEventListener(CHANGED, fn);
    }, [fn]);
}

// markRead sets a book, or all volumes of a series, as read or unread.
export async function markRead(book: BookEntry, read: boolean): Promise<boolean> {
    const res = await fetch("/api/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: book.path, read }),
    }).catch(() => null);
    if (!res?.ok) return false;
    const o: Override = { progress: read ? 1 : 0 };
    if (book.type === "Series") o.finished = read ? (book.count ?? 0) : 0;
    else if (!read) o.currentPosition = "";
    overrides = { ...overrides, [book.path]: o };
    listeners.forEach((l) => l());
    if (book.type !== "Series" && book.type !== "Folder") rememberProgress(book.path, read ? book.currentPosition : "", o.progress);
    window.dispatchEvent(new Event(CHANGED));
    return true;
}
