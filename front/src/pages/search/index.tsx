import { useEffect, useState } from "react"
import { Search, X } from "lucide-react"
import type { SortKey, SortOrder } from "@/api/interface"
import { InfiniteBookList } from "@/components/infinite_book_list"
import { SortControls } from "@/components/sort-controls"

export default function SearchPage() {
	const [sortKey, setSortKey] = useState<SortKey>("title")
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc")
	const [text, setText] = useState("")
	const [query, setQuery] = useState("")

	// Search as you type, lightly debounced.
	useEffect(() => {
		const t = window.setTimeout(() => setQuery(text.trim()), 250)
		return () => window.clearTimeout(t)
	}, [text])

	return (
		<div className="mx-auto max-w-6xl space-y-5 px-4 py-4 md:px-8 md:py-8">
			<h1 className="text-2xl font-semibold md:text-3xl">検索</h1>
			<div className="flex flex-wrap items-center gap-3">
				<label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-surface-high px-4 focus-within:ring-2 focus-within:ring-ring">
					<Search size={20} className="flex-shrink-0 text-muted-foreground" />
					<input
						type="search"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="タイトルの先頭、または #著者名"
						autoFocus
						enterKeyHint="search"
						className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
					/>
					{text && (
						<button type="button" onClick={() => setText("")} aria-label="クリア" className="text-muted-foreground">
							<X size={18} />
						</button>
					)}
				</label>
				<SortControls
					sortKey={sortKey}
					sortOrder={sortOrder}
					onChange={(k, o) => {
						setSortKey(k)
						setSortOrder(o)
					}}
				/>
			</div>

			{query ? (
				<InfiniteBookList
					key={`${query}-${sortKey}-${sortOrder}`}
					apiEndpoint="/api/search"
					sortKey={sortKey}
					sortOrder={sortOrder}
					q={encodeURIComponent(query)}
				/>
			) : (
				<p className="py-12 text-center text-sm text-muted-foreground">
					タイトルの先頭文字で探せます。EPUB や PDF は「#著者名」「#タグ」でも検索できます。
				</p>
			)}
		</div>
	)
}
