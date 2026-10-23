import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate, impersonate } from '../api';
import { Layout, Panel, Icon, Modal, inr, num, ago, toast, downloadCSV, confirmDialog, promptDialog, loadFailed } from '../ui';
import { AreaChart } from '../charts';

const TABS = [['overview', 'Overview'], ['sellers', 'Sellers'], ['invoices', 'Invoices'], ['settings', 'Plan & settings'], ['audit', 'Audit log']];
const STATUS = { trialing: ['Trial', 'warn'], active: ['Paying', 'ok'], past_due: ['Payment issue', 'bad'], cancelled: ['Cancelled', ''], expired: ['Expired', 'bad'], comped: ['Comped', 'ok'], suspended: ['Suspended', 'bad'], admin: ['Admin', ''] };
const Pill = ({ s }) => <span className={`pill ${STATUS[s]?.[1] || ''}`}>{STATUS[s]?.[0] || s}</span>;
const mb = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);

export default function Admin() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  // the admin panel needs 2-step login on (the server refuses it otherwise)
  const [tfa, setTfa] = useState(null);
  useEffect(() => { api('/me').then((m) => setTfa(!!m.twoFactor)).catch(() => setTfa(true)); }, []);
  if (tfa === false) return (
    <Layout title="Admin" subtitle="Your platform: revenue, sellers and settings.">
      <Panel title="Two-factor authentication needed"><p>Turn on two-factor authentication to use the admin panel.</p><Link className="btn primary" to="/settings#security">Open Settings → Security</Link></Panel>
    </Layout>
  );
  if (tfa == null) return <Layout title="Admin"><div className="skeleton" /></Layout>;
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
  useEffect(() => { api('/admin/overview').then(setD).catch(loadFailed); }, []);
  if (!d) return <div className="skeleton" />;
  const s = d.system, p = d.platform;
  return (
    <div className="admin-grid">
      {(!s.paymentsReady || !s.emailReady) && (
        <div className="setup-warn">
          <Icon name="bolt" size={16} />
          <div>{!s.paymentsReady && <p><b>Subscriptions can’t be paid yet.</b> Add your Razorpay keys (India) and / or Stripe keys (other countries) in <Link to="/admin?tab=settings">Plan & settings</Link>.</p>}
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
          <div><span>Payments</span><b>{s.payments?.length ? s.payments.join(' · ') : 'Not set up'}</b></div>
          <div><span>Email</span><b>{s.emailReady ? 'Configured' : 'Not set up'}</b></div>
          <div><span>Latest backup</span><b>{s.backups[0] ? `${s.backups[0].name.replace(/^funnelhive-|\.db$/g, '')} · ${mb(s.backups[0].bytes)}` : 'None yet'}</b></div>
        </div>
      </Panel>
      <Restore />
    </div>
  );
}

// Restore the whole database from a backup (on this server or off-site). Checked before it's used; the
// database it replaces is kept, so a restore can itself be undone.
function Restore() {
  const [b, setB] = useState(null);
  const [pick, setPick] = useState(null);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api('/admin/backups').then(setB).catch((e) => setB({ error: e.message }));
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/restore', 'POST', { ...pick, confirm: word });
      toast(r.restarting ? 'Restoring — the app restarts in a few seconds' : 'Staged — restart the server to finish the restore');
      setPick(null);
      if (r.restarting) setTimeout(() => location.reload(), 15000);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const day = (n) => n.replace(/^(funnelhive|before-restore)-|\.db$/g, '');
  const row = (from, name, label, size) => <div key={`${from}${name}`} className="rs-row"><span><b>{label}</b>{size && <small className="muted"> · {size}</small>}</span><button className="btn ghost sm" onClick={() => { setPick({ from, name }); setWord(''); }}>Restore…</button></div>;
  return (
    <Panel title="Backups & restore" actions={!b && <button className="btn ghost sm" onClick={load}>Show backups</button>}>
      {!b ? <p className="muted sm">A backup is taken every 6 hours (one file per day). The last 7 days stay on this server; with file storage connected, 90 days are kept off-site.</p> : b.error ? <p className="err">{b.error}</p> : (
        <div className="rs">
          <div><h4>Off-site ({Array.isArray(b.bucket) ? b.bucket.length : 0})</h4>{Array.isArray(b.bucket) ? (b.bucket.length ? b.bucket.slice(0, 30).map((n) => row('bucket', n, day(n))) : <p className="muted sm">None yet — connect File storage in Plan & settings.</p>) : <p className="err">{b.bucket.error}</p>}</div>
          <div><h4>On this server ({b.local.length})</h4>{b.local.map((f) => row('local', f.name, day(f.name), mb(f.bytes)))}</div>
          {b.safety.length > 0 && <div><h4>Before earlier restores</h4>{b.safety.map((n) => row('safety', n, day(n)))}</div>}
        </div>
      )}
      {pick && (
        <Modal title={`Restore the backup from ${day(pick.name)}?`} onClose={() => setPick(null)} width={500}>
          <div className="m-body">
            <p>Everything — every account, funnel, order and contact — goes back to how it was in this backup. Anything that happened after it is replaced.</p>
            <p className="muted sm">Today’s data is backed up first, and the current database is kept under “Before earlier restores”, so you can undo this. The app restarts and is offline for a few seconds.</p>
            <label className="fld"><span>Type RESTORE to confirm</span><input value={word} onChange={(e) => setWord(e.target.value)} autoFocus /></label>
            <div className="m-foot"><button className="btn ghost" onClick={() => setPick(null)}>Cancel</button><button className="btn danger" disabled={word !== 'RESTORE' || busy} onClick={go}>{busy ? 'Checking the backup…' : 'Restore'}</button></div>
          </div>
        </Modal>
      )}
    </Panel>
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
  const [lim, setLim] = useState({ funnels: '', storageMB: '', agencyClients: '' });
  const load = () => api(`/admin/users/${id}`).then((x) => { setU(x); setLimit(x.creditLimit ?? ''); setLim({ funnels: x.limitOverrides?.funnels ?? '', storageMB: x.limitOverrides?.storageMB ?? '', agencyClients: x.limitOverrides?.agencyClients ?? '' }); });
  useEffect(() => { load(); }, [id]);
  const act = async (action, extra = {}, msg) => {
    try {
      const r = await api(`/admin/users/${id}/action`, 'POST', { action, ...extra });
      if (r.token) return impersonate(r.token);
      if (r.deleted) { toast('Seller deleted'); onChange(); return onClose(); }
      toast(msg || 'Done'); load(); onChange();
    } catch (e) { toast(e.message); }
  };
  // a one-time link (valid 1 hour) to send the seller yourself — how to help while email isn't set up
  const resetLink = async () => {
    try { const r = await api(`/admin/users/${id}/reset-link`, 'POST'); await navigator.clipboard?.writeText(r.link).catch(() => {}); load(); await promptDialog({ title: 'Password-reset link', text: 'Copied; valid for 1 hour, works once. Send it to the seller yourself:', value: r.link, readOnly: true, confirm: 'Done', cancel: null }); } catch (e) { toast(e.message); }
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
          <button className="btn primary sm" onClick={async () => { const reason = await promptDialog({ title: 'Log in as seller', text: 'Why are you opening this account? (The seller is told, and it’s kept in the audit log.)', label: 'Reason', confirm: 'Log in' }); if (reason?.trim()) act('impersonate', { reason }); }}><Icon name="eye" size={14} /> Log in as seller</button>
        </div>
        <div className="mini-stats">
          {[['Funnels', `${c.funnels} (${c.published} live)`], ['Contacts', num(c.contacts)], ['Leads', num(c.leads)], ['Automations', c.automations], ['Domains', c.domains], ['Views 30d', num(c.views30)], ['Orders 30d', `${c.orders30.n} · ${inr(c.orders30.gmv)}`], ['AI credits', `${num(u.credits.used)} / ${u.credits.limit == null ? '∞' : num(u.credits.limit)}`], ['Funnel limit', `${u.usage.funnels} / ${num(u.limits.funnels)}`], ['Storage', `${u.usage.storageMB} / ${num(u.limits.storageMB)} MB (pages ${u.usage.pagesMB})`]].map(([l, v]) => <div key={l}><small>{l}</small><b>{v}</b></div>)}
        </div>
        <div className="seller-actions">
          <div className="row"><input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} /><button className="btn ghost sm" onClick={() => act('extend_trial', { days }, `Trial extended by ${days} days`)}>Extend trial</button></div>
          <div className="row"><input type="number" min="0" placeholder="Plan default" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} /><button className="btn ghost sm" onClick={() => act('set_credits', { limit }, 'AI credit limit saved')}>Set AI credits</button></div>
          <div className="row"><input type="number" min="0" placeholder={`Funnels (${u.limits.funnels})`} value={lim.funnels} onChange={(e) => setLim({ ...lim, funnels: e.target.value })} style={{ width: 130 }} /><input type="number" min="0" placeholder={`Storage MB (${u.limits.storageMB})`} value={lim.storageMB} onChange={(e) => setLim({ ...lim, storageMB: e.target.value })} style={{ width: 150 }} /><input type="number" min="1" placeholder={`Client accounts (${u.limits.agencyClients})`} value={lim.agencyClients} onChange={(e) => setLim({ ...lim, agencyClients: e.target.value })} style={{ width: 170 }} /><button className="btn ghost sm" onClick={() => act('set_limits', lim, 'Limits saved')}>Set limits</button></div>
          <div className="row">
            {u.access.status === 'comped' ? <button className="btn ghost sm" onClick={() => act('uncomp')}>End free access</button> : <button className="btn ghost sm" onClick={async () => { const note = await promptDialog({ title: 'Give free access', text: 'Reason for free access (e.g. partner, beta tester)?', label: 'Reason', confirm: 'Give free access' }); if (note !== null) act('comp', { note }, 'Free access granted'); }}>Give free access</button>}
            {u.access.status === 'suspended' ? <button className="btn ghost sm" onClick={() => act('unsuspend')}>Unsuspend</button> : <button className="btn ghost sm danger" onClick={async () => { const note = await promptDialog({ title: 'Suspend seller', text: 'Reason for suspending (pages go offline and the seller is signed out)?', label: 'Reason', confirm: 'Suspend', danger: true }); if (note !== null) act('suspend', { note }, 'Seller suspended'); }}>Suspend</button>}
            {!u.emailVerified && <button className="btn ghost sm" onClick={() => act('verify_email')}>Mark email verified</button>}
            {u.twoFactor && <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: 'Turn off 2-step verification for this seller?', confirm: 'Turn off', danger: true })) && act('reset_2fa')}>Reset 2-step</button>}
            <button className="btn ghost sm" onClick={() => act('sign_out', {}, 'Signed out everywhere')}>Sign out everywhere</button>
            <button className="btn ghost sm" onClick={resetLink}>Create password-reset link</button>
            {u.admin ? <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: 'Remove admin access?', confirm: 'Remove', danger: true })) && act('remove_admin')}>Remove admin</button> : <button className="btn ghost sm" onClick={async () => (await confirmDialog({ title: `Make ${u.email} a platform admin?`, text: 'They will see all sellers and revenue.', confirm: 'Make admin' })) && act('make_admin')}>Make admin</button>}
            <button className="btn ghost sm danger" onClick={async () => { const e = await promptDialog({ title: 'Delete seller', text: 'This permanently deletes the seller and all their data (invoices are kept). Type their email to confirm:', label: u.email, confirmWord: u.email, confirm: 'Delete', danger: true }); if (e) act('delete', { confirm: e }); }}><Icon name="trash" size={14} /> Delete</button>
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
  useEffect(() => { api('/admin/invoices').then(setList).catch(loadFailed); }, []);
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

