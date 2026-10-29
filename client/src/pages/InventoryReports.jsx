// Inventory reports (server/inventory-reports.js): stock valuation, gross profit, party ledger, day book, sales /
// purchase registers, GST summary and fast / slow / dead stock — each with a date range, CSV download and a print view.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, Empty, toast, inr } from '../ui';
import '../inventory-reports.css';

const R = '/inventory/reports';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const monthStart = () => `${today().slice(0, 7)}-01`;
const TABS = [['valuation', 'Stock value'], ['pnl', 'Profit'], ['ledger', 'Party ledger'], ['daybook', 'Day book'], ['sales', 'Sales register'], ['purchases', 'Purchase register'], ['gst', 'GST summary'], ['movement', 'Fast / slow / dead']];
const PATH = { valuation: 'valuation', pnl: 'pnl', ledger: 'ledger', daybook: 'daybook', sales: 'sales-register', purchases: 'purchase-register', gst: 'gst-summary', movement: 'movement' };
const rs = (v) => (v == null || v === '' ? '—' : `${Number(v) < 0 ? '−' : ''}${inr(Math.abs(v))}`);
const n3 = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
const pctT = (v) => (v == null ? '—' : `${v}%`);

// the CSV comes from the server (signed-in fetch, saved as a file)
async function downloadCsv(path) {
  try {
    const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}format=csv`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t download the report');
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'report.csv';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message); }
}
// a print view: the report's own tables in a clean window
function printView(title, sub, node) {
  const w = window.open('', '_blank');
  if (!w || !node) return;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0}p.sub{color:#555;margin:2px 0 14px}
    table{border-collapse:collapse;width:100%;margin:10px 0 18px}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
    th{background:#f6f3ea}td.r,th.r{text-align:right}.ir-note,.ir-strip{color:#444}.ir-strip{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}
    button,select,input{display:none}</style></head><body><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>${node.innerHTML}
    <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

const Strip = ({ items }) => (
  <div className="tl-strip ir-strip">{items.filter(Boolean).map(([label, value, sub, tone]) => (
    <div key={label} className={`tl-stat ${tone || ''}`}><div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div></div>
  ))}</div>
);
const Table = ({ cols, rows, foot, empty = 'Nothing in this period' }) => (!rows.length ? <p className="muted ir-empty">{empty}</p> : (
  <div className="tbl-wrap tl-tbl"><table className="tbl ir-tbl">
    <thead><tr>{cols.map(([, l, r]) => <th key={l} className={r ? 'r' : ''}>{l}</th>)}</tr></thead>
    <tbody>{rows.map((x, i) => <tr key={i} className={x._cls || ''}>{cols.map(([f, l, r]) => <td key={l} className={r ? 'r' : ''}>{f(x)}</td>)}</tr>)}</tbody>
    {foot && <tfoot><tr>{cols.map(([, l, r], i) => <td key={l} className={r ? 'r' : ''}>{foot[i] ?? ''}</td>)}</tr></tfoot>}
  </table></div>
));

export default function InventoryReports() {
  const [tab, setTab] = useState('valuation');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [asOf, setAsOf] = useState(today());
  const [party, setParty] = useState('');
  const [parties, setParties] = useState([]);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const box = useRef(null);
  useEffect(() => { api(`${R}/parties`).then((r) => setParties(r.parties)).catch(() => {}); }, []);
  const ranged = !['valuation', 'movement'].includes(tab);
  const query = tab === 'valuation' ? `asOf=${asOf}` : tab === 'movement' ? '' : tab === 'ledger' ? `party=${encodeURIComponent(party)}&from=${from}&to=${to}` : `from=${from}&to=${to}`;
  const path = `${R}/${PATH[tab]}${query ? `?${query}` : ''}`;
  useEffect(() => {
    setD(null); setErr('');
    if (tab === 'ledger' && !party) return;
    let live = true;
    api(path).then((r) => live && setD(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = TABS.find(([k]) => k === tab)[1] + (tab === 'ledger' && party ? ` — ${party}` : '');
  const sub = tab === 'valuation' ? `As of ${asOf}` : tab === 'movement' ? `As of ${today()}` : `${from} to ${to}`;

  return (
    <Panel title="Reports" className="ir" actions={<div className="row ir-actions">
      <button className="btn ghost sm" disabled={!d} onClick={() => downloadCsv(path)}><Icon name="download" size={14} /> CSV</button>
      <button className="btn ghost sm" disabled={!d} onClick={() => printView(title, sub, box.current)}><Icon name="receipt" size={14} /> Print</button>
    </div>}>
      <div className="ir-tabs seg" role="tablist" aria-label="Report">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="row ir-filters">
        {tab === 'valuation' && <label>As of <input type="date" value={asOf} max={today()} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></label>}
        {tab === 'ledger' && <label>Party <input list="ir-parties" value={party} onChange={(e) => setParty(e.target.value)} placeholder="Customer or supplier" /><datalist id="ir-parties">{parties.map((p) => <option key={p.name} value={p.name} />)}</datalist></label>}
        {ranged && <><label>From <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label><label>To <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label></>}
      </div>
      <div ref={box} className="ir-body">
        {err ? <p className="bad-t">{err}</p> : tab === 'ledger' && !party ? <Empty icon="users" title="Pick a party" text="Type or pick a customer or supplier to see their statement with a running balance." />
          : !d ? <div className="skeleton" /> : <Body tab={tab} d={d} />}
      </div>
    </Panel>
  );
}

function Body({ tab, d }) {
  if (tab === 'valuation') return <>
    <Strip items={[['Stock value (FIFO)', rs(d.totals.fifo), `${d.totals.items} items in stock`, 'in'], ['Weighted average', rs(d.totals.average), 'running average cost'], d.flagged.no_cost.length && ['No cost rate', d.flagged.no_cost.length, 'counted at ₹0 — add a purchase rate', 'bad']]} />
    {d.godowns.length > 1 && <Table cols={[[(g) => g.name, 'Godown'], [(g) => g.items, 'Items', 1], [(g) => rs(g.fifo), 'FIFO', 1], [(g) => rs(g.average), 'Average', 1]]} rows={d.godowns} />}
    <Table empty="No stock on this date" cols={[[(i) => <><b>{i.name}</b>{i.no_cost && <span className="pill bad">No cost rate</span>}{i.assumed_cost && <span className="pill warn">Item rate</span>}{i.negative && <span className="pill bad">Below zero</span>}</>, 'Item'], [(i) => i.category || '—', 'Category'], [(i) => `${n3(i.qty)} ${i.unit}`, 'Qty', 1], [(i) => rs(i.fifo.rate), 'FIFO rate', 1], [(i) => rs(i.fifo.value), 'FIFO value', 1], [(i) => rs(i.average.rate), 'Avg rate', 1], [(i) => rs(i.average.value), 'Avg value', 1], [(i) => i.by_godown.map((g) => `${g.godown}: ${n3(g.qty)}`).join(' · '), 'Godowns']]}
      rows={d.items} foot={['Total', '', '', '', rs(d.totals.fifo), '', rs(d.totals.average), '']} />
    <p className="hint ir-note">{d.rules}</p>
  </>;
  if (tab === 'pnl') {
    const s = d.sales;
    const lines = [['Counter bills (taxable value)', s.counter_bills], ['Less: credit notes', -s.credit_notes], s.stock_sales ? ['Stock sales without a bill', s.stock_sales] : null, s.stock_returns ? ['Less: returns without a credit note', -s.stock_returns] : null, ['Net sales', s.net, 'ir-sum'], ['Less: cost of goods sold (FIFO)', -d.cogs], ['Gross profit', d.gross_profit, 'ir-sum']].filter(Boolean);
    return <>
      <Strip items={[['Net sales', rs(s.net), 'after returns'], ['Gross profit', rs(d.gross_profit), d.margin_pct == null ? '' : `${d.margin_pct}% margin`, d.gross_profit < 0 ? 'bad' : 'in'], ['Purchases', rs(d.purchases.net), 'net of returns'], ['Closing stock', rs(d.stock.closing), `opening ${rs(d.stock.opening)}`]]} />
      <p className="ir-callout"><Icon name="bell" size={14} /> {d.note}</p>
      <div className="ir-two">
        <Table cols={[[(x) => x[0], 'Trading account'], [(x) => rs(x[1]), '₹', 1]]} rows={lines.map((x) => Object.assign([...x], { _cls: x[2] || '' }))} />
        <Table cols={[[(x) => x[0], 'Stock'], [(x) => rs(x[1]), '₹', 1]]} rows={[['Opening stock', d.stock.opening], ['Add: purchases (net)', d.purchases.net], ['Less: closing stock', -d.stock.closing], ['Goods used', d.stock.used], ['of which cost of goods sold', d.cogs], ['Adjustments, write-offs & production', d.stock.other]]} />
      </div>
      <h4 className="ir-h">By item</h4>
      <Table cols={[[(x) => x.name, 'Item'], [(x) => `${n3(x.qty_sold)}${x.free_qty ? ` +${n3(x.free_qty)} free` : ''}`, 'Sold', 1], [(x) => rs(x.net_sales), 'Net sales', 1], [(x) => rs(x.cogs), 'Cost', 1], [(x) => rs(x.gross_profit), 'Gross profit', 1], [(x) => pctT(x.margin_pct), 'Margin', 1]]} rows={d.by_item} />
      <h4 className="ir-h">By category</h4>
      <Table cols={[[(x) => x.category, 'Category'], [(x) => x.items, 'Items', 1], [(x) => rs(x.net_sales), 'Net sales', 1], [(x) => rs(x.cogs), 'Cost', 1], [(x) => rs(x.gross_profit), 'Gross profit', 1], [(x) => pctT(x.margin_pct), 'Margin', 1]]} rows={d.by_category} />
      {d.funnel_sales?.orders > 0 && <p className="hint ir-note"><b>Memo — online funnel sales:</b> {rs(d.funnel_sales.amount)} from {d.funnel_sales.orders} orders. {d.funnel_sales.note}</p>}
      {d.warnings.map((w) => <p key={w} className="hint ir-note warn-t">{w}</p>)}
    </>;
  }
  if (tab === 'ledger') return !d.found ? <Empty icon="users" title="No entries" text={`Nothing with “${d.party}” yet.`} /> : <>
    <Strip items={[['Closing balance', `${rs(Math.abs(d.closing))} ${d.closing_side}`, d.meaning, d.closing > 0 ? 'out' : 'in'], ['Debits', rs(d.totals.debit)], ['Credits', rs(d.totals.credit)]]} />
    <Table cols={[[(x) => x.day, 'Date'], [(x) => x.type, 'Type'], [(x) => x.ref, 'Number'], [(x) => <small>{x.details}</small>, 'Details'], [(x) => (x.debit ? rs(x.debit) : ''), 'Debit', 1], [(x) => (x.credit ? rs(x.credit) : ''), 'Credit', 1], [(x) => (x.balance == null ? '' : `${rs(Math.abs(x.balance))} ${x.side}`), 'Balance', 1]]}
      rows={[...(d.from ? [{ day: d.from, type: 'Opening balance', ref: '', details: '', balance: d.opening, side: d.opening_side, _cls: 'ir-sum' }] : []), ...d.entries]} foot={['', 'Total', '', '', rs(d.totals.debit), rs(d.totals.credit), `${rs(Math.abs(d.closing))} ${d.closing_side}`]} />
    <p className="hint ir-note">{d.note}</p>
  </>;
  if (tab === 'daybook') return <Table cols={[[(x) => x.day, 'Date'], [(x) => x.type, 'Type'], [(x) => x.ref, 'Number'], [(x) => x.party, 'Party'], [(x) => <small>{x.details}</small>, 'Details'], [(x) => n3(x.qty), 'Qty', 1], [(x) => rs(x.amount), 'Amount', 1]]} rows={d.rows} />;
  if (tab === 'sales') return <Table cols={[[(x) => x.day, 'Date'], [(x) => x.type, 'Type'], [(x) => x.number, 'Number'], [(x) => x.party, 'Party'], [(x) => x.gstin, 'GSTIN'], [(x) => rs(x.taxable), 'Taxable', 1], [(x) => rs(x.cgst), 'CGST', 1], [(x) => rs(x.sgst), 'SGST', 1], [(x) => rs(x.igst), 'IGST', 1], [(x) => rs(x.total), 'Total', 1], [(x) => <small>{x.status}</small>, 'Status']]}
    rows={d.rows} foot={['Total', '', '', '', '', rs(d.totals.taxable), rs(d.totals.cgst), rs(d.totals.sgst), rs(d.totals.igst), rs(d.totals.total), '']} />;
  if (tab === 'purchases') return <>
    <Table cols={[[(x) => x.day, 'Date'], [(x) => x.type, 'Type'], [(x) => x.ref, 'Bill no.'], [(x) => x.party, 'Supplier'], [(x) => <small>{x.items}</small>, 'Items'], [(x) => rs(x.value), 'Value', 1], [(x) => rs(x.gst_est), 'GST (est.)', 1], [(x) => rs(x.total_est), 'Total (est.)', 1]]}
      rows={d.rows} foot={['Total', '', '', '', '', rs(d.totals.value), rs(d.totals.gst_est), rs(d.totals.total_est)]} />
    <p className="hint ir-note">{d.note}</p>
  </>;
  if (tab === 'gst') return <>
    <Strip items={[['Net taxable', rs(d.totals.taxable), `${d.bills} bills · ${d.credit_notes} credit notes`], ['CGST + SGST', rs(d.totals.cgst + d.totals.sgst)], ['IGST', rs(d.totals.igst)], ['Total tax', rs(d.totals.tax), '', 'in']]} />
    <Table cols={[[(x) => `${x.rate}%`, 'GST rate'], [(x) => rs(x.sales_taxable), 'Sales', 1], [(x) => rs(x.returns_taxable), 'Returns', 1], [(x) => rs(x.taxable), 'Net taxable', 1], [(x) => rs(x.cgst), 'CGST', 1], [(x) => rs(x.sgst), 'SGST', 1], [(x) => rs(x.igst), 'IGST', 1], [(x) => rs(x.tax), 'Tax', 1]]}
      rows={d.rows} foot={['Total', rs(d.totals.sales_taxable), rs(d.totals.returns_taxable), rs(d.totals.taxable), rs(d.totals.cgst), rs(d.totals.sgst), rs(d.totals.igst), rs(d.totals.tax)]} />
    <p className="hint ir-note">{d.note}</p>
  </>;
  // fast / slow / dead
  const cols = [[(x) => x.name, 'Item'], [(x) => `${n3(x.stock)} ${x.unit}`, 'In stock', 1], [(x) => rs(x.value), 'Value', 1], [(x) => n3(x.perDay), 'Per day', 1], [(x) => (x.daysLeft == null ? '—' : x.daysLeft), 'Days left', 1], [(x) => x.lastSold || '—', 'Last sold']];
  return <>
    <Strip items={[['To reorder', d.counts.reorder, `lead ${d.leadDays} + ${d.safetyDays} days`, d.counts.reorder ? 'out' : 'in'], ['Fast', d.counts.fast, 'top fifth by sales'], ['Slow', d.counts.slow, `${rs(d.slowValue)} · over ${d.slowDays} days of stock`], ['Dead', d.counts.dead, `${rs(d.deadValue)} · no sale in 90 days`, d.counts.dead ? 'bad' : '']]} />
    <h4 className="ir-h">Reorder</h4>
    <Table empty="Nothing to reorder" cols={[...cols, [(x) => <b>{n3(x.reorderQty)} {x.unit}</b>, 'Order', 1], [(x) => x.supplier || '—', 'Last supplier']]} rows={d.reorder} />
    <h4 className="ir-h">Fast moving</h4><Table empty="No sales yet" cols={cols} rows={d.fast} />
    <h4 className="ir-h">Slow moving</h4><Table empty="Nothing slow" cols={cols} rows={d.slow} />
    <h4 className="ir-h">Dead stock</h4><Table empty="No dead stock" cols={cols} rows={d.dead} />
  </>;
}
