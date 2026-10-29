// Tally: the seller's TallyPrime, mirrored here by the FunnelHive Tally Connector on their Windows PC (server/tally.js).
// Reads come from the mirror; every change is queued for the PC, which runs it in TallyPrime and reports back — the
// screen waits for that answer, so what it shows is what Tally accepted.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, confirmDialog, inr, ago } from '../ui';

const TABS = [['overview', 'Overview'], ['ledgers', 'Ledgers'], ['vouchers', 'Vouchers'], ['outstandings', 'Bills'], ['stock', 'Stock'], ['activity', 'Activity']];
const VSTATUS = { POSTED: ['Posted', 'ok'], DUE: ['Overdue', 'bad'], CANCELLED: ['Cancelled', ''], OPTIONAL: ['Optional', 'info'] };
const BSTATUS = { PENDING: ['Pending', 'info'], PARTIAL: ['Part paid', 'warn'], OVERDUE: ['Overdue', 'bad'], PAID: ['Paid', 'ok'], CANCELLED: ['Cancelled', ''] };
const CSTATUS = { PENDING: ['Waiting for your PC', 'info'], SENT: ['Running in Tally', 'info'], SUCCESS: ['Done', 'ok'], FAILED: ['Tally refused', 'bad'], EXPIRED: ['Not picked up', 'warn'] };
const CNAME = { CREATE_LEDGER: 'New ledger', ALTER_LEDGER: 'Edit ledger', DELETE_LEDGER: 'Delete ledger', CREATE_VOUCHER: 'New voucher', CREATE_RECEIPT: 'New receipt', CREATE_PAYMENT: 'New payment', ALTER_VOUCHER: 'Edit voucher', CANCEL_VOUCHER: 'Cancel voucher', DELETE_VOUCHER: 'Delete voucher', CREATE_STOCK_ITEM: 'New stock item', ALTER_STOCK_ITEM: 'Edit stock item', DELETE_STOCK_ITEM: 'Delete stock item', CREATE_STOCK_JOURNAL: 'Stock transfer', CREATE_UNIT: 'New unit', CREATE_GODOWN: 'New godown', SYNC_FULL: 'Full sync', SYNC_VOUCHERS: 'Sync vouchers', SYNC_LEDGERS: 'Sync ledgers' };
const money = (v) => (v == null ? '—' : inr(Math.abs(Number(v))));
// Tally keeps balances signed: Dr is negative in its export
const drcr = (v) => (v == null || Number(v) === 0 ? '—' : `${inr(Math.abs(Number(v)))} ${Number(v) < 0 ? 'Dr' : 'Cr'}`);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

// queue a change for the PC and wait (up to ~3 minutes) for TallyPrime's answer
async function runInTally(type, payload, label) {
  let c;
  try { c = await api('/tally/commands', 'POST', { type, payload }); } catch (e) { toast(e.message); return null; }
  toast(`${label || CNAME[type] || 'Change'} sent to TallyPrime — waiting for your PC…`);
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try { c = await api(`/tally/commands/${c.id}`); } catch { continue; }
    if (c.status === 'SUCCESS') { toast(`${label || CNAME[type] || 'Change'} saved in Tally`); return c; }
    if (['FAILED', 'EXPIRED'].includes(c.status)) { toast(c.error_message || 'Tally didn’t accept the change'); return null; }
  }
  toast('Your PC hasn’t answered yet — check the Activity tab in a minute');
  return null;
}

