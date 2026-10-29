// Tally: the seller's TallyPrime, mirrored here by the FunnelHive Tally Connector on their Windows PC (server/tally.js).
// Reads come from the mirror; every change is queued for the PC, which runs it in TallyPrime and reports back — the
// screen waits for that answer, so what it shows is what Tally accepted.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, confirmDialog, inr, ago } from '../ui';
import '../tally-insights.css';

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
        <button className="btn ghost" onClick={() => setForm('settings')} title="Tally settings" aria-label="Tally settings"><Icon name="settings" size={14} /></button>
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
          {tab === 'stock' && <><StockInsights rev={rev} onOpen={(row) => setForm({ kind: 'stock', row })} /><List kind="stock" rev={rev} onOpen={(row) => setForm({ kind: 'stock', row })} /></>}
          {tab === 'activity' && <Activity rev={rev} />}
        </>
      )}
      {connect && <Modal title="Connect another PC" onClose={() => setConnect(false)} width={560}><div className="m-body"><ConnectPC s={s} onDone={() => { setConnect(false); load(); }} compact /></div></Modal>}
      {form === 'voucher' && <VoucherForm s={s} onClose={() => setForm(null)} onDone={changed} />}
      {form === 'ledger' && <LedgerForm s={s} onClose={() => setForm(null)} onDone={changed} />}
      {form === 'stock' && <StockItemForm onClose={() => setForm(null)} onDone={changed} />}
      {form === 'transfer' && <TransferForm onClose={() => setForm(null)} onDone={changed} />}
      {form === 'settings' && <TallySettings onClose={() => setForm(null)} />}
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
      <li><b>Open TallyPrime with your company</b><small className="muted">In TallyPrime: F1 Help → Settings → Connectivity → set “TallyPrime acts as” to Both, port 9000, then restart TallyPrime. For GST on vouchers, keep Output CGST / SGST / IGST (and Input … for purchases) ledgers under Duties &amp; Taxes.</small></li>
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
  const ICON = { 'To receive': 'wallet', 'To pay': 'receipt', 'Sales this month': 'chart', 'Purchases this month': 'cart', 'Received this month': 'download', 'Stock value': 'box' };
  const TONE = { 'To receive': 'in', 'To pay': 'out' };
  const kpi = (l, v, f, onClick) => <button type="button" className={`kpi tl-kpi ${TONE[l] || ''}`} key={l} onClick={onClick}><span className="kpi-l"><span className="kpi-ic"><Icon name={ICON[l]} size={14} /></span>{l}</span><b className="kpi-v">{v}</b>{f && <div className="kpi-f"><small>{f}</small></div>}</button>;
  // the money picture: what's owed both ways, and this month's flow in and out
  const recv = d.receivable.total || 0, pay = d.payable.total || 0, net = recv - pay;
  const flow = [['Sales', m('Sales').amount, 'in'], ['Received', m('Receipt').amount, 'in'], ['Purchases', m('Purchase').amount, 'out'], ['Paid out', m('Payment').amount, 'out']];
  const flowMax = Math.max(1, ...flow.map((f) => f[1] || 0));
  const debtMax = Math.max(1, ...d.topDebtors.map((x) => x.amount));
  return (
    <>
      <section className="tl-hero" aria-label="Money position">
        <div className="tl-hero-net">
          <span className="tl-hero-l">Net position</span>
          <b className={`tl-hero-v ${net < 0 ? 'neg' : ''}`}>{net < 0 ? '−' : ''}{money(net)}</b>
          <small>{net >= 0 ? 'more coming in than going out' : 'more going out than coming in'}</small>
          <div className="tl-split" role="img" aria-label={`${money(recv)} to receive, ${money(pay)} to pay`}>
            <i className="tl-in" style={{ flexGrow: recv || (pay ? 0 : 1) }} /><i className="tl-out" style={{ flexGrow: pay || (recv ? 0 : 1) }} />
          </div>
          <div className="tl-split-k"><span><em className="tl-in" />To receive <b>{money(recv)}</b></span><span><em className="tl-out" />To pay <b>{money(pay)}</b></span></div>
        </div>
        <div className="tl-hero-flow">
          <span className="tl-hero-l">This month</span>
          {flow.map(([label, v, dir]) => (
            <div className="tl-flow" key={label}>
              <span>{label}</span>
              <div className="tl-flow-bar"><i className={`tl-${dir}`} style={{ width: `${Math.max(v ? 3 : 0, (100 * (v || 0)) / flowMax)}%` }} /></div>
              <b>{money(v || 0)}</b>
            </div>
          ))}
        </div>
      </section>
      <div className="kpis tl-kpis">
        {kpi('To receive', money(d.receivable.total), `${d.receivable.overdue ? `${money(d.receivable.overdue)} overdue · ${n(d.receivable.overdueBills, 'bill', 'bills')}` : n(d.receivable.bills, 'open bill', 'open bills')}${d.receivable.advances ? ` · after ${money(d.receivable.advances)} advance` : ''}`, () => go('outstandings'))}
        {kpi('To pay', money(d.payable.total), `${d.payable.overdue ? `${money(d.payable.overdue)} overdue` : n(d.payable.bills, 'open bill', 'open bills')}${d.payable.advances ? ` · after ${money(d.payable.advances)} advance` : ''}`, () => go('outstandings'))}
        {kpi('Sales this month', money(m('Sales').amount), n(m('Sales').count, 'voucher', 'vouchers'), () => go('vouchers'))}
        {kpi('Purchases this month', money(m('Purchase').amount), n(m('Purchase').count, 'voucher', 'vouchers'), () => go('vouchers'))}
        {kpi('Received this month', money(m('Receipt').amount), `${money(m('Payment').amount)} paid out`, () => go('vouchers'))}
        {kpi('Stock value', money(d.stock.value), d.stock.low ? `${n(d.stock.low, 'item', 'items')} out of stock` : n(d.stock.items, 'item', 'items'), () => go('stock'))}
      </div>
      <div className="tl-two">
        <Panel title="Who owes you most">
          {!d.topDebtors.length ? <p className="muted sm">Nobody owes you anything right now.</p> : <ul className="tl-rank">{d.topDebtors.map((x) => (
            <li key={x.name}>
              <span className="tl-av" aria-hidden="true">{x.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
              <div><div className="tl-rank-t"><span>{x.name}</span><b>{inr(x.amount)}</b></div><div className="tl-rank-bar"><i style={{ width: `${(100 * x.amount) / debtMax}%` }} /></div></div>
            </li>
          ))}</ul>}
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
    <div className="tbl-wrap tl-tbl"><table className="tbl">
      <thead><tr><th>Date</th><th>Type</th>{!compact && <th>No.</th>}<th>Party</th><th className="r">Amount</th><th>Status</th></tr></thead>
      <tbody>{rows.map((v) => (
        <tr key={v.id} className="click" onClick={() => onOpen(v)}>
          <td className="nowrap">{v.voucher_date ? fmtDate(v.voucher_date) : '—'}</td><td><span className={`tl-vt-chip tl-${vtone(v.voucher_type)}`}>{v.voucher_type}</span>{v.source && v.source !== 'TALLY' && <small className="sub-t">from FunnelHive</small>}</td>{!compact && <td className="mono">{v.voucher_number || '—'}</td>}
          <td>{v.party_name || '—'}</td><td className={`r tl-amt ${v.status === 'CANCELLED' ? '' : vtone(v.voucher_type) === 'in' ? 'tl-in-t' : vtone(v.voucher_type) === 'out' ? 'tl-out-t' : ''}`}>{money(v.amount)}</td><td><span className={`pill ${VSTATUS[v.status]?.[1] || ''}`}>{VSTATUS[v.status]?.[0] || v.status}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

// the strip above a list: a few figures for the whole company, each with an icon and a tone
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
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const VTONE = { sales: 'in', receipt: 'in', 'credit note': 'out', purchase: 'out', payment: 'out', 'debit note': 'in', journal: 'mid', contra: 'mid' };
const vtone = (t) => VTONE[String(t || '').toLowerCase()] || 'mid';
const STRIPS = {
  ledgers: (s) => [['Ledgers', s.total.toLocaleString('en-IN'), 'in your books', 'layers'], ['Customers', s.customers.toLocaleString('en-IN'), 'Sundry Debtors', 'users', 'in'], ['Suppliers', s.suppliers.toLocaleString('en-IN'), 'Sundry Creditors', 'cart', 'out'], ['Bank & cash', s.banks.toLocaleString('en-IN'), 'accounts', 'wallet']],
  vouchers: (s) => { const m = (t) => s.month[t] || { count: 0, amount: 0 }; return [['Sales', money(m('Sales').amount), `${m('Sales').count} this month`, 'chart', 'in'], ['Received', money(m('Receipt').amount), `${m('Receipt').count} this month`, 'download', 'in'], ['Purchases', money(m('Purchase').amount), `${m('Purchase').count} this month`, 'cart', 'out'], ['Paid out', money(m('Payment').amount), `${m('Payment').count} this month`, 'receipt', 'out']]; },
  outstandings: (s) => [['Overdue', money(s.overdue.amount), `${s.overdue.count} ${s.overdue.count === 1 ? 'bill' : 'bills'}`, 'clock', s.overdue.count ? 'bad' : ''], ['Due in 7 days', money(s.dueSoon.amount), `${s.dueSoon.count} ${s.dueSoon.count === 1 ? 'bill' : 'bills'}`, 'bell', 'out'], ['Open bills', s.open.toLocaleString('en-IN'), 'both ways', 'receipt'], s.advances.count ? ['Advances', money(s.advances.amount), 'come off what’s owed', 'wallet', 'in'] : null],
  stock: (s) => [['Stock value', money(s.value), 'at closing rates', 'box', 'in'], ['Items', s.items.toLocaleString('en-IN'), 'stock items', 'layers'], ['Out of stock', s.out.toLocaleString('en-IN'), s.out ? 'need restocking' : 'all in stock', 'bell', s.out ? 'bad' : 'in']],
};
const EMPTY = { ledgers: ['users', 'No ledgers found', 'Try another name, phone or email — or sync from Tally.'], vouchers: ['receipt', 'No vouchers found', 'Try another search or type. New vouchers from Tally appear here after a sync.'], outstandings: ['check', 'No bills here', 'Nothing matches — or everyone’s paid up.'], stock: ['box', 'No stock items found', 'Try another name, or add an item with New.'] };

// a searchable, paged list of one kind of record
const COLS = {
  ledgers: { search: 'Search ledgers, email or phone', head: ['Ledger', 'Group', 'Contact', 'Balance'], row: (r) => [<div className="tl-who"><span className="tl-av sm" aria-hidden="true">{initials(r.name)}</span><div><b>{r.name}</b>{r.address && <small className="sub-t">{r.address}</small>}</div></div>, <span className="tl-chip">{r.ledger_group || r.parent || '—'}</span>, <>{r.phone || ''}{r.email && <small className="sub-t">{r.email}</small>}</>, <span className={`tl-amt ${Number(r.closing_balance) < 0 ? 'dr' : Number(r.closing_balance) > 0 ? 'cr' : ''}`}>{drcr(r.closing_balance)}</span>] },
  outstandings: { search: 'Search party or bill number', head: ['Party', 'Bill', 'Due', 'Pending', 'Status'], row: (r) => r.advance
    ? [<><b>{r.party_name}</b><small className="sub-t">{r.bill_type === 'PAYABLE' ? 'Advance from them — comes off what they owe' : 'Advance you paid — comes off what you owe'}</small></>, <span className="mono">{r.bill_number || '—'}</span>, '—', money(r.pending_amount), <span className="pill info">Advance</span>]
    : [<div className="tl-who"><span className={`tl-dir ${r.bill_type === 'PAYABLE' ? 'tl-out' : 'tl-in'}`} aria-hidden="true">{r.bill_type === 'PAYABLE' ? '↑' : '↓'}</span><div><b>{r.party_name}</b><small className="sub-t">{r.bill_type === 'PAYABLE' ? 'You pay' : 'You receive'}</small></div></div>, <span className="mono">{r.bill_number || '—'}</span>, <>{r.due_date ? fmtDate(r.due_date) : '—'}{r.days_overdue > 0 && <small className="sub-t bad-t">{r.days_overdue} days late</small>}</>, <PaidBar pending={r.pending_amount} total={r.amount} />, <span className={`pill ${BSTATUS[r.status]?.[1] || ''}`}>{BSTATUS[r.status]?.[0] || r.status}</span>] },
  stock: { search: 'Search stock items', head: ['Item', 'Group', 'In stock', 'Value', 'Rates'], row: (r, s) => [<div className="tl-who"><span className="tl-av sm box" aria-hidden="true"><Icon name="box" size={14} /></span><b>{r.name}</b></div>, <span className="tl-chip">{r.parent || '—'}</span>, <div className="tl-level"><span className={Number(r.closing_balance) <= 0 ? 'bad-t' : ''}>{r.closing_balance ?? '—'} {r.base_units || ''}</span>{r.closing_balance != null && s?.maxQty > 0 && <i className={Number(r.closing_balance) <= 0 ? 'empty' : ''}><i style={{ width: `${Math.max(0, Math.min(100, (100 * Number(r.closing_balance)) / s.maxQty))}%` }} /></i>}</div>, money(r.closing_value), <small className="muted">{r.last_sale_rate ? `sells ${inr(r.last_sale_rate)}` : ''}{r.last_purchase_rate ? ` · buys ${inr(r.last_purchase_rate)}` : ''}</small>] },
};
// what's left on a bill, with how much of it is paid already
function PaidBar({ pending, total }) {
  const p = Math.abs(Number(pending) || 0), t = Math.abs(Number(total) || 0);
  const paid = t > p ? Math.round((100 * (t - p)) / t) : 0;
  return <div className="tl-paid"><span>{money(p)}</span>{paid > 0 && <><i><i style={{ width: `${paid}%` }} /></i><small className="sub-t">{paid}% paid of {money(t)}</small></>}</div>;
}
function List({ kind, rev, onOpen, voucherTypes }) {
  const [q, setQ] = useState({ search: '', offset: 0, voucher_type: '', bill_type: '', open: kind === 'outstandings' ? '1' : '' });
  const [d, setD] = useState(null);
  const stats = useRef(null); // the strip keeps its figures while a later page loads
  useEffect(() => {
    const t = setTimeout(() => { const qs = new URLSearchParams(Object.entries({ ...q, limit: 50 }).filter(([, v]) => v !== '' && v != null)); api(`/tally/${kind}?${qs}`).then(setD).catch((e) => toast(e.message)); }, q.search ? 250 : 0);
    return () => clearTimeout(t);
  }, [kind, q, rev]);
  const set = (p) => setQ({ ...q, ...p, offset: 'offset' in p ? p.offset : 0 });
  const c = COLS[kind];
  if (d?.stats) stats.current = d.stats;
  const empty = EMPTY[kind];
  return (
    <>
    {stats.current && STRIPS[kind] && <Strip items={STRIPS[kind](stats.current)} />}
    <Panel pad={false} title={d ? `${d.total.toLocaleString('en-IN')} ${(kind === 'outstandings' ? 'bills' : kind === 'stock' ? 'items' : kind).replace(/s$/, d.total === 1 ? '' : 's')}` : ' '}
      actions={<div className="row tl-filters">
        <input type="search" value={q.search} onChange={(e) => set({ search: e.target.value })} placeholder={kind === 'vouchers' ? 'Search party, number or narration' : c.search} aria-label="Search" />
        {kind === 'vouchers' && <select value={q.voucher_type} onChange={(e) => set({ voucher_type: e.target.value })} aria-label="Voucher type"><option value="">All types</option>{voucherTypes.map((t) => <option key={t}>{t}</option>)}</select>}
        {kind === 'outstandings' && <><select value={q.bill_type} onChange={(e) => set({ bill_type: e.target.value })} aria-label="Direction"><option value="">Both ways</option><option value="RECEIVABLE">You receive</option><option value="PAYABLE">You pay</option></select><label className="tog sm"><input type="checkbox" checked={q.open === '1'} onChange={(e) => set({ open: e.target.checked ? '1' : '' })} /><span />Open only</label></>}
      </div>}>
      {!d ? <div className="skeleton" /> : !d.items.length ? <Empty icon={empty[0]} title={empty[1]} text={empty[2]} /> : kind === 'vouchers' ? <VoucherTable rows={d.items} onOpen={onOpen} /> : (
        <div className="tbl-wrap tl-tbl"><table className="tbl">
          <thead><tr>{c.head.map((h, i) => <th key={h} className={i >= c.head.length - 2 && kind !== 'outstandings' ? 'r' : ''}>{h}</th>)}{kind === 'outstandings' && <th />}</tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id} className={`click ${r.advance ? 'tl-adv' : ''}`} onClick={() => onOpen(r)}>{c.row(r, stats.current).map((cell, i) => <td key={i} className={i >= c.head.length - 2 && kind !== 'outstandings' ? 'r' : ''}>{cell}</td>)}{kind === 'outstandings' && <td className="r nowrap">{r.bill_type !== 'PAYABLE' && ['PENDING', 'PARTIAL', 'OVERDUE'].includes(r.status) && <RemindButton bill={r} />}</td>}</tr>)}</tbody>
        </table></div>
      )}
      {d && d.total > 50 && <div className="row tl-pager"><button className="btn ghost sm" disabled={!q.offset} onClick={() => set({ offset: Math.max(0, q.offset - 50) })}>Previous</button><small className="muted">{q.offset + 1}–{Math.min(q.offset + 50, d.total)} of {d.total.toLocaleString('en-IN')}</small><button className="btn ghost sm" disabled={q.offset + 50 >= d.total} onClick={() => set({ offset: q.offset + 50 })}>Next</button></div>}
    </Panel>
    </>
  );
}

// stock insights above the stock list (server/tally-insights.js): what to reorder and how much, dead / fast / slow
// stock, and purchase-order drafts per supplier the seller copies or opens in WhatsApp themselves
const qtyU = (n, unit) => `${Number(n || 0).toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
const daysPill = (x, lead) => (x.daysLeft == null ? '—' : x.stock <= 0 ? <span className="pill bad">Out of stock</span> : <span className={`pill ${x.daysLeft <= lead ? 'bad' : x.daysLeft <= 30 ? 'warn' : 'info'}`}>{x.daysLeft.toLocaleString('en-IN')} {x.daysLeft === 1 ? 'day' : 'days'}</span>);
function StockInsights({ rev, onOpen }) {
  const [d, setD] = useState(null);
  const [po, setPo] = useState(null);
  const [view, setView] = useState('reorder');
  useEffect(() => {
    api('/tally/insights').then(setD).catch((e) => setD({ error: e.message }));
    api('/tally/insights/purchase-orders').then(setPo).catch(() => setPo({ orders: [] }));
  }, [rev]);
  if (!d) return <div className="skeleton ti-skel" />;
  if (d.error) return null; // the list below still works
  const n = (c, one, many) => `${c.toLocaleString('en-IN')} ${c === 1 ? one : many}`;
  const cards = [
    ['reorder', 'Reorder now', d.counts.reorder.toLocaleString('en-IN'), d.counts.reorder ? `run out within ${d.leadDays} days` : 'nothing running out', 'bell', d.counts.reorder ? 'bad' : 'in'],
    ['orders', 'Purchase orders', po ? (po.orders?.length || 0).toLocaleString('en-IN') : '…', 'drafts by supplier', 'cart', 'out'],
    ['dead', 'Dead stock', money(d.deadValue), d.counts.dead ? `${n(d.counts.dead, 'item', 'items')} · no sale in 90 days` : 'everything is selling', 'clock', d.counts.dead ? 'out' : 'in'],
    ['fast', 'Fast movers', d.counts.fast.toLocaleString('en-IN'), 'top sellers, last 90 days', 'chart', 'in'],
    ['slow', 'Slow movers', money(d.slowValue), d.counts.slow ? `${n(d.counts.slow, 'item', 'items')} · ${d.slowDays}+ days of stock` : 'no overstock', 'layers'],
  ];
  const item = (x) => <div className="tl-who"><span className="tl-av sm box" aria-hidden="true"><Icon name="box" size={14} /></span><div><b>{x.name}</b>{x.group && <small className="sub-t">{x.group}</small>}</div></div>;
  const supplier = (x) => (x.supplier ? <>{x.supplier}{x.lastRate != null && <small className="sub-t">last {inr(x.lastRate)}{x.lastPurchased ? ` · ${fmtDate(x.lastPurchased)}` : ''}</small>}</> : <small className="muted">Not bought in Tally yet</small>);
  const TABLES = {
    reorder: { rows: d.reorder, empty: ['check', 'Nothing to reorder right now', `No item runs out within ${d.leadDays} days at the speed it’s selling.`], head: ['Item', 'In stock', 'Sells a day', 'Lasts', 'Order', 'Last supplier'], row: (x) => [item(x), <span className={x.stock <= 0 ? 'bad-t' : ''}>{qtyU(x.stock, x.unit)}</span>, x.perDay.toLocaleString('en-IN'), daysPill(x, d.leadDays), <b className="ti-qty">{qtyU(x.reorderQty, x.unit)}</b>, supplier(x)] },
    dead: { rows: d.dead, empty: ['check', 'No dead stock', 'Every item in stock sold at least once in the last 90 days.'], head: ['Item', 'In stock', 'Money stuck', 'Last bought'], row: (x) => [item(x), qtyU(x.stock, x.unit), <b className="ti-stuck">{money(x.value)}</b>, supplier(x)] },
    fast: { rows: d.fast, empty: ['chart', 'No sales in the last 90 days', 'Fast movers show up once Sales vouchers with items sync from Tally.'], head: ['Item', 'Sold (30 days)', 'Sold (90 days)', 'Sells a day', 'Lasts'], row: (x) => [item(x), qtyU(x.sold30, x.unit), qtyU(x.sold90, x.unit), x.perDay.toLocaleString('en-IN'), daysPill(x, d.leadDays)] },
    slow: { rows: d.slow, empty: ['check', 'No slow movers', `Nothing holds more than ${d.slowDays} days of stock at its current speed.`], head: ['Item', 'In stock', 'Sells a day', 'Lasts', 'Value'], row: (x) => [item(x), qtyU(x.stock, x.unit), x.perDay.toLocaleString('en-IN'), daysPill(x, d.leadDays), money(x.value)] },
  };
  const t = TABLES[view];
  return (
    <section className="ti" aria-label="Stock insights">
      <div className="tl-strip ti-cards" role="tablist">{cards.map(([k, label, value, sub, icon, tone]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} className={`tl-stat ti-card ${tone || ''} ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>
          <span className="tl-stat-ic"><Icon name={icon} size={14} /></span>
          <div><small>{label}</small><b>{value}</b><em>{sub}</em></div>
        </button>
      ))}</div>
      {view === 'orders' ? <PurchaseOrders po={po} lead={d.leadDays + d.safetyDays} /> : (
        <Panel pad={false} title={`${cards.find((c) => c[0] === view)[1]}${t.rows.length ? ` · ${t.rows.length.toLocaleString('en-IN')}` : ''}`} actions={<small className="muted">From sales in Tally up to {fmtDate(d.asOf)} · orders cover {d.leadDays} days’ delivery + {d.safetyDays} days’ cushion</small>}>
          {!t.rows.length ? <Empty icon={t.empty[0]} title={t.empty[1]} text={t.empty[2]} /> : (
            <div className="tbl-wrap tl-tbl ti-tbl"><table className="tbl">
              <thead><tr>{t.head.map((h, i) => <th key={h} className={i && i < t.head.length - (view === 'reorder' || view === 'dead' ? 1 : 0) ? 'r' : ''}>{h}</th>)}</tr></thead>
              <tbody>{t.rows.map((x) => <tr key={x.id} className="click" onClick={() => onOpen(x)}>{t.row(x).map((cell, i) => <td key={i} className={i && i < t.head.length - (view === 'reorder' || view === 'dead' ? 1 : 0) ? 'r' : ''}>{cell}</td>)}</tr>)}</tbody>
            </table></div>
          )}
        </Panel>
      )}
    </section>
  );
}
// one draft per supplier: the items, a ready message, Copy and Open in WhatsApp (nothing is sent from here)
function PurchaseOrders({ po, lead }) {
  if (!po) return <div className="skeleton ti-skel" />;
  if (!po.orders?.length) return <Panel><Empty icon="check" title="No purchase orders needed" text={`Nothing runs out within the next ${lead} days at the speed it’s selling.`} /></Panel>;
  const copy = (o) => navigator.clipboard?.writeText(o.message).then(() => toast(`Order for ${o.supplier || 'the supplier'} copied — paste it in WhatsApp or email`), () => toast('Couldn’t copy — select the text instead'));
  return (
    <div className="ti-pos">{po.orders.map((o) => (
      <article key={o.supplier || '-'} className="ti-po">
        <header>
          <span className="tl-av" aria-hidden="true">{o.supplier ? initials(o.supplier) : '?'}</span>
          <div><b>{o.supplier || 'No supplier on record'}</b><small className="muted">{o.items.length} {o.items.length === 1 ? 'item' : 'items'}{o.approxTotal ? ` · about ${inr(o.approxTotal)} at last rates` : ''}{o.urgent ? ` · ${o.urgent} urgent` : ''}</small></div>
        </header>
        <ul className="ti-po-items">{o.items.map((i) => <li key={i.id}><span>{i.name}{i.urgent && <em className="pill bad">urgent</em>}</span><b>{qtyU(i.qty, i.unit)}</b><small className="muted">{i.lastRate != null ? `@ ${inr(i.lastRate)}` : 'no rate yet'}</small></li>)}</ul>
        <pre className="ti-po-msg">{o.message}</pre>
        <footer>
          <button type="button" className="btn ghost sm" onClick={() => copy(o)}><Icon name="copy" size={14} /> Copy</button>
          {o.whatsapp ? <a className="btn sm ti-wa" href={o.whatsapp} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={14} /> Open in WhatsApp</a>
            : <small className="muted">{o.supplier ? 'No mobile number on this supplier’s ledger in Tally — copy the message instead.' : 'Pick a supplier for these, then copy the message.'}</small>}
        </footer>
      </article>
    ))}</div>
  );
}

