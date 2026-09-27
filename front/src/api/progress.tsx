import { rememberProgress } from "@/lib/offline";
import { clearOverride } from "@/lib/library";

// Reading positions that could not reach the server (offline) wait here and
// are sent when the connection comes back. Only the latest per book counts.
const PENDING_KEY = "pendingProgress";

type Pending = Record<string, { position: string; progress: number }>;

function readPending(): Pending {
    try {
        return JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") as Pending;
    } catch {
        return {};
    }
}

function writePending(p: Pending) {
    try {
        if (Object.keys(p).length === 0) localStorage.removeItem(PENDING_KEY);
        else localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {
        /* ignore */
    }
}

function post(path: string, position: string, progress: number): Promise<boolean> {
    const url = new URL("/api/progress", window.location.origin);
    url.searchParams.set("path", path);
    url.searchParams.set("position", position);
    url.searchParams.set("progress", progress.toString());
    return fetch(url.toString())
        .then((res) => res.ok)
        .catch(() => false);
}

export function sendProgress(path: string, currentPosition: string, progress: number) {
    rememberProgress(path, currentPosition, progress);
    clearOverride(path);
    post(path, currentPosition, progress).then((ok) => {
        const pending = readPending();
        if (ok) {
            if (pending[path]) {
                delete pending[path];
                writePending(pending);
            }
            return;
        }
        pending[path] = { position: currentPosition, progress };
        writePending(pending);
    });
}

// flushPendingProgress sends what was read offline. Called at startup and
// whenever the device comes back online.
export async function flushPendingProgress() {
    const pending = readPending();
    for (const [path, p] of Object.entries(pending)) {
        if (await post(path, p.position, p.progress)) {
            const now = readPending();
            if (now[path]?.position === p.position) delete now[path];
            writePending(now);
        } else return;
    }
}

export function initProgressSync() {
    flushPendingProgress();
    window.addEventListener("online", () => flushPendingProgress());
}