// S3-compatible storage (Wasabi, S3, R2…): daily off-site backups, uploaded images and product files
// browsers fetch signed links straight from the bucket (course video, downloads): it needs this CORS rule
const CORS_RULE = JSON.stringify([{ AllowedOrigins: ['*'], AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['Content-Length', 'Content-Range'], MaxAgeSeconds: 86400 }], null, 2);
function CorsWarn({ s, video }) {
  if (!s.ready || s.fromEnv || s.cors !== false) return null;
  return (
    <div className="setup-warn"><Icon name="bolt" size={16} /><div>
      <p><b>Videos won’t play in browsers yet — the bucket is missing a CORS rule.</b> {video ? 'In Cloudflare: R2 → your bucket → Settings → CORS Policy → Add, paste this and save.' : 'Add this CORS rule in your storage provider’s bucket settings (Wasabi: bucket → Settings → CORS; R2: Settings → CORS Policy).'} Then press Save & test again (the secret can stay empty).</p>
      <pre className="cors-rule">{CORS_RULE}</pre>
      <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(CORS_RULE); toast('CORS rule copied'); }}>Copy the rule</button>
    </div></div>
  );
}

function StoragePanel({ s, save, field = 'storage' }) {
  const video = field === 'videoStorage';
  const [v, setV] = useState({ endpoint: s.endpoint || (video ? '' : 'https://s3.ap-southeast-1.wasabisys.com'), region: s.region || '', bucket: s.bucket || '', key: s.key || '', secret: '', publicUrl: s.publicUrl || '' });
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); if (await save({ [field]: v })) setV({ ...v, secret: '' }); setBusy(false); };
  if (video) return (
    <Panel title="Video storage (protected course video)">
      <p className="muted sm">Where encrypted course video is kept and streamed from. Use <b>Cloudflare R2</b> — it doesn’t charge for viewers watching. Without it, video goes to the file storage above (or this server). Videos keep playing from wherever they were prepared.</p>
      <div className={`ai-card ${s.ready ? 'on' : ''}`}><Icon name="play" size={20} /><div><b>{s.ready ? `Connected · ${s.fromEnv ? 'from the server’s settings file' : s.bucket}` : 'Not connected — video uses the file storage'}</b></div></div>
      <CorsWarn s={s} video />
      {s.fromEnv ? <p className="hint">Set by VIDEO_S3_* variables on the server, which take priority over this form.</p> : (
        <>
          <div className="form2">
            <label>Endpoint<input value={v.endpoint} onChange={(e) => setV({ ...v, endpoint: e.target.value.trim() })} placeholder="https://<account id>.r2.cloudflarestorage.com" /></label>
            <label>Bucket<input value={v.bucket} onChange={(e) => setV({ ...v, bucket: e.target.value.trim().toLowerCase() })} placeholder="funnelhive-video" /></label>
            <label>Access key ID<input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.trim() })} autoComplete="off" /></label>
            <label>Secret access key {s.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={v.secret} onChange={(e) => setV({ ...v, secret: e.target.value })} autoComplete="new-password" /></label>
          </div>
          <p className="hint">In Cloudflare: R2 → Create bucket (keep it private) → Manage R2 API tokens → Create token with Object Read & Write on that bucket. Saving writes and deletes a small test file to check the keys.</p>
          <div className="row"><button className="btn primary" disabled={busy || !v.bucket || !v.key || !v.endpoint} onClick={go}>{busy ? 'Checking the bucket…' : 'Save & test video storage'}</button>{s.ready && <button className="btn ghost danger" onClick={async () => (await confirmDialog({ title: 'Disconnect video storage?', text: 'New videos go to the file storage instead. Videos already prepared here keep playing only while the bucket exists.', confirm: 'Disconnect', danger: true })) && save({ videoStorage: { clear: true } })}>Disconnect</button>}</div>
        </>
      )}
    </Panel>
  );
  const off = s.offsite;
  return (
    <Panel title="File storage & off-site backups">
      <p className="muted sm">An S3-compatible bucket (Wasabi, AWS S3, Cloudflare R2…). Once connected, a copy of the database goes there after every backup (every 6 hours, 90 days kept), and new uploaded images and product files are stored there instead of on this server.</p>
      <div className={`ai-card ${s.ready ? 'on' : ''}`}><Icon name="box" size={20} /><div><b>{s.ready ? `Connected · ${s.fromEnv ? 'from the server’s settings file' : s.bucket}` : 'Not connected — everything stays on this server only'}</b><p className="muted sm">{off ? (off.ok ? `Last off-site backup: ${off.file} · ${new Date(off.at).toLocaleString('en-IN')}` : `Last off-site backup failed: ${off.error}`) : s.ready ? 'The first off-site backup runs within a few minutes.' : 'Wasabi → Buckets → Create bucket, then Access Keys → Create new access key.'}</p></div></div>
      <CorsWarn s={s} />
      {s.fromEnv ? <p className="hint">Set by S3_* variables on the server, which take priority over this form.</p> : (
        <>
          <div className="form2">
            <label>Endpoint<input value={v.endpoint} onChange={(e) => setV({ ...v, endpoint: e.target.value.trim() })} placeholder="https://s3.ap-southeast-1.wasabisys.com" /></label>
            <label>Region <small className="muted">· filled in for Wasabi</small><input value={v.region} onChange={(e) => setV({ ...v, region: e.target.value.trim() })} placeholder="ap-southeast-1" /></label>
            <label>Bucket<input value={v.bucket} onChange={(e) => setV({ ...v, bucket: e.target.value.trim().toLowerCase() })} placeholder="funnelhive-files" /></label>
            <label>Access key<input value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.trim() })} autoComplete="off" /></label>
            <label>Secret key {s.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={v.secret} onChange={(e) => setV({ ...v, secret: e.target.value })} autoComplete="new-password" /></label>
            <label>Public URL <small className="muted">· optional CDN for images</small><input value={v.publicUrl} onChange={(e) => setV({ ...v, publicUrl: e.target.value.trim() })} placeholder="leave empty — images are served through signed links" /></label>
          </div>
          <p className="hint">Saving writes a small test file to the bucket and deletes it, so wrong keys are caught here. The bucket can stay private. Files already on this server stay where they are.</p>
          <div className="row"><button className="btn primary" disabled={busy || !v.bucket || !v.key} onClick={go}>{busy ? 'Checking the bucket…' : 'Save & test storage'}</button>{s.ready && <button className="btn ghost danger" onClick={async () => (await confirmDialog({ title: 'Disconnect storage?', text: 'New backups and uploads stay on this server only.', confirm: 'Disconnect', danger: true })) && save({ storage: { clear: true } })}>Disconnect</button>}</div>
        </>
      )}
    </Panel>
  );
}

