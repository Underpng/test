import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

// How many pages around the current one keep a real image. Everything else
// is a placeholder of the same height, so a 200-page volume holds only a
// handful of decoded images on the phone at any time.
const WINDOW = 4;
const DEFAULT_RATIO = 1.42; // height / width of a typical manga page
const MAX_WIDTH = 900;

export type VerticalHandle = { jump: (page: number) => void };

type VerticalPagesProps = {
    numPages: number;
    initialPage: number;
    pageUrl: (n: number) => string;
    onPage: (n: number) => void;   // the page at the reading line changed
    onTap: () => void;             // tap without scrolling
    onEnd: () => void;             // scrolled past the last page
    onError: () => void;
};

// Pages stacked top to bottom and read by scrolling (webtoon style).
export const VerticalPages = forwardRef<VerticalHandle, VerticalPagesProps>(function VerticalPages(
    { numPages, initialPage, pageUrl, onPage, onTap, onEnd, onError },
    ref,
) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const heights = useRef<number[]>([]);        // measured heights, by page
    const [ratio, setRatio] = useState(DEFAULT_RATIO);
    const [current, setCurrent] = useState(initialPage);
    const currentRef = useRef(initialPage);
    const [width, setWidth] = useState(() => Math.min(window.innerWidth, MAX_WIDTH));

    useEffect(() => {
        const onResize = () => {
            heights.current = [];
            setWidth(Math.min(window.innerWidth, MAX_WIDTH));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    const placeholder = (n: number) => heights.current[n] ?? Math.round(width * ratio);

    const node = (n: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-vpage="${n}"]`) ?? null;

    const jump = useCallback((page: number) => {
        const el = node(page);
        const box = scrollRef.current;
        if (!el || !box) return;
        box.scrollTop = el.offsetTop;
        currentRef.current = page;
        setCurrent(page);
    }, []);
    useImperativeHandle(ref, () => ({ jump }), [jump]);

    // Start at the saved page.
    useEffect(() => {
        jump(initialPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The page crossing the upper third of the screen is "the" page.
    const onScroll = () => {
        const box = scrollRef.current;
        if (!box) return;
        const line = box.scrollTop + box.clientHeight / 3;
        let n = currentRef.current;
        let el = node(n);
        while (el && el.offsetTop > line && n > 1) el = node(--n);
        while (n < numPages) {
            const nextEl = node(n + 1);
            if (!nextEl || nextEl.offsetTop > line) break;
            n++;
        }
        if (n !== currentRef.current) {
            currentRef.current = n;
            setCurrent(n);
            onPage(n);
        }
    };

    // Reaching the space after the last page ends the volume.
    useEffect(() => {
        const el = endRef.current;
        const box = scrollRef.current;
        if (!el || !box) return;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onEnd(), { root: box, threshold: 0.6 });
        io.observe(el);
        return () => io.disconnect();
    }, [onEnd]);

    // When a page above the reading position gets its real height, keep the
    // text under the reader's eyes where it was (Safari has no scroll anchoring).
    const onLoad = (n: number, img: HTMLImageElement) => {
        const wrap = img.parentElement as HTMLElement;
        const box = scrollRef.current;
        const before = wrap.offsetHeight;
        wrap.style.height = "";
        const after = wrap.offsetHeight;
        heights.current[n] = after;
        if (n === 1 && img.naturalWidth > 0) setRatio(img.naturalHeight / img.naturalWidth);
        if (box && after !== before && wrap.offsetTop < box.scrollTop) box.scrollTop += after - before;
    };

    const tap = useRef<{ x: number; y: number; t: number } | null>(null);

    return (
        <div
            ref={scrollRef}
            data-testid="vertical-pages"
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            style={{ touchAction: "pan-y", paddingTop: "var(--vgap, 0px)" }}
            onScroll={onScroll}
            onPointerDown={(e) => (tap.current = { x: e.clientX, y: e.clientY, t: performance.now() })}
            onPointerUp={(e) => {
                const t = tap.current;
                tap.current = null;
                if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10 && performance.now() - t.t < 500) onTap();
            }}
        >
            <div className="mx-auto" style={{ maxWidth: MAX_WIDTH }}>
                {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => {
                    const near = Math.abs(n - current) <= WINDOW;
                    return (
                        <div key={n} data-vpage={n} style={{ height: near && heights.current[n] ? undefined : placeholder(n) }} className="bg-neutral-900">
                            {near && (
                                <img
                                    src={pageUrl(n)}
                                    alt=""
                                    draggable={false}
                                    decoding="async"
                                    className="block w-full select-none"
                                    style={{ WebkitTouchCallout: "none" }}
                                    onLoad={(e) => onLoad(n, e.currentTarget)}
                                    onError={n === current ? onError : undefined}
                                />
                            )}
                        </div>
                    );
                })}
                <div ref={endRef} className="h-40" aria-hidden />
            </div>
        </div>
    );
});
