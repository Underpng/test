import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

// By default the tests run against a throwaway server (dist\shelf.exe built
// by build.ps1) serving a generated fixture library, so they never touch a
// real collection. Set BASE_URL to test a running server instead.
const external = process.env.BASE_URL;
const fixtureDir = join(__dirname, "test-results", "fixture");
const port = 50099;
const baseURL = external ?? `http://localhost:${port}`;
if (!external) process.env.SHELF_FIXTURE = "1";

const exe = join(__dirname, "..", "dist", process.platform === "win32" ? "shelf.exe" : "shelf");

export default defineConfig({
	testDir: "./tests",
	testIgnore: ["**/fixtures/**"],
	timeout: 30_000,
	retries: 0,
	reporter: [["list"]],
	globalSetup: "./tests/global-setup.ts",
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	webServer: external
		? undefined
		: {
				command: `node tests/fixtures/make-library.mjs "${join(fixtureDir, "books")}" && "${exe}" -books "${join(fixtureDir, "books")}" -data "${join(fixtureDir, "data")}" -port ${port} -scan-interval 0 -open-admin=false -log -`,
				url: `${baseURL}/api/status`,
				reuseExistingServer: false,
				timeout: 60_000,
			},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
		{ name: "iphone", use: { ...devices["iPhone 14"] } },
	],
});
