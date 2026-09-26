import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ePub, { type Book, type Rendition } from "epubjs";
import { ArrowLeft, Moon, Settings2, Sun } from "lucide-react";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { ViewerOptionSheet, loadOptions, type ViewerOptions } from "./sheet";
import { EndOfBook } from "./end-of-book";
import { sendAccess } from "@/api/access";
import { sendProgress } from "@/api/progress";
import { shelfUrl, useNeighbors } from "@/api/neighbors";
import { ImmersiveButton, PageSlider, VolumeChip, useImmersive } from "./controls";
import { BookEntry } from "@/api/interface";
import { continuePosition, viewerUrl } from "@/lib/viewer-url";
import { illustrations } from "@/lib/illustrations";

type EpubViewerProps = {
    path: string;      // API path, e.g. "/Novels/Book 1.epub"
    title?: string;
    initialCfi?: string;
};

type PageTheme = "dark" | "light";

const TAP_MAX_MOVE = 10;
const SWIPE_MIN = 50;
const CHROME_HIDE_MS = 2500;

// epubjs paints the book into an iframe. Safari mishandles touch events
// that reach that iframe (the upstream "viewer stops responding" bug), so
// a transparent layer above it owns every tap and swipe instead.
export function EpubViewer({ path, title, initialCfi }: EpubViewerProps) {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const progressTimer = useRef<number | null>(null);

    const [options, setOptions] = useState<ViewerOptions>(loadOptions);
    const [pageTheme, setPageTheme] = useState<PageTheme>(() => (localStorage.getItem("epubTheme") === "light" ? "light" : "dark"));
    const nb = useNeighbors(path);
    const neighbors = nb.data;
    const [edge, setEdge] = useState<"none" | "end" | "start">("none");
    const { immersive, toggleImmersive, exitBrowserFullscreen } = useImmersive();
    const [chrome, setChrome] = useState(() => !immersive);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rtl, setRtl] = useState(false);
    const [percent, setPercent] = useState(0);          // 0..1
    const [sliderValue, setSliderValue] = useState([0]);
    const [hasLocations, setHasLocations] = useState(false);
    const [chapter, setChapter] = useState({ index: 0, total: 0 });
    const [atEdge, setAtEdge] = useState({ start: false, end: false });

    const displayTitle = title || decodeURIComponent(path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    const fileUrl = `/book/epub?path=${encodeURIComponent(path)}`;

    // ----- book lifecycle -----
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let cancelled = false;
        setReady(false);
        setError(null);
        sendAccess(path);

        const book = ePub(fileUrl, { openAs: "epub" });
        bookRef.current = book;
        const rendition = book.renderTo(el, {
            width: "100%",
            height: "100%",
            flow: "paginated",
            manager: "default",
            spread: "none",
            allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        rendition.themes.register("dark", { body: { background: "#141414 !important", color: "#e8e6e3 !important" } });
        rendition.themes.register("light", { body: { background: "#fbf7f2 !important", color: "#1f1a17 !important" } });
        rendition.themes.select(pageTheme);
        rendition.themes.fontSize(`${options.fontSize}px`);

        rendition.on("relocated", (loc: { start: { cfi: string; index: number; percentage: number }; atStart: boolean; atEnd: boolean }) => {
            if (cancelled) return;
            const spineLength = spineCount(book);
            setChapter({ index: loc.start.index + 1, total: spineLength });
            setAtEdge({ start: !!loc.atStart, end: !!loc.atEnd });
            let p = 0;
            if (book.locations.length() > 0) {
                p = book.locations.percentageFromCfi(loc.start.cfi) ?? 0;
                setHasLocations(true);
            } else if (spineLength > 0) {
                p = loc.start.index / spineLength;
            }
            setPercent(p);
            setSliderValue([p]);
            scheduleProgress(loc.start.cfi, loc.atEnd ? 1 : p);
        });

        book.ready
            .then(() => rendition.display(initialCfi || undefined))
            .then(() => {
                if (cancelled) return;
                setRtl((book.packaging?.metadata as unknown as { direction?: string } | undefined)?.direction === "rtl");
                setReady(true);
                // Character-based locations give a real percentage; built in
                // the background so opening stays fast.
                return book.locations.generate(1200).then(() => {
                    if (cancelled) return;
                    setHasLocations(true);
                    const cur = rendition.currentLocation() as unknown as { start?: { cfi: string } } | undefined;
                    if (cur?.start?.cfi) {
                        const p = book.locations.percentageFromCfi(cur.start.cfi) ?? 0;
                        setPercent(p);
                        setSliderValue([p]);
                    }
                });
            })
            .catch((e: unknown) => {
                console.error("epub failed", e);
                if (!cancelled) setError("この本を開けません。ファイルが壊れているか、対応していない形式です。");
            });

        return () => {
            cancelled = true;
            if (progressTimer.current) window.clearTimeout(progressTimer.current);
            try {
                rendition.destroy();
                book.destroy();
            } catch {
                // epubjs can throw on double destroy
            }
            renditionRef.current = null;
            bookRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path]);

    useEffect(() => {
        renditionRef.current?.themes.fontSize(`${options.fontSize}px`);
    }, [options.fontSize]);

    useEffect(() => {
        renditionRef.current?.themes.select(pageTheme);
        localStorage.setItem("epubTheme", pageTheme);
    }, [pageTheme]);

    const scheduleProgress = (cfi: string, p: number) => {
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
        progressTimer.current = window.setTimeout(() => sendProgress(path, cfi, p), 400);
    };

    // ----- navigation -----
    const openBook = useCallback(
        (b: BookEntry) => {
            setEdge("none");
            navigate(viewerUrl(b, continuePosition(b)));
        },
        [navigate],
    );
    const toShelf = useCallback(() => {
        exitBrowserFullscreen();
        navigate(shelfUrl(neighbors));
    }, [navigate, neighbors, exitBrowserFullscreen]);

    const next = () => {
        if (edge === "start") return setEdge("none");
        if (edge === "end") return void (neighbors?.next && openBook(neighbors.next));
        if (atEdge.end) return setEdge("end");
        renditionRef.current?.next();
    };
    const prev = () => {
        if (edge === "end") return setEdge("none");
        if (edge === "start") return void (neighbors?.prev && openBook(neighbors.prev));
        if (atEdge.start) {
            if (neighbors && !neighbors.series) return;
            return setEdge("start");
        }
        renditionRef.current?.prev();
    };
    const handlers = useRef({ next, prev });
    handlers.current = { next, prev };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const h = handlers.current;
            switch (e.key) {
                case "ArrowLeft":
                    rtl ? h.next() : h.prev();
                    break;
                case "ArrowRight":
                    rtl ? h.prev() : h.next();
                    break;
                case " ":
                case "PageDown":
                    e.preventDefault();
                    h.next();
                    break;
                case "PageUp":
                    e.preventDefault();
                    h.prev();
                    break;
                case "Escape":
                    setChrome((c) => !c);
                    break;
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [rtl]);

    useEffect(() => {
        const t = window.setTimeout(() => setChrome(false), CHROME_HIDE_MS);
        return () => window.clearTimeout(t);
    }, []);

    const onToggleImmersive = () => {
        setChrome(immersive);
        toggleImmersive();
    };

    // Reader chrome is always dark, like the comic viewer.
    useEffect(() => {
        const root = document.documentElement;
        const wasDark = root.classList.contains("dark");
        root.classList.add("dark");
        return () => {
            if (!wasDark) root.classList.remove("dark");
        };
    }, []);

    // ----- gestures on the overlay -----
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gesture.current;
        if (g && !g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_MAX_MOVE) g.moved = true;
    };
    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        const w = e.currentTarget.clientWidth;
        if (g.moved) {
            if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
                // Swiping left reveals what is on the right.
                const forward = rtl ? dx > 0 : dx < 0;
                forward ? next() : prev();
            }
            return;
        }
        const zone = e.clientX < w * 0.3 ? "left" : e.clientX > w * 0.7 ? "right" : "center";
        if (zone === "center") return setChrome((c) => !c);
        const forward = (zone === "right") !== rtl;
        forward ? next() : prev();
    };

    // Only stop taps that really are on the bar: the settings sheet lives in
    // a portal and needs its outside taps to reach the document.
    const stop = (e: React.PointerEvent) => {
        if (e.currentTarget.contains(e.target as Node)) e.stopPropagation();
    };
    const barClass = (visible: boolean) =>
        `absolute inset-x-0 z-30 text-white transition-[opacity,visibility] duration-200 ${visible ? "visible opacity-100" : "invisible pointer-events-none opacity-0"}`;
    const indicator = hasLocations ? `${Math.round(percent * 100)}%` : chapter.total ? `${chapter.index} / ${chapter.total} 章` : "…";

    return (
        <div className="relative h-screen w-screen select-none overflow-hidden" style={{ background: pageTheme === "dark" ? "#141414" : "#fbf7f2" }}>
            <div ref={containerRef} className="absolute inset-0" />

            {/* gesture layer above the iframe */}
            <div
                className="absolute inset-0 z-10"
                style={{ touchAction: "none" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => (gesture.current = null)}
                data-testid="epub-gesture-layer"
            />

            {!ready && !error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-neutral-400">読み込み中…</div>
            )}
            {error && (
                <div role="alert" className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6 text-center text-white" onPointerDown={stop}>
                    <div className="flex max-w-sm flex-col items-center">
                        <img src={illustrations.sleeping} alt="" className="mb-4 w-32 rounded-3xl [image-rendering:pixelated]" />
                        <p className="font-medium">本を開けません</p>
                        <p className="mt-2 text-sm text-neutral-300">{error}</p>
                        <button type="button" onClick={toShelf} className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black">
                            本棚へ
                        </button>
                    </div>
                </div>
            )}

            <div className={`${barClass(chrome)} top-0 flex items-center gap-1 bg-black/70 px-1`} style={{ paddingTop: "env(safe-area-inset-top)" }} onPointerDown={stop}>
                <button type="button" aria-label="本棚へ戻る" onClick={toShelf} className="p-3">
                    <ArrowLeft />
                </button>
                <div className="min-w-0 flex-1 truncate text-sm">{displayTitle}</div>
                <button
                    type="button"
                    aria-label={pageTheme === "dark" ? "紙面を明るくする" : "紙面を暗くする"}
                    onClick={() => setPageTheme((t) => (t === "dark" ? "light" : "dark"))}
                    className="p-3"
                >
                    {pageTheme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                <Sheet>
                    <SheetTrigger asChild>
                        <button type="button" aria-label="表示設定" className="p-3">
                            <Settings2 />
                        </button>
                    </SheetTrigger>
                    <ViewerOptionSheet onOptionChanged={setOptions} />
                </Sheet>
            </div>

            <div className={`${barClass(chrome)} bottom-0 bg-black/70 px-4 pt-3`} style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }} onPointerDown={stop}>
                <PageSlider
                    value={sliderValue}
                    min={0}
                    max={1}
                    step={0.001}
                    dir={rtl ? "rtl" : "ltr"}
                    disabled={!hasLocations}
                    label="位置"
                    format={(v) => `${Math.round(v * 100)}%`}
                    onValueChange={(v) => setSliderValue(v)}
                    onValueCommit={(v) => {
                        const book = bookRef.current;
                        if (v.length > 0 && book && hasLocations) {
                            renditionRef.current?.display(book.locations.cfiFromPercentage(v[0]));
                        }
                    }}
                />
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div />
                    <div data-testid="page-indicator" className="text-lg font-semibold tabular-nums">{indicator}</div>
                    <div className="flex items-center justify-end gap-2">
                        {neighbors && neighbors.series && neighbors.total > 1 && <VolumeChip index={neighbors.index} total={neighbors.total} />}
                        <ImmersiveButton on={immersive} onToggle={onToggleImmersive} />
                    </div>
                </div>
            </div>

            {edge !== "none" && (
                <EndOfBook
                    mode={edge}
                    state={nb.state}
                    onOpen={openBook}
                    onRetry={nb.retry}
                    onClose={() => setEdge("none")}
                    onShelf={toShelf}
                />
            )}
        </div>
    );
}

function spineCount(book: Book): number {
    const spine = book.spine as unknown as { length?: number; spineItems?: unknown[] };
    return spine.length ?? spine.spineItems?.length ?? 0;
}
