// What the WhatsApp AI agent knows beyond the seller's own words, and what it remembers about each customer.
//   Documents — Vault files (catalogues, price lists, brochures, policies) read into passages: PDF, Word, Excel,
//               PowerPoint, CSV, text. A catalogue's products are also pulled out as rows (name, SKU, price, specs).
//   Search    — keyword search (SQLite FTS5: SKUs, model numbers, brand names) and meaning search (embeddings over
//               OpenRouter, int8 vectors kept per seller in SQLite), merged by rank. With no embedding key, keywords only.
//   Memory    — the customer's profile from the CRM (name, tags, stage, orders, bookings), a rolling summary of a
//               long chat, and lasting facts the agent learned about them (kept on the contact).
// The seller never sees which AI or embedding service is used.
import zlib from 'node:zlib';
import { T, q, tx, uid, JOBS, ordersByPhone } from './db.js';
import { decrypt } from './messaging.js';
import { platform } from './platform.js';
import { aiEnabled, aiJson } from './ai.js';
import { creditsShort, spendCredits } from './billing.js';
import { vaultBytes, aiFolder } from './vault.js';
import { pipelinesFor } from './crm.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);
const DAY = 86400000;
const TICK = Number(process.env.WA_KNOW_TICK_MS || 5000);
const DIMS = 1024;
const OR_BASE = () => String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

// ---------- storage the JSON tables can't do: full-text search and vectors ----------
// words include their marks (Hindi and other Indian scripts write vowels as marks: वारंटी is one word, not four)
const TOKENIZE = "tokenize=\"unicode61 remove_diacritics 2 categories 'L* N* Co Mc Mn'\"";
for (const [t, col] of [['kfts', 'chunkId'], ['kpfts', 'prodId']]) {
  const have = q("SELECT sql FROM sqlite_master WHERE name = ?").get(t)?.sql || '';
  if (have && !have.includes('categories')) q(`DROP TABLE ${t}`).run(); // made before Indian scripts were handled: rebuilt below
  q(`CREATE VIRTUAL TABLE IF NOT EXISTS ${t} USING fts5(text, ${col} UNINDEXED, userId UNINDEXED, docId UNINDEXED, ${TOKENIZE})`).run();
  if (have && !have.includes('categories')) {
    if (t === 'kfts') for (const c of T.kchunks.iter()) q('INSERT INTO kfts (text, chunkId, userId, docId) VALUES (?, ?, ?, ?)').run(`${T.kdocs.get(c.docId)?.name || ''}\n${c.text}`, c.id, c.userId, c.docId);
    else for (const p of T.kprods.iter()) q('INSERT INTO kpfts (text, prodId, userId, docId) VALUES (?, ?, ?, ?)').run([p.name, p.sku, p.category, p.specs].filter(Boolean).join(' · '), p.id, p.userId, p.docId);
  }
}
q('CREATE TABLE IF NOT EXISTS kvec (chunkId TEXT PRIMARY KEY, userId TEXT NOT NULL, docId TEXT NOT NULL, model TEXT NOT NULL, vec BLOB NOT NULL)').run();
q('CREATE INDEX IF NOT EXISTS ix_kvec_user ON kvec (userId, model)').run();
q('CREATE INDEX IF NOT EXISTS ix_kvec_doc ON kvec (docId)').run();

