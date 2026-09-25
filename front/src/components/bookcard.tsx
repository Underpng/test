import { BookEntry } from "@/api/interface";
import { BookOpen, Folder } from "lucide-react";
import { Link } from "react-router-dom";
import { viewerUrl } from "@/lib/viewer-url";

interface BookCardProps {
    book: BookEntry;
    // "shelf": fixed width for horizontal rows; "grid": fills its cell.
    layout?: "shelf" | "grid";
}

export function BookCard({ book, layout = "shelf" }: BookCardProps) {
    const isFolder = book.type === "Folder";
    const pct = Math.round((book.progress ?? 0) * 100);
    const width = layout === "grid" ? "w-full" : "w-[136px] md:w-[152px]";

    return (
        <Link to={viewerUrl(book)} className={`group block flex-shrink-0 ${width}`} title={book.title}>
            <div className={`relative ${isFolder ? "pt-2" : ""}`}>
                {isFolder && (
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
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            {isFolder ? <Folder size={36} /> : <BookOpen size={36} />}
                        </div>
                    )}
                    {isFolder && (
                        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
                            <Folder size={12} />
                            フォルダ
                        </span>
                    )}
                    {!isFolder && pct > 0 && (
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/25">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                    )}
                </div>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-snug">{book.title}</p>
            {!isFolder && pct > 0 && (
                <p className="text-[11px] text-muted-foreground">{pct >= 98 ? "読了" : `${pct}%`}</p>
            )}
        </Link>
    );
}
