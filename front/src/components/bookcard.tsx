import { useState } from "react";
import { BookEntry } from "@/api/interface";
import { BookOpen, Folder, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { viewerUrl } from "@/lib/viewer-url";

interface BookCardProps {
    book: BookEntry;
    // "shelf": fixed width for horizontal rows; "grid": fills its cell.
    layout?: "shelf" | "grid";
    // Position in its list: the first few cards animate in with a stagger.
    index?: number;
}

export function BookCard({ book, layout = "shelf", index = 0 }: BookCardProps) {
    const [loaded, setLoaded] = useState(false);
    const isFolder = book.type === "Folder";
    const isSeries = book.type === "Series";
    const stacked = isFolder || isSeries;
    const pct = Math.round((book.progress ?? 0) * 100);
    const width = layout === "grid" ? "w-full" : "w-[136px] md:w-[152px]";
    const stagger = index < 12 ? { animationDelay: `${index * 40}ms` } : undefined;

    let caption: string | null = null;
    if (isSeries) {
        const count = book.count ?? 0;
        const finished = book.finished ?? 0;
        caption = finished > 0 ? `${finished} / ${count} 巻 読了` : `${count} 巻`;
    } else if (!isFolder && pct > 0) {
        caption = pct >= 98 ? "読了" : `${pct}%`;
    }

    return (
        <Link
            to={viewerUrl(book)}
            className={`group block flex-shrink-0 animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-300 motion-reduce:animate-none ${width}`}
            style={stagger}
            title={book.title}
        >
            <div className={`relative ${stacked ? "pt-2" : ""}`}>
                {stacked && (
                    <>
                        <div className="absolute inset-x-3 top-0 h-6 rounded-t-xl bg-surface-highest" />
                        <div className="absolute inset-x-1.5 top-1 h-6 rounded-t-xl bg-surface-high" />
                    </>
                )}
                <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-high shadow-sm ring-1 ring-black/5 transition group-hover:shadow-md group-active:scale-[0.98] dark:ring-white/5">
                    {book.cover ? (
                        <img
                            src={`/cover${book.cover}`}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            onLoad={() => setLoaded(true)}
                            className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            {stacked ? <Folder size={36} /> : <BookOpen size={36} />}
                        </div>
                    )}
                    {isFolder && (
                        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
                            <Folder size={12} />
                            フォルダ
                        </span>
                    )}
                    {isSeries && (
                        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
                            <Layers size={12} />
                            {book.count ?? 0} 巻
                        </span>
                    )}
                    {pct > 0 && !isFolder && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                    )}
                </div>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-snug">{book.title}</p>
            {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
        </Link>
    );
}

// Placeholder with the same footprint as a card, for loading states.
export function BookCardSkeleton({ layout = "shelf" }: { layout?: "shelf" | "grid" }) {
    const width = layout === "grid" ? "w-full" : "w-[136px] md:w-[152px]";
    return (
        <div className={`flex-shrink-0 ${width}`} aria-hidden>
            <div className="aspect-[2/3] animate-pulse rounded-xl bg-surface-high" />
            <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-surface-high" />
            <div className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-surface-high" />
        </div>
    );
}
