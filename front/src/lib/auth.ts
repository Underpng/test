import { useSyncExternalStore } from "react";

export type AuthStatus = {
    enabled: boolean;
    authenticated: boolean;
    admin: boolean; // this browser runs on the server PC
    passwordSet: boolean;
    device?: { id: string; name: string };
};

type State = { status: AuthStatus | null; error: boolean };
let state: State = { status: null, error: false };
const listeners = new Set<() => void>();

function emit(next: State) {
    state = next;
    listeners.forEach((l) => l());
}

export async function refreshAuth(): Promise<AuthStatus | null> {
    try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as AuthStatus;
        emit({ status: s, error: false });
        return s;
    } catch {
        emit({ status: state.status, error: true });
        return null;
    }
}

// Any 401 from the library API (e.g. this device was logged out on the PC)
// sends the reader back to the login screen.
let patched = false;
export function watchUnauthorized() {
    if (patched) return;
    patched = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const res = await orig(input, init);
        if (res.status === 401) {
            const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
            if (!url.includes("/api/auth/") && state.status?.authenticated) refreshAuth();
        }
        return res;
    };
}

function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
}

export function useAuth() {
    return useSyncExternalStore(subscribe, () => state);
}

// A readable default name for this device.
export function guessDeviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Windows/.test(ua)) return "Windows";
    if (/Macintosh/.test(ua)) return "Mac";
    return "端末";
}

export async function postJSON(url: string, body: unknown, admin = false): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (admin) headers["X-Shelf-Admin"] = "1";
    return fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
}
