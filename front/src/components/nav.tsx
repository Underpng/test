import { NavLink } from "react-router-dom";
import { Home, Layers, LibraryBig, Search } from "lucide-react";
import { SettingsButton } from "@/components/settings-sheet";
import { iconUrl, useAppIcon } from "@/lib/appicon";

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

// The app mark follows the chosen (or automatic) mascot icon.
function Logo({ className }: { className: string }) {
    const { variant } = useAppIcon();
    return (
        <img
            key={variant}
            src={iconUrl(variant, "favicon.png")}
            alt="shelf"
            data-testid="app-logo"
            data-variant={variant}
            className={`animate-in fade-in zoom-in-90 duration-300 motion-reduce:animate-none ${className}`}
        />
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
            <Logo className="mb-4 h-11 w-11 rounded-2xl shadow-sm" />
            {items.map((it) => (
                <Item key={it.to} {...it} vertical={true} />
            ))}
            <SettingsButton className="mt-auto" />
        </nav>
    );
}

// Phone: slim top bar with the app mark and the settings button.
export function TopBar() {
    return (
        <header
            className="sticky top-0 z-30 flex h-14 items-center justify-between bg-background/85 px-4 backdrop-blur md:hidden"
            style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
        >
            <div className="flex items-center gap-2 font-semibold">
                <Logo className="h-7 w-7 rounded-lg" />
                shelf
            </div>
            <SettingsButton />
        </header>
    );
}
