import { useCallback, useEffect, useState } from "react";

export type Bookmark = { position: string; label: string; created: number };

// useBookmarks loads a book's bookmarks and toggles them optimistically.
// Offline, toggling still works on screen but is not saved.
export function useBookmarks(path: string) {
    const [list, setList] = useState<Bookmark[]>([]);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/bookmarks?path=${encodeURIComponent(path)}`)
            .then((r) => (r.ok ? r.json() : { bookmarks: [] }))
            .then((d: { bookmarks?: Bookmark[] }) => !cancelled && setList(d.bookmarks ?? []))
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [path]);

    const has = useCallback((position: string) => list.some((b) => b.position === position), [list]);

    const toggle = useCallback(
        (position: string, label: string) => {
            const on = !list.some((b) => b.position === position);
            setList((cur) =>
                on ? [...cur, { position, label, created: Math.floor(Date.now() / 1000) }] : cur.filter((b) => b.position !== position),
            );
            fetch("/api/bookmarks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, position, label, on }),
            })
                .then((r) => (r.ok ? r.json() : null))
                .then((d: { bookmarks?: Bookmark[] } | null) => d?.bookmarks && setList(d.bookmarks))
                .catch(() => undefined);
            return on;
        },
        [list, path],
    );

    return { list, has, toggle };
}
