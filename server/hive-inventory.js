// Hive tools for the Inventory add-on (inventory.js): { name, description, schema, run(ctx, args), summary } like the
// tools in hive.js (run calls the module's own API through ctx.call). OK holds the ones that wait for the seller's
// Confirm: "sold 20 bags of cement to Sharma" becomes a stock_entry the seller sees before anything is saved.
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const arr = (description, items) => ({ type: 'array', description, items });

const KIND = { PURCHASE: 'Stock in (purchase)', SALE: 'Stock out (sale)', RETURN_IN: 'Return from a customer', RETURN_OUT: 'Return to a supplier', ADJUST: 'Stock adjustment', OPENING: 'Opening stock' };
const brief = (i) => ({ id: i.id, name: i.name, unit: i.unit, sku: i.sku || undefined, barcode: i.barcode || undefined, stock: i.stock, reorder_level: i.reorder_level ?? undefined, low: i.low || undefined, sale_rate: i.sale_rate ?? undefined, purchase_rate: i.purchase_rate ?? undefined });
const lineText = (l) => `${l.qty} ${l.unit || ''} ${l.item}${l.rate ? ` @ ₹${l.rate}` : ''}`.replace(/\s+/g, ' ').trim();

export const TOOLS = [
  {
    name: 'inventory_overview', description: 'The seller’s stock in FunnelHive Inventory (add-on): stock value at purchase rates, item count, low-stock and out-of-stock items, godowns with their stock value.',
    schema: S({}),
    run: async (ctx) => {
      const d = await ctx.call('GET', '/inventory/items');
      return { summary: d.summary, godowns: d.godowns, low_stock: d.items.filter((i) => i.low).slice(0, 30).map(brief) };
    },
    summary: (r) => `Read the stock (${r.summary?.items ?? 0} items, ${r.low_stock?.length ?? 0} low)`,
  },
  {
    name: 'find_stock', description: 'Find items in Inventory by name, SKU, barcode or category, with stock (overall, or in one godown) and recent stock entries for one item. Use before stock_entry to get the exact item names.',
    schema: S({ search: str('Name / SKU / barcode / category (optional)'), godown: str('Godown name to see stock there (optional)'), itemId: str('One item’s id: also returns its stock per godown and its history (optional)') }),
    run: async (ctx, a) => {
      if (a.itemId) { const d = await ctx.call('GET', `/inventory/items/${a.itemId}?limit=20`); return { item: brief(d.item), by_godown: d.byGodown, history: d.moves.map((m) => ({ day: m.day, kind: m.kind, qty: m.qty, godown: m.godown_name, party: m.party_name, rate: m.rate })) }; }
      const all = await ctx.call('GET', '/inventory/items');
      const g = a.godown && all.godowns.find((x) => x.name.toLowerCase() === String(a.godown).trim().toLowerCase());
      if (a.godown && !g) throw new Error(`No godown called “${a.godown}” — godowns: ${all.godowns.map((x) => x.name).join(', ')}`);
      const d = await ctx.call('GET', `/inventory/items?${new URLSearchParams(Object.entries({ search: a.search || '', godownId: g?.id || '' }).filter(([, v]) => v))}`);
      return { total: d.items.length, godown: g?.name, items: d.items.slice(0, 40).map(brief) };
    },
    summary: (r) => (r.item ? `Looked at ${r.item.name}` : `Found ${r.total} items`),
  },
  {
    name: 'stock_entry', description: 'Record stock in or out in Inventory (waits for the seller’s Confirm). kind: PURCHASE (stock received / bought), SALE (sold / sent out), RETURN_IN (customer returned), RETURN_OUT (returned to supplier), ADJUST (correction: qty + or −). Each line names an existing item exactly as find_stock shows it — never invent items: if one isn’t there, ask the seller whether to create it (inventory_item) first. qty in the item’s unit.',
    schema: S({
      kind: { type: 'string', enum: ['PURCHASE', 'SALE', 'RETURN_IN', 'RETURN_OUT', 'ADJUST'] },
      lines: arr('The items', S({ item: str('Item name, SKU or barcode'), qty: num('Quantity (ADJUST: negative to reduce)'), rate: num('Rate per unit in ₹ (optional)') }, ['item', 'qty'])),
      party_name: str('Customer or supplier (optional)'), godown: str('Godown name (optional — the main godown otherwise)'), day: str('YYYY-MM-DD (optional — today)'), ref: str('Bill / invoice number (optional)'), note: str('Optional'),
      force: bool('SALE / RETURN_OUT only: record even if the books show less stock (the seller said the goods already went out)'),
    }, ['kind', 'lines']),
    run: async (ctx, a) => {
      const d = await ctx.call('POST', '/inventory/moves/batch', { kind: a.kind, lines: a.lines, party_name: a.party_name, godown: a.godown, day: a.day, ref: a.ref, note: a.note, force: !!a.force, source: 'HIVE' });
      return { saved: d.moves.length, moves: d.moves.map((m) => ({ item: m.item_name, qty: m.qty, godown: m.godown_name })) };
    },
    summary: (r) => `Saved ${r.saved} stock ${r.saved === 1 ? 'entry' : 'entries'}`,
  },
  {
    name: 'stock_transfer', description: 'Move stock of one item from one godown to another (waits for the seller’s Confirm).',
    schema: S({ item: str('Item name, SKU or barcode'), qty: num('Quantity'), from: str('Godown it leaves'), to: str('Godown it goes to'), day: str('YYYY-MM-DD (optional)'), note: str('Optional') }, ['item', 'qty', 'from', 'to']),
    run: async (ctx, a) => { await ctx.call('POST', '/inventory/transfer', { ...a, source: 'HIVE' }); return { moved: true }; },
    summary: (r, a) => `Moved ${a.qty} ${a.item} from ${a.from} to ${a.to}`,
  },
  {
    name: 'inventory_item', description: 'Create an item in Inventory, or change one (pass itemId) — waits for the seller’s Confirm. Only for items the seller asked for or agreed to create.',
    schema: S({
      itemId: str('To change an existing item (optional)'), name: str('Item name'), unit: str('Unit: pcs, kg, bag, box, metre, litre… (optional)'), sku: str('Optional'), barcode: str('Optional'), category: str('Optional'),
      hsn: str('HSN code (optional)'), gst_percent: num('GST % (optional)'), sale_rate: num('₹ (optional)'), purchase_rate: num('₹ (optional)'), reorder_level: num('Low-stock alert at this quantity (optional)'),
    }, ['name']),
    run: async (ctx, { itemId, ...a }) => { const i = itemId ? await ctx.call('PUT', `/inventory/items/${itemId}`, a) : await ctx.call('POST', '/inventory/items', a); return brief(i); },
    summary: (r, a) => (a.itemId ? `Updated ${r.name}` : `Created item ${r.name}`),
  },
  {
    name: 'godown_create', description: 'Add a godown / store / warehouse to Inventory (waits for the seller’s Confirm).',
    schema: S({ name: str('Godown name') }, ['name']),
    run: async (ctx, a) => ctx.call('POST', '/inventory/godowns', { name: a.name }),
    summary: (r) => `Added godown ${r.name}`,
  },
];

// what the Confirm card says before anything is saved
export const OK = {
  stock_entry: (a) => `${KIND[a.kind] || a.kind}${a.party_name ? ` — ${a.party_name}` : ''}${a.godown ? ` · ${a.godown}` : ''}: ${(a.lines || []).map(lineText).join(', ')}${a.force ? ' (even if stock shows less)' : ''}`,
  stock_transfer: (a) => `Move ${a.qty} ${a.item} from ${a.from} to ${a.to}`,
  inventory_item: (a) => (a.itemId ? `Change item “${a.name}”` : `Create item “${a.name}”${a.unit ? ` (${a.unit})` : ''}`),
  godown_create: (a) => `Add godown “${a.name}”`,
};
