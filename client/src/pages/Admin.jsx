import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, impersonate } from '../api';
import { Layout, Panel, Icon, Modal, inr, num, ago, toast, downloadCSV } from '../ui';
import { AreaChart } from '../charts';

const TABS = [['overview', 'Overview'], ['sellers', 'Sellers'], ['invoices', 'Invoices'], ['settings', 'Plan & settings'], ['audit', 'Audit log']];
const STATUS = { trialing: ['Trial', 'warn'], active: ['Paying', 'ok'], past_due: ['Payment issue', 'bad'], cancelled: ['Cancelled', ''], expired: ['Expired', 'bad'], comped: ['Comped', 'ok'], suspended: ['Suspended', 'bad'], admin: ['Admin', ''] };
const Pill = ({ s }) => <span className={`pill ${STATUS[s]?.[1] || ''}`}>{STATUS[s]?.[0] || s}</span>;
const mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);

export default function Admin() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  return (
    <Layout title="Admin" subtitle="Your platform: revenue, sellers and settings." wide actions={<div className="seg">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setSp({ tab: k })}>{l}</button>)}</div>}>
      {tab === 'overview' && <Overview />}
      {tab === 'sellers' && <Sellers />}
      {tab === 'invoices' && <Invoices />}
      {tab === 'settings' && <PlatformSettings />}
      {tab === 'audit' && <Audit />}
    </Layout>
  );
}

function Kpi({ label, value, sub, warn }) {
  return <div className={`kpi ${warn ? 'warn' : ''}`}><span className="kpi-l">{label}</span><span className="kpi-v">{value}</span>{sub && <small>{sub}</small>}</div>;
}

function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/admin/overview').then(setD); }, []);
  if (!d) return <div className="skeleton" />;
  const s = d.system, p = d.platform;
  return (
    <div className="admin-grid">
      {(!s.paymentsReady || !s.emailReady) && (
        <div className="setup-warn">
          <Icon name="bolt" size={16} />
          <div>{!s.paymentsReady && <p><b>Subscriptions can’t be paid yet.</b> Add your Razorpay keys in <Link to="/admin?tab=settings">Plan & settings</Link>.</p>}
            {!s.emailReady && <p><b>Emails aren’t being sent.</b> Set SMTP_HOST / SMTP_USER / SMTP_PASS (or RESEND_API_KEY) in server/.env for sign-up, reset and billing emails.</p>}</div>
        </div>
      )}
      <div className="kpis">
        <Kpi label="MRR" value={inr(d.mrr)} sub={`ARR ${inr(d.arr)}`} />
        <Kpi label="Paying sellers" value={num(d.paying.monthly + d.paying.yearly)} sub={`${d.paying.monthly} monthly · ${d.paying.yearly} yearly`} />
        <Kpi label="On free trial" value={num(d.by.trialing || 0)} sub={d.trialConversion != null ? `${d.trialConversion}% of ended trials converted` : 'No trials ended yet'} />
        <Kpi label="Revenue (30 days)" value={inr(d.revenue30)} sub="from invoices" />
        <Kpi label="New sellers" value={num(d.signups30)} sub={`${d.signups7} in the last 7 days`} />
        <Kpi label="Need attention" value={num((d.by.past_due || 0) + (d.by.expired || 0))} sub={`${d.by.past_due || 0} payment issues · ${d.by.expired || 0} expired`} warn={(d.by.past_due || 0) > 0} />
      </div>
      <div className="grid-2-1">
        <Panel title="Sign-ups per day (30 days)"><AreaChart data={d.signups} yKey="n" label="Sign-ups" height={220} /></Panel>
        <Panel title="Sellers by status">
          <div className="status-list">{Object.entries(d.by).filter(([, n]) => n).map(([k, n]) => <div key={k}><Pill s={k} /><b>{num(n)}</b></div>)}<div className="tot"><span>Total</span><b>{num(d.sellers)}</b></div></div>
        </Panel>
      </div>
      <div className="grid-2-1">
        <Panel title="Revenue by month" pad={false}>
          {d.revenueMonths.length ? <table className="tbl compact"><thead><tr><th>Month</th><th className="r">Invoices</th><th className="r">Revenue</th></tr></thead><tbody>{d.revenueMonths.slice().reverse().map((m) => <tr key={m.m}><td>{m.m}</td><td className="r">{m.n}</td><td className="r strong">{inr(m.total)}</td></tr>)}</tbody></table> : <p className="muted sm" style={{ padding: 18 }}>No subscription revenue yet.</p>}
        </Panel>
        <Panel title="Platform activity (30 days)">
          <div className="status-list">
            <div><span>Funnels</span><b>{num(p.funnels)} <small className="muted">({num(p.live)} live)</small></b></div>
            <div><span>Page views</span><b>{num(p.views30)}</b></div>
            <div><span>Leads captured</span><b>{num(p.leads30)}</b></div>
            <div><span>Seller orders</span><b>{num(p.orders30.v)} · {inr(p.orders30.gmv)}</b></div>
            <div><span>Active automations</span><b>{num(p.automations)}</b></div>
            <div><span>AI credits used (month)</span><b>{num(p.aiCredits)}</b></div>
          </div>
        </Panel>
      </div>
      <Panel title="Server health" actions={<button className="btn ghost sm" onClick={async () => { const r = await api('/admin/backup', 'POST'); toast(r.ok ? 'Backup saved' : 'Backup already running'); }}><Icon name="download" size={14} /> Back up now</button>}>
        <div className="status-list cols">
          <div><span>Uptime</span><b>{Math.floor(s.uptimeSec / 3600)}h {Math.floor((s.uptimeSec % 3600) / 60)}m</b></div>
          <div><span>App processes</span><b>{s.processes}</b></div>
          <div><span>Database</span><b>{mb(s.dbBytes)}</b></div>
          <div><span>Memory (this process)</span><b>{s.memoryMb} MB</b></div>
          <div><span>Load average</span><b>{s.loadavg.join(' · ')}</b></div>
          <div><span>Payments</span><b>{s.paymentsReady ? `Razorpay (${s.paymentsMode})` : 'Not set up'}</b></div>
          <div><span>Email</span><b>{s.emailReady ? 'Configured' : 'Not set up'}</b></div>
          <div><span>Latest backup</span><b>{s.backups[0] ? `${s.backups[0].name.replace(/^funnelhive-|\.db$/g, '')} · ${mb(s.backups[0].bytes)}` : 'None yet'}</b></div>
        </div>
      </Panel>
    </div>
  );
}

