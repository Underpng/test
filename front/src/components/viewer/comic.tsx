import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ViewerOptionSheet, loadOptions, resolveSpread, type Spread, type ViewerOptions } from "./sheet";
import { EndOfBook } from "./end-of-book";
import { sendProgress } from "@/api/progress";
import { sendAccess } from "@/api/access";
import { fetchNeighbors, Neighbors } from "@/api/neighbors";
import { BookEntry } from "@/api/interface";
import { useWindowSize } from "@/hooks/windowSize";
import { continuePosition, viewerUrl } from "@/lib/viewer-url";

export type ComicKind = "cbz" | "cbr";

type ComicViewerProps = {
    kind: ComicKind;
    path: string;    // API path of the book, e.g. "/Series/Vol 01.cbz"
    title?: string;
    initialPage?: number;
};

// Gesture tuning
const TAP_MAX_MOVE = 10;      // px of movement still counted as a tap
const DOUBLE_TAP_MS = 300;
const TURN_FRACTION = 0.2;    // drag this fraction of the width to turn
const TURN_VELOCITY = 0.45;   // or fling faster than this (px/ms)
const TURN_MS = 220;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const CHROME_HIDE_MS = 2500;
const PREFETCH_BEFORE_END = 3;

// ----- spread arithmetic: which pages are shown together -----

// viewStart returns the first page of the view that contains page p.
function viewStart(p: number, spread: Spread): number {
    switch (spread) {
        case "odd":   // (1,2) (3,4) ...
            return p % 2 === 1 ? p : p - 1;
        case "even":  // 1 alone, then (2,3) (4,5) ... like a printed book
            return p === 1 ? 1 : p % 2 === 0 ? p : p - 1;
        default:
            return p;
    }
}

function viewPages(start: number, spread: Spread, total: number): number[] {
    if (spread === "none" || (spread === "even" && start === 1) || start + 1 > total) return [start];
    return [start, start + 1];
}

type Gesture = {
    type: "none" | "drag" | "pan" | "pinch";
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    pinchDist: number;
    pinchScale: number;
    startTx: number;
    startTy: number;
};

const idleGesture: Gesture = { type: "none", startX: 0, startY: 0, startTime: 0, moved: false, pinchDist: 1, pinchScale: 1, startTx: 0, startTy: 0 };