// Cloudflare Turnstile on seller sign-up (funnel forms have their own invisible checks on the server)
function CaptchaPanel({ c, save }) {
  const [v, setV] = useState({ siteKey: c.siteKey || '', secret: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); if (await save({ captcha: v })) setV({ ...v, secret: '' }); setBusy(false); };
  return (
    <Panel title="Bot protection">
      <p className="muted sm">Adds Cloudflare’s free “I’m human” check to sign-up, so bots can’t create fake seller accounts. Most people just see a tick. Funnel opt-ins and forms are protected without it: forms sent faster than a person could type are dropped, and one network can only sign up so often.</p>
      <div className={`ai-card ${c.ready ? 'on' : ''}`}><Icon name="shield" size={20} /><div><b>{c.ready ? `On · ${c.fromEnv ? 'from the server’s settings file' : 'Cloudflare Turnstile'}` : 'Off — sign-up has the hidden bot trap and limits only'}</b></div></div>
      {c.fromEnv ? <p className="hint">Set by TURNSTILE_* variables on the server, which take priority over this form.</p> : (
        <>
          <div className="form2">
            <label>Site key<input value={v.siteKey} onChange={(e) => setV({ ...v, siteKey: e.target.value.trim() })} placeholder="0x4AAAAAAA…" /></label>
            <label>Secret key {c.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={v.secret} onChange={(e) => setV({ ...v, secret: e.target.value.trim() })} autoComplete="new-password" /></label>
          </div>
          <p className="hint">In Cloudflare: Turnstile → Add widget → hostname <b>{location.hostname}</b>, mode “Managed” → copy both keys. Saving checks the secret with Cloudflare.</p>
          <div className="row"><button className="btn primary" disabled={busy || !v.siteKey || (!v.secret && !c.hasSecret)} onClick={go}>{busy ? 'Checking…' : 'Save bot protection'}</button>{c.ready && !c.fromEnv && <button className="btn ghost danger" onClick={async () => (await confirmDialog({ title: 'Turn off the “I’m human” check?', confirm: 'Turn off', danger: true })) && save({ captcha: { clear: true } })}>Turn off</button>}</div>
        </>
      )}
    </Panel>
  );
}

// the platform's own email sender (Resend): sign-in codes, password resets, students' alerts
function MailPanel({ m, save }) {
  const [v, setV] = useState({ from: m.hasKey || m.fromEnv ? m.from : '', key: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); if (await save({ mail: v })) { setV({ ...v, key: '' }); toast('Test email sent — check your inbox'); } setBusy(false); };
  return (
    <Panel title="Email sending">
      <p className="muted sm">Sends sign-in codes, password resets, receipts and students’ alerts — and sellers’ emails when they haven’t connected their own. Uses <b>Resend</b> (free for 3,000 emails a month). Sellers’ emails go out under their own business name from this address.</p>
      <div className={`ai-card ${m.ready ? 'on' : ''}`}><Icon name="mail" size={20} /><div><b>{m.ready ? `Sending · ${m.fromEnv ? 'Resend key from the server’s settings file' : m.smtpEnv && !m.hasKey ? 'server SMTP' : m.from}` : 'Not set up — no emails are being delivered'}</b>{!m.ready && <p className="muted sm">Students can’t get sign-in codes and sellers can’t reset passwords until this is set up.</p>}</div></div>
      {m.fromEnv ? <p className="hint">Set by RESEND_API_KEY on the server, which takes priority over this form.</p> : (
        <>
          <div className="form2">
            <label>Sender<input value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} placeholder="FunnelHive <no-reply@theaihive.tech>" /></label>
            <label>Resend API key {m.hasKey && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.trim() })} placeholder="re_…" autoComplete="new-password" /></label>
          </div>
          <p className="hint">In Resend: Domains → Add your domain and add its DNS records until it shows Verified → API Keys → Create (Sending access). The sender must be on that verified domain. Saving sends a test email to you, so a wrong key or unverified domain is caught here.</p>
          <div className="row"><button className="btn primary" disabled={busy || !v.from || (!v.key && !m.hasKey)} onClick={go}>{busy ? 'Sending a test…' : 'Save & send test email'}</button>{m.hasKey && <button className="btn ghost danger" onClick={async () => (await confirmDialog({ title: 'Stop sending email?', text: 'Sign-in codes and password resets will stop being delivered.', confirm: 'Disconnect', danger: true })) && save({ mail: { clear: true } })}>Disconnect</button>}</div>
        </>
      )}
    </Panel>
  );
}

