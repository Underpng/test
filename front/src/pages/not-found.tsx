import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
	return (
		<div className="mx-auto max-w-6xl px-4 py-16 text-center md:px-8">
			<p className="text-6xl font-semibold text-primary">404</p>
			<h1 className="mt-3 text-xl font-semibold">ページが見つかりません</h1>
			<p className="mt-2 text-sm text-muted-foreground">URL が古いか、本が移動または削除された可能性があります。</p>
			<Button asChild className="mt-6 px-6">
				<Link to="/">ホームへ</Link>
			</Button>
		</div>
	);
}