function Sellers() {
  const [qs, setQs] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => api(`/admin/users?q=${encodeURIComponent(qs)}&status=${status}&page=${page}`).then(setD);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [qs, status, page]);
  return (
    <Panel title={d ? `${num(d.total)} sellers` : 'Sellers'} pad={false} actions={<>
      <div className="search"><Icon name="search" size={15} /><input placeholder="Search name, email, business…" value={qs} onChange={(e) => { setQs(e.target.value); setPage(0); }} /></div>
      <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} style={{ width: 160 }}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
    </>}>
      {!d ? <div className="skeleton" /> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Seller</th><th>Status</th><th>Plan / trial</th><th className="r">Funnels</th><th>Joined</th><th>Last seen</th></tr></thead>
          <tbody>{d.users.map((u) => (
            <tr key={u.id} className="click" onClick={() => setOpen(u.id)}>
              <td><div className="who"><span className="who-av">{(u.name || '?')[0].toUpperCase()}</span><div><b>{u.name}</b>{u.admin && <span className="pill" style={{ marginLeft: 6 }}>admin</span>}<span className="sub-t">{u.email}{u.business ? ` · ${u.business}` : ''}</span></div></div></td>
              <td><Pill s={u.status} /></td>
              <td className="muted sm">{u.admin ? '—' : u.planStatus === 'trialing' ? `trial ends ${fmtDate(u.trialEndsAt)}` : u.interval ? `${u.interval} · ${fmtDate(u.currentPeriodEnd)}` : '—'}</td>
              <td className="r">{u.funnels}</td><td className="muted sm">{fmtDate(u.createdAt)}</td><td className="muted sm">{u.lastSeenAt ? ago(u.lastSeenAt) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {d.total > d.size && <div className="row end pager"><button className="btn ghost sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span className="muted sm">Page {page + 1} of {Math.ceil(d.total / d.size)}</span><button className="btn ghost sm" disabled={(page + 1) * d.size >= d.total} onClick={() => setPage(page + 1)}>Next</button></div>}
        </div>
      )}
      {open && <SellerModal id={open} onClose={() => setOpen(null)} onChange={load} />}
    </Panel>
  );
}

function SellerModal({ id, onClose, onChange }) {
  const [u, setU] = useState(null);
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState('');
  const load = () => api(`/admin/users/${id}`).then((x) => { setU(x); setLimit(x.creditLimit ?? ''); });
  useEffect(() => { load(); }, [id]);
  const act = async (action, extra = {}, msg) => {
    try {
      const r = await api(`/admin/users/${id}/action`, 'POST', { action, ...extra });
      if (r.token) return impersonate(r.token);
      if (r.deleted) { toast('Seller deleted'); onChange(); return onClose(); }
      toast(msg || 'Done'); load(); onChange();
    } catch (e) { toast(e.message); }
  };
  if (!u) return <Modal title="Seller" onClose={onClose}><div className="skeleton" /></Modal>;
  const c = u.counts;
  return (
    <Modal title={u.name} onClose={onClose} width={860}>
      <div className="seller-m">
        <div className="seller-top">
          <div><div className="row"><Pill s={u.access.status} />{u.admin && <span className="pill">admin</span>}{!u.emailVerified && <span className="pill warn">email not verified</span>}{u.twoFactor && <span className="pill ok">2-step on</span>}</div>
            <p className="muted sm">{u.email} · joined {fmtDate(u.createdAt)} · last seen {u.lastSeenAt ? ago(u.lastSeenAt) : 'never'}{u.settings.businessName ? ` · ${u.settings.businessName}` : ''}</p>
            <p className="sm">{u.billing?.status === 'trialing' ? `Trial ends ${fmtDate(u.billing.trialEndsAt)}` : u.billing?.interval ? `${u.billing.interval} plan · period ends ${fmtDate(u.billing.currentPeriodEnd)}${u.billing.cancelAtPeriodEnd ? ' · cancelled' : ''}` : ''}{u.billing?.subscriptionId && <span className="mono"> · {u.billing.subscriptionId}</span>}</p></div>
          <button className="btn primary sm" onClick={() => act('impersonate')}><Icon name="eye" size={14} /> Log in as seller</button>
        </div>
        <div className="mini-stats">
          {[['Funnels', `${c.funnels} (${c.published} live)`], ['Contacts', num(c.contacts)], ['Leads', num(c.leads)], ['Automations', c.automations], ['Domains', c.domains], ['Views 30d', num(c.views30)], ['Orders 30d', `${c.orders30.n} · ${inr(c.orders30.gmv)}`], ['AI credits', `${num(u.credits.used)} / ${u.credits.limit == null ? '∞' : num(u.credits.limit)}`]].map(([l, v]) => <div key={l}><small>{l}</small><b>{v}</b></div>)}
        </div>
        <div className="seller-actions">
          <div className="row"><input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} /><button className="btn ghost sm" onClick={() => act('extend_trial', { days }, `Trial extended by ${days} days`)}>Extend trial</button></div>
          <div className="row"><input type="number" min="0" placeholder="Plan default" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} /><button className="btn ghost sm" onClick={() => act('set_credits', { limit }, 'AI credit limit saved')}>Set AI credits</button></div>
          <div className="row">
            {u.access.status === 'comped' ? <button className="btn ghost sm" onClick={() => act('uncomp')}>End free access</button> : <button className="btn ghost sm" onClick={() => { const note = prompt('Reason for free access (e.g. partner, beta tester)?', ''); if (note !== null) act('comp', { note }, 'Free access granted'); }}>Give free access</button>}
            {u.access.status === 'suspended' ? <button className="btn ghost sm" onClick={() => act('unsuspend')}>Unsuspend</button> : <button className="btn ghost sm danger" onClick={() => { const note = prompt('Reason for suspending (pages go offline and the seller is signed out)?', ''); if (note !== null) act('suspend', { note }, 'Seller suspended'); }}>Suspend</button>}
            {!u.emailVerified && <button className="btn ghost sm" onClick={() => act('verify_email')}>Mark email verified</button>}
            {u.twoFactor && <button className="btn ghost sm" onClick={() => confirm('Turn off 2-step verification for this seller?') && act('reset_2fa')}>Reset 2-step</button>}
            <button className="btn ghost sm" onClick={() => act('sign_out', {}, 'Signed out everywhere')}>Sign out everywhere</button>
            {u.admin ? <button className="btn ghost sm" onClick={() => confirm('Remove admin access?') && act('remove_admin')}>Remove admin</button> : <button className="btn ghost sm" onClick={() => confirm(`Make ${u.email} a platform admin? They will see all sellers and revenue.`) && act('make_admin')}>Make admin</button>}
            <button className="btn ghost sm danger" onClick={() => { const e = prompt(`This permanently deletes the seller and all their data (invoices are kept). Type their email to confirm:`); if (e) act('delete', { confirm: e }); }}><Icon name="trash" size={14} /> Delete</button>
          </div>
        </div>
        <div className="grid-1-1">
          <div><h4>Funnels</h4>{u.funnels.length ? u.funnels.map((f) => <div key={f.id} className="li"><span>{f.name}</span>{f.published ? <a className="pill ok" href={`/f/${f.slug}`} target="_blank" rel="noreferrer">live</a> : <span className="pill">draft</span>}</div>) : <p className="muted sm">None yet</p>}</div>
          <div><h4>Invoices</h4>{u.invoices.length ? u.invoices.map((i) => <div key={i.id} className="li"><Link to={`/admin/invoices/${i.id}`} className="mono">{i.number}</Link><span>{inr(i.total)} · {fmtDate(i.at)}</span></div>) : <p className="muted sm">None yet</p>}
            <h4 style={{ marginTop: 14 }}>Admin history</h4>{u.audit.length ? u.audit.map((a) => <div key={a.id} className="li"><span>{a.action.replace(/_/g, ' ')}{a.detail ? ` — ${a.detail}` : ''}</span><span className="muted sm">{a.actor} · {ago(a.at)}</span></div>) : <p className="muted sm">No changes</p>}</div>
        </div>
      </div>
    </Modal>
  );
}

