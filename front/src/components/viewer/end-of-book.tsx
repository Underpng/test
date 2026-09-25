import { BookEntry } from "@/api/interface";
import { Button } from "@/components/ui/button";
import { illustrations } from "@/lib/illustrations";

type EndOfBookProps = {
    mode: "end" | "start";
    neighbor: BookEntry | null;
    index: number;
    total: number;
    onContinue: () => void;
    onClose: () => void;
    onShelf: () => void;
};

// Kindle-style card shown when the reader runs past the last (or first)
// page: offers the next (or previous) volume of the same folder.
export function EndOfBook({ mode, neighbor, index, total, onContinue, onClose, onShelf }: EndOfBookProps) {
    const isEnd = mode === "end";
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
                    {isEnd ? "この巻を読み終えました" : "この巻の最初のページです"}
                    {total > 0 && <span className="ml-2">{index} / {total}</span>}
                </p>

                {neighbor ? (
                    <button
                        type="button"
                        onClick={onContinue}
                        className="mt-4 flex w-full items-center gap-4 rounded-xl bg-neutral-800 p-3 text-left transition hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/40"
                        autoFocus
                    >
                        {neighbor.cover ? (
                            <img
                                src={`/cover${neighbor.cover}`}
                                alt=""
                                className="h-28 w-20 flex-shrink-0 rounded object-cover"
                            />
                        ) : (
                            <div className="h-28 w-20 flex-shrink-0 rounded bg-neutral-700" />
                        )}
                        <div className="min-w-0">
                            <p className="text-xs text-neutral-400">{isEnd ? "次の巻" : "前の巻"}</p>
                            <p className="mt-1 line-clamp-3 font-medium leading-snug">{neighbor.title}</p>
                            <p className="mt-2 text-sm text-sky-300">{isEnd ? "続けて読む →" : "← 前の巻を読む"}</p>
                        </div>
                    </button>
                ) : isEnd ? (
                    <div className="mt-4 flex flex-col items-center gap-3 rounded-xl bg-neutral-800 p-4 text-center">
                        <img src={illustrations.cheer} alt="" className="w-40 rounded-2xl" />
                        <p className="font-medium">シリーズ読了！</p>
                        <p className="text-sm text-neutral-400">このフォルダの最後の巻でした。</p>
                    </div>
                ) : (
                    <p className="mt-4 rounded-xl bg-neutral-800 p-4 text-sm">このフォルダの最初の巻です。</p>
                )}

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
