import { useCallback, useEffect, useState } from "react";
import { BookEntry } from "./interface";

export type Neighbors = {
    prev: BookEntry | null;
    next: BookEntry | null;
    index: number;   // 1-based position of this book inside its folder
    total: number;
    folder: string;
    series: boolean; // false for loose books in the library root
};

// "loading" and "error" must never be mistaken for "there is no next
// volume": only a ready answer can say the series is finished.
export type NeighborState =
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; data: Neighbors };

export function useNeighbors(path: string) {
    const [state, setState] = useState<NeighborState>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        fetch(`/api/neighbors?path=${encodeURIComponent(path)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data: Partial<Neighbors>) => {
                if (cancelled) return;
                setState({
                    status: "ready",
                    data: {
                        prev: data.prev ?? null,
                        next: data.next ?? null,
                        index: data.index ?? 0,
                        total: data.total ?? 0,
                        folder: data.folder ?? "/",
                        series: data.series ?? true,
                    },
                });
            })
            .catch((e) => {
                console.warn("Failed to fetch neighbors", e);
                if (!cancelled) setState({ status: "error" });
            });
        return () => {
            cancelled = true;
        };
    }, [path, attempt]);

    const retry = useCallback(() => setAttempt((a) => a + 1), []);
    const data = state.status === "ready" ? state.data : null;
    return { state, data, retry };
}

// Where "back to the shelf" goes: the book's folder when known.
export function shelfUrl(data: Neighbors | null): string {
    if (!data) return "/";
    return data.folder === "/" ? "/root" : `/root${data.folder}`;
}