export default function Tally() {
  const [s, setS] = useState(null);
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'overview');
  const [form, setForm] = useState(null); // 'voucher' | 'ledger' | 'stock' | 'transfer' | { kind, row }
  const [connect, setConnect] = useState(false);
  const [rev, setRev] = useState(0); // bump to reload the lists after a change
  const load = () => api('/tally').then(setS).catch((e) => setS({ error: e.message }));
  useEffect(() => { load(); }, []);
  // the PC's status every 15 s while the page is open
  useEffect(() => { if (!s?.on) return undefined; const t = setInterval(load, 15000); return () => clearInterval(t); }, [s?.on]);
  const go = (t) => { setTab(t); history.replaceState(null, '', `?tab=${t}`); };
  const changed = () => { setRev((r) => r + 1); load(); };
  if (!s) return <Layout title="Tally"><div className="skeleton" /></Layout>;
  if (s.error) return <Layout title="Tally"><p className="err">{s.error}</p></Layout>;
  if (!s.on) {
    return (
      <Layout title="Tally" subtitle="Your TallyPrime books, inside FunnelHive">
        <Empty icon="wallet" title="Tally isn’t on for your account" text="See ledgers, vouchers, money owed to you and stock from TallyPrime here — and create vouchers and ledgers without opening Tally. It’s an add-on for manufacturers, retailers and traders: write to us and we’ll switch it on." />
      </Layout>
    );
  }
  const agent = s.agents?.find((a) => a.status === 'ONLINE') || s.agents?.[0];
  const online = agent?.status === 'ONLINE' && agent?.tally_status === 'ONLINE';
  const company = s.companies?.find((c) => c.id === s.companyId);
  const pick = async (id) => { try { await api(`/tally/companies/${id}/select`, 'POST'); changed(); } catch (e) { toast(e.message); } };
  const syncNow = async () => { try { await api('/tally/sync', 'POST', { type: 'SYNC_FULL' }); toast('Sync asked — your PC sends the latest from Tally in a few seconds'); setTimeout(changed, 8000); } catch (e) { toast(e.message); } };
  if (!s.agents?.length) return <Layout title="Tally" subtitle="Connect TallyPrime on your PC to FunnelHive"><ConnectPC s={s} onDone={load} /></Layout>;
  return (
    <Layout title="Tally" subtitle={company ? `${company.name}${company.last_synced_at ? ` · synced ${ago(company.last_synced_at)}` : ''}` : 'Waiting for your company to sync'}
      actions={<div className="row">
        {s.companies?.length > 1 && <select value={s.companyId || ''} onChange={(e) => pick(e.target.value)} aria-label="Company">{s.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <button className="btn ghost" onClick={syncNow} disabled={!online} title={online ? 'Fetch the latest from Tally now' : 'Your PC is offline'}><Icon name="refund" size={14} /> Sync now</button>
        <NewMenu onPick={setForm} disabled={!online} />
      </div>}>
      <PcBar agent={agent} online={online} onConnect={() => setConnect(true)} />
      <div className="seg tl-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{l}</button>)}</div>
      {!company ? <Empty icon="refund" title="Waiting for your first sync" text="Keep TallyPrime open with your company loaded. The connector sends your ledgers, vouchers and stock within a minute." /> : (
        <>
          {tab === 'overview' && <Overview rev={rev} onOpen={(kind, row) => setForm({ kind, row })} go={go} />}
          {tab === 'ledgers' && <List kind="ledgers" rev={rev} onOpen={(row) => setForm({ kind: 'ledgers', row })} />}
          {tab === 'vouchers' && <List kind="vouchers" rev={rev} onOpen={(row) => setForm({ kind: 'vouchers', row })} voucherTypes={s.voucherTypes} />}
          {tab === 'outstandings' && <List kind="outstandings" rev={rev} onOpen={(row) => row.voucherId && setForm({ kind: 'vouchers', row: { id: row.voucherId } })} />}
          {tab === 'stock' && <List kind="stock" rev={rev} onOpen={(row) => setForm({ kind: 'stock', row })} />}
          {tab === 'activity' && <Activity rev={rev} />}
        </>
      )}
      {connect && <Modal title="Connect another PC" onClose={() => setConnect(false)} width={560}><div className="m-body"><ConnectPC s={s} onDone={() => { setConnect(false); load(); }} compact /></div></Modal>}
      {form === 'voucher' && <VoucherForm s={s} onClose={() => setForm(null)} onDone={changed} />}
      {form === 'ledger' && <LedgerForm s={s} onClose={() => setForm(null)} onDone={changed} />}
      {form === 'stock' && <StockItemForm onClose={() => setForm(null)} onDone={changed} />}
      {form === 'transfer' && <TransferForm onClose={() => setForm(null)} onDone={changed} />}
      {form?.kind && <Detail kind={form.kind} id={form.row.id} online={online} onClose={() => setForm(null)} onDone={changed} onOpen={(kind, row) => setForm({ kind, row })} />}
    </Layout>
  );
}

function NewMenu({ onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('click', h); return () => document.removeEventListener('click', h); }, []);
  const item = (k, l, ic) => <button key={k} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(k); }}><Icon name={ic} size={14} /> {l}</button>;
  return (
    <div className="tl-new" ref={ref}>
      <button className="btn primary" disabled={disabled} title={disabled ? 'Your PC is offline — open TallyPrime and the connector' : undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="plus" size={14} /> New</button>
      {open && <div className="tl-menu" role="menu">{item('voucher', 'Voucher', 'receipt')}{item('ledger', 'Ledger', 'users')}{item('stock', 'Stock item', 'box')}{item('transfer', 'Stock transfer', 'split')}</div>}
    </div>
  );
}

// the connected PC: online, Tally open, last sync
function PcBar({ agent, online, onConnect }) {
  if (!agent) return null;
  const why = agent.status !== 'ONLINE' ? 'The connector on your PC isn’t running' : agent.tally_status === 'COMPANY_NOT_LOADED' ? 'TallyPrime is open but no company is loaded' : agent.tally_status !== 'ONLINE' ? 'The connector can’t reach TallyPrime (is it open, with port 9000 on?)' : '';
  return (
    <div className={`tl-pc ${online ? 'on' : ''}`}>
      <span className="tl-dot" aria-hidden="true" />
      <div><b>{online ? `Connected · ${agent.machine_name}` : `${agent.machine_name} — offline`}</b><small className="muted">{online ? `${agent.active_company_name || 'TallyPrime'} open${agent.last_sync_at ? ` · last sync ${ago(agent.last_sync_at)}` : ''}` : `${why}. Changes wait until it’s back.`}{agent.last_sync_error ? ` · last sync problem: ${agent.last_sync_error}` : ''}</small></div>
      <button className="btn ghost sm" onClick={onConnect}>Connect another PC</button>
    </div>
  );
}

