// Counter mode's pure helpers: the ESC/POS receipt (bytes, column alignment at 32 / 48 characters, ₹ and Hindi on a
// printer that only has ASCII), chunked Bluetooth writes with retries, and offline pricing from the cached catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeReceipt, receiptText, printable, money, amountInWords, sendChunks, qrBytes, upiLink, lr } from '../src/counter/escpos.js';
import { priceOffline } from '../src/counter/pricing.js';

const bill = {
  number: 'CB/2026-27/0007', day: '2026-10-30', doc_type: 'TAX_INVOICE', intra: true, pay_mode: 'upi', party_name: 'Asha', party_phone: '9876543210',
  seller: { name: 'Sharma Kirana', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra', address: 'Shop 4, MG Road, Pune' },
  lines: [
    { name: 'Tata Salt 1kg', qty: 2, rate: 25, amount: 52.5, gst_percent: 5, hsn: '2501', taxable: 50, gst: 2.5 },
    { name: 'साबुन (Lux) — 100g ₹', qty: 3, free_qty: 1, rate: 40, amount: 141.6, gst_percent: 18, taxable: 120, gst: 21.6, scheme: { name: 'Buy 3 get 1 free' } },
  ],
  taxable: 170, discount: 0, cgst: 12.05, sgst: 12.05, igst: 0, round_off: -0.1, total: 194,
};

test('₹, quotes, accents and Hindi become ASCII a thermal printer can print', () => {
  assert.equal(printable('₹1,250 — “Diwali” offer'), 'Rs.1,250 - "Diwali" offer');
  assert.equal(printable('Café crème'), 'Cafe creme');
  assert.equal(printable('चाय'), 'chaay');
  assert.equal(printable('दूध'), 'doodh');
  assert.equal(printable('साबुन'), 'saabun');
  assert.equal(printable('नमक १ किलो'), 'namak 1 kilo');
  assert.equal(printable('平和 tea'), 'tea', 'what can’t be spelt out is dropped');
  for (const c of printable('ग़ज़ल ॐ ₹ ক')) assert.ok(c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e);
});

test('money in Indian grouping; amount in words', () => {
  assert.equal(money(1234567.5), '12,34,567.50');
  assert.equal(money(999), '999.00');
  assert.equal(money(-12.345), '-12.35');
  assert.equal(amountInWords(194), 'One hundred ninety-four rupees only');
  assert.equal(amountInWords(150000.5), 'One lakh fifty thousand rupees and fifty paise only');
});

for (const width of [32, 48]) {
  test(`a ${width}-column receipt: every line fits, numbers line up on the right`, () => {
    const lines = receiptText(bill, { width, upi: { id: 'sharma@okhdfcbank', name: 'Sharma Kirana' } });
    for (const l of lines) assert.ok(l.length <= width, `“${l}” is ${l.length} long`);
    for (const l of lines) assert.match(l, /^[\x20-\x7e]*$/);
    const text = `${lines.join('\n')}\n${lines.map((l) => l.trim()).join(' ')}`; // wrapped phrases read across lines too
    for (const s of ['Sharma Kirana', 'GSTIN: 27ABCDE1234F1Z5', 'TAX INVOICE', 'CB/2026-27/0007', '30-10-2026', 'CGST', 'SGST', 'TOTAL', 'Rs.194.00', 'One hundred ninety-four rupees only', 'Thank you', '[UPI QR]', 'saabun (Lux) -']) assert.ok(text.includes(s), `missing ${s}\n${text}`);
    assert.ok(!text.includes('IGST'));
    // the amount column ends at the right edge on the item rows and totals
    const salt = lines.find((l) => l.startsWith('Tata Salt'));
    assert.ok(salt.endsWith('52.50') && salt.length === width, salt);
    for (const label of ['Taxable value', 'CGST', 'SGST', 'TOTAL']) { const l = lines.find((x) => x.startsWith(label)); assert.equal(l.length, width, l); }
    assert.ok(lines.find((l) => l.startsWith('Taxable value')).endsWith('170.00'));
    const head = lines.find((l) => l.startsWith('Item'));
    assert.equal(head.length, width);
    assert.ok(head.endsWith('Amount'));
    if (width === 48) assert.ok(salt.includes('25.00'), 'the rate has its own column at 80 mm');
    else assert.ok(lines.some((l) => l.includes('@25.00') && l.includes('GST 5%')), 'the rate goes below at 58 mm');
  });
}

test('IGST for another state; a plain bill without GSTIN; no UPI QR on a cash bill', () => {
  const t = receiptText({ ...bill, intra: false, igst: 24.1, cgst: 0, sgst: 0 }, { width: 32 }).join('\n');
  assert.ok(t.includes('IGST') && !t.includes('CGST'));
  const plain = receiptText({ ...bill, doc_type: 'BILL', seller: { name: 'Sharma Kirana' }, pay_mode: 'cash' }, { width: 32, upi: { id: 'sharma@okhdfcbank' } }).join('\n');
  assert.ok(plain.includes('Not a tax invoice') && !plain.includes('TAX INVOICE'));
  assert.ok(!plain.includes('[UPI QR]'));
  assert.ok(plain.includes('Paid by') && plain.includes('Cash'));
});

test('ESC/POS bytes: initialise, ASCII only between commands, a QR command with the UPI link, a cut at the end', () => {
  const b = encodeReceipt(bill, { width: 32, upi: { id: 'sharma@okhdfcbank', name: 'Sharma Kirana' } });
  assert.ok(b instanceof Uint8Array);
  assert.deepEqual([...b.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 0x00]);
  assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 0x00]);
  const link = upiLink({ id: 'sharma@okhdfcbank', name: 'Sharma Kirana' }, 194, 'CB/2026-27/0007');
  assert.equal(link, 'upi://pay?pa=sharma%40okhdfcbank&pn=Sharma%20Kirana&am=194.00&cu=INR&tn=CB%2F2026-27%2F0007');
  const q = qrBytes(link);
  const at = b.indexOf(0x50, 0) >= 0 && Buffer.from(b).indexOf(Buffer.from(q));
  assert.ok(at > 0, 'the QR block is in the receipt');
  const n = link.length + 3;
  assert.deepEqual(q.slice(25, 33), [0x1d, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30]);
  assert.ok(Buffer.from(b).includes(Buffer.from('Rs.194.00')));
  assert.ok(!Buffer.from(b).includes(Buffer.from('₹')));
  // a known line, byte for byte: left-aligned, normal size, then the text and a line feed
  assert.ok(Buffer.from(b).includes(Buffer.from(`${lr('Taxable value', '170.00', 32)[0]}\n`)));
  // the seller's name at double size, centred, bold
  const name = Buffer.from(b).indexOf(Buffer.from('Sharma Kirana'));
  assert.deepEqual([...b.slice(name - 9, name)], [0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11]);
});

