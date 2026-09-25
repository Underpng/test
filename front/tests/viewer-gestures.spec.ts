import { test, expect, type Page } from "@playwright/test";

type Book = { type: string; path: string; cover: string; title: string };

async function findFirstCbz(page: Page): Promise<Book | null> {
	const queue = ["/"];
	while (queue.length > 0) {
		const folder = queue.shift()!;
		const res = await page.request.get(`/api/root${folder}`);
		const body = (await res.json()) as { books: Book[] };
		for (const b of body.books) {
			if (b.type === "CBZ") return b;
			if (b.type === "Folder") queue.push(b.path);
		}
	}
	return null;
}

test.describe("comic viewer", () => {
	test("tap zones turn pages and the center toggles the bars", async ({ page }) => {
		const book = await findFirstCbz(page);
		test.skip(book === null, "no CBZ in the library");

		await page.goto(`/viewer/cbz?title=${encodeURIComponent(book!.title)}&path=${encodeURIComponent(book!.path)}&position=1`);
		await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
		const indicator = page.getByTestId("page-indicator");
		await expect(indicator).toHaveText(/^1 \/ \d+$/);

		// Default reading direction is right-to-left, so the left edge is "next".
		const { width, height } = page.viewportSize()!;
		await page.mouse.click(width * 0.1, height * 0.5);
		await expect(indicator).toHaveText(/^2(-3)? \/ \d+$/);

		// Right edge goes back.
		await page.mouse.click(width * 0.9, height * 0.5);
		await expect(indicator).toHaveText(/^1 \/ \d+$/);

		// The bars hide on their own and a center tap brings them back.
		await expect(indicator).toBeHidden({ timeout: 5_000 });
		await page.mouse.click(width * 0.5, height * 0.5);
		await expect(indicator).toBeVisible();
	});

	test("keyboard: space advances, PageUp goes back", async ({ page }) => {
		const book = await findFirstCbz(page);
		test.skip(book === null, "no CBZ in the library");

		await page.goto(`/viewer/cbz?title=${encodeURIComponent(book!.title)}&path=${encodeURIComponent(book!.path)}&position=1`);
		await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
		const indicator = page.getByTestId("page-indicator");

		await page.keyboard.press("Space");
		await expect(indicator).toHaveText(/^2(-3)? \/ \d+$/);
		await page.keyboard.press("PageUp");
		await expect(indicator).toHaveText(/^1 \/ \d+$/);
	});
});

test("home page groups reading, next volume and arrivals", async ({ page }) => {
	const res = await page.request.get("/api/home");
	expect(res.ok()).toBeTruthy();
	const body = (await res.json()) as { reading: Book[]; next: Book[]; arrivals: Book[] };
	expect(Array.isArray(body.reading)).toBeTruthy();
	expect(Array.isArray(body.next)).toBeTruthy();
	expect(Array.isArray(body.arrivals)).toBeTruthy();

	await page.goto("/");
	await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
});
