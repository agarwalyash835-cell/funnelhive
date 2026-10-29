// Inventory tools for the seller's industry (phase 3) — rendered inside the Inventory page. props: { me, items, onChange }
// (items: the page's item list with stock; onChange asks the page to reload). The seller's own industry's tools come
// first (from their CRM kit); every tool stays available. Server: server/inventory-pro.js.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Panel, Icon, Empty, Modal, toast, confirmDialog, promptDialog, inr } from '../ui';
import '../inventory-pro.css';

const P = '/inventory/pro';
const TAB = { bom: ['Production', 'layers'], batches: ['Batches & expiry', 'clock'], schemes: ['Schemes', 'tag'], variants: ['Variants', 'palette'], counter: ['Counter bill', 'receipt'], rates: ['Rate lists', 'list'], credit: ['Credit limits', 'wallet'] };
const MINE = { manufacturer: ['bom'], distributor: ['batches', 'schemes', 'rates', 'credit'], retailer: ['counter', 'variants'], store: ['variants', 'counter'] };
const rs = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const qn = (n) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const fail = (e) => toast(e.message);

function Strip({ items }) {
  return (
    <div className="tl-strip">{items.filter(Boolean).map(([label, value, sub, icon, tone]) => (
      <div key={label} className={`tl-stat ${tone || ''}`}>
        <span className="tl-stat-ic"><Icon name={icon} size={14} /></span>
        <div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div>
      </div>
    ))}</div>
  );
}
const ItemPick = ({ items, value, onChange, label = 'Item', exclude, ...rest }) => (
  <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={label} {...rest}>
    <option value="">{label}…</option>
    {items.filter((i) => i.id !== exclude).map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit ? ` (${i.unit})` : ''}</option>)}
  </select>
);
const Table = ({ head, rows, empty }) => (rows.length ? (
  <div className="tbl-wrap tl-tbl"><table className="tbl">
    <thead><tr>{head.map((h) => <th key={h} className={/^(Qty|Stock|Need|Have|Short|Rate|Amount|Limit|Owes|Left|Total|Per unit|Value)/.test(h) ? 'r' : ''}>{h}</th>)}</tr></thead>
    <tbody>{rows}</tbody>
  </table></div>
) : <p className="muted sm ip-none">{empty}</p>);

export default function IndustryTools({ me, items, onChange }) {
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState(null);
  const ok = Array.isArray(items);
  useEffect(() => { if (ok) api(P).then((d) => { setInfo(d); setTab((t) => t || d.sections[0]); }).catch(() => setInfo(null)); }, [ok]);
  if (!ok || !info) return null;
  const mine = MINE[info.industry] || [];
  const changed = () => onChange?.();
  const Body = { bom: BomTab, batches: BatchTab, schemes: SchemeTab, variants: VariantTab, counter: CounterTab, rates: RateTab, credit: CreditTab }[tab];
  return (
    <section className="ip">
      <div className="ip-head">
        <div><h2>Tools for your business</h2><p className="muted sm">{info.kit ? `Set up for ${info.kit} — every tool is here, yours come first.` : 'Production, batches, schemes, variants, counter billing, rate lists and credit limits.'}</p></div>
      </div>
      <div className="seg tl-tabs" role="tablist">{info.sections.map((k) => (
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
          <Icon name={TAB[k][1]} size={13} /> {TAB[k][0]}{mine.includes(k) && <span className="ip-yours" title="For your industry">●</span>}
        </button>
      ))}</div>
      {Body && <Body me={me} items={items} onChange={changed} />}
    </section>
  );
}

