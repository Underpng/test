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

test("scanning the QR code logs a phone in, once, with nothing to press", async ({ browser, baseURL, page, isMobile }) => {
	test.skip(isMobile, "one run is enough for the pairing flow");
	const res = await page.request.post(baseURL + "/api/admin/pair", { headers: { "X-Shelf-Admin": "1" } });
	const { code } = (await res.json()) as { code: string };

	const phone = await remoteContext(browser, "198.51.100.12");
	const p = await phone.newPage();
	await p.goto(`${baseURL}/pair?code=${code}`);
	await expect(p.getByRole("heading", { name: "ログインしました" })).toBeVisible();
	await expect(p.getByRole("heading", { name: "ホーム" })).toBeVisible();

	// The same code does not work a second time.
	const other = await remoteContext(browser, "198.51.100.13");
	const q = await other.newPage();
	await q.goto(`${baseURL}/pair?code=${code}`);
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

test("the Tailscale https address (Tailscale Serve) needs no login from the tailnet", async ({ browser, baseURL }) => {
	// What tailscaled sends for a device on the tailnet (Funnel adds
	// Tailscale-Funnel-Request and no user).
	const ctx = await browser.newContext({
		extraHTTPHeaders: { "Tailscale-User-Login": "me@example.com", "X-Forwarded-For": "100.86.76.76", "X-Forwarded-Proto": "https" },
	});
	const page = await ctx.newPage();
	await page.goto(baseURL + "/");
	await expect(page.getByRole("heading", { name: "ホーム" })).toBeVisible();
	await ctx.close();

	const funnel = await browser.newContext({ extraHTTPHeaders: { "Tailscale-Funnel-Request": "?1", "X-Forwarded-For": "198.51.100.20" } });
	const p = await funnel.newPage();
	await p.goto(baseURL + "/");
	await expect(p.getByTestId("login-page")).toBeVisible();
	await funnel.close();
});

test("the login screen reads the PC's QR code with the camera and logs in", async ({ browser, baseURL, page }, info) => {
	test.skip(info.project.name !== "chromium", "canvas camera stand-in: Chromium");
	const res = await page.request.post(baseURL + "/api/admin/pair", { headers: { "X-Shelf-Admin": "1" } });
	const { links } = (await res.json()) as { links: { url: string }[] };
	const qr = `${baseURL}/api/admin/qr?text=${encodeURIComponent(links[0].url)}`;
	const svg = await (await page.request.get(qr)).text();

	// A phone away from home (no Tailscale): the login screen.
	const phone = await remoteContext(browser, "198.51.100.30");
	// Stand in for the camera: a video stream showing the QR code.
	await phone.addInitScript((svgText: string) => {
		navigator.mediaDevices.getUserMedia = async () => {
			const canvas = document.createElement("canvas");
			canvas.width = 480;
			canvas.height = 480;
			const ctx = canvas.getContext("2d")!;
			const img = new Image();
			img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
			await img.decode();
			const draw = () => {
				ctx.fillStyle = "#fff";
				ctx.fillRect(0, 0, 480, 480);
				ctx.drawImage(img, 60, 60, 360, 360);
			};
			draw();
			setInterval(draw, 100);
			return canvas.captureStream(10);
		};
	}, svg);
	const p = await phone.newPage();
	await p.goto(baseURL + "/");
	await p.getByTestId("scan-qr").click();
	await expect(p.getByTestId("qr-scanner")).toBeVisible();
	await expect(p.getByRole("heading", { name: "ホーム" })).toBeVisible({ timeout: 15_000 });
	await expect(p.getByTestId("qr-scanner")).toBeHidden();
	await phone.close();
});
