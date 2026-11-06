// The page icon library (client/src/page-icons.jsx, server/page-icons.js): every name the AI may use is a real icon,
// the two lists agree, the AI is told to use names (not emoji), and new AI-built funnels start with line icons on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer, register } from './helpers.mjs';
import { PAGE_ICON_NAMES } from '../page-icons.js';
import { getTemplate, similarTemplates } from '../templates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../../client/src/page-icons.jsx'), 'utf8');
const def = src.slice(src.indexOf('const DEF = {'), src.indexOf('};', src.indexOf('const DEF = {')));
const entries = [...def.matchAll(/(?:^|, |\{ |\s)'?([a-z0-9-]+)'?: \['([A-Z][A-Za-z0-9]*)', '([^']*)'\]/gm)].map((m) => ({ name: m[1], comp: m[2], words: m[3] }));

test('every icon name is a real icon, the server’s list is the client’s, and the emoji map points at real names', async () => {
  assert.ok(entries.length >= 200, `${entries.length} icons`);
  assert.deepEqual(PAGE_ICON_NAMES, entries.map((e) => e.name), 'server/page-icons.js lists the same names, in order');
  assert.equal(new Set(PAGE_ICON_NAMES).size, PAGE_ICON_NAMES.length, 'no duplicate names');
  const lucide = await import(pathToFileURL(createRequire(path.join(here, '../../client/package.json')).resolve('lucide-react')).href);
  const missing = entries.filter((e) => !lucide[e.comp]).map((e) => e.comp);
  assert.deepEqual(missing, [], 'every icon exists in the installed lucide-react');
  // the named imports list every component the table uses
  const imported = new Set(src.match(/^import \{([^}]+)\} from 'lucide-react';/m)[1].split(',').map((s) => s.trim()));
  assert.deepEqual(entries.filter((e) => !imported.has(e.comp)).map((e) => e.comp), [], 'named imports (no whole-library import on public pages)');
  assert.doesNotMatch(src, /import \* as \w+ from 'lucide-react'/);
  const e2i = src.slice(src.indexOf('const E2I = {'), src.indexOf('};', src.indexOf('const E2I = {')));
  const targets = [...e2i.matchAll(/: '([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(targets.length >= 150);
  assert.deepEqual([...new Set(targets.filter((t) => !PAGE_ICON_NAMES.includes(t)))], [], 'every emoji maps to a name in the library');
});

let fake, srv, api, T;
const seen = [];
before(async () => {
  const draft = JSON.stringify(getTemplate(similarTemplates('Home bakery in Pune selling custom birthday cakes, ₹899', 1)[0].id));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}');
      seen.push(j);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: /funnel strategist/.test(j.instructions || '') ? draft : JSON.stringify({ ready: true }) }] }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test-key', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, AI_REPAIR_PASSES: '0' });
  api = srv.api;
  T = (await register(api)).token;
});
after(async () => { await srv.stop(); fake.close(); });

test('the AI is told to use icon names, and a new AI-built funnel starts with line icons on', async () => {
  const n = seen.length;
  const r = await api('/ai/generate', 'POST', { prompt: 'Home bakery in Pune selling custom birthday cakes, ₹899' }, T);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const sys = seen.slice(n).find((x) => /funnel strategist/.test(x.instructions || ''))?.instructions || '';
  assert.match(sys, /ICONS: the icon fields/);
  assert.match(sys, /truck, package, package-check/);
  assert.match(sys, /never an emoji/);
  assert.equal(r.data.theme.icons, 'line');
});
