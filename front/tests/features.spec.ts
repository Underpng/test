import { test, expect, type Page } from "@playwright/test";

// Tests that change the shared library (read state, bookmarks) run in one
// browser only, so parallel projects never race on the same book.
const onlyChromium = (name: string) => test.skip(name !== "chromium", "changes shared state; one browser is enough");

const v01 = "/テスト漫画/Test Comic v01.cbz";
const markMe = "/既読テスト/Mark Me.cbz";

// A shelf card (the link that has a menu button) by title.
const cardOf = (page: Page, title: string) => page.locator("a:has([data-testid=book-menu])", { hasText: title });

async function openComic(page: Page, path: string, position = 1) {
	await page.goto(`/viewer/cbz?title=x&path=${encodeURIComponent(path)}&position=${position}`);
	await expect(page.getByTestId("page-indicator")).toHaveText(/\/ \d+$/, { timeout: 20_000 });
}

async function showBars(page: Page) {
	const bar = page.getByTestId("page-indicator");
	if (!(await bar.isVisible())) {
		const vp = page.viewportSize()!;
		await page.mouse.click(vp.width / 2, vp.height / 2);
	}
	await expect(bar).toBeVisible();
}

test.describe("search", () => {
	for (const [q, expected] of [
		["comic", "Test Comic v01"], // middle of the title
		["てすと", "Test Comic v01"], // hiragana finds the katakana folder
		["ＣＯＭＩＣ", "Test Comic v01"], // full-width
		["ｔｅｓｔ　novel", "Test Novel 01"], // mixed width, space ignored
	] as const) {
		test(`"${q}" finds ${expected}`, async ({ page }) => {
			await page.goto("/search");
			await page.getByRole("searchbox").fill(q);
			await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
		});
	}
});

test.describe("read state", () => {
	test("the card menu marks a book read and back to unread", async ({ page }, info) => {
		onlyChromium(info.project.name);
		await page.request.post("/api/mark", { data: { path: markMe, read: false } });
		await page.goto("/root/既読テスト");
		const card = cardOf(page, "Mark Me");
		await card.hover();
		await card.getByTestId("book-menu").click();
		const sheet = page.getByTestId("book-actions");
		await sheet.getByTestId("mark-read").click();
		await expect(sheet).toBeHidden();
		await expect(card).toContainText("読了");
		let book = await (await page.request.get("/api/search?q=mark%20me")).json();
		expect(book.books[0].progress).toBe(1);

		await card.getByTestId("book-menu").click();
		await sheet.getByTestId("mark-unread").click();
		await expect(card).not.toContainText("読了");
		book = await (await page.request.get("/api/search?q=mark%20me")).json();
		expect(book.books[0]).toMatchObject({ progress: 0, currentPosition: "" });
	});

	test("a long press opens the menu instead of the book", async ({ page }, info) => {
		onlyChromium(info.project.name);
		await page.goto("/root/既読テスト");
		const card = cardOf(page, "Mark Me");
		const box = (await card.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
		await page.mouse.down();
		await page.waitForTimeout(700);
		await page.mouse.up();
		await expect(page.getByTestId("book-actions")).toBeVisible();
		expect(decodeURIComponent(new URL(page.url()).pathname)).toBe("/root/既読テスト");
	});
});

test.describe("page grid and bookmarks", () => {
	test("bookmark a page, find it in the grid, jump there", async ({ page }, info) => {
		onlyChromium(info.project.name);
		// Start clean even after an interrupted run.
		await page.request.post("/api/bookmarks", { data: { path: v01, position: "2", on: false } });
		await openComic(page, v01, 2);
		await showBars(page);
		const toggle = page.getByTestId("bookmark-toggle");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");

		// Kept on the server.
		const saved = await (await page.request.get(`/api/bookmarks?path=${encodeURIComponent(v01)}`)).json();
		// Landscape desktop shows pages 2-3 as a spread.
		expect(saved.bookmarks).toEqual([expect.objectContaining({ position: "2", label: expect.stringMatching(/^2(-3)? ページ$/) })]);

		await page.getByTestId("open-page-grid").click();
		const grid = page.getByTestId("page-grid");
		await expect(grid).toBeVisible();
		// Thumbnails load (their size is covered by the Go tests).
		const thumb = grid.locator('[data-page="1"] img');
		await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalHeight)).toBeGreaterThan(0);

		await grid.getByTestId("grid-tab-marks").click();
		await expect(grid.locator("[data-page]")).toHaveCount(1);
		await grid.locator('[data-page="2"]').click();
		await expect(grid).toBeHidden();
		await expect(page.getByTestId("page-indicator")).toHaveText(/^2/);

		// Clean up for other tests.
		await showBars(page);
		await page.getByTestId("bookmark-toggle").click();
		await expect(page.getByTestId("bookmark-toggle")).toHaveAttribute("aria-pressed", "false");
	});

	test("the grid jumps to any page", async ({ page }) => {
		await openComic(page, v01, 1);
		await showBars(page);
		await page.getByTestId("open-page-grid").click();
		await page.getByTestId("page-grid").locator('[data-page="4"]').click();
		await expect(page.getByTestId("page-indicator")).toHaveText(/^4/);
	});
});