// ---------- embeddings (OpenRouter) ----------
const embedCfg = () => {
  const e = platform().embeddings || {};
  return { key: process.env.OPENROUTER_API_KEY || decrypt(e.keyEnc), model: process.env.EMBED_MODEL || e.model || 'nvidia/nemotron-3.5-embed-8b:free' };
};
// reading images and scanned pages: a vision model on the same OpenRouter key (a second one when the first is busy)
const VISION_BACKUP = 'google/gemma-4-31b-it:free';
const visionCfg = () => ({ key: embedCfg().key, model: process.env.VISION_MODEL || platform().embeddings?.vision || 'nvidia/nemotron-3.5-super-vl:free' });
export const visionReady = () => !!visionCfg().key;
export const visionModel = () => visionCfg().model;
const OCR_PROMPT = 'This is a page of an Indian business\'s catalogue, price list, brochure or document. Write out ALL of its text exactly, in reading order. Write each table row or product on one line as "Column: value · Column: value". Keep names, model codes, prices (₹), sizes and units exactly as printed. Return only the text, nothing else. If the page has no text, return nothing.';
// an image (data: URL) → its text
export async function readImage(dataUrl) {
  const cfg = visionCfg();
  if (!cfg.key) throw new Error('Reading images isn’t set up');
  const models = [...new Set([cfg.model, VISION_BACKUP])];
  for (let i = 0; i < models.length * 2; i++) {
    const model = models[i % models.length];
    let r, d;
    try {
      r = await fetch(`${OR_BASE()}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-Title': 'FunnelHive' }, signal: AbortSignal.timeout(120000),
        body: JSON.stringify({ model, max_tokens: 4000, temperature: 0, reasoning: { enabled: false }, messages: [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }] }) });
      d = JSON.parse((await r.text()).trim() || '{}');
    } catch { r = null; }
    const text = d?.choices?.[0]?.message?.content;
    if (r?.ok && typeof text === 'string') return text.trim();
    if (r && r.status !== 429 && r.status < 500 && r.ok === false) throw new Error(d?.error?.message || `HTTP ${r.status}`);
    await sleep(Math.min(20000, 2000 * 2 ** Math.floor(i / models.length)));
  }
  throw new Error('The image reader is busy — try “Read again” in a few minutes');
}
// raw pixels (from a PDF) → a PNG no wider or taller than 1,600 px (averaged down: enough to read print, small to send)
function pixelsToPng({ data, width, height, channels }) {
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const ch = channels === 4 ? 4 : channels === 1 ? 1 : 3;
  const out = Buffer.alloc(h * (w * ch + 1));
  for (let y = 0; y < h; y++) {
    out[y * (w * ch + 1)] = 0; // filter: none
    const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) / scale)));
      for (let c = 0; c < ch; c++) {
        let s = 0, n = 0;
        for (let yy = y0; yy < y1; yy += Math.max(1, Math.floor((y1 - y0) / 3))) for (let xx = x0; xx < x1; xx += Math.max(1, Math.floor((x1 - x0) / 3))) { s += data[(yy * width + xx) * channels + c]; n++; }
        out[y * (w * ch + 1) + 1 + x * ch + c] = n ? s / n : 0;
      }
    }
  }
  const crc = (b) => { const x = Buffer.alloc(4); x.writeUInt32BE(zlib.crc32(b) >>> 0); return x; };
  const part = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); return Buffer.concat([len, tb, crc(tb)]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = { 1: 0, 3: 2, 4: 6 }[ch];
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), part('IHDR', ihdr), part('IDAT', zlib.deflateSync(out)), part('IEND', Buffer.alloc(0))]);
}
const OCR_PAGES = Number(process.env.OCR_MAX_PAGES || 80); // a long scanned catalogue: the first 80 pages are read
export const embedReady = () => !!embedCfg().key;
export const embedModel = () => embedCfg().model;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// texts → unit vectors (Float32Array); rate limits are retried with a growing wait (documents), or not at all with a
// short time limit (a customer waiting for a reply: { retries: 0, timeoutMs: 5000 })
export async function embed(texts, cfg = embedCfg(), { retries = 4, timeoutMs = 60000 } = {}) {
  if (!cfg.key) throw new Error('Document search isn’t set up');
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    const input = texts.slice(i, i + 32).map((t) => String(t).slice(0, 8000));
    for (let attempt = 0; ; attempt++) {
      let r, d;
      try {
        r = await fetch(`${OR_BASE()}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-Title': 'FunnelHive' }, body: JSON.stringify({ model: cfg.model, input, dimensions: DIMS }), signal: AbortSignal.timeout(timeoutMs) });
        d = await r.json().catch(() => ({}));
      } catch { r = null; }
      if (r?.ok && Array.isArray(d.data) && d.data.length === input.length) {
        for (const x of [...d.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
          const v = Float32Array.from(x.embedding.slice(0, DIMS));
          let n = 0; for (const y of v) n += y * y;
          n = Math.sqrt(n) || 1;
          for (let k = 0; k < v.length; k++) v[k] /= n;
          out.push(v);
        }
        break;
      }
      const retry = !r || r.status === 429 || r.status >= 500;
      if (!retry || attempt >= retries) { console.error('embeddings failed', r?.status, d?.error?.message || ''); throw Object.assign(new Error(r?.status === 401 ? 'The document search key was refused' : 'Document search is busy — try again in a minute'), { status: r?.status }); }
      await sleep(Math.min(30000, 1500 * 2 ** attempt));
    }
  }
  return out;
}
// unit vector → int8 (1 byte a dimension); the dot product of two of these ≈ cosine × 127²
const toInt8 = (v) => Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127)))).buffer);
const dot8 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / 16129; };

// each process keeps a seller's vectors in memory until their documents change
const vecCache = new Map();
function vectorsOf(userId, model) {
  const ver = q('SELECT COUNT(*) AS n, MAX(rowid) AS m FROM kvec WHERE userId = ? AND model = ?').get(userId, model);
  const sig = `${ver.n}:${ver.m}`;
  const hit = vecCache.get(userId);
  if (hit?.sig === sig && hit.model === model) return hit.rows;
  const rows = q('SELECT chunkId, docId, vec FROM kvec WHERE userId = ? AND model = ?').all(userId, model).map((r) => ({ chunkId: r.chunkId, docId: r.docId, v: new Int8Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength) }));
  if (vecCache.size > 200) vecCache.delete(vecCache.keys().next().value);
  vecCache.set(userId, { sig, model, rows });
  return rows;
}
// a customer's question, embedded once for a few minutes (the same words come back often). A customer is waiting:
// at most QUERY_MS, no retries — and after a slow or failed call, keywords only for a minute (no added delay)
const QUERY_MS = Number(process.env.EMBED_QUERY_MS || 5000);
const qCache = new Map();
let slowUntil = 0;
async function queryVector(text) {
  const k = `${embedModel()}:${text}`;
  const c = qCache.get(k);
  if (c && Date.now() - c.at < 10 * 60000) return c.v;
  if (Date.now() < slowUntil) throw new Error('Meaning search is resting');
  let v;
  try { [v] = await embed([text], embedCfg(), { retries: 0, timeoutMs: QUERY_MS }); } catch (e) { slowUntil = Date.now() + 60000; throw e; }
  const i8 = new Int8Array(toInt8(v).buffer.slice(0));
  if (qCache.size > 500) qCache.delete(qCache.keys().next().value);
  qCache.set(k, { v: i8, at: Date.now() });
  return i8;
}

// ---------- reading files ----------
const decodeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const textOfXml = (xml, para) => decodeXml(xml.replace(new RegExp(`</${para}>`, 'g'), '\n').replace(/<[^>]+>/g, '')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
// long text without real pages (Word, plain text) → "pages" of about 3,000 characters at line breaks
function paginate(text, size = 3000) {
  const pages = []; let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length > size && cur) { pages.push(cur); cur = ''; }
    cur += `${line}\n`;
  }
  if (cur.trim()) pages.push(cur);
  return pages.map((t, i) => ({ n: i + 1, text: t.trim() }));
}
async function unzip(buf) { const { unzipSync, strFromU8 } = await import('fflate'); const z = unzipSync(new Uint8Array(buf)); return { z, s: (k) => (z[k] ? strFromU8(z[k]) : '') }; }
// rows of a CSV line, respecting quotes
function csvRows(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; continue; }
    if (c === '"') inQ = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
