import { useCallback, useEffect, useState } from "react";
import { Camera, KeyRound, QrCode } from "lucide-react";
import { QrScanner, cameraAvailable } from "@/components/qr-scanner";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/error-card";
import { guessDeviceName, hadAccess, postJSON, refreshAuth, useAuth } from "@/lib/auth";

// Shows the login screen until this device may read the library.
export function AuthGate({ children }: { children: React.ReactNode }) {
    const { status, error } = useAuth();

    useEffect(() => {
        refreshAuth();
    }, []);

    if (!status) {
        // Offline on a device that was let in before: go ahead, saved books
        // still open and the pages show their own connection errors.
        if (error && hadAccess()) return <>{children}</>;
        if (error) return <div className="mx-auto max-w-md p-6"><ErrorCard detail="サーバーに接続できません。" onRetry={() => refreshAuth()} /></div>;
        return null;
    }
    if (!status.enabled || status.authenticated) return <>{children}</>;
    return <LoginPage passwordSet={status.passwordSet} />;
}

function LoginPage({ passwordSet }: { passwordSet: boolean }) {
    const [scanning, setScanning] = useState(false);
    const [scanMessage, setScanMessage] = useState<string | null>(null);
    const onCode = useCallback(async (code: string) => {
        setScanning(false);
        setScanMessage(null);
        try {
            const res = await postJSON("/api/auth/pair", { code, name: guessDeviceName() });
            if (res.ok) {
                await refreshAuth();
                return;
            }
            setScanMessage("この QR コードは使えません。有効期限（5 分）が切れたか、すでに使われています。PC で新しい QR コードを出してください。");
        } catch {
            setScanMessage("サーバーに接続できません。");
        }
    }, []);
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setMessage(null);
        try {
            const res = await postJSON("/api/auth/login", { password, name: guessDeviceName() });
            if (res.ok) {
                await refreshAuth();
                return;
            }
            const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
            setMessage(err === "bad_password" ? "パスワードが違います。" : "ログインできませんでした。");
        } catch {
            setMessage("サーバーに接続できません。");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
            <div className="w-full max-w-sm space-y-6" data-testid="login-page">
                <div className="flex flex-col items-center gap-3 text-center">
                    <img src="/favicon.png" alt="" className="h-20 w-20 rounded-3xl shadow-md" />
                    <h1 className="text-2xl font-bold tracking-tight">shelf にログイン</h1>
                </div>

                <section className="space-y-2 rounded-3xl bg-surface-low p-5">
                    <h2 className="flex items-center gap-2 font-medium">
                        <QrCode size={18} className="text-primary" />
                        QR コードでログイン
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        サーバーを動かしている PC で管理画面（http://localhost:50080/admin）を開き、表示される QR コードを読み取ってください。
                    </p>
                    {cameraAvailable() && (
                        <Button className="mt-2 w-full" onClick={() => setScanning(true)} data-testid="scan-qr">
                            <Camera size={18} />
                            QR コードを読み取る
                        </Button>
                    )}
                    {scanMessage && (
                        <p role="alert" className="text-sm text-destructive">
                            {scanMessage}
                        </p>
                    )}
                </section>
                {scanning && <QrScanner onCode={onCode} onClose={() => setScanning(false)} />}

                {passwordSet && (
                    <form onSubmit={submit} className="space-y-3 rounded-3xl bg-surface-low p-5">
                        <h2 className="flex items-center gap-2 font-medium">
                            <KeyRound size={18} className="text-primary" />
                            パスワードでログイン
                        </h2>
                        <input
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="パスワード"
                            aria-label="パスワード"
                            className="h-12 w-full rounded-full bg-surface-high px-4 outline-none focus:ring-2 focus:ring-ring"
                        />
                        {message && (
                            <p role="alert" className="text-sm text-destructive">
                                {message}
                            </p>
                        )}
                        <Button type="submit" className="w-full" disabled={busy || password === ""}>
                            ログイン
                        </Button>
                    </form>
                )}
            </div>
        </div>
    );
}