function Invoices() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/admin/invoices').then(setList); }, []);
  if (!list) return <div className="skeleton" />;
  const csv = () => downloadCSV('invoices.csv', list.map((i) => ({ number: i.number, date: new Date(i.at).toISOString().slice(0, 10), customer: i.billedTo?.name, email: i.billedTo?.email, gstin: i.billedTo?.gstin, state: i.billedTo?.state, plan: i.interval, taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst, total: i.total, payment: i.paymentId })));
  return (
    <Panel title={`${list.length} invoices · ${inr(list.reduce((a, i) => a + i.total, 0))}`} pad={false} actions={<button className="btn ghost sm" onClick={csv} disabled={!list.length}><Icon name="download" size={14} /> Export CSV (for GST filing)</button>}>
      {list.length ? <div className="tbl-wrap"><table className="tbl compact">
        <thead><tr><th>Invoice</th><th>Date</th><th>Billed to</th><th>GSTIN</th><th className="r">Taxable</th><th className="r">GST</th><th className="r">Total</th></tr></thead>
        <tbody>{list.map((i) => <tr key={i.id}><td><Link className="mono strong" to={`/admin/invoices/${i.id}`}>{i.number}</Link></td><td>{fmtDate(i.at)}</td><td>{i.billedTo?.name}<span className="sub-t">{i.billedTo?.email}{i.userDeleted ? ' · account deleted' : ''}</span></td><td className="mono">{i.billedTo?.gstin || '—'}</td><td className="r">{inr(i.taxable)}</td><td className="r">{inr(i.cgst + i.sgst + i.igst)}</td><td className="r strong">{inr(i.total)}</td></tr>)}</tbody>
      </table></div> : <p className="muted sm" style={{ padding: 18 }}>Invoices appear here as sellers pay.</p>}
    </Panel>
  );
}

