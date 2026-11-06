// the app works offline, so its two fonts ship inside it (latin subsets, variable weights)
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www', 'fonts');
mkdirSync(out, { recursive: true });
for (const [pkg, file, name] of [
  ['@fontsource-variable/space-grotesk', 'space-grotesk-latin-wght-normal.woff2', 'grotesk.woff2'],
  ['@fontsource-variable/inter', 'inter-latin-wght-normal.woff2', 'inter.woff2'],
]) copyFileSync(join(root, 'node_modules', pkg, 'files', file), join(out, name));
console.log('fonts copied');