// a table → pages of lines "Header: value · Header: value" (so each line reads on its own when searched)
function tablePages(rows, title = '') {
  if (!rows.length) return [];
  const head = rows[0].map((h) => clip(h, 40));
  const lines = rows.slice(1).map((r) => r.map((v, i) => (String(v).trim() ? `${head[i] || `Col ${i + 1}`}: ${String(v).trim()}` : '')).filter(Boolean).join(' · ')).filter(Boolean);
  const pages = [];
  for (let i = 0; i < lines.length; i += 40) pages.push(`${title ? `${title}\n` : ''}${lines.slice(i, i + 40).join('\n')}`);
  return pages;
}
// → { pages: [{ n, text }], note } — note says why nothing could be read
export async function extractText(f, buf) {
  const ext = String(f.ext || f.name?.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') {
    const { getDocumentProxy, extractText: pdfText, extractImages } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: false });
    const pages = arr(text).map((t, i) => ({ n: i + 1, text: String(t).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() }));
    // pages that are pictures (a scanned catalogue, a designed brochure): the biggest image on the page is read by
    // the vision model
    const pictures = pages.filter((p) => p.text.length < 40);
    let read = 0, failed = 0;
    if (pictures.length && visionReady()) {
      for (const p of pictures.slice(0, OCR_PAGES)) {
        const imgs = await extractImages(pdf, p.n).catch(() => []);
        const big = imgs.filter((x) => x.width * x.height > 40000).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (!big) continue;
        try { p.text = [p.text, await readImage(`data:image/png;base64,${pixelsToPng(big).toString('base64')}`)].filter(Boolean).join('\n'); read++; } catch { failed++; }
      }
    }
    const usable = pages.filter((p) => p.text.length >= 3);
    const notes = [];
    if (read) notes.push(`${read} page${read > 1 ? 's' : ''} read from images.`);
    if (failed) notes.push(`${failed} page${failed > 1 ? 's' : ''} couldn’t be read right now — press “Read again” later.`);
    if (pictures.length > OCR_PAGES && visionReady()) notes.push(`Only the first ${OCR_PAGES} picture pages were read.`);
    if (pictures.length && !visionReady()) notes.push(pictures.length === pages.length ? 'This PDF is scanned images — reading them needs image reading switched on (Admin).' : `${pictures.length} page${pictures.length > 1 ? 's are' : ' is'} images and weren’t read.`);
    if (!usable.length) return { pages: [], total: pages.length, note: notes.join(' ') || 'No text found in this PDF' };
    return { pages: usable, total: pages.length, note: notes.join(' ') };
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) && visionReady()) {
    if (buf.length > 8 * 1024 * 1024) return { pages: [], note: 'This image is too large to read — save it under 8 MB.' };
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext];
    const t = await readImage(`data:${mime};base64,${buf.toString('base64')}`);
    return t ? { pages: [{ n: 1, text: t }], note: 'Read from the image.' } : { pages: [], note: 'No text found in this image' };
  }
  if (ext === 'docx') { const { s } = await unzip(buf); return { pages: paginate(textOfXml(s('word/document.xml'), 'w:p')) }; }
  if (ext === 'pptx') {
    const { z, s } = await unzip(buf);
    const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()));
    return { pages: slides.map((k, i) => ({ n: i + 1, text: textOfXml(s(k), 'a:p') })).filter((p) => p.text) };
  }
  if (ext === 'xlsx') {
    const { z, s } = await unzip(buf);
    const shared = [...s('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml(m[1].replace(/<[^>]+>/g, '')));
    const names = [...s('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
    const sheets = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()));
    const col = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    const pages = [];
    sheets.forEach((k, si) => {
      const rows = [...s(k).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rm) => {
        const r = [];
        for (const c of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1], t = /t="(\w+)"/.exec(c[1])?.[1];
          const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] || '')?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2] || '')?.[1] ?? '';
          if (ref) r[col(ref)] = t === 's' ? shared[Number(v)] ?? '' : decodeXml(v);
        }
        return Array.from(r, (x) => x ?? '');
      });
      for (const p of tablePages(rows, names[si] ? `Sheet: ${names[si]}` : '')) pages.push(p);
    });
    return { pages: pages.map((t, i) => ({ n: i + 1, text: t })) };
  }
  if (ext === 'csv') return { pages: tablePages(csvRows(buf.toString('utf8'))).map((t, i) => ({ n: i + 1, text: t })) };
  if (ext === 'txt') return { pages: paginate(buf.toString('utf8')) };
  if (['doc', 'xls', 'ppt'].includes(ext)) return { pages: [], note: `Old .${ext} files can’t be read — save it as .${ext}x or PDF and add it again.` };
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return { pages: [], note: 'Reading images needs image reading switched on (Admin) — add a PDF or Excel version meanwhile.' };
  if (['heic', 'heif'].includes(ext)) return { pages: [], note: 'iPhone HEIC photos can’t be read — save it as JPG or PNG and add it again.' };
  return { pages: [], note: 'This kind of file can’t be read' };
}
// a page → passages of about 1,200 characters, cut at line breaks, a little overlap so a sentence isn't lost between two
function chunk(pages) {
  const out = [];
  for (const p of pages) {
    const lines = p.text.split('\n');
    let cur = [];
    const flush = () => { const t = cur.join('\n').trim(); if (t.length > 20) out.push({ page: p.n, text: t }); };
    for (const l of lines) {
      // the overlap: the last line carried over only when it's short (a heading, a product row), never a paragraph
      if (cur.join('\n').length + l.length > 1200 && cur.length) { flush(); cur = cur.at(-1).length <= 200 ? [cur.at(-1)] : []; }
      cur.push(l.length > 1600 ? l.slice(0, 1600) : l);
    }
    flush();
  }
  return out;
}

