// Light / dark theme: follows the OS unless the user picked one.

export type ThemeSetting = "system" | "light" | "dark";

const KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeSetting(): ThemeSetting {
    try {
        const v = localStorage.getItem(KEY);
        if (v === "light" || v === "dark") return v;
    } catch {
        // storage may be unavailable (private mode)
    }
    return "system";
}

export function isDark(setting: ThemeSetting = getThemeSetting()): boolean {
    return setting === "dark" || (setting === "system" && media().matches);
}

export function applyTheme(setting: ThemeSetting = getThemeSetting()) {
    document.documentElement.classList.toggle("dark", isDark(setting));
}

export function setThemeSetting(setting: ThemeSetting) {
    try {
        if (setting === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, setting);
    } catch {
        // ignore
    }
    applyTheme(setting);
}

// Call once at startup: applies the theme and tracks OS changes.
export function initTheme() {
    applyTheme();
    media().addEventListener("change", () => {
        if (getThemeSetting() === "system") applyTheme("system");
    });
}
