// An invoice photo → a voucher draft (AI Hive's Tally invoice OCR): the vision model reads the bill, the AI turns the
// text into an invoice (party, number, dates, items, amounts), and the names are matched to this company's Tally
// ledgers and stock items. Nothing is saved: the seller checks the draft in the voucher form and sends it to Tally
// (voucher_source INVOICE). Tax lines aren't posted — the seller adds them in the form or in TallyPrime.
import { T } from './db.js';
import { readImage, visionReady } from './waknow.js';
import { aiJson, aiEnabled } from './ai.js';
import { tallyOn, selectedCompany } from './tally.js';

const EXTRACT = `You read Indian GST tax invoices. From the invoice text below, return ONLY JSON:
{"invoice_number": string|null, "date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null,
 "seller": {"name": string|null, "gstin": string|null, "phone": string|null}, "buyer": {"name": string|null, "gstin": string|null, "phone": string|null},
 "items": [{"description": string, "quantity": number|null, "unit": string|null, "rate": number|null, "amount": number|null, "tax_percent": number|null}],
 "taxable_value": number|null, "tax_total": number|null, "grand_total": number|null, "narration": string|null}
Use null for anything you can't read. Dates as YYYY-MM-DD (Indian invoices write day first). Amounts are plain numbers without ₹ or commas. Items are the goods or services lines only — never CGST, SGST, IGST, round-off or freight lines.`;

const lname = (v) => String(v ?? '').trim().toLowerCase();
const num = (v) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
// AI Hive's matching: exact name, then one name starting with the other
const matchName = (name, rows) => {
  const n = lname(name);
  if (!n) return null;
  return rows.find((r) => lname(r.name) === n)?.name || rows.find((r) => lname(r.name).startsWith(n) || n.startsWith(lname(r.name)))?.name || null;
};
const matchItem = (name, rows) => {
  const n = lname(name);
  if (!n) return null;
  return rows.find((r) => lname(r.name) === n)?.name || rows.find((r) => lname(r.name).includes(n) || n.includes(lname(r.name)))?.name || null;
};

export async function readInvoice(userId, dataUrl, voucherType = 'Purchase') {
  const company = selectedCompany(userId);
  if (!company) throw Object.assign(new Error('Sync your Tally company first'), { status: 409 });
  if (!visionReady() || !aiEnabled()) throw Object.assign(new Error('Reading invoices isn’t switched on yet — ask us to turn it on'), { status: 400 });
  const text = await readImage(dataUrl);
  if (!text || text.trim().length < 20) throw Object.assign(new Error('Couldn’t read this photo — take it straight on, in good light, with the whole bill in view'), { status: 422 });
  const inv = await aiJson(EXTRACT, `Invoice text:\n${text.slice(0, 12000)}`);
  if (!inv || typeof inv !== 'object') throw Object.assign(new Error('Couldn’t make sense of this bill — try a clearer photo'), { status: 422 });
  const ledgers = T.tledgers.all({ companyId: company.id, active: 1 }), stock = T.tstock.all({ companyId: company.id, active: 1 });
  // on a purchase the party is who sold to you; on a sale, who you sold to
  const sale = /sales|credit note/i.test(voucherType);
  const party = (sale ? inv.buyer : inv.seller) || {};
  const partyName = String(party.name || '').trim();
  const matchedParty = matchName(partyName, ledgers);
  const items = (Array.isArray(inv.items) ? inv.items : []).filter((i) => i && (i.description || i.amount)).slice(0, 50).map((i) => {
    const matched = matchItem(i.description, stock);
    const qty = num(i.quantity), rate = num(i.rate) || (qty && num(i.amount) ? Math.round((num(i.amount) / qty) * 100) / 100 : null);
    return { description: String(i.description || '').trim(), stock_item_name: matched || String(i.description || '').trim(), matched: !!matched, quantity: qty, unit: i.unit || null, rate, amount: num(i.amount), tax_percent: num(i.tax_percent) };
  });
  const number = String(inv.invoice_number || '').trim() || null;
  // the same bill entered before (same number and party)?
  const dup = number && T.tvouchers.all({ companyId: company.id, active: 1 }).find((v) => lname(v.reference_number) === lname(number) && (!partyName || lname(v.party_name) === lname(matchedParty || partyName)));
  return {
    voucher_type: voucherType, date: isoDay(inv.date), due_date: isoDay(inv.due_date), reference_number: number,
    party_name: matchedParty || partyName, party_matched: !!matchedParty, party_read: partyName, gstin: party.gstin || null,
    items, taxable_value: num(inv.taxable_value), tax_total: num(inv.tax_total), grand_total: num(inv.grand_total), narration: inv.narration || (number ? `Invoice ${number}` : null),
    duplicateOf: dup ? { id: dup.id, voucher_type: dup.voucher_type, voucher_number: dup.voucher_number, voucher_date: dup.voucher_date } : null,
  };
}

export function registerTallyOcr(app, { auth, wrap, rateLimit, isTest, credits }) {
  const limit = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Too many invoices at once — wait a minute.' });
  app.post('/api/tally/invoice-read', auth, (req, res, next) => (tallyOn(req.user) ? next() : res.status(403).json({ error: 'Tally isn’t switched on for your account' })), limit, credits('edit'), wrap(async (req, res) => {
    const img = String(req.body?.image || '');
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(img)) { res.locals.aiFailed = true; return res.status(400).json({ error: 'Send a photo of the bill (JPG, PNG or WebP)' }); }
    if (img.length > 11_000_000) { res.locals.aiFailed = true; return res.status(413).json({ error: 'That photo is too large — under 8 MB, please' }); }
    try { res.json(await readInvoice(req.user.id, img, ['Purchase', 'Sales', 'Debit Note', 'Credit Note'].includes(req.body?.voucher_type) ? req.body.voucher_type : 'Purchase')); } catch (e) { res.locals.aiFailed = true; res.status(e.status || 502).json({ error: e.status ? e.message : 'Couldn’t read the bill just now — try again in a minute' }); }
  }));
}
