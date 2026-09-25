import { ArrowDownAZ, ArrowUpZA } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SortKey, SortOrder } from "@/api/interface";

const sortOptions: { label: string; value: SortKey }[] = [
    { label: "タイトル順", value: "title" },
    { label: "追加日", value: "added_time" },
    { label: "最近開いた", value: "last_opened" },
    { label: "進捗", value: "progress" },
];

type Props = {
    sortKey: SortKey;
    sortOrder: SortOrder;
    onChange: (sortKey: SortKey, sortOrder: SortOrder) => void;
};

export function SortControls({ sortKey, sortOrder, onChange }: Props) {
    return (
        <div className="flex items-center gap-2">
            <Select value={sortKey} onValueChange={(v) => onChange(v as SortKey, sortOrder)}>
                <SelectTrigger className="h-10 w-[140px] rounded-full border-0 bg-surface-high" aria-label="並び替え">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {sortOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <button
                type="button"
                onClick={() => onChange(sortKey, sortOrder === "asc" ? "desc" : "asc")}
                aria-label={sortOrder === "asc" ? "昇順（タップで降順）" : "降順（タップで昇順）"}
                title={sortOrder === "asc" ? "昇順" : "降順"}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-high text-foreground hover:bg-surface-highest"
            >
                {sortOrder === "asc" ? <ArrowDownAZ size={20} /> : <ArrowUpZA size={20} />}
            </button>
        </div>
    );
}