test('Bluetooth writes go in chunks; a failing size is retried, then halved', async () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
  const got = [];
  await sendChunks(bytes, async (c) => { got.push(c.length); }, { size: 180, pause: 0, sleep: async () => {} });
  assert.deepEqual(got, [180, 180, 180, 180, 180, 100]);
  // a printer that takes at most 50 bytes and drops one write now and then
  const out = [];
  let calls = 0;
  const r = await sendChunks(bytes, async (c) => { calls++; if (c.length > 50 || calls === 7) throw new Error('GATT write failed'); out.push(...c); }, { size: 180, pause: 0, sleep: async () => {} });
  assert.deepEqual(Uint8Array.from(out), bytes, 'every byte once, in order');
  assert.ok(r.size <= 50 && r.size >= 20);
  await assert.rejects(sendChunks(bytes, async () => { throw new Error('gone'); }, { size: 40, pause: 0, sleep: async () => {} }), /gone/);
});

test('offline pricing matches the server’s rules: rate list, schemes, CGST/SGST vs IGST, rounding', () => {
  const catalog = {
    seller: { name: 'S', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' }, states: { Maharashtra: '27', Karnataka: '29' },
    items: [{ id: 'a', name: 'Soap', sale_rate: 40, gst_percent: 18 }, { id: 'b', name: 'Rice', sale_rate: 55.5, gst_percent: 5 }],
    schemes: [{ id: 's', itemId: 'a', kind: 'FREE', buy: 3, free: 1, name: 'Buy 3 get 1' }, { id: 'p', itemId: 'b', kind: 'PERCENT', pct: 10, min_qty: 5, name: '10% off', to: '2020-01-01' }],
    ratelists: [{ id: 'w', name: 'Wholesale', rates: { a: 35 } }],
  };
  const p = priceOffline(catalog, { lines: [{ itemId: 'a', qty: 3 }, { itemId: 'b', qty: 5 }] }, '2026-10-30');
  assert.equal(p.lines[0].free_qty, 1);
  assert.equal(p.lines[1].discount, 0, 'an expired scheme doesn’t apply');
  assert.equal(p.taxable, 120 + 277.5);
  assert.equal(p.cgst + p.sgst, p.gst);
  assert.equal(p.total, Math.round(120 * 1.18 + 277.5 * 1.05));
  assert.equal(p.doc_type, 'TAX_INVOICE');
  const w = priceOffline(catalog, { ratelistId: 'w', lines: [{ itemId: 'a', qty: 1 }], buyer: { gstin: '29AAAAA0000A1Z5' } }, '2026-10-30');
  assert.equal(w.lines[0].rate, 35);
  assert.equal(w.intra, false);
  assert.equal(w.place_of_supply, 'Karnataka');
  assert.equal(w.igst, 6.3);
  assert.throws(() => priceOffline(catalog, { lines: [{ itemId: 'zz', qty: 1 }] }), /catalog/);
});
