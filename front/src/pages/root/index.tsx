import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { SortKey, SortOrder } from "@/api/interface";
import { InfiniteBookList } from "@/components/infinite_book_list";
import { SortControls } from "@/components/sort-controls";

export default function RootPage() {
	const location = useLocation();
	const [sortKey, setSortKey] = useState<SortKey>("title");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

	// "/root/A/B" -> ["A", "B"]
	const segments = location.pathname
		.replace(/^\/root\/?/, "")
		.split("/")
		.filter(Boolean)
		.map(decodeURIComponent);
	const title = segments.length > 0 ? segments[segments.length - 1] : "本棚";
	const apiEndpoint = `/api${location.pathname}`;

	return (
		<div className="mx-auto max-w-6xl space-y-5 px-4 py-4 md:px-8 md:py-8">
			{segments.length > 0 && (
				<nav aria-label="パンくず" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
					<Link to="/root" className="hover:text-foreground">本棚</Link>
					{segments.slice(0, -1).map((seg, i) => (
						<span key={i} className="flex items-center gap-1">
							<ChevronRight size={14} />
							<Link to={"/root/" + segments.slice(0, i + 1).map(encodeURIComponent).join("/")} className="hover:text-foreground">
								{seg}
							</Link>
						</span>
					))}
				</nav>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="min-w-0 flex-1 truncate text-2xl font-semibold md:text-3xl">{title}</h1>
				<SortControls
					sortKey={sortKey}
					sortOrder={sortOrder}
					onChange={(k, o) => {
						setSortKey(k);
						setSortOrder(o);
					}}
				/>
			</div>

			<InfiniteBookList
				key={`${apiEndpoint}-${sortKey}-${sortOrder}`}
				apiEndpoint={apiEndpoint}
				sortKey={sortKey}
				sortOrder={sortOrder}
			/>
		</div>
	);
}
