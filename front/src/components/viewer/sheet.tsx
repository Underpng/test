import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from "@/components/ui/select"
import {
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

export type Direction = "ltr" | "rtl"
// "auto" shows spreads only while the screen is landscape.
export type SpreadSetting = "auto" | "none" | "odd" | "even"
export type Spread = "none" | "odd" | "even"

export type ViewerOptions = {
    direction: Direction
    spread: SpreadSetting
    fontSize: number
}

const defaults: ViewerOptions = { direction: "rtl", spread: "auto", fontSize: 16 }

// loadOptions reads the saved reader options, filling gaps with defaults.
export function loadOptions(): ViewerOptions {
    try {
        const saved = localStorage.getItem("viewerOptions")
        if (!saved) return defaults
        const parsed = JSON.parse(saved) as Partial<ViewerOptions>
        return {
            direction: parsed.direction === "ltr" ? "ltr" : "rtl",
            spread: (["auto", "none", "odd", "even"] as const).includes(parsed.spread as SpreadSetting)
                ? (parsed.spread as SpreadSetting)
                : "auto",
            fontSize: typeof parsed.fontSize === "number" ? parsed.fontSize : 16,
        }
    } catch {
        return defaults
    }
}

// resolveSpread turns the setting into a concrete mode for the current
// orientation. "even" (cover alone, then pairs) is how manga is printed.
export function resolveSpread(setting: SpreadSetting, landscape: boolean): Spread {
    if (setting === "auto") return landscape ? "even" : "none"
    return setting
}

type ViewerOptionSheetProps = {
    onOptionChanged?: (options: ViewerOptions) => void
}

export function ViewerOptionSheet({ onOptionChanged }: ViewerOptionSheetProps) {
    const [options, setOptions] = useState<ViewerOptions>(defaults)
    const [fontSizeText, setFontSizeText] = useState("16")

    useEffect(() => {
        const o = loadOptions()
        setOptions(o)
        setFontSizeText(String(o.fontSize))
    }, [])

    const update = (next: Partial<ViewerOptions>) => {
        const updated = { ...options, ...next }
        setOptions(updated)
        onOptionChanged?.(updated)
        localStorage.setItem("viewerOptions", JSON.stringify(updated))
    }

    return (
        <SheetContent>
            <SheetHeader>
                <SheetTitle>表示設定</SheetTitle>
            </SheetHeader>

            <div className="grid flex-1 auto-rows-min gap-6 px-4 pt-6">
                <div className="flex items-center justify-between">
                    <Label htmlFor="direction-switch">右綴じ（右から左へめくる）</Label>
                    <Switch
                        id="direction-switch"
                        checked={options.direction === "rtl"}
                        onCheckedChange={(v) => update({ direction: v ? "rtl" : "ltr" })}
                    />
                </div>

                <div className="grid gap-3">
                    <Label htmlFor="spread-select">見開き（漫画・PDF）</Label>
                    <Select value={options.spread} onValueChange={(v) => update({ spread: v as SpreadSetting })}>
                        <SelectTrigger id="spread-select">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="auto">自動（横向きのときだけ見開き）</SelectItem>
                            <SelectItem value="none">常に単ページ</SelectItem>
                            <SelectItem value="even">見開き（表紙は単独）</SelectItem>
                            <SelectItem value="odd">見開き（1ページ目から組む）</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid gap-3">
                    <Label htmlFor="font-size">文字サイズ（EPUB のみ）</Label>
                    <Input
                        id="font-size"
                        type="number"
                        min={8}
                        max={48}
                        value={fontSizeText}
                        onChange={(e) => setFontSizeText(e.target.value)}
                        onBlur={() => {
                            const n = parseInt(fontSizeText, 10)
                            if (!isNaN(n) && n >= 8 && n <= 48) update({ fontSize: n })
                            else setFontSizeText(String(options.fontSize))
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur()
                        }}
                    />
                </div>
            </div>
        </SheetContent>
    )
}
