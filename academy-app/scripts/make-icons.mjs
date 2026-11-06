// the launcher icons and splash screens, drawn from one design: a violet-to-cyan tile with a shield and tick
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const res = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res');
const glyph = (s, x, y) => `<g transform="translate(${x} ${y}) scale(${s / 24})" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></g>`;
const fill = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cff"/><stop offset=".55" stop-color="#6d5dfc"/><stop offset="1" stop-color="#22d3ee"/></linearGradient><radialGradient id="s" cx=".3" cy=".2" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
// shape: 'square' (adaptive foreground, full bleed), 'tile' (rounded square), 'round' (circle)
const icon = (n, shape) => {
  const r = shape === 'round' ? n / 2 : shape === 'tile' ? n * 0.23 : 0;
  const g = shape === 'square' ? n * 0.44 : n * 0.56; // the adaptive icon is cropped, so its glyph sits smaller
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}">${fill}<rect width="${n}" height="${n}" rx="${r}" fill="url(#g)"/><rect width="${n}" height="${n}" rx="${r}" fill="url(#s)"/>${glyph(g, (n - g) / 2, (n - g) / 2)}</svg>`);
};
const splash = (w, h) => {
  const t = Math.round(Math.min(w, h) * 0.26), x = (w - t) / 2, y = (h - t) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${fill}<rect width="${w}" height="${h}" fill="#07070c"/><radialGradient id="h"><stop offset="0" stop-color="#8b5cff" stop-opacity=".35"/><stop offset="1" stop-color="#8b5cff" stop-opacity="0"/></radialGradient><circle cx="${w / 2}" cy="${h / 2}" r="${t * 1.8}" fill="url(#h)"/><rect x="${x}" y="${y}" width="${t}" height="${t}" rx="${t * 0.23}" fill="url(#g)"/>${glyph(t * 0.56, x + t * 0.22, y + t * 0.22)}</svg>`);
};
const out = async (dir, name, svg) => { mkdirSync(join(res, dir), { recursive: true }); await sharp(svg).png().toFile(join(res, dir, name)); };

for (const [d, n] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  await out(`mipmap-${d}`, 'ic_launcher.png', icon(n, 'tile'));
  await out(`mipmap-${d}`, 'ic_launcher_round.png', icon(n, 'round'));
  await out(`mipmap-${d}`, 'ic_launcher_foreground.png', icon(Math.round(n * 2.25), 'square'));
}
await out('drawable', 'splash.png', splash(480, 320));
for (const [d, w, h] of [['mdpi', 320, 480], ['hdpi', 480, 800], ['xhdpi', 720, 1280], ['xxhdpi', 960, 1600], ['xxxhdpi', 1280, 1920]]) {
  await out(`drawable-port-${d}`, 'splash.png', splash(w, h));
  await out(`drawable-land-${d}`, 'splash.png', splash(h, w));
}
// the Play Store listing icon
await out('../../../../../release', 'play-icon-512.png', icon(512, 'square'));
console.log('icons drawn');
