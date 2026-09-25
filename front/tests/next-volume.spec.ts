import { test, expect, type Page } from "@playwright/test";

type Book = { type: string; path: string; cover: string; title: string };

// Finds a folder holding at least two CBZ files and returns the first two
// in the order the server reports for neighbours.
async function findSeries(page: Page): Promise<[Book, Book] | null> {
	const queue = ["/"];
	while (queue.length > 0) {
		const folder = queue.shift()!;
		const res = await page.request.get(`/api/root${folder}`);
		expect(res.ok()).toBeTruthy();
		const body = (await res.json()) as { books: Book[] };
		const cbz = body.books.filter((b) => b.type === "CBZ");
		if (cbz.length >= 2) {
			const n = await page.request.get(`/api/neighbors?path=${encodeURIComponent(cbz[0].path)}`);
			const nb = (await n.json()) as { next: Book | null };
			if (nb.next) return [cbz[0], nb.next];
		}
		for (const b of body.books) if (b.type === "Folder") queue.push(b.path);
	}
	return null;
}

test("last page offers the next volume and opens it", async ({ page }) => {
	const series = await findSeries(page);
	test.skip(series === null, "needs a folder with two CBZ files");
	const [first, second] = series!;

	const pagesRes = await page.request.get(`/book/cbz/pages?path=${encodeURIComponent(first.path)}`);
	const { pages } = (await pagesRes.json()) as { pages: number };

	await page.goto(`/viewer/cbz?title=${encodeURIComponent(first.title)}&path=${encodeURIComponent(first.path)}&position=${pages}`);
	const img = page.locator("img").first();
	await expect(img).toBeVisible({ timeout: 20_000 });

	// Stepping past the final page shows the end-of-book card.
	await page.keyboard.press("ArrowRight");
	const card = page.getByTestId("end-of-book");
	await expect(card).toBeVisible();
	await expect(card.getByText("次の巻", { exact: true })).toBeVisible();
	await expect(card.getByText(second.title)).toBeVisible();

	// Continue reading: the viewer now shows the next volume from page 1.
	await card.getByRole("button", { name: /続けて読む/ }).click();
	await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(second.path);
	await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId("end-of-book")).toHaveCount(0);
});

test("first page offers the previous volume", async ({ page }) => {
	const series = await findSeries(page);
	test.skip(series === null, "needs a folder with two CBZ files");
	const [first, second] = series!;

	await page.goto(`/viewer/cbz?title=${encodeURIComponent(second.title)}&path=${encodeURIComponent(second.path)}&position=1`);
	await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });

	await page.keyboard.press("ArrowLeft");
	const card = page.getByTestId("end-of-book");
	await expect(card).toBeVisible();
	await expect(card.getByText("前の巻", { exact: true })).toBeVisible();
	await expect(card.getByText(first.title)).toBeVisible();

	// Closing the card resumes reading.
	await card.getByRole("button", { name: "閉じる" }).click();
	await expect(card).toHaveCount(0);
});
