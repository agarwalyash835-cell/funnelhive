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
  if (!b) throw new Error(boms.length ? `No bill of materials for “${item}”. Items with one: ${boms.map((x) => x.item).join(', ')}` : 'No bills of materials yet — the seller adds them under Inventory → Production');
  return b;
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
    schema: S({ party: str('Party name (optional)'), amount: num('A planned sale amount incl. GST (optional)') }),
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
      return { item: r.item.name, rate: amt(r.rate), from: r.source === 'list' ? `${r.list.name} list` : `item’s sale rate${r.list ? ` (not on ${r.list.name})` : ''}` };
    },
    summary: (r) => (r.lists ? `${r.lists.length} rate lists` : `${r.item}: ${r.rate}`),
  },
];

const linesText = (lines) => (lines || []).slice(0, 6).map((l) => `${l.qty} × ${l.item}`).join(', ') + ((lines || []).length > 6 ? '…' : '');
export const OK = {
  inventory_produce: (a) => `Make ${a.qty} ${a.item} — the components come out of stock`,
  inventory_counter_bill: (a) => `Bill ${linesText(a.lines)}${a.party_name ? ` to ${a.party_name}` : ''}${a.credit ? ' on credit' : ''}${a.override ? ' (over their credit limit)' : ''} — stock goes out`,
  inventory_set_credit_limit: (a) => `Set ${a.party}’s credit limit to ${amt(a.limit)}${a.ratelist ? ` on the ${a.ratelist} rate list` : ''}`,
};
