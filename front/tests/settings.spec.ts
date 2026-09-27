import { test, expect } from "@playwright/test";

test("the icon setting switches the logo and the home-screen icon", async ({ page }) => {
	await page.goto("/");
	const logo = page.getByTestId("app-logo").locator("visible=true").first();
	await expect(logo).toHaveAttribute("data-variant", "home");

	await page.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	// Playwright reaches the server over localhost, i.e. from home.
	await expect(page.getByTestId("icon-note")).toContainText("LAN内/Wi-Fi接続");

	await page.getByRole("radio", { name: "おでかけ" }).click();
	await expect(logo).toHaveAttribute("data-variant", "away");
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/away/apple-touch-icon.png");
	await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "shelf 外");

	// The choice survives a reload.
	await page.reload();
	await expect(page.getByTestId("app-logo").locator("visible=true").first()).toHaveAttribute("data-variant", "away");

	await page.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	await page.getByRole("radio", { name: "おうち" }).click();
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png?v=home");
	await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "shelf");
});

test("theme can be chosen in settings", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	await page.getByRole("radio", { name: "ダーク" }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.getByRole("radio", { name: "ライト" }).click();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("settings open from the bottom on phones and from the right on wide screens", async ({ page, isMobile }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "設定" }).first().click();
	const sheet = page.getByRole("dialog");
	await expect(sheet).toBeVisible();
	await page.waitForTimeout(600); // let the slide-in finish
	const box = (await sheet.boundingBox())!;
	const vp = page.viewportSize()!;
	if (isMobile) {
		// Anchored to the bottom edge, full width, clear of the status bar.
		expect(Math.round(box.y + box.height)).toBe(vp.height);
		expect(box.width).toBe(vp.width);
		expect(box.y).toBeGreaterThan(vp.height * 0.1);
	} else {
		expect(Math.round(box.x + box.width)).toBe(vp.width);
		expect(box.y).toBe(0);
	}
	await page.screenshot({ path: `test-results/sheet-${isMobile ? "phone" : "wide"}.png` });
});
