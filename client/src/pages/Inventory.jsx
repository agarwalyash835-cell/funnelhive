// Inventory (the add-on): stock kept in FunnelHive itself (server/inventory.js) — items, godowns, stock in and out,
// transfers, a CSV of opening stock, bill photos read into a draft, barcode scans. Every balance is a sum of entries,
// so any entry can be undone from an item's history. Industry tools (phase 3) render below the items.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, confirmDialog, promptDialog, inr } from '../ui';
import IndustryTools from './InventoryPro';
import { inventoryPromptsFor } from '../industryPrompts';
import '../inventory.css';

const KINDS = { PURCHASE: ['Purchase', 'in', 'Stock bought or received'], SALE: ['Sale', 'out', 'Stock sold or sent out'], RETURN_IN: ['Return in', 'in', 'A customer sent it back'], RETURN_OUT: ['Return out', 'out', 'Sent back to the supplier'], ADJUST: ['Adjustment', 'mid', 'A correction: + or − (damaged, counted, found)'], OPENING: ['Opening', 'in', 'What you had when you started'] };
const MOVE_NAME = { ...Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v[0]])), TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', PRODUCE: 'Produced', CONSUME: 'Used in production' };
const SOURCE = { MANUAL: 'by hand', PHOTO: 'bill photo', HIVE: 'Hive', WHATSAPP: 'WhatsApp', IMPORT: 'import', BOM: 'production', TALLY: 'Tally' };
const UNITS = ['pcs', 'kg', 'g', 'bag', 'box', 'carton', 'dozen', 'litre', 'ml', 'metre', 'ft', 'sq ft', 'ton', 'quintal', 'bundle', 'roll', 'pair', 'set', 'bottle', 'packet'];
const GST = [0, 0.25, 3, 5, 12, 18, 28, 40];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const qtyText = (n, unit) => `${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${unit || ''}`.trim();
const money = (v) => (v == null || v === '' ? '—' : inr(v));
const canScan = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export default function Inventory() {
  const [on, setOn] = useState(null);
  const [me, setMe] = useState(null);
  const [industry, setIndustry] = useState(null); // the CRM industry: which ready Hive prompts to show
  const [d, setD] = useState(null); // { items, godowns, summary }
  const [search, setSearch] = useState('');
  const [godownId, setGodownId] = useState('');
  const [show, setShow] = useState('all'); // all | low
  const [form, setForm] = useState(null); // { kind: 'move' | 'transfer' | 'item' | 'import' | 'photo' | 'scan', ... }
  const [open, setOpen] = useState(null); // item id in the drawer
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);
  useEffect(() => { api('/inventory').then((r) => setOn(r.on)).catch(() => setOn(false)); api('/me').then(setMe).catch(() => {}); api('/inventory/pro').then((r) => setIndustry(r.industry)).catch(() => {}); }, []);
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => api(`/inventory/items?${new URLSearchParams(Object.entries({ search, godownId }).filter(([, v]) => v))}`).then(setD).catch((e) => toast(e.message)), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [on, search, godownId, rev]);
  // the full list for forms and industry tools (the table may be filtered by a search)
  const [all, setAll] = useState([]);
  useEffect(() => { if (on) api('/inventory/items').then((r) => setAll(r.items)).catch(() => {}); }, [on, rev]);

  // a scanned / typed barcode: open that item, or offer to create one with it
  const lookup = async (code) => {
    setForm(null);
    try { const r = await api(`/inventory/barcode/${encodeURIComponent(code)}`); setOpen(r.item.id); } catch (e) {
      if (e.status !== 404) return toast(e.message);
      if (await confirmDialog({ title: 'New barcode', text: `No item has barcode ${code} yet. Create one with it?`, confirm: 'Create item' })) setForm({ kind: 'item', item: { barcode: code } });
    }
  };

  if (on === false) return <Layout title="Inventory" subtitle="Your stock, in FunnelHive"><Empty icon="box" title="Inventory isn’t switched on" text="Inventory is an add-on — items, godowns, stock in and out, low-stock alerts and bill photos. Ask us to turn it on for your account." /></Layout>;
  const s = d?.summary, rows = (d?.items || []).filter((i) => show !== 'low' || i.low), godowns = d?.godowns || [];
  const maxQty = Math.max(1, ...rows.map((i) => i.stock));
  return (
    <Layout title="Inventory" subtitle="Your stock, in FunnelHive — items, godowns, stock in and out" actions={on && <NewMenu onPick={setForm} />}>
      {!d ? <div className="skeleton" /> : <>
        <div className="tl-strip">
          {[['Stock value', money(s.value), 'at purchase rates', 'wallet', 'in'], ['Items', s.items.toLocaleString('en-IN'), `${godowns.length} ${godowns.length === 1 ? 'godown' : 'godowns'}`, 'layers'], ['Low stock', s.low.toLocaleString('en-IN'), s.low ? 'at or below reorder level' : 'nothing running low', 'bell', s.low ? 'out' : 'in'], ['Out of stock', s.out.toLocaleString('en-IN'), s.out ? 'need restocking' : 'all in stock', 'box', s.out ? 'bad' : 'in']].map(([label, value, sub, icon, tone]) => (
            <div key={label} className={`tl-stat ${tone || ''}`}><span className="tl-stat-ic"><Icon name={icon} size={14} /></span><div><small>{label}</small><b>{value}</b><em>{sub}</em></div></div>
          ))}
        </div>
        <Panel pad={false} title={`${rows.length.toLocaleString('en-IN')} ${rows.length === 1 ? 'item' : 'items'}`}
          actions={<div className="row tl-filters">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, barcode, category" aria-label="Search items" />
            {godowns.length > 1 && <select value={godownId} onChange={(e) => setGodownId(e.target.value)} aria-label="Godown"><option value="">All godowns</option>{godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
            <div className="seg" role="radiogroup" aria-label="Show">{[['all', 'All'], ['low', 'Low stock']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{l}</button>)}</div>
            <button className="btn ghost sm" onClick={() => setForm({ kind: 'scan' })} title="Scan a barcode"><Icon name="search" size={14} /> Scan</button>
          </div>}>
          {!rows.length ? (d.items.length || search ? <Empty icon="box" title={show === 'low' ? 'Nothing is running low' : 'No items found'} text={show === 'low' ? 'Items show here when stock falls to their reorder level.' : 'Try another name, SKU or barcode.'} />
            : <Empty icon="box" title="Add your first items" text="Add items one by one, import a CSV of what you have, or read a purchase bill photo.">
              <div className="row inv-start"><button className="btn primary" onClick={() => setForm({ kind: 'item' })}><Icon name="plus" size={14} /> New item</button><button className="btn ghost" onClick={() => setForm({ kind: 'import' })}><Icon name="download" size={14} /> Import CSV</button><button className="btn ghost" onClick={() => setForm({ kind: 'photo' })}><Icon name="image" size={14} /> Bill photo</button></div>
            </Empty>) : (
            <div className="tbl-wrap tl-tbl"><table className="tbl inv-tbl">
              <thead><tr><th>Item</th><th>Category</th><th className="r">In stock{godownId ? ' (this godown)' : ''}</th><th className="r">Reorder at</th><th className="r">Rates</th></tr></thead>
              <tbody>{rows.map((i) => (
                <tr key={i.id} className={`click ${i.has_variants ? '' : i.stock <= 0 ? 'inv-out' : i.low ? 'inv-low' : ''}`} onClick={() => setOpen(i.id)}>
                  <td><div className="tl-who"><span className="tl-av sm box" aria-hidden="true"><Icon name="box" size={14} /></span><div><b>{i.name}</b><small className="sub-t">{[i.sku, i.barcode, i.hsn && `HSN ${i.hsn}`].filter(Boolean).join(' · ') || i.unit}</small></div></div></td>
                  <td>{i.category ? <span className="tl-chip">{i.category}</span> : <span className="muted">—</span>}</td>
                  <td className="r"><div className="tl-level"><span className={i.stock <= 0 && !i.has_variants ? 'bad-t' : ''}>{i.has_variants ? <small className="muted">in its sizes / colours</small> : qtyText(i.stock, i.unit)} {i.has_variants ? null : i.stock <= 0 ? <span className="pill bad">Out</span> : i.low ? <span className="pill warn">Low</span> : null}</span><i className={i.stock <= 0 ? 'empty' : ''}><i style={{ width: `${Math.max(0, Math.min(100, (100 * i.stock) / maxQty))}%` }} /></i></div></td>
                  <td className="r">{i.reorder_level != null ? qtyText(i.reorder_level, i.unit) : <span className="muted">—</span>}</td>
                  <td className="r"><small className="muted">{i.sale_rate != null ? `sells ${inr(i.sale_rate)}` : ''}{i.purchase_rate != null ? `${i.sale_rate != null ? ' · ' : ''}buys ${inr(i.purchase_rate)}` : ''}</small></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
        <Godowns godowns={godowns} onChange={reload} />
        <div className="inv-ask">
          <p className="hint inv-hive"><Icon name="sparkles" size={14} /> Ask Hive — it shows each entry and waits for your Confirm:</p>
          <div className="inv-ask-chips">{inventoryPromptsFor(industry).map((p) => <Link key={p} to={`/hive?ask=${encodeURIComponent(p)}`}>{p}</Link>)}</div>
        </div>
        <IndustryTools me={me} items={all} onChange={reload} />
      </>}
      {open && <ItemDrawer id={open} rev={rev} godowns={godowns} onClose={() => setOpen(null)} onChange={reload} onForm={setForm} />}
      {form?.kind === 'move' && <MoveForm items={all} godowns={godowns} preset={form} onClose={() => setForm(null)} onDone={reload} />}
      {form?.kind === 'transfer' && <TransferForm items={all} godowns={godowns} preset={form} onClose={() => setForm(null)} onDone={reload} />}
      {form?.kind === 'item' && <ItemForm item={form.item} onClose={() => setForm(null)} onDone={(i) => { reload(); if (i && !form.item?.id) setOpen(i.id); }} />}
      {form?.kind === 'import' && <ImportForm onClose={() => setForm(null)} onDone={reload} />}
      {form?.kind === 'photo' && <PhotoForm items={all} godowns={godowns} onClose={() => setForm(null)} onDone={reload} />}
      {form?.kind === 'scan' && <Scanner title="Find an item by barcode" onCode={lookup} onClose={() => setForm(null)} />}
    </Layout>
  );
}

// the "+ New" menu
function NewMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!open) return undefined; const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const item = (form, label, icon) => <button type="button" role="menuitem" onClick={() => { setOpen(false); onPick(form); }}><Icon name={icon} size={15} /> {label}</button>;
  return (
    <div className="tl-new" ref={ref}>
      <button className="btn primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="plus" size={15} /> Stock entry</button>
      {open && <div className="tl-menu" role="menu">
        {item({ kind: 'move', move: 'PURCHASE' }, 'Stock in', 'download')}{item({ kind: 'move', move: 'SALE' }, 'Stock out', 'send')}{item({ kind: 'transfer' }, 'Transfer between godowns', 'split')}
        {item({ kind: 'photo' }, 'From a bill photo', 'image')}{item({ kind: 'item' }, 'New item', 'box')}{item({ kind: 'import' }, 'Import items (CSV)', 'list')}{item({ kind: 'scan' }, 'Scan a barcode', 'search')}
      </div>}
    </div>
  );
}

function Godowns({ godowns, onChange }) {
  const add = async () => { const name = await promptDialog({ title: 'New godown', label: 'Name', placeholder: 'e.g. Shop, Warehouse 2, Site store' }); if (!name) return; try { await api('/inventory/godowns', 'POST', { name }); toast('Godown added'); onChange(); } catch (e) { toast(e.message); } };
  const rename = async (g) => { const name = await promptDialog({ title: 'Rename godown', label: 'Name', value: g.name }); if (!name || name === g.name) return; try { await api(`/inventory/godowns/${g.id}`, 'PUT', { name }); onChange(); } catch (e) { toast(e.message); } };
  return (
    <Panel title="Godowns" actions={<button className="btn ghost sm" onClick={add}><Icon name="plus" size={14} /> Godown</button>}>
      <div className="inv-godowns">{godowns.map((g) => (
        <div key={g.id} className="inv-godown"><span className="tl-stat-ic"><Icon name="layers" size={14} /></span><div><b>{g.name}</b><small className="muted">{g.items} {g.items === 1 ? 'item' : 'items'} in stock · {money(g.value)}</small></div><button className="icon-btn" aria-label={`Rename ${g.name}`} onClick={() => rename(g)}><Icon name="edit" size={14} /></button></div>
      ))}</div>
    </Panel>
  );
}

// one item: stock per godown and every entry, newest first (each can be undone)
function ItemDrawer({ id, rev, onClose, onChange, onForm }) {
  const [d, setD] = useState(null);
  const load = () => api(`/inventory/items/${id}`).then(setD).catch((e) => { toast(e.message); onClose(); });
  useEffect(() => { load(); }, [id, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => { if (e.key === 'Escape' && !document.querySelector('.m-box')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const undo = async (m) => {
    if (!(await confirmDialog({ title: 'Undo this entry?', text: `${MOVE_NAME[m.kind]} of ${qtyText(Math.abs(m.qty), m.unit)} on ${fmtDate(m.day)}${m.pair ? ' — both halves of the transfer go' : ''}.`, confirm: 'Undo', danger: true }))) return;
    try { await api(`/inventory/moves/${m.id}`, 'DELETE'); toast('Entry undone'); onChange(); } catch (e) { toast(e.message); }
  };
  const deactivate = async () => {
    if (!(await confirmDialog({ title: `Remove ${d.item.name}?`, text: 'It leaves your item list; its history stays. Stock still counted in it is no longer shown.', confirm: 'Remove', danger: true }))) return;
    try { await api(`/inventory/items/${id}`, 'DELETE'); toast('Item removed'); onChange(); onClose(); } catch (e) { toast(e.message); }
  };
  const i = d?.item;
  return (
    <div className="inv-drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="inv-drawer" role="dialog" aria-modal="true" aria-label={i?.name || 'Item'}>
        {!d ? <div className="skeleton" /> : <>
          <div className="inv-drawer-h"><div><h3>{i.name}</h3><small className="muted">{[i.sku && `SKU ${i.sku}`, i.barcode && `Barcode ${i.barcode}`, i.category, i.hsn && `HSN ${i.hsn}`, i.gst_percent != null && `GST ${i.gst_percent}%`].filter(Boolean).join(' · ') || i.unit}</small></div><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button></div>
          <div className="inv-big"><b className={i.stock <= 0 ? 'bad-t' : ''}>{qtyText(i.stock, i.unit)}</b>{i.stock <= 0 ? <span className="pill bad">Out of stock</span> : i.low ? <span className="pill warn">Low — reorder at {qtyText(i.reorder_level, i.unit)}</span> : <span className="pill ok">In stock</span>}</div>
          <div className="row inv-acts">
            <button className="btn primary sm" onClick={() => onForm({ kind: 'move', move: 'PURCHASE', itemId: id })}><Icon name="download" size={14} /> Stock in</button>
            <button className="btn ghost sm" onClick={() => onForm({ kind: 'move', move: 'SALE', itemId: id })}><Icon name="send" size={14} /> Stock out</button>
            {d.byGodown.length > 1 && <button className="btn ghost sm" onClick={() => onForm({ kind: 'transfer', itemId: id })}><Icon name="split" size={14} /> Transfer</button>}
            <button className="btn ghost sm" onClick={() => onForm({ kind: 'item', item: i })}><Icon name="edit" size={14} /> Edit</button>
            <button className="btn ghost sm" onClick={deactivate}><Icon name="trash" size={14} /> Remove</button>
          </div>
          <dl className="inv-facts"><dt>Sale rate</dt><dd>{money(i.sale_rate)}</dd><dt>Purchase rate</dt><dd>{money(i.purchase_rate)}</dd><dt>Stock value</dt><dd>{i.purchase_rate != null ? inr(Math.max(0, i.stock) * i.purchase_rate) : '—'}</dd></dl>
          <h4>By godown</h4>
          <ul className="tl-rank">{d.byGodown.map((g) => <li key={g.id}><span>{g.name}</span><b className={g.qty < 0 ? 'bad-t' : ''}>{qtyText(g.qty, i.unit)}</b></li>)}</ul>
          <h4>History</h4>
          {!d.moves.length ? <p className="muted sm">No entries yet — record a purchase or the opening stock.</p> : <ol className="tl-tline">{d.moves.map((m) => (
            <li key={m.id} className={m.qty > 0 ? 'ok' : 'warn'}>
              <div className="tl-tline-h"><b>{MOVE_NAME[m.kind] || m.kind} <span className={m.qty > 0 ? 'inv-in-t' : 'inv-out-t'}>{m.qty > 0 ? '+' : '−'}{qtyText(Math.abs(m.qty), m.unit)}</span></b><button className="btn ghost sm" onClick={() => undo(m)} title="Undo this entry"><Icon name="undo" size={12} /> Undo</button></div>
              <small className="muted">{fmtDate(m.day)} · {m.godown_name}{m.party_name ? ` · ${m.party_name}` : ''}{m.rate != null ? ` · @ ${inr(m.rate)}` : ''}{m.ref ? ` · ${m.ref}` : ''} · {SOURCE[m.source] || m.source}</small>
              {m.note && <small>{m.note}</small>}
            </li>
          ))}</ol>}
        </>}
      </aside>
    </div>
  );
}

function FormModal({ title, onClose, busy, onSubmit, children, submit = 'Save', width = 640 }) {
  return (
    <Modal title={title} onClose={onClose} width={width}>
      <form className="m-body tl-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        {children}
        <div className="m-foot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submit}</button></div>
      </form>
    </Modal>
  );
}
const ItemPick = ({ items, value, onChange, required = true }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} required={required} aria-label="Item"><option value="">Pick an item…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} — {qtyText(i.stock, i.unit)}</option>)}</select>
);
const GodownPick = ({ godowns, value, onChange, label = 'Godown' }) => (
  <label>{label}<select value={value} onChange={(e) => onChange(e.target.value)}>{godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
);

// stock in / out for one item
function MoveForm({ items, godowns, preset, onClose, onDone }) {
  const [v, setV] = useState({ kind: preset.move || 'PURCHASE', itemId: preset.itemId || '', qty: '', rate: '', godownId: godowns[0]?.id || '', party_name: '', day: today(), ref: '', note: '', batch: '', expiry: '', minus: false });
  const [busy, setBusy] = useState(false);
  const set = (p) => setV({ ...v, ...p });
  const item = items.find((i) => i.id === v.itemId);
  useEffect(() => { if (item && v.rate === '') set({ rate: (['SALE', 'RETURN_IN'].includes(v.kind) ? item.sale_rate : item.purchase_rate) ?? '' }); }, [v.itemId, v.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (force = false) => {
    setBusy(true);
    try {
      await api('/inventory/moves', 'POST', { ...v, qty: v.kind === 'ADJUST' && v.minus ? -Math.abs(Number(v.qty)) : Number(v.qty), force });
      toast(`${KINDS[v.kind][0]} saved`); onDone(); onClose();
    } catch (e) {
      // the books show less than is going out: the seller may know better (it already left the shop)
      if (e.status === 409 && ['SALE', 'RETURN_OUT'].includes(v.kind) && !force && await confirmDialog({ title: 'Not enough in stock', text: `${e.message}. Record it anyway? Stock will show below zero until you add the purchase.`, confirm: 'Record anyway' })) { setBusy(false); return save(true); }
      toast(e.message);
    }
    setBusy(false);
  };
  const party = { PURCHASE: 'Supplier', SALE: 'Customer', RETURN_IN: 'Customer', RETURN_OUT: 'Supplier' }[v.kind];
  return (
    <FormModal title={v.kind === 'ADJUST' ? 'Stock adjustment' : KINDS[v.kind][1] === 'in' ? 'Stock in' : 'Stock out'} onClose={onClose} busy={busy} onSubmit={() => save()}>
      <div className="seg inv-kinds" role="radiogroup" aria-label="What happened">{Object.entries(KINDS).map(([k, [l]]) => <button key={k} type="button" role="radio" aria-checked={v.kind === k} className={v.kind === k ? 'on' : ''} onClick={() => set({ kind: k, rate: '' })}>{l}</button>)}</div>
      <small className="muted">{KINDS[v.kind][2]}</small>
      <div className="form2">
        <label className="full">Item<ItemPick items={items} value={v.itemId} onChange={(itemId) => set({ itemId, rate: '' })} /></label>
        <label>Quantity{item ? ` (${item.unit})` : ''}<input type="number" min="0" step="any" value={v.qty} onChange={(e) => set({ qty: e.target.value })} required /></label>
        {v.kind === 'ADJUST' ? <label className="tog"><input type="checkbox" checked={v.minus} onChange={(e) => set({ minus: e.target.checked })} /><span />Reduce stock <small className="muted">· damaged, lost, counted less</small></label>
          : <label>Rate (₹) <small className="muted">· optional</small><input type="number" min="0" step="any" value={v.rate} onChange={(e) => set({ rate: e.target.value })} /></label>}
        {godowns.length > 1 && <GodownPick godowns={godowns} value={v.godownId} onChange={(godownId) => set({ godownId })} />}
        <label>Date<input type="date" value={v.day} onChange={(e) => set({ day: e.target.value })} required /></label>
        {['PURCHASE', 'OPENING', 'RETURN_IN'].includes(v.kind) && <><label>Batch <small className="muted">· optional</small><input value={v.batch} onChange={(e) => set({ batch: e.target.value })} placeholder="e.g. PCM24A" /></label><label>Expiry <small className="muted">· optional</small><input type="date" value={v.expiry} onChange={(e) => set({ expiry: e.target.value })} /></label></>}
        {party && <label>{party} <small className="muted">· optional</small><input value={v.party_name} onChange={(e) => set({ party_name: e.target.value })} /></label>}
        {party && <label>Bill number <small className="muted">· optional</small><input value={v.ref} onChange={(e) => set({ ref: e.target.value })} /></label>}
        <label className="full">Note <small className="muted">· optional</small><input value={v.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div>
      {item && v.qty && v.rate !== '' && v.kind !== 'ADJUST' && <p className="tl-gst">{qtyText(v.qty, item.unit)} × {inr(v.rate)} = <b>{inr(Number(v.qty) * Number(v.rate))}</b></p>}
    </FormModal>
  );
}

function TransferForm({ items, godowns, preset, onClose, onDone }) {
  const [v, setV] = useState({ itemId: preset.itemId || '', qty: '', from: godowns[0]?.id || '', to: godowns[1]?.id || '', day: today(), note: '' });
  const [busy, setBusy] = useState(false);
  const set = (p) => setV({ ...v, ...p });
  const save = async () => { setBusy(true); try { await api('/inventory/transfer', 'POST', { ...v, qty: Number(v.qty) }); toast('Stock moved'); onDone(); onClose(); } catch (e) { toast(e.message); } setBusy(false); };
  if (godowns.length < 2) return <Modal title="Transfer stock" onClose={onClose}><div className="m-body"><Empty icon="split" title="Add a second godown first" text="Transfers move stock between two godowns — add one under Godowns." /></div></Modal>;
  return (
    <FormModal title="Transfer between godowns" onClose={onClose} busy={busy} onSubmit={save} submit="Move stock">
      <div className="form2">
        <label className="full">Item<ItemPick items={items} value={v.itemId} onChange={(itemId) => set({ itemId })} /></label>
        <GodownPick label="From" godowns={godowns} value={v.from} onChange={(from) => set({ from })} />
        <GodownPick label="To" godowns={godowns} value={v.to} onChange={(to) => set({ to })} />
        <label>Quantity<input type="number" min="0" step="any" value={v.qty} onChange={(e) => set({ qty: e.target.value })} required /></label>
        <label>Date<input type="date" value={v.day} onChange={(e) => set({ day: e.target.value })} /></label>
        <label className="full">Note <small className="muted">· optional</small><input value={v.note} onChange={(e) => set({ note: e.target.value })} /></label>
      </div>
    </FormModal>
  );
}

function ItemForm({ item = {}, onClose, onDone }) {
  const editing = !!item.id;
  const [v, setV] = useState({ name: '', unit: 'pcs', sku: '', barcode: '', category: '', hsn: '', gst_percent: '', sale_rate: '', purchase_rate: '', reorder_level: '', ...Object.fromEntries(Object.entries(item).map(([k, x]) => [k, x ?? ''])) });
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const set = (p) => setV({ ...v, ...p });
  const save = async () => {
    setBusy(true);
    const body = Object.fromEntries(['name', 'unit', 'sku', 'barcode', 'category', 'hsn', 'gst_percent', 'sale_rate', 'purchase_rate', 'reorder_level'].map((k) => [k, v[k]]));
    try { const i = editing ? await api(`/inventory/items/${item.id}`, 'PUT', body) : await api('/inventory/items', 'POST', body); toast(editing ? 'Item saved' : 'Item added — record its opening stock from Stock in'); onDone(i); onClose(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <FormModal title={editing ? `Edit ${item.name}` : 'New item'} onClose={onClose} busy={busy} onSubmit={save}>
      <datalist id="inv-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <div className="form2">
        <label className="full">Name<input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Cement OPC 53 grade" required autoFocus /></label>
        <label>Unit<input list="inv-units" value={v.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="pcs, kg, bag…" /></label>
        <label>Category <small className="muted">· optional</small><input value={v.category} onChange={(e) => set({ category: e.target.value })} /></label>
        <label>SKU / item code <small className="muted">· optional</small><input value={v.sku} onChange={(e) => set({ sku: e.target.value })} /></label>
        <label>Barcode <small className="muted">· optional</small><div className="inv-with-btn"><input value={v.barcode} onChange={(e) => set({ barcode: e.target.value })} inputMode="numeric" /><button type="button" className="btn ghost sm" onClick={() => setScan(true)} title="Scan with the camera"><Icon name="search" size={14} /> Scan</button></div></label>
        <label>Sale rate (₹)<input type="number" min="0" step="any" value={v.sale_rate} onChange={(e) => set({ sale_rate: e.target.value })} /></label>
        <label>Purchase rate (₹)<input type="number" min="0" step="any" value={v.purchase_rate} onChange={(e) => set({ purchase_rate: e.target.value })} /></label>
        <label>HSN code <small className="muted">· optional</small><input value={v.hsn} onChange={(e) => set({ hsn: e.target.value })} inputMode="numeric" /></label>
        <label>GST<select value={v.gst_percent} onChange={(e) => set({ gst_percent: e.target.value })}><option value="">Not set</option>{GST.map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>
        <label className="full">Reorder level <small className="muted">· flagged low at or below this quantity</small><input type="number" min="0" step="any" value={v.reorder_level} onChange={(e) => set({ reorder_level: e.target.value })} /></label>
      </div>
      {scan && <Scanner title="Scan the item’s barcode" onCode={(code) => { set({ barcode: code }); setScan(false); }} onClose={() => setScan(false)} />}
    </FormModal>
  );
}

// a phone-camera barcode scanner (the browser's BarcodeDetector, where there is one), with typing as the fallback
function Scanner({ title, onCode, onClose }) {
  const video = useRef(null);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState(canScan() ? 'starting' : 'none'); // starting | live | none | denied
  useEffect(() => {
    if (!canScan()) return undefined;
    let stream, timer, done = false;
    (async () => {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.().catch(() => null);
        const det = new window.BarcodeDetector(formats?.length ? { formats } : undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (done) return;
        video.current.srcObject = stream;
        await video.current.play();
        setState('live');
        const tick = async () => {
          if (done) return;
          try { const [b] = await det.detect(video.current); if (b?.rawValue) { done = true; navigator.vibrate?.(60); onCode(b.rawValue.trim()); return; } } catch { /* frame not ready */ }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch { setState('denied'); }
    })();
    return () => { done = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={title} onClose={onClose} width={460}>
      <form className="m-body tl-form" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) onCode(typed.trim()); }}>
        {canScan() && state !== 'denied' && <div className="inv-cam"><video ref={video} playsInline muted /><i aria-hidden="true" />{state === 'starting' && <small>Starting the camera…</small>}</div>}
        <small className="muted">{state === 'none' ? 'This browser can’t read barcodes from the camera — type the number under the barcode instead (or use Chrome on Android).' : state === 'denied' ? 'The camera isn’t available — allow it in your browser, or type the number under the barcode.' : 'Hold the barcode inside the frame. Or type its number:'}</small>
        <div className="inv-with-btn"><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Barcode number" inputMode="numeric" aria-label="Barcode number" autoFocus={!canScan()} /><button className="btn primary sm" disabled={!typed.trim()}>Use</button></div>
      </form>
    </Modal>
  );
}

// a CSV of items with opening stock (Excel: File → Save as → CSV)
const SAMPLE = 'Name,Unit,SKU,Barcode,Category,HSN,GST %,Sale Rate,Purchase Rate,Reorder Level,Opening Stock,Godown\nCement OPC 53,bag,CEM-53,,Cement,2523,28,420,380,50,200,Main\n"Paint, White 20L",bucket,PNT-20,,Paint,3209,18,2450,2100,5,12,\n';
function ImportForm({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const sample = useMemo(() => URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv' })), []);
  useEffect(() => () => URL.revokeObjectURL(sample), [sample]);
  const go = async () => {
    if (!file) return toast('Pick a CSV file');
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return toast('Save the sheet as CSV first (File → Save as → CSV) — Excel files can’t be read here yet');
    if (file.size > 3_000_000) return toast('That file is too large — up to 5,000 items at a time');
    setBusy(true);
    try { const r = await api('/inventory/import', 'POST', { csv: await file.text() }); setRes(r); onDone(); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <FormModal title="Import items" onClose={onClose} busy={busy} onSubmit={res ? onClose : go} submit={res ? 'Done' : 'Import'}>
      {!res ? <>
        <p className="muted sm">A CSV with one item per row. Only <b>Name</b> is needed; Unit, SKU, Barcode, Category, HSN, GST %, Sale Rate, Purchase Rate, Reorder Level, Opening Stock and Godown are read when present. Items you already have are updated by SKU or name; opening stock is only added to an item with no entries yet. From Excel or Google Sheets: save or download as <b>CSV</b>.</p>
        <a className="btn ghost sm" href={sample} download="items-sample.csv"><Icon name="download" size={14} /> Sample CSV</a>
        <label className="inv-file"><input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />{file ? file.name : 'Choose a CSV file'}</label>
      </> : <>
        <div className="tl-strip">{[['New items', res.created, 'box'], ['Updated', res.updated, 'edit'], ['Opening stock', res.opening, 'download']].map(([l, n, ic]) => <div key={l} className="tl-stat in"><span className="tl-stat-ic"><Icon name={ic} size={14} /></span><div><small>{l}</small><b>{n}</b></div></div>)}</div>
        {res.skipped.length > 0 && <><h4>Not imported ({res.skipped.length})</h4><ul className="tl-rank inv-skips">{res.skipped.slice(0, 50).map((s) => <li key={s.line}><span>Row {s.line}{s.name ? ` · ${s.name}` : ''}</span><small className="bad-t">{s.error}</small></li>)}</ul></>}
      </>}
    </FormModal>
  );
}

// a bill photo, made small enough to send (longest side 1,600 px, JPEG — the same as the Tally bill reader)
const photoData = (file) => new Promise((resolve, reject) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/jpeg', 0.82));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo we can read')); };
  img.src = url;
});

// a bill photo → stock entries the seller checks first: every line is mapped to an item, a new item, or dropped
function PhotoForm({ items, godowns, onClose, onDone }) {
  const [kind, setKind] = useState('PURCHASE');
  const [draft, setDraft] = useState(null); // { reading } | the draft from the server
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const read = async (file) => {
    if (!file) return;
    setDraft({ reading: true });
    try {
      const d = await api('/inventory/photo', 'POST', { image: await photoData(file), kind });
      setDraft({ ...d, day: d.day || today(), godownId: godowns[0]?.id || '', lines: d.lines.map((l) => ({ ...l, pick: l.itemId || '', keep: true, newName: l.description, newUnit: l.unit || 'pcs' })) });
    } catch (e) { toast(e.message); setDraft(null); }
  };
  const set = (p) => setDraft({ ...draft, ...p });
  const setLine = (k, p) => set({ lines: draft.lines.map((l, j) => (j === k ? { ...l, ...p } : l)) });
  const kept = draft?.lines?.filter((l) => l.keep) || [];
  const open = kept.filter((l) => !l.pick || !(Number(l.qty) > 0));
  const save = async () => {
    if (!kept.length) return toast('Keep at least one line');
    if (open.length) return toast('Pick an item (or “New item”) and a quantity for every line you keep');
    setBusy(true);
    try {
      const lines = kept.map((l) => ({ qty: Number(l.qty), rate: l.rate === '' || l.rate == null ? undefined : Number(l.rate), ...(l.pick === 'new' ? { newItem: { name: l.newName, unit: l.newUnit, hsn: l.hsn || undefined, gst_percent: l.gst_percent ?? undefined } } : { itemId: l.pick }) }));
      const r = await api('/inventory/moves/batch', 'POST', { kind: draft.kind, lines, party_name: draft.party_name, ref: draft.ref, day: draft.day, godownId: draft.godownId, source: 'PHOTO' });
      toast(`${r.moves.length} ${r.moves.length === 1 ? 'entry' : 'entries'} saved from the bill`); onDone(); onClose();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <FormModal title="Stock from a bill photo" onClose={onClose} busy={busy} onSubmit={draft?.lines ? save : () => fileRef.current?.click()} submit={draft?.lines ? `Save ${kept.length} ${kept.length === 1 ? 'entry' : 'entries'}` : 'Choose a photo'} width={760}>
      <div className="seg" role="radiogroup" aria-label="Bill type">{[['PURCHASE', 'Purchase bill (stock in)'], ['SALE', 'Sales bill (stock out)']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} disabled={!!draft} onClick={() => setKind(k)}>{l}</button>)}</div>
      <div className="tl-read">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => read(e.target.files?.[0])} />
        <button type="button" className="btn ghost sm" disabled={draft?.reading} onClick={() => fileRef.current?.click()}><Icon name="image" size={14} /> {draft?.reading ? 'Reading the bill…' : draft ? 'Read another photo' : 'Take or choose a photo'}</button>
        <small className="muted">{draft?.lines ? 'Read from the photo — check every line before saving. Nothing is saved until you do.' : 'Straight on, in good light, with the whole bill in view. Uses 1 AI credit.'}</small>
        {draft?.duplicate && <small className="bad-t">This bill looks saved already ({MOVE_NAME[draft.duplicate.kind]} on {fmtDate(draft.duplicate.day)}).</small>}
      </div>
      {draft?.lines && <>
        <div className="form2">
          <label>{kind === 'SALE' ? 'Customer' : 'Supplier'}<input value={draft.party_name || ''} onChange={(e) => set({ party_name: e.target.value })} /></label>
          <label>Bill number<input value={draft.ref || ''} onChange={(e) => set({ ref: e.target.value })} /></label>
          <label>Date<input type="date" value={draft.day} onChange={(e) => set({ day: e.target.value })} /></label>
          {godowns.length > 1 && <GodownPick godowns={godowns} value={draft.godownId} onChange={(godownId) => set({ godownId })} />}
        </div>
        {!draft.lines.length ? <p className="bad-t">No item lines could be read from this bill.</p> : <div className="tl-items inv-lines">
          {draft.lines.map((l, k) => (
            <div key={k} className={`inv-line ${l.keep ? '' : 'off'}`}>
              <div className="inv-line-h"><b>{l.description}</b>{l.keep && !l.pick ? <span className="pill warn">Not in your items</span> : l.keep && l.pick !== 'new' && !l.exact && l.itemId === l.pick ? <span className="pill info">Matched — check</span> : null}<label className="tog sm"><input type="checkbox" checked={l.keep} onChange={(e) => setLine(k, { keep: e.target.checked })} /><span />Keep</label></div>
              {l.keep && <div className="inv-line-f">
                <select value={l.pick} onChange={(e) => setLine(k, { pick: e.target.value })} className={!l.pick ? 'tl-unmatched' : ''} aria-label="Item">
                  <option value="">Pick an item…</option>
                  {l.suggestions?.length > 0 && <optgroup label="Close matches">{l.suggestions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
                  <optgroup label="All items">{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>
                  <option value="new">+ New item…</option>
                </select>
                <input type="number" min="0" step="any" value={l.qty ?? ''} onChange={(e) => setLine(k, { qty: e.target.value })} placeholder="Qty" aria-label="Quantity" />
                <input type="number" min="0" step="any" value={l.rate ?? ''} onChange={(e) => setLine(k, { rate: e.target.value })} placeholder="Rate ₹" aria-label="Rate" />
              </div>}
              {l.keep && l.pick === 'new' && <div className="inv-line-f new"><input value={l.newName} onChange={(e) => setLine(k, { newName: e.target.value })} placeholder="New item name" aria-label="New item name" /><input value={l.newUnit} onChange={(e) => setLine(k, { newUnit: e.target.value })} placeholder="Unit" aria-label="Unit" list="inv-units-photo" /></div>}
            </div>
          ))}
          <datalist id="inv-units-photo">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>}
        {draft.grand_total && <small className="muted">Bill total (with tax): {inr(draft.grand_total)}</small>}
      </>}
    </FormModal>
  );
}
