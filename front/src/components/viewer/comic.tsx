import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { ViewerLayout } from "./layout";
import { ViewerOptions } from "./sheet";
import { EndOfBook } from "./end-of-book";
import { Slider } from "@/components/ui/slider";
import { sendProgress } from "@/api/progress";
import { sendAccess } from "@/api/access";
import { fetchNeighbors, Neighbors } from "@/api/neighbors";
import { BookEntry } from "@/api/interface";
import { useWindowSize } from "@/hooks/windowSize";
import { continuePosition, viewerUrl } from "@/lib/viewer-url";

export type ComicKind = "cbz" | "cbr";

type ComicViewerProps = {
    kind: ComicKind;
    path: string;   // API path of the book, e.g. "/Series/Vol 01.cbz"
    initialPage?: number;
};

type Direction = "ltr" | "rtl";
type Spread = "none" | "odd" | "even";

const PREFETCH_BEFORE_END = 3;

// Shared page-image viewer for CBZ and CBR archives.
export function ComicViewer({ kind, path, initialPage = 1 }: ComicViewerProps) {
    const navigate = useNavigate();

    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
    const [sliderValue, setSliderValue] = useState([Math.max(1, initialPage)]);
    const [direction, setDirection] = useState<Direction>("ltr");
    const [spread, setSpread] = useState<Spread>("none");
    const [scale, setScale] = useState(0.5);
    const [neighbors, setNeighbors] = useState<Neighbors | null>(null);
    const [edge, setEdge] = useState<"none" | "end" | "start">("none");

    const imgRef = useRef<HTMLImageElement>(null);
    const encodedPath = encodeURIComponent(path);
    const pageUrl = useCallback(
        (n: number) => `/book/${kind}?path=${encodedPath}&page=${n}`,
        [kind, encodedPath],
    );

    // Saved reader options
    useEffect(() => {
        const saved = localStorage.getItem("viewerOptions");
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved) as ViewerOptions;
            setDirection(parsed.direction);
            setSpread(parsed.spread);
        } catch {
            console.warn("Failed to parse viewerOptions from localStorage");
        }
    }, []);

    // Page count, access log and neighbours for this book
    useEffect(() => {
        let cancelled = false;
        sendAccess(path);
        fetch(`/book/${kind}/pages?path=${encodedPath}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
            .then((data: { pages?: number }) => {
                if (cancelled) return;
                const total = Math.max(1, data.pages ?? 1);
                setNumPages(total);
                if (initialPage < 1 || initialPage > total) {
                    setPageNumber(1);
                    setSliderValue([1]);
                }
            })
            .catch((err) => console.error("Error fetching page count:", err));
        fetchNeighbors(path).then((n) => {
            if (!cancelled) setNeighbors(n);
        });
        return () => {
            cancelled = true;
        };
    }, [kind, path, encodedPath, initialPage]);

    // ----- page arithmetic (spread aware) -----

    const standardisedPage = useMemo(() => {
        switch (spread) {
            case "odd":
                return pageNumber % 2 === 0 ? pageNumber - 1 : pageNumber;
            case "even":
                return pageNumber !== 1 && pageNumber % 2 === 1 ? pageNumber - 1 : pageNumber;
            default:
                return pageNumber;
        }
    }, [pageNumber, spread]);

    const isSpreads = useMemo(() => {
        if (!numPages) return false;
        switch (spread) {
            case "odd":
                return standardisedPage !== numPages;
            case "even":
                return standardisedPage !== 1 && standardisedPage !== numPages;
            default:
                return false;
        }
    }, [standardisedPage, spread, numPages]);

    const lastVisiblePage = isSpreads ? Math.min(standardisedPage + 1, numPages ?? 1) : standardisedPage;
    const atEnd = numPages !== null && lastVisiblePage >= numPages;
    const atStart = standardisedPage <= 1;

    const goTo = useCallback(
        (target: number) => {
            const total = numPages ?? Number.MAX_SAFE_INTEGER;
            const next = Math.min(Math.max(target, 1), total);
            setPageNumber(next);
            setSliderValue([next]);
            sendProgress(path, next.toString(), numPages ? next / numPages : 0);
        },
        [numPages, path],
    );

    const forwardDelta = () => {
        switch (spread) {
            case "odd":
                return pageNumber % 2 === 1 ? 2 : 1;
            case "even":
                return pageNumber % 2 === 0 ? 2 : 1;
            default:
                return 1;
        }
    };

    const backwardDelta = () => {
        switch (spread) {
            case "odd":
                return pageNumber % 2 === 1 ? 2 : 3;
            case "even":
                return pageNumber % 2 === 1 ? 3 : 2;
            default:
                return 1;
        }
    };

    // ----- moving between volumes -----

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

    const toNext = () => {
        if (numPages === null) return;
        if (edge === "start") {
            setEdge("none");
            return;
        }
        if (edge === "end") {
            if (neighbors?.next) openBook(neighbors.next);
            return;
        }
        if (atEnd) {
            sendProgress(path, numPages.toString(), 1);
            setEdge("end");
            return;
        }
        goTo(pageNumber + forwardDelta());
    };

    const toPrev = () => {
        if (edge === "end") {
            setEdge("none");
            return;
        }
        if (edge === "start") {
            if (neighbors?.prev) openBook(neighbors.prev);
            return;
        }
        if (atStart) {
            setEdge("start");
            return;
        }
        goTo(pageNumber - backwardDelta());
    };

    // ----- layout -----

    const { width: windowWidth, height: windowHeight } = useWindowSize();
    const windowAspect = windowWidth / windowHeight;

    const fitToWindow = () => {
        const img = imgRef.current;
        if (!img) return;
        const pagesWidth = isSpreads ? img.naturalWidth * 2 : img.naturalWidth;
        const pageAspect = pagesWidth / img.naturalHeight;
        setScale(pageAspect > windowAspect ? windowWidth / pagesWidth : windowHeight / img.naturalHeight);
    };

    const secondPage = Math.min(standardisedPage + 1, numPages ?? 1);
    const total = numPages ?? 1;
    const prefetch = [
        Math.max(standardisedPage - 1, 1),
        Math.max(standardisedPage - 2, 1),
        Math.min(standardisedPage + 1, total),
        Math.min(standardisedPage + 2, total),
        Math.min(standardisedPage + 3, total),
    ];

    // Warm the first page of the next volume shortly before the end.
    const nextVolume = neighbors?.next ?? null;
    const prefetchNext =
        nextVolume !== null &&
        numPages !== null &&
        numPages - lastVisiblePage <= PREFETCH_BEFORE_END &&
        (nextVolume.type === "CBZ" || nextVolume.type === "CBR")
            ? `/book/${nextVolume.type.toLowerCase()}?path=${encodeURIComponent(nextVolume.path)}&page=1`
            : null;

    const pageImg = (n: number, extra?: { ref?: RefObject<HTMLImageElement | null>; onLoad?: () => void }) => (
        <img
            key={`${n}-${pageUrl(n)}`}
            src={pageUrl(n)}
            alt=""
            draggable={false}
            style={{ width: "auto", height: "auto", maxWidth: "none", maxHeight: "none" }}
            ref={extra?.ref}
            onLoad={extra?.onLoad}
        />
    );

    return (
        <ViewerLayout
            onOptionChanged={(opt) => {
                setDirection(opt.direction);
                setSpread(opt.spread);
            }}
            onBack={toShelf}
            onLeft={direction === "ltr" ? toPrev : toNext}
            onRight={direction === "ltr" ? toNext : toPrev}
        >
            <div className="relative h-screen w-full max-w-full overflow-hidden">
                <div style={{ display: "flex", justifyContent: "center", transform: `scale(${scale})`, transformOrigin: "top center" }}>
                    {direction === "rtl" && isSpreads && pageImg(secondPage)}
                    {pageImg(standardisedPage, { ref: imgRef, onLoad: fitToWindow })}
                    {direction === "ltr" && isSpreads && pageImg(secondPage)}

                    <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden>
                        {prefetch.map((n, i) => (
                            <img key={`p${i}-${n}`} src={pageUrl(n)} alt="" />
                        ))}
                        {prefetchNext && <img src={prefetchNext} alt="" />}
                    </div>
                </div>
            </div>

            <div className="absolute bottom-3 left-0 w-full" style={{ opacity: 0.25 }}>
                <Slider
                    value={sliderValue}
                    min={1}
                    max={numPages ?? 1}
                    step={1}
                    onValueChange={(values) => setSliderValue(values)}
                    onValueCommit={(values) => {
                        if (values.length > 0) goTo(values[0]);
                    }}
                    dir={direction === "rtl" ? "rtl" : "ltr"}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                            e.preventDefault();
                        }
                    }}
                />
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
        </ViewerLayout>
    );
}
