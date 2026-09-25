import path from "node:path";
import { defineConfig } from "@farmfe/core";
import postcss from "@farmfe/js-plugin-postcss";

// While developing, API calls are forwarded to a running server
// (by default the docker-compose stack on port 50080).
const backend = process.env.BACKEND_URL ?? "http://localhost:50080";

export default defineConfig({
	plugins: [
		[
			"@farmfe/plugin-react",
			{
				runtime: "automatic",
			},
		],
		postcss(),
	],
	compilation: {
		// Tailwind's generated CSS depends on every source file, which the
		// persistent cache does not track: stale CSS would drop new classes.
		persistentCache: false,
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
		input: {
			index: "./index.html",
		},
	},
	server: {
		port: 9000,
		cors: true,
		proxy: {
			"/api": { target: backend, changeOrigin: true },
			"/book": { target: backend, changeOrigin: true },
			"/cover": { target: backend, changeOrigin: true },
		},
	},
});
