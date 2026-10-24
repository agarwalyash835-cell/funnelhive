// The vault's building blocks, shared by the Vault page and a CRM contact's Files tab (one store on the server):
// uploads with progress, file-type chips, previews, linking a file to contacts, share links.
import { useEffect, useRef, useState } from 'react';
import { FileText, FileImage, FileAudio, FileSpreadsheet, Presentation, File as FileIc, Download, Pencil, Trash2, Link2, X, Search, ExternalLink, Share2, Copy } from 'lucide-react';
import { api, fmtDate } from './api';
import { Modal, toast, confirmDialog, promptDialog, ago } from './ui';

export const FILE_MAX = 15 * 1024 * 1024;
export const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.mp3,.m4a,.wav,.ogg,.oga,.aac,.weba,.webm';
const EXTS = ACCEPT.split(',').map((x) => x.slice(1));
export const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
const extOf = (name) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase();

// kind → icon and colour chip
const KIND = {
  pdf: [FileText, 'pdf'], doc: [FileText, 'doc'], sheet: [FileSpreadsheet, 'sheet'], slides: [Presentation, 'slides'],
  text: [FileText, 'text'], image: [FileImage, 'image'], audio: [FileAudio, 'audio'],
};
export function FileChip({ f, size = 'md' }) {
  const [I, cls] = KIND[f.kind] || [FileIc, 'other'];
  return <span className={`vf-chip k-${cls} ${size}`} aria-hidden="true"><I size={size === 'lg' ? 22 : 16} /><em>{(f.ext || '').toUpperCase().slice(0, 4)}</em></span>;
}

const tokenHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('ff_token')}` });
// a quick check in the browser for a friendly message; the server checks again (type by content, size, quota)
export function precheck(file) {
  if (!EXTS.includes(extOf(file.name))) return 'This type of file can’t be stored — use PDF, Word, Excel, PowerPoint, text, images or audio';
  if (file.size > FILE_MAX) return `Too big — files can be up to 15 MB (this one is ${bytes(file.size)})`;
  if (!file.size) return 'That file is empty';
  return '';
}
// the raw file as the request body, with progress
export function uploadTo(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api${url}`);
    for (const [k, v] of Object.entries(tokenHeader())) x.setRequestHeader(k, v);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || `Upload failed (${x.status})`)); };
    x.onerror = () => reject(new Error('Upload failed — check your connection and try again'));
    x.send(file);
  });
}
// several files one after another; queue rows show progress. → the files that made it
export function useUploads(onDone) {
  const [queue, setQueue] = useState([]);
  const add = async (url, files) => {
    const done = [];
    for (const file of [...files]) {
      const bad = precheck(file);
      if (bad) { toast(`${file.name}: ${bad}`); continue; }
      const key = `${file.name}-${Math.random()}`;
      setQueue((q) => [...q, { key, name: file.name, pct: 0 }]);
      try { done.push(await uploadTo(url, file, (pct) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, pct } : x))))); } catch (e) { toast(`${file.name}: ${e.message}`); }
      setQueue((q) => q.filter((x) => x.key !== key));
    }
    if (done.length) { toast(done.length === 1 ? `${done[0].name} uploaded` : `${done.length} files uploaded`); onDone?.(done); }
    return done;
  };
  const bar = queue.length > 0 && <div className="vf-queue">{queue.map((q) => <div key={q.key} className="vf-up"><span>{q.name}</span><div className="meter"><div style={{ width: `${Math.round(q.pct * 100)}%` }} /></div><small>{Math.round(q.pct * 100)}%</small></div>)}</div>;
  return { add, bar, busy: queue.length > 0 };
}

