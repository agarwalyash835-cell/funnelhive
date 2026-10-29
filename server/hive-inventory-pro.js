// Hive tools for this module: { name, description, schema, run(ctx, args), summary } like the tools in hive.js
// (run calls the module's own API through ctx.call). OK holds the ones that wait for the seller's Confirm.
// Items are named the way the seller says them ("shirt M blue", a barcode, a SKU) — the server resolves them and says
// when a name matches more than one item.
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const P = '/inventory/pro';
const amt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const lower = (v) => String(v || '').trim().toLowerCase();

// the bill of materials for a finished item, by its name
async function bomFor(ctx, item) {
  const boms = await ctx.call('GET', `${P}/boms`);
  const b = boms.find((x) => lower(x.item) === lower(item)) || (() => { const m = boms.filter((x) => lower(x.item).includes(lower(item))); return m.length === 1 ? m[0] : null; })();
  if (!b) throw new Error(boms.length ? `No bill of materials for “${item}”. Items with one: ${boms.map((x) => x.item).join(', ')}` : 'No bills of materials yet — set one with inventory_set_bom (or the seller adds it under Inventory → Production)');
  return b;
}
// an item's id by its name (exact, else the one item whose name contains it)
async function itemId(ctx, name) {
  const { items } = await ctx.call('GET', `/inventory/items?${qs({ search: name, all: 1 })}`);
  const hit = items.find((x) => lower(x.name) === lower(name)) || (items.length === 1 ? items[0] : null);
  if (!hit) throw new Error(items.length ? `“${name}” matches ${items.slice(0, 6).map((x) => x.name).join(', ')} — say which` : `No item “${name}” in Inventory — create it first`);
  return hit;
}
const lineOf = (l) => `${l.qty}${l.free_qty ? ` + ${l.free_qty} free` : ''} × ${l.name} @ ${amt(l.rate)}${l.discount ? ` (−${amt(l.discount)} ${l.scheme?.name || 'scheme'})` : ''} + ${l.gst_percent}% GST = ${amt(l.amount)}`;
const billLines = { type: 'array', description: 'Bill lines', items: S({ item: str('Item name as the seller says it (e.g. "shirt M blue"), a barcode or a SKU'), qty: num('Quantity'), rate: num('Rate before GST (optional — else the rate list / item rate)') }, ['item', 'qty']) };

