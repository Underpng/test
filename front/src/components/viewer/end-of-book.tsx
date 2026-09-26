import { Loader2, RefreshCw } from "lucide-react";
import { BookEntry } from "@/api/interface";
import { NeighborState } from "@/api/neighbors";
import { Button } from "@/components/ui/button";
import { illustrations } from "@/lib/illustrations";

type EndOfBookProps = {
    mode: "end" | "start";
    state: NeighborState;
    onOpen: (book: BookEntry) => void;
    onRetry: () => void;
    onClose: () => void;
    onShelf: () => void;
};

function NeighborCard({ book, label, action, onOpen }: { book: BookEntry; label: string; action: string; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="mt-4 flex w-full items-center gap-4 rounded-xl bg-neutral-800 p-3 text-left transition hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/40"
            autoFocus
        >
            {book.cover ? (
                <img src={`/cover${book.cover}`} alt="" className="h-28 w-20 flex-shrink-0 rounded object-cover" />
            ) : (
                <div className="h-28 w-20 flex-shrink-0 rounded bg-neutral-700" />
            )}
            <div className="min-w-0">
                <p className="text-xs text-neutral-400">{label}</p>
                <p className="mt-1 line-clamp-3 font-medium leading-snug">{book.title}</p>
                <p className="mt-2 text-sm text-sky-300">{action}</p>
            </div>
        </button>
    );
}

function Note({ children }: { children: React.ReactNode }) {
    return <div className="mt-4 rounded-xl bg-neutral-800 p-4 text-sm">{children}</div>;
}

// Kindle-style card shown when the reader runs past the last (or first)
// page: offers the next (or previous) volume of the same folder.
export function EndOfBook({ mode, state, onOpen, onRetry, onClose, onShelf }: EndOfBookProps) {
    const isEnd = mode === "end";
    const data = state.status === "ready" ? state.data : null;
    const series = data ? data.series : true;

    let heading = isEnd ? "この巻を読み終えました" : "この巻の最初のページです";
    if (data && !series) heading = isEnd ? "この本を読み終えました" : "この本の最初のページです";

    let body: React.ReactNode;
    if (state.status === "loading") {
        body = (
            <Note>
                <p className="flex items-center gap-2 text-neutral-300" data-testid="neighbors-loading">
                    <Loader2 size={16} className="animate-spin" />
                    {isEnd ? "次の巻を確認中…" : "前の巻を確認中…"}
                </p>
            </Note>
        );
    } else if (state.status === "error") {
        body = (
            <Note>
                <p>{isEnd ? "次の巻を確認できませんでした。" : "前の巻を確認できませんでした。"}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black"
                >
                    <RefreshCw size={14} />
                    再試行
                </button>
            </Note>
        );
    } else if (!series) {
        body = <Note>{isEnd ? "最後のページまで読みました。お疲れ様でした！" : "ここがこの本の最初のページです。"}</Note>;
    } else if (isEnd && data!.next) {
        const next = data!.next;
        body = <NeighborCard book={next} label="次の巻" action="続けて読む →" onOpen={() => onOpen(next)} />;
    } else if (!isEnd && data!.prev) {
        const prev = data!.prev;
        body = <NeighborCard book={prev} label="前の巻" action="← 前の巻を読む" onOpen={() => onOpen(prev)} />;
    } else if (isEnd) {
        body = (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-neutral-800 p-4 text-center">
                <img src={illustrations.cheer} alt="" className="w-32 rounded-2xl [image-rendering:pixelated]" />
                <p className="font-medium">シリーズ完読！</p>
                <p className="text-sm text-neutral-400">お疲れ様でした！楽しかったですか？</p>
            </div>
        );
    } else {
        body = <Note>このフォルダの最初の巻です。</Note>;
    }

    return (
        <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
            onClick={onClose}
            // Keep the viewer's swipe / tap handling (and its pointer capture)
            // away from the card so its buttons receive their clicks.
            onPointerDown={(e) => e.stopPropagation()}
            data-testid="end-of-book"
        >
            <div
                className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-sm text-neutral-400">
                    {heading}
                    {data && series && data.total > 0 && (
                        <span className="ml-2">
                            {data.index} / {data.total}
                        </span>
                    )}
                </p>
                {body}
                <div className="mt-4 flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={onShelf}>
                        本棚へ
                    </Button>
                    <Button variant="ghost" className="flex-1 text-white hover:bg-neutral-800 hover:text-white" onClick={onClose}>
                        閉じる
                    </Button>
                </div>
            </div>
        </div>
    );
}