function PlatformSettings() {
  const [s, setS] = useState(null);
  const [rz, setRz] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
  useEffect(() => { api('/admin/settings').then((x) => { setS(x); setRz({ keyId: x.razorpay.keyId.includes('(') ? '' : x.razorpay.keyId, keySecret: '', webhookSecret: '' }); }); }, []);
  if (!s) return <div className="skeleton" />;
  const set = (patch) => setS({ ...s, ...patch });
  const save = async (body) => { try { const x = await api('/admin/settings', 'PUT', body); setS(x); toast('Saved'); return x; } catch (e) { toast(e.message); return null; } };
  const hookUrl = `${location.origin}${s.razorpay.webhookPath}`;
  return (
    <div className="settings">
      <Panel title="Plan & pricing">
        <div className="form2">
          <label>Monthly price (₹)<input type="number" min="1" value={s.plans.monthly.amount} onChange={(e) => set({ plans: { ...s.plans, monthly: { amount: e.target.value } } })} /></label>
          <label>Yearly price (₹)<input type="number" min="1" value={s.plans.yearly.amount} onChange={(e) => set({ plans: { ...s.plans, yearly: { amount: e.target.value } } })} /></label>
          <label>Free trial (days)<input type="number" min="0" max="365" value={s.trialDays} onChange={(e) => set({ trialDays: e.target.value })} /></label>
          <label>GST rate (%)<input type="number" min="0" max="28" value={s.gstRate} onChange={(e) => set({ gstRate: e.target.value })} /></label>
          <label>AI credits / month — trial<input type="number" min="0" value={s.aiCredits.trial} onChange={(e) => set({ aiCredits: { ...s.aiCredits, trial: e.target.value } })} /></label>
          <label>AI credits / month — paid<input type="number" min="0" value={s.aiCredits.paid} onChange={(e) => set({ aiCredits: { ...s.aiCredits, paid: e.target.value } })} /></label>
          <label>Grace days after a failed renewal<input type="number" min="0" max="60" value={s.graceDays} onChange={(e) => set({ graceDays: e.target.value })} /></label>
          <label>Pages stay live after lock (days)<input type="number" min="0" max="365" value={s.pagesOfflineAfterDays} onChange={(e) => set({ pagesOfflineAfterDays: e.target.value })} /></label>
        </div>
        <label className="tog"><input type="checkbox" checked={s.pricesIncludeGst} onChange={(e) => set({ pricesIncludeGst: e.target.checked })} /><span />Prices include GST</label>
        <p className="hint">Sellers pay {inr(s.prices.monthly.amount)}/month or {inr(s.prices.yearly.amount)}/year. Changing a price applies to new subscriptions; existing subscribers keep theirs.</p>
        <button className="btn primary" onClick={() => save({ plans: s.plans, trialDays: s.trialDays, gstRate: s.gstRate, aiCredits: s.aiCredits, graceDays: s.graceDays, pagesOfflineAfterDays: s.pagesOfflineAfterDays, pricesIncludeGst: s.pricesIncludeGst })}>Save pricing</button>
      </Panel>

      <Panel title="Razorpay (collects subscriptions)">
        <p className="muted sm">Your own Razorpay account. Sellers connect theirs separately for their customers’ payments.</p>
        <div className={`ai-card ${s.razorpay.ready ? 'on' : ''}`}><Icon name="wallet" size={20} /><div><b>{s.razorpay.ready ? `Connected · ${s.razorpay.mode} mode` : 'Not connected'}</b><p className="muted sm">{s.razorpay.ready ? s.razorpay.keyId : 'Razorpay → Account & Settings → API keys'}</p></div></div>
        <label>Key ID<input value={rz.keyId} onChange={(e) => setRz({ ...rz, keyId: e.target.value.trim() })} placeholder="rzp_live_…" /></label>
        <label>Key Secret {s.razorpay.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={rz.keySecret} onChange={(e) => setRz({ ...rz, keySecret: e.target.value })} /></label>
        <label>Webhook secret {s.razorpay.hasWebhookSecret && <small className="muted">· saved</small>}<input type="password" value={rz.webhookSecret} onChange={(e) => setRz({ ...rz, webhookSecret: e.target.value })} /></label>
        <p className="hint">In Razorpay → Webhooks add <code>{hookUrl}</code> with the events <code>subscription.authenticated</code>, <code>subscription.activated</code>, <code>subscription.charged</code>, <code>subscription.pending</code>, <code>subscription.halted</code>, <code>subscription.cancelled</code>, <code>subscription.completed</code>, and paste the same secret here. Enable Subscriptions on your Razorpay account first.</p>
        <button className="btn primary" onClick={async () => { const body = { keyId: rz.keyId, ...(rz.keySecret ? { keySecret: rz.keySecret } : {}), ...(rz.webhookSecret ? { webhookSecret: rz.webhookSecret } : {}) }; if (await save({ razorpay: body })) setRz({ ...rz, keySecret: '', webhookSecret: '' }); }}>Save Razorpay keys</button>
      </Panel>

      <Panel title="Company details (on GST invoices)">
        <div className="form2">
          <label>Legal name<input value={s.company.name} onChange={(e) => set({ company: { ...s.company, name: e.target.value } })} placeholder="Hive Labs Pvt Ltd" /></label>
          <label><span>GSTIN <small className="muted">· leave empty if not registered</small></span><input value={s.company.gstin} onChange={(e) => set({ company: { ...s.company, gstin: e.target.value.toUpperCase() } })} maxLength={15} /></label>
          <label>State<select value={s.company.state} onChange={(e) => set({ company: { ...s.company, state: e.target.value } })}><option value="">Choose…</option>{s.states.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Invoice number prefix<input value={s.company.invoicePrefix} onChange={(e) => set({ company: { ...s.company, invoicePrefix: e.target.value } })} /></label>
          <label>Billing email<input value={s.company.email} onChange={(e) => set({ company: { ...s.company, email: e.target.value } })} placeholder="billing@yourbrand.in" /></label>
          <label>Address<input value={s.company.address} onChange={(e) => set({ company: { ...s.company, address: e.target.value } })} /></label>
        </div>
        <button className="btn primary" onClick={() => save({ company: s.company })}>Save company details</button>
      </Panel>

      <Panel title="Brand & sign-ups">
        <label>Product name<input value={s.brand} onChange={(e) => set({ brand: e.target.value })} /></label>
        <label className="tog"><input type="checkbox" checked={s.signupsOpen} onChange={(e) => set({ signupsOpen: e.target.checked })} /><span />New sign-ups open</label>
        <label><span>Announcement banner <small className="muted">· shown to every seller, e.g. planned maintenance</small></span><input value={s.announcement} onChange={(e) => set({ announcement: e.target.value })} placeholder="Leave empty for none" /></label>
        <label><span>Google sign-in client ID <small className="muted">· shows “Continue with Google” on sign-up and login</small></span><input value={s.googleClientId || ''} onChange={(e) => set({ googleClientId: e.target.value.trim() })} placeholder="1234567890-abc….apps.googleusercontent.com" /></label>
        <p className="hint">Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add <code>{location.origin}</code> under Authorised JavaScript origins.</p>
        <button className="btn primary" onClick={() => save({ brand: s.brand, signupsOpen: s.signupsOpen, announcement: s.announcement, googleClientId: s.googleClientId || '' })}>Save</button>
      </Panel>
    </div>
  );
}

function Audit() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/admin/audit').then(setList); }, []);
  if (!list) return <div className="skeleton" />;
  return (
    <Panel title="Every change made by an admin" pad={false}>
      {list.length ? <table className="tbl compact"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Seller</th><th>Detail</th></tr></thead>
        <tbody>{list.map((a) => <tr key={a.id}><td className="muted sm">{fmtDate(a.at)} · {new Date(a.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td>{a.actor}</td><td className="strong">{a.action.replace(/_/g, ' ')}</td><td className="mono">{a.userId || '—'}</td><td className="muted sm">{a.detail}</td></tr>)}</tbody></table>
        : <p className="muted sm" style={{ padding: 18 }}>Nothing yet.</p>}
    </Panel>
  );
}