// ---------- manufacturers: bills of materials and production ----------
function BomTab({ items, onChange }) {
  const [boms, setBoms] = useState(null);
  const [edit, setEdit] = useState(null);
  const [plan, setPlan] = useState({}); // bomId → { qty, req }
  const load = () => api(`${P}/boms`).then(setBoms).catch(fail);
  useEffect(() => { load(); }, []);
  const check = async (b, qty) => { try { setPlan({ ...plan, [b.id]: { qty, req: await api(`${P}/boms/${b.id}/requirement?qty=${encodeURIComponent(qty)}`) } }); } catch (e) { fail(e); } };
  const produce = async (b) => {
    const qty = Number(plan[b.id]?.qty);
    if (!(qty > 0)) return toast('Enter how many to make');
    if (!(await confirmDialog({ title: `Make ${qty} ${b.item}?`, text: 'The components come out of stock and the finished item goes in — all together, or nothing if anything is short.', confirm: 'Produce' }))) return;
    try { const r = await api(`${P}/boms/${b.id}/produce`, 'POST', { qty }); toast(`Made ${r.produced} ${r.item}`); check(b, qty); onChange(); } catch (e) {
      if (e.data?.shortfall) setPlan({ ...plan, [b.id]: { ...plan[b.id], short: e.data.shortfall } });
      fail(e);
    }
  };
  if (!boms) return null;
  return (
    <Panel title="Bills of materials" actions={<button className="btn primary sm" onClick={() => setEdit({ itemId: '', lines: [{ itemId: '', qty: '' }] })}><Icon name="plus" size={14} /> New</button>}>
      {!boms.length ? <Empty icon="layers" title="What do you make?" text="List what one finished item uses — then produce in one step and see the raw material a plan needs." /> : boms.map((b) => {
        const p = plan[b.id] || {};
        return (
          <div key={b.id} className="ip-card">
            <div className="ip-card-h"><b>{b.item}</b><small className="muted">{b.lines.map((l) => `${qn(l.qty)} ${l.unit} ${l.name}`.replace('  ', ' ')).join(' · ')}</small>
              <div className="row"><button className="btn ghost sm" onClick={() => setEdit(b)}><Icon name="edit" size={13} /> Edit</button></div></div>
            <div className="row ip-plan">
              <input type="number" min="0" step="any" placeholder={`How many ${b.item}?`} value={p.qty || ''} onChange={(e) => setPlan({ ...plan, [b.id]: { qty: e.target.value } })} aria-label="Quantity to make" />
              <button className="btn ghost sm" disabled={!(Number(p.qty) > 0)} onClick={() => check(b, p.qty)}>Raw material needed</button>
              <button className="btn primary sm" disabled={!(Number(p.qty) > 0)} onClick={() => produce(b)}><Icon name="bolt" size={13} /> Produce</button>
            </div>
            {p.req && <>
              <Strip items={[['Can make now', qn(p.req.can_make), `with stock in hand`, 'box', p.req.can_make >= p.req.qty ? 'in' : 'bad'], ['Material cost', inr(p.req.cost), `for ${qn(p.req.qty)}`, 'wallet', 'out'], ['Short items', p.req.short.length, p.req.short.length ? 'buy before producing' : 'all in stock', 'bell', p.req.short.length ? 'bad' : 'in']]} />
              <Table head={['Material', 'Per unit', 'Need', 'Have', 'Short']} rows={p.req.lines.map((l) => <tr key={l.itemId} className={l.short ? 'ip-short' : ''}><td>{l.name}</td><td className="r">{qn(l.per)} {l.unit}</td><td className="r">{qn(l.need)}</td><td className="r">{qn(l.have)}</td><td className="r">{l.short ? <b className="bad-t">{qn(l.short)}</b> : '—'}</td></tr>)} />
            </>}
          </div>
        );
      })}
      {edit && <BomForm bom={edit} items={items} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </Panel>
  );
}
function BomForm({ bom, items, onClose, onSaved }) {
  const [b, setB] = useState({ itemId: bom.itemId, lines: bom.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) });
  const setLine = (k, p) => setB({ ...b, lines: b.lines.map((l, j) => (j === k ? { ...l, ...p } : l)) });
  const save = async (e) => { e.preventDefault(); try { await api(`${P}/boms`, 'PUT', { itemId: b.itemId, lines: b.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) }); toast('Bill of materials saved'); onSaved(); } catch (e2) { fail(e2); } };
  const del = async () => { if (await confirmDialog({ title: 'Delete this bill of materials?', text: 'Stock and past production stay as they are.', confirm: 'Delete', danger: true })) { try { await api(`${P}/boms/${bom.id}`, 'DELETE'); onSaved(); } catch (e) { fail(e); } } };
  return (
    <Modal title={bom.id ? `Edit — ${bom.item}` : 'New bill of materials'} onClose={onClose}>
      <form onSubmit={save} className="ip-form">
        <label>Finished item<ItemPick items={items} value={b.itemId} onChange={(v) => setB({ ...b, itemId: v })} label="What you make" required disabled={!!bom.id} /></label>
        <small className="muted">Components for one unit</small>
        {b.lines.map((l, k) => (
          <div className="ip-line" key={k}>
            <ItemPick items={items} value={l.itemId} exclude={b.itemId} onChange={(v) => setLine(k, { itemId: v })} label="Component" />
            <input type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(k, { qty: e.target.value })} placeholder="Qty per unit" aria-label="Quantity per unit" />
            <button type="button" className="icon-btn" aria-label="Remove component" onClick={() => setB({ ...b, lines: b.lines.filter((_, j) => j !== k) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <div className="row"><button type="button" className="btn ghost sm" onClick={() => setB({ ...b, lines: [...b.lines, { itemId: '', qty: '' }] })}><Icon name="plus" size={14} /> Add component</button></div>
        <div className="row ip-foot">{bom.id && <button type="button" className="btn ghost danger" onClick={del}>Delete</button>}<span className="grow" /><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

// ---------- distributors: batches, expiry, first-expiry-first-out ----------
function BatchTab({ items }) {
  const [days, setDays] = useState(30);
  const [exp, setExp] = useState(null);
  const [batches, setBatches] = useState([]);
  const [f, setF] = useState({ itemId: '', qty: '' });
  const [sugg, setSugg] = useState(null);
  useEffect(() => { api(`${P}/expiring?days=${days}`).then(setExp).catch(fail); }, [days]);
  useEffect(() => { api(`${P}/batches`).then((b) => setBatches(b.filter((x) => x.batch))).catch(fail); }, []);
  const suggest = async () => { try { setSugg(await api(`${P}/fefo?itemId=${f.itemId}&qty=${encodeURIComponent(f.qty)}`)); } catch (e) { fail(e); } };
  if (!exp) return null;
  const expired = exp.batches.filter((b) => b.expired);
  return (<>
    <Strip items={[['Expiring', exp.batches.length - expired.length, `in the next ${days} days`, 'clock', 'out'], ['Expired', expired.length, expired.length ? 'return or write off' : 'none in stock', 'bell', expired.length ? 'bad' : 'in'], ['Value at risk', inr(exp.batches.reduce((s, b) => s + b.value, 0)), 'at purchase rate', 'wallet', exp.batches.length ? 'bad' : 'in']]} />
    <Panel title="Expiring soon" actions={<div className="seg" role="radiogroup" aria-label="Days ahead">{[30, 60, 90].map((d) => <button key={d} role="radio" aria-checked={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d} days</button>)}</div>} pad={false}>
      <Table head={['Item', 'Batch', 'Expiry', 'Stock', 'Value']} empty={`Nothing expires in the next ${days} days. Record batch and expiry when stock comes in.`}
        rows={exp.batches.map((b) => <tr key={b.itemId + b.batch}><td>{b.item}</td><td className="mono">{b.batch}</td><td>{b.expiry} <span className={`pill ${b.expired ? 'bad' : b.days_left <= 30 ? 'warn' : 'info'}`}>{b.expired ? 'Expired' : `${b.days_left} days`}</span></td><td className="r">{qn(b.qty)} {b.unit}</td><td className="r">{inr(b.value)}</td></tr>)} />
    </Panel>
    <Panel title="Which batch to sell (first expiry first out)">
      <div className="row ip-plan"><ItemPick items={items} value={f.itemId} onChange={(v) => setF({ ...f, itemId: v })} /><input type="number" min="0" step="any" placeholder="Qty" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} aria-label="Quantity" /><button className="btn ghost sm" disabled={!f.itemId || !(Number(f.qty) > 0)} onClick={suggest}>Suggest</button></div>
      {sugg && <p className="sm ip-sugg">{sugg.take.length ? sugg.take.map((t) => `${qn(t.qty)} from ${t.batch ? `batch ${t.batch}${t.expiry ? ` (exp ${t.expiry})` : ''}` : 'unbatched stock'}`).join(' · ') : 'No sellable stock.'}{sugg.short > 0 && <b className="bad-t"> · {qn(sugg.short)} short</b>}{sugg.expired?.length > 0 && <span className="muted"> · not suggested (expired): {sugg.expired.map((b) => b.batch).join(', ')}</span>}</p>}
    </Panel>
    <Panel title="Stock by batch" pad={false}>
      <Table head={['Item', 'Batch', 'Expiry', 'Stock']} empty="No batches yet." rows={batches.map((b) => <tr key={b.itemId + b.batch}><td>{b.item}</td><td className="mono">{b.batch}</td><td>{b.expiry || '—'}</td><td className="r">{qn(b.qty)} {b.unit}</td></tr>)} />
    </Panel>
  </>);
}

// ---------- distributors: schemes and the calculator ----------
function SchemeTab({ items }) {
  const [list, setList] = useState(null);
  const [s, setS] = useState({ itemId: '', kind: 'FREE', buy: '', free: '', pct: '', min_qty: '', from: '', to: '' });
  const [calc, setCalc] = useState({ itemId: '', qty: '' });
  const [res, setRes] = useState(null);
  const load = () => api(`${P}/schemes`).then(setList).catch(fail);
  useEffect(() => { load(); }, []);
  const add = async (e) => { e.preventDefault(); try { await api(`${P}/schemes`, 'POST', s); toast('Scheme added'); setS({ ...s, buy: '', free: '', pct: '', min_qty: '' }); load(); } catch (e2) { fail(e2); } };
  const toggle = async (x) => { try { await api(`${P}/schemes/${x.id}`, 'PUT', { active: x.active === false }); load(); } catch (e) { fail(e); } };
  const del = async (x) => { try { await api(`${P}/schemes/${x.id}`, 'DELETE'); load(); } catch (e) { fail(e); } };
  const run = async () => { try { setRes(await api(`${P}/schemes/calc`, 'POST', { itemId: calc.itemId, qty: Number(calc.qty) })); } catch (e) { fail(e); } };
  if (!list) return null;
  return (<>
    <Panel title="Scheme calculator">
      <div className="row ip-plan"><ItemPick items={items} value={calc.itemId} onChange={(v) => setCalc({ ...calc, itemId: v })} /><input type="number" min="0" step="any" placeholder="Qty" value={calc.qty} onChange={(e) => setCalc({ ...calc, qty: e.target.value })} aria-label="Quantity" /><button className="btn ghost sm" disabled={!calc.itemId || !(Number(calc.qty) > 0)} onClick={run}>Work it out</button></div>
      {res && <Strip items={[['Bill', `${qn(res.qty)}${res.free_qty ? ` + ${qn(res.free_qty)} free` : ''}`, res.scheme ? res.scheme.name : 'no scheme applies', 'tag', res.scheme ? 'in' : ''], ['Discount', rs(res.discount), `on ${rs(res.gross)} at ${rs(res.rate)}`, 'refund', res.discount ? 'in' : ''], ['GST', rs(res.gst), `${res.gst_percent}% on ${rs(res.taxable)}`, 'receipt'], ['Total', rs(res.amount), 'incl. GST', 'wallet', 'out']]} />}
    </Panel>
    <Panel title="Schemes" pad={false}>
      <form className="ip-inline" onSubmit={add}>
        <ItemPick items={items} value={s.itemId} onChange={(v) => setS({ ...s, itemId: v })} required />
        <select value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value })} aria-label="Scheme type"><option value="FREE">Buy X get Y free</option><option value="PERCENT">% off</option></select>
        {s.kind === 'FREE' ? <><input type="number" min="1" placeholder="Buy" value={s.buy} onChange={(e) => setS({ ...s, buy: e.target.value })} aria-label="Buy quantity" required /><input type="number" min="1" placeholder="Get free" value={s.free} onChange={(e) => setS({ ...s, free: e.target.value })} aria-label="Free quantity" required /></>
          : <><input type="number" min="0" max="100" step="any" placeholder="% off" value={s.pct} onChange={(e) => setS({ ...s, pct: e.target.value })} aria-label="Discount percent" required /><input type="number" min="0" step="any" placeholder="Min qty" value={s.min_qty} onChange={(e) => setS({ ...s, min_qty: e.target.value })} aria-label="Minimum quantity" /></>}
        <input type="date" value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} aria-label="From" title="From (optional)" /><input type="date" value={s.to} onChange={(e) => setS({ ...s, to: e.target.value })} aria-label="Until" title="Until (optional)" />
        <button className="btn primary sm"><Icon name="plus" size={13} /> Add</button>
      </form>
      <Table head={['Item', 'Scheme', 'Valid', '']} empty="No schemes yet." rows={list.map((x) => <tr key={x.id} className={x.active === false ? 'ip-off' : ''}><td>{x.item}</td><td><b>{x.name}</b></td><td className="sm">{x.from || x.to ? `${x.from || '…'} → ${x.to || '…'}` : 'Always'}</td><td className="r"><button className="btn ghost sm" onClick={() => toggle(x)}>{x.active === false ? 'Turn on' : 'Pause'}</button><button className="icon-btn" aria-label="Delete scheme" onClick={() => del(x)}><Icon name="trash" size={14} /></button></td></tr>)} />
    </Panel>
  </>);
}

// ---------- retailers: variants (size × colour) ----------
function VariantTab({ items, onChange }) {
  const [grids, setGrids] = useState(null);
  const [v, setV] = useState({ parentId: '', sizes: '', colours: '' });
  const load = () => api(`${P}/variants`).then(setGrids).catch(fail);
  useEffect(() => { load(); }, []);
  const make = async (e) => { e.preventDefault(); try { const r = await api(`${P}/variants`, 'POST', v); toast(`${r.made.length} variants added${r.skipped.length ? ` · ${r.skipped.length} were there already` : ''}`); setV({ ...v, sizes: '', colours: '' }); load(); onChange(); } catch (e2) { fail(e2); } };
  if (!grids) return null;
  const variantIds = new Set(grids.flatMap((g) => g.cells.map((c) => c.id)));
  return (<>
    <Panel title="Make variants">
      <form className="ip-inline" onSubmit={make}>
        <ItemPick items={items.filter((i) => !variantIds.has(i.id))} value={v.parentId} onChange={(x) => setV({ ...v, parentId: x })} label="Main item" required />
        <input placeholder="Sizes: S, M, L, XL" value={v.sizes} onChange={(e) => setV({ ...v, sizes: e.target.value })} aria-label="Sizes" />
        <input placeholder="Colours: Blue, White" value={v.colours} onChange={(e) => setV({ ...v, colours: e.target.value })} aria-label="Colours" />
        <button className="btn primary sm"><Icon name="plus" size={13} /> Make</button>
      </form>
      <small className="muted">Each size × colour becomes its own item with its own stock, barcode and SKU (rate and GST copied from the main item).</small>
    </Panel>
    {!grids.length ? <Empty icon="palette" title="No variants yet" text="Sell a shirt in 4 sizes and 3 colours? Make the 12 variants in one go and see stock as a grid." /> : grids.map((g) => {
      const sizes = g.sizes.length ? g.sizes : [null], cols = g.colours.length ? g.colours : [null];
      const cell = (s, c) => g.cells.find((x) => x.size === s && x.colour === c);
      return (
        <Panel key={g.parent.id} title={g.parent.name} pad={false}>
          <div className="tbl-wrap tl-tbl"><table className="tbl ip-grid">
            <thead><tr><th>Size</th>{cols.map((c) => <th key={c || '-'} className="r">{c || 'Stock'}</th>)}</tr></thead>
            <tbody>{sizes.map((s) => <tr key={s || '-'}><td><b>{s || '—'}</b></td>{cols.map((c) => { const x = cell(s, c); return <td key={c || '-'} className={`r ${x && x.stock <= 0 ? 'ip-zero' : ''}`} title={x ? `${x.name}${x.barcode ? ` · ${x.barcode}` : ''}` : ''}>{x ? qn(x.stock) : '·'}</td>; })}</tr>)}</tbody>
          </table></div>
        </Panel>
      );
    })}
  </>);
}

// ---------- retailers: quick counter billing ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a credit note prints in the same view: its lines are what came back, its total the refund
const MODE = { cash: 'Refunded in cash', credit: 'Credited to the account' };
function printBill(b, me) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return toast('Allow pop-ups to print the bill');
  const biz = me?.settings?.businessName || me?.name || '', cn = !!b.bill_number;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.number)}</title><style>
    body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:0;padding:18px;max-width:380px} h1{font-size:16px;margin:0} .m{color:#555;font-size:12px}
    table{width:100%;border-collapse:collapse;margin:10px 0} th,td{padding:4px 2px;text-align:left;vertical-align:top} th{border-bottom:1px solid #111;font-size:11px;text-transform:uppercase}
    .r{text-align:right;white-space:nowrap} tfoot td{border-top:1px dashed #888} .t td{font-weight:700;font-size:15px;border-top:1px solid #111}
    @media print{@page{size:80mm auto;margin:4mm} body{padding:0} button{display:none}}</style></head><body>
    <h1>${esc(biz)}</h1><div class="m">${cn ? `Credit note ${esc(b.number)} · against bill ${esc(b.bill_number)} (${esc(b.bill_day)})` : `Bill ${esc(b.number)}`} · ${esc(b.day)}${b.party_name ? ` · ${esc(b.party_name)}` : ''}${b.credit && !cn ? ' · On credit' : ''}</div>${cn && b.reason ? `<div class="m">Reason: ${esc(b.reason)}</div>` : ''}
    <table><thead><tr><th>${cn ? 'Returned' : 'Item'}</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
    ${b.lines.map((l) => `<tr><td>${esc(l.name)}${l.hsn ? `<div class="m">HSN ${esc(l.hsn)}</div>` : ''}${l.scheme ? `<div class="m">${esc(l.scheme.name)}${l.free_qty ? ` — ${l.free_qty} free` : ''}</div>` : ''}${l.returned_qty ? `<div class="m">${l.returned_qty} returned</div>` : ''}</td><td class="r">${l.qty}</td><td class="r">${rs(l.rate)}</td><td class="r">${rs(l.taxable)}<div class="m">+${l.gst_percent}% GST</div></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3">Taxable</td><td class="r">${rs(b.taxable)}</td></tr>${b.discount ? `<tr><td colspan="3">Scheme discount</td><td class="r">−${rs(b.discount)}</td></tr>` : ''}
    <tr><td colspan="3">GST</td><td class="r">${rs(b.gst)}</td></tr>${b.round_off ? `<tr><td colspan="3">Round off</td><td class="r">${rs(b.round_off)}</td></tr>` : ''}
    <tr class="t"><td colspan="3">${cn ? 'Refund' : 'Total'}</td><td class="r">${rs(b.total)}</td></tr>
    ${!cn && b.returned ? `<tr><td colspan="3">Returned (${b.returns.map((n) => esc(n.number)).join(', ')})</td><td class="r">−${rs(b.returned)}</td></tr><tr class="t"><td colspan="3">Net</td><td class="r">${rs(b.net_total)}</td></tr>` : ''}</tfoot></table>
    <p class="m">${cn ? esc(MODE[b.refund_mode] || '') : 'Thank you! Visit again.'}</p><button onclick="print()">Print</button><script>setTimeout(()=>print(),200)</script></body></html>`);
  w.document.close();
}
function CounterTab({ me, items, onChange }) {
  const [lines, setLines] = useState([]);
  const [scan, setScan] = useState('');
  const [pick, setPick] = useState({ itemId: '', qty: 1 });
  const [o, setO] = useState({ party_name: '', credit: false, ratelistId: '' });
  const [pre, setPre] = useState(null);
  const [lists, setLists] = useState([]);
  const [bills, setBills] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ret, setRet] = useState(null);
  const [today, setToday] = useState(null);
  const loadBills = () => { api(`${P}/bills?limit=20`).then(setBills).catch(fail); api(`${P}/counter/day`).then(setToday).catch(() => {}); };
  useEffect(() => { loadBills(); api(`${P}/ratelists`).then(setLists).catch(() => {}); }, []);
  const body = { ...o, ratelistId: o.ratelistId || undefined, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) };
  useEffect(() => {
    if (!lines.length) { setPre(null); return; }
    const t = setTimeout(() => api(`${P}/bills/preview`, 'POST', body).then(setPre).catch((e) => { setPre(null); fail(e); }), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(body)]);
  const addLine = (item, qty = 1) => setLines((ls) => { const i = ls.findIndex((l) => l.itemId === item.id); return i >= 0 ? ls.map((l, j) => (j === i ? { ...l, qty: Number(l.qty) + Number(qty) } : l)) : [...ls, { itemId: item.id, name: item.name, qty }]; });
  const scanned = (e) => {
    e.preventDefault();
    const code = scan.trim(); if (!code) return;
    const it = items.find((i) => i.barcode === code) || items.find((i) => i.sku && i.sku.toLowerCase() === code.toLowerCase());
    if (!it) return toast(`No item with barcode / SKU ${code}`);
    addLine(it); setScan('');
  };
  const save = async (override = false) => {
    setBusy(true);
    try {
      const b = await api(`${P}/bills`, 'POST', { ...body, override });
      toast(`Bill ${b.number} saved — ${inr(b.total)}`); setLines([]); setO({ ...o, party_name: '', credit: false }); loadBills(); onChange(); printBill(b, me);
    } catch (e) {
      if (e.data?.code === 'CREDIT_LIMIT' && (await confirmDialog({ title: 'Over the credit limit', text: `${e.message}. Save the bill anyway?`, confirm: 'Save anyway', danger: true }))) { setBusy(false); return save(true); }
      fail(e);
    }
    setBusy(false);
  };
  const act = async (b, what) => {
    if (what === 'cancel' && !(await confirmDialog({ title: `Cancel bill ${b.number}?`, text: 'Its items go back into stock.', confirm: 'Cancel bill', danger: true }))) return;
    try { await api(`${P}/bills/${b.id}/${what}`, 'POST', {}); loadBills(); if (what === 'cancel') onChange(); } catch (e) { fail(e); }
  };
  const openNote = async (id) => { try { printBill(await api(`${P}/credit-notes/${id}`), me); } catch (e) { fail(e); } };
  const left = (b) => b.lines.reduce((s, l) => s + l.qty + (l.free_qty || 0) - (l.returned_qty || 0), 0) > 0.0005;
  return (<>
    {today && (today.bills > 0 || today.credit_notes > 0) && <Strip items={[['Today’s bills', inr(today.gross), `${today.bills} ${today.bills === 1 ? 'bill' : 'bills'}`, 'receipt'], ['Returns', inr(today.returns), today.credit_notes ? `${today.credit_notes} credit ${today.credit_notes === 1 ? 'note' : 'notes'}` : 'none today', 'refund', today.returns ? 'bad' : ''], ['Net sales', inr(today.net), today.cash_refunds ? `${inr(today.cash_refunds)} refunded in cash` : 'bills less returns', 'wallet', 'in']]} />}
    <Panel title="Counter bill">
      <div className="ip-counter">
        <form className="row ip-plan" onSubmit={scanned}><input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan barcode or type SKU, then Enter" aria-label="Barcode or SKU" /><button className="btn ghost sm">Add</button></form>
        <div className="row ip-plan"><ItemPick items={items} value={pick.itemId} onChange={(v) => setPick({ ...pick, itemId: v })} /><input type="number" min="0" step="any" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} aria-label="Quantity" /><button className="btn ghost sm" disabled={!pick.itemId} onClick={() => { addLine(items.find((i) => i.id === pick.itemId), Number(pick.qty) || 1); setPick({ itemId: '', qty: 1 }); }}><Icon name="plus" size={13} /> Add</button></div>
      </div>
      {lines.length > 0 && <div className="tbl-wrap tl-tbl"><table className="tbl">
        <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">GST</th><th className="r">Amount</th><th /></tr></thead>
        <tbody>{lines.map((l, k) => { const p = pre?.lines[k]; return (
          <tr key={l.itemId}><td>{l.name}{p?.scheme && <small className="sub-t ok-t">{p.scheme.name}{p.free_qty ? ` — ${qn(p.free_qty)} free` : ` — ${rs(p.discount)} off`}</small>}</td>
            <td className="r"><input className="ip-qty" type="number" min="0" step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} aria-label={`Quantity of ${l.name}`} /></td>
            <td className="r">{p ? rs(p.rate) : '…'}</td><td className="r">{p ? `${p.gst_percent}%` : ''}</td><td className="r">{p ? rs(p.amount) : ''}</td>
            <td className="r"><button className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== k))}><Icon name="x" size={14} /></button></td></tr>
        ); })}</tbody>
      </table></div>}
      <div className="ip-inline ip-billopts">
        <input placeholder="Customer / party (optional)" value={o.party_name} onChange={(e) => setO({ ...o, party_name: e.target.value })} aria-label="Party" />
        {lists.length > 0 && <select value={o.ratelistId} onChange={(e) => setO({ ...o, ratelistId: e.target.value })} aria-label="Rate list"><option value="">Party’s / item rates</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} rates</option>)}</select>}
        <label className="ip-check"><input type="checkbox" checked={o.credit} onChange={(e) => setO({ ...o, credit: e.target.checked })} /> On credit (udhaar)</label>
      </div>
      {pre && <>
        {pre.credit_check && <p className={`sm ip-credit ${pre.credit_check.over ? 'bad' : ''}`}><Icon name={pre.credit_check.over ? 'bell' : 'wallet'} size={13} /> {pre.credit_check.message}</p>}
        <div className="ip-total"><span>Taxable {rs(pre.taxable)}{pre.discount ? ` · scheme −${rs(pre.discount)}` : ''} · GST {rs(pre.gst)}{pre.round_off ? ` · round off ${rs(pre.round_off)}` : ''}</span><b>{inr(pre.total)}</b>
          <button className="btn primary" disabled={busy || (o.credit && !o.party_name.trim())} onClick={() => save()}><Icon name="receipt" size={14} /> Save & print</button></div>
      </>}
    </Panel>
    <Panel title="Recent bills" pad={false}>
      <Table head={['Bill', 'Party', 'Total', 'Status', '']} empty="No counter bills yet." rows={bills.map((b) => <tr key={b.id} className={b.cancelled ? 'ip-off' : ''}><td><b className="mono">{b.number}</b><small className="sub-t">{b.day}</small></td><td>{b.party_name || '—'}</td>
        <td className="r">{b.returned ? <><s className="muted">{inr(b.total)}</s> {inr(b.net_total)}</> : inr(b.total)}{b.returns?.length > 0 && <small className="sub-t ip-cns">{b.returns.map((n) => <button key={n.id} className="ip-cn" onClick={() => openNote(n.id)} title={`Print credit note ${n.number}`}>{n.number} −{inr(n.total)}</button>)}</small>}</td>
        <td>{b.cancelled ? <span className="pill">Cancelled</span> : b.credit && !b.paid ? <span className="pill warn">Credit · unpaid</span> : <span className="pill ok">Paid</span>}{!b.cancelled && b.returns?.length > 0 && <span className={`pill ${left(b) ? 'info' : ''}`}>{left(b) ? 'Part returned' : 'Returned'}</span>}</td>
        <td className="r nowrap"><button className="btn ghost sm" onClick={() => printBill(b, me)}>Print</button>{!b.cancelled && left(b) && <button className="btn ghost sm" onClick={() => setRet(b)}><Icon name="refund" size={13} /> Return</button>}{!b.cancelled && b.credit && !b.paid && <button className="btn ghost sm" onClick={() => act(b, 'paid')}>Mark paid</button>}{!b.cancelled && !b.returns?.length && <button className="btn ghost sm" onClick={() => act(b, 'cancel')}>Cancel</button>}</td></tr>)} />
    </Panel>
    {ret && <ReturnForm bill={ret} me={me} onClose={() => setRet(null)} onSaved={() => { setRet(null); loadBills(); onChange(); }} />}
  </>);
}