export const TOOLS = [
  {
    name: 'inventory_production', description: 'Manufacturing (Inventory add-on): for a finished item with a bill of materials, the raw materials a planned quantity needs against stock, how many can be made now, and the material cost. Use before inventory_produce, or for "how much steel for 200 chairs?".',
    schema: S({ item: str('Finished item name'), qty: num('Planned quantity') }, ['item', 'qty']),
    run: async (ctx, a) => {
      const b = await bomFor(ctx, a.item);
      const r = await ctx.call('GET', `${P}/boms/${b.id}/requirement?${qs({ qty: a.qty })}`);
      return { item: r.item, qty: r.qty, canMakeNow: r.can_make, materialCost: amt(r.cost), needs: r.lines.map((l) => ({ material: l.name, perUnit: l.per, need: `${l.need} ${l.unit}`.trim(), inStock: l.have, short: l.short })) };
    },
    summary: (r) => `${r.qty} ${r.item}: can make ${r.canMakeNow} now`,
  },
  {
    name: 'inventory_set_bom', description: 'Manufacturing (Inventory add-on; waits for the seller’s Confirm): set or replace the bill of materials of a finished item — what one unit is made of (components with the quantity per unit, in each component’s own unit). Items must already exist (create them with inventory_item). Needed before inventory_production / inventory_produce.',
    schema: S({ item: str('Finished item name'), components: { type: 'array', description: 'What one unit uses', items: S({ item: str('Component item name'), qty: num('Quantity per finished unit') }, ['item', 'qty']) }, note: str('Optional note') }, ['item', 'components']),
    run: async (ctx, a) => {
      const f = await itemId(ctx, a.item);
      const lines = [];
      for (const c of a.components || []) lines.push({ itemId: (await itemId(ctx, c.item)).id, qty: c.qty });
      const b = await ctx.call('PUT', `${P}/boms`, { itemId: f.id, lines, note: a.note });
      return { item: f.name, components: (b.lines || []).map((l) => `${l.qty} ${l.unit || ''} ${l.name || ''}`.replace(/\s+/g, ' ').trim()), costPerUnit: b.cost != null ? amt(b.cost) : undefined };
    },
    summary: (r) => `Saved the bill of materials for ${r.item}`,
  },
  {
    name: 'inventory_set_scheme', description: 'Schemes (Inventory add-on; waits for the seller’s Confirm): create a trade scheme on an item that counter bills apply by themselves — kind FREE (buy X get Y free) or PERCENT (% off, optionally from a minimum quantity), optionally between two dates.',
    schema: S({ item: str('Item name'), kind: { type: 'string', enum: ['FREE', 'PERCENT'] }, buy: num('FREE: buy this many'), free: num('FREE: get this many free'), pct: num('PERCENT: % off'), min_qty: num('PERCENT: from this quantity (optional)'), from: str('Starts YYYY-MM-DD (optional)'), to: str('Ends YYYY-MM-DD (optional)'), name: str('Optional name, e.g. Diwali scheme') }, ['item', 'kind']),
    run: async (ctx, a) => {
      const it = await itemId(ctx, a.item);
      const s = await ctx.call('POST', `${P}/schemes`, { itemId: it.id, kind: a.kind, buy: a.buy, free: a.free, pct: a.pct, min_qty: a.min_qty, from: a.from, to: a.to, name: a.name });
      return { item: it.name, scheme: s.name, from: s.from, to: s.to };
    },
    summary: (r) => `Scheme on ${r.item}: ${r.scheme}`,
  },
  {
    name: 'inventory_make_variants', description: 'Retail (Inventory add-on; waits for the seller’s Confirm): sizes and / or colours of one product — e.g. a shirt in S, M, L and Blue, White. Create the main item once with inventory_item (rate, GST, unit), then call this: it makes one stock item per size × colour (“Cotton Shirt M Blue”) that counter bills and the variant grid use. Never create each size / colour as a separate item yourself.',
    schema: S({ item: str('The main item name'), sizes: { type: 'array', items: { type: 'string' }, description: 'Sizes (optional)' }, colours: { type: 'array', items: { type: 'string' }, description: 'Colours (optional)' } }, ['item']),
    run: async (ctx, a) => {
      const p = await itemId(ctx, a.item);
      const r = await ctx.call('POST', `${P}/variants`, { parentId: p.id, sizes: a.sizes || [], colours: a.colours || [] });
      return { item: p.name, made: r.made.map((x) => x.name), skipped: r.skipped };
    },
    summary: (r) => `Made ${r.made.length} variants of ${r.item}${r.skipped.length ? ` (${r.skipped.length} already there)` : ''}`,
  },
  {
    name: 'inventory_counter_bills', description: 'Counter bills (Inventory add-on): the bills made at the counter on a day (default today, IST) or for a party — numbers, totals, cash / credit, paid, cancelled, returns — and the day’s sales: gross (bills), returns (credit notes made that day) and net. Use it for “today’s counter sales” and report the NET as the day’s sales.',
    schema: S({ day: str('YYYY-MM-DD (optional — today)'), party: str('Party name (optional)') }),
    run: async (ctx, a) => {
      const ist = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(t));
      const day = /^\d{4}-\d{2}-\d{2}$/.test(a.day || '') ? a.day : ist(Date.now());
      const bills = (await ctx.call('GET', `${P}/bills?${qs({ party: a.party, limit: 200 })}`)).filter((b) => a.party || (b.day || ist(b.at)) === day);
      const live = bills.filter((b) => !b.cancelled);
      const notes = a.party ? await ctx.call('GET', `${P}/credit-notes?${qs({ party: a.party })}`) : (await ctx.call('GET', `${P}/counter/day?${qs({ day })}`)).notes;
      const gross = live.reduce((s, b) => s + (Number(b.total) || 0), 0), returns = notes.reduce((s, n) => s + (Number(n.total) || 0), 0);
      return { day: a.party ? undefined : day, count: live.length, total: amt(gross), gross: amt(gross), returns: amt(returns), net: amt(gross - returns), onCredit: amt(live.filter((b) => b.credit && !b.paid).reduce((s, b) => s + (Number(b.net_total ?? b.total) || 0), 0)), cancelled: bills.length - live.length,
        bills: bills.slice(0, 50).map((b) => ({ number: b.number, party: b.party_name || 'Walk-in', total: amt(b.total), ...(b.returned ? { returned: amt(b.returned), net: amt(b.net_total) } : {}), credit: !!b.credit, paid: !!b.paid, cancelled: !!b.cancelled })),
        creditNotes: notes.slice(0, 50).map((n) => ({ number: n.number, bill: n.bill_number, party: n.party_name || 'Walk-in', refund: amt(n.total), mode: n.refund_mode, items: n.lines.map((l) => `${l.qty} × ${l.name}`).join(', '), reason: n.reason || undefined })) };
    },
    summary: (r) => `${r.count} counter bills, ${r.gross}${r.creditNotes.length ? ` − ${r.returns} returns = ${r.net}` : ''}`,
  },
  {
    name: 'inventory_counter_return', description: 'Take back items sold on a counter bill (Inventory add-on; waits for the seller’s Confirm): makes a credit note (CN-…) against the bill — the pieces go back into stock, the refund is their share of the bill incl. GST (schemes respected: a return that breaks “buy 10 get 1” reclaims the free piece’s value), the bill and the day’s sales go down, and on an unpaid credit bill it comes off what the party owes. Give the bill number if the seller knows it; otherwise the latest bill with those items is used — tell the seller which bill it picked. For an exchange: this return, then a new inventory_counter_bill.',
    schema: S({ bill: str('Bill number, e.g. CB-0012 (optional)'), lines: { type: 'array', description: 'What came back', items: S({ item: str('Item name as the seller says it, a barcode or a SKU'), qty: num('Pieces returned') }, ['item', 'qty']) }, reason: str('Why (optional, e.g. size exchange)'), refund_mode: { type: 'string', enum: ['cash', 'credit'], description: 'cash, or credit to the party’s account (optional — unpaid credit bills always take credit)' } }, ['lines']),
    run: async (ctx, a) => {
      const lines = [];
      for (const l of a.lines || []) lines.push({ itemId: (await ctx.call('GET', `${P}/rate?${qs({ item: l.item })}`)).item.id, qty: Number(l.qty), name: l.item });
      if (!lines.length) throw new Error('Which items came back?');
      const all = await ctx.call('GET', `${P}/bills?limit=200`);
      let bill, picked = false;
      if (a.bill) {
        const d = String(a.bill).match(/\d+/)?.[0], want = d ? `CB-${d.padStart(4, '0')}` : String(a.bill).toUpperCase();
        bill = all.find((b) => b.number === want || b.number === String(a.bill).trim().toUpperCase());
        if (!bill) throw new Error(`No counter bill ${a.bill} among the last 200 bills`);
      } else {
        // the latest live bill that still has every item, in that quantity, left to return
        const left = (b, id) => b.lines.filter((x) => x.itemId === id).reduce((s, x) => s + x.qty + (x.free_qty || 0) - (x.returned_qty || 0), 0);
        bill = all.find((b) => !b.cancelled && lines.every((l) => left(b, l.itemId) >= l.qty - 0.0005));
        if (!bill) throw new Error(`No recent bill has ${lines.map((l) => `${l.qty} × ${l.name}`).join(', ')} left to return — ask the seller for the bill number`);
        picked = true;
      }
      const n = await ctx.call('POST', `${P}/bills/${bill.id}/return`, { lines: lines.map(({ itemId, qty }) => ({ itemId, qty })), reason: a.reason, refund_mode: a.refund_mode, source: 'HIVE' });
      const after = await ctx.call('GET', `${P}/bills/${bill.id}`);
      return { creditNote: n.number, bill: bill.number, billDay: bill.day, ...(picked ? { picked: `No bill number given — used ${bill.number} (${bill.day}${bill.party_name ? `, ${bill.party_name}` : ''}), the latest bill with ${lines.map((l) => l.name).join(', ')}` } : {}),
        lines: n.lines.map((l) => `${l.qty} × ${l.name}: ${amt(l.amount)}`), refund: amt(n.total), refundMode: n.refund_mode === 'credit' ? (n.applies_to === 'bill' ? `off ${n.party_name}’s unpaid bill` : `credit to ${n.party_name}’s account`) : 'cash',
        billNow: amt(after.net_total), note: 'Stock is back. The seller can print the credit note from Inventory → Counter bill.' };
    },
    summary: (r) => `${r.creditNote} on ${r.bill}: refund ${r.refund}`,
  },
  {
    name: 'inventory_produce', description: 'Record production (Inventory add-on; waits for the seller’s Confirm): makes qty of a finished item from its bill of materials — takes the components out of stock and puts the finished item in, all or nothing. If anything is short nothing changes and the shortfall per component comes back.',
    schema: S({ item: str('Finished item name'), qty: num('Quantity made'), note: str('Optional note (e.g. batch / shift)') }, ['item', 'qty']),
    run: async (ctx, a) => {
      const b = await bomFor(ctx, a.item);
      return ctx.call('POST', `${P}/boms/${b.id}/produce`, { qty: a.qty, note: a.note, source: 'HIVE' });
    },
    summary: (r) => `Made ${r.produced} ${r.item}`,
  },
  {
    name: 'inventory_expiring', description: 'Batches and expiry (Inventory add-on): stock batches expiring within days (30, 60 or 90; already-expired ones too), with quantity and value at purchase rate. For "what expires this month?" use 30.',
    schema: S({ days: num('Days ahead: 30, 60 or 90') }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `${P}/expiring?${qs({ days: a.days || 30 })}`);
      return { until: d.until, count: d.batches.length, value: amt(d.batches.reduce((s, b) => s + b.value, 0)), batches: d.batches.slice(0, 40).map((b) => ({ item: b.item, batch: b.batch, expiry: b.expiry, qty: `${b.qty} ${b.unit}`.trim(), status: b.expired ? 'expired' : `${b.days_left} days left` })) };
    },
    summary: (r) => `${r.count} batches expire by ${r.until}`,
  },
  {
    name: 'inventory_price_check', description: 'Price a sale line or a whole counter bill without saving (Inventory add-on): rate from the party’s rate list (or a named list like Wholesale / Dealer) else the item’s rate, the best scheme (buy X get Y free, % off), GST per item, total — and, with credit, whether it crosses the party’s credit limit.',
    schema: S({ lines: billLines, party_name: str('Customer / party (optional)'), ratelist: str('Rate list name (optional)'), credit: bool('On credit (udhaar)') }, ['lines']),
    run: async (ctx, a) => {
      const lists = a.ratelist ? await ctx.call('GET', `${P}/ratelists`) : [];
      const list = a.ratelist && lists.find((l) => lower(l.name) === lower(a.ratelist));
      if (a.ratelist && !list) throw new Error(`No rate list “${a.ratelist}”. Lists: ${lists.map((l) => l.name).join(', ') || 'none yet'}`);
      const p = await ctx.call('POST', `${P}/bills/preview`, { lines: a.lines, party_name: a.party_name, credit: !!a.credit, ratelistId: list?.id });
      return { lines: p.lines.map(lineOf), taxable: amt(p.taxable), gst: amt(p.gst), total: amt(p.total), ...(p.credit_check ? { credit: p.credit_check.message, overLimit: p.credit_check.over } : {}) };
    },
    summary: (r) => `Priced a bill: ${r.total}`,
  },
  {
    name: 'inventory_counter_bill', description: 'Make a counter bill (Inventory add-on; waits for the seller’s Confirm): sells the lines — stock goes out (expiring batches first), GST from each item, schemes applied — and saves a printable bill. credit = on udhaar for party_name; if that pushes the party past their credit limit the bill is refused with a warning unless override is true (only after the seller says go ahead).',
    schema: S({ lines: billLines, party_name: str('Customer / party (optional; needed for credit)'), credit: bool('On credit (udhaar)'), override: bool('Save even though it crosses the credit limit — only when the seller has said so') }, ['lines']),
    run: async (ctx, a) => {
      const b = await ctx.call('POST', `${P}/bills`, { lines: a.lines, party_name: a.party_name, credit: !!a.credit, override: a.override === true, source: 'HIVE' });
      return { bill: b.number, id: b.id, lines: b.lines.map(lineOf), total: amt(b.total), credit: b.credit, note: 'The seller can print it from Inventory → Counter bill.' };
    },
    summary: (r) => `Bill ${r.bill}: ${r.total}`,
  },
  {
    name: 'inventory_credit', description: 'Credit limits (Inventory add-on): a party’s credit limit, what they owe now (open receivable bills in Tally when the seller uses Tally, else unpaid credit counter bills) and what’s left; with amount, whether a sale of that much would cross the limit. Without party: every party with a limit.',
    schema: S({ party: str('Party name (optional)'), amount: num('A planned sale: the bill TOTAL including GST (take it from inventory_price_check, never the amount before GST)') }),
    run: async (ctx, a) => {
      if (!a.party) return { parties: (await ctx.call('GET', `${P}/credit`)).map((c) => ({ party: c.party_name, limit: amt(c.limit), owes: amt(c.outstanding), over: c.over })) };
      const c = await ctx.call('GET', `${P}/credit?${qs({ party: a.party, amount: a.amount })}`);
      return { party: c.party_name, limit: c.limit == null ? 'not set' : amt(c.limit), owes: amt(c.outstanding), from: c.outstanding_from === 'tally' ? 'Tally' : 'credit bills', available: c.available == null ? null : amt(c.available), ...(a.amount ? { afterSale: amt(c.after), overLimit: c.over } : {}), message: c.message };
    },
    summary: (r) => (r.parties ? `${r.parties.length} credit limits` : r.message),
  },
  {
    name: 'inventory_set_credit_limit', description: 'Set or change a party’s credit limit in ₹ (Inventory add-on; waits for the seller’s Confirm). Optional ratelist = the rate list (e.g. Dealer) their bills use.',
    schema: S({ party: str('Party name'), limit: num('Credit limit in ₹'), ratelist: str('Rate list name (optional)') }, ['party', 'limit']),
    run: async (ctx, a) => {
      let ratelistId;
      if (a.ratelist) { const l = (await ctx.call('GET', `${P}/ratelists`)).find((x) => lower(x.name) === lower(a.ratelist)); if (!l) throw new Error(`No rate list “${a.ratelist}”`); ratelistId = l.id; }
      const c = await ctx.call('PUT', `${P}/credit`, { party_name: a.party, limit: a.limit, ...(ratelistId ? { ratelistId } : {}) });
      return { party: c.party_name, limit: amt(c.limit), owes: amt(c.outstanding), message: c.message };
    },
    summary: (r) => `Credit limit for ${r.party}: ${r.limit}`,
  },
  {
    name: 'inventory_rate', description: 'Rate lists (Inventory add-on): an item’s rate on a named list (Retail / Wholesale / Dealer…) or for a party (their own list), else the item’s sale rate. Without item: the seller’s rate lists.',
    schema: S({ item: str('Item name, barcode or SKU (optional)'), list: str('Rate list name (optional)'), party: str('Party name (optional)') }),
    run: async (ctx, a) => {
      if (!a.item) return { lists: (await ctx.call('GET', `${P}/ratelists`)).map((l) => ({ name: l.name, items: Object.keys(l.rates).length })) };
      const r = await ctx.call('GET', `${P}/rate?${qs({ item: a.item, list: a.list, party: a.party })}`);
      return { item: r.item.name, rate: r.rate == null ? 'no sale rate set' : amt(r.rate), from: r.source === 'list' ? `${r.list.name} list` : `item’s sale rate${r.list ? ` (not on ${r.list.name})` : ''}` };
    },
    summary: (r) => (r.lists ? `${r.lists.length} rate lists` : `${r.item}: ${r.rate}`),
  },
];