// a payment reminder for one bill: WhatsApp and / or email, whichever the party has
const REMIND_SAID = { sent: 'sent', off: 'WhatsApp isn’t connected', 'no-phone': 'no phone number', 'no-email': 'no email', 'not-configured': 'email isn’t set up', 'opted-out': 'they opted out of WhatsApp', failed: 'couldn’t send' };
function RemindButton({ bill }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(bill.lastReminderAt || null);
  const go = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const r = await api(`/tally/outstandings/${bill.id}/remind`, 'POST', { channel: 'both' });
      const parts = Object.entries(r).map(([ch, st]) => `${ch === 'whatsapp' ? 'WhatsApp' : 'Email'}: ${REMIND_SAID[st] || st}`);
      toast(parts.join(' · '));
      if (Object.values(r).includes('sent')) setLast(Date.now());
    } catch (err) { toast(err.message); }
    setBusy(false);
  };
  return <button className="btn ghost sm" disabled={busy} onClick={go} title={last ? `Last reminded ${ago(last)}` : 'Send a payment reminder'}><Icon name="bell" size={14} /> {busy ? 'Sending…' : last ? 'Remind again' : 'Remind'}</button>;
}

// what the Tally add-on does around the books: customers into the CRM, payment reminders, how customers pay
function TallySettings({ onClose }) {
  const [v, setV] = useState(null);
  useEffect(() => { api('/tally/settings').then(setV).catch((e) => { toast(e.message); onClose(); }); }, []);
  if (!v) return <Modal title="Tally settings" onClose={onClose} width={560}><div className="m-body"><div className="skeleton" /></div></Modal>;
  const r = v.reminders, setR = (p) => setV({ ...v, reminders: { ...r, ...p } });
  const save = async () => { try { await api('/tally/settings', 'PUT', v); toast('Saved'); onClose(); } catch (e) { toast(e.message); } };
  return (
    <Modal title="Tally settings" onClose={onClose} width={560}>
      <div className="m-body tl-form">
        <label className="tog"><input type="checkbox" checked={v.contacts} onChange={(e) => setV({ ...v, contacts: e.target.checked })} /><span />Add customers and suppliers from Tally to my CRM <small className="muted">· ledgers in Sundry Debtors / Creditors with a phone or email</small></label>
        <label className="tog"><input type="checkbox" checked={r.on} onChange={(e) => setR({ on: e.target.checked })} /><span />Remind customers about overdue bills automatically</label>
        {r.on && <div className="form2">
          <label>Start after (days past due)<input type="number" min="0" max="90" value={r.afterDays} onChange={(e) => setR({ afterDays: e.target.value })} /></label>
          <label>Then every (days)<input type="number" min="1" max="60" value={r.everyDays} onChange={(e) => setR({ everyDays: e.target.value })} /></label>
          <label className="full">Send by<select value={r.channel} onChange={(e) => setR({ channel: e.target.value })}><option value="both">WhatsApp and email</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        </div>}
        <label>How customers pay you <small className="muted">· added to reminder emails</small><textarea rows={3} value={v.payNote} onChange={(e) => setV({ ...v, payNote: e.target.value })} placeholder={'UPI: yourname@okhdfc\nBank: HDFC Bank, A/c 50200012345678, IFSC HDFC0001234'} /></label>
        <p className="hint">WhatsApp reminders use the “Payment reminders” template — create it under Settings → WhatsApp → Create my message templates, and Meta approves it in a few minutes.</p>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
      </div>
    </Modal>
  );
}