// ---------- the processing queue (documents are read one at a time in the background) ----------
const KINDS = ['catalogue', 'document'];
export const docView = (d) => ({ id: d.id, fileId: d.fileId, name: d.name, kind: d.kind, send: d.send !== false, status: d.status, note: d.note || '', error: d.error || '', pages: d.pages || 0, chunks: d.chunks || 0, products: d.products || 0, vectors: d.vectors || 0, summary: d.summary || '', category: d.category || '', size: d.size || 0, at: d.at, doneAt: d.doneAt || null });
function dropIndex(docId) {
  tx(() => {
    T.kchunks.delWhere({ docId }); T.kprods.delWhere({ docId });
    q('DELETE FROM kfts WHERE docId = ?').run(docId); q('DELETE FROM kpfts WHERE docId = ?').run(docId); q('DELETE FROM kvec WHERE docId = ?').run(docId);
  });
}
export function removeDoc(d) { dropIndex(d.id); T.kdocs.del(d.id); }
// what's in the AI agent's documents for an account being deleted
export function dropAccountKnowledge(userId) { for (const t of ['kfts', 'kpfts', 'kvec']) q(`DELETE FROM ${t} WHERE userId = ?`).run(userId); }

const PRODUCT_PROMPT = `You read pages of an Indian business's catalogue or price list and list every product or service on them. Return ONLY JSON {"products":[{"name":"…","sku":"model / code if shown","price":number or null (the selling price in rupees, no symbols),"mrp":number or null,"unit":"per piece / per sq ft / per month… if shown","category":"…","specs":"key details in one line: sizes, colours, material, capacity…","page":number}]}. Copy names, codes and prices exactly; never invent one. Skip headings, terms and contact details. An empty list is fine.`;
async function readProducts(u, d, pages) {
  const found = [];
  let batch = [], size = 0;
  const run = async () => {
    if (!batch.length) return;
    if (creditsShort(u, 1)) { d.note = 'AI credits ran out before every product was read — the rest of the catalogue is still searchable.'; batch = []; return; }
    const text = batch.map((p) => `--- Page ${p.n} ---\n${p.text}`).join('\n\n');
    const r = await aiJson(PRODUCT_PROMPT, `Catalogue: ${d.name}\n\n${text}`).catch(() => null);
    spendCredits(u, 1);
    for (const p of arr(r?.products)) {
      const name = clip(p?.name, 160);
      if (!name) continue;
      const num = (v) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
      found.push({ name, sku: clip(p.sku, 60), price: num(p.price), mrp: num(p.mrp), unit: clip(p.unit, 40), category: clip(p.category, 60), specs: clip(p.specs, 400), page: Number(p.page) || batch[0].n });
    }
    batch = []; size = 0;
  };
  for (const p of pages) {
    if (size + p.text.length > 7000) await run();
    batch.push(p); size += p.text.length;
    if (found.length >= 3000) break;
  }
  await run();
  return found;
}
async function describe(u, d, pages) {
  if (!aiEnabled() || creditsShort(u, 1)) return null;
  const r = await aiJson('You describe a business document in a few words so an assistant can pick it for a customer. Return ONLY JSON {"summary":"one sentence: what it is and what it covers","category":"two or three words"}.', `File: ${d.name}\n\n${pages.slice(0, 3).map((p) => p.text).join('\n\n').slice(0, 5000)}`).catch(() => null);
  if (r) spendCredits(u, 1);
  return r ? { summary: clip(r.summary, 300), category: clip(r.category, 60) } : null;
}
export async function processDoc(id) {
  let d = T.kdocs.get(id);
  const u = d && T.users.get(d.userId), f = d && T.vaultFiles.get(d.fileId);
  if (!d || !u) return;
  if (!f || f.userId !== d.userId) { T.kdocs.update(id, (x) => { x.status = 'failed'; x.error = 'The file was deleted from your Vault'; }); return; }
  try {
    const { pages, note, total } = await extractText(f, await vaultBytes(f));
    dropIndex(id);
    const chunks = chunk(pages);
    d = T.kdocs.update(id, (x) => { x.pages = total || pages.length; x.note = note || ''; x.name = f.name; x.size = f.size; delete x.error; });
    // the passages and their keyword index
    const rows = chunks.map((c, n) => ({ id: uid(), userId: d.userId, docId: id, page: c.page, n, text: c.text, at: Date.now() }));
    tx(() => { for (const r of rows) { T.kchunks.insert(r); q('INSERT INTO kfts (text, chunkId, userId, docId) VALUES (?, ?, ?, ?)').run(`${f.name}\n${r.text}`, r.id, d.userId, id); } });
    const meta = pages.length ? await describe(u, d, pages) : null;
    const prods = d.kind === 'catalogue' && pages.length && aiEnabled() ? await readProducts(u, d, pages) : [];
    tx(() => {
      for (const p of prods) {
        const r = T.kprods.insert({ id: uid(), userId: d.userId, docId: id, ...p });
        q('INSERT INTO kpfts (text, prodId, userId, docId) VALUES (?, ?, ?, ?)').run([p.name, p.sku, p.category, p.specs].filter(Boolean).join(' · '), r.id, d.userId, id);
      }
    });
    // ready for keyword search now; the meaning-search vectors follow in the background (knowTick) — a slow or busy
    // embedding service never keeps a document from being used
    T.kdocs.update(id, (x) => {
      x.status = pages.length ? 'ready' : 'failed'; x.chunks = rows.length; x.products = prods.length; x.vectors = 0; x.model = ''; x.doneAt = Date.now();
      if (meta) { x.summary = meta.summary; x.category = meta.category; }
      if (!pages.length) x.error = note || 'No text found in this file';
    });
  } catch (e) {
    console.error('document processing failed', e.message);
    T.kdocs.update(id, (x) => { x.status = 'failed'; x.error = `Couldn’t read this file: ${clip(e.message, 160)}`; });
  }
}
let busy = false;
async function knowTick() {
  if (busy) return;
  busy = true;
  try {
    // one waiting document; one left "processing" by a restart goes again
    for (const st of T.kdocs.all({ status: 'processing', at: { lt: Date.now() - 30 * 60000 } }, { limit: 5 })) T.kdocs.update(st.id, (x) => { x.status = 'queued'; });
    const d = T.kdocs.find({ status: 'queued' }, { order: 'at' });
    if (d) { T.kdocs.update(d.id, (x) => { x.status = 'processing'; x.at = Date.now(); }); await processDoc(d.id); }
    // passages read while no key was set, or with another model: their vectors now
    if (!d && embedReady()) {
      const model = embedModel();
      // the one tried least often first, so a file the service keeps failing on doesn't block the others
      const doc = q("SELECT data FROM kdocs WHERE status = 'ready' AND json_extract(data, '$.chunks') > 0 AND IFNULL(json_extract(data, '$.model'), '') <> ? ORDER BY IFNULL(json_extract(data, '$.embedTries'), 0), at LIMIT 1").get(model);
      if (doc) {
        const x = JSON.parse(doc.data);
        const rows = T.kchunks.all({ docId: x.id }).sort((a, b) => a.n - b.n);
        try {
          const vs = await embed(rows.map((r) => `${x.name} (page ${r.page})\n${r.text}`), embedCfg(), { retries: 1, timeoutMs: 30000 }); // short, so new files aren't kept waiting behind it
          tx(() => { q('DELETE FROM kvec WHERE docId = ?').run(x.id); rows.forEach((r, i) => q('INSERT INTO kvec (chunkId, userId, docId, model, vec) VALUES (?, ?, ?, ?, ?)').run(r.id, x.userId, x.id, model, toInt8(vs[i]))); });
          T.kdocs.update(x.id, (y) => { y.vectors = vs.length; y.model = model; });
        } catch { T.kdocs.update(x.id, (y) => { y.embedTries = (y.embedTries || 0) + 1; }); /* busy — tried again on a later turn */ }
      }
    }
  } catch (e) { console.error('knowledge queue failed', e.message); }
  busy = false;
}
export function queueDoc(u, f, kind) {
  const have = T.kdocs.find({ userId: u.id, fileId: f.id });
  if (have) { T.kdocs.update(have.id, (x) => { x.status = 'queued'; x.kind = KINDS.includes(kind) ? kind : x.kind; x.at = Date.now(); }); return T.kdocs.get(have.id); }
  return T.kdocs.insert({ id: uid(), userId: u.id, fileId: f.id, name: f.name, size: f.size, kind: KINDS.includes(kind) ? kind : 'document', send: true, status: 'queued', at: Date.now() });
}
if (JOBS) setInterval(() => knowTick(), TICK).unref();
export const runKnowledgeQueue = knowTick;