// first-time setup: download the connector, open TallyPrime, paste the one-time code
function ConnectPC({ s, onDone, compact }) {
  const [code, setCode] = useState(null);
  const get = async () => { try { setCode(await api('/tally/connect-code', 'POST')); } catch (e) { toast(e.message); } };
  // the connector is connected once a PC appears
  useEffect(() => { if (!code) return undefined; const t = setInterval(async () => { const x = await api('/tally').catch(() => null); if (x?.agents?.length > (s.agents?.length || 0)) { toast('Your PC is connected'); onDone(); } }, 4000); return () => clearInterval(t); }, [code]);
  const copy = () => navigator.clipboard?.writeText(code.code).then(() => toast('Code copied'), () => {});
  const steps = (
    <ol className="tl-steps">
      <li><b>Install the connector on the PC with TallyPrime</b>{s.download ? <a className="btn ghost sm" href={s.download}><Icon name="download" size={14} /> Download for Windows</a> : <small className="muted">The installer isn’t published yet — ask us for it.</small>}<small className="muted">Windows 10 or 11 (64-bit). If Windows says “protected your PC”: More info → Run anyway.</small></li>
      <li><b>Open TallyPrime with your company</b><small className="muted">In TallyPrime: F1 Help → Settings → Connectivity → set “TallyPrime acts as” to Both, port 9000.</small></li>
      <li><b>Paste this code into the connector</b>{code ? <div className="row"><code className="tl-code">{code.code}</code><button className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> Copy</button></div> : <button className="btn primary sm" onClick={get}>Get a connect code</button>}<small className="muted">{code ? `It works once, until ${new Date(code.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. This page updates when your PC connects.` : 'The code links that PC to this FunnelHive account.'}</small></li>
    </ol>
  );
  return compact ? steps : <Panel title="Connect TallyPrime"><p className="muted sm">Your books stay on your PC. A small connector keeps them in sync with FunnelHive and saves the vouchers and ledgers you create here straight into TallyPrime.</p>{steps}</Panel>;
}

function Overview({ rev, onOpen, go }) {
  const [d, setD] = useState(null);
  useEffect(() => { api('/tally/summary').then(setD).catch((e) => toast(e.message)); }, [rev]);
  if (!d) return <div className="skeleton" />;
  if (!d.company) return null;
  const m = (t) => d.month?.[t] || { count: 0, amount: 0 };
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const kpi = (l, v, f, onClick) => <button type="button" className="kpi tl-kpi" key={l} onClick={onClick}><span className="kpi-l">{l}</span><b className="kpi-v">{v}</b>{f && <div className="kpi-f"><small>{f}</small></div>}</button>;
  return (
    <>
      <div className="kpis tl-kpis">
        {kpi('To receive', money(d.receivable.total), d.receivable.overdue ? `${money(d.receivable.overdue)} overdue · ${n(d.receivable.overdueBills, 'bill', 'bills')}` : n(d.receivable.bills, 'open bill', 'open bills'), () => go('outstandings'))}
        {kpi('To pay', money(d.payable.total), d.payable.overdue ? `${money(d.payable.overdue)} overdue` : n(d.payable.bills, 'open bill', 'open bills'), () => go('outstandings'))}
        {kpi('Sales this month', money(m('Sales').amount), n(m('Sales').count, 'voucher', 'vouchers'), () => go('vouchers'))}
        {kpi('Purchases this month', money(m('Purchase').amount), n(m('Purchase').count, 'voucher', 'vouchers'), () => go('vouchers'))}
        {kpi('Received this month', money(m('Receipt').amount), `${money(m('Payment').amount)} paid out`, () => go('vouchers'))}
        {kpi('Stock value', money(d.stock.value), d.stock.low ? `${n(d.stock.low, 'item', 'items')} out of stock` : n(d.stock.items, 'item', 'items'), () => go('stock'))}
      </div>
      <div className="tl-two">
        <Panel title="Who owes you most">
          {!d.topDebtors.length ? <p className="muted sm">Nobody owes you anything right now.</p> : <ul className="tl-rank">{d.topDebtors.map((x) => <li key={x.name}><span>{x.name}</span><b>{inr(x.amount)}</b></li>)}</ul>}
        </Panel>
        <Panel title="Latest vouchers" pad={false}>
          <VoucherTable rows={d.recent} onOpen={(row) => onOpen('vouchers', row)} compact />
        </Panel>
      </div>
    </>
  );
}

