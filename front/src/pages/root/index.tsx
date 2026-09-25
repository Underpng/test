import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Play } from "lucide-react";
import type { SortKey, SortOrder } from "@/api/interface";
import { InfiniteBookList, type SeriesInfo } from "@/components/infinite_book_list";
import { SortControls } from "@/components/sort-controls";
import { Button } from "@/components/ui/button";
import { viewerUrl } from "@/lib/viewer-url";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";

// Summary strip shown above a series folder: progress and where to resume.
function SeriesHeader({ info }: { info: SeriesInfo }) {
	const pct = info.count > 0 ? Math.round((info.finished / info.count) * 100) : 0;
	const c = info.continue;
	const allRead = !c && info.finished === info.count && info.count > 0;
	return (
		<div className="flex flex-col gap-3 rounded-3xl bg-surface-low px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
			<div className="min-w-0 flex-1">
				<p className="whitespace-nowrap text-sm text-muted-foreground">
					全 {info.count} 巻
					{info.finished > 0 && ` · ${info.finished} 巻読了`}
				</p>
				<div className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-highest">
					<div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
				</div>
			</div>
			{c && (
				<Button asChild className="w-full px-5 sm:w-auto">
					<Link to={viewerUrl(c)}>
						<Play size={16} />
						{c.progress > 0 ? "続きから" : "読み始める"}
						<span className="min-w-0 max-w-[12rem] truncate font-normal opacity-80">{c.title}</span>
					</Link>
				</Button>
			)}
			{allRead && (
				<div className="flex items-center gap-3">
					<Illustration src={illustrations.cheer} size="sm" className="rounded-2xl" />
					<p className="text-sm font-medium text-primary">全巻読了！</p>
				</div>
			)}
		</div>
	);
}

export default function RootPage() {
	const location = useLocation();
	const [sortKey, setSortKey] = useState<SortKey>("title");
	const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
	const [series, setSeries] = useState<SeriesInfo | null>(null);

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

			{series && <SeriesHeader info={series} />}

			<InfiniteBookList
				key={`${apiEndpoint}-${sortKey}-${sortOrder}`}
				apiEndpoint={apiEndpoint}
				sortKey={sortKey}
				sortOrder={sortOrder}
				onSeries={setSeries}
			/>
		</div>
	);
}
