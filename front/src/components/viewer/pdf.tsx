import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPluginRegistration } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { DocumentState } from '@embedpdf/core';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { RenderLayer, RenderPluginPackage, useRenderCapability } from '@embedpdf/plugin-render/react';
import { ViewerLayout } from './layout';
import { ViewerOptions } from './sheet';
import { Slider } from "@/components/ui/slider";
import { sendProgress } from '@/api/progress';
import { sendAccess } from '@/api/access';
import { useWindowSize } from '@/hooks/windowSize';

interface PDFViewerProps {
    fileUrl: string;
    initialPage?: number;
}

const big_number = 99999
const dpr_ratio = 6

function PDFViewerInner({ documentId, encodedFilePath, initialPage, documentState }: {
    documentId: string;
    encodedFilePath: string;
    initialPage: number;
    documentState: DocumentState;
}) {
    const [pageNumber, setPageNumber] = useState(initialPage);
    const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
    const [spread, setSpread] = useState<"none" | "odd" | "even">("none");
    const [scale, setScale] = useState(0);
    const [sliderValue, setSliderValue] = useState([initialPage]);

    // Cache: pageIndex -> ObjectURL of rendered image
    const [pageCache, setPageCache] = useState<Map<number, string>>(new Map());
    // Track in-progress renders to prevent duplicate requests
    const renderingRef = useRef<Set<number>>(new Set());

    const { width: windowWidth, height: windowHeight } = useWindowSize();
    const windowAspect = windowWidth / windowHeight;
    const { provides: renderPlugin } = useRenderCapability();

    const numPages = documentState?.document?.pageCount ?? null;
    const pages = documentState?.document?.pages ?? [];

    useEffect(() => {
        const saved = localStorage.getItem("viewerOptions");
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as ViewerOptions;
                setDirection(parsed.direction);
                setSpread(parsed.spread);
            } catch (e) {
                console.warn("Failed to parse viewerOptions from localStorage");
            }
        }
    }, []);

    useEffect(() => {
        sendAccess(encodedFilePath);
    }, []);

    const standerisedPageNumber = useMemo(() => {
        switch (spread) {
            case "odd":
                return pageNumber % 2 === 0 ? pageNumber - 1 : pageNumber;
            case "even":
                return (pageNumber !== 1 && pageNumber % 2 === 1) ? pageNumber - 1 : pageNumber;
            default:
                return pageNumber;
        }
    }, [pageNumber, spread]);

    const isSpreads = useMemo(() => {
        if (!numPages) return false;
        switch (spread) {
            case "odd":
                return standerisedPageNumber !== numPages;
            case "even":
                return standerisedPageNumber !== 1 && standerisedPageNumber !== numPages;
            default:
                return false;
        }
    }, [standerisedPageNumber, spread, numPages]);

    const currentPageIndex = standerisedPageNumber - 1;
    const nextPageIndex = isSpreads ? Math.min(currentPageIndex + 1, (numPages ?? 1) - 1) : null;

    const currentPageSize = pages[currentPageIndex]?.size;
    const nextPageSize = nextPageIndex !== null ? (pages[nextPageIndex]?.size ?? null) : null;

    // Render a page and store the result as an ObjectURL in the cache
    const renderToCache = useCallback((pageIndex: number) => {
        if (!renderPlugin || !numPages) return;
        if (pageIndex < 0 || pageIndex >= numPages) return;
        if (renderingRef.current.has(pageIndex)) return;
        setPageCache(prev => {
            if (prev.has(pageIndex)) return prev;
            renderingRef.current.add(pageIndex);
            const renderer = renderPlugin.forDocument(documentId);
            const task = renderer?.renderPage({
                pageIndex,
                options: { scaleFactor: dpr_ratio, imageType: 'image/webp' },
            });
            task?.wait((blob: Blob) => {
                const url = URL.createObjectURL(blob);
                renderingRef.current.delete(pageIndex);
                setPageCache(p => {
                    const next = new Map(p);
                    // Revoke the previous ObjectURL to avoid memory leaks
                    if (next.has(pageIndex)) URL.revokeObjectURL(next.get(pageIndex)!);
                    next.set(pageIndex, url);
                    return next;
                });
            });
            return prev;
        });
    }, [renderPlugin, documentId, numPages]);

    // Render visible pages first, then prefetch surrounding pages (prev 2, next 3)
    useEffect(() => {
        if (!renderPlugin || !numPages) return;
        const visibleIndices = [currentPageIndex, ...(nextPageIndex !== null ? [nextPageIndex] : [])];
        const preIndices: number[] = [];
        for (let i = 1; i <= 2; i++) {
            const prev = currentPageIndex - i;
            if (prev >= 0) preIndices.push(prev);
        }
        for (let i = 1; i <= 3; i++) {
            const next = (nextPageIndex ?? currentPageIndex) + i;
            if (next < numPages) preIndices.push(next);
        }
        [...visibleIndices, ...preIndices].forEach(renderToCache);
    }, [currentPageIndex, nextPageIndex, numPages, renderPlugin, renderToCache]);

    if (!currentPageSize || currentPageSize.width === 0 || currentPageSize.height === 0) {
        return (
            <div className="w-full h-screen flex items-center justify-center">
                <p>Loading PDF...</p>
            </div>
        );
    }

    const scaledCurrentWidth = currentPageSize.width * scale;
    const scaledCurrentHeight = currentPageSize.height * scale;
    const scaledNextWidth = nextPageSize ? nextPageSize.width * scale : 0;
    const scaledNextHeight = nextPageSize ? nextPageSize.height * scale : 0;

    useEffect(() => {
        if (currentPageSize.width > 0 && currentPageSize.height > 0) {
            const pagesWidth = isSpreads && nextPageSize
                ? currentPageSize.width + nextPageSize.width
                : currentPageSize.width;
            const pagesHeight = isSpreads && nextPageSize
                ? Math.max(currentPageSize.height, nextPageSize.height)
                : currentPageSize.height;
            const pageAspect = pagesWidth / pagesHeight;
            if (pageAspect > windowAspect) {
                setScale(windowWidth / pagesWidth);
            } else {
                setScale(windowHeight / pagesHeight);
            }
        }
    }, [standerisedPageNumber, spread, numPages, windowWidth, windowHeight, currentPageSize, nextPageSize]);

    const toPrev = useCallback(() => {
        var delta = 1;
        switch (spread) {
            case "odd":
                if (pageNumber % 2 === 1) {
                    delta = 2;
                } else {
                    delta = 3;
                }
                break;
            case "even":
                if (pageNumber % 2 === 1) {
                    delta = 3;
                } else {
                    delta = 2;
                }
                break;
        }
        const newPage = Math.max(pageNumber - delta, 1);
        setPageNumber(newPage);
        setSliderValue([newPage]);
        sendProgress(encodedFilePath ?? "", newPage.toString(), newPage / (numPages ?? big_number));
    }, [pageNumber, spread, numPages, encodedFilePath]);

    const toNext = useCallback(() => {
        if (numPages !== null) {
            var delta = 1;
            switch (spread) {
                case "odd":
                    if (pageNumber % 2 === 1) {
                        delta = 2;
                    }
                    break;
                case "even":
                    if (pageNumber % 2 === 0) {
                        delta = 2;
                    }
                    break;
            }
            const newPage = Math.min(pageNumber + delta, numPages);
            setPageNumber(newPage);
            setSliderValue([newPage]);
            sendProgress(encodedFilePath ?? "", newPage.toString(), newPage / (numPages ?? big_number));
        }
    }, [pageNumber, spread, numPages, encodedFilePath]);

    // Show cached <img> if available, otherwise fall back to RenderLayer
    const PageRenderer = ({ pageIndex, width, height }: { pageIndex: number; width: number; height: number }) => {
        const cachedUrl = pageCache.get(pageIndex);
        return (
            <div style={{ width: `${width}px`, height: `${height}px`, position: 'relative' }}>
                {cachedUrl ? (
                    <img
                        src={cachedUrl}
                        style={{ width: '100%', height: '100%', display: 'block' }}
                        draggable={false}
                    />
                ) : (
                    <RenderLayer
                        documentId={documentId}
                        pageIndex={pageIndex}
                        dpr={window.devicePixelRatio}
                    />
                )}
            </div>
        );
    };

    return (
        <ViewerLayout
            onOptionChanged={(opt) => {
                setDirection(opt.direction);
                setSpread(opt.spread);
            }}
            onLeft={() => {
                if (direction === "ltr") {
                    toPrev();
                } else {
                    toNext();
                }
            }}
            onRight={() => {
                if (direction === "ltr") {
                    toNext();
                } else {
                    toPrev();
                }
            }}>
            <div className="relative w-full max-w-full h-screen overflow-hidden flex items-center justify-center" style={{ backgroundColor: '#ffffff' }}>
                <div style={{ display: "flex" }}>
                    {direction === 'rtl' && isSpreads && nextPageSize && nextPageIndex !== null && (
                        <PageRenderer
                            pageIndex={nextPageIndex}
                            width={scaledNextWidth}
                            height={scaledNextHeight}
                        />
                    )}
                    <PageRenderer
                        pageIndex={currentPageIndex}
                        width={scaledCurrentWidth}
                        height={scaledCurrentHeight}
                    />
                    {direction === 'ltr' && isSpreads && nextPageSize && nextPageIndex !== null && (
                        <PageRenderer
                            pageIndex={nextPageIndex}
                            width={scaledNextWidth}
                            height={scaledNextHeight}
                        />
                    )}
                </div>
            </div>

            <div className="absolute left-0 bottom-3 w-full" style={{ opacity: 0.25, zIndex: 50 }}>
                <Slider
                    value={sliderValue}
                    min={1}
                    max={numPages ?? big_number}
                    step={1}
                    onValueChange={(values) => {
                        setSliderValue(values);
                    }}
                    onValueCommit={(values) => {
                        if (values.length > 0) {
                            setPageNumber(values[0]);
                            sendProgress(encodedFilePath ?? "", values[0].toString(), values[0] / (numPages ?? big_number));
                        }
                    }}
                    dir={direction === 'rtl' ? "rtl" : "ltr"}
                    tabIndex={-1}
                    onKeyDown={(e) => {
                        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                            e.preventDefault();
                        }
                    }}
                />
            </div>
        </ViewerLayout>
    );
}

