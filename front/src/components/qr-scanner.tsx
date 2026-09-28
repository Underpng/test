import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

// Camera QR reader for the login screen. A home-screen app cannot receive a
// QR code scanned with the camera app (that opens the browser), so it reads
// the PC's pairing QR code itself. jsQR is loaded only when this opens.

export function cameraAvailable(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

// pairCodeFrom takes the pairing code out of a scanned QR text
// ("https://…/pair?code=XYZ"), or null when it is some other QR code.
export function pairCodeFrom(text: string): string | null {
    try {
        const u = new URL(text);
        return u.pathname === "/pair" ? u.searchParams.get("code") : null;
    } catch {
        return null;
    }
}

const SCAN_EVERY_MS = 150;
const SCAN_WIDTH = 640;

export function QrScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [wrongCode, setWrongCode] = useState(false);

    useEffect(() => {
        let stream: MediaStream | null = null;
        let timer = 0;
        let stopped = false;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        (async () => {
            try {
                const [{ default: jsQR }, media] = await Promise.all([
                    import("jsqr"),
                    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }),
                ]);
                stream = media;
                if (stopped) return media.getTracks().forEach((t) => t.stop());
                const video = videoRef.current!;
                video.srcObject = media;
                await video.play();
                const scan = () => {
                    if (stopped || !ctx || video.videoWidth === 0) return;
                    const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
                    canvas.width = Math.round(video.videoWidth * scale);
                    canvas.height = Math.round(video.videoHeight * scale);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
                    if (!hit) return;
                    const code = pairCodeFrom(hit.data);
                    if (code) {
                        stopped = true;
                        onCode(code);
                    } else setWrongCode(true);
                };
                timer = window.setInterval(scan, SCAN_EVERY_MS);
            } catch (e) {
                const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
                setError(
                    denied
                        ? "カメラの使用が許可されていません。iPhone の「設定」でこのアプリ（または Safari）のカメラを許可してください。"
                        : "カメラを起動できませんでした。",
                );
            }
        })();

        return () => {
            stopped = true;
            window.clearInterval(timer);
            stream?.getTracks().forEach((t) => t.stop());
        };
    }, [onCode]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label="QR コードを読み取る" data-testid="qr-scanner">
            <div className="flex items-center justify-between px-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}>
                <p className="px-2 text-sm">PC の管理画面の QR コードを映してください</p>
                <button type="button" aria-label="閉じる" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
                    <X size={22} />
                </button>
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                {!error && <div className="pointer-events-none absolute aspect-square w-2/3 max-w-xs rounded-3xl border-4 border-white/80" aria-hidden />}
                {error && <p className="absolute max-w-sm px-6 text-center text-sm leading-relaxed">{error}</p>}
            </div>
            <p className="px-6 pt-3 text-center text-xs text-neutral-300" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
                {wrongCode ? "ログイン用の QR コードではないようです。管理画面の QR コードを映してください。" : "読み取ると、そのままログインします。"}
            </p>
        </div>
    );
}
