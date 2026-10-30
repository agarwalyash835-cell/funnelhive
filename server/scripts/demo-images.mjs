// Photos for the live demo stores (/s/demo-<theme>), made with the AI image model (kie.ai, nano-banana-2 by
// default) and saved as small WebP files in client/public/demo/<theme>/<id>.webp — one per demo product plus a
// "hero" banner per store. server/demo-photos.json lists what exists; store-demos.js uses a photo when it's listed
// and falls back to the drawn SVG otherwise. Files already made are skipped, so it's safe to run again after
// adding a theme. Needs KIE_API_KEY (and ffmpeg on PATH for the WebP step). Run from the repo root:
//   node --env-file-if-exists=server/.env server/scripts/demo-images.mjs [--themes fashion,grocery] [--only fashion-03,hero] [--dry] [--force]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.KIE_IMAGE_MODEL ||= 'nano-banana-2';
const { generateImage, imagesReady } = await import('../ai.js');
const { DEMO_THEMES, demoStore, demoListings } = await import('../store-demos.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'client/public/demo');
const MANIFEST = path.join(ROOT, 'server/demo-photos.json');
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const flag = (k) => process.argv.includes(`--${k}`);
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const themes = list(arg('themes')) || DEMO_THEMES;
const only = list(arg('only'));
const DRY = flag('dry'), FORCE = flag('force');

// how each store's pictures should look — new themes fall back to a clean studio look built from the store's own words
const LOOK = {
  fashion: { aspect: '3:4', w: 720, style: 'Editorial fashion catalogue photo, Indian model, full outfit visible, soft natural daylight, warm cream and terracotta studio backdrop, calm pose', still: 'Editorial still-life on warm cream linen, soft daylight' },
  grocery: { aspect: '1:1', w: 800, style: 'Bright, clean e-commerce product photo of an everyday Indian grocery item, centred on a plain very light background, soft even light, appetising and fresh' },
  beauty: { aspect: '1:1', w: 800, style: 'Minimal skincare product photography, soft pastel backdrop, gentle shadows, a few fresh botanical props (leaves, flowers, turmeric, saffron) arranged neatly' },
  electronics: { aspect: '1:1', w: 800, style: 'Sleek studio product render of an unbranded consumer gadget on a dark navy gradient background with subtle rim light and reflections' },
};
const fallback = (st) => ({ aspect: '1:1', w: 800, style: `Clean e-commerce product photo for an Indian shop called "${st.name}" (${st.tagline}), centred on a soft plain background that suits the shop, natural light` });
const RULES = 'Photorealistic. No text, words, logos or brand names anywhere in the image, no watermark, no price tags.';
const WEARABLE = /Kurtas|Dresses|Co-ords|Sarees|Denim/;

function jobsFor(t) {
  const st = demoStore(`demo-${t}`), look = LOOK[t] || fallback(st);
  const o = st.themeOptions || {};
  const jobs = [{ id: 'hero', aspect: '16:9', w: 1600, prompt: `Wide lifestyle banner photo for an Indian online shop called "${st.name}" — ${st.tagline}. Mood: ${o.heroTitle || ''}. ${o.heroText || ''} ${look.style}. Leave calm empty space on the left for a headline. ${RULES}` }];
  for (const l of demoListings(`demo-${t}`)) {
    const style = t === 'fashion' && !WEARABLE.test(l.category) ? look.still : look.style;
    jobs.push({ id: l.id, aspect: look.aspect, w: look.w, prompt: `${l.title}${l.unit ? ` (${l.unit})` : ''} — ${String(l.description).split('\n')[0]} ${style}. Show only this one product. ${RULES}` });
  }
  return jobs;
}

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const todo = [];
for (const t of themes) {
  if (!DEMO_THEMES.includes(t)) { console.error(`✗ no demo store for "${t}" (have: ${DEMO_THEMES.join(', ')})`); process.exit(1); }
  for (const j of jobsFor(t)) {
    if (only && !only.includes(j.id)) continue;
    const file = path.join(OUT, t, `${j.id}.webp`);
    if (!FORCE && fs.existsSync(file)) continue;
    todo.push({ t, ...j, file });
  }
}
console.log(`${todo.length} image(s) to make with ${process.env.KIE_IMAGE_MODEL}${DRY ? ' (dry run)' : ''}`);
if (DRY) { for (const j of todo) console.log(`  ${j.t}/${j.id} [${j.aspect}] ${j.prompt}`); process.exit(0); }
if (!todo.length) process.exit(0);
if (!imagesReady()) { console.error('✗ KIE_API_KEY is not set — put it in server/.env or the environment'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-img-'));
const save = () => {
  for (const t of Object.keys(manifest)) manifest[t] = [...new Set(manifest[t])].sort();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
};
let done = 0, failed = 0;
async function one(j) {
  try {
    const { buf, type } = await generateImage(j.prompt, { aspect: j.aspect, format: 'jpg', timeoutMs: 300000 });
    const src = path.join(tmp, `${j.t}-${j.id}.${type.split('/')[1]}`);
    fs.writeFileSync(src, buf);
    fs.mkdirSync(path.dirname(j.file), { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${j.w}:-2`, '-c:v', 'libwebp', '-quality', '72', j.file]);
    (manifest[j.t] ||= []).push(j.id);
    save();
    console.log(`✓ ${j.t}/${j.id} (${Math.round(fs.statSync(j.file).size / 1024)} KB) — ${++done}/${todo.length}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${j.t}/${j.id}: ${e.message}`);
  }
}
// a few at a time — the AI service queues them anyway
const queue = [...todo];
await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${done} made, ${failed} failed${failed ? ' — run again to retry the failed ones' : ''}`);
process.exit(failed ? 1 : 0);