function VoucherTable({ rows, onOpen, compact }) {
  if (!rows?.length) return <p className="muted sm pad">No vouchers yet.</p>;
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Date</th><th>Type</th>{!compact && <th>No.</th>}<th>Party</th><th className="r">Amount</th><th>Status</th></tr></thead>
      <tbody>{rows.map((v) => (
        <tr key={v.id} className="click" onClick={() => onOpen(v)}>
          <td className="nowrap">{v.voucher_date ? fmtDate(v.voucher_date) : '—'}</td><td>{v.voucher_type}{v.source && v.source !== 'TALLY' && <small className="sub-t">from FunnelHive</small>}</td>{!compact && <td className="mono">{v.voucher_number || '—'}</td>}
          <td>{v.party_name || '—'}</td><td className="r">{money(v.amount)}</td><td><span className={`pill ${VSTATUS[v.status]?.[1] || ''}`}>{VSTATUS[v.status]?.[0] || v.status}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// a searchable, paged list of one kind of record
const COLS = {
  ledgers: { search: 'Search ledgers, email or phone', head: ['Ledger', 'Group', 'Contact', 'Balance'], row: (r) => [<><b>{r.name}</b>{r.address && <small className="sub-t">{r.address}</small>}</>, r.ledger_group || r.parent || '—', <>{r.phone || ''}{r.email && <small className="sub-t">{r.email}</small>}</>, drcr(r.closing_balance)] },
  outstandings: { search: 'Search party or bill number', head: ['Party', 'Bill', 'Due', 'Pending', 'Status'], row: (r) => [<><b>{r.party_name}</b><small className="sub-t">{r.bill_type === 'PAYABLE' ? 'You pay' : 'You receive'}</small></>, <span className="mono">{r.bill_number || '—'}</span>, <>{r.due_date ? fmtDate(r.due_date) : '—'}{r.days_overdue > 0 && <small className="sub-t">{r.days_overdue} days late</small>}</>, money(r.pending_amount), <span className={`pill ${BSTATUS[r.status]?.[1] || ''}`}>{BSTATUS[r.status]?.[0] || r.status}</span>] },
  stock: { search: 'Search stock items', head: ['Item', 'Group', 'In stock', 'Value', 'Rates'], row: (r) => [<b>{r.name}</b>, r.parent || '—', <span className={Number(r.closing_balance) <= 0 ? 'bad-t' : ''}>{r.closing_balance ?? '—'} {r.base_units || ''}</span>, money(r.closing_value), <small className="muted">{r.last_sale_rate ? `sells ${inr(r.last_sale_rate)}` : ''}{r.last_purchase_rate ? ` · buys ${inr(r.last_purchase_rate)}` : ''}</small>] },
};
function List({ kind, rev, onOpen, voucherTypes }) {
  const [q, setQ] = useState({ search: '', offset: 0, voucher_type: '', bill_type: '', open: kind === 'outstandings' ? '1' : '' });
  const [d, setD] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => { const qs = new URLSearchParams(Object.entries({ ...q, limit: 50 }).filter(([, v]) => v !== '' && v != null)); api(`/tally/${kind}?${qs}`).then(setD).catch((e) => toast(e.message)); }, q.search ? 250 : 0);
    return () => clearTimeout(t);
  }, [kind, q, rev]);
  const set = (p) => setQ({ ...q, ...p, offset: 'offset' in p ? p.offset : 0 });
  const c = COLS[kind];
  return (
    <Panel pad={false} title={d ? `${d.total.toLocaleString('en-IN')} ${kind === 'outstandings' ? 'bills' : kind === 'stock' ? 'items' : kind}` : ' '}
      actions={<div className="row tl-filters">
        <input type="search" value={q.search} onChange={(e) => set({ search: e.target.value })} placeholder={kind === 'vouchers' ? 'Search party, number or narration' : c.search} aria-label="Search" />
        {kind === 'vouchers' && <select value={q.voucher_type} onChange={(e) => set({ voucher_type: e.target.value })} aria-label="Voucher type"><option value="">All types</option>{voucherTypes.map((t) => <option key={t}>{t}</option>)}</select>}
        {kind === 'outstandings' && <><select value={q.bill_type} onChange={(e) => set({ bill_type: e.target.value })} aria-label="Direction"><option value="">Both ways</option><option value="RECEIVABLE">You receive</option><option value="PAYABLE">You pay</option></select><label className="tog sm"><input type="checkbox" checked={q.open === '1'} onChange={(e) => set({ open: e.target.checked ? '1' : '' })} /><span />Open only</label></>}
      </div>}>
      {!d ? <div className="skeleton" /> : kind === 'vouchers' ? <VoucherTable rows={d.items} onOpen={onOpen} /> : !d.items.length ? <p className="muted sm pad">Nothing matches.</p> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr>{c.head.map((h, i) => <th key={h} className={i >= c.head.length - 2 && kind !== 'outstandings' ? 'r' : ''}>{h}</th>)}</tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id} className="click" onClick={() => onOpen(r)}>{c.row(r).map((cell, i) => <td key={i} className={i >= c.head.length - 2 && kind !== 'outstandings' ? 'r' : ''}>{cell}</td>)}</tr>)}</tbody>
        </table></div>
      )}
      {d && d.total > 50 && <div className="row tl-pager"><button className="btn ghost sm" disabled={!q.offset} onClick={() => set({ offset: Math.max(0, q.offset - 50) })}>Previous</button><small className="muted">{q.offset + 1}–{Math.min(q.offset + 50, d.total)} of {d.total.toLocaleString('en-IN')}</small><button className="btn ghost sm" disabled={q.offset + 50 >= d.total} onClick={() => set({ offset: q.offset + 50 })}>Next</button></div>}
    </Panel>
  );
}

