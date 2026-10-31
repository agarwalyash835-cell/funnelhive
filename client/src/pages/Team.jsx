import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setToken } from '../api';
import { Panel, Icon, Modal, toast, ago, confirmDialog, promptDialog } from '../ui';
import { AuthShell } from './Auth';

// email isn't set up on the server: the invite link comes back to share yourself (copied to the clipboard)
export const shareLink = (link, email, again) => {
  if (!link) return toast(again ? 'Invitation sent again' : `Invitation sent to ${email}`);
  navigator.clipboard?.writeText(link).then(() => toast(`Email isn’t set up yet — invite link for ${email} copied. Send it to them yourself.`), () => promptDialog({ title: 'Invite link', text: `Email isn’t set up yet. Send this invite link to ${email}:`, value: link, readOnly: true, confirm: 'Done', cancel: null }));
};

const ROLE_NAME = { admin: 'Admin', marketer: 'Marketer', sales: 'Sales & support', viewer: 'Viewer', agency: 'Agency (manages this account)', clients: 'Client manager' };
// built-in roles first, then the owner's custom roles
const roleOptions = (d) => [...Object.keys(d.roles).map((k) => <option key={k} value={k}>{ROLE_NAME[k]}</option>), ...(d.customRoles?.length ? [<optgroup key="c" label="Custom roles">{d.customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>] : [])];

// Settings → Team: invite staff with a role (owners), see who's on the team (admins)
export function TeamPanel() {
  const [d, setD] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('marketer');
  const [busy, setBusy] = useState(false);
  const [funnels, setFunnels] = useState([]);
  const [pick, setPick] = useState(null); // { id, ids }: choosing which funnels a member works on
  const [rolesV, setRolesV] = useState(0); // bumped when roles change, so the role pickers refresh
  const load = () => api('/team/members').then(setD).catch(() => setD(false));
  useEffect(() => { load(); api('/funnels').then(setFunnels).catch(() => {}); }, []);
  if (d === false) return null;
  const invite = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await api('/team/invite', 'POST', { email, role }); shareLink(r.link, email); setEmail(''); load(); } catch (x) { toast(x.message); }
    setBusy(false);
  };
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); load(); } catch (x) { toast(x.message); } };
  const access = (m) => (m.funnelIds ? `${m.funnelIds.length} funnel${m.funnelIds.length > 1 ? 's' : ''} only` : 'All funnels');
  const saveFunnels = () => { const p = pick; setPick(null); act(() => api(`/team/members/${p.id}`, 'PUT', { funnelIds: p.ids.length ? p.ids : null }), 'Access updated'); };
  return (
    <Panel title="Team">
      <p className="muted sm">Invite your staff, agency or VA. Everyone signs in with their own email and password, and only sees what their role allows. Billing and deleting the account stay with you.</p>
      {d?.canManage && (
        <form className="row wrap team-invite" onSubmit={invite}>
          <input type="email" required placeholder="colleague@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions(d)}</select>
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button>
        </form>
      )}
      {!d ? <div className="skeleton" /> : (
        <table className="tbl compact team-tbl"><tbody>
          <tr><td><b>{d.owner.name}</b><small className="sub-t">{d.owner.email}</small></td><td><span className="pill ok">Owner</span></td><td>All funnels</td><td /></tr>
          {d.members.map((m) => [
            <tr key={m.id}>
              <td><b>{m.name || m.email}</b><small className="sub-t">{m.name ? m.email : ''}{m.status === 'invited' ? ` · invited ${ago(m.at)}` : m.lastSeenAt ? ` · active ${ago(m.lastSeenAt)}` : ''}</small></td>
              <td>{d.canManage && m.role !== 'agency' ? <select value={m.role} onChange={(e) => act(() => api(`/team/members/${m.id}`, 'PUT', { role: e.target.value }), 'Role updated')}>{roleOptions(d)}</select> : m.roleName || ROLE_NAME[m.role]}{m.status === 'invited' && <span className="pill warn">pending</span>}</td>
              <td>{d.canManage && m.role !== 'agency' ? <button className="btn ghost sm" title="Which funnels they can work on" onClick={() => setPick(pick?.id === m.id ? null : { id: m.id, ids: m.funnelIds || [] })}>{access(m)}</button> : m.funnelIds ? access(m) : ''}</td>
              <td className="r">{d.canManage && <div className="row end">
                {m.status === 'invited' && <button className="btn ghost sm" onClick={() => act(async () => { const r = await api(`/team/members/${m.id}/resend`, 'POST'); shareLink(r.link, m.email, true); })}>Resend</button>}
                <button className="icon-btn" title="Remove" aria-label="Remove" onClick={async () => (await confirmDialog({ title: `Remove ${m.email} from your team?`, text: 'They lose access immediately.', confirm: 'Remove', danger: true })) && act(() => api(`/team/members/${m.id}`, 'DELETE'), 'Removed')}><Icon name="trash" size={15} /></button>
              </div>}</td>
            </tr>,
            pick?.id === m.id && (
              <tr key={`${m.id}-funnels`}><td colSpan={4}>
                <p className="muted sm">Tick the funnels they can work on. They’ll see only those — not your contacts, orders page, automations or settings. Tick none for every funnel.</p>
                <div className="row wrap">{funnels.map((f) => (
                  <label key={f.id} className="row"><input type="checkbox" checked={pick.ids.includes(f.id)} onChange={(e) => setPick({ ...pick, ids: e.target.checked ? [...pick.ids, f.id] : pick.ids.filter((x) => x !== f.id) })} />{f.name}</label>
                ))}{!funnels.length && <span className="muted sm">No funnels yet.</span>}</div>
                <div className="row end"><button className="btn ghost sm" onClick={() => setPick(null)}>Cancel</button><button className="btn primary sm" onClick={saveFunnels}>Save access</button></div>
              </td></tr>
            ),
          ])}
        </tbody></table>
      )}
      {d && <p className="hint">Admin: everything except billing and the team · Marketer: funnels, AI, automations, broadcasts, contacts, products · Sales & support: contacts, orders &amp; shipping, bookings · Viewer: read-only reports. Need something else (a telecaller, a content writer)? Make your own role below. Limit anyone to some funnels (e.g. a designer for one project) with the funnels button. Up to {d.max} people.</p>}
      {d && <RolesSection key={rolesV} onChange={() => { setRolesV(rolesV + 1); load(); }} />}
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
  const go = async (ownerId) => { try {
    // a client account you manage as its agency opens from the Agency page (with a reason the client sees)
    if (list?.teams.find((x) => x.ownerId === ownerId)?.role === 'agency') { location.href = `/agency?open=${encodeURIComponent(ownerId)}`; return; } const r = await api('/team/switch', 'POST', { ownerId }); setToken(r.token); location.href = '/'; } catch (e) { toast(e.message); } };
  return (
    <div className="ws-switch">
      <button className="ws-cur" onClick={toggle}><Icon name="users" size={14} /><span>{me.workspace ? me.workspace.name : 'My workspace'}{me.workspace && <small>{me.workspace.roleName || ROLE_NAME[me.workspace.role]}</small>}</span><Icon name="chevron" size={14} /></button>
      {open && list && (
        <div className="ws-menu">
          <button className={!list.current ? 'on' : ''} onClick={() => go(null)}>{list.own.name} <small>yours</small></button>
          {list.teams.map((t) => <button key={t.ownerId} className={list.current === t.ownerId ? 'on' : ''} onClick={() => go(t.ownerId)}>{t.name} <small>{t.roleName || ROLE_NAME[t.role]}</small></button>)}
        </div>
      )}
    </div>
  );
}

