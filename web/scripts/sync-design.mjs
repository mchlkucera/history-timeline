// Re-copies the design system's source of truth into the Next app.
// /design/*.css is read-only to the app; edit there, then `npm run design:sync`.
import { copyFileSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../design');
const dst = resolve(here, '../src/styles');
mkdirSync(dst, { recursive: true });

for (const f of ['tokens.css', 'shell.css']) {
  const header = `/* GENERATED COPY — source of truth is /design/${f}; edit there and re-run npm run design:sync */\n`;
  writeFileSync(resolve(dst, f), header + readFileSync(resolve(src, f), 'utf8'));
  console.log(`design:sync  ${f}  ->  src/styles/${f}`);
}
void copyFileSync;
