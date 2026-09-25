type BookType = "EPUB" | "PDF" | "CBZ" | "CBR" | "Folder" | "Series";

export interface BookEntry {
    type: BookType;
    path: string;           // path to book or folder
    cover: string;      // path to cover img
    title: string;
    currentPosition: string; // CFI or folio
    progress: number;       // 0..1
    count?: number;         // Series: number of volumes
    finished?: number;      // Series: volumes read
}
export type SortKey = "title" | "added_time" | "last_opened" | "progress";

export type SortOrder = "asc" | "desc";