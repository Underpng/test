import { test, expect, type Page } from "@playwright/test";

type Book = { type: string; path: string; cover: string; title: string };

async function findEpubs(page: Page): Promise<Book[]> {
	const res = await page.request.get("/api/all?sort=title&order=asc");
	const body = (await res.json()) as { books: Book[] };
	return body.books.filter((b) => b.type === "EPUB");
}

test.describe("epub viewer", () => {
	test("renders, turns pages and reaches the next volume", async ({ page }) => {
		const epubs = await findEpubs(page);
		test.skip(epubs.length < 2, "needs two EPUBs in one folder");
		const [first, second] = epubs;

		await page.goto(`/viewer/epub?title=${encodeURIComponent(first.title)}&path=${encodeURIComponent(first.path)}&position=`);
		const frame = page.frameLocator("iframe").first();
		await expect(frame.getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });

		const indicator = page.getByTestId("page-indicator");
		const before = await indicator.textContent();

		// Space is "next" regardless of reading direction.
		await page.keyboard.press("Space");
		await expect.poll(async () => indicator.textContent(), { timeout: 10_000 }).not.toBe(before);

		// Keep going until the end-of-book card appears (short chapters).
		const card = page.getByTestId("end-of-book");
		for (let i = 0; i < 60 && !(await card.isVisible()); i++) {
			await page.keyboard.press("Space");
			await page.waitForTimeout(120);
		}
		await expect(card).toBeVisible();
		await expect(card.getByText(second.title)).toBeVisible();

		await card.getByRole("button", { name: /続けて読む/ }).click();
		await expect.poll(() => new URL(page.url()).searchParams.get("path")).toBe(second.path);
		await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });
	});

	test("resumes from the saved position", async ({ page }) => {
		const epubs = await findEpubs(page);
		test.skip(epubs.length === 0, "needs an EPUB");
		const book = epubs[0];

		await page.goto(`/viewer/epub?title=x&path=${encodeURIComponent(book.path)}&position=`);
		await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });
		// Jump forward a few pages and let the progress save.
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press("Space");
			await page.waitForTimeout(150);
		}
		await page.waitForTimeout(800);

		const res = await page.request.get(`/api/all?sort=title&order=asc`);
		const saved = ((await res.json()) as { books: (Book & { currentPosition: string })[] }).books.find((b) => b.path === book.path)!;
		expect(saved.currentPosition).toMatch(/^epubcfi\(/);

		// Opening with that position lands on the same chapter, not chapter 1.
		await page.goto(`/viewer/epub?title=x&path=${encodeURIComponent(book.path)}&position=${encodeURIComponent(saved.currentPosition)}`);
		await expect(page.getByTestId("epub-gesture-layer")).toBeVisible();
		await expect.poll(async () => page.getByTestId("page-indicator").textContent(), { timeout: 15_000 }).not.toMatch(/^1 \/ /);
	});

	test("tap on the gesture layer turns the page (no touch reaches the iframe)", async ({ page }) => {
		const epubs = await findEpubs(page);
		test.skip(epubs.length === 0, "needs an EPUB");
		await page.goto(`/viewer/epub?title=x&path=${encodeURIComponent(epubs[0].path)}&position=`);
		await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });
		const indicator = page.getByTestId("page-indicator");
		const before = await indicator.textContent();
		const { width, height } = page.viewportSize()!;
		await page.mouse.click(width * 0.9, height * 0.5);
		await expect.poll(async () => indicator.textContent(), { timeout: 10_000 }).not.toBe(before);
	});
});
