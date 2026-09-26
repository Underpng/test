import { test, expect, type Browser, type BrowserContext } from "@playwright/test";

// Requests with a forwarding header look like they came through a public
// tunnel (Funnel, Cloudflare Tunnel), which is where login is required.
async function remoteContext(browser: Browser, ip: string, device?: object): Promise<BrowserContext> {
	return browser.newContext({ ...(device ?? {}), extraHTTPHeaders: { "X-Forwarded-For": ip } });
}

const PASSWORD = "manga-night-42";

async function setPassword(ctx: BrowserContext, baseURL: string, pw: string) {
	const res = await ctx.request.post(`${baseURL}/api/admin/password`, {
		headers: { "X-Shelf-Admin": "1", "Content-Type": "application/json" },
		data: { password: pw },
	});
	expect(res.ok()).toBeTruthy();
}

test("a visitor through the public URL sees the login screen and no library data", async ({ browser, baseURL }) => {
	const ctx = await remoteContext(browser, "198.51.100.11");
	const page = await ctx.newPage();
	await page.goto(baseURL + "/");
	await expect(page.getByTestId("login-page")).toBeVisible();
	await expect(page.getByText("QR コードでログイン")).toBeVisible();
	expect((await ctx.request.get(baseURL + "/api/home")).status()).toBe(401);
	expect((await ctx.request.get(baseURL + "/api/admin/state")).status()).toBe(403);
	await ctx.close();
});

test("the admin page on this PC shows a pairing QR code", async ({ page }) => {
	await page.goto("/admin");
	await expect(page.getByTestId("admin-page")).toBeVisible();
	const qr = page.getByTestId("pair-qr");
	await expect(qr).toBeVisible();
	await expect.poll(() => qr.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
	await expect(page.getByTestId("pair-url")).toContainText("/pair?code=");
});

test("scanning the QR code logs a phone in, once", async ({ browser, baseURL, page, isMobile }) => {
	test.skip(isMobile, "one run is enough for the pairing flow");
	const res = await page.request.post(baseURL + "/api/admin/pair", { headers: { "X-Shelf-Admin": "1" } });
	const { code } = (await res.json()) as { code: string };

	const phone = await remoteContext(browser, "198.51.100.12");
	const p = await phone.newPage();
	await p.goto(`${baseURL}/pair?code=${code}`);
	await expect(p.getByTestId("pair-page")).toBeVisible();
	await p.getByRole("button", { name: "ログインする" }).click();
	await expect(p.getByRole("heading", { name: "ホーム" })).toBeVisible();

	// The same code does not work a second time.
	const other = await remoteContext(browser, "198.51.100.13");
	const q = await other.newPage();
	await q.goto(`${baseURL}/pair?code=${code}`);
	await q.getByRole("button", { name: "ログインする" }).click();
	await expect(q.getByText("この QR コードは使えません")).toBeVisible();

	// The device shows up on the admin page and can be logged out there.
	await page.goto("/admin");
	await expect(page.getByTestId("device-list")).toBeVisible();
	await phone.close();
	await other.close();
});

test("password login, the settings login section and logout", async ({ browser, baseURL, page, isMobile }) => {
	test.skip(isMobile, "one run is enough for the password flow");
	await setPassword(page.context(), baseURL!, PASSWORD);

	const ctx = await remoteContext(browser, "198.51.100.14");
	const p = await ctx.newPage();
	await p.goto(baseURL + "/");
	const pw = p.getByLabel("パスワード");
	await pw.fill("wrong-password");
	await p.getByRole("button", { name: "ログイン" }).click();
	await expect(p.getByRole("alert")).toContainText("パスワードが違います");

	await pw.fill(PASSWORD);
	await p.getByRole("button", { name: "ログイン" }).click();
	await expect(p.getByRole("heading", { name: "ホーム" })).toBeVisible();

	// Logged-in devices can still not open the admin page remotely.
	await p.goto(baseURL + "/admin");
	await expect(p.getByTestId("admin-forbidden")).toBeVisible();

	// Log out from the settings sheet.
	await p.goto(baseURL + "/");
	await p.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	const login = p.getByTestId("settings-login");
	await expect(login).toContainText("この端末:");
	await login.getByRole("button", { name: "ログアウト" }).click();
	await expect(p.getByTestId("login-page")).toBeVisible();
	await ctx.close();
});

test("this PC and the home network need no login by default", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
	await page.getByRole("button", { name: "設定" }).locator("visible=true").first().click();
	await expect(page.getByTestId("settings-login")).toContainText("サーバーの PC から使っています");
	await expect(page.getByRole("link", { name: /管理画面/ })).toBeVisible();
});