const linesText = (lines) => (lines || []).slice(0, 6).map((l) => `${l.qty} × ${l.item}`).join(', ') + ((lines || []).length > 6 ? '…' : '');
export const OK = {
  inventory_make_variants: (a) => `Make ${a.item} in ${[...(a.sizes || []), ...(a.colours || [])].join(', ')} — one stock item per size × colour`,
  inventory_set_scheme: (a) => `Scheme on ${a.item}: ${a.kind === 'FREE' ? `buy ${a.buy} get ${a.free} free` : `${a.pct}% off${a.min_qty > 1 ? ` on ${a.min_qty}+` : ''}`}${a.to ? ` until ${a.to}` : ''}`,
  inventory_set_bom: (a) => `Set the bill of materials: 1 ${a.item} = ${(a.components || []).map((c) => `${c.qty} ${c.item}`).join(' + ')}`,
  inventory_produce: (a) => `Make ${a.qty} ${a.item} — the components come out of stock`,
  inventory_counter_bill: (a) => `Bill ${linesText(a.lines)}${a.party_name ? ` to ${a.party_name}` : ''}${a.credit ? ' on credit' : ''}${a.override ? ' (over their credit limit)' : ''} — stock goes out`,
  inventory_counter_return: (a) => `Take back ${linesText(a.lines)}${a.bill ? ` on bill ${a.bill}` : ' on the latest bill with it'}${a.refund_mode ? ` — refund as ${a.refund_mode}` : ''} — stock comes back and a credit note is made`,
  inventory_set_credit_limit: (a) => `Set ${a.party}’s credit limit to ${amt(a.limit)}${a.ratelist ? ` on the ${a.ratelist} rate list` : ''}`,
};