export const linkOf = async (f, inline) => (await api(`/vault/files/${f.id}/link${inline ? '?inline=1' : ''}`)).url;
export async function downloadFile(f) {
  try { const a = document.createElement('a'); a.href = await linkOf(f, false); a.download = f.name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { toast(e.message); }
}
export async function renameFile(f) {
  const base = f.name.replace(/\.[a-z0-9]{1,5}$/i, '');
  const v = await promptDialog({ title: 'Rename file', label: 'Name', value: base, confirm: 'Rename' });
  if (v == null || !v.trim() || v.trim() === base) return null;
  try { return await api(`/vault/files/${f.id}`, 'PATCH', { name: v.trim() }); } catch (e) { toast(e.message); return null; }
}
export async function deleteFile(f) {
  const n = f.contacts?.length || 0;
  if (!await confirmDialog({ title: `Delete ${f.name}?`, text: n ? `It’s also removed from ${n === 1 ? f.contacts[0].name : `${n} contacts`}. This can’t be undone.` : 'This can’t be undone.', confirm: 'Delete', danger: true })) return false;
  try { await api(`/vault/files/${f.id}`, 'DELETE'); toast('File deleted'); return true; } catch (e) { toast(e.message); return false; }
}

// an image or audio file shown in place (a fresh short-lived link each time)
export function InlinePreview({ f }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let on = true; setUrl(''); if (f.preview && (f.kind === 'image' || f.kind === 'audio') && f.ext !== 'heic' && f.ext !== 'heif') linkOf(f, true).then((u) => on && setUrl(u)).catch(() => {}); return () => { on = false; }; }, [f.id]);
  if (!url) return null;
  if (f.kind === 'image') return <div className="vf-img"><img src={url} alt={f.name} loading="lazy" /></div>;
  return <audio className="vf-audio" controls preload="none" src={url}>Your browser can’t play this file.</audio>;
}

// pick a contact: search the CRM by name, email or phone
export function ContactPicker({ onPick, exclude = [], autoFocus }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return undefined; }
    const h = setTimeout(() => api(`/contacts?q=${encodeURIComponent(q.trim())}&limit=8`).then((d) => setHits((d.contacts || []).filter((c) => !exclude.includes(c.key)))).catch(() => setHits([])), 250);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className="vf-cpick">
      <label className="fld"><span>Find a contact</span><div className="vf-search"><Search size={15} /><input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" /></div></label>
      {hits && (hits.length ? (
        <ul className="vf-hits">{hits.map((c) => <li key={c.key}><button type="button" onClick={() => { onPick(c); setQ(''); }}><span className="vf-av">{(c.name || c.email || '?')[0].toUpperCase()}</span><span><b>{c.name || c.email || c.phone}</b><small>{[c.email, c.phone].filter(Boolean).join(' · ')}</small></span></button></li>)}</ul>
      ) : <p className="muted sm">No contacts match “{q}”.</p>)}
    </div>
  );
}

