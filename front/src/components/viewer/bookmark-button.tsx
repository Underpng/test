import { Bookmark, BookmarkCheck } from "lucide-react";

// Top-bar toggle for a bookmark on the current page.
export function BookmarkButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            aria-label={on ? "しおりを外す" : "しおりを挟む"}
            aria-pressed={on}
            data-testid="bookmark-toggle"
            onClick={onToggle}
            className={`p-3 transition-colors ${on ? "text-primary" : ""}`}
        >
            {on ? <BookmarkCheck className="fill-current [&>path:last-child]:stroke-black" /> : <Bookmark />}
        </button>
    );
}
