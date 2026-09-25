import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { BookCard } from "@/components/bookcard"
import { Button } from "@/components/ui/button"
import { BookEntry } from "@/api/interface"
import { viewerUrl } from "@/lib/viewer-url"

type HomeData = {
	reading: BookEntry[]
	next: BookEntry[]
	arrivals: BookEntry[]
}

function seriesName(book: BookEntry): string {
	const parts = book.path.split("/").filter(Boolean)
	return parts.length >= 2 ? parts[parts.length - 2] : ""
}

function folderUrl(book: BookEntry): string {
	const parts = book.path.split("/").filter(Boolean)
	return "/root/" + parts.slice(0, -1).map(encodeURIComponent).join("/")
}

// Big "continue" card at the top, like a reading app's resume banner.
function ContinueCard({ book }: { book: BookEntry }) {
	const pct = Math.round(book.progress * 100)
	const series = seriesName(book)
	return (
		<section className="flex gap-4 rounded-3xl bg-surface-low p-4 md:gap-6 md:p-6">
			<Link to={viewerUrl(book)} className="w-28 flex-shrink-0 md:w-36">
				<div className="aspect-[2/3] overflow-hidden rounded-xl bg-surface-high shadow-md">
					{book.cover && <img src={`/cover${book.cover}`} alt="" className="h-full w-full object-cover" />}
				</div>
			</Link>
			<div className="flex min-w-0 flex-1 flex-col">
				<p className="text-xs font-medium text-primary">続きから読む</p>
				<h2 className="mt-1 line-clamp-2 text-lg font-semibold leading-snug md:text-2xl">{book.title}</h2>
				{series && (
					<Link to={folderUrl(book)} className="mt-1 flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
						{series}
						<ChevronRight size={14} />
					</Link>
				)}
				<div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-highest">
					<div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
				</div>
				<p className="mt-1 text-xs text-muted-foreground">{pct}%</p>
				<div className="mt-auto pt-3">
					<Button asChild className="px-6">
						<Link to={viewerUrl(book)}>続きを読む</Link>
					</Button>
				</div>
			</div>
		</section>
	)
}

function Shelf({ title, books, hint }: { title: string; books: BookEntry[]; hint?: string }) {
	if (books.length === 0) return null
	return (
		<section>
			<div className="mb-3 flex items-baseline gap-3">
				<h2 className="text-lg font-semibold">{title}</h2>
				{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
			</div>
			<div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:-mx-8 md:gap-4 md:px-8">
				{books.map((book) => (
					<BookCard key={book.path} book={book} />
				))}
			</div>
		</section>
	)
}

export default function HomePage() {
	const [data, setData] = useState<HomeData | null>(null)

	useEffect(() => {
		fetch("/api/home")
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
			.then((d: HomeData) => setData(d))
			.catch((e) => console.error("Failed to load home", e))
	}, [])

	const empty = data && data.reading.length === 0 && data.next.length === 0 && data.arrivals.length === 0
	const current = data?.reading[0]
	const rest = data?.reading.slice(1) ?? []

	return (
		<div className="mx-auto max-w-6xl space-y-8 px-4 py-4 md:px-8 md:py-8">
			<h1 className="text-2xl font-semibold md:text-3xl">ホーム</h1>
			{data && (
				<>
					{current && <ContinueCard book={current} />}
					<Shelf title="読みかけ" books={rest} />
					<Shelf title="次の巻" books={data.next} hint="読み終えた巻の続き" />
					<Shelf title="新着" books={data.arrivals} />
				</>
			)}
			{empty && (
				<div className="rounded-3xl bg-surface-low p-8 text-center text-muted-foreground">
					<p>まだ本がありません。</p>
					<p className="mt-1 text-sm">books フォルダに CBZ / CBR / EPUB / PDF を入れると、数分以内にここに並びます。</p>
				</div>
			)}
		</div>
	)
}
