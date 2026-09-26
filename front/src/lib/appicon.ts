import { useSyncExternalStore } from "react";

// Which mascot the app shows: the reading-at-home girl or the one on the
// train. "auto" follows where the reader is connecting from.
export type IconSetting = "auto" | "home" | "away";
export type IconVariant = "home" | "away";

const KEY = "appIcon";

type State = { setting: IconSetting; remote: boolean; known: boolean };
let state: State = { setting: readSetting(), remote: false, known: false };
const listeners = new Set<() => void>();

function readSetting(): IconSetting {
    try {
        const v = localStorage.getItem(KEY);
        if (v === "home" || v === "away") return v;
    } catch {
        // storage unavailable
    }
    return "auto";
}

function emit(next: Partial<State>) {
    state = { ...state, ...next };
    applyToDocument();
    listeners.forEach((l) => l());
}

export function variantOf(s: State = state): IconVariant {
    if (s.setting === "auto") return s.remote ? "away" : "home";
    return s.setting;
}

// iconUrl names the file explicitly (?v=home keeps the server from
// substituting the away icon for remote readers).
export function iconUrl(variant: IconVariant, file: string): string {
    return variant === "away" ? `/away/${file}` : `/${file}?v=home`;
}

export function setIconSetting(setting: IconSetting) {
    try {
        if (setting === "auto") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, setting);
    } catch {
        // ignore
    }
    emit({ setting });
}

function setLink(rel: string, href: string) {
    let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
    }
    if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

// Keeps the tab icon, the home-screen icon and the suggested app name in
// line with the chosen variant. Safari reads these when "Add to Home
// Screen" is tapped, so the shortcut gets whichever icon is showing.
function applyToDocument() {
    const v = variantOf();
    setLink("icon", iconUrl(v, "favicon.png"));
    setLink("apple-touch-icon", iconUrl(v, "apple-touch-icon.png"));
    setLink("manifest", v === "away" ? "/away/manifest.webmanifest" : "/manifest.webmanifest?v=home");
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.content = v === "away" ? "shelf 外" : "shelf";
}

// Asks the server whether this connection counts as away from home.
export async function refreshConnection() {
    try {
        const res = await fetch("/api/client", { cache: "no-store" });
        if (!res.ok) return;
        const c = (await res.json()) as { remote?: boolean };
        emit({ remote: !!c.remote, known: true });
    } catch {
        // offline: keep the last known state
    }
}

export function initAppIcon() {
    applyToDocument();
    refreshConnection();
    // Coming back to the app (e.g. after leaving the house) re-checks.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshConnection();
    });
}

function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
}

export function useAppIcon() {
    const s = useSyncExternalStore(subscribe, () => state);
    return { ...s, variant: variantOf(s) };
}
