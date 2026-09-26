import { test, expect, type Page } from "@playwright/test";

const v01 = "/テスト漫画/Test Comic v01.cbz";
const loose = "/Loose Comic.cbz";
const novel = "/テスト小説/Test Novel 01.epub";

async function pageCount(page: Page, path: string): Promise<number> {
	const res = await page.request.get(`/book/cbz/pages?path=${encodeURIComponent(path)}`);
	return ((await res.json()) as { pages: number }).pages;
}

async function openComic(page: Page, path: string, position: number) {
	await page.goto(`/viewer/cbz?title=x&path=${encodeURIComponent(path)}&position=${position}`);
	await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("end-of-book card", () => {
	test("shows 'checking' while the next volume is still loading, never 'series complete'", async ({ page }) => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		await page.route("**/api/neighbors?*", async (route) => {
			await gate;
			await route.continue();
		});
		await openComic(page, v01, await pageCount(page, v01));

		await page.keyboard.press("Space");
		const card = page.getByTestId("end-of-book");
		await expect(card.getByTestId("neighbors-loading")).toBeVisible();
		await expect(card).not.toContainText("シリーズ完読");

		release();
		await expect(card.getByText("次の巻", { exact: true })).toBeVisible();
		await expect(card).not.toContainText("シリーズ完読");
	});

	test("offers a retry when the next volume cannot be looked up", async ({ page }) => {
		await page.route("**/api/neighbors?*", (route) => route.abort("connectionrefused"));
		await openComic(page, v01, await pageCount(page, v01));
		await page.keyboard.press("Space");
		const card = page.getByTestId("end-of-book");
		await expect(card).toContainText("次の巻を確認できませんでした");
		await expect(card).not.toContainText("シリーズ完読");

		await page.unroute("**/api/neighbors?*");
		await card.getByRole("button", { name: "再試行" }).click();
		await expect(card.getByText("次の巻", { exact: true })).toBeVisible();
	});

	test("a loose book in the library root is not treated as a series", async ({ page }) => {
		const res = await page.request.get(`/api/neighbors?path=${encodeURIComponent(loose)}`);
		const nb = (await res.json()) as { series: boolean; next: unknown; prev: unknown };
		expect(nb.series).toBe(false);
		expect(nb.next).toBeNull();
		expect(nb.prev).toBeNull();

		await openComic(page, loose, await pageCount(page, loose));
		await page.keyboard.press("Space");
		const card = page.getByTestId("end-of-book");
		await expect(card).toContainText("この本を読み終えました");
		await expect(card).not.toContainText("シリーズ完読");
		await expect(card).not.toContainText("次の巻");

		// Going back from the first page does nothing (no "previous volume").
		await card.getByRole("button", { name: "閉じる" }).click();
		await openComic(page, loose, 1);
		await page.keyboard.press("PageUp");
		await page.waitForTimeout(300);
		await expect(page.getByTestId("end-of-book")).toHaveCount(0);
	});
});

test.describe("viewer settings sheet", () => {
	for (const [kind, url] of [
		["comic", `/viewer/cbz?title=x&path=${encodeURIComponent(v01)}&position=2`],
		["epub", `/viewer/epub?title=x&path=${encodeURIComponent(novel)}&position=`],
	] as const) {
		test(`${kind}: tapping outside closes it without turning the page`, async ({ page }) => {
			await page.goto(url);
			const indicator = page.getByTestId("page-indicator");
			await expect(indicator).toBeVisible({ timeout: 20_000 });
			if (kind === "epub") await expect(page.frameLocator("iframe").first().getByRole("heading", { name: "第1章" })).toBeVisible({ timeout: 20_000 });
			const before = await indicator.textContent();

			await page.getByRole("button", { name: "表示設定" }).click();
			await expect(page.getByRole("dialog")).toBeVisible();
			const { width, height } = page.viewportSize()!;
			await page.mouse.click(width * 0.05, height * 0.5); // left edge, outside the sheet
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await page.waitForTimeout(400);
			expect(await indicator.textContent()).toBe(before);
		});
	}
});

test.describe("bottom bar", () => {
	test("page number in the middle, volume and full screen at the bottom right", async ({ page }) => {
		await openComic(page, v01, 1);
		const indicator = page.getByTestId("page-indicator");
		const chip = page.getByTestId("volume-chip");
		const button = page.getByTestId("immersive-button");
		await expect(chip).toHaveText("1 / 2 巻");

		const vw = page.viewportSize()!.width;
		const ib = (await indicator.boundingBox())!;
		const cb = (await chip.boundingBox())!;
		const bb = (await button.boundingBox())!;
		expect(Math.abs(ib.x + ib.width / 2 - vw / 2)).toBeLessThan(vw * 0.1); // centred
		expect(cb.x).toBeGreaterThan(vw / 2); // right half
		expect(bb.x).toBeGreaterThan(cb.x); // button is the right-most
	});

	test("full-screen mode hides the bars and is remembered", async ({ page }) => {
		await openComic(page, v01, 1);
		const indicator = page.getByTestId("page-indicator");
		await page.getByTestId("immersive-button").click();
		await expect(indicator).toBeHidden();

		// Next time the reader opens straight into full-screen mode.
		await openComic(page, v01, 2);
		await expect(indicator).toBeHidden();

		// A centre tap still brings the bars back, and the button leaves the mode.
		const { width, height } = page.viewportSize()!;
		await page.mouse.click(width * 0.5, height * 0.5);
		await expect(indicator).toBeVisible();
		const button = page.getByTestId("immersive-button");
		await expect(button).toHaveAttribute("aria-pressed", "true");
		await button.click();
		await expect(button).toHaveAttribute("aria-pressed", "false");
		await expect(indicator).toBeVisible();
	});

	test("dragging the slider shows the destination page", async ({ page, isMobile }) => {
		test.skip(isMobile, "mouse dragging only");
		await openComic(page, v01, 1);
		const thumb = page.getByRole("slider");
		await expect(thumb).toBeVisible();
		const box = (await thumb.boundingBox())!;
		const track = (await page.locator('[aria-label="ページ"]').boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// Default reading direction is right-to-left: page 1 sits at the right,
		// so moving left goes forward.
		await page.mouse.move(track.x + track.width * 0.5, box.y + box.height / 2, { steps: 5 });
		const bubble = page.getByTestId("slider-bubble");
		await expect(bubble).toBeVisible();
		await expect(bubble).toHaveText(/^\d+ \/ \d+$/);
		await page.mouse.up();
		await expect(bubble).toHaveCount(0);
	});
});
