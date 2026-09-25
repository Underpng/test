import { test, expect, type Page } from "@playwright/test";

type Book = {
	type: string;
	path: string;
	cover: string;
	title: string;
};

// Walk the library through the API until a CBZ is found.
async function findFirstCbz(page: Page): Promise<Book | null> {
	const queue = ["/"];
	while (queue.length > 0) {
		const folder = queue.shift()!;
		const res = await page.request.get(`/api/root${folder}`);
		expect(res.ok()).toBeTruthy();
		const body = (await res.json()) as { books: Book[] };
		for (const b of body.books) {
			if (b.type === "CBZ") return b;
			if (b.type === "Folder") queue.push(b.path);
		}
	}
	return null;
}

test("home page renders", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
	// Navigation is a bottom bar on phones and a rail on desktop; both carry the same links.
	await expect(page.getByRole("link", { name: "本棚" })).toBeVisible();
});

test("root lists the library", async ({ page }) => {
	const res = await page.request.get("/api/root/");
	expect(res.ok()).toBeTruthy();
	const body = (await res.json()) as { books: Book[] };
	expect(Array.isArray(body.books)).toBeTruthy();
});

test("cbz viewer shows a page image", async ({ page }) => {
	const book = await findFirstCbz(page);
	test.skip(book === null, "no CBZ in the library");

	const url = `/viewer/cbz?title=${encodeURIComponent(book!.title)}&path=${encodeURIComponent(book!.path)}&position=`;
	await page.goto(url);

	const img = page.locator("img").first();
	await expect(img).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 })
		.toBeGreaterThan(0);
});
