import { useState } from "react";
import { NavLink } from "react-router-dom";
import { BookOpenText, Home, Layers, LibraryBig, Monitor, Moon, Search, Sun } from "lucide-react";
import { getThemeSetting, setThemeSetting, type ThemeSetting } from "@/lib/theme";

const items = [
    { to: "/", label: "ホーム", icon: Home, end: true },
    { to: "/root", label: "本棚", icon: LibraryBig, end: false },
    { to: "/series", label: "シリーズ", icon: Layers, end: false },
    { to: "/search", label: "検索", icon: Search, end: false },
];

// Material 3 navigation: icon inside a pill that fills when active.
function Item({ to, label, icon: Icon, end, vertical }: (typeof items)[number] & { vertical: boolean }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                `group flex flex-col items-center gap-1 ${vertical ? "w-full py-2" : "flex-1 py-2"} text-[12px] ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"}`
            }
        >
            {({ isActive }) => (
                <>
                    <span
                        className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${isActive ? "bg-primary-container text-primary-container-foreground" : "group-hover:bg-surface-high"}`}
                    >
                        <Icon size={22} strokeWidth={isActive ? 2.4 : 2} />
                    </span>
                    {label}
                </>
            )}
        </NavLink>
    );
}

const themeCycle: ThemeSetting[] = ["system", "light", "dark"];
const themeLabel: Record<ThemeSetting, string> = { system: "テーマ: OS に合わせる", light: "テーマ: ライト", dark: "テーマ: ダーク" };

export function ThemeToggle({ className = "" }: { className?: string }) {
    const [setting, setSetting] = useState<ThemeSetting>(getThemeSetting);
    const Icon = setting === "light" ? Sun : setting === "dark" ? Moon : Monitor;
    const next = () => {
        const n = themeCycle[(themeCycle.indexOf(setting) + 1) % themeCycle.length];
        setThemeSetting(n);
        setSetting(n);
    };
    return (
        <button
            type="button"
            onClick={next}
            title={themeLabel[setting]}
            aria-label={themeLabel[setting]}
            className={`flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-high ${className}`}
        >
            <Icon size={20} />
        </button>
    );
}

// Phone: bar along the bottom edge.
export function BottomNav() {
    return (
        <nav
            aria-label="メインナビゲーション"
            className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-surface-low md:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
            {items.map((it) => (
                <Item key={it.to} {...it} vertical={false} />
            ))}
        </nav>
    );
}

// Desktop: rail on the left.
export function NavRail() {
    return (
        <nav
            aria-label="メインナビゲーション"
            className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center gap-1 bg-surface-low pb-4 pt-5 md:flex"
        >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-container text-primary-container-foreground">
                <BookOpenText size={22} />
            </div>
            {items.map((it) => (
                <Item key={it.to} {...it} vertical={true} />
            ))}
            <ThemeToggle className="mt-auto" />
        </nav>
    );
}

// Phone: slim top bar with the app mark and theme toggle.
export function TopBar() {
    return (
        <header
            className="sticky top-0 z-30 flex h-14 items-center justify-between bg-background/85 px-4 backdrop-blur md:hidden"
            style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
        >
            <div className="flex items-center gap-2 font-semibold">
                <BookOpenText size={20} className="text-primary" />
                shelf
            </div>
            <ThemeToggle />
        </header>
    );
}
