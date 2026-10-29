// ESC/POS receipts for 58 mm (32 characters) and 80 mm (48 characters) Bluetooth thermal printers. Pure functions —
// no browser APIs — so node:test can check them (client/test/escpos.test.mjs).
// Thermal printers print ASCII reliably and little else: ₹ becomes "Rs.", typographic quotes and dashes become plain
// ones, accented letters lose their accents, Hindi (Devanagari) is spelt out in Latin letters, and anything else
// that can't be printed is dropped.

export const WIDTHS = { 58: 32, 80: 48 };

// ---------- text that a printer can print ----------
const SWAP = { '₹': 'Rs.', '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '–': '-', '—': '-', '−': '-', '‐': '-', '…': '...', '×': 'x', '•': '*', '·': '.', ' ': ' ', ' ': ' ', ' ': ' ', '€': 'EUR', '£': 'GBP', '©': '(c)', '®': '(R)', '™': 'TM', '½': '1/2', '¼': '1/4', '¾': '3/4', '°': 'o', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L' };
// Devanagari → Latin, the way shop names are usually written in English (चाय → chaay, दूध → doodh, साबुन → saabun)
const CONS = { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f' };
for (const k of Object.keys(CONS)) { const n = k.normalize('NFC'); if (n !== k) CONS[n] = CONS[k]; } // क़ etc. arrive as क + ़
const VOWEL = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॐ': 'om' };
const MATRA = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const SIGN = { 'ं': 'n', 'ँ': 'n', 'ः': 'h', '।': '.', '॥': '.' };
const VIRAMA = '्', NUKTA = '़';
const isDeva = (c) => c >= 'ऀ' && c <= 'ॿ';
function deva(s) {
  let out = '';
  const ch = [...s.normalize('NFC')];
  for (let i = 0; i < ch.length; i++) {
    let c = ch[i];
    if (ch[i + 1] === NUKTA && CONS[c + NUKTA]) { c += NUKTA; i++; }
    if (CONS[c]) {
      out += CONS[c];
      let n = ch[i + 1];
      if (n === NUKTA) { i++; n = ch[i + 1]; }
      if (MATRA[n]) { out += MATRA[n]; i++; } else if (n === VIRAMA) i++;
      else if (n && isDeva(n) && n !== '।' && n !== '॥') out += 'a'; // the inherent a, dropped at the end of a word (schwa deletion)
      continue;
    }
    if (VOWEL[c]) { out += VOWEL[c]; continue; }
    if (SIGN[c] != null) { out += SIGN[c]; continue; }
    if (c >= '०' && c <= '९') { out += String(c.charCodeAt(0) - 0x966); continue; }
    if (c === NUKTA || c === VIRAMA || MATRA[c]) continue;
    out += c;
  }
  return out;
}
export function printable(s) {
  let t = String(s ?? '');
  if (/[ऀ-ॿ]/.test(t)) t = deva(t);
  t = [...t].map((c) => (SWAP[c] != null ? SWAP[c] : c)).join('');
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // é → e
  return t.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '').replace(/ {2,}/g, ' ').trim();
}

// ---------- layout helpers (all widths in characters) ----------
export const money = (n) => {
  const x = Number(n) || 0, v = Math.round(Math.abs(x) * 100 + 1e-6) / 100, neg = x < 0 && v > 0; // half away from zero
  const [i, d] = v.toFixed(2).split('.');
  const grouped = i.length > 3 ? `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i.slice(-3)}` : i; // 12,34,567.00
  return `${neg ? '-' : ''}${grouped}.${d}`;
};
const qty = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);
const fit = (s, w) => (s.length > w ? s.slice(0, w) : s);
export const padR = (s, w) => fit(s, w).padEnd(w);
export const padL = (s, w) => fit(s, w).padStart(w);
export const center = (s, w) => { const t = fit(s, w); const l = Math.floor((w - t.length) / 2); return ' '.repeat(l) + t; };
// left text and right text on one line; the left side gives way (wrapped above) when both don't fit
export function lr(left, right, w) {
  const room = w - right.length - 1;
  if (left.length <= room) return [left + ' '.repeat(w - left.length - right.length) + right];
  const lines = wrap(left, w);
  const last = lines[lines.length - 1];
  if (last.length <= room) { lines[lines.length - 1] = last + ' '.repeat(w - last.length - right.length) + right; return lines; }
  return [...lines, padL(right, w)];
}
export function wrap(s, w) {
  const words = String(s).split(' ').filter(Boolean), lines = [];
  let cur = '';
  for (let word of words) {
    while (word.length > w) { if (cur) { lines.push(cur); cur = ''; } lines.push(word.slice(0, w)); word = word.slice(w); }
    if (!word) continue;
    if (!cur) cur = word; else if (cur.length + 1 + word.length <= w) cur += ` ${word}`; else { lines.push(cur); cur = word; }
  }
  if (cur || !lines.length) lines.push(cur);
  return lines;
}

