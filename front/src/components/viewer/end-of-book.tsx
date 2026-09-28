import { ArrowLeft, ArrowRight, BookCheck, Loader2, RefreshCw } from "lucide-react";
import { BookEntry } from "@/api/interface";
import { NeighborState } from "@/api/neighbors";
import { illustrations } from "@/lib/illustrations";
import { shortTitle } from "@/lib/title";

type EndOfBookProps = {
    mode: "end" | "start";
    state: NeighborState;
    // backwards: the previous volume, to be opened at its last page.
    onOpen: (book: BookEntry, backwards: boolean) => void;
    onRetry: () => void;
    onClose: () => void;
    onShelf: () => void;
};

// The next (or previous) volume: its cover large, the title, one button.
function Neighbor({ book, backwards, onOpen }: { book: BookEntry; backwards: boolean; onOpen: () => void }) {
    return (
        <>
            <button
                type="button"
                onClick={onOpen}
                tabIndex={-1}
                aria-hidden
                className="group mt-7 block w-36 focus:outline-none sm:w-40"
            >
                <div className="aspect-[2/3] overflow-hidden rounded-xl bg-white/5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/10 transition duration-300 group-hover:-translate-y-1 group-active:scale-[0.98]">
                    {book.cover && <img src={`/cover${book.cover}`} alt="" className="h-full w-full object-cover" />}
                </div>
            </button>
            <p className="mt-6 text-xs font-medium tracking-wider text-white/50">{backwards ? "前の巻" : "次の巻"}</p>
            <p className="mt-1.5 line-clamp-2 text-xl font-semibold leading-snug" title={book.title}>
                {shortTitle(book.title)}
            </p>
            <button
                type="button"
                onClick={onOpen}
                autoFocus
                className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-black transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98]"
            >
                {backwards && <ArrowLeft size={18} />}
                {backwards ? "前の巻を読む" : "続けて読む"}
                {!backwards && <ArrowRight size={18} />}
            </button>
        </>
    );
}

function Message({ icon, title, detail }: { icon?: React.ReactNode; title: string; detail?: string }) {
    return (
        <div className="mt-8 flex flex-col items-center">
            {icon}
            <p className="mt-4 text-lg font-semibold">{title}</p>
            {detail && <p className="mt-1.5 text-sm text-white/55">{detail}</p>}
        </div>
    );
}

// Kindle-style screen shown when the reader runs past the last (or first)
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
            <p className="mt-10 flex items-center gap-2 text-sm text-white/60" data-testid="neighbors-loading">
                <Loader2 size={16} className="animate-spin" />
                {isEnd ? "次の巻を確認中…" : "前の巻を確認中…"}
            </p>
        );
    } else if (state.status === "error") {
        body = (
            <div className="mt-8 flex flex-col items-center gap-4">
                <p className="text-sm text-white/70">{isEnd ? "次の巻を確認できませんでした。" : "前の巻を確認できませんでした。"}</p>
                <button
                    type="button"
                    onClick={onRetry}
                    className="flex h-10 items-center gap-1.5 rounded-full border border-white/25 px-5 text-sm font-medium transition hover:bg-white/10"
                >
                    <RefreshCw size={14} />
                    再試行
                </button>
            </div>
        );
    } else if (!series) {
        body = isEnd ? (
            <Message icon={<BookCheck size={40} strokeWidth={1.5} className="text-white/80" />} title="最後まで読みました" detail="お疲れ様でした！" />
        ) : (
            <Message title="ここがこの本の最初のページです" />
        );
    } else if (isEnd && data!.next) {
        const next = data!.next;
        body = <Neighbor book={next} backwards={false} onOpen={() => onOpen(next, false)} />;
    } else if (!isEnd && data!.prev) {
        const prev = data!.prev;
        body = <Neighbor book={prev} backwards onOpen={() => onOpen(prev, true)} />;
    } else if (isEnd) {
        body = (
            <Message
                icon={<img src={illustrations.cheer} alt="" className="w-32 rounded-3xl [image-rendering:pixelated]" />}
                title="シリーズ完読！"
                detail="お疲れ様でした！楽しかったですか？"
            />
        );
    } else {
        body = <Message title="このシリーズの最初の巻です" />;
    }

    const showCount = data && series && data.total > 1;

    return (
        <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 px-8 backdrop-blur-md animate-in fade-in duration-200 motion-reduce:animate-none"
            onClick={onClose}
            // Keep the viewer's swipe / tap handling (and its pointer capture)
            // away from the card so its buttons receive their clicks.
            onPointerDown={(e) => e.stopPropagation()}
            data-testid="end-of-book"
        >
            <div
                className="flex w-full max-w-[18rem] flex-col items-center text-center text-white animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 motion-reduce:animate-none"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-sm text-white/70">{heading}</p>
                {showCount && (
                    <div className="mt-3 flex items-center gap-3" aria-label={`${data!.index} / ${data!.total} 巻`}>
                        <div className="h-[3px] w-24 overflow-hidden rounded-full bg-white/15">
                            <div className="h-full rounded-full bg-white/80" style={{ width: `${(data!.index / data!.total) * 100}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-white/50">
                            {data!.index} / {data!.total}
                        </span>
                    </div>
                )}
                {body}
                <div className="mt-6 flex items-center gap-8 text-sm text-white/55">
                    <button type="button" onClick={onShelf} className="py-2 transition hover:text-white">
                        本棚へ
                    </button>
                    <button type="button" onClick={onClose} className="py-2 transition hover:text-white">
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}
