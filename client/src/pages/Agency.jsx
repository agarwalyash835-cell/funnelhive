import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, loggedIn, enterClient, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, num, inr, ago, confirmDialog, promptDialog } from '../ui';
import { AuthShell } from './Auth';
import { shareLink } from './Team';
import { PartnerConsole } from '../partnerKit';

const copy = (t) => { navigator.clipboard?.writeText(t); toast('Copied'); };
// opening a client account: a reason (the client sees it), for 2 hours
const open = async (c) => {
  const reason = await promptDialog({ title: `Open ${c.business || 'this client'}`, text: 'Say why — your client sees it in their activity log and notifications. Access lasts 2 hours.', label: 'Reason', placeholder: 'Updating the landing page' });
  if (!reason) return;
  try { const r = await api(`/agency/clients/${c.id}/enter`, 'POST', { reason }); enterClient(r.token); } catch (e) { toast(e.message); }
};
const ACCESS = { full: ['ok', 'Full access'], read: ['warn', 'Read-only'], off: ['bad', 'Access off'] };

// /agency — client accounts, white-label
export default function Agency() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [add, setAdd] = useState(false);
  const [invite, setInvite] = useState(null);
  const load = () => api('/agency').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  // from the workspace switcher: /agency?open=<client id>
  useEffect(() => { const id = new URLSearchParams(location.search).get('open'); const c = id && d?.clients.find((x) => x.id === id); if (c) { history.replaceState(null, '', '/agency'); open(c); } }, [d]);
  const owner = d?.me?.role !== 'clients';
  const reportLink = async (c) => { try { const r = await api(`/agency/clients/${c.id}/report-link`, 'POST', { days: 30 }); copy(`${location.origin}${r.url}`); toast('Report link copied — works for 30 days'); load(); } catch (e) { toast(e.message); } };
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
          {owner && <PartnerConsole onChanged={load} />}
          <Panel pad={false} title="Clients">
            {!d.clients.length ? <Empty icon="users" title="No client accounts yet" text="Each client gets their own account — funnels, contacts, payments, domains and data kept separate. You switch between them from the sidebar; they can log in too.">{d.limit > 0 && <button className="btn primary" onClick={() => setAdd(true)}>Add your first client</button>}</Empty> : (
              <div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Client</th><th className="r">Funnels</th><th className="r">Visitors</th><th className="r">Leads</th><th className="r">Revenue</th><th>Login</th><th /></tr></thead>
                <tbody>{d.clients.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.business}</b><small className="sub-t">since {new Date(c.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</small>
                      {c.access && c.access !== 'full' && <span className={`pill ${ACCESS[c.access][0]}`}>{ACCESS[c.access][1]}</span>}
                      {c.deletion && <span className="pill bad">Deleting on {fmtDate(c.deletion.purgeAt)}</span>}</td>
                    <td className="r">{num(c.funnels)}</td><td className="r">{num(c.stats.visitors)}</td><td className="r">{num(c.stats.leads)}</td><td className="r strong">{inr(c.stats.revenue)}</td>
                    <td>{c.email ? <span className="pill ok">{c.email}</span> : c.invited ? <span className="pill warn">invited</span> : owner && !c.deletion ? <button className="link-btn" onClick={() => setInvite(c)}>Invite client</button> : <span className="muted sm">—</span>}</td>
                    <td className="r"><div className="row end">
                      {c.deletion ? (owner && <button className="btn ghost sm" onClick={() => act(() => api(`/agency/clients/${c.id}/restore`, 'POST'), 'Deletion cancelled')}>Undo delete</button>) : <>
                        <button className="btn primary sm" disabled={c.access === 'off'} title={c.access === 'off' ? 'This client turned off agency access' : undefined} onClick={() => open(c)}>Open</button>
                        <button className="icon-btn" title={c.report ? `Copy a new client report link (the current one, valid until ${fmtDate(c.reportExpires)}, stops working)` : 'Make a client report link (30 days)'} aria-label="Client report link" onClick={() => reportLink(c)}><Icon name="chart" size={15} /></button>
                        {c.report && <button className="icon-btn" title="Turn the report link off" aria-label="Turn the report link off" onClick={() => act(() => api(`/agency/clients/${c.id}/report-link`, 'DELETE'), 'Report link turned off')}><Icon name="x" size={15} /></button>}
                        {owner && c.email && <button className="icon-btn" title="Hand the account over (they pay for it themselves)" aria-label="Hand the account over (they pay for it themselves)" onClick={async () => (await confirmDialog({ title: `Hand ${c.business} over?`, text: 'It leaves your Agency plan and starts its own trial; you stay on its team as an admin.', confirm: 'Hand over' })) && act(() => api(`/agency/clients/${c.id}/detach`, 'POST'), 'Handed over')}><Icon name="external" size={15} /></button>}
                        {owner && <button className="icon-btn danger" title="Delete the client account" aria-label="Delete the client account" onClick={async () => (await promptDialog({ title: `Delete ${c.business}?`, text: 'The account is paused now and deleted with all its funnels, contacts and orders after 30 days. The client is told. You can undo it until then.', confirmWord: 'DELETE', confirm: 'Delete', danger: true })) === 'DELETE' && act(() => api(`/agency/clients/${c.id}`, 'DELETE', { confirm: 'DELETE' }), 'Paused — deleted in 30 days')}><Icon name="trash" size={15} /></button>}
                      </>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          {owner && d.staff?.length > 0 && <StaffPanel staff={d.staff} clients={d.clients} onChanged={load} />}
          {owner && <WhiteLabel w={d.whiteLabel} enabled={d.limit > 0} />}
          {owner && <ClientMenu menu={d.clientMenu} enabled={d.limit > 0} />}
          <p className="hint">Copy funnels to a client from the Funnels page (⋯ → Copy to client). Funnels you build for others can also be shared as a link or a file.</p>
        </>
      )}
      {add && <AddClient onClose={() => setAdd(false)} onDone={async (r) => { setAdd(false); load(); if (r.token && await confirmDialog({ title: 'Client account ready', text: 'Open it now to set it up? (2 hours, logged as “Setting up the new account”)', confirm: 'Open it', cancel: 'Later' })) enterClient(r.token); }} />}
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

// client managers (Settings → Team, role "Client manager"): all clients, or the ones picked here
function StaffPanel({ staff, clients, onChanged }) {
  const save = async (m, ids) => { try { await api(`/agency/staff/${m.id}`, 'PUT', { clientIds: ids.length ? ids : null }); toast('Saved'); onChanged(); } catch (e) { toast(e.message); } };
  return (
    <Panel title="Client managers">
      <p className="muted sm">Team members with the Client manager role open client accounts for you (each visit needs a reason the client sees). Pick clients to limit someone to those; none picked = all clients. Invite them from Settings → Team.</p>
      {staff.map((m) => {
        const ids = m.clientIds || [];
        const flip = (id) => save(m, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
        return (
          <div key={m.id} style={{ marginTop: 10 }}>
            <b>{m.name || m.email}</b> <small className="muted">{m.status === 'invited' ? 'invited' : ids.length ? `${ids.length} client${ids.length > 1 ? 's' : ''}` : 'all clients'}</small>
            <div className="chips" style={{ marginTop: 6 }}>{clients.map((c) => <button key={c.id} type="button" className={ids.includes(c.id) ? 'on' : ''} aria-pressed={ids.includes(c.id)} onClick={() => flip(c.id)}>{c.business}</button>)}</div>
          </div>
        );
      })}
    </Panel>
  );
}

// Settings (a client account's own owner): how much its agency may do here, and its recent visits
export function AgencyAccessPanel() {
  const [v, setV] = useState(null);
  useEffect(() => { api('/agency-access').then(setV).catch(() => setV(false)); }, []);
  if (!v || !v.agency) return null;
  const set = async (mode) => { try { setV(await api('/agency-access', 'PUT', { mode })); toast('Saved'); } catch (e) { toast(e.message); } };
  return (
    <Panel title="Agency access">
      <p className="muted sm"><b>{v.agency}</b> manages this account. Choose what they can do when they open it — each visit needs a reason, lasts 2 hours and shows up here and in your activity log.</p>
      <div className="seg">{[['full', 'Full access'], ['read', 'Read-only'], ['off', 'Off']].map(([k, l]) => <button key={k} className={v.mode === k ? 'on' : ''} aria-pressed={v.mode === k} onClick={() => set(k)}>{l}</button>)}</div>
      {v.visits.length > 0 && <table className="tbl compact" style={{ marginTop: 12 }}><tbody>{v.visits.map((x, i) => <tr key={i}><td><b>{x.who}</b> <span className="muted">{x.what}</span></td><td className="r muted sm">{ago(x.at)}</td></tr>)}</tbody></table>}
    </Panel>
  );
}

// the menu client accounts start with: by each client's industry (default), or the tools you pick for all of them
const CLIENT_TOOLS = [['/contacts', 'CRM'], ['/funnels', 'Funnels'], ['/hive', 'Hive AI'], ['/bookings', 'Bookings'], ['/quotes', 'Quotes'], ['/webinars', 'Webinars'], ['/orders', 'Orders'], ['/reports', 'Reports'], ['/ads', 'Ads'], ['/products', 'Products'], ['/school', 'School'], ['/automations', 'Automations'], ['/broadcasts', 'Broadcasts'], ['/vault', 'Vault']];
function ClientMenu({ menu, enabled }) {
  const [pages, setPages] = useState(menu || null);
  const save = async () => { try { const r = await api('/agency/client-menu', 'PUT', { pages: pages || [] }); setPages(r.clientMenu); toast('Client menu saved'); } catch (e) { toast(e.message); } };
  const flip = (to) => setPages(pages.includes(to) ? pages.filter((x) => x !== to) : [...pages, to]);
  return (
    <Panel title="Client menu" actions={<button className="btn primary sm" disabled={!enabled} onClick={save}>Save</button>}>
      <p className="muted sm">What your clients see in their sidebar. Everything else stays one click away under “More tools”, and each client can still change their own menu. What they’re allowed to open doesn’t change.</p>
      <fieldset disabled={!enabled} className="plain">
        <label className="tog"><input type="checkbox" checked={!pages} onChange={(e) => setPages(e.target.checked ? null : ['/contacts', '/funnels', '/bookings', '/automations'])} /><span />Set up by each client’s industry (recommended)</label>
        {pages && <div className="chips" style={{ marginTop: 10 }}>{CLIENT_TOOLS.map(([to, label]) => <button key={to} type="button" className={pages.includes(to) ? 'on' : ''} aria-pressed={pages.includes(to)} onClick={() => flip(to)}>{label}</button>)}</div>}
      </fieldset>
    </Panel>
  );
}

// the DNS records to copy (domain proof, or the sender's SPF / DKIM)
const DnsTable = ({ records }) => (
  <table className="tbl compact dns-t"><thead><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th /></tr></thead>
    <tbody>{records.map((r) => <tr key={r.type + r.name + r.value}><td className="mono strong">{r.type}{r.priority != null ? ` · ${r.priority}` : ''}</td><td className="mono">{r.name}{r.why && <small className="muted"> · {r.why}</small>}</td><td className="mono">{r.value}</td><td className="r"><button type="button" className="icon-btn xs" title="Copy" aria-label="Copy" onClick={() => copy(r.value)}><Icon name="copy" size={13} /></button></td></tr>)}</tbody></table>
);
const PILL = { active: ['ok', 'Verified'], verified: ['ok', 'Verified'], pending: ['warn', 'Waiting for DNS'], failed: ['bad', 'Not working'] };

function WhiteLabel({ w, enabled }) {
  const [v, setV] = useState({ brand: '', logo: '', primary: '', supportEmail: '', domain: '', hidePowered: false, legalName: '', address: '', supportPhone: '', termsUrl: '', privacyUrl: '', ...w });
  const [st, setSt] = useState(null); // { domain: proof + records, sender }
  const [busy, setBusy] = useState(false);
  const loadSt = () => api('/agency/white-label/status').then(setSt).catch(() => {});
  useEffect(() => { if (enabled) loadSt(); }, [enabled]);
  const check = async () => { setBusy(true); try { setSt(await api('/agency/white-label/verify', 'POST')); } catch (e) { toast(e.message); } setBusy(false); };
  const save = async () => { try { const r = await api('/agency/white-label', 'PUT', v); setV({ ...v, ...r.whiteLabel }); toast('White-label saved — reload to see it'); if (r.domainProof) await check(); else loadSt(); } catch (e) { toast(e.message); } };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const d = st?.domain;
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
        <h4 style={{ margin: '18px 0 6px' }}>Your business details</h4>
        <p className="muted sm">Shown on your app domain’s login, contact and policy pages instead of ours.</p>
        <div className="form2">
          <label className="fld"><span>Legal name</span><input value={v.legalName} maxLength={120} onChange={set('legalName')} placeholder="Growth Agency Pvt Ltd" /></label>
          <label className="fld"><span>Support phone</span><input value={v.supportPhone} maxLength={30} onChange={set('supportPhone')} placeholder="+91 98765 43210" /></label>
          <label className="fld full"><span>Address</span><input value={v.address} maxLength={300} onChange={set('address')} placeholder="Office, street, city, state, PIN" /></label>
          <label className="fld"><span>Terms of service link</span><input value={v.termsUrl} onChange={set('termsUrl')} placeholder="https://youragency.com/terms" /></label>
          <label className="fld"><span>Privacy policy link</span><input value={v.privacyUrl} onChange={set('privacyUrl')} placeholder="https://youragency.com/privacy" /></label>
        </div>
      </fieldset>
      {d && <div className={`dom ${d.status}`} style={{ marginTop: 16 }}>
        <div className="dom-h"><b>{d.domain}</b><span className={`pill ${PILL[d.status]?.[0] || ''}`}>{PILL[d.status]?.[1] || d.status}</span></div>
        {d.status !== 'active' && <p className="hint">Your brand shows on <b>{d.domain}</b> (and it gets HTTPS) only after these records prove it’s yours. Add them where you bought the domain (GoDaddy, Hostinger, BigRock, Namecheap, Cloudflare…). DNS changes can take a few minutes to a few hours; we re-check automatically.</p>}
        {d.status === 'active' && <p className="hint">Verified — your clients can log in at <a href={`https://${d.domain}`} target="_blank" rel="noreferrer">https://{d.domain}</a>. Keep the CNAME record in place.</p>}
        {d.status !== 'active' && <DnsTable records={d.records} />}
        <div className="row"><button type="button" className="btn ghost sm" disabled={busy} onClick={check}><Icon name="refund" size={14} /> {busy ? 'Checking…' : 'Check now'}</button>{d.error && <span className="muted sm">{d.error}{d.checkedAt ? ` · checked ${ago(d.checkedAt)}` : ''}</span>}</div>
      </div>}
      {d && <Sender s={st.sender} onChange={setSt} />}
    </Panel>
  );
}

// the address emails to your clients come from (sign-in links, invites…): on your verified domain; until it's
// verified (or if it fails) they come from our address under your brand name
function Sender({ s, onChange }) {
  const [v, setV] = useState({ address: s?.address || '', host: s?.smtp?.host || '', port: s?.smtp?.port || 587, user: s?.smtp?.user || '', pass: '', secure: !!s?.smtp?.secure });
  const [busy, setBusy] = useState(false);
  const smtp = s?.mode !== 'resend';
  const save = async (clear) => {
    setBusy(true);
    try { onChange(await api('/agency/white-label/sender', 'PUT', clear ? { address: '' } : { address: v.address, ...(smtp ? { smtp: { host: v.host, port: v.port, user: v.user, pass: v.pass, secure: v.secure } } : {}) })); if (clear) setV({ ...v, address: '' }); toast(clear ? 'Sender removed' : 'Sender saved'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const check = async () => { setBusy(true); try { onChange(await api('/agency/white-label/verify', 'POST')); } catch (e) { toast(e.message); } setBusy(false); };
  if (!s?.appDomain) return <p className="hint" style={{ marginTop: 12 }}>Once your app domain is verified you can send your clients’ emails from your own address (like hello@youragency.com). Until then they come from our address under your brand name.</p>;
  return (
    <div className={`dom ${s.status}`} style={{ marginTop: 16 }}>
      <div className="dom-h"><b>Emails from your own address</b>{s.status !== 'none' && <span className={`pill ${PILL[s.status]?.[0] || ''}`}>{PILL[s.status]?.[1] || s.status}</span>}</div>
      <p className="hint">Sign-in links, password resets and invitations to your clients come from this address. Until it’s verified (or if sending from it fails) they come from our address with your brand name.</p>
      <div className="form2">
        <label className="fld full"><span>From address</span><input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder={`hello@${s.appDomain.split('.').slice(-2).join('.')}`} /></label>
        {smtp && <>
          <label className="fld"><span>SMTP server <small className="muted">· from your email provider</small></span><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} placeholder="smtp.zoho.in" /></label>
          <label className="fld"><span>Port</span><input type="number" value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} /></label>
          <label className="fld"><span>Username</span><input value={v.user} autoComplete="off" onChange={(e) => setV({ ...v, user: e.target.value })} /></label>
          <label className="fld"><span>Password {s.smtp && <small className="muted">· leave empty to keep</small>}</span><input type="password" value={v.pass} autoComplete="new-password" onChange={(e) => setV({ ...v, pass: e.target.value })} /></label>
        </>}
      </div>
      {smtp && <label className="tog"><input type="checkbox" checked={v.secure} onChange={(e) => setV({ ...v, secure: e.target.checked })} /><span />SSL/TLS from the start (port 465)</label>}
      {s.records?.length > 0 && s.status !== 'verified' && <><p className="hint">{smtp ? 'So your emails land in the inbox, add your email provider’s SPF and DKIM records to your domain:' : 'Add these records to your domain so we can send from it (SPF and DKIM):'}</p><DnsTable records={s.records} /></>}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy || !v.address} onClick={() => save(false)}>Save sender</button>
        {s.status !== 'none' && <button type="button" className="btn ghost sm" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check now'}</button>}
        {s.status !== 'none' && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => save(true)}>Remove</button>}
        {s.error && <span className="muted sm">{s.error}</span>}
      </div>
    </div>
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
