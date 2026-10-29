// Hive tools for this module: { name, description, schema, run(ctx, args), summary } like the tools in hive.js
// (run calls the module's own API through ctx.call). OK holds the ones that wait for the seller's Confirm.
// Both tools only read: a purchase-order draft is text and a wa.me link the seller taps — Hive never sends it.
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const amt = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const qty = (n, unit) => `${Number(n).toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
const brief = (x) => ({ item: x.name, inStock: x.stock == null ? null : qty(x.stock, x.unit), sellsPerDay: x.perDay, daysLeft: x.daysLeft, sold30d: x.sold30, sold90d: x.sold90, lastSold: x.lastSold, ...(x.reorderQty ? { orderQty: qty(x.reorderQty, x.unit) } : {}), stockValue: amt(x.value), supplier: x.supplier, lastRate: x.lastRate == null ? null : amt(x.lastRate) });

export const TOOLS = [
  {
    name: 'tally_stock_insights', description: 'Stock insights from the seller’s Tally books (Tally add-on), worked out from the last 90 days of sales: what to reorder now and how much (enough for a 7-day supplier lead time plus 7 days’ cushion), fast movers, slow movers (over 90 days of stock at today’s speed) and dead stock (in stock, no sale in 90 days — with the money stuck in it). Each item has its daily sales speed, days of stock left and its last supplier and rate. focus picks one list; search = an item name for that item’s figures. For “what should I reorder this week?” use focus=reorder.',
    schema: S({ focus: { type: 'string', enum: ['all', 'reorder', 'fast', 'slow', 'dead'] }, search: str('An item name (optional)') }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `/tally/insights${a.search ? `?search=${encodeURIComponent(a.search)}` : ''}`);
      const f = a.focus || 'all', top = (l) => l.slice(0, f === 'all' ? 10 : 30).map(brief);
      return {
        company: d.company.name, asOf: d.asOf, rules: `reorder covers ${d.leadDays} days lead time + ${d.safetyDays} days cushion`, counts: d.counts,
        ...(d.items ? { matching: d.items.map(brief) } : {}),
        ...(['all', 'reorder'].includes(f) ? { reorderNow: top(d.reorder) } : {}),
        ...(['all', 'dead'].includes(f) ? { deadStock: top(d.dead), moneyStuckInDeadStock: amt(d.deadValue) } : {}),
        ...(['all', 'fast'].includes(f) ? { fastMovers: top(d.fast) } : {}),
        ...(['all', 'slow'].includes(f) ? { slowMovers: top(d.slow), moneyInSlowStock: amt(d.slowValue) } : {}),
      };
    },
    summary: (r) => `Checked stock in ${r.company}: ${r.counts.reorder} to reorder, ${r.counts.dead} dead`,
  },
  {
    name: 'tally_purchase_orders', description: 'Purchase-order drafts from the Tally books (Tally add-on): every item that runs out within the supplier lead time plus cushion, grouped by the supplier it was last bought from, with quantities, last rates, a WhatsApp-ready message and a click-to-send WhatsApp link when the supplier’s ledger has a mobile number. supplier = a name to draft just theirs (e.g. “draft a purchase order for Gupta Suppliers”). Nothing is sent: show the message and link, and the seller sends it themselves.',
    schema: S({ supplier: str('Supplier name (optional)') }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `/tally/insights/purchase-orders${a.supplier ? `?supplier=${encodeURIComponent(a.supplier)}` : ''}`);
      return { company: d.company.name, ...(d.note ? { note: d.note } : {}), orders: d.orders.slice(0, a.supplier ? 5 : 10).map((o) => ({ supplier: o.supplier || 'No supplier on record (never bought in Tally)', items: o.items.map((i) => `${i.name}: ${qty(i.qty, i.unit)}${i.lastRate ? ` @ ${amt(i.lastRate)}` : ''}${i.urgent ? ' (urgent)' : ''}`), approxTotal: amt(o.approxTotal), message: o.message, whatsappLink: o.whatsapp || null, ...(o.whatsapp ? {} : { noPhone: 'No mobile number on this supplier’s ledger in Tally — copy the message instead' }) })), more: Math.max(0, d.orders.length - (a.supplier ? 5 : 10)) };
    },
    summary: (r) => (r.orders.length ? `Drafted ${r.orders.length} purchase order${r.orders.length === 1 ? '' : 's'}` : 'Nothing to reorder'),
  },
];
export const OK = {};
