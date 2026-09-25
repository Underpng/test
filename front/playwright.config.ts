import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against a live server (by default the docker-compose
// stack on port 50080). Override with BASE_URL, e.g. the Farm dev server.
const baseURL = process.env.BASE_URL ?? "http://localhost:50080";

export default defineConfig({
	testDir: "./tests",
	timeout: 30_000,
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
		{ name: "iphone", use: { ...devices["iPhone 14"] } },
	],
});
