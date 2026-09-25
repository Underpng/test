import { useCallback, useEffect, useState } from "react"
import { useInView } from "react-intersection-observer"
import { BookCard, BookCardSkeleton } from "@/components/bookcard"
import { ErrorCard, describeError } from "@/components/error-card"
import { BookEntry, SortKey, SortOrder } from "@/api/interface"

export type SeriesInfo = {
    title: string
    count: number
    finished: number
    continue?: BookEntry
}

interface InfiniteBookListProps {
    apiEndpoint: string
    sortKey: SortKey
    sortOrder: SortOrder
    q?: string
    // Called with the folder's series summary (first page only), if any.
    onSeries?: (info: SeriesInfo | null) => void
}

const gridClass =
    "grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(152px,1fr))] md:gap-x-4"

// Responsive cover grid that loads the next page when the sentinel at the
// bottom scrolls into view.
export function InfiniteBookList({ apiEndpoint, sortKey, sortOrder, q, onSeries }: InfiniteBookListProps) {
    const [books, setBooks] = useState<BookEntry[]>([])
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)

    const { ref, inView } = useInView({ rootMargin: "400px 0px" })

    useEffect(() => {
        setBooks([])
        setPage(1)
        setHasMore(true)
        setError(null)
    }, [apiEndpoint, sortKey, sortOrder, q, attempt])

    useEffect(() => {
        if (!hasMore || isLoading || error) return
        if (page > 1 && !inView) return

        let cancelled = false
        const load = async () => {
            setIsLoading(true)
            try {
                const res = await fetch(`${apiEndpoint}?sort=${sortKey}&order=${sortOrder}&page=${page}&q=${q ?? ""}`)
                if (!res.ok) throw new Error(`サーバーがエラーを返しました (${res.status})`)
                const data = await res.json()
                if (cancelled) return
                setBooks((prev) => [...prev, ...data.books])
                setHasMore(data.hasMore)
                setPage((p) => p + 1)
                if (page === 1) onSeries?.(data.series ?? null)
            } catch (e) {
                console.error(e)
                if (!cancelled) setError(describeError(e))
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }
        load()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inView, apiEndpoint, sortKey, sortOrder, q, page, hasMore, error])

    const retry = useCallback(() => setAttempt((a) => a + 1), [])

    if (error && books.length === 0) {
        return <ErrorCard detail={error} onRetry={retry} />
    }

    return (
        <div>
            <div className={gridClass}>
                {books.map((book, i) => (
                    <BookCard key={book.path} book={book} layout="grid" index={i} />
                ))}
                {isLoading && books.length === 0 && Array.from({ length: 8 }, (_, i) => <BookCardSkeleton key={i} layout="grid" />)}
            </div>
            {error && books.length > 0 && <ErrorCard className="mt-6" detail={error} onRetry={retry} />}
            {hasMore && !error && (
                <div ref={ref} className="py-8 text-center text-sm text-muted-foreground">
                    {isLoading && books.length > 0 ? "読み込み中…" : ""}
                </div>
            )}
            {!hasMore && books.length === 0 && !isLoading && (
                <p className="py-12 text-center text-muted-foreground">本がありません</p>
            )}
        </div>
    )
}
