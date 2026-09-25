import { useSearchParams } from "react-router-dom";
import { EpubViewer } from "@/components/viewer/epub";

export function EPUBViewerPage() {
    const [params] = useSearchParams();
    const path = params.get("path") ?? "";
    const position = params.get("position") ?? "";

    return <EpubViewer key={path} path={path} title={params.get("title") ?? ""} initialCfi={position || undefined} />;
}