function PlatformSettings() {
  const [s, setS] = useState(null);
  const [rz, setRz] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
  const [sk, setSk] = useState({ publishableKey: '', secretKey: '', webhookSecret: '' });
  useEffect(() => { api('/admin/settings').then((x) => { setS(x); setRz({ keyId: x.razorpay.keyId.includes('(') ? '' : x.razorpay.keyId, keySecret: '', webhookSecret: '' }); setSk({ publishableKey: x.stripe?.publishableKey || '', secretKey: '', webhookSecret: '' }); }).catch(loadFailed); }, []);
  if (!s) return <div className="skeleton" />;
  const set = (patch) => setS({ ...s, ...patch });
  const save = async (body) => { try { const x = await api('/admin/settings', 'PUT', body); setS(x); toast('Saved'); return x; } catch (e) { toast(e.message); return null; } };
  const hookUrl = `${location.origin}${s.razorpay.webhookPath}`;
  return (
    <div className="settings">
      {s.companyMissing?.length > 0 && (
        <div className="setup-warn"><Icon name="bolt" size={16} /><div><p><b>Your Terms, Privacy and Contact pages are missing company details.</b> Fill in {s.companyMissing.join(', ')} under Company details below — Indian law needs them shown (IT Rules 2021, Consumer Protection Rules).</p></div></div>
      )}
      <Panel title="Plan & pricing">
        <div className="form2">
          <label>Monthly price (₹)<input type="number" min="1" value={s.plans.monthly.amount} onChange={(e) => set({ plans: { ...s.plans, monthly: { amount: e.target.value } } })} /></label>
          <label>Yearly price (₹)<input type="number" min="1" value={s.plans.yearly.amount} onChange={(e) => set({ plans: { ...s.plans, yearly: { amount: e.target.value } } })} /></label>
          <label>Agency monthly (₹)<input type="number" min="1" value={s.plans.agency_monthly?.amount ?? ''} onChange={(e) => set({ plans: { ...s.plans, agency_monthly: { amount: e.target.value } } })} /></label>
          <label>Agency yearly (₹)<input type="number" min="1" value={s.plans.agency_yearly?.amount ?? ''} onChange={(e) => set({ plans: { ...s.plans, agency_yearly: { amount: e.target.value } } })} /></label>
          <label>Client accounts in the Agency plan<input type="number" min="1" value={s.agency?.maxClients ?? 25} onChange={(e) => set({ agency: { ...s.agency, maxClients: e.target.value } })} /></label>
          <label>Client accounts during the trial<input type="number" min="0" value={s.agency?.trialClients ?? 2} onChange={(e) => set({ agency: { ...s.agency, trialClients: e.target.value } })} /></label>
          <label>Free trial (days)<input type="number" min="0" max="365" value={s.trialDays} onChange={(e) => set({ trialDays: e.target.value })} /></label>
          <label>GST rate (%)<input type="number" min="0" max="28" value={s.gstRate} onChange={(e) => set({ gstRate: e.target.value })} /></label>
          <label>AI credits / month — trial<input type="number" min="0" value={s.aiCredits.trial} onChange={(e) => set({ aiCredits: { ...s.aiCredits, trial: e.target.value } })} /></label>
          <label>AI credits / month — paid<input type="number" min="0" value={s.aiCredits.paid} onChange={(e) => set({ aiCredits: { ...s.aiCredits, paid: e.target.value } })} /></label>
          <label>Grace days after a failed renewal<input type="number" min="0" max="60" value={s.graceDays} onChange={(e) => set({ graceDays: e.target.value })} /></label>
          <label>Pages stay live after lock (days)<input type="number" min="0" max="365" value={s.pagesOfflineAfterDays} onChange={(e) => set({ pagesOfflineAfterDays: e.target.value })} /></label>
          <label>Funnels per seller — trial<input type="number" min="0" value={s.limits.funnelsTrial} onChange={(e) => set({ limits: { ...s.limits, funnelsTrial: e.target.value } })} /></label>
          <label>Funnels per seller — paid<input type="number" min="0" value={s.limits.funnels} onChange={(e) => set({ limits: { ...s.limits, funnels: e.target.value } })} /></label>
          <label>Storage (MB) — trial<input type="number" min="0" value={s.limits.storageMBTrial} onChange={(e) => set({ limits: { ...s.limits, storageMBTrial: e.target.value } })} /></label>
          <label>Storage (MB) — paid<input type="number" min="0" value={s.limits.storageMB} onChange={(e) => set({ limits: { ...s.limits, storageMB: e.target.value } })} /></label>
          <label>Broadcast emails / day — trial (shared sender)<input type="number" min="0" value={s.limits.broadcastTrialDaily} onChange={(e) => set({ limits: { ...s.limits, broadcastTrialDaily: e.target.value } })} /></label>
        </div>
        <label className="tog"><input type="checkbox" checked={s.pricesIncludeGst} onChange={(e) => set({ pricesIncludeGst: e.target.checked })} /><span />Prices include GST</label>
        <p className="hint">Sellers pay {inr(s.prices.monthly.amount)}/month or {inr(s.prices.yearly.amount)}/year. Changing a price applies to new subscriptions; existing subscribers keep theirs.</p>
        {Object.values(s.plans).some((p) => Number(p?.amount) > 15000) && <p className="hint">A plan above ₹15,000 is never auto-debited silently: RBI requires the payer to approve each renewal in their bank app (Razorpay sends the request). Invoices use SAC {s.sac || '998314'} (PLATFORM_SAC overrides).</p>}
        <button className="btn primary" onClick={() => save({ plans: s.plans, agency: s.agency, trialDays: s.trialDays, gstRate: s.gstRate, aiCredits: s.aiCredits, graceDays: s.graceDays, pagesOfflineAfterDays: s.pagesOfflineAfterDays, pricesIncludeGst: s.pricesIncludeGst, limits: s.limits })}>Save pricing</button>
      </Panel>

      {s.mail && <MailPanel m={s.mail} save={save} />}
      {s.captcha && <CaptchaPanel c={s.captcha} save={save} />}
      <StoragePanel s={s.storage} save={save} />
      <StoragePanel s={s.videoStorage} save={save} field="videoStorage" />

      <Panel title="Razorpay (collects subscriptions)">
        <p className="muted sm">Your own Razorpay account. Sellers connect theirs separately for their customers’ payments.</p>
        <div className={`ai-card ${s.razorpay.ready ? 'on' : ''}`}><Icon name="wallet" size={20} /><div><b>{s.razorpay.ready ? `Connected · ${s.razorpay.mode} mode` : 'Not connected'}</b><p className="muted sm">{s.razorpay.ready ? s.razorpay.keyId : 'Razorpay → Account & Settings → API keys'}</p></div></div>
        <label>Key ID<input value={rz.keyId} onChange={(e) => setRz({ ...rz, keyId: e.target.value.trim() })} placeholder="rzp_live_…" /></label>
        <label>Key Secret {s.razorpay.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={rz.keySecret} onChange={(e) => setRz({ ...rz, keySecret: e.target.value })} /></label>
        <label>Webhook secret {s.razorpay.hasWebhookSecret && <small className="muted">· saved</small>}<input type="password" value={rz.webhookSecret} onChange={(e) => setRz({ ...rz, webhookSecret: e.target.value })} /></label>
        <p className="hint">In Razorpay → Webhooks add <code>{hookUrl}</code> with the events <code>subscription.authenticated</code>, <code>subscription.activated</code>, <code>subscription.charged</code>, <code>subscription.pending</code>, <code>subscription.halted</code>, <code>subscription.cancelled</code>, <code>subscription.completed</code>, and paste the same secret here. Enable Subscriptions on your Razorpay account first.</p>
        <button className="btn primary" onClick={async () => { const body = { keyId: rz.keyId, ...(rz.keySecret ? { keySecret: rz.keySecret } : {}), ...(rz.webhookSecret ? { webhookSecret: rz.webhookSecret } : {}) }; if (await save({ razorpay: body })) setRz({ ...rz, keySecret: '', webhookSecret: '' }); }}>Save Razorpay keys</button>
      </Panel>

      <Panel title="Stripe (sellers outside India)">
        <p className="muted sm">Sellers whose billing country isn’t India subscribe by card in USD, EUR or GBP through your Stripe account and get an export invoice.</p>
        <div className={`ai-card ${s.stripe?.ready ? 'on' : ''}`}><Icon name="wallet" size={20} /><div><b>{s.stripe?.ready ? `Connected · ${s.stripe.mode} mode` : 'Not connected'}</b><p className="muted sm">{s.stripe?.ready ? s.stripe.publishableKey : 'Stripe → Developers → API keys'}</p></div></div>
        <label>Publishable key<input value={sk.publishableKey} onChange={(e) => setSk({ ...sk, publishableKey: e.target.value.trim() })} placeholder="pk_live_…" /></label>
        <label>Secret key {s.stripe?.hasSecret && <small className="muted">· saved — leave empty to keep</small>}<input type="password" value={sk.secretKey} onChange={(e) => setSk({ ...sk, secretKey: e.target.value.trim() })} placeholder="sk_live_…" /></label>
        <label>Webhook signing secret {s.stripe?.hasWebhookSecret && <small className="muted">· saved</small>}<input type="password" value={sk.webhookSecret} onChange={(e) => setSk({ ...sk, webhookSecret: e.target.value.trim() })} placeholder="whsec_…" /></label>
        <p className="hint">In Stripe → Developers → Webhooks add <code>{location.origin}{s.stripe?.webhookPath || '/api/billing/stripe-webhook'}</code> with the events <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>, <code>invoice.paid</code>, <code>invoice.payment_failed</code>, and paste its signing secret here.</p>
        <button className="btn primary" onClick={async () => { const body = { publishableKey: sk.publishableKey, ...(sk.secretKey ? { secretKey: sk.secretKey } : {}), ...(sk.webhookSecret ? { webhookSecret: sk.webhookSecret } : {}) }; if (await save({ stripe: body })) setSk({ ...sk, secretKey: '', webhookSecret: '' }); }}>Save Stripe keys</button>
        <h4>Prices outside India</h4>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Currency</th><th>Monthly</th><th>Yearly</th><th>Agency monthly</th><th>Agency yearly</th></tr></thead>
          <tbody>{Object.entries(s.intl?.prices || {}).map(([cur, row]) => <tr key={cur}><td><b>{cur}</b></td>{['monthly', 'yearly', 'agency_monthly', 'agency_yearly'].map((k) => <td key={k}><input type="number" min="1" style={{ width: 90 }} value={row[k] ?? ''} onChange={(e) => set({ intl: { ...s.intl, prices: { ...s.intl.prices, [cur]: { ...row, [k]: e.target.value } } } })} /></td>)}</tr>)}</tbody>
        </table></div>
        <label className="tog"><input type="checkbox" checked={!!s.intl?.lut} onChange={(e) => set({ intl: { ...s.intl, lut: e.target.checked } })} /><span />I have a Letter of Undertaking (export invoices without IGST)</label>
        <p className="hint">Without a LUT, a GST-registered company’s export invoices include IGST in the price. Without GSTIN, no GST is shown.</p>
        <button className="btn primary" onClick={() => save({ intl: { prices: s.intl.prices, lut: !!s.intl.lut } })}>Save international prices</button>
      </Panel>

      <Panel title="Company details (GST invoices and legal pages)">
        <div className="form2">
          <label>Legal name *<input value={s.company.name} onChange={(e) => set({ company: { ...s.company, name: e.target.value } })} placeholder="Hive Labs Pvt Ltd" /></label>
          <label><span>CIN <small className="muted">· optional</small></span><input value={s.company.cin || ''} onChange={(e) => set({ company: { ...s.company, cin: e.target.value.toUpperCase() } })} maxLength={21} placeholder="U72900MH2026PTC123456" /></label>
          <label><span>GSTIN <small className="muted">· leave empty if not registered</small></span><input value={s.company.gstin} onChange={(e) => set({ company: { ...s.company, gstin: e.target.value.toUpperCase() } })} maxLength={15} /></label>
          <label>State<select value={s.company.state} onChange={(e) => set({ company: { ...s.company, state: e.target.value } })}><option value="">Choose…</option>{s.states.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Invoice number prefix<input value={s.company.invoicePrefix} onChange={(e) => set({ company: { ...s.company, invoicePrefix: e.target.value } })} /></label>
          <label>Billing email<input value={s.company.email} onChange={(e) => set({ company: { ...s.company, email: e.target.value } })} placeholder="billing@yourbrand.in" /></label>
          <label className="full">Registered address *<input value={s.company.address} onChange={(e) => set({ company: { ...s.company, address: e.target.value } })} placeholder="Office, street, city, PIN" /></label>
          <label>Phone *<input value={s.company.phone || ''} onChange={(e) => set({ company: { ...s.company, phone: e.target.value } })} placeholder="+91 98xxx xxxxx" /></label>
          <label>Support email *<input value={s.company.supportEmail || ''} onChange={(e) => set({ company: { ...s.company, supportEmail: e.target.value } })} placeholder="support@yourbrand.in" /></label>
          <label>Grievance officer name *<input value={s.company.grievanceName || ''} onChange={(e) => set({ company: { ...s.company, grievanceName: e.target.value } })} /></label>
          <label>Grievance officer email *<input value={s.company.grievanceEmail || ''} onChange={(e) => set({ company: { ...s.company, grievanceEmail: e.target.value } })} placeholder="grievance@yourbrand.in" /></label>
          <label>Grievance officer phone *<input value={s.company.grievancePhone || ''} onChange={(e) => set({ company: { ...s.company, grievancePhone: e.target.value } })} /></label>
        </div>
        <p className="hint">Shown on the Terms, Privacy, Refund and Contact pages. The grievance officer must acknowledge complaints within 24 hours and resolve them within 15 days.</p>
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
  useEffect(() => { api('/admin/audit').then(setList).catch(loadFailed); }, []);
  if (!list) return <div className="skeleton" />;
  return (
    <Panel title="Every change made by an admin" pad={false}>
      {list.length ? <table className="tbl compact"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Seller</th><th>Detail</th></tr></thead>
        <tbody>{list.map((a) => <tr key={a.id}><td className="muted sm">{fmtDate(a.at)} · {new Date(a.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td>{a.actor}</td><td className="strong">{a.action.replace(/_/g, ' ')}</td><td className="mono">{a.userId || '—'}</td><td className="muted sm">{a.detail}</td></tr>)}</tbody></table>
        : <p className="muted sm" style={{ padding: 18 }}>Nothing yet.</p>}
    </Panel>
  );
}