// a return against a bill: pieces per line (free pieces count too), the refund priced by the server as you type
function ReturnForm({ bill, me, onClose, onSaved }) {
  const owed = bill.credit && !bill.paid;
  const [qty, setQty] = useState(() => bill.lines.map(() => ''));
  const [o, setO] = useState({ reason: '', refund_mode: owed ? 'credit' : 'cash' });
  const [pre, setPre] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = { ...o, lines: qty.map((q, i) => ({ line: i, qty: Number(q) })).filter((l) => l.qty > 0) };
  useEffect(() => {
    if (!body.lines.length) { setPre(null); return; }
    const t = setTimeout(() => api(`${P}/bills/${bill.id}/return/preview`, 'POST', body).then(setPre).catch((e) => { setPre(null); fail(e); }), 250);
    return () => clearTimeout(t);
  }, [JSON.stringify(body)]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const n = await api(`${P}/bills/${bill.id}/return`, 'POST', body); toast(`Credit note ${n.number} — ${inr(n.total)} ${n.refund_mode === 'cash' ? 'to refund in cash' : `credited to ${n.party_name}`}`); printBill(n, me); onSaved(); } catch (e2) { fail(e2); }
    setBusy(false);
  };
  return (
    <Modal title={`Return on bill ${bill.number}`} onClose={onClose}>
      <form onSubmit={save} className="ip-form">
        <div className="tbl-wrap tl-tbl"><table className="tbl">
          <thead><tr><th>Item</th><th className="r">Sold</th><th className="r">Back</th><th className="r">Refund</th></tr></thead>
          <tbody>{bill.lines.map((l, i) => {
            const sold = l.qty + (l.free_qty || 0), can = Math.round((sold - (l.returned_qty || 0)) * 1000) / 1000, p = pre?.lines.find((x) => x.line === i);
            return (
              <tr key={i} className={can <= 0 ? 'ip-off' : ''}><td>{l.name}{l.free_qty ? <small className="sub-t">{qn(l.qty)} + {qn(l.free_qty)} free · {l.scheme?.name}</small> : null}{l.returned_qty ? <small className="sub-t">{qn(l.returned_qty)} already returned</small> : null}</td>
                <td className="r">{qn(sold)} {l.unit}</td>
                <td className="r"><input className="ip-qty" type="number" min="0" max={can} step="any" value={qty[i]} disabled={can <= 0} placeholder={can > 0 ? `up to ${qn(can)}` : '—'} onChange={(e) => setQty(qty.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Pieces of ${l.name} returned`} /></td>
                <td className="r">{p ? rs(p.amount) : ''}</td></tr>
            );
          })}</tbody>
        </table></div>
        <div className="ip-inline ip-billopts">
          <input placeholder="Reason (optional) — e.g. size exchange" value={o.reason} onChange={(e) => setO({ ...o, reason: e.target.value })} aria-label="Reason" />
          {!owed && bill.party_name && <select value={o.refund_mode} onChange={(e) => setO({ ...o, refund_mode: e.target.value })} aria-label="Refund as"><option value="cash">Refund in cash</option><option value="credit">Credit to {bill.party_name}’s account</option></select>}
        </div>
        {owed && <p className="sm ip-credit"><Icon name="wallet" size={13} /> On credit and unpaid — the refund comes off what {bill.party_name} owes.</p>}
        <div className="ip-total"><span>{pre ? <>Taxable {rs(pre.taxable)} · GST {rs(pre.gst)}{pre.round_off ? ` · round off ${rs(pre.round_off)}` : ''}{pre.lines.some((l) => l.taxable === 0) ? ' · a free piece kept by the scheme refunds ₹0' : ''}</> : 'Enter the pieces that came back.'}</span><b>{inr(pre?.total || 0)}</b>
          <button className="btn primary" disabled={busy || !pre}><Icon name="refund" size={14} /> Save & print credit note</button></div>
      </form>
    </Modal>
  );
}

// ---------- traders: rate lists ----------
function RateTab({ items }) {
  const [lists, setLists] = useState(null);
  const [cur, setCur] = useState('');
  const [draft, setDraft] = useState({});
  const [q, setQ] = useState('');
  const load = () => api(`${P}/ratelists`).then((l) => { setLists(l); setCur((c) => c || l[0]?.id || ''); }).catch(fail);
  useEffect(() => { load(); }, []);
  const list = lists?.find((l) => l.id === cur);
  useEffect(() => { setDraft({}); }, [cur]);
  const add = async () => { const name = await promptDialog({ title: 'New rate list', label: 'Name', placeholder: 'e.g. Wholesale, Dealer, Retail' }); if (!name) return; try { const l = await api(`${P}/ratelists`, 'POST', { name }); setCur(l.id); load(); } catch (e) { fail(e); } };
  const save = async () => { try { await api(`${P}/ratelists/${cur}`, 'PUT', { rates: draft }); toast('Rates saved'); setDraft({}); load(); } catch (e) { fail(e); } };
  const del = async () => { if (await confirmDialog({ title: `Delete the ${list.name} list?`, text: 'Parties using it go back to item rates.', confirm: 'Delete', danger: true })) { try { await api(`${P}/ratelists/${cur}`, 'DELETE'); setCur(''); load(); } catch (e) { fail(e); } } };
  const shown = useMemo(() => items.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())), [items, q]);
  if (!lists) return null;
  return (
    <Panel title="Rate lists" actions={<>{lists.length > 0 && <select value={cur} onChange={(e) => setCur(e.target.value)} aria-label="Rate list">{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}<button className="btn primary sm" onClick={add}><Icon name="plus" size={14} /> New list</button></>} pad={false}>
      {!list ? <Empty icon="list" title="One item, different prices" text="Make lists like Retail, Wholesale and Dealer with a rate per item — give a party their list and bills price themselves." /> : <>
        <div className="row ip-plan ip-pad"><input placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" /><span className="grow" />{Object.keys(draft).length > 0 && <button className="btn primary sm" onClick={save}>Save {Object.keys(draft).length} rates</button>}<button className="btn ghost sm danger" onClick={del}>Delete list</button></div>
        <Table head={['Item', 'Sale rate', `Rate — ${list.name}`]} empty="No items match." rows={shown.map((i) => {
          const v = i.id in draft ? draft[i.id] : list.rates[i.id] ?? '';
          return <tr key={i.id}><td>{i.name}</td><td className="r muted">{i.sale_rate != null ? rs(i.sale_rate) : '—'}</td><td className="r"><input className="ip-qty" type="number" min="0" step="any" value={v ?? ''} placeholder="item rate" onChange={(e) => setDraft({ ...draft, [i.id]: e.target.value === '' ? null : e.target.value })} aria-label={`${list.name} rate for ${i.name}`} /></td></tr>;
        })} />
      </>}
    </Panel>
  );
}

// ---------- traders: credit limits ----------
function CreditTab() {
  const [rows, setRows] = useState(null);
  const [lists, setLists] = useState([]);
  const [f, setF] = useState({ party_name: '', limit: '', ratelistId: '' });
  const load = () => api(`${P}/credit`).then(setRows).catch(fail);
  useEffect(() => { load(); api(`${P}/ratelists`).then(setLists).catch(() => {}); }, []);
  const save = async (e) => { e.preventDefault(); try { const r = await api(`${P}/credit`, 'PUT', { ...f, limit: Number(f.limit), ratelistId: f.ratelistId || null }); toast(r.message); setF({ party_name: '', limit: '', ratelistId: '' }); load(); } catch (e2) { fail(e2); } };
  const del = async (r) => { try { await api(`${P}/credit/${r.id}`, 'DELETE'); load(); } catch (e) { fail(e); } };
  if (!rows) return null;
  const over = rows.filter((r) => r.over || (r.limit != null && r.outstanding > r.limit));
  return (<>
    <Strip items={[['Parties with a limit', rows.length, 'credit limits set', 'users'], ['Over the limit', over.length, over.length ? 'hold new credit' : 'all within limit', 'bell', over.length ? 'bad' : 'in'], ['They owe you', inr(rows.reduce((s, r) => s + r.outstanding, 0)), rows[0]?.outstanding_from === 'tally' ? 'from your Tally bills' : 'unpaid credit bills', 'wallet', 'out']]} />
    <Panel title="Credit limits" pad={false}>
      <form className="ip-inline" onSubmit={save}>
        <input placeholder="Party name" value={f.party_name} onChange={(e) => setF({ ...f, party_name: e.target.value })} aria-label="Party name" required />
        <input type="number" min="0" step="any" placeholder="Limit ₹" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} aria-label="Credit limit" required />
        {lists.length > 0 && <select value={f.ratelistId} onChange={(e) => setF({ ...f, ratelistId: e.target.value })} aria-label="Their rate list"><option value="">Item rates</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name} rates</option>)}</select>}
        <button className="btn primary sm">Save</button>
      </form>
      <Table head={['Party', 'Limit', 'Owes', 'Left', 'Rate list', '']} empty="No credit limits yet. Set one per party — bills on credit warn before they cross it."
        rows={rows.map((r) => { const pct = r.limit ? Math.min(100, Math.round((100 * r.outstanding) / r.limit)) : 0; return (
          <tr key={r.id}><td><b>{r.party_name}</b><small className="sub-t">{r.open_bills} open {r.open_bills === 1 ? 'bill' : 'bills'} · {r.outstanding_from === 'tally' ? 'Tally' : 'credit bills'}</small></td>
            <td className="r">{inr(r.limit)}</td><td className="r"><span className={pct >= 100 ? 'bad-t' : pct >= 80 ? 'warn-t' : ''}>{inr(r.outstanding)}</span><i className="ip-bar"><i style={{ width: `${pct}%` }} className={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''} /></i></td>
            <td className="r">{r.available < 0 ? <b className="bad-t">−{inr(-r.available)}</b> : inr(r.available)}</td><td>{lists.find((l) => l.id === r.ratelistId)?.name || '—'}</td>
            <td className="r"><button className="btn ghost sm" onClick={() => setF({ party_name: r.party_name, limit: r.limit, ratelistId: r.ratelistId || '' })}>Edit</button><button className="icon-btn" aria-label="Remove limit" onClick={() => del(r)}><Icon name="trash" size={14} /></button></td></tr>
        ); })} />
    </Panel>
  </>);
}