// ---------- Settings → Team → Roles & permissions ----------
const LEVEL_NAME = { none: 'None', view: 'View', edit: 'Edit' };
const summary = (areas, perms) => {
  const by = (lvl) => areas.filter((a) => perms[a.key] === lvl).map((a) => a.label.split(/[,&(]/)[0].trim());
  const e = by('edit'), v = by('view');
  return [e.length && `Edit: ${e.join(', ')}`, v.length && `View: ${v.join(', ')}`].filter(Boolean).join(' · ') || 'No access';
};

export function RolesSection({ onChange }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null); // { id?, name, perms, readOnly? }
  const [del, setDel] = useState(null); // { role, to }
  const load = () => api('/team/roles').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const blank = Object.fromEntries(d.areas.map((a) => [a.key, 'none']));
  const open = (r, copy) => setEdit(r ? { ...(copy ? {} : { id: r.id }), name: copy ? `${r.name} (copy)` : r.name, note: r.note, perms: { ...blank, ...r.perms }, readOnly: !copy && r.builtIn } : { name: '', perms: blank });
  const save = async () => {
    try {
      await (edit.id ? api(`/team/roles/${edit.id}`, 'PUT', { name: edit.name, perms: edit.perms }) : api('/team/roles', 'POST', { name: edit.name, perms: edit.perms }));
      toast(edit.id ? 'Role updated — it applies right away' : `Role “${edit.name}” created`);
      setEdit(null); load(); onChange?.();
    } catch (x) { toast(x.message); }
  };
  const remove = async (r) => {
    if (r.members) return setDel({ role: r, to: 'viewer' });
    if (!(await confirmDialog({ title: `Delete the role “${r.name}”?`, text: 'Nobody has it right now.', confirm: 'Delete', danger: true }))) return;
    try { await api(`/team/roles/${r.id}`, 'DELETE'); toast('Role deleted'); load(); onChange?.(); } catch (x) { toast(x.message); }
  };
  const confirmDel = async () => {
    try { const r = await api(`/team/roles/${del.role.id}`, 'DELETE', { replaceWith: del.to }); toast(`Role deleted — ${r.moved} moved`); setDel(null); load(); onChange?.(); } catch (x) { toast(x.message); }
  };
  return (
    <div className="roles-sec">
      <div className="row between"><h4>Roles &amp; permissions</h4>{d.canManage && <button className="btn sm" onClick={() => open(null)}><Icon name="plus" size={14} />New role</button>}</div>
      <table className="tbl compact roles-tbl"><tbody>
        {d.roles.map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b> {r.builtIn && <span className="pill">Built-in</span>}<small className="sub-t">{summary(d.areas, r.perms)}</small></td>
            <td className="muted sm">{r.members} {r.members === 1 ? 'person' : 'people'}</td>
            <td className="r"><div className="row end">
              {r.builtIn ? <button className="btn ghost sm" onClick={() => open(r)}>View</button> : d.canManage && <button className="btn ghost sm" onClick={() => open(r)}>Edit</button>}
              {d.canManage && <button className="btn ghost sm" title="New role starting from this one" onClick={() => open(r, true)}>Copy</button>}
              {d.canManage && !r.builtIn && <button className="icon-btn" title="Delete role" aria-label="Delete role" onClick={() => remove(r)}><Icon name="trash" size={15} /></button>}
            </div></td>
          </tr>
        ))}
      </tbody></table>
      {edit && (
        <Modal title={edit.readOnly ? `${edit.name} (built-in)` : edit.id ? 'Edit role' : 'New role'} onClose={() => setEdit(null)} width={720}>
          {edit.readOnly ? <p className="muted sm">Built-in roles can’t be changed. {edit.note} Copy it to make your own version.</p> : (
            <div className="row wrap role-head">
              <label className="grow">Role name<input autoFocus value={edit.name} maxLength={60} placeholder="e.g. Telecaller, Content writer" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>Start from<select value="" onChange={(e) => { const r = d.roles.find((x) => x.id === e.target.value); if (r) setEdit({ ...edit, perms: { ...blank, ...r.perms } }); }}>
                <option value="">Pick a role…</option>{d.roles.filter((r) => r.id !== edit.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
              <button className="btn ghost sm" type="button" onClick={() => setEdit({ ...edit, perms: blank })}>Clear all</button>
            </div>
          )}
          <table className="tbl compact perm-matrix">
            <thead><tr><th>Area</th><th className="r">Access</th></tr></thead>
            <tbody>{d.areas.map((a) => (
              <tr key={a.key}>
                <td><b>{a.label}</b><small className="sub-t">{a.desc}</small></td>
                <td className="r"><span className="seg sm" role="radiogroup" aria-label={a.label}>{['none', 'view', 'edit'].map((lvl) => {
                  const ok = a.levels.includes(lvl);
                  return <button key={lvl} type="button" role="radio" aria-checked={edit.perms[a.key] === lvl} className={edit.perms[a.key] === lvl ? 'on' : ''} disabled={edit.readOnly || !ok} title={ok ? '' : `${a.label}: ${a.levels.map((x) => LEVEL_NAME[x]).join(' or ')} only`} onClick={() => setEdit({ ...edit, perms: { ...edit.perms, [a.key]: lvl } })}>{LEVEL_NAME[lvl]}</button>;
                })}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="hint">View = can open and read; Edit = can also create, change and delete. Billing and deleting the account always stay with you.</p>
          <div className="row end">{edit.readOnly ? <button className="btn primary" onClick={() => setEdit(null)}>Close</button> : <><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.name.trim()} onClick={save}>{edit.id ? 'Save role' : 'Create role'}</button></>}</div>
        </Modal>
      )}
      {del && (
        <Modal title={`Delete “${del.role.name}”`} onClose={() => setDel(null)} width={460}>
          <p className="muted sm">{del.role.members} {del.role.members === 1 ? 'person has' : 'people have'} this role. Move them to:</p>
          <select value={del.to} onChange={(e) => setDel({ ...del, to: e.target.value })}>{d.roles.filter((r) => r.id !== del.role.id).map((r) => <option key={r.id} value={r.id}>{r.name}{r.builtIn ? ' (built-in)' : ''}</option>)}</select>
          <div className="row end"><button className="btn ghost" onClick={() => setDel(null)}>Cancel</button><button className="btn danger" onClick={confirmDel}>Move them and delete</button></div>
        </Modal>
      )}
    </div>
  );
}
