// iOS home-screen apps with a translucent status bar draw the page from
// the very top of the screen, but position:fixed layers are laid out AND
// clipped to a viewport one status bar shorter. The band left below them
// shows only the page canvas, and it already covers the home indicator.
//
// We measure that shortfall as --vgap. index.css derives --safe-bottom from
// it (the bottom inset minus the band) for fixed bottom bars, and full-screen
// layers call paintCanvas() so the band matches their colour.
//
// Outside the iOS home-screen app the gap is always 0.

type NavigatorStandalone = Navigator & { standalone?: boolean };

function measure(): number {
    if (!(navigator as NavigatorStandalone).standalone) return 0;
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const full = window.innerWidth < window.innerHeight ? long : short;
    const gap = full - window.innerHeight;
    // Only a status-bar-sized shortfall is this bug; anything else (e.g. a
    // keyboard) is left alone.
    return gap > 0 && gap <= 80 ? gap : 0;
}

function apply() {
    document.documentElement.style.setProperty("--vgap", `${measure()}px`);
    updateDebug();
}

// Paint the page canvas (and so the band under the fixed layers) while a
// full-screen layer is open. Returns the restore function.
export function paintCanvas(color: string): () => void {
    const els = [document.documentElement, document.body];
    const previous = els.map((el) => el.style.backgroundColor);
    els.forEach((el) => (el.style.backgroundColor = color));
    return () => els.forEach((el, i) => (el.style.backgroundColor = previous[i]));
}

export function initViewportFix() {
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", () => window.setTimeout(apply, 300));
    if (new URLSearchParams(location.search).has("vpdebug")) showDebug();
}

// ----- ?vpdebug=1 : on-screen numbers for checking on a real phone -----

let debugEl: HTMLDivElement | null = null;

function showDebug() {
    debugEl = document.createElement("div");
    debugEl.style.cssText =
        "position:fixed;left:8px;top:50%;z-index:99999;background:rgba(0,0,0,.8);color:#0f0;font:12px/1.4 monospace;padding:8px;border-radius:8px;white-space:pre;pointer-events:none";
    document.body.appendChild(debugEl);
    const probe = document.createElement("div");
    probe.id = "vp-probe";
    probe.style.cssText =
        "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
    updateDebug();
}

function updateDebug() {
    if (!debugEl) return;
    const probe = document.getElementById("vp-probe");
    const cs = probe ? getComputedStyle(probe) : null;
    const vv = window.visualViewport;
    debugEl.textContent = [
        `standalone: ${(navigator as NavigatorStandalone).standalone ?? "n/a"}`,
        `screen: ${screen.width} x ${screen.height}`,
        `inner: ${window.innerWidth} x ${window.innerHeight}`,
        `visual: ${vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)}` : "n/a"}`,
        `safe: top ${cs?.paddingTop} bottom ${cs?.paddingBottom}`,
        `--vgap: ${document.documentElement.style.getPropertyValue("--vgap")}`,
    ].join("\n");
}
