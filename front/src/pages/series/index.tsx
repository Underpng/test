import { useState } from "react";
import type { SortKey, SortOrder } from "@/api/interface";
import { InfiniteBookList } from "@/components/infinite_book_list";
import { SortControls } from "@/components/sort-controls";

// Every series (a folder holding volumes) regardless of how deep it sits.
export default function SeriesPage() {
	const [sortKey, setSortKey] = useState<SortKey>("last_opened");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	return (
		<div className="mx-auto max-w-6xl space-y-5 px-4 py-4 md:px-8 md:py-8">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="flex-1 text-2xl font-semibold md:text-3xl">シリーズ</h1>
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
				key={`${sortKey}-${sortOrder}`}
				apiEndpoint="/api/series"
				sortKey={sortKey}
				sortOrder={sortOrder}
			/>
		</div>
	);
}
