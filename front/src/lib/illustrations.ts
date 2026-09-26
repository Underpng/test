import sleeping from "@/assets/illustrations/sleeping.png";
import empty from "@/assets/illustrations/empty.png";
import searching from "@/assets/illustrations/searching.png";
import cheer from "@/assets/illustrations/cheer.png";

// The shelf's mascot in different moods, used for empty, error and
// celebration states.
export const illustrations = {
    sleeping, // connection lost / something failed
    empty,    // no books yet
    searching, // page not found
    cheer,    // series finished
} as const;

// The error picture must already be cached when the server goes away, so
// fetch it once while the connection is still up.
export function preloadIllustrations() {
    const warm = () => {
        const img = new Image();
        img.src = sleeping;
    };
    if (document.readyState === "complete") warm();
    else window.addEventListener("load", warm, { once: true });
}
