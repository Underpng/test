import { useSearchParams } from "react-router-dom";
import { ComicViewer } from "@/components/viewer/comic";

export function CBRViewerPage() {
    const [params] = useSearchParams();
    const path = params.get("path") ?? "";
    const parsed = parseInt(params.get("position") ?? "", 10);
    const position = isNaN(parsed) || parsed < 1 ? 1 : parsed;

    return <ComicViewer key={path} kind="cbr" path={path} title={params.get("title") ?? ""} initialPage={position} />;
}
