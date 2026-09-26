import { useCallback, useEffect, useRef, useState } from "react"
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
//
// Callers give it a `key` that changes with the endpoint, sort and query,
// so a new listing always starts from a fresh component.
export function InfiniteBookList({ apiEndpoint, sortKey, sortOrder, q, onSeries }: InfiniteBookListProps) {
    const [books, setBooks] = useState<BookEntry[]>([])
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // A request in flight is tracked in a ref, not as an effect dependency:
    // the sentinel scrolling into view must never cancel a running request
    // (that used to leave the list stuck empty and "loading").
    const loading = useRef(false)
    // Bumped on retry and unmount so late responses are ignored. (React's
    // development double-mount also passes through here; clearing the
    // loading flag lets the second mount start its own request.)
    const generation = useRef(0)
    useEffect(() => () => {
        generation.current++
        loading.current = false
    }, [])

    const { ref, inView } = useInView({ rootMargin: "400px 0px" })

    useEffect(() => {
        if (!hasMore || error || loading.current) return
        if (page > 1 && !inView) return

        const gen = generation.current
        loading.current = true
        setIsLoading(true)
        fetch(`${apiEndpoint}?sort=${sortKey}&order=${sortOrder}&page=${page}&q=${q ?? ""}`)
            .then((res) => {
                if (!res.ok) throw new Error(`サーバーがエラーを返しました (${res.status})`)
                return res.json()
            })
            .then((data) => {
                if (gen !== generation.current) return
                setBooks((prev) => [...prev, ...data.books])
                setHasMore(data.hasMore)
                if (page === 1) onSeries?.(data.series ?? null)
                setPage((p) => p + 1)
            })
            .catch((e) => {
                console.error(e)
                if (gen === generation.current) setError(describeError(e))
            })
            .finally(() => {
                if (gen !== generation.current) return
                loading.current = false
                setIsLoading(false)
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inView, page, hasMore, error])

    const retry = useCallback(() => {
        generation.current++
        loading.current = false
        setBooks([])
        setHasMore(true)
        setIsLoading(false)
        setPage(1)
        setError(null)
    }, [])

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
