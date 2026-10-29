// Hive tools for the Inventory reports (inventory-reports.js): stock valuation, gross profit, a party's ledger, the
// registers and fast / slow / dead stock. All read-only, so none waits for the seller's Confirm (OK is empty).
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const R = '/inventory/reports';
const FROM = str('First day YYYY-MM-DD (optional — the 1st of this month)'), TO = str('Last day YYYY-MM-DD (optional — today)');
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const TOOLS = [
  {
    name: 'inventory_stock_value', description: 'What the seller’s stock in Inventory is worth on a date: per item quantity and value by FIFO and weighted average cost, per godown and in total, with items that have no cost rate flagged.',
    schema: S({ as_of: str('Date YYYY-MM-DD (optional — today)'), godown: str('One godown’s name (optional)') }),
    run: async (ctx, a) => {
      let godownId = '';
      if (a.godown) {
        const { godowns } = await ctx.call('GET', '/inventory/items');
        const g = godowns.find((x) => x.name.toLowerCase() === String(a.godown).trim().toLowerCase());
        if (!g) throw new Error(`No godown called “${a.godown}” — godowns: ${godowns.map((x) => x.name).join(', ')}`);
        godownId = g.id;
      }
      const d = await ctx.call('GET', `${R}/valuation?${qs({ asOf: a.as_of, godownId })}`);
      return { as_of: d.as_of, totals: d.totals, godowns: d.godowns, flagged: d.flagged, top_items: d.items.slice(0, 30).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, fifo: i.fifo.value, average: i.average.value })), rules: d.rules };
    },
    summary: (r) => `Stock worth ${inr(r.totals?.fifo)} (FIFO) on ${r.as_of}`,
  },
  {
    name: 'inventory_profit', description: 'Gross profit (trading account) from Inventory for a period: net sales (counter bills less credit notes, plus stock sales without a bill), cost of goods sold (FIFO), gross profit and margin, by item and category, purchases, opening and closing stock. Expenses aren’t tracked, so never call it net profit. Funnel checkout sales are reported separately.',
    schema: S({ from: FROM, to: TO }),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `${R}/pnl?${qs({ from: a.from, to: a.to })}`);
      return { ...d, by_item: d.by_item.slice(0, 25) };
    },
    summary: (r) => `Gross profit ${inr(r.gross_profit)} on sales of ${inr(r.sales?.net)} (${r.from} to ${r.to})`,
  },
  {
    name: 'party_ledger', description: 'A customer’s or supplier’s statement from Inventory: counter bills, credit notes, payments (credit bills marked paid) and stock purchases / sales with that party, date-wise with a running balance (Dr = they owe the seller, Cr = the seller owes them).',
    schema: S({ party: str('Customer or supplier name'), from: str('First day YYYY-MM-DD (optional)'), to: str('Last day YYYY-MM-DD (optional)') }, ['party']),
    run: async (ctx, a) => {
      const d = await ctx.call('GET', `${R}/ledger?${qs({ party: a.party, from: a.from, to: a.to })}`);
      if (!d.found) {
        const { parties } = await ctx.call('GET', `${R}/parties`);
        const w = String(a.party).toLowerCase().split(/\s+/)[0];
        return { party: a.party, found: false, similar: parties.filter((p) => p.name.toLowerCase().includes(w)).slice(0, 8).map((p) => p.name) };
      }
      return { ...d, entries: d.entries.slice(-40) };
    },
    summary: (r) => (r.found === false ? `No entries for ${r.party}` : `${r.party}: ${r.meaning}`),
  },
  {
    name: 'inventory_register', description: 'A register from Inventory for a period: daybook (every bill, note and stock entry), sales (counter bills, credit notes and unbilled stock sales with CGST / SGST / IGST), purchases (stock purchases and returns to suppliers), or gst (GST-rate-wise taxable value and tax, net of credit notes).',
    schema: S({ register: { type: 'string', enum: ['daybook', 'sales', 'purchases', 'gst'] }, from: FROM, to: TO }, ['register']),
    run: async (ctx, a) => {
      const path = { daybook: 'daybook', sales: 'sales-register', purchases: 'purchase-register', gst: 'gst-summary' }[a.register] || 'daybook';
      const d = await ctx.call('GET', `${R}/${path}?${qs({ from: a.from, to: a.to })}`);
      return { ...d, rows: d.rows.slice(0, 60), more: Math.max(0, d.rows.length - 60) };
    },
    summary: (r, a) => `${{ daybook: 'Day book', sales: 'Sales register', purchases: 'Purchase register', gst: 'GST summary' }[a.register] || 'Register'}: ${r.rows?.length ?? 0} rows`,
  },
  {
    name: 'inventory_stock_speed', description: 'Fast, slow and dead stock in Inventory, and what to reorder: sales speed (last 30 / 90 days, incl. what production used), days of stock left, reorder suggestions from the reorder level and speed, the last supplier. Suggestions only — never record a purchase from them.',
    schema: S({ search: str('One item’s name to look at (optional)') }),
    run: async (ctx, a) => {
      const { all, ...d } = await ctx.call('GET', `${R}/movement`);
      const s = String(a.search || '').trim().toLowerCase();
      return s ? { ...d, reorder: undefined, fast: undefined, slow: undefined, dead: undefined, items: all.filter((x) => x.name.toLowerCase().includes(s)).slice(0, 20) }
        : { ...d, reorder: d.reorder.slice(0, 30), fast: d.fast.slice(0, 15), slow: d.slow.slice(0, 20), dead: d.dead.slice(0, 20) };
    },
    summary: (r) => (r.items ? `Looked at ${r.items.length} items` : `${r.counts?.reorder ?? 0} to reorder, ${r.counts?.dead ?? 0} dead`),
  },
];

// reports only read: nothing waits for Confirm
export const OK = {};