export function PDFViewer({ fileUrl, initialPage = 1 }: PDFViewerProps) {
    const { engine, isLoading: engineLoading, error: engineError } = usePdfiumEngine();

    const encodedFilePath = useMemo(() => {
        try {
            const url = new URL(fileUrl, window.location.origin);
            return url.searchParams.get("path");
        } catch (e) {
            console.warn("Invalid URL:", fileUrl);
            return "";
        }
    }, [fileUrl]);

    const pdfUrl = useMemo(() => {
        if (!encodedFilePath) return "";
        return `${window.location.origin}/book/pdf?path=${encodeURIComponent(encodedFilePath)}`;
    }, [encodedFilePath]);

    const plugins = useMemo(() => {
        const docConfig = pdfUrl ? {
            initialDocuments: [{ url: pdfUrl }],
        } : {};
        return [
            createPluginRegistration(DocumentManagerPluginPackage, docConfig),
            createPluginRegistration(ViewportPluginPackage),
            createPluginRegistration(RenderPluginPackage),
        ];
    }, [pdfUrl]);

    if (engineLoading || !engine) {
        return (
            <div className="w-full h-screen flex items-center justify-center">
                <p>Loading PDF Engine...</p>
            </div>
        );
    }

    if (engineError) {
        return (
            <div className="w-full h-screen flex items-center justify-center">
                <p>Failed to load PDF engine: {engineError.message}</p>
            </div>
        );
    }

    if (!pdfUrl) {
        return (
            <div className="w-full h-screen flex items-center justify-center">
                <p>No PDF URL provided</p>
            </div>
        );
    }

    return (
        <EmbedPDF engine={engine} plugins={plugins}>
            {({ activeDocumentId }) =>
                activeDocumentId ? (
                    <DocumentContent documentId={activeDocumentId}>
                        {({ isLoading, isLoaded, isError, documentState }) => {
                            if (isLoading) {
                                return (
                                    <div className="w-full h-screen flex items-center justify-center">
                                        <p>Loading PDF...</p>
                                    </div>
                                );
                            }
                            if (isError) {
                                return (
                                    <div className="w-full h-screen flex items-center justify-center">
                                        <p>Failed to load PDF: {documentState?.error || "Unknown error"}</p>
                                    </div>
                                );
                            }
                            if (isLoaded) {
                                return (
                                    <PDFViewerInner
                                        documentId={activeDocumentId}
                                        encodedFilePath={encodedFilePath ?? ""}
                                        initialPage={initialPage}
                                        documentState={documentState!}
                                    />
                                );
                            }
                            return null;
                        }}
                    </DocumentContent>
                ) : null
            }
        </EmbedPDF>
    );
}
