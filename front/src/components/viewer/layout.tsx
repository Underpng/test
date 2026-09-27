import { ReactNode, useRef, useEffect } from "react";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
    Sheet,
    SheetTrigger,
} from "@/components/ui/sheet";
import { ViewerOptions, ViewerOptionSheet } from "./sheet";

type ViewerLayoutProps = {
    children: ReactNode;
    onOptionChanged?: (options: ViewerOptions) => void;
    onLeft?: () => void;
    onRight?: () => void;
    onBack?: () => void;
};

export function ViewerLayout({
    children,
    onOptionChanged,
    onLeft,
    onRight,
    onBack,
}: ViewerLayoutProps) {
    const navigate = useNavigate();
    const goBack = onBack ?? (() => navigate(-1));
    const touchStartX = useRef<number | null>(null);
    const touchEndX = useRef<number | null>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                onLeft?.();
            } else if (e.key === "ArrowRight") {
                onRight?.();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onLeft, onRight]);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.changedTouches[0].clientX;
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        touchEndX.current = e.changedTouches[0].clientX;
        if (touchStartX.current !== null && touchEndX.current !== null) {
            const diff = touchStartX.current - touchEndX.current;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    onRight?.();
                } else {
                    onLeft?.();
                }
            }
        }
        touchStartX.current = null;
        touchEndX.current = null;
    };

    return (
        <div className="fixed inset-0">
            <button
                type="button"
                aria-label="本棚へ戻る"
                onClick={goBack}
                className="absolute top-4 left-4 z-50 opacity-50 hover:opacity-100"
            >
                <ArrowLeft />
            </button>
            <Sheet>
                <SheetTrigger asChild>
                    <Settings2 className="absolute top-4 right-4 opacity-50 z-50" />
                </SheetTrigger>
                <ViewerOptionSheet onOptionChanged={onOptionChanged} />
            </Sheet>

            <div
                className="pointer-events-none flex items-center justify-center w-full h-full"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <div className="pointer-events-auto">
                    {children}
                </div>
            </div>
        </div>
    );
}