// amount in words, Indian numbering (the same words as the A4 invoice)
export function amountInWords(n) {
  const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? `-${a[x % 10]}` : ''}`);
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} hundred${x % 100 ? ` ${two(x % 100)}` : ''}` : two(x));
  const v = Math.abs(Number(n) || 0);
  let r = Math.floor(v); const out = [];
  for (const [d, w] of [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) if (r >= d) { out.push(`${three(Math.floor(r / d))} ${w}`); r %= d; }
  if (r) out.push(three(r));
  const p = Math.round((v - Math.floor(v)) * 100);
  const s = `${out.join(' ') || 'zero'} rupees${p ? ` and ${two(p)} paise` : ''} only`;
  return s[0].toUpperCase() + s.slice(1);
}

export const upiLink = ({ id, name }, amount, note) => `upi://pay?${[['pa', id], ['pn', name || ''], ['am', (Math.round(Number(amount) * 100) / 100).toFixed(2)], ['cu', 'INR'], ['tn', note || '']].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
const PAY = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'On credit (udhaar)' };
const ddmmyyyy = (d) => String(d || '').split('-').reverse().join('-');

// ---------- the receipt as a list of print operations ----------
// bill: a counter bill (server's or priced offline), with seller, buyer, lines, cgst/sgst/igst, round_off, total.
// opts: { width: 32 | 48, upi: { id, name } | null, qr: true, footer: 'Thank you' }
// → [{ text, align: 'left'|'center', bold, size: 'normal'|'tall'|'big' } | { rule } | { qr } | { feed }]
export function receiptOps(bill, { width = 32, upi = null, qr = true, footer = 'Thank you! Visit again.' } = {}) {
  const w = WIDTHS[width] || (width === 48 ? 48 : 32), ops = [];
  const add = (text, o = {}) => ops.push({ text: printable(text), align: 'left', bold: false, size: 'normal', ...o });
  const rule = (c = '-') => ops.push({ rule: c.repeat(w) });
  const each = (lines, o) => lines.forEach((t) => ops.push({ text: t, pre: true, align: 'left', bold: false, size: 'normal', ...o })); // laid out already: printed as is
  const sel = bill.seller || {}, tax = bill.doc_type === 'TAX_INVOICE', intra = bill.intra !== false;
  // the seller: the name big when it fits at double width, else tall
  const name = printable(sel.name || 'Bill');
  ops.push({ text: name, align: 'center', bold: true, size: name.length <= Math.floor(w / 2) ? 'big' : 'tall' });
  if (sel.address) wrap(printable(sel.address), w).forEach((t) => add(t, { align: 'center' }));
  if (sel.phone) add(`Ph: ${sel.phone}`, { align: 'center' });
  if (sel.gstin) add(`GSTIN: ${sel.gstin}`, { align: 'center', bold: true });
  add(tax ? 'TAX INVOICE' : 'BILL', { align: 'center', bold: true });
  rule();
  each(lr(printable(`Bill: ${bill.number || 'pending'}`), printable(ddmmyyyy(bill.day)), w));
  if (bill.offline_pending) add('Saved offline - number on sync');
  const buyer = bill.buyer || null, party = printable(bill.party_name || buyer?.name || '');
  if (party) each(wrap(`To: ${party}${bill.party_phone ? ` (${printable(bill.party_phone)})` : ''}`, w));
  if (buyer?.gstin) add(`Buyer GSTIN: ${buyer.gstin}`);
  if (tax && bill.place_of_supply) add(`Place of supply: ${bill.place_of_supply}${bill.pos_code ? ` (${bill.pos_code})` : ''}`);
  rule();
  // lines: 32 → item | qty | amount, rate and GST % below; 48 → item | qty | rate | amount, GST % below when it wraps
  const wide = w >= 48, cq = wide ? 6 : 6, cr = wide ? 10 : 0, ca = wide ? 11 : 10, cn = w - cq - cr - ca;
  each([padR('Item', cn) + padL('Qty', cq) + (wide ? padL('Rate', cr) : '') + padL('Amount', ca)], { bold: true });
  for (const l of bill.lines || []) {
    const nm = wrap(printable(l.name), cn - 1);
    const q = `${qty(l.qty)}${l.free_qty ? `+${qty(l.free_qty)}` : ''}`;
    each([padR(nm[0], cn) + padL(q, cq) + (wide ? padL(money(l.rate), cr) : '') + padL(money(l.amount), ca)]);
    each(nm.slice(1).map((t) => `${t}`));
    const sub = [wide ? '' : `@${money(l.rate)}`, `GST ${l.gst_percent || 0}%`, l.hsn ? `HSN ${l.hsn}` : '', l.scheme ? printable(l.scheme.name) : '', l.discount ? `-${money(l.discount)}` : ''].filter(Boolean).join(' ');
    each(wrap(sub, w - 2).map((t) => `  ${t}`));
  }
  rule();
  const row = (label, value, o) => each(lr(label, value, w), o);
  row('Taxable value', money(bill.taxable));
  if (bill.discount) row('Scheme discount (incl.)', `-${money(bill.discount)}`);
  if (intra) { row('CGST', money(bill.cgst ?? (bill.gst || 0) / 2)); row('SGST', money(bill.sgst ?? (bill.gst || 0) / 2)); } else row('IGST', money(bill.igst ?? bill.gst));
  if (bill.round_off) row('Round off', money(bill.round_off));
  rule('=');
  ops.push({ text: lr('TOTAL', `Rs.${money(bill.total)}`, w)[0], pre: true, align: 'left', bold: true, size: 'tall' });
  rule('=');
  const mode = bill.credit ? 'credit' : bill.pay_mode;
  if (PAY[mode]) row('Paid by', PAY[mode]);
  each(wrap(amountInWords(bill.total), w));
  if (!tax) add('Not a tax invoice');
  if (upi?.id && qr && mode !== 'cash' && Number(bill.total) > 0) {
    ops.push({ feed: 1 });
    add(mode === 'credit' ? 'Scan to pay by UPI' : 'Pay by UPI', { align: 'center' });
    ops.push({ qr: upiLink(upi, bill.total, bill.number || ''), align: 'center' });
    add(upi.id, { align: 'center' });
  }
  ops.push({ feed: 1 });
  add(footer || 'Thank you', { align: 'center', bold: true });
  ops.push({ feed: 3 });
  return ops;
}

// the receipt as plain text lines (what the paper shows, without sizes) — for a preview and for tests
export function receiptText(bill, opts = {}) {
  const w = WIDTHS[opts.width] || (opts.width === 48 ? 48 : 32);
  return receiptOps(bill, opts).flatMap((o) => {
    if (o.rule) return [o.rule];
    if (o.qr) return ['[UPI QR]'];
    if (o.feed) return Array(o.feed).fill('');
    const cw = o.size === 'big' ? Math.floor(w / 2) : w;
    return (o.pre ? [o.text] : wrap(o.text, cw)).map((t) => (o.align === 'center' ? center(t, cw) : t));
  });
}

// ---------- ESC/POS bytes ----------
const ESC = 0x1b, GS = 0x1d;
const ascii = (s) => Array.from(s, (c) => { const n = c.charCodeAt(0); return n >= 0x20 && n <= 0x7e ? n : 0x3f; });
export function qrBytes(data, moduleSize = 6) {
  const d = ascii(data), n = d.length + 3;
  return [
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // model 2
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize, // module size
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // error correction M
    GS, 0x28, 0x6b, n & 0xff, (n >> 8) & 0xff, 0x31, 0x50, 0x30, ...d, // store
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // print
  ];
}
export function encodeReceipt(bill, opts = {}) {
  const w = WIDTHS[opts.width] || (opts.width === 48 ? 48 : 32);
  const out = [ESC, 0x40, ESC, 0x74, 0x00]; // initialise; code page 437 (plain ASCII is all we send)
  const SIZE = { normal: 0x00, tall: 0x01, big: 0x11 };
  for (const o of receiptOps(bill, opts)) {
    if (o.feed) { out.push(ESC, 0x64, o.feed); continue; }
    if (o.rule) { out.push(ESC, 0x61, 0, ...ascii(o.rule), 0x0a); continue; }
    if (o.qr) { out.push(ESC, 0x61, 1, ...qrBytes(o.qr), 0x0a, ESC, 0x61, 0); continue; }
    const cw = o.size === 'big' ? Math.floor(w / 2) : w;
    out.push(ESC, 0x61, o.align === 'center' ? 1 : 0, ESC, 0x45, o.bold ? 1 : 0, GS, 0x21, SIZE[o.size] || 0);
    for (const t of o.pre ? [o.text] : wrap(o.text, cw)) out.push(...ascii(t), 0x0a);
    out.push(ESC, 0x45, 0, GS, 0x21, 0);
  }
  out.push(ESC, 0x61, 0, GS, 0x56, 0x42, 0x00); // partial cut (printers without a cutter ignore it)
  return Uint8Array.from(out);
}

// ---------- sending bytes over Bluetooth LE ----------
// A BLE write carries MTU − 3 bytes: 20 on many cheap printers, ~180 or more on others. Start at the size that worked
// last time (or 180); a failed write is retried, and after two failures the chunk size halves (down to 20). A short
// pause between chunks keeps a slow printer's buffer from overflowing. write(chunk) is the characteristic's write.
export async function sendChunks(bytes, write, { size = 180, min = 20, retries = 4, pause = 15, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let at = 0, cur = Math.max(min, size), fails = 0, tries = 0;
  while (at < bytes.length) {
    const chunk = bytes.slice(at, at + cur);
    try {
      await write(chunk);
      at += chunk.length; fails = 0;
      if (pause && at < bytes.length) await sleep(pause);
    } catch (e) {
      tries++; fails++;
      if (tries > retries + Math.ceil(Math.log2(Math.max(1, size / min)))) throw e;
      if (fails >= 2 && cur > min) { cur = Math.max(min, Math.floor(cur / 2)); fails = 0; }
      await sleep(Math.min(400, 50 * tries));
    }
  }
  return { size: cur };
}
