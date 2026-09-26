import { useState } from "react";
import { Check, Monitor, Moon, Settings, Sun } from "lucide-react";
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

    const changeQuality = (q: Quality) => {
        setQuality(q);
        const o = { ...loadOptions(), quality: q };
        localStorage.setItem("viewerOptions", JSON.stringify(o));
    };

    return (
        <Sheet>
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
                                ? `自動: いまは${icon.remote ? "家の外からの接続なので「おでかけ」" : "家のネットワークなので「おうち」"}です。`
                                : "選んだアイコンをいつも使います。"}
                            ホーム画面のアイコンは追加したときの絵のまま残るので、変えたいときは一度削除してから追加し直してください。
                        </p>
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-sm font-medium">画質（漫画）</h3>
                        <Choice<Quality>
                            label="画質"
                            value={quality}
                            onChange={changeQuality}
                            options={[
                                { value: "auto", label: "自動" },
                                { value: "original", label: "元画像" },
                                { value: "saver", label: "節約" },
                            ]}
                        />
                        <p className="text-xs leading-relaxed text-muted-foreground">
                            自動は、家のネットワークでは元画像、家の外では約半分の通信量の節約画質になります。
                        </p>
                    </section>
                </div>
            </SheetContent>
        </Sheet>
    );
}
