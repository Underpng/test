import { useEffect, useState } from "react"
import { BookCard } from "@/components/bookcard"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { BookEntry } from "@/api/interface"

type HomeData = {
	reading: BookEntry[]
	next: BookEntry[]
	arrivals: BookEntry[]
}

function Shelf({ title, books, hint }: { title: string; books: BookEntry[]; hint?: string }) {
	if (books.length === 0) return null
	return (
		<section className="space-y-2">
			<h2 className="text-xl font-medium">{title}</h2>
			{hint && <p className="text-sm text-muted-foreground">{hint}</p>}
			<ScrollArea className="w-full">
				<div className="inline-flex gap-4">
					{books.map((book) => (
						<BookCard key={book.path} book={book} />
					))}
				</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>
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

	return (
		<div className="min-w-0 w-full flex-1 overflow-x-hidden p-6 space-y-6">
			<h1 className="text-2xl font-semibold">ホーム</h1>
			{data && (
				<>
					<Shelf title="続きを読む" books={data.reading} />
					<Shelf title="次の巻" books={data.next} hint="読み終えた巻の続きです" />
					<Shelf title="新着" books={data.arrivals} />
				</>
			)}
			{empty && <p className="text-muted-foreground">books フォルダに本を入れると、ここに表示されます。</p>}
		</div>
	)
}
