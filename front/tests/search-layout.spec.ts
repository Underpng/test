import { test, expect } from "@playwright/test";

test("phone search sits mid-screen until something is typed", async ({ page, isMobile }) => {
	test.skip(!isMobile, "phone layout only");
	await page.goto("/search");
	const input = page.getByRole("searchbox");
	const vh = page.viewportSize()!.height;
	const centre = async () => {
		const b = (await input.boundingBox())!;
		return (b.y + b.height / 2) / vh;
	};

	await expect.poll(centre).toBeGreaterThan(0.35);
	expect(await centre()).toBeLessThan(0.6);
	await page.screenshot({ path: "test-results/search-idle.png" });

	await input.fill("T");
	await expect(page.getByTestId("search-page")).toHaveAttribute("data-idle", "false");
	await expect.poll(centre).toBeLessThan(0.3);
	await expect(input).toBeFocused();
});

test("wide screens keep the search at the top", async ({ page, isMobile }) => {
	test.skip(!!isMobile, "wide layout only");
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto("/search");
	const b = (await page.getByRole("searchbox").boundingBox())!;
	expect(b.y).toBeLessThan(200);
});
