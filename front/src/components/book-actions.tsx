import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, CloudDownload, Loader2, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { BookEntry } from "@/api/interface";
import { markRead, useOverride, withOverride } from "@/lib/library";
import { canSave, formatBytes, offlineSupported, removeBook, saveBook, useOffline } from "@/lib/offline";

// One shared sheet of actions for whichever book was long-pressed (or
// whose ⋮ button was tapped): read state and saving on this device.

type Ctx = { open: (book: BookEntry) => void };
const BookActionsContext = createContext<Ctx>({ open: () => undefined });

export function useBookActions() {
    return useContext(BookActionsContext);
}

export function BookActionsProvider({ children }: { children: React.ReactNode }) {
    const [book, setBook] = useState<BookEntry | null>(null);
    const [open, setOpen] = useState(false);
    const ctx = useMemo<Ctx>(
        () => ({
            open: (b) => {
                setBook(b);
                setOpen(true);
            },
        }),
        [],
    );
    return (
        <BookActionsContext.Provider value={ctx}>
            {children}
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent data-testid="book-actions">{book && <Actions book={book} onDone={() => setOpen(false)} />}</SheetContent>
            </Sheet>
        </BookActionsContext.Provider>
    );
}

function Row({
    icon,
    label,
    detail,
    onClick,
    disabled,
    testId,
}: {
    icon: React.ReactNode;
    label: string;
    detail?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    testId?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-testid={testId}
            className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-surface-high disabled:pointer-events-none disabled:opacity-60"
        >
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-high text-foreground">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="block font-medium">{label}</span>
                {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
            </span>
        </button>
    );
}

function Actions({ book: base, onDone }: { book: BookEntry; onDone: () => void }) {
    const book = withOverride(base, useOverride(base.path));
    const offline = useOffline();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const series = book.type === "Series";
    const finished = series ? (book.finished ?? 0) >= (book.count ?? 0) && (book.count ?? 0) > 0 : book.progress >= 0.98;
    const started = series ? (book.finished ?? 0) > 0 : book.progress > 0;

    const mark = useCallback(
        async (read: boolean) => {
            setBusy(true);
            setFailed(false);
            const ok = await markRead(book, read);
            setBusy(false);
            if (ok) onDone();
            else setFailed(true);
        },
        [book, onDone],
    );

    const saved = offline.saved[book.path];
    const dl = offline.downloads[book.path];

    return (
        <>
            <SheetHeader className="flex-row items-center gap-3 space-y-0 pr-10 text-left">
                {book.cover && <img src={`/cover${book.cover}`} alt="" className="h-16 w-11 flex-shrink-0 rounded-md object-cover shadow-sm" />}
                <div className="min-w-0">
                    <SheetTitle className="line-clamp-2 text-base leading-snug">{book.title}</SheetTitle>
                    <SheetDescription className="text-xs">
                        {series ? `${book.count ?? 0} 巻` : finished ? "読了" : started ? `${Math.round(book.progress * 100)}% まで読んだ` : "未読"}
                    </SheetDescription>
                </div>
            </SheetHeader>

            <div className="mt-4 space-y-1">
                {!finished && (
                    <Row
                        icon={<CheckCircle2 size={20} />}
                        label={series ? "全巻を読了にする" : "読了にする"}
                        onClick={() => mark(true)}
                        disabled={busy}
                        testId="mark-read"
                    />
                )}
                {(started || finished) && (
                    <Row
                        icon={<RotateCcw size={20} />}
                        label={series ? "全巻を未読に戻す" : "未読に戻す"}
                        detail={series ? undefined : "読んだ位置を消して、最初から読めるようにします"}
                        onClick={() => mark(false)}
                        disabled={busy}
                        testId="mark-unread"
                    />
                )}
                {failed && <p className="px-3 text-sm text-destructive">変更できませんでした。通信を確認してください。</p>}

                {canSave(book) && <SaveRow book={book} saved={saved} dl={dl} />}
            </div>
        </>
    );
}

function SaveRow({
    book,
    saved,
    dl,
}: {
    book: BookEntry;
    saved: ReturnType<typeof useOffline>["saved"][string] | undefined;
    dl: ReturnType<typeof useOffline>["downloads"][string] | undefined;
}) {
    if (!offlineSupported()) {
        return (
            <Row
                icon={<CloudDownload size={20} />}
                label="この端末に保存"
                detail={
                    <>
                        https で開いたときに使えます。
                        <Link to="/saved" className="ml-1 underline">
                            詳しく
                        </Link>
                    </>
                }
                disabled
            />
        );
    }
    if (dl && !dl.error) {
        const pct = dl.total ? Math.round((dl.done / dl.total) * 100) : 0;
        return (
            <div className="rounded-2xl px-3 py-3" data-testid="save-progress">
                <div className="flex items-center gap-4">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-high">
                        <Loader2 size={20} className="animate-spin" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">保存しています… {pct}%</span>
                        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-highest">
                            <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                        </span>
                    </span>
                    <button type="button" onClick={() => removeBook(book.path)} className="rounded-full px-3 py-1.5 text-sm hover:bg-surface-high">
                        中止
                    </button>
                </div>
            </div>
        );
    }
    if (dl?.error) {
        return <Row icon={<TriangleAlert size={20} />} label="保存を再開" detail={dl.error} onClick={() => saveBook(saved?.book ?? book)} testId="save-book" />;
    }
    if (saved?.complete) {
        return (
            <Row
                icon={<Trash2 size={20} />}
                label="端末から削除"
                detail={`この端末に保存済み（${formatBytes(saved.bytes)}）`}
                onClick={() => removeBook(book.path)}
                testId="remove-book"
            />
        );
    }
    return (
        <Row
            icon={<CloudDownload size={20} />}
            label={saved ? "保存を再開" : "この端末に保存"}
            detail={saved ? "途中まで保存されています" : "通信なしでも読めるようになります"}
            onClick={() => saveBook(book)}
            testId="save-book"
        />
    );
}
