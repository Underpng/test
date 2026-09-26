import { useCallback, useEffect, useState } from "react";
import { KeyRound, Laptop, QrCode, RefreshCw, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";
import { postJSON } from "@/lib/auth";

type Link = { label: string; url: string };
type AdminState = {
    passwordSet: boolean;
    lanNoLogin: boolean;
    devices: { id: string; name: string; created: string; lastSeen: string }[];
    addresses: Link[];
};
type Pair = { code: string; expires: string; links: Link[] };

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-3 rounded-3xl bg-surface-low p-5">
            <h2 className="flex items-center gap-2 font-semibold">
                <span className="text-primary">{icon}</span>
                {title}
            </h2>
            {children}
        </section>
    );
}

function formatDate(s: string) {
    const d = new Date(s);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ----- QR pairing -----

function PairingPanel({ addresses }: { addresses: Link[] }) {
    const [pair, setPair] = useState<Pair | null>(null);
    const [which, setWhich] = useState(0);
    const [left, setLeft] = useState(0);

    const create = useCallback(async () => {
        const res = await postJSON("/api/admin/pair", {}, true);
        if (res.ok) setPair((await res.json()) as Pair);
    }, []);

    useEffect(() => {
        create();
    }, [create]);

    useEffect(() => {
        if (!pair) return;
        const tick = () => setLeft(Math.max(0, Math.round((new Date(pair.expires).getTime() - Date.now()) / 1000)));
        tick();
        const t = window.setInterval(tick, 1000);
        return () => window.clearInterval(t);
    }, [pair]);

    if (addresses.length === 0) {
        return <p className="text-sm text-muted-foreground">スマホから届くアドレスが見つかりません。PC がネットワークにつながっているか確認してください。</p>;
    }
    const link = pair?.links[Math.min(which, (pair?.links.length ?? 1) - 1)];
    const expired = pair !== null && left === 0;

    return (
        <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
                スマホのカメラでこの QR コードを読むと、その端末がログインした状態になります。QR コードは 5 分で使えなくなり、1 回しか使えません。
            </p>
            {pair && pair.links.length > 1 && (
                <div role="tablist" className="flex flex-wrap gap-2">
                    {pair.links.map((l, i) => (
                        <button
                            key={l.url}
                            type="button"
                            role="tab"
                            aria-selected={i === which}
                            onClick={() => setWhich(i)}
                            className={`rounded-full px-3 py-1.5 text-xs ${i === which ? "bg-primary-container text-primary-container-foreground" : "bg-surface-high"}`}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>
            )}
            {link && (
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                    <div className={`rounded-2xl bg-white p-3 ${expired ? "opacity-30" : ""}`}>
                        <img
                            src={`/api/admin/qr?text=${encodeURIComponent(link.url)}`}
                            alt="ログイン用の QR コード"
                            data-testid="pair-qr"
                            className="h-48 w-48 [image-rendering:pixelated]"
                        />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 text-sm">
                        <p className="break-all text-muted-foreground" data-testid="pair-url">
                            {link.url}
                        </p>
                        <p className={expired ? "text-destructive" : "text-muted-foreground"}>
                            {expired ? "有効期限が切れました。" : `残り ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
                        </p>
                        <Button variant="secondary" onClick={create}>
                            <RefreshCw size={16} />
                            新しい QR コード
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ----- password -----

function PasswordPanel({ passwordSet, onChange }: { passwordSet: boolean; onChange: () => void }) {
    const [pw, setPw] = useState("");
    const [pw2, setPw2] = useState("");
    const [msg, setMsg] = useState<string | null>(null);

    const save = async (value: string) => {
        setMsg(null);
        const res = await postJSON("/api/admin/password", { password: value }, true);
        if (res.ok) {
            setPw("");
            setPw2("");
            setMsg(value ? "パスワードを保存しました。" : "パスワードを削除しました。");
            onChange();
            return;
        }
        const err = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        setMsg(err === "too_short" ? "8 文字以上にしてください。" : "保存できませんでした。");
    };

    const mismatch = pw2 !== "" && pw !== pw2;
    return (
        <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
                外出先で新しい端末からログインするときに使います。QR コードだけで使うなら設定しなくてもかまいません。忘れたときは、ここで設定し直せます。
            </p>
            <p className="text-sm" data-testid="password-state">
                {passwordSet ? "パスワード: 設定済み" : "パスワード: 未設定"}
            </p>
            <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!mismatch && pw) save(pw);
                }}
            >
                <input
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder={passwordSet ? "新しいパスワード" : "パスワード（8 文字以上）"}
                    aria-label="新しいパスワード"
                    className="h-11 min-w-0 flex-1 rounded-full bg-surface-high px-4 outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="もう一度"
                    aria-label="パスワードの確認"
                    className="h-11 min-w-0 flex-1 rounded-full bg-surface-high px-4 outline-none focus:ring-2 focus:ring-ring"
                />
                <Button type="submit" disabled={!pw || pw !== pw2}>
                    保存
                </Button>
            </form>
            {mismatch && <p className="text-sm text-destructive">2 つの入力が一致しません。</p>}
            {msg && (
                <p role="status" className="text-sm text-muted-foreground">
                    {msg}
                </p>
            )}
            {passwordSet && (
                <Button variant="ghost" className="text-destructive" onClick={() => save("")}>
                    パスワードを削除
                </Button>
            )}
        </div>
    );
}

export default function AdminPage() {
    const [state, setState] = useState<AdminState | null>(null);
    const [forbidden, setForbidden] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/state", { cache: "no-store" });
        if (res.status === 403) {
            setForbidden(true);
            return;
        }
        if (res.ok) setState((await res.json()) as AdminState);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    if (forbidden) {
        return (
            <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-12 text-center">
                <Illustration src={illustrations.searching} />
                <h1 className="mt-6 text-xl font-semibold" data-testid="admin-forbidden">
                    管理画面はサーバーの PC からだけ開けます
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">サーバーを動かしている PC のブラウザで http://localhost:50080/admin を開いてください。</p>
            </div>
        );
    }
    if (!state) return null;

    return (
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-4 md:px-8 md:py-8" data-testid="admin-page">
            <h1 className="text-2xl font-semibold md:text-3xl">管理</h1>

            <Section icon={<QrCode size={20} />} title="スマホでログイン（QR コード）">
                <PairingPanel addresses={state.addresses} />
            </Section>

            <Section icon={<Laptop size={20} />} title="ログイン中の端末">
                {state.devices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">まだありません。</p>
                ) : (
                    <ul className="divide-y divide-border/60" data-testid="device-list">
                        {state.devices.map((d) => (
                            <li key={d.id} className="flex items-center gap-3 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{d.name}</p>
                                    <p className="text-xs text-muted-foreground">最終アクセス {formatDate(d.lastSeen)}</p>
                                </div>
                                <Button
                                    variant="ghost"
                                    aria-label={`${d.name} をログアウト`}
                                    onClick={async () => {
                                        await fetch(`/api/admin/devices/${encodeURIComponent(d.id)}`, { method: "DELETE", headers: { "X-Shelf-Admin": "1" } });
                                        load();
                                    }}
                                >
                                    <Trash2 size={16} />
                                    ログアウト
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            <Section icon={<KeyRound size={20} />} title="パスワード">
                <PasswordPanel passwordSet={state.passwordSet} onChange={load} />
            </Section>

            <Section icon={<Wifi size={20} />} title="LAN内/Wi-Fi接続">
                <label className="flex items-center justify-between gap-4">
                    <span className="text-sm leading-relaxed">
                        LAN内/Wi-Fi接続と Tailscale からはログインなしで読めるようにする
                        <span className="block text-xs text-muted-foreground">公開 URL からのアクセスには、この設定にかかわらずログインが必要です。</span>
                    </span>
                    <Switch
                        checked={state.lanNoLogin}
                        aria-label="LAN内/Wi-Fi接続はログイン不要"
                        onCheckedChange={async (v) => {
                            await postJSON("/api/admin/lan", { noLogin: v }, true);
                            load();
                        }}
                    />
                </label>
            </Section>
        </div>
    );
}
