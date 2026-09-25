import { BookEntry } from "@/api/interface";
import { Card, CardContent, CardDescription } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Folder } from "lucide-react"
import { Link } from "react-router-dom";
import { viewerUrl } from "@/lib/viewer-url";

interface BookCardProps {
    book: BookEntry
    index?: number
}

export function BookCard({ book, index }: BookCardProps) {
    const path = viewerUrl(book)
    return (
        <Link to={path}>
            <Card key={index} className="w-[190px] h-[300px] flex-shrink-0">
                <div className="relative">
                    <img
                        src={`/cover${book.cover}`}
                        alt={book.title}
                        className="w-full h-[240px] object-cover rounded-t"
                    />
                    {book.type === "Folder" && (
                        <Folder
                            className="absolute bottom-2 left-1 text-white bg-black bg-opacity-30 rounded p-1"
                            size={32}
                        />
                    )}
                    <Progress
                        value={book.progress * 100.0}
                        className="h-1 absolute bottom-0 left-0 right-0 rounded-none"
                    />
                </div>
                <CardContent className="p-2.5 pt-2">
                    <CardDescription className="line-clamp-2">
                        {book.title}
                    </CardDescription>

                </CardContent>
            </Card>
        </Link>
    )
}