// ---------- search ----------
// How Indian customers write (Hinglish, Hindi) → the English words business documents use, so keyword search finds
// "guarantee kitne saal" on the warranty page even when meaning search is off or busy. Filler words are dropped.
const HINGLISH = {
  kitna: 'price cost rate', kitne: 'price cost how many', kitni: 'price cost how many', kimat: 'price cost', keemat: 'price cost', daam: 'price cost', dam: 'price', bhav: 'price rate', rate: 'price rate', charges: 'price fee charges', fees: 'fee price',
  paisa: 'payment price', paise: 'payment price', bhugtan: 'payment', kist: 'emi instalment installment', kisht: 'emi instalment installment', emi: 'emi instalment finance loan', advance: 'advance booking amount payment', udhaar: 'credit payment',
  guarantee: 'warranty guarantee', garanti: 'warranty guarantee', gaurantee: 'warranty guarantee', warranty: 'warranty guarantee',
  kab: 'when time timeline days date delivery', tak: 'until timeline', jaldi: 'fast quick soon', samay: 'time timeline', time: 'time timeline days', din: 'days', mahina: 'month', mahine: 'months', saal: 'years year', varsh: 'years year',
  lagana: 'installation install', lagega: 'installation take time', lagate: 'install installation service', lagwana: 'installation', fitting: 'installation fitting',
  saaf: 'clean cleaning maintenance', safai: 'clean cleaning maintenance', dekhbhal: 'maintenance service', service: 'service maintenance', repair: 'repair service', kharab: 'repair complaint service',
  chhoot: 'discount offer', chhut: 'discount offer', discount: 'discount offer', offer: 'offer discount', sasta: 'cheap price budget', mehenga: 'expensive price', budget: 'budget price',
  subsidy: 'subsidy', sarkari: 'government subsidy scheme', yojana: 'scheme subsidy',
  ghar: 'home house', makaan: 'house home property', flat: 'flat apartment', jagah: 'location area place', kahan: 'location address where area', pata: 'address location', shahar: 'city', ilaka: 'area location',
  milega: 'available availability', milegi: 'available availability', available: 'available stock', stock: 'stock available', maal: 'stock product goods',
  bhejo: 'send delivery', bhejna: 'send delivery', delivery: 'delivery shipping', parcel: 'delivery shipping', courier: 'delivery shipping courier',
  wapas: 'return refund', vapas: 'return refund', refund: 'refund return', badalna: 'exchange replace return',
  size: 'size dimensions', naap: 'size measurement dimensions', rang: 'colour color', colour: 'colour color', color: 'colour color',
  timing: 'timings hours open', khula: 'open timings hours', band: 'closed holiday', chutti: 'holiday closed',
  batch: 'batch timings schedule', class: 'class session batch', course: 'course program', admission: 'admission enrolment',
  doctor: 'doctor consultation', ilaj: 'treatment', dawai: 'medicine', jaanch: 'test checkup',
  booking: 'booking appointment', appointment: 'appointment booking', visit: 'visit site visit', milna: 'meeting visit appointment',
  catalogue: 'catalogue catalog brochure', catalog: 'catalogue catalog brochure', brochure: 'brochure catalogue', list: 'list price list',
  // Devanagari
  'कीमत': 'price cost', 'दाम': 'price cost', 'कितना': 'price cost', 'कितने': 'price how many', 'गारंटी': 'warranty guarantee', 'वारंटी': 'warranty', 'किस्त': 'emi instalment', 'भुगतान': 'payment',
  'कब': 'when time delivery', 'साल': 'years', 'दिन': 'days', 'महीने': 'months', 'सब्सिडी': 'subsidy', 'छूट': 'discount offer', 'डिलीवरी': 'delivery', 'पता': 'address location', 'कहाँ': 'where location', 'सफाई': 'cleaning maintenance',
};
const FILLER = new Set(['ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'mai', 'main', 'hai', 'hain', 'ho', 'hoga', 'hogi', 'kya', 'aur', 'bhi', 'to', 'toh', 'na', 'ne', 'ye', 'yeh', 'woh', 'wo', 'koi', 'kuch', 'ji', 'sir', 'madam', 'please', 'pls', 'plz', 'bhai', 'the', 'is', 'are', 'a', 'an', 'of', 'for', 'and', 'or', 'can', 'do', 'you', 'me', 'my', 'i', 'it', 'in', 'on', 'what', 'how', 'karna', 'karo', 'kar', 'padta', 'padega', 'sakta', 'sakte', 'diya', 'dena', 'dene', 'lena', 'hum', 'aap', 'apka', 'aapka', 'tha', 'thi']);
// "subsidy kitna milega?" → '"subsidy"* OR "kitna"* OR "price"* OR "cost"* …' (any word may match; bm25 ranks)
export function ftsQuery(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{M}\p{N}]{2,}/gu) || [];
  const all = [];
  for (const w of words) {
    if (!FILLER.has(w)) all.push(w);
    const x = HINGLISH[w] || HINGLISH[w.replace(/(on|en|o|e|i|a)$/, '')];
    if (x) all.push(...x.split(' '));
  }
  return [...new Set(all)].slice(0, 24).map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
}
export const hasKnowledge = (userId) => T.kdocs.exists({ userId, status: 'ready' });
// → { passages: [{ docId, doc, page, text }], products: [...], docs: [docs worth sending] }
export async function searchKnowledge(u, text, { k = 6 } = {}) {
  const userId = u.id;
  const docs = new Map(T.kdocs.all({ userId, status: 'ready' }).map((d) => [d.id, d]));
  if (!docs.size || !String(text).trim()) return { passages: [], products: [], docs: [] };
  const ranks = new Map();
  const add = (id, rank) => ranks.set(id, (ranks.get(id) || 0) + 1 / (60 + rank));
  const fq = ftsQuery(text);
  if (fq) q('SELECT chunkId FROM kfts WHERE kfts MATCH ? AND userId = ? ORDER BY bm25(kfts) LIMIT 30').all(fq, userId).forEach((r, i) => add(r.chunkId, i));
  if (embedReady()) {
    try {
      const qv = await queryVector(String(text).slice(0, 2000));
      const rows = vectorsOf(userId, embedModel());
      rows.map((r) => [r.chunkId, dot8(qv, r.v)]).sort((a, b) => b[1] - a[1]).slice(0, 30).filter(([, s]) => s > 0.2).forEach(([id], i) => add(id, i));
    } catch (e) { /* keywords still work */ }
  }
  const top = [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => T.kchunks.get(id)).filter((c) => c && docs.has(c.docId));
  const passages = top.map((c) => ({ docId: c.docId, doc: docs.get(c.docId).name, page: c.page, text: c.text }));
  const products = fq ? q('SELECT prodId FROM kpfts WHERE kpfts MATCH ? AND userId = ? ORDER BY bm25(kpfts) LIMIT 12').all(fq, userId).map((r) => T.kprods.get(r.prodId)).filter((p) => p && docs.has(p.docId)).map((p) => ({ ...p, doc: docs.get(p.docId).name })) : [];
  // documents the customer could be sent: the ones the best passages and products came from, plus any whose name or summary fits
  const words = String(text).toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) || [];
  const score = new Map();
  passages.forEach((p, i) => score.set(p.docId, (score.get(p.docId) || 0) + (k - i)));
  products.forEach((p) => score.set(p.docId, (score.get(p.docId) || 0) + 1));
  for (const d of docs.values()) if (words.some((w) => `${d.name} ${d.summary || ''} ${d.category || ''}`.toLowerCase().includes(w))) score.set(d.id, (score.get(d.id) || 0) + 3);
  const sendable = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => docs.get(id)).filter((d) => d && d.send !== false).slice(0, 4);
  // the pages that matched, so a long PDF can be sent as just those pages
  const pagesOf = (id) => [...new Set([...passages.filter((p) => p.docId === id).map((p) => p.page), ...products.filter((p) => p.docId === id).map((p) => p.page)])].filter(Boolean).sort((a, b) => a - b).slice(0, 8);
  return { passages, products, docs: sendable.map((d) => ({ id: d.id, name: d.name, summary: d.summary || '', category: d.category || '', fileId: d.fileId, pages: d.pages || 0, pdf: /\.pdf$/i.test(d.name), matched: pagesOf(d.id) })) };
}
const money = (n) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
export function knowledgeBlock(found) {
  const parts = [];
  if (found.products.length) parts.push(`MATCHING PRODUCTS (from the catalogues)\n${found.products.map((p) => `- ${p.name}${p.sku ? ` [${p.sku}]` : ''}${p.price != null ? ` — ${money(p.price)}${p.unit ? ` ${p.unit}` : ''}` : ''}${p.mrp && p.mrp !== p.price ? ` (MRP ${money(p.mrp)})` : ''}${p.specs ? ` — ${p.specs}` : ''} (${p.doc}, p.${p.page})`).join('\n')}`);
  if (found.passages.length) parts.push(`RELEVANT PASSAGES (from the business's documents)\n${found.passages.map((p) => `[${p.doc}, page ${p.page}]\n${p.text}`).join('\n\n')}`);
  if (found.docs.length) parts.push(`DOCUMENTS YOU CAN SEND (attach with "send": [{"id":"…"}] — for a long PDF, send only the pages that answer the customer: {"id":"…","pages":[3,4]})\n${found.docs.map((d) => `- ${d.id}: ${d.name}${d.pages > 1 ? ` (${d.pages} pages${d.pdf && d.matched.length ? `; matched pages ${d.matched.join(', ')}` : ''})` : ''}${d.summary ? ` — ${d.summary}` : ''}`).join('\n')}`);
  return parts.join('\n\n');
}

