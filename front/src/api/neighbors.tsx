import { BookEntry } from "./interface";

export type Neighbors = {
    prev: BookEntry | null;
    next: BookEntry | null;
    index: number;   // 1-based position of this book inside its folder
    total: number;
    folder: string;
};

export async function fetchNeighbors(path: string): Promise<Neighbors | null> {
    try {
        const res = await fetch(`/api/neighbors?path=${encodeURIComponent(path)}`);
        if (!res.ok) return null;
        return (await res.json()) as Neighbors;
    } catch (e) {
        console.warn("Failed to fetch neighbors", e);
        return null;
    }
}
