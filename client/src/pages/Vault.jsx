// Vault: the business's private files (folders, subfolders, linked to CRM contacts), saved passwords and secure notes
import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderPlus, FolderInput, Upload, Search, LayoutGrid, List, ChevronRight, Home, Pencil, Trash2, Download, KeyRound, StickyNote, Eye, EyeOff, Copy, ExternalLink, Wand2, Plus, Lock, Link2, HardDrive, Inbox } from 'lucide-react';
import { api } from '../api';
import { Layout, Panel, Empty, Modal, toast, confirmDialog, promptDialog, ago } from '../ui';
import { FileChip, FileModal, InlinePreview, ContactPicker, useUploads, downloadFile, renameFile, deleteFile, bytes, ACCEPT } from '../vaultKit';

const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

export default function Vault() {
  const [ov, setOv] = useState(null);
  const [tab, setTab] = useState('files');
  const load = () => api('/vault').then(setOv).catch((e) => { toast(e.message); setOv((o) => o || { folders: [], usage: { used: 0, limit: 1 }, secrets: null, failed: true }); });
  useEffect(() => { load(); }, []);
  const u = ov?.usage;
  const pct = u ? Math.min(100, Math.round((u.used / Math.max(1, u.limit)) * 100)) : 0;
  return (
    <Layout title="Vault" subtitle="Files, passwords and notes for your business — private to your account"
      actions={u && <div className={`vt-usage ${pct >= 90 ? 'full' : ''}`} title={`${bytes(u.used)} of ${bytes(u.limit)} used`}><HardDrive size={15} /><div><span>{bytes(u.used)} <small>of {bytes(u.limit)}</small></span><div className="meter"><div style={{ width: `${Math.max(pct, u.used ? 2 : 0)}%` }} /></div></div></div>}>
      <div className="vt-tabs seg" role="tablist">
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}><Folder size={14} /> Files</button>
        {ov?.secrets && <button role="tab" aria-selected={tab === 'password'} className={tab === 'password' ? 'on' : ''} onClick={() => setTab('password')}><KeyRound size={14} /> Passwords</button>}
        {ov?.secrets && <button role="tab" aria-selected={tab === 'note'} className={tab === 'note' ? 'on' : ''} onClick={() => setTab('note')}><StickyNote size={14} /> Secure notes</button>}
      </div>
      {!ov ? <div className="skeleton" /> : tab === 'files' ? <Files ov={ov} reload={load} /> : <Secrets kind={tab} />}
    </Layout>
  );
}