// a few pages of a PDF as a new, smaller PDF (to send just the part of a catalogue the customer asked about)
export async function pdfPages(buf, pages) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  const want = [...new Set(pages.map(Number))].filter((p) => Number.isInteger(p) && p >= 1 && p <= n).sort((a, b) => a - b).slice(0, 10);
  if (!want.length || want.length >= n) return null;
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, want.map((x) => x - 1))) out.addPage(p);
  return { buf: Buffer.from(await out.save()), pages: want };
}
// "3, 4, 5, 8" → "3–5, 8"
export const pageLabel = (ps) => ps.reduce((acc, p) => { const last = acc.at(-1); if (last && p === last[1] + 1) last[1] = p; else acc.push([p, p]); return acc; }, []).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

// ---------- memory: who the customer is ----------
export function customerProfile(u, conv) {
  const lines = [];
  const m = conv.ckey ? T.crm.find({ userId: u.id, key: conv.ckey }) : null;
  const name = m?.name || conv.name;
  if (name) lines.push(`Name: ${name}`);
  if (m?.email) lines.push(`Email: ${m.email}`);
  if (m?.tags?.length) lines.push(`Tags: ${m.tags.slice(0, 12).join(', ')}`);
  const stages = m?.stages ? pipelinesFor(u.id).map((p) => { const s = p.stages.find((x) => x.id === m.stages[p.id]); return s ? `${p.name}: ${s.name}` : null; }).filter(Boolean) : [];
  if (stages.length) lines.push(`Stage: ${stages.join('; ')}`);
  const email = conv.ckey && !conv.ckey.startsWith('phone:') ? conv.ckey : m?.email;
  const orders = [...(email ? T.orders.all({ userId: u.id, ckey: String(email).toLowerCase() }, { order: 'at', desc: true, limit: 5 }) : []), ...ordersByPhone({ userId: u.id }, `+${conv.num}`)];
  const seen = new Set();
  const os = orders.filter((o) => !seen.has(o.id) && seen.add(o.id) && !o.demo).sort((a, b) => b.at - a.at).slice(0, 5);
  if (os.length) lines.push(`Orders: ${os.map((o) => `${(o.items || []).map((i) => i.name).filter(Boolean).join(' + ') || o.funnelName || 'order'} — ₹${Number(o.total || 0).toLocaleString('en-IN')} — ${o.status}${o.fulfilment?.status ? ` (${o.fulfilment.status})` : ''} — ${new Date(o.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`).join('; ')}`);
  const bks = conv.ckey ? T.bookings.all({ userId: u.id, ckey: conv.ckey, start: { gt: Date.now() - DAY } }, { order: 'start', limit: 3 }).filter((b) => b.status === 'confirmed') : [];
  if (bks.length) lines.push(`Upcoming bookings: ${bks.map((b) => new Date(b.start).toLocaleString('en-IN', { timeZone: u.settings?.timezone || 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })).join('; ')}`);
  const facts = arr(m?.aiFacts).map((f) => f.text).filter(Boolean);
  if (facts.length) lines.push(`What we know from earlier chats:\n${facts.map((f) => `- ${f}`).join('\n')}`);
  if (conv.memory?.text) lines.push(`Earlier in this chat (summary): ${conv.memory.text}`);
  return lines.join('\n');
}
// lasting facts the agent learned (budget, preferences, family, dates…), kept on the contact — newest win, 25 at most
export function rememberFacts(userId, ckey, facts) {
  const fresh = arr(facts).map((f) => clip(f, 200)).filter((f) => f.length > 3);
  if (!ckey || !fresh.length) return;
  const m = T.crm.find({ userId, key: ckey });
  if (!m) return;
  const have = arr(m.aiFacts);
  const low = new Set(have.map((f) => f.text.toLowerCase()));
  const add = fresh.filter((f) => !low.has(f.toLowerCase())).map((text) => ({ id: uid().slice(0, 10), text, at: Date.now() }));
  if (add.length) T.crm.update(m.id, (x) => { x.aiFacts = [...arr(x.aiFacts), ...add].slice(-25); });
}
// a long chat: what came before the last messages, summed up (once 12 more have gone past the window)
export async function refreshMemory(u, conv, window = 24) {
  const all = T.wachat.all({ convId: conv.id }, { order: 'at' }).filter((m) => m.dir !== 'note');
  if (all.length <= window + 6) return;
  const older = all.slice(0, -window);
  const upto = older.at(-1).at;
  if (conv.memory?.upto && older.filter((m) => m.at > conv.memory.upto).length < 12) return;
  if (!aiEnabled() || creditsShort(u, 1)) return;
  const fresh = older.filter((m) => !conv.memory?.upto || m.at > conv.memory.upto).slice(-200);
  const lines = fresh.map((m) => `${m.dir === 'in' ? 'Customer' : 'Business'}: ${clip(m.text || (m.media ? `[${m.media.type}]` : ''), 400)}`).join('\n');
  const r = await aiJson('You keep a short running summary of a WhatsApp chat between a business and a customer, for the business\'s assistant to read later. Merge the previous summary with the new messages. Keep what matters: what they want, details they gave (budget, dates, sizes, places), what was offered or promised, prices quoted, open questions. Under 120 words, plain English. Return ONLY JSON {"summary":"…"}.', `Previous summary: ${conv.memory?.text || '(none)'}\n\nNew messages:\n${lines}`).catch(() => null);
  if (!r?.summary) return;
  spendCredits(u, 1);
  T.waconvs.update(conv.id, (c) => { c.memory = { text: clip(r.summary, 1200), upto, at: Date.now() }; });
}
// a chat a person handled, once resolved: the lasting facts in it go to the contact
export async function learnFromChat(u, conv) {
  if (!conv.ckey || !aiEnabled() || creditsShort(u, 1)) return;
  const msgs = T.wachat.all({ convId: conv.id }, { order: 'at', desc: true, limit: 40 }).reverse().filter((m) => m.dir !== 'note' && m.text);
  if (msgs.filter((m) => m.dir === 'in').length < 2) return;
  const r = await aiJson('From a WhatsApp chat between a business and a customer, list lasting facts about the CUSTOMER worth remembering next time (needs, budget, preferences, family, location, important dates, what they bought or decided). Short, specific, one fact each; nothing about this chat\'s small talk. Return ONLY JSON {"facts":["…"]} (an empty list is fine).', msgs.map((m) => `${m.dir === 'in' ? 'Customer' : 'Business'}: ${clip(m.text, 400)}`).join('\n')).catch(() => null);
  if (!r) return;
  spendCredits(u, 1);
  rememberFacts(u.id, conv.ckey, r.facts);
}

// ---------- API: the agent's documents (team area "WhatsApp inbox & chatbots", see team.js) ----------
export function registerWaKnowledge(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Please wait a minute and try again.' });
  const own = (req, res) => { const d = T.kdocs.get(req.params.id); if (!d || d.userId !== req.user.id) { res.status(404).json({ error: 'Document not found' }); return null; } return d; };
  const list = (userId) => T.kdocs.all({ userId }, { order: 'at', desc: true }).map(docView);
  app.get('/api/wa-agent/docs', auth, (req, res) => res.json({ docs: list(req.user.id), search: embedReady() ? 'smart' : 'keywords', ai: aiEnabled() }));
  // { fileIds: [Vault file ids], kind: 'catalogue' | 'document' } — read in the background, one at a time
  app.post('/api/wa-agent/docs', auth, limiter, (req, res) => {
    const ids = arr(req.body?.fileIds).map(String).slice(0, 50);
    const files = ids.map((id) => T.vaultFiles.get(id)).filter((f) => f && f.userId === req.user.id);
    if (!files.length) return res.status(400).json({ error: 'Choose files from your Vault' });
    if (T.kdocs.count({ userId: req.user.id }) + files.length > 500) return res.status(400).json({ error: 'The AI agent can learn from up to 500 documents' });
    for (const f of files) queueDoc(req.user, f, req.body?.kind);
    res.json({ docs: list(req.user.id) });
  });
  // { kind?, send? } — a new kind is read again (catalogues get their products listed)
  app.patch('/api/wa-agent/docs/:id', auth, (req, res) => {
    const d = own(req, res); if (!d) return;
    const b = req.body || {};
    T.kdocs.update(d.id, (x) => {
      if (typeof b.send === 'boolean') x.send = b.send;
      if (KINDS.includes(b.kind) && b.kind !== x.kind) { x.kind = b.kind; x.status = 'queued'; x.at = Date.now(); }
    });
    res.json({ docs: list(req.user.id) });
  });
  app.post('/api/wa-agent/docs/:id/reprocess', auth, limiter, (req, res) => { const d = own(req, res); if (!d) return; T.kdocs.update(d.id, (x) => { x.status = 'queued'; x.at = Date.now(); }); res.json({ docs: list(req.user.id) }); });
  // the agent forgets it (the file stays in the Vault)
  app.delete('/api/wa-agent/docs/:id', auth, (req, res) => { const d = own(req, res); if (!d) return; removeDoc(d); res.json({ docs: list(req.user.id) }); });
  app.get('/api/wa-agent/docs/:id/products', auth, (req, res) => { const d = own(req, res); if (!d) return; res.json({ products: T.kprods.all({ docId: d.id }).slice(0, 3000).map(({ id, name, sku, price, mrp, unit, category, specs, page }) => ({ id, name, sku, price, mrp, unit, category, specs, page })) }); });
  // "what would the agent find for this question?" — for the seller to check
  app.post('/api/wa-agent/search', auth, limiter, async (req, res) => {
    const text = clip(req.body?.q, 500);
    if (!text) return res.status(400).json({ error: 'Type a question a customer might ask' });
    try { res.json(await searchKnowledge(req.user, text, { k: 6 })); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  // where uploads for the agent go in the Vault
  app.get('/api/wa-agent/folder', auth, (req, res) => res.json({ folderId: aiFolder(req.user.id).id }));
}