test.describe("vertical scrolling", () => {
	test("scrolls through the pages and reports the page", async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem("viewerOptions", JSON.stringify({ layout: "vertical", direction: "rtl" })));
		await openComic(page, v01, 1);
		const list = page.getByTestId("vertical-pages");
		await expect(list).toBeVisible();
		await expect(page.locator("[data-layout=vertical]")).toBeVisible();

		// Scroll to the start of page 3.
		await list.evaluate((el) => {
			const p3 = el.querySelector<HTMLElement>('[data-vpage="3"]')!;
			el.scrollTop = p3.offsetTop + 5;
		});
		await showBars(page);
		await expect(page.getByTestId("page-indicator")).toHaveText(/^3/);

		// Only pages near the reading position hold an image.
		const total = await list.locator("[data-vpage]").count();
		const imgs = await list.locator("[data-vpage] img").count();
		expect(imgs).toBeLessThanOrEqual(Math.min(total, 9));

		// Scrolling past the last page ends the volume.
		await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
		await expect(page.getByTestId("end-of-book")).toBeVisible();
	});
});

test.describe("epub bookmarks", () => {
	test("bookmark the current page and list it", async ({ page }, info) => {
		onlyChromium(info.project.name);
		const novel = "/テスト小説/Test Novel 02.epub";
		await page.goto(`/viewer/epub?title=x&path=${encodeURIComponent(novel)}&position=`);
		await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });
		await showBars(page);
		const toggle = page.getByTestId("bookmark-toggle");
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await page.getByTestId("open-bookmarks").click();
		await expect(page.getByTestId("bookmark-list").locator("li")).toHaveCount(1);
		await page.getByRole("button", { name: "このしおりを外す" }).click();
		await expect(page.getByTestId("bookmark-list")).toBeHidden();
	});
});

test("screen info shows in settings when asked for", async ({ page }) => {
	await page.goto("/?vpdebug=1");
	await page.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	await expect(page.getByTestId("screen-info")).toContainText("表示領域");
});

test("a folder lists each book once", async ({ page }) => {
	// The sentinel's update used to render before the first response's and
	// ask for page 1 again, doubling every book.
	const api = await (await page.request.get(`/api/root/${encodeURIComponent("テスト漫画")}`)).json();
	await page.goto("/root/テスト漫画");
	const cards = page.locator("a:has([data-testid=book-menu])");
	await expect(cards).toHaveCount(api.books.length);
	await page.waitForTimeout(800);
	await expect(cards).toHaveCount(api.books.length);
});
