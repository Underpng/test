import type { FullConfig } from "@playwright/test";

// The fixture server scans its library in the background; wait until every
// fixture book is catalogued so tests never see a half-empty shelf.
export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
	if (!baseURL || !process.env.SHELF_FIXTURE) return;
	const expected = 5;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${baseURL}/api/status`);
			if (res.ok) {
				const s = (await res.json()) as { books: number };
				if (s.books >= expected) return;
			}
		} catch {
			// server still starting
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error("fixture library was not scanned in time");
}
