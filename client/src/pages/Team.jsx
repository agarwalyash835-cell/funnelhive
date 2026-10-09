import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setToken } from '../api';
import { Panel, Icon, toast, ago } from '../ui';
import { AuthShell } from './Auth';

// email isn't set up on the server: the invite link comes back to share yourself (copied to the clipboard)
export const shareLink = (link, email, again) => {
  if (!link) return toast(again ? 'Invitation sent again' : `Invitation sent to ${email}`);
  navigator.clipboard?.writeText(link).then(() => toast(`Email isn’t set up yet — invite link for ${email} copied. Send it to them yourself.`), () => prompt(`Email isn’t set up yet. Send this invite link to ${email}:`, link));
};

const ROLE_NAME = { admin: 'Admin', marketer: 'Marketer', sales: 'Sales & support', viewer: 'Viewer', agency: 'Agency (manages this account)' };

// Settings → Team: invite staff with a role (owners), see who's on the team (admins)
export function TeamPanel() {
  const [d, setD] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('marketer');
  const [busy, setBusy] = useState(false);
  const load = () => api('/team/members').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (d === false) return null;
  const invite = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await api('/team/invite', 'POST', { email, role }); shareLink(r.link, email); setEmail(''); load(); } catch (x) { toast(x.message); }
    setBusy(false);
  };
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); load(); } catch (x) { toast(x.message); } };
  return (
    <Panel title="Team">
      <p className="muted sm">Invite your staff, agency or VA. Everyone signs in with their own email and password, and only sees what their role allows. Billing and deleting the account stay with you.</p>
      {d?.canManage && (
        <form className="row wrap team-invite" onSubmit={invite}>
          <input type="email" required placeholder="colleague@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>{Object.keys(d.roles).map((k) => <option key={k} value={k}>{ROLE_NAME[k]}</option>)}</select>
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button>
        </form>
      )}
      {!d ? <div className="skeleton" /> : (
        <table className="tbl compact team-tbl"><tbody>
          <tr><td><b>{d.owner.name}</b><small className="sub-t">{d.owner.email}</small></td><td><span className="pill ok">Owner</span></td><td /></tr>
          {d.members.map((m) => (
            <tr key={m.id}>
              <td><b>{m.name || m.email}</b><small className="sub-t">{m.name ? m.email : ''}{m.status === 'invited' ? ` · invited ${ago(m.at)}` : m.lastSeenAt ? ` · active ${ago(m.lastSeenAt)}` : ''}</small></td>
              <td>{d.canManage && m.role !== 'agency' ? <select value={m.role} onChange={(e) => act(() => api(`/team/members/${m.id}`, 'PUT', { role: e.target.value }), 'Role updated')}>{Object.keys(d.roles).map((k) => <option key={k} value={k}>{ROLE_NAME[k]}</option>)}</select> : ROLE_NAME[m.role]}{m.status === 'invited' && <span className="pill warn">pending</span>}</td>
              <td className="r">{d.canManage && <div className="row end">
                {m.status === 'invited' && <button className="btn ghost sm" onClick={() => act(async () => { const r = await api(`/team/members/${m.id}/resend`, 'POST'); shareLink(r.link, m.email, true); })}>Resend</button>}
                <button className="icon-btn" title="Remove" onClick={() => confirm(`Remove ${m.email} from your team? They lose access immediately.`) && act(() => api(`/team/members/${m.id}`, 'DELETE'), 'Removed')}><Icon name="trash" size={15} /></button>
              </div>}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      {d && <p className="hint">Admin: everything except billing and the team · Marketer: funnels, AI, automations, broadcasts, contacts, products · Sales & support: contacts, orders &amp; shipping, bookings · Viewer: read-only reports. Up to {d.max} people.</p>}
    </Panel>
  );
}

// /team/accept?token=… — the invitee's landing page
export function AcceptInvite() {
  const token = new URLSearchParams(location.search).get('token') || '';
  const [inv, setInv] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loggedIn = !!localStorage.getItem('ff_token');
  const next = encodeURIComponent(`/team/accept?token=${token}`);
  useEffect(() => { fetch(`/api/team/invitation?token=${encodeURIComponent(token)}`).then(async (r) => { const j = await r.json(); if (r.ok) setInv(j); else setErr(j.error); }).catch(() => setErr('Couldn’t load the invitation')); }, []);
  const accept = async () => {
    setBusy(true);
    try { const r = await api('/team/accept', 'POST', { token }); setToken(r.token); location.href = '/'; } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <AuthShell><div className="team-accept">
      {err ? <><h2>Invitation</h2><p className="muted">{err}</p><Link className="btn ghost" to="/">Go to the app</Link></> : !inv ? <div className="skeleton" /> : (
        <>
          <h2>Join {inv.business}</h2>
          <p className="muted">You’ve been invited as <b>{inv.roleLabel.split(' — ')[0]}</b> — {inv.roleLabel.split(' — ')[1]}.</p>
          <p className="muted sm">Invitation for <b>{inv.email}</b></p>
          {loggedIn ? <button className="btn primary lg block" disabled={busy} onClick={accept}>{busy ? 'Joining…' : 'Accept and open the workspace'}</button> : (
            <div className="row center">
              <a className="btn primary lg block" href={`/login?mode=${inv.hasAccount ? 'login' : 'register'}&email=${encodeURIComponent(inv.email)}&next=${next}`}>{inv.hasAccount ? 'Log in to accept' : 'Create your account'}</a>
            </div>
          )}
        </>
      )}
    </div></AuthShell>
  );
}

// sidebar: which workspace you're in, and switching
export function WorkspaceSwitch({ me }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  if (!me?.workspace && !me?.teams) return null;
  const toggle = async () => { if (!list) setList(await api('/team/workspaces').catch(() => null)); setOpen(!open); };
  const go = async (ownerId) => { try { const r = await api('/team/switch', 'POST', { ownerId }); setToken(r.token); location.href = '/'; } catch (e) { toast(e.message); } };
  return (
    <div className="ws-switch">
      <button className="ws-cur" onClick={toggle}><Icon name="users" size={14} /><span>{me.workspace ? me.workspace.name : 'My workspace'}{me.workspace && <small>{ROLE_NAME[me.workspace.role]}</small>}</span><Icon name="chevron" size={14} /></button>
      {open && list && (
        <div className="ws-menu">
          <button className={!list.current ? 'on' : ''} onClick={() => go(null)}>{list.own.name} <small>yours</small></button>
          {list.teams.map((t) => <button key={t.ownerId} className={list.current === t.ownerId ? 'on' : ''} onClick={() => go(t.ownerId)}>{t.name} <small>{ROLE_NAME[t.role]}</small></button>)}
        </div>
      )}
    </div>
  );
}
