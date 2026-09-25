import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Illustration } from "@/components/illustration";
import { illustrations } from "@/lib/illustrations";

export default function NotFoundPage() {
	return (
		<div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-12 text-center md:px-8">
			<Illustration src={illustrations.searching} />
			<p className="mt-6 text-sm font-semibold tracking-widest text-primary">404</p>
			<h1 className="mt-1 text-xl font-semibold">ページが見つかりません</h1>
			<p className="mt-2 text-sm text-muted-foreground">URL が古いか、本が移動または削除された可能性があります。</p>
			<Button asChild className="mt-6 px-6">
				<Link to="/">ホームへ</Link>
			</Button>
		</div>
	);
}
