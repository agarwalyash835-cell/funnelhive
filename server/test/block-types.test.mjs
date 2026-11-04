// The server's list of section types (block-types.js) matches what the editor and the page renderer know
// (client/src/blocks.jsx): the AI is checked against it, so a type added on one side must be added on the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BLOCK_TYPE_NAMES, knownBlocks } from '../block-types.js';

const src = fs.readFileSync(new URL('../../client/src/blocks.jsx', import.meta.url), 'utf8');

test('the server knows exactly the section types the editor and the renderer know', () => {
  const start = src.indexOf('export const BLOCK_TYPES');
  const body = src.slice(start, src.indexOf('\n};', start));
  const editor = [...body.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]).sort();
  const at = src.indexOf('Unknown block');
  const sw = src.slice(src.lastIndexOf('switch (', at), at);
  const rendered = [...sw.matchAll(/case '(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...BLOCK_TYPE_NAMES].sort(), editor, 'block-types.js vs BLOCK_TYPES');
  assert.deepEqual(editor, rendered, 'BLOCK_TYPES vs the renderer');
});

test('the section layouts and fonts the AI is told about are the ones the renderer has', async () => {
  const { VARIANTS, FONT_NAMES } = await import('../page-styles.js');
  const start = src.indexOf('export const VARIANTS');
  const body = src.slice(start, src.indexOf('\n};', start));
  const client = Object.fromEntries([...body.matchAll(/^ {2}(\w+): \[(.*)\],$/gm)].map((m) => [m[1], [...m[2].matchAll(/\['(\w+)', /g)].map((x) => x[1])]));
  assert.deepEqual(client, VARIANTS);
  const fonts = fs.readFileSync(new URL('../../client/src/fonts.js', import.meta.url), 'utf8');
  const fb = fonts.slice(fonts.indexOf('export const FONT_CHOICES'));
  const names = [...fb.slice(0, fb.indexOf('\n};')).matchAll(/^ {2}(?:'([^']+)'|(\w+)):/gm)].map((m) => m[1] || m[2]);
  assert.deepEqual(names, FONT_NAMES);
});

test('made-up section types are dropped and reported', () => {
  const r = knownBlocks([{ type: 'hero', props: {} }, { type: 'carousel3d', props: {} }, { type: 'faq' }, null, { type: 'cta', props: [] }]);
  assert.deepEqual(r.blocks.map((b) => b.type), ['hero', 'faq']);
  assert.deepEqual(r.dropped, ['carousel3d', 'unknown', 'cta']);
});
