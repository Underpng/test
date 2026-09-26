import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, LogOut, Monitor, Moon, Settings, Shield, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJSON, refreshAuth, useAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getThemeSetting, setThemeSetting, type ThemeSetting } from "@/lib/theme";
import { iconUrl, setIconSetting, useAppIcon, type IconSetting } from "@/lib/appicon";
import { loadOptions, type Quality } from "@/components/viewer/sheet";

function Choice<T extends string>({
    value,
    options,
    onChange,
    label,
}: {
    value: T;
    options: { value: T; label: string; icon?: React.ReactNode }[];
    onChange: (v: T) => void;
    label: string;
}) {
    return (
        <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2">
            {options.map((o) => {
                const on = o.value === value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(o.value)}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-xs transition-colors ${on ? "bg-primary-container text-primary-container-foreground" : "bg-surface-high hover:bg-surface-highest"}`}
                    >
                        {o.icon}
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

function IconPreview({ src, on }: { src: string; on: boolean }) {
    return (
        <span className="relative">
            <img src={src} alt="" className="h-14 w-14 rounded-2xl shadow-sm [image-rendering:pixelated]" />
            {on && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check size={14} />
                </span>
            )}
        </span>
    );
}

// App-wide settings: theme, mascot icon and comic page quality.
export function SettingsButton({ className = "" }: { className?: string }) {
    const [theme, setTheme] = useState<ThemeSetting>(getThemeSetting);
    const [quality, setQuality] = useState<Quality>(() => loadOptions().quality);
    const icon = useAppIcon();
    const { status: auth } = useAuth();
    const [open, setOpen] = useState(false);

    const changeQuality = (q: Quality) => {
        setQuality(q);
        const o = { ...loadOptions(), quality: q };
        localStorage.setItem("viewerOptions", JSON.stringify(o));
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <button
                    type="button"
                    aria-label="設定"
                    title="設定"
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-high ${className}`}
                >
                    <Settings size={20} />
                </button>
            </SheetTrigger>
            <SheetContent className="overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>設定</SheetTitle>
                </SheetHeader>

                <div className="mt-6 space-y-7 px-1">
                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">テーマ</h3>
                        <Choice
                            label="テーマ"
                            value={theme}
                            onChange={(t) => {
                                setThemeSetting(t);
                                setTheme(t);
                            }}
                            options={[
                                { value: "system", label: "OS に合わせる", icon: <Monitor size={18} /> },
                                { value: "light", label: "ライト", icon: <Sun size={18} /> },
                                { value: "dark", label: "ダーク", icon: <Moon size={18} /> },
                            ]}
                        />
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">アイコン</h3>
                        <Choice<IconSetting>
                            label="アイコン"
                            value={icon.setting}
                            onChange={setIconSetting}
                            options={[
                                {
                                    value: "auto",
                                    label: "自動",
                                    icon: <IconPreview src={iconUrl(icon.remote ? "away" : "home", "favicon.png")} on={icon.setting === "auto"} />,
                                },
                                { value: "home", label: "おうち", icon: <IconPreview src={iconUrl("home", "favicon.png")} on={icon.setting === "home"} /> },
                                { value: "away", label: "おでかけ", icon: <IconPreview src={iconUrl("away", "favicon.png")} on={icon.setting === "away"} /> },
                            ]}
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="icon-note">
                            {icon.setting === "auto"
                                ? `自動: いまは${icon.remote ? "リモート接続なので「おでかけ」" : "LAN内/Wi-Fi接続なので「おうち」"}です。`
                                : "選んだアイコンをいつも使います。"}
                            ホーム画面のアイコンは追加したときの絵のまま残るので、変えたいときは一度削除してから追加し直してください。
                        </p>
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">画質</h3>
                        <Choice<Quality>
                            label="画質"
                            value={quality}
                            onChange={changeQuality}
                            options={[
                                { value: "auto", label: "自動" },
                                { value: "original", label: "クオリティ" },
                                { value: "saver", label: "セーブ" },
                            ]}
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            自動モードに設定すると、LAN内/Wi-Fi接続では元画像を読み込むクオリティモード、リモート接続では通信量を約半分に抑えるセーブモードになります。
                        </p>
                    </section>

                    {auth?.enabled && (
                        <section className="space-y-2" data-testid="settings-login">
                            <h3 className="text-sm font-medium">ログイン</h3>
                            {auth.device ? (
                                <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-high px-4 py-3">
                                    <span className="min-w-0 truncate text-sm">この端末: {auth.device.name}</span>
                                    <Button
                                        variant="ghost"
                                        onClick={async () => {
                                            await postJSON("/api/auth/logout", {});
                                            setOpen(false);
                                            await refreshAuth();
                                        }}
                                    >
                                        <LogOut size={16} />
                                        ログアウト
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    {auth.admin ? "サーバーの PC から使っています。" : "LAN内/Wi-Fi接続なので、ログインなしで使っています。"}
                                </p>
                            )}
                            {auth.admin && (
                                <Button asChild variant="secondary" className="w-full">
                                    <Link to="/admin" onClick={() => setOpen(false)}>
                                        <Shield size={16} />
                                        管理画面（スマホのログイン、パスワード）
                                    </Link>
                                </Button>
                            )}
                        </section>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
