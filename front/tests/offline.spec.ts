import { test, expect } from "@playwright/test";

// Saving a volume on the device and reading it with no connection. Uses the
// service worker, which the other tests keep blocked.
test.use({ serviceWorkers: "allow" });

const v02 = "/テスト漫画/Test Comic v02.cbz";

test("a saved volume opens and reads offline", async ({ page, context }, info) => {
	test.skip(info.project.name !== "chromium", "service workers under test: Chromium");

	await page.goto("/root/テスト漫画");
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
	// Let the worker take control, so the app shell it serves is cached.
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	const card = page.locator("a:has([data-testid=book-menu])", { hasText: "Test Comic v02" });
	await card.hover();
	await card.getByTestId("book-menu").click();
	const sheet = page.getByTestId("book-actions");
	await sheet.getByTestId("save-book").click();
	await expect(sheet.getByTestId("remove-book")).toBeVisible({ timeout: 20_000 });
	await page.keyboard.press("Escape");
	await expect(card.getByTestId("saved-badge")).toBeVisible();

	// Visit the viewer once online so its code is cached too.
	await page.goto(`/viewer/cbz?title=x&path=${encodeURIComponent(v02)}&position=1`);
	await expect(page.getByTestId("page-indicator")).toHaveText(/\/ 4$/, { timeout: 20_000 });

	await context.setOffline(true);

	// The home screen still opens and lists the saved volume.
	await page.goto("/");
	await expect(page.getByTestId("saved-shelf")).toContainText("Test Comic v02");

	// And the volume reads, every page coming from the device.
	await page.getByTestId("saved-shelf").getByRole("link", { name: /Test Comic v02/ }).click();
	await expect(page.getByTestId("page-indicator")).toHaveText(/\/ 4$/, { timeout: 20_000 });
	const img = page.locator("img[src*='page=']").first();
	await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
	await page.keyboard.press("Space");
	await expect(page.getByTestId("page-indicator")).toHaveText(/^2/);

	// Reading offline is remembered and sent once back online.
	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect
		.poll(async () => {
			const r = await page.request.get("/api/search?q=comic%20v02");
			return ((await r.json()) as { books: { currentPosition: string }[] }).books[0]?.currentPosition;
		})
		.toBe("2");

	// Clean up.
	await page.goto("/saved");
	await page.getByTestId("saved-list").getByTestId("book-menu").first().click();
	await page.getByTestId("remove-book").click();
	await expect(page.getByTestId("saved-list")).toBeHidden();
});

test("on plain http the save option explains itself", async ({ page }, info) => {
	test.skip(info.project.name !== "chromium", "one browser is enough");
	// Simulate an insecure origin: the app checks isSecureContext.
	await page.addInitScript(() => Object.defineProperty(window, "isSecureContext", { get: () => false }));
	await page.goto("/saved");
	await expect(page.getByTestId("offline-unsupported")).toContainText("https");
});
