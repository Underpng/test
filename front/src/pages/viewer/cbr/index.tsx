import { useSearchParams } from "react-router-dom";
import { ComicViewer } from "@/components/viewer/comic";
import { LAST_PAGE } from "@/lib/viewer-url";

export function CBRViewerPage() {
    const [params] = useSearchParams();
    const path = params.get("path") ?? "";
    const raw = params.get("position") ?? "";
    const parsed = parseInt(raw, 10);
    const position = isNaN(parsed) || parsed < 1 ? 1 : parsed;
    const atEnd = raw === LAST_PAGE;

    return <ComicViewer key={path} kind="cbr" path={path} title={params.get("title") ?? ""} initialPage={position} startAtEnd={atEnd} />;
}
