import { useSearchParams } from "react-router-dom";
import { ComicViewer } from "@/components/viewer/comic";

export function CBZViewerPage() {
    const [params] = useSearchParams();
    const path = params.get("path") ?? "";
    const parsed = parseInt(params.get("position") ?? "", 10);
    const position = isNaN(parsed) || parsed < 1 ? 1 : parsed;

    // Keyed by path so moving to the next volume remounts the viewer.
    return <ComicViewer key={path} kind="cbz" path={path} initialPage={position} />;
}
