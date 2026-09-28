import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";
import { guessDeviceName, postJSON, refreshAuth } from "@/lib/auth";

// Opened from the QR code shown on the PC. Scanning is all it takes: the
// device is let in straight away (its name can be changed on the PC).
export default function PairPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const code = params.get("code") ?? "";
    const [state, setState] = useState<"working" | "done" | "failed">(code ? "working" : "failed");
    const started = useRef(false);

    useEffect(() => {
        // A code works once: never send it twice (React's development
        // double-run of effects would).
        if (!code || started.current) return;
        started.current = true;
        postJSON("/api/auth/pair", { code, name: guessDeviceName() })
            .then(async (res) => {
                if (!res.ok) return setState("failed");
                await refreshAuth();
                setState("done");
                window.setTimeout(() => navigate("/", { replace: true }), 1200);
            })
            .catch(() => setState("failed"));
    }, [code, navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
            <div className="w-full max-w-sm space-y-5 text-center" data-testid="pair-page" data-state={state}>
                {state === "working" && (
                    <>
                        <Loader2 size={40} className="mx-auto animate-spin text-primary" />
                        <h1 className="text-xl font-semibold">ログインしています…</h1>
                    </>
                )}
                {state === "done" && (
                    <>
                        <CheckCircle2 size={48} className="mx-auto text-primary" />
                        <h1 className="text-xl font-semibold">ログインしました</h1>
                        <p className="text-sm text-muted-foreground">この端末で本棚が使えるようになりました。</p>
                        <Button className="w-full" onClick={() => navigate("/", { replace: true })}>
                            本棚をひらく
                        </Button>
                    </>
                )}
                {state === "failed" && (
                    <>
                        <Illustration src={illustrations.searching} size="md" className="mx-auto" />
                        <h1 className="text-xl font-semibold">この QR コードは使えません</h1>
                        <p className="text-sm text-muted-foreground">
                            有効期限（5 分）が切れたか、すでに使われています。PC の管理画面で新しい QR コードを出して、もう一度読んでください。
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