function Activity({ rev }) {
  const [c, setC] = useState(null);
  const [runs, setRuns] = useState(null);
  useEffect(() => { api('/tally/commands').then(setC).catch(() => setC([])); api('/tally/sync-runs').then(setRuns).catch(() => setRuns([])); }, [rev]);
  const count = (st) => (c || []).filter((x) => st.includes(x.status)).length;
  const tone = (st) => ({ ok: 'ok', bad: 'bad', warn: 'warn' }[st] || 'info');
  return (
    <>
      {c && <Strip items={[['Saved in Tally', count(['SUCCESS']), 'of the last 50 changes', 'check', 'in'], ['Waiting', count(['PENDING', 'SENT']), 'for your PC', 'clock', count(['PENDING', 'SENT']) ? 'out' : ''], ['Refused', count(['FAILED', 'EXPIRED']), 'see why below', 'x', count(['FAILED', 'EXPIRED']) ? 'bad' : ''], runs && ['Last sync', runs[0] ? ago(runs[0].at) : 'never', runs[0] ? `${runs[0].status.toLowerCase()}` : 'from your PC', 'download']]} />}
      <div className="tl-two">
        <Panel title="Changes sent to Tally">
          {!c ? <div className="skeleton" /> : !c.length ? <Empty icon="send" title="Nothing sent yet" text="Vouchers, ledgers and stock items you create here — or ask Hive to — show up here as they’re saved in TallyPrime." /> : (
            <ol className="tl-tline">{c.map((x) => (
              <li key={x.id} className={tone(CSTATUS[x.status]?.[1])}>
                <div className="tl-tline-h"><b>{CNAME[x.command_type] || x.command_type}</b><span className={`pill ${CSTATUS[x.status]?.[1] || ''}`}>{CSTATUS[x.status]?.[0] || x.status}</span></div>
                <small className="muted">{x.payload?.name || x.payload?.party_name || x.payload?.stock_item_name || ''}{x.payload?.amount ? ` · ${inr(x.payload.amount)}` : ''} · {ago(x.at)}</small>
                {x.error_message && <small className="bad-t">{x.error_message}</small>}
              </li>
            ))}</ol>
          )}
        </Panel>
        <Panel title="Syncs from your PC">
          {!runs ? <div className="skeleton" /> : !runs.length ? <Empty icon="download" title="No syncs yet" text="Once the connector runs on your PC, each sync from TallyPrime is listed here." /> : (
            <ol className="tl-tline">{runs.slice(0, 30).map((r) => (
              <li key={r.id} className={r.status === 'SUCCESS' ? 'ok' : r.status === 'FAILED' ? 'bad' : 'info'}>
                <div className="tl-tline-h"><b className="tl-cap">{r.sync_type.replace(/_/g, ' ').toLowerCase()}</b><span className={`pill ${r.status === 'SUCCESS' ? 'ok' : r.status === 'FAILED' ? 'bad' : 'info'}`}>{r.status.toLowerCase()}</span></div>
                <small className="muted">{r.records_created || 0} new · {r.records_updated || 0} updated · {ago(r.at)}</small>
                {r.error_message && <small className="bad-t">{r.error_message}</small>}
              </li>
            ))}</ol>
          )}
        </Panel>
      </div>
    </>
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
          {d.items?.length > 0 && <><h4>Items</h4><div className="tbl-wrap tl-tbl"><table className="tbl"><thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th><th>Godown</th></tr></thead><tbody>{d.items.map((i) => <tr key={i.line_index}><td>{i.stock_item_name}</td><td className="r">{Math.abs(i.billed_qty ?? i.actual_qty ?? 0)}</td><td className="r">{money(i.rate)}</td><td className="r">{money(i.amount)}</td><td>{i.godown_name || '—'}</td></tr>)}</tbody></table></div></>}
          {d.lines?.length > 0 && <><h4>Accounting</h4><div className="tbl-wrap tl-tbl"><table className="tbl"><thead><tr><th>Ledger</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead><tbody>{d.lines.map((l) => <tr key={l.line_index}><td>{l.ledger_name}{l.bills?.length > 0 && <small className="sub-t">{l.bills.map((b) => `${b.bill_type || 'Bill'} ${b.bill_name}`).join(', ')}</small>}</td><td className="r">{l.debit_amount ? inr(l.debit_amount) : ''}</td><td className="r">{l.credit_amount ? inr(l.credit_amount) : ''}</td></tr>)}</tbody></table></div></>}
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
        {!d.movements?.length ? <p className="muted sm">No vouchers with this item yet.</p> : <div className="tbl-wrap tl-tbl"><table className="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th className="r">Qty</th><th>Godown</th></tr></thead><tbody>{d.movements.flatMap((v) => v.lines.map((l) => <tr key={`${v.id}${l.line_index}`} className="click" onClick={() => onOpen('vouchers', v)}><td className="nowrap">{fmtDate(v.voucher_date)}</td><td>{v.voucher_type} {v.voucher_number}</td><td>{v.party_name || '—'}</td><td className="r">{l.actual_qty ?? l.billed_qty}</td><td>{l.godown_name || '—'}</td></tr>))}</tbody></table></div>}
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
// a phone photo, made small enough to send (longest side 2000 px, JPEG)
const photoData = (file) => new Promise((resolve, reject) => {
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo we can read')); };
  img.src = url;
});

function VoucherForm({ s, onClose, onDone }) {
  const names = useNames(['ledgers', 'stock', 'godowns']);
  const [read, setRead] = useState(null); // what the bill photo gave: { reading } | the draft
  const fileRef = useRef(null);
  const [v, setV] = useState({ voucher_type: 'Sales', date: today(), party_name: '', offset_ledger: '', debit_ledger: '', credit_ledger: '', amount: '', reference_number: '', narration: '', bill_number: '', due_date: '', items: [] });
  const [busy, go] = useRun(onDone, onClose);
  const set = (p) => setV({ ...v, ...p });
  // read a bill photo into the form: party, number, dates, items (the seller checks before saving)
  const readBill = async (file) => {
    if (!file) return;
    setRead({ reading: true });
    try {
      const d = await api('/tally/invoice-read', 'POST', { image: await photoData(file), voucher_type: ['Sales', 'Purchase', 'Credit Note', 'Debit Note'].includes(v.voucher_type) ? v.voucher_type : 'Purchase' });
      setV({ ...v, voucher_type: d.voucher_type, date: d.date || v.date, party_name: d.party_name || '', reference_number: d.reference_number || '', bill_number: d.reference_number || '', due_date: d.due_date || '', narration: d.narration || '', amount: d.items.length ? '' : (d.grand_total || ''), items: d.items.filter((i) => i.quantity).map((i) => ({ stock_item_name: i.stock_item_name, quantity: i.quantity, rate: i.rate ?? '', matched: i.matched })), gst_percent: d.items.find((i) => i.tax_percent)?.tax_percent ?? '', source: 'INVOICE' });
      setRead(d);
    } catch (e) { toast(e.message); setRead(null); }
  };
  const twoLedgers = ['Journal', 'Contra'].includes(v.voucher_type);
  const withItems = ['Sales', 'Purchase'].includes(v.voucher_type);
  const gstOn = ['Sales', 'Purchase', 'Credit Note', 'Debit Note'].includes(v.voucher_type);
  const itemTotal = v.items.reduce((t, i) => t + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0);
  const taxable = withItems && v.items.length ? itemTotal : Number(v.amount) || 0;
  const gstAmt = gstOn ? Math.round(taxable * (Number(v.gst_percent) || 0)) / 100 : 0;
  const setItem = (k, p) => set({ items: v.items.map((i, j) => (j === k ? { ...i, ...p } : i)) });
  const offsetHint = { Sales: 'Sales account (e.g. Sales Account)', Purchase: 'Purchase account (e.g. Purchase Account)', Receipt: 'Cash or bank it came into', Payment: 'Cash or bank it was paid from', 'Credit Note': 'Sales account', 'Debit Note': 'Purchase account' }[v.voucher_type];
  const submit = () => {
    const items = v.items.filter((i) => i.stock_item_name && Number(i.quantity) > 0).map(({ matched, ...i }) => ({ ...i, quantity: Number(i.quantity), rate: Number(i.rate) || 0 }));
    const p = { voucher_type: v.voucher_type, date: v.date, narration: v.narration || undefined, reference_number: v.reference_number || undefined, ...(v.source ? { voucher_source: v.source } : {}) };
    if (twoLedgers) Object.assign(p, { debit_ledger: v.debit_ledger, credit_ledger: v.credit_ledger, amount: Number(v.amount) });
    else Object.assign(p, { party_name: v.party_name, offset_ledger: v.offset_ledger || undefined, ...(items.length ? { items } : { amount: Number(v.amount) }), ...(v.bill_number ? { bill_number: v.bill_number, bill_type: ['Receipt', 'Payment', 'Credit Note', 'Debit Note'].includes(v.voucher_type) ? 'Agst Ref' : 'New Ref' } : {}), ...(v.due_date ? { due_date: v.due_date } : {}), ...(gstOn && Number(v.gst_percent) > 0 ? { gst_percent: Number(v.gst_percent), interstate: !!v.interstate } : {}) });
    go(v.voucher_type === 'Receipt' ? 'CREATE_RECEIPT' : v.voucher_type === 'Payment' ? 'CREATE_PAYMENT' : 'CREATE_VOUCHER', p, `${v.voucher_type} voucher`);
  };
  return (
    <FormModal title="New voucher" onClose={onClose} busy={busy} onSubmit={submit}>
      <Datalist id="tl-ledgers" items={names.ledgers} /><Datalist id="tl-stock" items={names.stock} /><Datalist id="tl-godowns" items={names.godowns} />
      <div className="tl-read">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => readBill(e.target.files?.[0])} />
        <button type="button" className="btn ghost sm" disabled={read?.reading} onClick={() => fileRef.current?.click()}><Icon name="image" size={14} /> {read?.reading ? 'Reading the bill…' : 'Read a bill photo'}</button>
        {read && !read.reading && <small className="muted">Read from the photo — check everything before saving.{!read.party_matched && read.party_read ? ` “${read.party_read}” isn’t a ledger in Tally yet: pick one or create it first.` : ''}{read.items.some((i) => !i.matched) ? ' Some items aren’t stock items in Tally yet.' : ''}{read.tax_total ? ` Tax on the bill: ₹${read.tax_total.toLocaleString('en-IN')} — check the GST rate below.` : ''}</small>}
        {read?.duplicateOf && <small className="bad-t">This bill looks entered already: {read.duplicateOf.voucher_type} {read.duplicateOf.voucher_number || ''} on {read.duplicateOf.voucher_date}.</small>}
      </div>
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
            <input list="tl-stock" value={i.stock_item_name} onChange={(e) => setItem(k, { stock_item_name: e.target.value, matched: true })} placeholder="Item" aria-label="Item" className={i.matched === false ? 'tl-unmatched' : ''} title={i.matched === false ? 'Not a stock item in Tally yet' : undefined} />
            <input type="number" min="0" step="any" value={i.quantity} onChange={(e) => setItem(k, { quantity: e.target.value })} placeholder="Qty" aria-label="Quantity" />
            <input type="number" min="0" step="any" value={i.rate} onChange={(e) => setItem(k, { rate: e.target.value })} placeholder="Rate" aria-label="Rate" />
            <input list="tl-godowns" value={i.godown_name || ''} onChange={(e) => setItem(k, { godown_name: e.target.value })} placeholder="Godown" aria-label="Godown" />
            <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => set({ items: v.items.filter((_, j) => j !== k) })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <div className="row"><button type="button" className="btn ghost sm" onClick={() => set({ items: [...v.items, { stock_item_name: '', quantity: '', rate: '' }] })}><Icon name="plus" size={14} /> Add item</button>{v.items.length > 0 && <b>{inr(itemTotal)}</b>}</div>
      </div>}
      <div className="form2">
        {!(withItems && v.items.length) && <label>{gstOn ? 'Amount before GST (₹)' : 'Amount (₹)'}<input type="number" min="0" step="any" value={v.amount} onChange={(e) => set({ amount: e.target.value })} required /></label>}
        {!twoLedgers && <label>Bill number <small className="muted">· optional{['Receipt', 'Payment'].includes(v.voucher_type) ? ' — the bill this settles' : ''}</small><input value={v.bill_number} onChange={(e) => set({ bill_number: e.target.value })} /></label>}
        {['Sales', 'Purchase'].includes(v.voucher_type) && v.bill_number && <label>Due date<input type="date" value={v.due_date} onChange={(e) => set({ due_date: e.target.value })} /></label>}
        {gstOn && <>
          <label>GST<select value={v.gst_percent ?? ''} onChange={(e) => set({ gst_percent: e.target.value })}>
            <option value="">No GST</option>{[0.25, 3, 5, 12, 18, 28, 40].map((r) => <option key={r} value={r}>{r}%</option>)}
          </select></label>
          {Number(v.gst_percent) > 0 && <label className="tog"><input type="checkbox" checked={!!v.interstate} onChange={(e) => set({ interstate: e.target.checked })} /><span />Other state — IGST <small className="muted">· otherwise CGST + SGST</small></label>}
        </>}
        <label className="full">Narration <small className="muted">· optional</small><input value={v.narration} onChange={(e) => set({ narration: e.target.value })} /></label>
      </div>
      {gstAmt > 0 && <p className="tl-gst">{inr(taxable)} + {v.interstate ? 'IGST' : 'CGST + SGST'} {inr(gstAmt)} = <b>{inr(taxable + gstAmt)}</b></p>}
      {gstOn && Number(v.gst_percent) > 0 && <p className="hint">Posted to your {v.voucher_type === 'Purchase' || v.voucher_type === 'Credit Note' ? 'Input' : 'Output'} {v.interstate ? 'IGST' : 'CGST and SGST'} ledgers under Duties &amp; Taxes in Tally.</p>}
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
