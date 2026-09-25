import { useEffect, useState } from "react"
import { useInView } from "react-intersection-observer"
import { BookCard } from "@/components/bookcard"
import { BookEntry, SortKey, SortOrder } from "@/api/interface"

interface InfiniteBookListProps {
    apiEndpoint: string
    sortKey: SortKey
    sortOrder: SortOrder
    q?: string
}

// Responsive cover grid that loads the next page when the sentinel at the
// bottom scrolls into view.
export function InfiniteBookList({ apiEndpoint, sortKey, sortOrder, q }: InfiniteBookListProps) {
    const [books, setBooks] = useState<BookEntry[]>([])
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const [isLoading, setIsLoading] = useState(false)

    const { ref, inView } = useInView({ rootMargin: "400px 0px" })

    useEffect(() => {
        setBooks([])
        setPage(1)
        setHasMore(true)
    }, [apiEndpoint, sortKey, sortOrder, q])

    useEffect(() => {
        if (!hasMore || isLoading) return
        if (page > 1 && !inView) return

        let cancelled = false
        const load = async () => {
            setIsLoading(true)
            try {
                const res = await fetch(`${apiEndpoint}?sort=${sortKey}&order=${sortOrder}&page=${page}&q=${q ?? ""}`)
                if (!res.ok) throw new Error("Failed to fetch books")
                const data = await res.json()
                if (cancelled) return
                setBooks((prev) => [...prev, ...data.books])
                setHasMore(data.hasMore)
                setPage((p) => p + 1)
            } catch (e) {
                console.error(e)
                if (!cancelled) setHasMore(false)
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }
        load()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inView, apiEndpoint, sortKey, sortOrder, q, page, hasMore])

    return (
        <div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] md:gap-x-4">
                {books.map((book) => (
                    <BookCard key={book.path} book={book} layout="grid" />
                ))}
            </div>
            {hasMore && (
                <div ref={ref} className="py-8 text-center text-sm text-muted-foreground">
                    {isLoading ? "読み込み中…" : ""}
                </div>
            )}
            {!hasMore && books.length === 0 && !isLoading && (
                <p className="py-12 text-center text-muted-foreground">本がありません</p>
            )}
        </div>
    )
}
