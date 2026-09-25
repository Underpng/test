import { BookEntry } from "@/api/interface";

// Builds the in-app URL that opens a book (or folder) from the shelf.
// `position` overrides the saved reading position when given.
export function viewerUrl(book: BookEntry, position?: string): string {
    const path = encodeURIComponent(book.path);
    const title = encodeURIComponent(book.title ?? "");
    const pos = encodeURIComponent(position ?? book.currentPosition ?? "");

    switch (book.type) {
        case "PDF":
        case "EPUB":
        case "CBZ":
        case "CBR":
            return `/viewer/${book.type.toLowerCase()}?title=${title}&path=${path}&position=${pos}`;
        case "Folder":
            return `/root${book.path}`;
        default:
            console.warn("Unknown book type:", book.type);
            return "/";
    }
}

// Where to start when continuing into another volume: a finished (or never
// opened) book starts from the beginning, otherwise resume where it was left.
export function continuePosition(book: BookEntry): string {
    if (!book.currentPosition || book.progress >= 0.98) return "";
    return book.currentPosition;
}