function Activity({ rev }) {
  const [c, setC] = useState(null);
  const [runs, setRuns] = useState(null);
  useEffect(() => { api('/tally/commands').then(setC).catch(() => setC([])); api('/tally/sync-runs').then(setRuns).catch(() => setRuns([])); }, [rev]);
  return (
    <div className="tl-two">
      <Panel title="Changes sent to Tally" pad={false}>
        {!c ? <div className="skeleton" /> : !c.length ? <p className="muted sm pad">Nothing sent yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><tbody>{c.map((x) => (
            <tr key={x.id}><td><b>{CNAME[x.command_type] || x.command_type}</b><small className="sub-t">{x.payload?.name || x.payload?.party_name || x.payload?.stock_item_name || ''}{x.payload?.amount ? ` · ${inr(x.payload.amount)}` : ''}</small>{x.error_message && <small className="sub-t bad-t">{x.error_message}</small>}</td><td><span className={`pill ${CSTATUS[x.status]?.[1] || ''}`}>{CSTATUS[x.status]?.[0] || x.status}</span></td><td className="r muted nowrap">{ago(x.at)}</td></tr>
          ))}</tbody></table></div>
        )}
      </Panel>
      <Panel title="Syncs from your PC" pad={false}>
        {!runs ? <div className="skeleton" /> : !runs.length ? <p className="muted sm pad">No syncs yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><tbody>{runs.slice(0, 30).map((r) => (
            <tr key={r.id}><td>{r.sync_type.replace(/_/g, ' ').toLowerCase()}<small className="sub-t">{r.records_created || 0} new · {r.records_updated || 0} updated{r.error_message ? ` · ${r.error_message}` : ''}</small></td><td><span className={`pill ${r.status === 'SUCCESS' ? 'ok' : r.status === 'FAILED' ? 'bad' : 'info'}`}>{r.status.toLowerCase()}</span></td><td className="r muted nowrap">{ago(r.at)}</td></tr>
          ))}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}

// one record: a ledger (its vouchers and open bills), a voucher (lines, items, bills), a stock item (its movements)
function Detail({ kind, id, online, onClose, onDone, onOpen }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/tally/${kind}/${id}`).then(setD).catch((e) => { toast(e.message); onClose(); }); }, [kind, id]);
  const run = async (type, payload, label, confirm) => {
    if (confirm && !(await confirmDialog(confirm))) return;
    setBusy(true);
    const r = await runInTally(type, payload, label);
    setBusy(false);
    if (r) { onDone(); onClose(); }
  };
  if (!d) return <Modal title="Loading…" onClose={onClose} width={640}><div className="m-body"><div className="skeleton" /></div></Modal>;
  const offline = !online ? 'Your PC is offline — open TallyPrime and the connector to change this' : undefined;
  if (kind === 'vouchers') {
    const ref = { record_id: d.id };
    return (
      <Modal title={`${d.voucher_type} ${d.voucher_number ? `#${d.voucher_number}` : ''}`} onClose={onClose} width={720}>
        <div className="m-body tl-detail">
          <div className="status-list cols">
            <div><span>Date</span><b>{d.voucher_date ? fmtDate(d.voucher_date) : '—'}</b></div><div><span>Party</span><b>{d.party_name || '—'}</b></div>
            <div><span>Amount</span><b>{money(d.amount)}</b></div><div><span>Status</span><b><span className={`pill ${VSTATUS[d.status]?.[1] || ''}`}>{VSTATUS[d.status]?.[0] || d.status}</span></b></div>
            {d.reference_number && <div><span>Reference</span><b>{d.reference_number}</b></div>}{d.due_date && <div><span>Due</span><b>{fmtDate(d.due_date)}</b></div>}
          </div>
          {d.narration && <p className="muted sm">{d.narration}</p>}
          {d.items?.length > 0 && <><h4>Items</h4><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th><th>Godown</th></tr></thead><tbody>{d.items.map((i) => <tr key={i.line_index}><td>{i.stock_item_name}</td><td className="r">{Math.abs(i.billed_qty ?? i.actual_qty ?? 0)}</td><td className="r">{money(i.rate)}</td><td className="r">{money(i.amount)}</td><td>{i.godown_name || '—'}</td></tr>)}</tbody></table></div></>}
          {d.lines?.length > 0 && <><h4>Accounting</h4><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Ledger</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead><tbody>{d.lines.map((l) => <tr key={l.line_index}><td>{l.ledger_name}{l.bills?.length > 0 && <small className="sub-t">{l.bills.map((b) => `${b.bill_type || 'Bill'} ${b.bill_name}`).join(', ')}</small>}</td><td className="r">{l.debit_amount ? inr(l.debit_amount) : ''}</td><td className="r">{l.credit_amount ? inr(l.credit_amount) : ''}</td></tr>)}</tbody></table></div></>}
          {d.outstandings?.length > 0 && <><h4>Bills</h4><ul className="tl-rank">{d.outstandings.map((o) => <li key={o.id}><span>{o.bill_number} · due {o.due_date ? fmtDate(o.due_date) : '—'}</span><b>{money(o.pending_amount)} <span className={`pill ${BSTATUS[o.status]?.[1] || ''}`}>{BSTATUS[o.status]?.[0]}</span></b></li>)}</ul></>}
          {d.status !== 'CANCELLED' && <div className="m-foot">
            <button className="btn ghost" disabled={busy || !online} title={offline} onClick={() => run('CANCEL_VOUCHER', ref, 'Cancel voucher', { title: `Cancel ${d.voucher_type} ${d.voucher_number || ''}?`, text: 'Tally keeps it, marked cancelled, with no amounts.', confirm: 'Cancel voucher', danger: true })}>Cancel in Tally</button>
            <button className="btn ghost danger" disabled={busy || !online} title={offline} onClick={() => run('DELETE_VOUCHER', ref, 'Delete voucher', { title: `Delete ${d.voucher_type} ${d.voucher_number || ''} from Tally?`, text: 'It’s removed from your books for good.', confirm: 'Delete', danger: true })}>Delete</button>
          </div>}
        </div>
      </Modal>
    );
  }
  if (kind === 'ledgers') {
    return (
      <Modal title={d.name} onClose={onClose} width={720}>
        <div className="m-body tl-detail">
          <div className="status-list cols">
            <div><span>Group</span><b>{d.ledger_group || d.parent || '—'}</b></div><div><span>Balance</span><b>{drcr(d.closing_balance)}</b></div>
            <div><span>Phone</span><b>{d.phone || '—'}</b></div><div><span>Email</span><b>{d.email || '—'}</b></div>
            {d.address && <div><span>Address</span><b>{d.address}</b></div>}{d.credit_period_days != null && <div><span>Credit period</span><b>{d.credit_period_days} days</b></div>}
          </div>
          {d.outstandings?.length > 0 && <><h4>Open bills</h4><ul className="tl-rank">{d.outstandings.map((o) => <li key={o.id}><span>{o.bill_number || 'On account'} · due {o.due_date ? fmtDate(o.due_date) : '—'}</span><b>{money(o.pending_amount)} <span className={`pill ${BSTATUS[o.status]?.[1] || ''}`}>{BSTATUS[o.status]?.[0]}</span></b></li>)}</ul></>}
          <h4>Vouchers</h4>
          <VoucherTable rows={d.vouchers} onOpen={(row) => onOpen('vouchers', row)} compact />
          <div className="m-foot"><button className="btn ghost danger" disabled={busy || !online} title={offline} onClick={() => run('DELETE_LEDGER', { record_id: d.id, name: d.name }, 'Delete ledger', { title: `Delete the ledger ${d.name} from Tally?`, text: 'Tally refuses if any voucher uses it.', confirm: 'Delete', danger: true })}>Delete ledger</button></div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={d.name} onClose={onClose} width={680}>
      <div className="m-body tl-detail">
        <div className="status-list cols">
          <div><span>In stock</span><b>{d.closing_balance ?? '—'} {d.base_units || ''}</b></div><div><span>Value</span><b>{money(d.closing_value)}</b></div>
          <div><span>Group</span><b>{d.parent || '—'}</b></div><div><span>Last rates</span><b>{d.last_sale_rate ? `sells ${inr(d.last_sale_rate)}` : '—'}{d.last_purchase_rate ? ` · buys ${inr(d.last_purchase_rate)}` : ''}</b></div>
        </div>
        <h4>Movements</h4>
        {!d.movements?.length ? <p className="muted sm">No vouchers with this item yet.</p> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th className="r">Qty</th><th>Godown</th></tr></thead><tbody>{d.movements.flatMap((v) => v.lines.map((l) => <tr key={`${v.id}${l.line_index}`} className="click" onClick={() => onOpen('vouchers', v)}><td className="nowrap">{fmtDate(v.voucher_date)}</td><td>{v.voucher_type} {v.voucher_number}</td><td>{v.party_name || '—'}</td><td className="r">{l.actual_qty ?? l.billed_qty}</td><td>{l.godown_name || '—'}</td></tr>))}</tbody></table></div>}
        <div className="m-foot"><button className="btn ghost danger" disabled={busy || !online} title={offline} onClick={() => run('DELETE_STOCK_ITEM', { record_id: d.id, name: d.name }, 'Delete stock item', { title: `Delete ${d.name} from Tally?`, text: 'Tally refuses if any voucher uses it.', confirm: 'Delete', danger: true })}>Delete item</button></div>
      </div>
    </Modal>
  );
}

// names to pick from in the forms: ledgers, stock items, godowns, units (the first 200 of each, searched by the browser)
function useNames(kinds) {
  const [n, setN] = useState({});
  useEffect(() => { Promise.all(kinds.map((k) => api(`/tally/${k}?limit=200`).then((r) => [k, r.items]).catch(() => [k, []]))).then((x) => setN(Object.fromEntries(x))); }, []);
  return n;
}
const Datalist = ({ id, items, f = (x) => x.name }) => <datalist id={id}>{(items || []).map((x) => <option key={x.id} value={f(x)} />)}</datalist>;

function FormModal({ title, onClose, busy, onSubmit, children, submit = 'Save in Tally' }) {
  return (
    <Modal title={title} onClose={onClose} width={640}>
      <form className="m-body tl-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        {children}
        <div className="m-foot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Waiting for Tally…' : submit}</button></div>
      </form>
    </Modal>
  );
}
const useRun = (onDone, onClose) => {
  const [busy, setBusy] = useState(false);
  const go = async (type, payload, label) => { setBusy(true); const r = await runInTally(type, payload, label); setBusy(false); if (r) { onDone(); onClose(); } };
  return [busy, go];
};

// a voucher: party-based (Sales, Purchase, Receipt, Payment, Credit / Debit Note) or two ledgers (Journal, Contra);
// Sales / Purchase can list items instead of an amount
function VoucherForm({ s, onClose, onDone }) {
  const names = useNames(['ledgers', 'stock', 'godowns']);
  const [v, setV] = useState({ voucher_type: 'Sales', date: today(), party_name: '', offset_ledger: '', debit_ledger: '', credit_ledger: '', amount: '', reference_number: '', narration: '', bill_number: '', due_date: '', items: [] });
  const [busy, go] = useRun(onDone, onClose);
  const set = (p) => setV({ ...v, ...p });
  const twoLedgers = ['Journal', 'Contra'].includes(v.voucher_type);
  const withItems = ['Sales', 'Purchase'].includes(v.voucher_type);
  const itemTotal = v.items.reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const setItem = (k, p) => set({ items: v.items.map((i, j) => (j === k ? { ...i, ...p } : i)) });
  const offsetHint = { Sales: 'Sales account (e.g. Sales Account)', Purchase: 'Purchase account (e.g. Purchase Account)', Receipt: 'Cash or bank it came into', Payment: 'Cash or bank it was paid from', 'Credit Note': 'Sales account', 'Debit Note': 'Purchase account' }[v.voucher_type];
  const submit = () => {
    const items = v.items.filter((i) => i.stock_item_name && Number(i.quantity) > 0).map((i) => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate) || 0 }));
    const p = { voucher_type: v.voucher_type, date: v.date, narration: v.narration || undefined, reference_number: v.reference_number || undefined };
    if (twoLedgers) Object.assign(p, { debit_ledger: v.debit_ledger, credit_ledger: v.credit_ledger, amount: Number(v.amount) });
    else Object.assign(p, { party_name: v.party_name, offset_ledger: v.offset_ledger || undefined, ...(items.length ? { items } : { amount: Number(v.amount) }), ...(v.bill_number ? { bill_number: v.bill_number, bill_type: ['Receipt', 'Payment', 'Credit Note', 'Debit Note'].includes(v.voucher_type) ? 'Agst Ref' : 'New Ref' } : {}), ...(v.due_date ? { due_date: v.due_date } : {}) });
    go(v.voucher_type === 'Receipt' ? 'CREATE_RECEIPT' : v.voucher_type === 'Payment' ? 'CREATE_PAYMENT' : 'CREATE_VOUCHER', p, `${v.voucher_type} voucher`);
  };
  return (
    <FormModal title="New voucher" onClose={onClose} busy={busy} onSubmit={submit}>
      <Datalist id="tl-ledgers" items={names.ledgers} /><Datalist id="tl-stock" items={names.stock} /><Datalist id="tl-godowns" items={names.godowns} />
      <div className="seg tl-vt" role="radiogroup" aria-label="Voucher type">{s.voucherTypes.map((t) => <button key={t} type="button" role="radio" aria-checked={v.voucher_type === t} className={v.voucher_type === t ? 'on' : ''} onClick={() => set({ voucher_type: t, items: [] })}>{t}</button>)}</div>
      <div className="form2">
        <label>Date<input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label>Reference <small className="muted">· optional</small><input value={v.reference_number} onChange={(e) => set({ reference_number: e.target.value })} placeholder="e.g. their invoice number" /></label>
        {twoLedgers ? <>
          <label>Debit ledger<input list="tl-ledgers" value={v.debit_ledger} onChange={(e) => set({ debit_ledger: e.target.value })} required /></label>
          <label>Credit ledger<input list="tl-ledgers" value={v.credit_ledger} onChange={(e) => set({ credit_ledger: e.target.value })} required /></label>
        </> : <>
          <label>Party<input list="tl-ledgers" value={v.party_name} onChange={(e) => set({ party_name: e.target.value })} placeholder="Customer or supplier ledger" required /></label>
          <label>Against <small className="muted">· optional</small><input list="tl-ledgers" value={v.offset_ledger} onChange={(e) => set({ offset_ledger: e.target.value })} placeholder={offsetHint} /></label>
        </>}
      </div>
      {withItems && <div className="tl-items">
        {v.items.map((i, k) => (
          <div className="tl-item" key={k}>
            <input list="tl-stock" value={i.stock_item_name} onChange={(e) => setItem(k, { stock_item_name: e.target.value })} placeholder="Item" aria-label="Item" />
            <input type="number" min="0" step="any" value={i.quantity} onChange={(e) => setItem(k, { quantity: e.target.value })} placeholder="Qty" aria-label="Quantity" />
            <input type="number" min="0" step="any" value={i.rate} onChange={(e) => setItem(k, { rate: e.target.value })} placeholder="Rate" aria-label="Rate" />
            <input list="tl-godowns" value={i.godown_name || ''} onChange={(e) => setItem(k, { godown_name: e.target.value })} placeholder="Godown" aria-label="Godown" />
            <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => set({ items: v.items.filter((_, j) => j !== k) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <div className="row"><button type="button" className="btn ghost sm" onClick={() => set({ items: [...v.items, { stock_item_name: '', quantity: '', rate: '' }] })}><Icon name="plus" size={14} /> Add item</button>{v.items.length > 0 && <b>{inr(itemTotal)}</b>}</div>
      </div>}
      <div className="form2">
        {!(withItems && v.items.length) && <label>Amount (₹)<input type="number" min="0" step="any" value={v.amount} onChange={(e) => set({ amount: e.target.value })} required /></label>}
        {!twoLedgers && <label>Bill number <small className="muted">· optional{['Receipt', 'Payment'].includes(v.voucher_type) ? ' — the bill this settles' : ''}</small><input value={v.bill_number} onChange={(e) => set({ bill_number: e.target.value })} /></label>}
        {['Sales', 'Purchase'].includes(v.voucher_type) && v.bill_number && <label>Due date<input type="date" value={v.due_date} onChange={(e) => set({ due_date: e.target.value })} /></label>}
        <label className="full">Narration <small className="muted">· optional</small><input value={v.narration} onChange={(e) => set({ narration: e.target.value })} /></label>
      </div>
      <p className="hint">GST and tax ledgers aren’t added for you — add them as items or adjust the voucher in TallyPrime if needed.</p>
    </FormModal>
  );
}

function LedgerForm({ s, onClose, onDone }) {
  const [v, setV] = useState({ name: '', parent: 'Sundry Debtors', email: '', phone: '', address: '', state: '', pincode: '', gstin: '', credit_period_days: '' });
  const [busy, go] = useRun(onDone, onClose);
  const set = (p) => setV({ ...v, ...p });
  const submit = () => go('CREATE_LEDGER', { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')), credit_period_days: v.credit_period_days === '' ? undefined : Number(v.credit_period_days), maintain_bill_by_bill: ['Sundry Debtors', 'Sundry Creditors'].includes(v.parent) }, 'Ledger');
  return (
    <FormModal title="New ledger" onClose={onClose} busy={busy} onSubmit={submit}>
      <div className="form2">
        <label>Name<input value={v.name} onChange={(e) => set({ name: e.target.value })} required autoFocus /></label>
        <label>Group<select value={v.parent} onChange={(e) => set({ parent: e.target.value })}>{s.groups.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label>Phone<input value={v.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label>Email<input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></label>
        <label className="full">Address<input value={v.address} onChange={(e) => set({ address: e.target.value })} /></label>
        <label>State<input value={v.state} onChange={(e) => set({ state: e.target.value })} placeholder="e.g. Rajasthan" /></label>
        <label>PIN code<input value={v.pincode} onChange={(e) => set({ pincode: e.target.value })} /></label>
        <label>GSTIN <small className="muted">· optional</small><input value={v.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} /></label>
        <label>Credit period (days) <small className="muted">· optional</small><input type="number" min="0" value={v.credit_period_days} onChange={(e) => set({ credit_period_days: e.target.value })} /></label>
      </div>
    </FormModal>
  );
}

function StockItemForm({ onClose, onDone }) {
  const names = useNames(['units', 'godowns']);
  const [v, setV] = useState({ name: '', base_units: 'Nos', parent: '', standard_price: '', standard_cost: '', opening_balance: '', opening_rate: '', godown_name: '' });
  const [busy, go] = useRun(onDone, onClose);
  const set = (p) => setV({ ...v, ...p });
  const submit = () => {
    const p = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
    if (p.opening_balance && p.opening_rate) p.opening_value = Number(p.opening_balance) * Number(p.opening_rate);
    go('CREATE_STOCK_ITEM', p, 'Stock item');
  };
  return (
    <FormModal title="New stock item" onClose={onClose} busy={busy} onSubmit={submit}>
      <Datalist id="tl-units" items={names.units} /><Datalist id="tl-godowns2" items={names.godowns} />
      <div className="form2">
        <label>Name<input value={v.name} onChange={(e) => set({ name: e.target.value })} required autoFocus /></label>
        <label>Unit<input list="tl-units" value={v.base_units} onChange={(e) => set({ base_units: e.target.value })} required /></label>
        <label>Group <small className="muted">· optional</small><input value={v.parent} onChange={(e) => set({ parent: e.target.value })} /></label>
        <label>Selling price (₹) <small className="muted">· optional</small><input type="number" min="0" step="any" value={v.standard_price} onChange={(e) => set({ standard_price: e.target.value })} /></label>
        <label>Opening quantity <small className="muted">· optional</small><input type="number" min="0" step="any" value={v.opening_balance} onChange={(e) => set({ opening_balance: e.target.value })} /></label>
        <label>Opening rate (₹)<input type="number" min="0" step="any" value={v.opening_rate} onChange={(e) => set({ opening_rate: e.target.value })} disabled={!v.opening_balance} /></label>
        {v.opening_balance && <label>Godown<input list="tl-godowns2" value={v.godown_name} onChange={(e) => set({ godown_name: e.target.value })} placeholder="Main Location" /></label>}
      </div>
    </FormModal>
  );
}

// a godown-to-godown transfer (Tally's stock journal)
function TransferForm({ onClose, onDone }) {
  const names = useNames(['stock', 'godowns']);
  const [v, setV] = useState({ stock_item_name: '', quantity: '', unit: '', source_godown: '', dest_godown: '', date: today(), narration: '' });
  const [busy, go] = useRun(onDone, onClose);
  const set = (p) => setV({ ...v, ...p });
  const item = useMemo(() => (names.stock || []).find((x) => x.name.toLowerCase() === v.stock_item_name.trim().toLowerCase()), [names.stock, v.stock_item_name]);
  const submit = () => go('CREATE_STOCK_JOURNAL', { ...v, quantity: Number(v.quantity), unit: v.unit || item?.base_units || 'Nos', narration: v.narration || undefined }, 'Stock transfer');
  return (
    <FormModal title="Stock transfer" onClose={onClose} busy={busy} onSubmit={submit} submit="Transfer in Tally">
      <Datalist id="tl-stock2" items={names.stock} /><Datalist id="tl-godowns3" items={names.godowns} />
      <div className="form2">
        <label className="full">Item<input list="tl-stock2" value={v.stock_item_name} onChange={(e) => set({ stock_item_name: e.target.value })} required autoFocus />{item && <small className="muted">{item.closing_balance ?? '—'} {item.base_units} in stock</small>}</label>
        <label>Quantity<input type="number" min="0" step="any" value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} required /></label>
        <label>Unit<input value={v.unit || item?.base_units || ''} onChange={(e) => set({ unit: e.target.value })} placeholder="Nos" /></label>
        <label>From godown<input list="tl-godowns3" value={v.source_godown} onChange={(e) => set({ source_godown: e.target.value })} required /></label>
        <label>To godown<input list="tl-godowns3" value={v.dest_godown} onChange={(e) => set({ dest_godown: e.target.value })} required /></label>
        <label>Date<input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label>Narration <small className="muted">· optional</small><input value={v.narration} onChange={(e) => set({ narration: e.target.value })} /></label>
      </div>
    </FormModal>
  );
}
