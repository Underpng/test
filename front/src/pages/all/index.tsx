import { useState } from "react";
import type { SortKey, SortOrder } from "@/api/interface";
import { InfiniteBookList } from "@/components/infinite_book_list";
import { SortControls } from "@/components/sort-controls";

export default function AllPage() {
	const [sortKey, setSortKey] = useState<SortKey>("title");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

	return (
		<div className="mx-auto max-w-6xl space-y-5 px-4 py-4 md:px-8 md:py-8">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="flex-1 text-2xl font-semibold md:text-3xl">すべての本</h1>
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
				apiEndpoint="/api/all"
				sortKey={sortKey}
				sortOrder={sortOrder}
			/>
		</div>
	);
}
