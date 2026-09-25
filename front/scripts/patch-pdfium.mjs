import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const filePath = join(root, 'node_modules', '@embedpdf', 'pdfium', 'dist', 'index.browser.js');

try {
  const content = readFileSync(filePath, 'utf8');
  const patched = content.replace(
    /new URL\('pdfium\.wasm', import\.meta\.url\)\.href/g,
    "'/pdfium.wasm'"
  );
  writeFileSync(filePath, patched, 'utf8');
  console.log('patch-pdfium: patched pdfium.wasm URL to /pdfium.wasm');
} catch (e) {
  console.error('patch-pdfium: failed to patch', e.message);
  process.exit(1);
}
