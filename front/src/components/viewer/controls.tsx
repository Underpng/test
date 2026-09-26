import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Maximize, Minimize } from "lucide-react";
import { Slider } from "@/components/ui/slider";

// ----- page slider with a destination bubble -----

type PageSliderProps = {
    value: number[];
    min: number;
    max: number;
    step: number;
    dir: "ltr" | "rtl";
    disabled?: boolean;
    label: string;
    format: (v: number) => string;
    onValueChange: (v: number[]) => void;
    onValueCommit: (v: number[]) => void;
};

// While the thumb is dragged, a bubble above it shows where the reader
// will land.
export function PageSlider({ value, min, max, step, dir, disabled, label, format, onValueChange, onValueCommit }: PageSliderProps) {
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        if (!dragging) return;
        const end = () => setDragging(false);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        return () => {
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
    }, [dragging]);

    const v = value[0] ?? min;
    let pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    if (dir === "rtl") pct = 100 - pct;
    pct = Math.min(Math.max(pct, 4), 96); // keep the bubble on screen

    return (
        <div className="relative" onPointerDown={() => !disabled && setDragging(true)}>
            {dragging && (
                <div
                    data-testid="slider-bubble"
                    className="pointer-events-none absolute bottom-full mb-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm font-semibold tabular-nums text-black shadow-lg"
                    style={{ left: `${pct}%` }}
                >
                    {format(v)}
                </div>
            )}
            <Slider
                value={value}
                min={min}
                max={max}
                step={step}
                dir={dir}
                disabled={disabled}
                aria-label={label}
                onValueChange={onValueChange}
                onValueCommit={(x) => {
                    setDragging(false);
                    onValueCommit(x);
                }}
            />
        </div>
    );
}

// ----- volume chip -----

export function VolumeChip({ index, total }: { index: number; total: number }) {
    return (
        <span
            data-testid="volume-chip"
            className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs tabular-nums text-neutral-100"
            title="巻"
        >
            <BookOpen size={13} />
            {index} / {total} 巻
        </span>
    );
}

// ----- full-screen reading mode -----

const KEY = "viewerImmersive";

function readImmersive(): boolean {
    try {
        return localStorage.getItem(KEY) === "1";
    } catch {
        return false;
    }
}

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

function browserFullscreen(): boolean {
    const d = document as FsDoc;
    return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

// "Full screen" here means the reader shows only the pages: the bars stay
// hidden (a centre tap still brings them back). Where the browser allows
// it (desktop, Android, iPad) the browser's own UI is hidden as well;
// elsewhere, e.g. iPhone Safari, the in-page mode is all there is.
export function useImmersive() {
    const [on, setOn] = useState(readImmersive);
    const entered = useRef(false);

    const save = (v: boolean) => {
        try {
            localStorage.setItem(KEY, v ? "1" : "0");
        } catch {
            // ignore
        }
    };

    const exitBrowser = useCallback(() => {
        if (!browserFullscreen()) return;
        const d = document as FsDoc;
        try {
            const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
            (p as Promise<void> | undefined)?.catch?.(() => {});
        } catch {
            // ignore
        }
        entered.current = false;
    }, []);

    const toggle = useCallback(() => {
        const next = !on;
        setOn(next);
        save(next);
        if (next) {
            const el = document.documentElement as FsEl;
            try {
                const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
                entered.current = true;
                (p as Promise<void> | undefined)?.catch?.(() => {
                    entered.current = false;
                });
            } catch {
                entered.current = false;
            }
        } else {
            exitBrowser();
        }
    }, [on, exitBrowser]);

    // Leaving browser full screen with Esc also leaves the reading mode.
    useEffect(() => {
        const onChange = () => {
            if (!browserFullscreen() && entered.current) {
                entered.current = false;
                setOn(false);
                save(false);
            }
        };
        document.addEventListener("fullscreenchange", onChange);
        document.addEventListener("webkitfullscreenchange", onChange);
        return () => {
            document.removeEventListener("fullscreenchange", onChange);
            document.removeEventListener("webkitfullscreenchange", onChange);
        };
    }, []);

    return { immersive: on, toggleImmersive: toggle, exitBrowserFullscreen: exitBrowser };
}

export function ImmersiveButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={on ? "全画面を終了" : "全画面"}
            aria-pressed={on}
            title={on ? "全画面を終了" : "全画面"}
            data-testid="immersive-button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
        >
            {on ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
    );
}
