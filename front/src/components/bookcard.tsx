import { useRef, useState } from "react";
import { BookEntry } from "@/api/interface";
import { BookOpen, CircleCheck, Folder, Layers, MoreVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { viewerUrl } from "@/lib/viewer-url";
import { useBookActions } from "@/components/book-actions";
import { useOverride, withOverride } from "@/lib/library";
import { useOffline } from "@/lib/offline";

const LONG_PRESS_MS = 500;

interface BookCardProps {
    book: BookEntry;
    // "shelf": fixed width for horizontal rows; "grid": fills its cell.
    layout?: "shelf" | "grid";
    // Position in its list: the first few cards animate in with a stagger.
    index?: number;
}

export function BookCard({ book: base, layout = "shelf", index = 0 }: BookCardProps) {
    const book = withOverride(base, useOverride(base.path));
    const [loaded, setLoaded] = useState(false);
    const actions = useBookActions();
    const saved = useOffline().saved[book.path]?.complete;
    const hasActions = book.type !== "Folder";

    // Long press (or right click) opens the book's actions instead.
    const press = useRef<{ timer: number; x: number; y: number } | null>(null);
    const suppressClick = useRef(false);
    const cancelPress = () => {
        if (press.current) window.clearTimeout(press.current.timer);
        press.current = null;
    };
    const onPointerDown = (e: React.PointerEvent) => {
        if (!hasActions || (e.pointerType === "mouse" && e.button !== 0)) return;
        suppressClick.current = false;
        const timer = window.setTimeout(() => {
            press.current = null;
            suppressClick.current = true;
            navigator.vibrate?.(10);
            actions.open(book);
        }, LONG_PRESS_MS);
        press.current = { timer, x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
    };
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
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onClick={(e) => {
                if (suppressClick.current) {
                    e.preventDefault();
                    suppressClick.current = false;
                }
            }}
            onContextMenu={(e) => {
                if (!hasActions) return;
                e.preventDefault();
                cancelPress();
                actions.open(book);
            }}
            draggable={false}
            className={`group block flex-shrink-0 select-none [-webkit-touch-callout:none] animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards duration-300 motion-reduce:animate-none ${width}`}
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
                    {hasActions && (
                        <button
                            type="button"
                            aria-label="メニュー"
                            data-testid="book-menu"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                actions.open(book);
                            }}
                            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-opacity hover:bg-black/60 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        >
                            <MoreVertical size={16} />
                        </button>
                    )}
                    {saved && (
                        <span
                            title="この端末に保存済み"
                            data-testid="saved-badge"
                            className="absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
                        >
                            <CircleCheck size={14} />
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
