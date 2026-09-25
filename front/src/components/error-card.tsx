import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
    message?: string;
    detail?: string;
    onRetry?: () => void;
    className?: string;
};

// Inline failure notice with a retry action, used wherever a fetch can fail.
export function ErrorCard({ message = "読み込みに失敗しました", detail, onRetry, className = "" }: Props) {
    return (
        <div role="alert" className={`flex flex-col items-center gap-3 rounded-3xl bg-surface-low px-6 py-8 text-center ${className}`}>
            <WifiOff className="text-muted-foreground" size={28} />
            <p className="font-medium">{message}</p>
            {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
            {onRetry && (
                <Button variant="secondary" onClick={onRetry} className="mt-1">
                    <RefreshCw size={16} />
                    再試行
                </Button>
            )}
        </div>
    );
}

// Turns a failed fetch into a short explanation for the card.
export function describeError(e: unknown): string {
    if (e instanceof TypeError) return "サーバーに接続できません。同じ Wi-Fi に繋がっているか、PC でサーバーが動いているか確認してください。";
    if (e instanceof Error && e.message) return e.message;
    return "";
}