// Everything about one file: preview, linked contacts, share links, rename / download / delete
export function FileModal({ file, onClose, onChanged, folderName }) {
  const [f, setF] = useState(file);
  const set = (x) => { setF(x); onChanged?.(x); };
  const unlink = async (c) => { try { set(await api(`/vault/files/${f.id}/contacts/${encodeURIComponent(c.key)}`, 'DELETE')); } catch (e) { toast(e.message); } };
  const link = async (c) => { try { set(await api(`/vault/files/${f.id}/contacts`, 'POST', { key: c.key })); toast(`Linked to ${c.name || c.email || c.phone}`); } catch (e) { toast(e.message); } };
  const share = async (days) => {
    try {
      const s = await api(`/vault/files/${f.id}/shares`, 'POST', { days });
      set(await api(`/vault/files/${f.id}`));
      await navigator.clipboard?.writeText(s.url).catch(() => {});
      await promptDialog({ title: 'Share link ready', text: `Anyone with this link can download the file until ${fmtDate(s.expiresAt)}. It’s been copied.`, value: s.url, readOnly: true, confirm: 'Done', cancel: null });
    } catch (e) { toast(e.message); }
  };
  const revoke = async (s) => { try { await api(`/vault/shares/${s.id}`, 'DELETE'); set(await api(`/vault/files/${f.id}`)); toast('Link turned off'); } catch (e) { toast(e.message); } };
  return (
    <Modal title={f.name} onClose={onClose} width={560}>
      <div className="m-body vf-modal">
        <div className="vf-mhead"><FileChip f={f} size="lg" /><div><b>{bytes(f.size)}</b><small>{folderName ? `${folderName} · ` : ''}added {ago(f.at)}{f.by ? ` by ${f.by}` : ''}</small></div></div>
        <InlinePreview f={f} />
        <div className="vf-actions">
          <button className="btn primary sm" onClick={() => downloadFile(f)}><Download size={14} /> Download</button>
          {f.preview && f.kind === 'pdf' && <button className="btn ghost sm" onClick={async () => { const w = window.open('', '_blank', 'noopener'); try { const u = await linkOf(f, true); if (w) w.location = u; else location.href = u; } catch (e) { w?.close(); toast(e.message); } }}><ExternalLink size={14} /> Open</button>}
          <button className="btn ghost sm" onClick={async () => { const x = await renameFile(f); if (x) set(x); }}><Pencil size={14} /> Rename</button>
          <button className="btn ghost sm danger-t" onClick={async () => { if (await deleteFile(f)) { onChanged?.(null, f); onClose(); } }}><Trash2 size={14} /> Delete</button>
        </div>
        <h4 className="vf-h">Linked contacts</h4>
        {f.contacts.length ? <div className="vf-tags">{f.contacts.map((c) => <span key={c.key} className="vf-tag"><Link2 size={12} />{c.name}<button aria-label={`Unlink ${c.name}`} title="Unlink" onClick={() => unlink(c)}><X size={12} /></button></span>)}</div> : <p className="muted sm">Not linked yet — a linked file shows in that contact’s Files tab.</p>}
        <ContactPicker onPick={link} exclude={f.contacts.map((c) => c.key)} />
        <h4 className="vf-h">Share links</h4>
        {f.shares?.length > 0 && <ul className="vf-shares">{f.shares.map((s) => <li key={s.id}><Share2 size={13} /><span>Works until {fmtDate(s.expiresAt)}</span><button className="btn ghost sm" onClick={() => revoke(s)}>Turn off</button></li>)}</ul>}
        <div className="row"><button className="btn ghost sm" onClick={() => share(1)}><Copy size={14} /> Link for 1 day</button><button className="btn ghost sm" onClick={() => share(7)}><Copy size={14} /> Link for 7 days</button></div>
      </div>
    </Modal>
  );
}

// A CRM contact's Files tab (the same files as the vault)
export function ContactFiles({ ckey, onAdded }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const [over, setOver] = useState(false);
  const ref = useRef(null);
  const load = () => api(`/contacts/${encodeURIComponent(ckey)}/files`).then(setD).catch((e) => { toast(e.message); setD({ files: [] }); });
  useEffect(() => { load(); }, [ckey]);
  const up = useUploads(() => { load(); onAdded?.(); });
  const add = (files) => up.add(`/contacts/${encodeURIComponent(ckey)}/files`, files);
  if (!d) return <div className="skeleton" />;
  return (
    <div className="vf-contact">
      <div className={`vf-drop sm ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <b>Drop files or click to upload</b><small>PDF, Word, images, audio and office files · up to 15 MB each · kept in your Vault</small>
      </div>
      <input ref={ref} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {up.bar}
      {!d.files.length ? <p className="muted sm vf-none">No files yet. Upload a contract, prescription, voice note or photo — or link one from the Vault.</p> : (
        <ul className="vf-clist">{d.files.map((f) => (
          <li key={f.id}>
            <button type="button" className="vf-crow" onClick={() => setOpen(f)}><FileChip f={f} /><span className="vf-cname"><b>{f.name}</b><small>{bytes(f.size)} · {f.by ? `${f.by} · ` : ''}{ago(f.at)}</small></span></button>
            <div className="vf-cact">
              <button className="icon-btn xs" title="Download" aria-label="Download" onClick={() => downloadFile(f)}><Download size={14} /></button>
              <button className="icon-btn xs" title="Rename" aria-label="Rename" onClick={async () => { if (await renameFile(f)) load(); }}><Pencil size={14} /></button>
              <button className="icon-btn xs danger" title="Delete" aria-label="Delete" onClick={async () => { if (await deleteFile(f)) load(); }}><Trash2 size={14} /></button>
            </div>
            {(f.kind === 'image' || f.kind === 'audio') && <InlinePreview f={f} />}
          </li>
        ))}</ul>
      )}
      {open && <FileModal file={open} onClose={() => setOpen(null)} onChanged={() => load()} />}
    </div>
  );
}
