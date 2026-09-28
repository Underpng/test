import { expect, type Page } from "@playwright/test";

// showBars brings the reader's bars up to stay. They hide themselves once,
// a moment after the book opens; waiting for that first means they cannot
// vanish between checking for a button and clicking it.
export async function showBars(page: Page) {
	const indicator = page.getByTestId("page-indicator");
	await expect(indicator).toBeHidden({ timeout: 6_000 }).catch(() => undefined);
	await expect(async () => {
		if (!(await indicator.isVisible())) {
			const vp = page.viewportSize()!;
			await page.mouse.click(vp.width / 2, vp.height / 2);
		}
		await expect(indicator).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 15_000 });
}