// ---------------- files ----------------
function Files({ ov, reload }) {
  const [here, setHere] = useState(null); // folder id, or null for the top
  const [files, setFiles] = useState(null);
  const [q, setQ] = useState('');
  const [view, setView] = useState(() => LS.get('ff_vault_view', 'list'));
  const [open, setOpen] = useState(null);
  const [moving, setMoving] = useState(null);
  const [over, setOver] = useState(false);
  const ref = useRef(null);
  const folders = ov.folders;
  const byId = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders]);
  const trail = useMemo(() => { const t = []; let cur = byId[here]; while (cur && t.length < 20) { t.unshift(cur); cur = byId[cur.parentId]; } return t; }, [here, byId]);
  const subs = folders.filter((f) => (f.parentId || null) === here).sort((a, b) => (b.system ? 1 : 0) - (a.system ? 1 : 0) || a.name.localeCompare(b.name));
  const searching = q.trim().length > 0;
  const loadFiles = () => api(searching ? `/vault/files?q=${encodeURIComponent(q.trim())}` : `/vault/files?folder=${here || 'root'}`).then(setFiles).catch((e) => { toast(e.message); setFiles([]); });
  useEffect(() => { setFiles(null); const h = setTimeout(loadFiles, searching ? 250 : 0); return () => clearTimeout(h); }, [here, q]);
  useEffect(() => { if (here && !byId[here]) setHere(null); }, [byId]);
  const up = useUploads(() => { loadFiles(); reload(); });
  const add = (list) => up.add(`/vault/files?folder=${here || 'root'}`, list);
  const setView2 = (v) => { setView(v); LS.set('ff_vault_view', v); };
  const totalIn = (id) => { let n = 0; const walk = (x) => { n += byId[x]?.files || 0; folders.filter((f) => f.parentId === x).forEach((f) => walk(f.id)); }; walk(id); return n; };

  const newFolder = async () => {
    const name = await promptDialog({ title: here ? `New folder in ${byId[here]?.name}` : 'New folder', label: 'Folder name', placeholder: 'e.g. Contracts', confirm: 'Create' });
    if (!name?.trim()) return;
    try { await api('/vault/folders', 'POST', { name: name.trim(), parentId: here }); reload(); toast('Folder created'); } catch (e) { toast(e.message); }
  };
  const renameFolder = async (f) => {
    const name = await promptDialog({ title: 'Rename folder', label: 'Folder name', value: f.name, confirm: 'Rename' });
    if (!name?.trim() || name.trim() === f.name) return;
    try { await api(`/vault/folders/${f.id}`, 'PATCH', { name: name.trim() }); reload(); } catch (e) { toast(e.message); }
  };
  const deleteFolder = async (f) => {
    const n = totalIn(f.id), kids = folders.filter((x) => x.parentId === f.id).length;
    const text = n || kids ? `This deletes the folder${kids ? ', its subfolders' : ''} and ${n} file${n === 1 ? '' : 's'} inside${n ? ' — they’re removed from any contacts they’re linked to' : ''}. This can’t be undone.` : 'The folder is empty.';
    if (!await confirmDialog({ title: `Delete “${f.name}”?`, text, confirm: 'Delete', danger: true })) return;
    try { await api(`/vault/folders/${f.id}`, 'DELETE'); if (trail.some((x) => x.id === f.id)) setHere(f.parentId || null); reload(); toast('Folder deleted'); } catch (e) { toast(e.message); }
  };
  const onChanged = (x, gone) => { if (gone || !x) { loadFiles(); reload(); return; } setFiles((l) => l?.map((f) => (f.id === x.id ? x : f))); };
  const pathOf = (fid) => { const t = []; let cur = byId[fid]; while (cur && t.length < 20) { t.unshift(cur.name); cur = byId[cur.parentId]; } return t.join(' / ') || 'Vault'; };
  const empty = files && !files.length && (searching || !subs.length);

  return (
    <div className={`vt-files ${over ? 'dragging' : ''}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
      <aside className="vt-tree" aria-label="Folders">
        <button className={`vt-node ${!here ? 'on' : ''}`} onClick={() => { setHere(null); setQ(''); }}><Home size={15} /><span>All files</span>{ov.rootFiles > 0 && <small>{ov.rootFiles}</small>}</button>
        <Tree folders={folders} parent={null} here={here} go={(id) => { setHere(id); setQ(''); }} depth={0} />
      </aside>
      <Panel className="vt-main" pad={false}>
        <div className="vt-bar">
          <nav className="vt-crumbs" aria-label="Folder path">
            {searching ? <span className="vt-crumb on">Search results</span> : <>
              <button className={`vt-crumb ${!here ? 'on' : ''}`} onClick={() => setHere(null)}><Home size={14} /> Vault</button>
              {trail.map((f) => <span key={f.id} className="vt-crumb-w"><ChevronRight size={13} /><button className={`vt-crumb ${f.id === here ? 'on' : ''}`} onClick={() => setHere(f.id)}>{f.name}</button></span>)}
            </>}
          </nav>
          <div className="vt-tools">
            <div className="vf-search vt-q"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all files" aria-label="Search all files" /></div>
            <div className="seg sm" role="group" aria-label="View">
              <button className={view === 'list' ? 'on' : ''} title="List" aria-label="List view" onClick={() => setView2('list')}><List size={14} /></button>
              <button className={view === 'grid' ? 'on' : ''} title="Grid" aria-label="Grid view" onClick={() => setView2('grid')}><LayoutGrid size={14} /></button>
            </div>
            <button className="btn ghost sm" onClick={newFolder}><FolderPlus size={14} /> <span className="vt-hide-s">New folder</span></button>
            <button className="btn primary sm" onClick={() => ref.current?.click()}><Upload size={14} /> Upload</button>
            <input ref={ref} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          </div>
        </div>
        {up.bar}
        {here && byId[here]?.system === 'crm' && !searching && <p className="vt-note"><Link2 size={14} /> Files uploaded on a CRM contact land here, linked to that contact. Move them anywhere — the link stays.</p>}
        {!searching && subs.length > 0 && (
          <div className="vt-folders">{subs.map((f) => (
            <div key={f.id} className={`vt-folder ${f.system ? 'sys' : ''}`}>
              <button className="vt-fopen" onClick={() => setHere(f.id)} onDragOver={(e) => e.preventDefault()}><span className="vt-fic">{f.system ? <Inbox size={18} /> : <Folder size={18} />}</span><span><b>{f.name}</b><small>{totalIn(f.id) === 1 ? '1 file' : `${totalIn(f.id)} files`}</small></span></button>
              {!f.system && <div className="vt-fact">
                <button className="icon-btn xs" title="Rename" aria-label={`Rename ${f.name}`} onClick={() => renameFolder(f)}><Pencil size={13} /></button>
                <button className="icon-btn xs" title="Move" aria-label={`Move ${f.name}`} onClick={() => setMoving({ folder: f })}><FolderInput size={13} /></button>
                <button className="icon-btn xs danger" title="Delete" aria-label={`Delete ${f.name}`} onClick={() => deleteFolder(f)}><Trash2 size={13} /></button>
              </div>}
            </div>
          ))}</div>
        )}
        {!files ? <div className="vt-pad"><div className="skeleton" /></div> : empty ? (
          searching ? <Empty icon="search" title="Nothing found" text={`No file names contain “${q.trim()}”.`} /> : (
            <div className="vt-empty" role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}>
              <span className="vt-empty-ic"><Lock size={24} /></span>
              <h3>{here ? 'This folder is empty' : 'Your vault is ready'}</h3>
              <p>Drop files here or click to upload — contracts, ID proofs, prescriptions, invoices, photos, voice notes. PDF, Word, Excel, PowerPoint, images and audio, up to 15 MB each.</p>
              <span className="btn primary sm"><Upload size={14} /> Upload files</span>
            </div>
          )
        ) : files.length > 0 && (view === 'grid' ? (
          <div className="vt-grid">{files.map((f) => (
            <button key={f.id} className="vt-card" onClick={() => setOpen(f)}>
              {f.kind === 'image' && f.preview ? <InlinePreview f={f} /> : <div className="vt-card-ic"><FileChip f={f} size="lg" /></div>}
              <b title={f.name}>{f.name}</b>
              <small>{bytes(f.size)} · {ago(f.at)}</small>
              {f.contacts.length > 0 && <span className="vt-linked"><Link2 size={11} /> {f.contacts.length === 1 ? f.contacts[0].name : `${f.contacts.length} contacts`}</span>}
            </button>
          ))}</div>
        ) : (
          <ul className="vt-list">{files.map((f) => (
            <li key={f.id} className="vt-row">
              <button className="vt-rmain" onClick={() => setOpen(f)}>
                <FileChip f={f} />
                <span className="vt-rname"><b>{f.name}</b><small>{bytes(f.size)} · {f.by ? `${f.by} · ` : ''}{ago(f.at)}{searching ? ` · ${pathOf(f.folderId)}` : ''}</small></span>
                {f.contacts.length > 0 && <span className="vt-linked"><Link2 size={11} /> {f.contacts.length === 1 ? f.contacts[0].name : `${f.contacts.length} contacts`}</span>}
              </button>
              <div className="vt-ract">
                <button className="icon-btn xs" title="Download" aria-label="Download" onClick={() => downloadFile(f)}><Download size={14} /></button>
                <button className="icon-btn xs" title="Rename" aria-label="Rename" onClick={async () => { const x = await renameFile(f); if (x) onChanged(x); }}><Pencil size={14} /></button>
                <button className="icon-btn xs" title="Move" aria-label="Move" onClick={() => setMoving({ file: f })}><FolderInput size={14} /></button>
                <button className="icon-btn xs danger" title="Delete" aria-label="Delete" onClick={async () => { if (await deleteFile(f)) onChanged(null, f); }}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}</ul>
        ))}
        {over && <div className="vt-dropzone"><Upload size={26} /><b>Drop to upload{here ? ` to ${byId[here]?.name}` : ''}</b></div>}
      </Panel>
      {open && <FileModal file={open} folderName={open.folderId ? byId[open.folderId]?.name : 'Vault'} onClose={() => setOpen(null)} onChanged={(x, gone) => { onChanged(x, gone); if (x) setOpen(x); }} />}
      {moving && <MoveModal what={moving} folders={folders} onClose={() => setMoving(null)} onMoved={() => { setMoving(null); loadFiles(); reload(); }} />}
    </div>
  );
}

function Tree({ folders, parent, here, go, depth }) {
  const kids = folders.filter((f) => (f.parentId || null) === parent).sort((a, b) => (b.system ? 1 : 0) - (a.system ? 1 : 0) || a.name.localeCompare(b.name));
  if (!kids.length) return null;
  return kids.map((f) => (
    <div key={f.id}>
      <button className={`vt-node ${here === f.id ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => go(f.id)}>{f.system ? <Inbox size={15} /> : <Folder size={15} />}<span>{f.name}</span>{f.files > 0 && <small>{f.files}</small>}</button>
      {depth < 8 && <Tree folders={folders} parent={f.id} here={here} go={go} depth={depth + 1} />}
    </div>
  ));
}

