// Pricing a counter bill on the phone with no network, from the cached catalog (GET /inventory/pro/counter/catalog).
// It mirrors server/inventory-pro.js priceBill (rate list → item rate, the best scheme, GST per line, CGST + SGST or
// IGST by place of supply, rounding to the rupee). The server prices every offline bill again when it syncs and its
// total stands — a difference is flagged on the bill. Pure functions, so node:test can check them.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const istDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
const live = (s, day) => s.active !== false && (!s.from || s.from <= day) && (!s.to || s.to >= day);

export function schemeFor(schemes, item, qty, rate, day) {
  let best = null;
  for (const s of (schemes || []).filter((x) => x.itemId === item.id && live(x, day))) {
    const o = s.kind === 'FREE'
      ? (qty >= s.buy ? { free_qty: Math.floor(qty / s.buy) * s.free, discount: 0 } : null)
      : (qty >= (s.min_qty || 1) ? { free_qty: 0, discount: r2((qty * rate * s.pct) / 100) } : null);
    if (!o) continue;
    const value = o.discount + o.free_qty * rate;
    if (!best || value > best.value) best = { ...o, value, scheme: { id: s.id, name: s.name, kind: s.kind } };
  }
  return best;
}

export function rateOf(catalog, item, ratelistId) {
  const l = ratelistId && (catalog.ratelists || []).find((x) => x.id === ratelistId);
  if (l && l.rates?.[item.id] != null) return Number(l.rates[item.id]);
  return item.sale_rate != null ? Number(item.sale_rate) : null;
}

export function priceLine(catalog, item, { qty, rate, day }) {
  const n = r3(qty);
  if (!(n > 0)) throw new Error(`Quantity of ${item.name} must be more than 0`);
  const raw = rate != null && rate !== '' ? rate : item.sale_rate;
  if (raw == null || raw === '' || !(Number(raw) >= 0)) throw new Error(`Rate of ${item.name} is missing`);
  const rt = r2(raw), sc = schemeFor(catalog.schemes, item, n, rt, day);
  const gross = r2(n * rt), discount = sc?.discount || 0, taxable = r2(gross - discount), gp = Number(item.gst_percent) || 0, gst = r2((taxable * gp) / 100);
  return { itemId: item.id, name: item.name, unit: item.unit || '', hsn: item.hsn || null, qty: n, free_qty: sc?.free_qty || 0, rate: rt, gross, discount, scheme: sc?.scheme || null, taxable, gst_percent: gp, gst, amount: r2(taxable + gst) };
}

// body: the same shape the server takes — { lines: [{ itemId, qty, rate? }], ratelistId, party_name, credit, buyer: { gstin, state } }
export function priceOffline(catalog, body, day = istDay()) {
  const byId = new Map((catalog.items || []).map((i) => [i.id, i]));
  const lines = (body.lines || []).map((l) => {
    const item = byId.get(l.itemId);
    if (!item) throw new Error('An item on this bill isn’t in the saved catalog');
    return priceLine(catalog, item, { qty: l.qty, rate: l.rate != null && l.rate !== '' ? l.rate : rateOf(catalog, item, body.ratelistId), day });
  });
  const states = catalog.states || {}, byCode = Object.fromEntries(Object.entries(states).map(([n, c]) => [c, n]));
  const seller = catalog.seller || {}, gstin = String(body.buyer?.gstin || '').trim().toUpperCase();
  const buyerState = (gstin.length === 15 && byCode[gstin.slice(0, 2)]) || (states[body.buyer?.state] ? body.buyer.state : null);
  const pos = buyerState || seller.state || null, intra = !seller.state || !pos || pos === seller.state;
  const split = lines.map((l) => { const cgst = intra ? r2(l.gst / 2) : 0; return { ...l, cgst, sgst: intra ? r2(l.gst - cgst) : 0, igst: intra ? 0 : r2(l.gst) }; });
  const sum = (k) => r2(split.reduce((s, l) => s + l[k], 0));
  const total = sum('amount'), rounded = Math.round(total);
  const party = String(body.party_name || '').trim() || null;
  const buyer = gstin || buyerState ? { name: body.buyer?.name || party, gstin: gstin || null, state: buyerState } : null;
  return { day, party_name: party || buyer?.name || null, credit: !!body.credit, lines: split, gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'), gst: sum('gst'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), round_off: r2(rounded - total), total: rounded,
    seller, buyer, place_of_supply: pos, pos_code: pos ? states[pos] || null : null, intra, doc_type: seller.gstin ? 'TAX_INVOICE' : 'BILL', offline_priced: true };
}

// a bill id the phone makes up front (one per cart), so a retry or a queued resend never makes a second bill
export const newClientId = () => `cm-${Date.now().toString(36)}-${Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`;