// Page-image viewer for CBZ / CBR with swipe, tap zones, pinch zoom and
// next-volume navigation.
export function ComicViewer({ kind, path, title, initialPage = 1 }: ComicViewerProps) {
    const navigate = useNavigate();
    const { width: winW, height: winH } = useWindowSize();
    const landscape = winW > winH;

    const [numPages, setNumPages] = useState<number | null>(null);
    const [page, setPage] = useState(Math.max(1, initialPage));
    const [sliderValue, setSliderValue] = useState([Math.max(1, initialPage)]);
    const [options, setOptions] = useState<ViewerOptions>(loadOptions);
    const [neighbors, setNeighbors] = useState<Neighbors | null>(null);
    const [edge, setEdge] = useState<"none" | "end" | "start">("none");
    const [chrome, setChrome] = useState(true);
    const [zoomed, setZoomed] = useState(false);

    const direction = options.direction;
    const spread = resolveSpread(options.spread, landscape);
    const dirSign = direction === "ltr" ? 1 : -1;   // +1: next page comes from the right

    const total = numPages ?? Math.max(page, 1);
    const start = viewStart(Math.min(page, total), spread);
    const view = viewPages(start, spread, total);
    const last = view[view.length - 1];
    const atEnd = numPages !== null && last >= numPages;
    const atStart = start <= 1;
    const nextStart = atEnd || numPages === null ? null : last + 1;
    const prevStart = atStart ? null : viewStart(start - 1, spread);
    const nextView = nextStart !== null ? viewPages(nextStart, spread, total) : null;
    const prevView = prevStart !== null ? viewPages(prevStart, spread, total) : null;

    const encodedPath = encodeURIComponent(path);
    const pageUrl = useCallback((n: number) => `/book/${kind}?path=${encodedPath}&page=${n}`, [kind, encodedPath]);
    const displayTitle = title || decodeURIComponent(path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");

    // ----- refs for imperative gesture handling (no re-render per move) -----
    const containerRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const zoomRef = useRef<HTMLDivElement>(null);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<Gesture>({ ...idleGesture });
    const zoom = useRef({ scale: 1, tx: 0, ty: 0 });
    const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
    const animating = useRef(false);
    const progressTimer = useRef<number | null>(null);

    const applyTrack = (dx: number, animate: boolean) => {
        const el = trackRef.current;
        if (!el) return;
        el.style.transition = animate ? `transform ${TURN_MS}ms ease-out` : "none";
        el.style.transform = `translate3d(${dx}px, 0, 0)`;
    };

    const applyZoom = () => {
        const el = zoomRef.current;
        if (!el) return;
        const z = zoom.current;
        el.style.transform = z.scale === 1 ? "" : `translate3d(${z.tx}px, ${z.ty}px, 0) scale(${z.scale})`;
    };

    const clampZoom = () => {
        const z = zoom.current;
        z.scale = Math.min(Math.max(z.scale, 1), MAX_ZOOM);
        const maxX = ((z.scale - 1) * winW) / 2;
        const maxY = ((z.scale - 1) * winH) / 2;
        z.tx = Math.min(Math.max(z.tx, -maxX), maxX);
        z.ty = Math.min(Math.max(z.ty, -maxY), maxY);
        if (z.scale === 1) z.tx = z.ty = 0;
    };

    // Zoom so the point under the finger (viewport coords) stays put.
    const zoomTo = (scale: number, cx: number, cy: number) => {
        const z = zoom.current;
        const s1 = Math.min(Math.max(scale, 1), MAX_ZOOM);
        const px = cx - winW / 2;
        const py = cy - winH / 2;
        z.tx = px - (px - z.tx) * (s1 / z.scale);
        z.ty = py - (py - z.ty) * (s1 / z.scale);
        z.scale = s1;
        clampZoom();
        applyZoom();
        setZoomed(z.scale > 1.01);
    };

    const resetZoom = () => {
        zoom.current = { scale: 1, tx: 0, ty: 0 };
        applyZoom();
        setZoomed(false);
    };

    // ----- data -----
    useEffect(() => {
        let cancelled = false;
        sendAccess(path);
        fetch(`/book/${kind}/pages?path=${encodedPath}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
            .then((data: { pages?: number }) => {
                if (cancelled) return;
                const n = Math.max(1, data.pages ?? 1);
                setNumPages(n);
                if (initialPage < 1 || initialPage > n) {
                    setPage(1);
                    setSliderValue([1]);
                }
            })
            .catch((err) => console.error("Error fetching page count:", err));
        fetchNeighbors(path).then((nb) => {
            if (!cancelled) setNeighbors(nb);
        });
        return () => {
            cancelled = true;
        };
    }, [kind, path, encodedPath, initialPage]);

    // Save the reading position, coalescing rapid page turns.
    const scheduleProgress = useCallback(
        (p: number, done = false) => {
            if (progressTimer.current) window.clearTimeout(progressTimer.current);
            progressTimer.current = window.setTimeout(() => {
                progressTimer.current = null;
                sendProgress(path, p.toString(), done ? 1 : numPages ? p / numPages : 0);
            }, 300);
        },
        [path, numPages],
    );
    useEffect(() => () => {
        if (progressTimer.current) window.clearTimeout(progressTimer.current);
    }, []);

    // ----- navigation -----
    const goTo = useCallback(
        (target: number) => {
            const n = numPages ?? Number.MAX_SAFE_INTEGER;
            const p = Math.min(Math.max(target, 1), n);
            setPage(p);
            setSliderValue([p]);
            scheduleProgress(p);
            resetZoom();
        },
        [numPages, scheduleProgress],
    );

    // After a page change the track is back at rest, before paint.
    useLayoutEffect(() => {
        applyTrack(0, false);
        animating.current = false;
    }, [page, spread]);

    const animateTurn = (toX: number, then: () => void) => {
        animating.current = true;
        applyTrack(toX, true);
        window.setTimeout(then, TURN_MS);
    };

    const openBook = useCallback(
        (book: BookEntry) => {
            setEdge("none");
            navigate(viewerUrl(book, continuePosition(book)));
        },
        [navigate],
    );

    const toShelf = useCallback(() => {
        navigate(neighbors ? `/root${neighbors.folder}` : "/");
    }, [navigate, neighbors]);

    const finish = () => {
        if (numPages) scheduleProgress(numPages, true);
        setEdge("end");
    };

    const next = () => {
        if (animating.current || numPages === null) return;
        if (edge === "start") return setEdge("none");
        if (edge === "end") {
            if (neighbors?.next) openBook(neighbors.next);
            return;
        }
        if (nextStart === null) return finish();
        animateTurn(-dirSign * winW, () => goTo(nextStart));
    };

    const prev = () => {
        if (animating.current) return;
        if (edge === "end") return setEdge("none");
        if (edge === "start") {
            if (neighbors?.prev) openBook(neighbors.prev);
            return;
        }
        if (prevStart === null) return setEdge("start");
        animateTurn(dirSign * winW, () => goTo(prevStart));
    };

    // Keyboard, with the latest handlers.
    const handlers = useRef({ next, prev });
    handlers.current = { next, prev };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const h = handlers.current;
            switch (e.key) {
                case "ArrowLeft":
                    direction === "ltr" ? h.prev() : h.next();
                    break;
                case "ArrowRight":
                    direction === "ltr" ? h.next() : h.prev();
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
    }, [direction]);

    // Hide the bars shortly after opening.
    useEffect(() => {
        const t = window.setTimeout(() => setChrome(false), CHROME_HIDE_MS);
        return () => window.clearTimeout(t);
    }, []);

    // Keep Safari from zooming the whole page and stop the callout on long press.
    useEffect(() => {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
        const previous = meta?.content ?? "";
        if (meta) meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
        const el = containerRef.current;
        const block = (e: Event) => e.preventDefault();
        const multiTouch = (e: TouchEvent) => {
            if (e.touches.length > 1) e.preventDefault();
        };
        el?.addEventListener("touchmove", multiTouch, { passive: false });
        el?.addEventListener("gesturestart", block);
        el?.addEventListener("gesturechange", block);
        el?.addEventListener("contextmenu", block);
        return () => {
            if (meta) meta.content = previous;
            el?.removeEventListener("touchmove", multiTouch);
            el?.removeEventListener("gesturestart", block);
            el?.removeEventListener("gesturechange", block);
            el?.removeEventListener("contextmenu", block);
        };
    }, []);

    // ----- pointer gestures -----
    const handleTap = (x: number, y: number, now: number) => {
        const z = zoom.current;
        const zone = x < winW * 0.3 ? "left" : x > winW * 0.7 ? "right" : "center";
        const lt = lastTap.current;
        const isDouble = lt !== null && now - lt.time < DOUBLE_TAP_MS && Math.hypot(x - lt.x, y - lt.y) < 30;
        lastTap.current = null;

        if (isDouble) {
            if (z.scale > 1.01) resetZoom();
            else {
                zoomTo(DOUBLE_TAP_ZOOM, x, y);
                setChrome(false);
            }
            return;
        }
        if (z.scale > 1.01 || zone === "center") {
            // Center taps (and any tap while zoomed) toggle the bars; a second
            // quick tap becomes a double tap for zoom.
            lastTap.current = { time: now, x, y };
            setChrome((c) => !c);
            return;
        }
        const forward = (zone === "right") === (direction === "ltr");
        forward ? next() : prev();
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        const z = zoom.current;
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            g.type = "pinch";
            g.pinchDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            g.pinchScale = z.scale;
            g.moved = true;
            applyTrack(0, false);
            return;
        }
        gesture.current = {
            ...idleGesture,
            type: z.scale > 1.01 ? "pan" : "drag",
            startX: e.clientX,
            startY: e.clientY,
            startTime: performance.now(),
            startTx: z.tx,
            startTy: z.ty,
        };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const g = gesture.current;
        const z = zoom.current;

        if (g.type === "pinch") {
            if (pointers.current.size < 2) return;
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            zoomTo(g.pinchScale * (d / g.pinchDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
            return;
        }

        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (!g.moved && Math.hypot(dx, dy) > TAP_MAX_MOVE) g.moved = true;
        if (!g.moved) return;

        if (g.type === "pan") {
            z.tx = g.startTx + dx;
            z.ty = g.startTy + dy;
            clampZoom();
            applyZoom();
            return;
        }
        if (g.type === "drag" && !animating.current) {
            const forward = dirSign === 1 ? dx < 0 : dx > 0;
            const blocked = (forward && nextStart === null) || (!forward && prevStart === null);
            applyTrack(blocked ? dx * 0.25 : dx, false);
        }
    };

    const endPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.delete(e.pointerId);
        const g = gesture.current;
        const now = performance.now();

        if (g.type === "pinch") {
            if (pointers.current.size === 0) {
                gesture.current = { ...idleGesture };
                setZoomed(zoom.current.scale > 1.01);
            }
            return;
        }
        if (g.type === "none") return;
        gesture.current = { ...idleGesture };

        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        const dt = Math.max(1, now - g.startTime);

        if (cancelled) {
            applyTrack(0, true);
            return;
        }
        if (!g.moved) {
            handleTap(e.clientX, e.clientY, now);
            return;
        }
        if (g.type !== "drag" || animating.current) return;

        const horizontal = Math.abs(dx) > Math.abs(dy);
        const forward = dirSign === 1 ? dx < 0 : dx > 0;
        const enough = horizontal && (Math.abs(dx) > winW * TURN_FRACTION || Math.abs(dx) / dt > TURN_VELOCITY);
        if (!enough) {
            applyTrack(0, true);
            return;
        }
        if (forward) {
            if (nextStart === null) {
                applyTrack(0, true);
                finish();
            } else animateTurn(-dirSign * winW, () => goTo(nextStart));
        } else {
            if (prevStart === null) {
                applyTrack(0, true);
                setEdge("start");
            } else animateTurn(dirSign * winW, () => goTo(prevStart));
        }
    };

    // ----- rendering -----
    const prefetch: number[] = [];
    if (numPages !== null) {
        for (let p = start - 2; p < start; p++) if (p >= 1) prefetch.push(p);
        for (let p = last + 1; p <= last + 3 && p <= numPages; p++) prefetch.push(p);
    }
    const nextVolume = neighbors?.next ?? null;
    const prefetchNext =
        nextVolume !== null &&
        numPages !== null &&
        numPages - last <= PREFETCH_BEFORE_END &&
        (nextVolume.type === "CBZ" || nextVolume.type === "CBR")
            ? `/book/${nextVolume.type.toLowerCase()}?path=${encodeURIComponent(nextVolume.path)}&page=1`
            : null;

    const slot = (pages: number[] | null, offset: number, role: "prev" | "cur" | "next") =>
        pages && (
            <div key={role} className="absolute inset-0" style={{ transform: `translate3d(${offset * 100}%, 0, 0)` }}>
                <div ref={role === "cur" ? zoomRef : undefined} className="flex h-full w-full items-center justify-center">
                    {(direction === "rtl" ? [...pages].reverse() : pages).map((p) => (
                        <img
                            key={p}
                            src={pageUrl(p)}
                            alt=""
                            draggable={false}
                            className="select-none"
                            style={{
                                maxHeight: "100%",
                                maxWidth: pages.length === 2 ? "50%" : "100%",
                                width: "auto",
                                height: "auto",
                                objectFit: "contain",
                                WebkitTouchCallout: "none",
                            }}
                        />
                    ))}
                </div>
            </div>
        );

    const stop = (e: React.PointerEvent) => e.stopPropagation();
    const barClass = (visible: boolean) =>
        `absolute inset-x-0 z-30 text-white transition-[opacity,visibility] duration-200 ${visible ? "visible opacity-100" : "invisible pointer-events-none opacity-0"}`;

    return (
        <div
            ref={containerRef}
            className="relative h-screen w-screen select-none overflow-hidden bg-black"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endPointer(e, false)}
            onPointerCancel={(e) => endPointer(e, true)}
            data-zoomed={zoomed ? "true" : undefined}
        >
            <div ref={trackRef} className="absolute inset-0 will-change-transform">
                {slot(prevView, -dirSign, "prev")}
                {slot(view, 0, "cur")}
                {slot(nextView, dirSign, "next")}
            </div>

            <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden>
                {prefetch.map((p) => (
                    <img key={p} src={pageUrl(p)} alt="" />
                ))}
                {prefetchNext && <img src={prefetchNext} alt="" />}
            </div>

            {/* top bar */}
            <div
                className={`${barClass(chrome)} top-0 flex items-center gap-1 bg-black/70 px-1`}
                style={{ paddingTop: "env(safe-area-inset-top)" }}
                onPointerDown={stop}
            >
                <button type="button" aria-label="本棚へ戻る" onClick={toShelf} className="p-3">
                    <ArrowLeft />
                </button>
                <div className="min-w-0 flex-1 truncate text-sm">{displayTitle}</div>
                <div data-testid="page-indicator" className="px-2 text-xs tabular-nums text-neutral-300">
                    {view.length === 2 ? `${start}-${last}` : start} / {numPages ?? "…"}
                </div>
                <Sheet>
                    <SheetTrigger asChild>
                        <button type="button" aria-label="表示設定" className="p-3">
                            <Settings2 />
                        </button>
                    </SheetTrigger>
                    <ViewerOptionSheet onOptionChanged={setOptions} />
                </Sheet>
            </div>

            {/* bottom bar */}
            <div
                className={`${barClass(chrome)} bottom-0 bg-black/70 px-4 pt-3`}
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
                onPointerDown={stop}
            >
                <Slider
                    value={sliderValue}
                    min={1}
                    max={numPages ?? 1}
                    step={1}
                    dir={direction}
                    onValueChange={(v) => setSliderValue(v)}
                    onValueCommit={(v) => v.length > 0 && goTo(viewStart(v[0], spread))}
                    aria-label="ページ"
                />
                {neighbors && neighbors.total > 1 && (
                    <p className="mt-2 text-center text-xs text-neutral-400">
                        {neighbors.index} / {neighbors.total} 巻
                    </p>
                )}
            </div>

            {edge !== "none" && (
                <EndOfBook
                    mode={edge}
                    neighbor={edge === "end" ? neighbors?.next ?? null : neighbors?.prev ?? null}
                    index={neighbors?.index ?? 0}
                    total={neighbors?.total ?? 0}
                    onContinue={() => {
                        const target = edge === "end" ? neighbors?.next : neighbors?.prev;
                        if (target) openBook(target);
                    }}
                    onClose={() => setEdge("none")}
                    onShelf={toShelf}
                />
            )}
        </div>
    );
}
