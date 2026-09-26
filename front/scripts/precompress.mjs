// Replaces compressible build outputs with gzip versions (file.js ->
// file.js.gz). The Go server serves them with Content-Encoding: gzip, so
// phones download roughly 40% of the original size and the executable
// shrinks too. index.html and small files are left alone.
//
//   node scripts/precompress.mjs <dir>

import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync, constants } from "node:zlib";

const dir = process.argv[2];
if (!dir) {
	console.error("usage: precompress.mjs <dir>");
	process.exit(1);
}

const compressible = new Set([".js", ".css", ".wasm", ".svg", ".json", ".map", ".txt"]);
let before = 0;
let after = 0;

function walk(d) {
	for (const name of readdirSync(d)) {
		const p = join(d, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			walk(p);
			continue;
		}
		if (!compressible.has(extname(name)) || st.size < 1024) continue;
		const gz = gzipSync(readFileSync(p), { level: constants.Z_BEST_COMPRESSION });
		if (gz.length >= st.size * 0.9) continue; // not worth it
		writeFileSync(p + ".gz", gz);
		unlinkSync(p);
		before += st.size;
		after += gz.length;
	}
}

walk(dir);
console.log(`precompressed: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
