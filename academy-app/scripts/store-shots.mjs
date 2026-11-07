// Google Play listing images, rendered by headless Chrome from the app's own screens:
// two phone screenshots (1080 × 1920, 9:16) and two feature graphics (1024 × 500). Output: academy-app/store/
//   node scripts/store-shots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store');
mkdirSync(out, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const PORT = 9333, profile = join(tmpdir(), `aa-shots-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tab;
for (let i = 0; i < 50 && !tab; i++) { await sleep(200); tab = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const waits = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waits.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

async function shot(name, { url, width, height, scale, mobile, before }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await send('Page.navigate', { url });
  await sleep(900);
  if (before) { await run(before); await send('Page.reload'); await sleep(1200); }
  await run('document.fonts.ready');
  await sleep(600);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, name), Buffer.from(data, 'base64'));
  console.log('wrote', name);
}

const app = pathToFileURL(join(root, 'www', 'index.html')).href;
const phone = { width: 360, height: 640, scale: 3, mobile: true };
// 1: the first-run tour (screenshots and recordings blocked)
await shot('screenshot-1-protected.png', { ...phone, url: app, before: "localStorage.clear(); localStorage.setItem('aa_tour_done','0')" });
// 2: home with two academies on the phone
const academies = JSON.stringify([
  { handle: 'paisa-panchatantra', name: 'Paisa Panchatantra Academy', tagline: 'Money stories that make sense', logo: '', cover: '', color: '#f59e0b', last: Date.now() },
  { handle: 'yoga-with-ananya', name: 'Yoga with Ananya', tagline: 'Daily practice, at your pace', logo: '', cover: '', color: '#22c55e', last: Date.now() - 86400000 },
]);
await shot('screenshot-2-home.png', { ...phone, url: app, before: `localStorage.clear(); localStorage.setItem('aa_tour_done','1'); localStorage.setItem('aa_academies', ${JSON.stringify(academies)})` });
// feature graphics
for (const n of [1, 2]) await shot(`feature-graphic-${n}.png`, { width: 1024, height: 500, scale: 1, mobile: false, url: pathToFileURL(join(root, 'scripts', `feature-${n}.html`)).href });

ws.close(); chrome.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
