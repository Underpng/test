import { useEffect, useRef, useState } from "react";
import { BookmarkCheck, X } from "lucide-react";
import type { Bookmark } from "@/api/bookmarks";

type PageGridProps = {
    kind: "cbz" | "cbr";
    path: string;
    numPages: number;
    current: number[];            // pages on screen now
    bookmarks: Bookmark[];
    direction: "ltr" | "rtl";
    onPick: (page: number) => void;
    onClose: () => void;
};

// Full-screen grid of small page images for jumping around a volume, with
// a tab for the bookmarked pages. Thumbnails load lazily as they scroll in.
export function PageGrid({ kind, path, numPages, current, bookmarks, direction, onPick, onClose }: PageGridProps) {
    const [tab, setTab] = useState<"all" | "marks">("all");
    const scrollRef = useRef<HTMLDivElement>(null);
    const marked = new Set(bookmarks.map((b) => b.position));
    const pages =
        tab === "all"
            ? Array.from({ length: numPages }, (_, i) => i + 1)
            : bookmarks
                  .map((b) => parseInt(b.position, 10))
                  .filter((n) => n >= 1 && n <= numPages)
                  .sort((a, b) => a - b);

    // Open with the current page in view.
    useEffect(() => {
        if (tab !== "all") return;
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${current[0]}"]`);
        el?.scrollIntoView({ block: "center" });
    }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const thumb = (n: number) => `/book/${kind}/thumb?path=${encodeURIComponent(path)}&page=${n}`;
    const tabClass = (on: boolean) =>
        `rounded-full px-4 py-1.5 text-sm transition-colors ${on ? "bg-primary-container text-primary-container-foreground font-medium" : "text-neutral-300 hover:bg-white/10"}`;

    return (
        <div
            role="dialog"
            aria-label="ページ一覧"
            data-testid="page-grid"
            className="absolute inset-0 z-40 flex flex-col bg-neutral-950 text-white animate-in fade-in duration-150"
            onPointerDown={(e) => e.stopPropagation()}
            style={{ touchAction: "pan-y" }}
        >
            <div className="flex items-center gap-2 px-3 pb-2" style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}>
                <div className="flex flex-1 gap-1">
                    <button type="button" className={tabClass(tab === "all")} onClick={() => setTab("all")}>
                        すべて
                    </button>
                    <button type="button" className={tabClass(tab === "marks")} onClick={() => setTab("marks")} data-testid="grid-tab-marks">
                        しおり {bookmarks.length > 0 && <span className="tabular-nums">{bookmarks.length}</span>}
                    </button>
                </div>
                <button type="button" aria-label="閉じる" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
                    <X size={20} />
                </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 16px)" }}>
                {pages.length === 0 ? (
                    <p className="py-16 text-center text-sm text-neutral-400">
                        しおりはまだありません。
                        <br />
                        読んでいるページで上のしおりボタンを押すと、ここに並びます。
                    </p>
                ) : (
                    <div dir={direction} className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                        {pages.map((n) => {
                            const here = current.includes(n);
                            return (
                                <button
                                    key={n}
                                    type="button"
                                    data-page={n}
                                    onClick={() => onPick(n)}
                                    className="group flex flex-col items-center gap-1"
                                    aria-label={`${n} ページへ`}
                                    aria-current={here ? "page" : undefined}
                                >
                                    <span
                                        className={`relative block aspect-[2/3] w-full overflow-hidden rounded-lg bg-neutral-800 ring-2 transition ${here ? "ring-primary" : "ring-transparent group-hover:ring-white/40"}`}
                                    >
                                        <img src={thumb(n)} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-contain" />
                                        {marked.has(String(n)) && (
                                            <BookmarkCheck size={18} className="absolute right-1 top-1 fill-primary text-primary drop-shadow" aria-label="しおり" />
                                        )}
                                    </span>
                                    <span className={`text-xs tabular-nums ${here ? "font-semibold text-primary" : "text-neutral-400"}`}>{n}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
