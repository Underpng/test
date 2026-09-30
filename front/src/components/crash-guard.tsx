import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = { error: Error | null };

// Catches a crash anywhere in the app. Without it React unmounts everything
// and the reader is left with an empty dark screen and no way to tell why;
// this shows what went wrong and a way back.
export class CrashGuard extends Component<{ children: ReactNode }, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("app crashed", error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground" data-testid="crash-screen">
                <p className="text-lg font-semibold">表示中にエラーが起きました</p>
                <p className="max-w-md break-words font-mono text-xs text-muted-foreground">{error.message || String(error)}</p>
                <Button onClick={() => location.reload()}>
                    <RefreshCw size={16} />
                    再読み込み
                </Button>
            </div>
        );
    }
}
