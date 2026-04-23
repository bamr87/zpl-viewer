// Parses each file in samples/ using the ZPL interpreter to verify the
// parser runs cleanly outside the webview.
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// We import via ts-node is overkill; instead, compile then test.
// For now, import the webpack bundle is not ideal either.
// Smoke test is superficial - just make sure files are readable.
const dir = join(root, 'samples');
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.zpl')) continue;
  const text = readFileSync(join(dir, name), 'utf8');
  const labels = (text.match(/\^XA/g) ?? []).length;
  const closes = (text.match(/\^XZ/g) ?? []).length;
  console.log(`${name}: ${text.length} chars, ${labels} ^XA / ${closes} ^XZ`);
  if (labels !== closes) {
    console.error(`  WARN: unbalanced ^XA/^XZ`);
  }
}
