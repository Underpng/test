import { test, expect } from "@playwright/test";

// Test Comic v01 ends with a 900x1800 scan-like page (see fixtures).
const book = "/テスト漫画/Test Comic v01.cbz";
const tallPage = 6;

test("pages are original at home and shrunk when data saver is requested", async ({ page }) => {
	const url = (q: string) => `/book/cbz?path=${encodeURIComponent(book)}&page=${tallPage}${q}`;

	// Playwright talks to the server over localhost, which counts as home.
	const home = await page.request.get(url(""));
	expect(home.headers()["x-shelf-quality"]).toBe("original");
	expect(home.headers()["content-type"]).toBe("image/png");

	const saver = await page.request.get(url("&q=saver"));
	expect(saver.headers()["x-shelf-quality"]).toBe("saver");
	expect(saver.headers()["content-type"]).toBe("image/jpeg");
	expect((await saver.body()).length).toBeLessThan((await home.body()).length);

	// Decode in the browser to check the size actually delivered.
	await page.goto("/");
	const heights = await page.evaluate(async (urls) => {
		const load = async (u: string) => {
			const img = new Image();
			img.src = u;
			await img.decode();
			return img.naturalHeight;
		};
		return [await load(urls[0]), await load(urls[1])];
	}, [url("&q=original"), url("&q=saver")]);
	expect(heights).toEqual([1800, 1200]);
});

test("the reader settings show what auto quality means right now", async ({ page }) => {
	await page.goto(`/viewer/cbz?title=x&path=${encodeURIComponent(book)}&position=1`);
	await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
	// The bars hide themselves shortly after opening; a centre tap brings them back.
	await expect(page.getByTestId("page-indicator")).toBeHidden({ timeout: 5_000 });
	const { width, height } = page.viewportSize()!;
	await page.mouse.click(width * 0.5, height * 0.5);
	await page.getByRole("button", { name: "表示設定" }).click();
	await expect(page.getByTestId("quality-now")).toContainText("クオリティモード");
});

test("scripts are served gzipped", async ({ page }) => {
	const html = await (await page.request.get("/")).text();
	// The built index.html is minified, so attribute quotes may be omitted.
	const src = html.match(/src=["']?(\/[^"' >]+\.js)/)?.[1];
	test.skip(!src, "no script tag found");
	const res = await page.request.get(src!, { headers: { "Accept-Encoding": "gzip" } });
	expect(res.ok()).toBeTruthy();
	expect(res.headers()["content-encoding"]).toBe("gzip");
});
