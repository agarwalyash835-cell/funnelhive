import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, setToken, loggedIn } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, num, inr, ago, confirmDialog, promptDialog } from '../ui';
import { AuthShell } from './Auth';
import { shareLink } from './Team';
import { PartnerConsole } from '../partnerKit';

const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };
const open = async (ownerId) => { try { const r = await api('/team/switch', 'POST', { ownerId }); setToken(r.token); location.href = '/'; } catch (e) { toast(e.message); } };

// /agency — client accounts, white-label
export default function Agency() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [add, setAdd] = useState(false);
  const [invite, setInvite] = useState(null);
  const load = () => api('/agency').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); load(); } catch (e) { toast(e.message); } };
  const total = (d?.clients || []).reduce((a, c) => ({ visitors: a.visitors + c.stats.visitors, leads: a.leads + c.stats.leads, revenue: a.revenue + c.stats.revenue }), { visitors: 0, leads: 0, revenue: 0 });
  return (
    <Layout title="Agency" subtitle="Your clients’ accounts in one place — one login, one bill, your brand." actions={d?.limit > 0 && <button className="btn primary" onClick={() => setAdd(true)}><Icon name="plus" size={16} /> Add client</button>}>
      {err ? <Panel><Empty icon="users" title="Agency tools" text={err} /></Panel> : !d ? <div className="skeleton" /> : (
        <>
          {!d.limit && (
            <div className="note-bar"><span>Manage client accounts, white-label the app with your brand and send clients reports with the <b>Agency plan</b>.</span><Link to="/billing">See the Agency plan →</Link></div>
          )}
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Client accounts</span><b className="kpi-v">{num(d.used)}<small> / {num(d.limit)}</small></b></div>
            <div className="kpi"><span className="kpi-l">Visitors (30 days)</span><b className="kpi-v">{num(total.visitors)}</b></div>
            <div className="kpi"><span className="kpi-l">Leads (30 days)</span><b className="kpi-v">{num(total.leads)}</b></div>
            <div className="kpi"><span className="kpi-l">Client revenue (30 days)</span><b className="kpi-v">{inr(total.revenue)}</b></div>
          </div>
          <PartnerConsole onChanged={load} />
          <Panel pad={false} title="Clients">
            {!d.clients.length ? <Empty icon="users" title="No client accounts yet" text="Each client gets their own account — funnels, contacts, payments, domains and data kept separate. You switch between them from the sidebar; they can log in too.">{d.limit > 0 && <button className="btn primary" onClick={() => setAdd(true)}>Add your first client</button>}</Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Client</th><th className="r">Funnels</th><th className="r">Visitors</th><th className="r">Leads</th><th className="r">Revenue</th><th>Login</th><th /></tr></thead>
                <tbody>{d.clients.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.business}</b><small className="sub-t">since {new Date(c.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</small></td>
                    <td className="r">{num(c.funnels)}</td><td className="r">{num(c.stats.visitors)}</td><td className="r">{num(c.stats.leads)}</td><td className="r strong">{inr(c.stats.revenue)}</td>
                    <td>{c.email ? <span className="pill ok">{c.email}</span> : c.invited ? <span className="pill warn">invited</span> : <button className="link-btn" onClick={() => setInvite(c)}>Invite client</button>}</td>
                    <td className="r"><div className="row end">
                      <button className="btn primary sm" onClick={() => open(c.id)}>Open</button>
                      <button className="icon-btn" title="Copy the client report link" aria-label="Copy the client report link" onClick={() => copy(`${location.origin}${c.report}`)}><Icon name="chart" size={15} /></button>
                      {c.email && <button className="icon-btn" title="Hand the account over (they pay for it themselves)" aria-label="Hand the account over (they pay for it themselves)" onClick={async () => (await confirmDialog({ title: `Hand ${c.business} over?`, text: 'It leaves your Agency plan and starts its own trial; you stay on its team as an admin.', confirm: 'Hand over' })) && act(() => api(`/agency/clients/${c.id}/detach`, 'POST'), 'Handed over')}><Icon name="external" size={15} /></button>}
                      <button className="icon-btn danger" title="Delete the client account" aria-label="Delete the client account" onClick={async () => (await promptDialog({ title: `Delete ${c.business} and all its funnels, contacts and orders?`, confirmWord: 'DELETE', confirm: 'Delete', danger: true })) === 'DELETE' && act(() => api(`/agency/clients/${c.id}`, 'DELETE', { confirm: 'DELETE' }), 'Deleted')}><Icon name="trash" size={15} /></button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          <WhiteLabel w={d.whiteLabel} enabled={d.limit > 0} />
          <p className="hint">Copy funnels to a client from the Funnels page (⋯ → Copy to client). Funnels you build for others can also be shared as a link or a file.</p>
        </>
      )}
      {add && <AddClient onClose={() => setAdd(false)} onDone={async (r) => { setAdd(false); load(); if (await confirmDialog({ title: 'Client account ready', text: 'Open it now?', confirm: 'Open it', cancel: 'Later' })) open(r.id); }} />}
      {invite && <InviteClient c={invite} onClose={() => setInvite(null)} onDone={() => { setInvite(null); load(); }} />}
    </Layout>
  );
}

function AddClient({ onClose, onDone }) {
  const [v, setV] = useState({ business: '', name: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e.preventDefault(); setBusy(true); try { onDone(await api('/agency/clients', 'POST', v)); } catch (x) { toast(x.message); } setBusy(false); };
  return (
    <Modal title="Add a client account" onClose={onClose} width={460}>
      <form className="form2 m-body" onSubmit={save}>
        <label className="fld full"><span>Client’s business name</span><input required autoFocus value={v.business} onChange={(e) => setV({ ...v, business: e.target.value })} placeholder="Sharma Yoga Studio" /></label>
        <label className="fld full"><span>Contact person <small className="muted">· optional</small></span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <div className="row end full"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </form>
    </Modal>
  );
}
function InviteClient({ c, onClose, onDone }) {
  const [email, setEmail] = useState('');
  const send = async (e) => { e.preventDefault(); try { const r = await api(`/agency/clients/${c.id}/invite`, 'POST', { email }); shareLink(r.link, email); onDone(); } catch (x) { toast(x.message); } };
  return (
    <Modal title={`Let ${c.business} log in`} onClose={onClose} width={460}>
      <form className="m-body" onSubmit={send}>
        <p className="muted sm">They get an email to choose a password and log in to their own account (with your branding). You keep managing it.</p>
        <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@client.com" style={{ width: '100%' }} />
        <div className="row end" style={{ marginTop: 12 }}><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Send invitation</button></div>
      </form>
    </Modal>
  );
}

function WhiteLabel({ w, enabled }) {
  const [v, setV] = useState({ brand: '', logo: '', primary: '', supportEmail: '', domain: '', hidePowered: false, ...w });
  const [dns, setDns] = useState(null);
  const save = async () => { try { const r = await api('/agency/white-label', 'PUT', v); setV({ ...v, ...r.whiteLabel }); setDns(r.dns); toast('White-label saved — reload to see it'); } catch (e) { toast(e.message); } };
  return (
    <Panel title="White-label" actions={<button className="btn primary sm" disabled={!enabled} onClick={save}>Save</button>}>
      <p className="muted sm">Your clients (and your team) see your brand instead of ours — in the dashboard, login page, emails and reports.</p>
      <fieldset disabled={!enabled} className="plain">
        <div className="form2">
          <label className="fld"><span>Brand name</span><input value={v.brand} maxLength={40} onChange={(e) => setV({ ...v, brand: e.target.value })} placeholder="GrowthOS" /></label>
          <label className="fld"><span>Logo URL <small className="muted">· square, https://</small></span><input value={v.logo} onChange={(e) => setV({ ...v, logo: e.target.value })} placeholder="https://…/logo.png" /></label>
          <label className="fld"><span>Brand colour</span><input type="color" value={v.primary || '#6366f1'} onChange={(e) => setV({ ...v, primary: e.target.value })} /></label>
          <label className="fld"><span>Support email</span><input value={v.supportEmail} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} placeholder="help@youragency.com" /></label>
          <label className="fld full"><span>Your app domain <small className="muted">· optional, e.g. app.youragency.com</small></span><input value={v.domain} onChange={(e) => setV({ ...v, domain: e.target.value })} placeholder="app.youragency.com" /></label>
        </div>
        <label className="tog"><input type="checkbox" checked={!!v.hidePowered} onChange={(e) => setV({ ...v, hidePowered: e.target.checked })} /><span />Hide “Powered by” on client pages and reports</label>
      </fieldset>
      {(dns || v.domain) && <p className="hint">Point <b>{v.domain}</b> to this app: add a <code>CNAME</code> record → <code>{dns?.value || new URL(location.origin).hostname}</code>. HTTPS is set up automatically once it resolves.</p>}
    </Panel>
  );
}

// /share/:token — a funnel someone shared: preview, then import into your account
export function ShareImport() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/share/${token}`).then(async (r) => { const j = await r.json(); r.ok ? setD(j) : setErr(j.error); }); }, [token]);
  const imp = async () => { setBusy(true); try { const r = await api(`/share/${token}/import`, 'POST'); location.href = `/funnels/${r.id}`; } catch (e) { toast(e.message); setBusy(false); } };
  return (
    <AuthShell>
      <div className="team-accept">
        {err ? <><h2>Shared funnel</h2><p className="muted">{err}</p></> : !d ? <div className="skeleton" /> : (
          <>
            <h2>{d.name}</h2>
            <p className="muted">Shared by <b>{d.by}</b> · {d.steps.length} pages: {d.steps.map((s) => s.name).join(' → ')}</p>
            {d.hero && <p className="muted sm">“{String(d.hero).replace(/\*/g, '')}”</p>}
            {loggedIn() ? <button className="btn primary lg block" disabled={busy} onClick={imp}>{busy ? 'Importing…' : 'Import into my account'}</button>
              : <a className="btn primary lg block" href={`/login?mode=register&next=${encodeURIComponent(`/share/${token}`)}`}>Create a free account to import it</a>}
            <p className="hint">You get your own copy — pages, automations (paused) and products. Connect your own payments and publish when ready.</p>
          </>
        )}
      </div>
    </AuthShell>
  );
}

// /report/:token — a client's read-only report
export function ClientReport() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState('');
  useEffect(() => { fetch(`/api/report/${token}?days=${days}`).then(async (r) => { const j = await r.json(); r.ok ? setD(j) : setErr(j.error); }); }, [token, days]);
  if (err) return <div className="report"><p className="err">{err}</p></div>;
  if (!d) return <div className="report"><div className="skeleton" /></div>;
  const delta = (k) => { const a = d.totals[k], b = d.prev[k]; return b ? Math.round(((a - b) / b) * 100) : null; };
  const K = ({ k, l, money }) => { const x = delta(k); return <div className="kpi"><span className="kpi-l">{l}</span><b className="kpi-v">{money ? inr(d.totals[k]) : num(d.totals[k])}</b>{x != null && <small className={x >= 0 ? 'up' : 'down'}>{x >= 0 ? '▲' : '▼'} {Math.abs(x)}% vs previous</small>}</div>; };
  return (
    <div className="report">
      <header className="report-h">{d.logo ? <img src={d.logo} alt="" /> : <span className="logo"><Icon name="chart" size={18} /></span>}<div><h1>{d.business}</h1><p className="muted">Performance report · {d.brand}</p></div>
        <div className="seg">{[7, 30, 90].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} days</button>)}</div></header>
      <div className="kpis k4"><K k="visitors" l="Visitors" /><K k="leads" l="Leads" /><K k="orders" l="Sales" /><K k="revenue" l="Revenue" money /></div>
      <div className="report-cols">
        <Panel title="Funnels" pad={false}><table className="tbl compact"><thead><tr><th>Funnel</th><th className="r">Visitors</th><th className="r">Leads</th><th className="r">Sales</th><th className="r">Revenue</th></tr></thead>
          <tbody>{d.funnels.map((f) => <tr key={f.name}><td>{f.name}{!f.published && <small className="sub-t">draft</small>}</td><td className="r">{num(f.visitors)}</td><td className="r">{num(f.leads)}</td><td className="r">{num(f.orders)}</td><td className="r strong">{inr(f.revenue)}</td></tr>)}</tbody></table></Panel>
        <Panel title="Where visitors come from" pad={false}><table className="tbl compact"><tbody>{d.sources.map((s) => <tr key={s.source}><td>{s.source}</td><td className="r">{num(s.views)} views</td><td className="r">{num(s.leads)} leads</td><td className="r">{inr(s.revenue)}</td></tr>)}</tbody></table></Panel>
      </div>
      <p className="hint center">Updated live · {new Date().toLocaleString('en-IN')}</p>
    </div>
  );
}

// Settings → Team: who changed what
export function ActivityPanel() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/activity?limit=100').then(setRows).catch(() => setRows(false)); }, []);
  if (rows === false) return null;
  const ic = { owner: '👤', team: '👥', agency: '🏢', api: '🔑', support: '🛟' };
  return (
    <Panel title="Activity" pad={false}>
      {!rows ? <div className="skeleton sm" /> : !rows.length ? <p className="muted sm" style={{ padding: 16 }}>Changes made in this account appear here — by you, your team, your agency or API keys.</p> : (
        <table className="tbl compact"><tbody>{rows.map((a, i) => <tr key={i}><td style={{ width: 28 }}>{ic[a.who.kind] || '•'}</td><td><b>{a.who.name || a.who.email}</b> <span className="muted">{a.what}</span></td><td className="r muted sm">{ago(a.at)}</td></tr>)}</tbody></table>
      )}
    </Panel>
  );
}
