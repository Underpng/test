import { test, expect } from "@playwright/test";

// A connection that neither answers nor fails (weak Wi-Fi, a stalled mobile
// link) must not leave the app on a blank dark screen.

test("a stalled login check shows a spinner, then gives up", async ({ page }) => {
	await page.route("**/api/auth/status", () => {
		/* never answers */
	});
	await page.goto("/");
	await expect(page.getByTestId("auth-waiting")).toBeVisible();
	await expect(page.getByText("サーバーに接続できません。")).toBeVisible({ timeout: 12_000 });
	await expect(page.getByText("読み込みに時間がかかっています")).toHaveCount(0);
});

test("a device let in before goes ahead when the login check stalls", async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem("hadAccess", "1"));
	await page.route("**/api/auth/status", () => {
		/* never answers */
	});
	await page.goto("/saved");
	await expect(page.getByTestId("auth-waiting")).toBeVisible();
	await expect(page.getByRole("heading", { name: "この端末に保存" })).toBeVisible({ timeout: 12_000 });
});

test("if the app never starts, the page offers a reload", async ({ page }) => {
	await page.route("**/*.js", (route) => route.abort());
	await page.goto("/");
	// Hidden at first (a normal start replaces it), shown after a few seconds.
	const notice = page.getByText("読み込みに時間がかかっています").locator("..");
	const opacity = () => notice.evaluate((el) => getComputedStyle(el).opacity);
	expect(await opacity()).toBe("0");
	await expect.poll(opacity, { timeout: 8_000 }).toBe("1");
	await expect(page.getByRole("link", { name: "再読み込み" })).toHaveAttribute("href", "/");
});

test.describe("with the service worker", () => {
	test.use({ serviceWorkers: "allow" });

	test("a stalled page load opens the kept copy of the app", async ({ page, context }, info) => {
		test.skip(info.project.name !== "chromium", "service workers under test: Chromium");

		await page.goto("/");
		await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
		await page.reload();
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
		await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();

		// The page itself never arrives; everything else still works.
		await context.route((url) => url.pathname === "/", () => {
			/* never answers */
		});
		const started = Date.now();
		await page.goto("/", { waitUntil: "commit" });
		await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible({ timeout: 8_000 });
		// It waited for the page first, then stopped waiting.
		const waited = Date.now() - started;
		expect(waited).toBeGreaterThan(2_500);
		expect(waited).toBeLessThan(7_000);
		await context.unrouteAll({ behavior: "ignoreErrors" });
	});
});
