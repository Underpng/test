// Builds a small library for the end-to-end tests: two comic volumes, two
// EPUB volumes and one loose comic. Pure Node (a store-only ZIP writer and
// a tiny PNG encoder), so no extra dependencies.
//
//   node tests/fixtures/make-library.mjs <output dir>

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const out = process.argv[2];
if (!out) {
	console.error("usage: make-library.mjs <dir>");
	process.exit(1);
}

// ---------- CRC32 ----------
const crcTable = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

// ---------- PNG (RGB, filter 0) ----------
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}
function png(width, height, [r, g, b], bandRow) {
	const raw = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		const off = y * (width * 3 + 1);
		raw[off] = 0;
		for (let x = 0; x < width; x++) {
			const p = off + 1 + x * 3;
			// a dark band marks the page number position so pages differ
			const dark = y > bandRow && y < bandRow + 40 && x > width * 0.2 && x < width * 0.8;
			raw[p] = dark ? 30 : r;
			raw[p + 1] = dark ? 30 : g;
			raw[p + 2] = dark ? 30 : b;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type RGB
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// A tall, noisy grayscale page like a real scan, big enough for the data
// saver to shrink (it caps pages at 1200 px tall).
function scanPng(width, height) {
	const raw = Buffer.alloc((width + 1) * height);
	let seed = 99;
	for (let y = 0; y < height; y++) {
		raw[y * (width + 1)] = 0;
		for (let x = 0; x < width; x++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			raw[y * (width + 1) + 1 + x] = 150 + (seed >>> 27) + ((x >> 5) % 2) * 60;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 0; // grayscale
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---------- ZIP (store only) ----------
function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const [name, data] of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // utf-8 names
		local.writeUInt16LE(0, 8); // store
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		locals.push(local, nameBuf, data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const centralStart = offset;
	const centralBuf = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(centralStart, 16);
	return Buffer.concat([...locals, centralBuf, end]);
}

// ---------- books ----------
function cbz(pages, tint, tallLastPage = false) {
	const entries = [];
	for (let i = 1; i <= pages; i++) {
		entries.push([`page${String(i).padStart(3, "0")}.png`, png(300, 450, tint, 40 + i * 50)]);
	}
	if (tallLastPage) entries.push([`page${String(pages + 1).padStart(3, "0")}.png`, scanPng(900, 1800)]);
	return zip(entries);
}

function epub(title, chapters) {
	const xhtml = (n) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${n}章</title></head>
<body><h1>第${n}章</h1>${Array.from({ length: 12 }, (_, i) => `<p>${title} 第${n}章の段落 ${i + 1}。テスト用の本文です。読書位置の保存とページ送りを確認します。</p>`).join("")}</body></html>`;
	const manifest = chapters.map((n) => `<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`).join("");
	const spine = chapters.map((n) => `<itemref idref="c${n}"/>`).join("");
	const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目次</title></head>
<body><nav epub:type="toc"><ol>${chapters.map((n) => `<li><a href="c${n}.xhtml">第${n}章</a></li>`).join("")}</ol></nav></body></html>`;
	const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:uuid:${title.replace(/\W/g, "")}</dc:identifier>
<dc:title>${title}</dc:title><dc:creator>テスト著者</dc:creator><dc:subject>テスト</dc:subject><dc:language>ja</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest>
<spine>${spine}</spine></package>`;
	const entries = [
		["mimetype", Buffer.from("application/epub+zip")],
		["META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)],
		["OEBPS/content.opf", Buffer.from(opf)],
		["OEBPS/nav.xhtml", Buffer.from(nav)],
		...chapters.map((n) => [`OEBPS/c${n}.xhtml`, Buffer.from(xhtml(n))]),
	];
	return zip(entries);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "テスト漫画"), { recursive: true });
mkdirSync(join(out, "テスト小説"), { recursive: true });
writeFileSync(join(out, "テスト漫画", "Test Comic v01.cbz"), cbz(5, [235, 200, 170], true));
writeFileSync(join(out, "テスト漫画", "Test Comic v02.cbz"), cbz(4, [200, 220, 235]));
writeFileSync(join(out, "テスト小説", "Test Novel 01.epub"), epub("Test Novel 01", [1, 2, 3]));
writeFileSync(join(out, "テスト小説", "Test Novel 02.epub"), epub("Test Novel 02", [1, 2]));
writeFileSync(join(out, "Loose Comic.cbz"), cbz(3, [220, 235, 200]));
console.log("fixture library written to", out);
