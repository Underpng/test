import { useEffect, useState } from "react"
import { CloudDownload, HardDrive, ShieldAlert } from "lucide-react"
import { BookCard } from "@/components/bookcard"
import { formatBytes, offlineSupported, setSaveQuality, storageEstimate, useOffline, type SaveQuality } from "@/lib/offline"

// Books kept on this device for reading without a connection.
export default function SavedPage() {
	const { saved, downloads, quality } = useOffline()
	const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
	const books = Object.values(saved).sort((a, b) => b.savedAt - a.savedAt)
	const total = books.reduce((n, s) => n + s.bytes, 0)

	useEffect(() => {
		storageEstimate().then(setEstimate)
	}, [books.length, Object.keys(downloads).length])

	return (
		<div className="mx-auto max-w-6xl space-y-6 px-4 py-4 md:px-8 md:py-8">
			<h1 className="text-2xl font-semibold md:text-3xl">この端末に保存</h1>

			{!offlineSupported() ? (
				<section className="space-y-3 rounded-3xl bg-surface-low p-5 text-sm leading-relaxed" data-testid="offline-unsupported">
					<h2 className="flex items-center gap-2 text-base font-medium">
						<ShieldAlert size={18} className="text-primary" />
						いまの接続では保存できません
					</h2>
					<p className="text-muted-foreground">
						本を端末に保存する機能は、ブラウザーの決まりで https のアドレスで開いたときにしか使えません。いまは{" "}
						<span className="font-mono text-foreground">{location.origin}</span> で開いています。
					</p>
					<p className="text-muted-foreground">
						Tailscale を使っている場合は、PC で <span className="font-mono text-foreground">tailscale serve --bg 50080</span>{" "}
						を実行すると https のアドレスができます。そのアドレスを開いてホーム画面に追加すると、保存できるようになります。
					</p>
				</section>
			) : (
				<>
					<section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl bg-surface-low p-4 text-sm">
						<div className="flex items-center gap-2">
							<HardDrive size={18} className="text-primary" />
							<span>
								保存した本 <span className="font-semibold tabular-nums">{formatBytes(total)}</span>
								{estimate && estimate.quota > 0 && (
									<span className="text-muted-foreground"> ／ 使える容量 約 {formatBytes(estimate.quota)}</span>
								)}
							</span>
						</div>
						<div className="flex items-center gap-2" role="radiogroup" aria-label="保存する画質">
							<span className="text-muted-foreground">保存する画質</span>
							{(["saver", "original"] as SaveQuality[]).map((q) => (
								<button
									key={q}
									type="button"
									role="radio"
									aria-checked={quality === q}
									onClick={() => setSaveQuality(q)}
									className={`rounded-full px-3 py-1 transition-colors ${quality === q ? "bg-primary-container font-medium text-primary-container-foreground" : "bg-surface-high"}`}
								>
									{q === "saver" ? "セーブ（容量小）" : "クオリティ"}
								</button>
							))}
						</div>
					</section>

					{books.length === 0 ? (
						<div className="flex flex-col items-center rounded-3xl bg-surface-low p-8 text-center text-muted-foreground">
							<CloudDownload size={40} className="mb-4 text-primary" />
							<p className="font-medium text-foreground">保存した本はまだありません。</p>
							<p className="mt-1 text-sm">本の表紙を長押し（または ⋮ ボタン）して「この端末に保存」を選ぶと、通信なしでも読めます。</p>
						</div>
					) : (
						<div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6" data-testid="saved-list">
							{books.map((s, i) => {
								const dl = downloads[s.book.path]
								return (
									<div key={s.book.path}>
										<BookCard book={s.book} layout="grid" index={i} />
										{dl ? (
											<p className={`mt-0.5 text-[11px] ${dl.error ? "text-destructive" : "text-muted-foreground"}`}>
												{dl.error ?? `保存中 ${dl.total ? Math.round((dl.done / dl.total) * 100) : 0}%`}
											</p>
										) : !s.complete ? (
											<p className="mt-0.5 text-[11px] text-muted-foreground">途中まで保存（長押しで再開）</p>
										) : (
											<p className="mt-0.5 text-[11px] text-muted-foreground">{formatBytes(s.bytes)}</p>
										)}
									</div>
								)
							})}
						</div>
					)}
				</>
			)}
		</div>
	)
}
