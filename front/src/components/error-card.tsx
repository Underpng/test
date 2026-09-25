import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";

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
            <Illustration src={illustrations.sleeping} size="md" />
            <p className="mt-1 font-medium">{message}</p>
            {detail && <p className="max-w-md text-sm text-muted-foreground">{detail}</p>}
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