// move a file or a folder: pick where it goes
function MoveModal({ what, folders, onClose, onMoved }) {
  const item = what.file || what.folder;
  const [to, setTo] = useState(what.file ? what.file.folderId || 'root' : what.folder.parentId || 'root');
  // a folder can't go inside itself or below it
  const blocked = new Set();
  if (what.folder) { const walk = (id) => { blocked.add(id); folders.filter((f) => f.parentId === id).forEach((f) => walk(f.id)); }; walk(what.folder.id); }
  const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
  const label = (f) => { const t = []; let cur = f; while (cur && t.length < 20) { t.unshift(cur.name); cur = byId[cur.parentId]; } return t.join(' / '); };
  const options = folders.filter((f) => !blocked.has(f.id) && !(what.folder && f.system)).map((f) => [f.id, label(f)]).sort((a, b) => a[1].localeCompare(b[1]));
  const save = async () => {
    try {
      if (what.file) await api(`/vault/files/${item.id}`, 'PATCH', { folderId: to });
      else await api(`/vault/folders/${item.id}`, 'PATCH', { parentId: to });
      toast('Moved'); onMoved();
    } catch (e) { toast(e.message); }
  };
  return (
    <Modal title={`Move “${item.name}”`} onClose={onClose} width={440}>
      <div className="m-body">
        <label className="fld"><span>Move to</span><select value={to} onChange={(e) => setTo(e.target.value)}><option value="root">Vault (top level)</option>{options.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
        <div className="m-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Move</button></div>
      </div>
    </Modal>
  );
}

// ---------------- passwords and secure notes ----------------
const LOWER = 'abcdefghijkmnopqrstuvwxyz', UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGITS = '23456789', SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
const rand = (n) => { const a = new Uint32Array(1); const lim = Math.floor(0x100000000 / n) * n; do crypto.getRandomValues(a); while (a[0] >= lim); return a[0] % n; };
// a strong random password: every chosen character set at least once, shuffled (crypto.getRandomValues, no modulo bias)
export function generatePassword(len = 20, { symbols = true, digits = true, upper = true } = {}) {
  const sets = [LOWER, upper && UPPER, digits && DIGITS, symbols && SYMBOLS].filter(Boolean);
  const all = sets.join('');
  const out = sets.map((s) => s[rand(s.length)]);
  while (out.length < len) out.push(all[rand(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rand(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}
const strength = (p) => {
  if (!p) return [0, ''];
  const pool = (/[a-z]/.test(p) ? 26 : 0) + (/[A-Z]/.test(p) ? 26 : 0) + (/\d/.test(p) ? 10 : 0) + (/[^a-zA-Z0-9]/.test(p) ? 30 : 0);
  const bits = p.length * Math.log2(Math.max(pool, 2));
  return bits >= 100 ? [4, 'Very strong'] : bits >= 70 ? [3, 'Strong'] : bits >= 45 ? [2, 'Fair'] : [1, 'Weak'];
};
const copyText = async (t, what) => { try { await navigator.clipboard.writeText(t); toast(`${what} copied`); } catch { toast('Couldn’t copy — your browser blocked the clipboard'); } };

function Secrets({ kind }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [shown, setShown] = useState({}); // id → revealed { password, notes }
  const load = () => api(`/vault/secrets?kind=${kind}`).then(setList).catch((e) => { toast(e.message); setList([]); });
  useEffect(() => { setList(null); setShown({}); load(); }, [kind]);
  // revealed passwords hide again after 30 seconds
  useEffect(() => { if (!Object.keys(shown).length) return undefined; const h = setTimeout(() => setShown({}), 30000); return () => clearTimeout(h); }, [shown]);
  const reveal = async (s) => { const r = await api(`/vault/secrets/${s.id}/reveal`, 'POST'); setShown((x) => ({ ...x, [s.id]: r })); return r; };
  const toggle = async (s) => { if (shown[s.id]) { setShown(({ [s.id]: _, ...rest }) => rest); return; } try { await reveal(s); } catch (e) { toast(e.message); } };
  const copyPw = async (s) => { try { const r = shown[s.id] || await reveal(s); await copyText(r.password, 'Password'); } catch (e) { toast(e.message); } };
  const remove = async (s) => {
    if (!await confirmDialog({ title: `Delete “${s.title}”?`, text: kind === 'note' ? 'The note is deleted for good.' : 'The saved password is deleted for good.', confirm: 'Delete', danger: true })) return;
    try { await api(`/vault/secrets/${s.id}`, 'DELETE'); load(); toast('Deleted'); } catch (e) { toast(e.message); }
  };
  const openEdit = async (s) => { try { setEdit({ ...s, ...(shown[s.id] || await reveal(s)) }); } catch (e) { toast(e.message); } };
  const s0 = q.trim().toLowerCase();
  const rows = (list || []).filter((s) => !s0 || `${s.title} ${s.username} ${s.url} ${s.category} ${s.contact?.name || ''}`.toLowerCase().includes(s0));
  const isPw = kind === 'password';
  return (
    <Panel pad={false} className="vt-secrets">
      <div className="vt-bar">
        <div className="vt-sec-h"><Lock size={15} /><span>{isPw ? 'Encrypted on our servers. A password is shown only when you ask, and every view is recorded in your activity log.' : 'Encrypted notes — bank details, licence keys, recovery codes. Opening one is recorded in your activity log.'}</span></div>
        <div className="vt-tools">
          <div className="vf-search vt-q"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isPw ? 'Search passwords' : 'Search notes'} aria-label="Search" /></div>
          <button className="btn primary sm" onClick={() => setEdit({ kind, title: '', username: '', password: isPw ? generatePassword() : '', url: '', notes: '', category: '' })}><Plus size={14} /> {isPw ? 'New password' : 'New note'}</button>
        </div>
      </div>
      {!list ? <div className="vt-pad"><div className="skeleton" /></div> : !rows.length ? (
        q ? <Empty icon="search" title="Nothing found" text={`Nothing matches “${q}”.`} /> : isPw
          ? <Empty icon="shield" title="No saved passwords yet" text="Keep logins for your payment gateway, ad accounts, domain and hosting in one encrypted place your admins can reach."><button className="btn primary" onClick={() => setEdit({ kind, title: '', username: '', password: generatePassword(), url: '', notes: '', category: '' })}><Plus size={14} /> Add a password</button></Empty>
          : <Empty icon="bookmark" title="No secure notes yet" text="Bank details, GST logins, licence keys, recovery codes — encrypted and out of your chats."><button className="btn primary" onClick={() => setEdit({ kind, title: '', notes: '', category: '' })}><Plus size={14} /> Add a note</button></Empty>
      ) : (
        <ul className="vt-slist">{rows.map((s) => (
          <li key={s.id} className="vt-srow">
            <span className={`vt-sic ${isPw ? 'pw' : 'nt'}`}>{isPw ? <KeyRound size={17} /> : <StickyNote size={17} />}</span>
            <div className="vt-smain">
              <div className="vt-stitle"><b>{s.title}</b>{s.category && <span className="vt-cat">{s.category}</span>}{s.contact && <span className="vt-linked"><Link2 size={11} /> {s.contact.name}</span>}</div>
              {isPw ? (
                <div className="vt-sfields">
                  {s.username && <span className="vt-sf"><small>User</small><code>{s.username}</code><button className="icon-btn xs" title="Copy username" aria-label="Copy username" onClick={() => copyText(s.username, 'Username')}><Copy size={12} /></button></span>}
                  {s.hasPassword && <span className="vt-sf"><small>Password</small><code className={shown[s.id] ? '' : 'mask'}>{shown[s.id] ? shown[s.id].password : '••••••••••'}</code>
                    <button className="icon-btn xs" title={shown[s.id] ? 'Hide' : 'Show'} aria-label={shown[s.id] ? 'Hide password' : 'Show password'} onClick={() => toggle(s)}>{shown[s.id] ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    <button className="icon-btn xs" title="Copy password" aria-label="Copy password" onClick={() => copyPw(s)}><Copy size={12} /></button></span>}
                  {s.url && <a className="vt-sf link" href={s.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{s.url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 40)}</a>}
                </div>
              ) : (
                shown[s.id] ? <p className="vt-note-body">{shown[s.id].notes}</p> : <small className="muted">Updated {ago(s.updatedAt || s.at)}</small>
              )}
            </div>
            <div className="vt-ract">
              {!isPw && <button className="icon-btn xs" title={shown[s.id] ? 'Hide' : 'Show'} aria-label={shown[s.id] ? 'Hide note' : 'Show note'} onClick={() => toggle(s)}>{shown[s.id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
              <button className="icon-btn xs" title="Edit" aria-label="Edit" onClick={() => openEdit(s)}><Pencil size={14} /></button>
              <button className="icon-btn xs danger" title="Delete" aria-label="Delete" onClick={() => remove(s)}><Trash2 size={14} /></button>
            </div>
          </li>
        ))}</ul>
      )}
      {edit && <SecretModal s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setShown({}); load(); }} />}
    </Panel>
  );
}

function SecretModal({ s, onClose, onSaved }) {
  const isPw = s.kind === 'password';
  const [v, setV] = useState({ title: s.title || '', username: s.username || '', password: s.password || '', url: s.url || '', notes: s.notes || '', category: s.category || '' });
  const [contact, setContact] = useState(s.contact || null);
  const [show, setShow] = useState(!s.id);
  const [gen, setGen] = useState({ len: 20, symbols: true });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const [lvl, word] = strength(v.password);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = isPw ? { ...v, contact: contact?.key || '' } : { title: v.title, notes: v.notes, category: v.category, contact: contact?.key || '' };
    try { await api(s.id ? `/vault/secrets/${s.id}` : '/vault/secrets', s.id ? 'PATCH' : 'POST', { kind: s.kind, ...body }); toast('Saved'); onSaved(); } catch (x) { toast(x.message); setBusy(false); }
  };
  return (
    <Modal title={s.id ? `Edit ${isPw ? 'password' : 'note'}` : isPw ? 'New password' : 'New secure note'} onClose={onClose} width={520}>
      <form className="m-body vt-sform" onSubmit={save} autoComplete="off">
        <label className="fld"><span>Title</span><input autoFocus value={v.title} onChange={set('title')} placeholder={isPw ? 'e.g. Razorpay dashboard' : 'e.g. Bank account details'} required maxLength={120} /></label>
        {isPw && <>
          <div className="vt-2">
            <label className="fld"><span>Username or email</span><input value={v.username} onChange={set('username')} autoComplete="off" maxLength={200} /></label>
            <label className="fld"><span>Website <small>· optional</small></span><input value={v.url} onChange={set('url')} placeholder="https://" maxLength={500} /></label>
          </div>
          <label className="fld"><span>Password</span>
            <div className="vt-pw">
              <input type={show ? 'text' : 'password'} value={v.password} onChange={set('password')} autoComplete="new-password" spellCheck={false} maxLength={500} />
              <button type="button" className="icon-btn" title={show ? 'Hide' : 'Show'} aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              <button type="button" className="icon-btn" title="Copy" aria-label="Copy password" onClick={() => copyText(v.password, 'Password')}><Copy size={15} /></button>
            </div>
          </label>
          <div className={`vt-strength s${lvl}`}><i /><i /><i /><i /><span>{word}</span></div>
          <div className="vt-gen">
            <button type="button" className="btn ghost sm" onClick={() => { setV({ ...v, password: generatePassword(gen.len, { symbols: gen.symbols }) }); setShow(true); }}><Wand2 size={14} /> Generate</button>
            <label className="vt-len"><span>{gen.len} characters</span><input type="range" min={12} max={48} value={gen.len} onChange={(e) => setGen({ ...gen, len: Number(e.target.value) })} aria-label="Length" /></label>
            <label className="vt-chk"><input type="checkbox" checked={gen.symbols} onChange={(e) => setGen({ ...gen, symbols: e.target.checked })} /> Symbols</label>
          </div>
        </>}
        <label className="fld"><span>{isPw ? <>Notes <small>· optional, encrypted</small></> : 'Note (encrypted)'}</span><textarea rows={isPw ? 3 : 7} value={v.notes} onChange={set('notes')} maxLength={20000} /></label>
        <label className="fld"><span>Category <small>· optional</small></span><input value={v.category} onChange={set('category')} placeholder="e.g. Payments, Ads, Banking" maxLength={60} /></label>
        <div className="fld"><span>Linked contact <small>· optional</small></span>
          {contact ? <div className="vf-tags"><span className="vf-tag"><Link2 size={12} />{contact.name || contact.email || contact.phone}<button type="button" aria-label="Unlink" onClick={() => setContact(null)}>×</button></span></div> : <ContactPicker onPick={(c) => setContact({ key: c.key, name: c.name || c.email || c.phone })} />}
        </div>
        <div className="m-foot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !v.title.trim()}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}
