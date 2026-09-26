import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";
import { guessDeviceName, postJSON, refreshAuth } from "@/lib/auth";

// Opened from the QR code shown on the PC: registers this device.
export default function PairPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const code = params.get("code") ?? "";
    const [name, setName] = useState(guessDeviceName);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const pair = async () => {
        setBusy(true);
        setFailed(false);
        try {
            const res = await postJSON("/api/auth/pair", { code, name });
            if (res.ok) {
                await refreshAuth();
                navigate("/", { replace: true });
                return;
            }
            setFailed(true);
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
            <div className="w-full max-w-sm space-y-5 text-center" data-testid="pair-page">
                <img src="/favicon.png" alt="" className="mx-auto h-20 w-20 rounded-3xl shadow-md" />
                {failed ? (
                    <>
                        <Illustration src={illustrations.searching} size="md" className="mx-auto" />
                        <h1 className="text-xl font-semibold">この QR コードは使えません</h1>
                        <p className="text-sm text-muted-foreground">
                            有効期限（5 分）が切れたか、すでに使われています。PC の管理画面で新しい QR コードを出して、もう一度読んでください。
                        </p>
                    </>
                ) : (
                    <>
                        <h1 className="text-xl font-semibold">この端末でログイン</h1>
                        <p className="text-sm text-muted-foreground">PC の管理画面の端末一覧に、この名前で表示されます。</p>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            aria-label="端末の名前"
                            className="h-12 w-full rounded-full bg-surface-high px-4 text-center outline-none focus:ring-2 focus:ring-ring"
                        />
                        <Button className="w-full" onClick={pair} disabled={busy || !code}>
                            ログインする
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
