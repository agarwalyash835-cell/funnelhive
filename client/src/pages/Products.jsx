import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, num, ago } from '../ui';

const KIND = { course: ['Course', 'play'], download: ['Download', 'download'], link: ['Link', 'link'], empty: ['Empty', 'box'] };
export const bytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
const tokenHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('ff_token')}` });

export default function Products() {
  const { id } = useParams();
  return id ? <ProductEditor id={id} /> : <ProductList />;
}

// ---------- list ----------
function ProductList() {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => { api('/products').then(setD); }, []);
  const create = async (e) => {
    e.preventDefault();
    try { const p = await api('/products', 'POST', { name }); nav(`/products/${p.id}`); } catch (x) { toast(x.message); }
  };
  const buyers = (d?.products || []).reduce((s, p) => s + p.buyers, 0);
  return (
    <Layout title="Products" subtitle="What buyers get after they pay — files, links or a full course, delivered automatically." actions={<button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New product</button>}>
      {!d ? <div className="skeleton" /> : (
        <>
          {!d.payments && <div className="setup-warn"><Icon name="shield" size={18} /><div><b>Products are delivered only after a real payment.</b> Connect Razorpay in <Link to="/settings">Settings → Payments</Link> — demo checkouts never hand out files. Free products on opt-ins work right away.</div></div>}
          {!d.email.configured && <div className="setup-warn"><Icon name="send" size={18} /><div><b>Delivery emails are off.</b> Buyers still get an “Open your purchase” button on the thank-you page, but to email them their library link, connect email in <Link to="/settings">Settings → Email sending</Link>.</div></div>}
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Products</span><b className="kpi-v">{num(d.products.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Buyers with access</span><b className="kpi-v">{num(buyers)}</b></div>
            <div className="kpi"><span className="kpi-l">Storage used</span><b className="kpi-v">{bytes(d.storage.used)}</b><small>of {bytes(d.storage.max)}</small></div>
            <div className="kpi"><span className="kpi-l">Largest file</span><b className="kpi-v">{bytes(d.storage.fileMax)}</b><small>per upload</small></div>
          </div>
          {d.products.length > 0 && <p className="hint pr-recover">Buyers who lose their email can get their library link again at <a href={d.recoverUrl} target="_blank" rel="noreferrer">{d.recoverUrl}</a> <button className="icon-btn xs" title="Copy" onClick={() => { navigator.clipboard?.writeText(d.recoverUrl); toast('Link copied'); }}><Icon name="copy" size={12} /></button> — put it on your website or WhatsApp auto-reply.</p>}
          {!d.products.length ? (
            <Panel><Empty icon="box" title="No products yet" text="Upload an e-book, templates, a video course or add links — then pick the product on your checkout, order bump, upsell or a free opt-in. Buyers get instant access after paying.">
              <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Create your first product</button>
            </Empty></Panel>
          ) : (
            <div className="pr-grid">
              {d.products.map((p) => (
                <Link key={p.id} to={`/products/${p.id}`} className="pr-card">
                  <div className="pr-cover" style={p.cover ? { backgroundImage: `url("${p.cover}")` } : undefined}>{!p.cover && <Icon name={KIND[p.kind][1]} size={30} />}<span className={`pr-kind k-${p.kind}`}>{KIND[p.kind][0]}</span></div>
                  <div className="pr-body">
                    <h3>{p.name}</h3>
                    <p className="muted sm">{[p.lessons && `${p.lessons} lesson${p.lessons > 1 ? 's' : ''}`, p.files && `${p.files} file${p.files > 1 ? 's' : ''}`, p.links && `${p.links} link${p.links > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'Nothing added yet'}{p.bytes ? ` · ${bytes(p.bytes)}` : ''}</p>
                    <div className="pr-foot"><span><Icon name="users" size={14} /> {num(p.buyers)} buyer{p.buyers === 1 ? '' : 's'}</span><span className="muted sm">Updated {ago(p.updatedAt || p.at)}</span></div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {creating && (
        <Modal title="New product" onClose={() => setCreating(false)} width={480}>
          <form className="m-body" onSubmit={create}>
            <label className="fld"><span>Product name</span><input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Instagram Growth Playbook (PDF)" /></label>
            <p className="hint">Next you’ll add files, links or lessons. You can change everything later.</p>
            <div className="m-foot"><button type="button" className="btn ghost" onClick={() => setCreating(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()}>Create product</button></div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}

// ---------- one product ----------
function ProductEditor({ id }) {
  const nav = useNavigate();
  const [p, setP] = useState(null);
  const [saved, setSaved] = useState(null);
  const [tab, setTab] = useState('content');
  const [busy, setBusy] = useState(false);
  const load = () => api(`/products/${id}`).then((x) => { setP(x); setSaved(JSON.stringify(x)); }).catch((e) => { toast(e.message); nav('/products'); });
  useEffect(() => { load(); }, [id]);
  const dirty = p && saved && JSON.stringify(p) !== saved;
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  if (!p) return <Layout title="Product"><div className="skeleton" /></Layout>;
  const set = (patch) => setP({ ...p, ...patch });
  const save = async () => {
    setBusy(true);
    try {
      const x = await api(`/products/${id}`, 'PUT', { name: p.name, description: p.description, note: p.note, cover: p.cover, links: p.links, lessons: p.lessons, accessDays: p.accessDays, downloadLimit: p.downloadLimit });
      const next = { ...x, usage: p.usage };
      setP(next); setSaved(JSON.stringify(next)); toast('Product saved');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  // file changes are saved on the server right away; keep unsaved edits to everything else
  const onFiles = (product) => { const next = { ...p, files: product.files, lessons: p.lessons.map((l) => ({ ...l, fileIds: l.fileIds.filter((fid) => product.files.some((f) => f.id === fid)), videoFileId: product.files.some((f) => f.id === l.videoFileId) ? l.videoFileId : '' })) }; setP(next); setSaved(JSON.stringify({ ...JSON.parse(saved), files: product.files })); };
  const del = async () => {
    try { await api(`/products/${id}`, 'DELETE'); nav('/products'); toast('Product deleted'); } catch (e) {
      if (/buyer/.test(e.message) && confirm(`${e.message}\n\nDelete anyway?`)) { await api(`/products/${id}?confirm=1`, 'DELETE'); nav('/products'); toast('Product deleted'); } else if (!/buyer/.test(e.message)) toast(e.message);
    }
  };
  return (
    <Layout title={<span className="pr-title"><Link to="/products" className="crumb">Products</Link> <Icon name="chevron" size={14} /> {p.name || 'Untitled'}</span>} actions={<>
      {dirty && <span className="save-tag">Unsaved changes</span>}
      <button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="seg pr-tabs">
        {[['content', 'Content'], ['buyers', 'Buyers'], ['settings', 'Access & settings']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'content' && <ContentTab p={p} set={set} onFiles={onFiles} />}
      {tab === 'buyers' && <BuyersTab p={p} />}
      {tab === 'settings' && <SettingsTab p={p} set={set} onDelete={del} />}
    </Layout>
  );
}

function ContentTab({ p, set, onFiles }) {
  return (
    <div className="pr-cols">
      <div className="pr-main">
        <Panel title="About this product">
          <div className="form2c">
            <label className="fld"><span>Name</span><input value={p.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="fld"><span>Short description <small className="muted">· shown in the buyer’s library</small></span><textarea rows={2} maxLength={2000} value={p.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
            <label className="fld"><span>Welcome note <small className="muted">· optional, shown above the content</small></span><textarea rows={3} maxLength={4000} value={p.note || ''} onChange={(e) => set({ note: e.target.value })} placeholder="Start with lesson 1 — it takes 12 minutes. Questions? WhatsApp us anytime." /></label>
          </div>
        </Panel>
        <FilesPanel p={p} onFiles={onFiles} />
        <LinksPanel p={p} set={set} />
        <LessonsPanel p={p} set={set} />
      </div>
      <aside className="pr-side">
        <CoverPanel p={p} set={set} />
        <Panel title="How delivery works">
          <ol className="pr-how">
            <li>Pick this product on a <b>checkout</b>, <b>order bump</b>, <b>upsell</b>, <b>cross-sell</b> or a free <b>opt-in</b> in the funnel editor.</li>
            <li>After a verified payment the buyer sees <b>Open your purchase</b> on the thank-you page and gets their library link by email.</li>
            <li>Files download through private links that expire after 2 hours. Refunds remove access automatically.</li>
          </ol>
        </Panel>
        <Panel title="Sold in">
          {p.usage?.length ? <ul className="pr-usage">{p.usage.map((u, i) => <li key={i}><Link to={`/funnels/${u.funnelId}`}>{u.funnel}</Link><small className="muted"> · {u.step} · {u.as}</small></li>)}</ul>
            : <p className="muted sm">Not attached to any funnel yet. Open a funnel, select its checkout (or upsell, cross-sell, opt-in) and choose this product under <b>deliver after payment</b>.</p>}
        </Panel>
      </aside>
    </div>
  );
}

function CoverPanel({ p, set }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) return toast('Choose a PNG, JPG, WebP or GIF image');
    setBusy(true);
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const r = await api('/uploads', 'POST', { type: file.type, data });
      set({ cover: r.url });
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Panel title="Cover image">
      <div className="pr-cover big" style={p.cover ? { backgroundImage: `url("${p.cover}")` } : undefined} onClick={() => ref.current?.click()}>{!p.cover && <span><Icon name="plus" size={18} /> {busy ? 'Uploading…' : 'Add a cover (16:9)'}</span>}</div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
      {p.cover && <div className="row"><button className="btn ghost sm" onClick={() => ref.current?.click()}>Change</button><button className="btn ghost sm" onClick={() => set({ cover: '' })}>Remove</button></div>}
    </Panel>
  );
}

// Uploads go straight to disk on the server (no size limit in the browser), with progress
function uploadFile(productId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/products/${productId}/files`);
    for (const [k, v] of Object.entries(tokenHeader())) x.setRequestHeader(k, v);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    x.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || `Upload failed (${x.status})`)); };
    x.onerror = () => reject(new Error('Upload failed — check your connection and try again'));
    x.send(file);
  });
}

function FilesPanel({ p, onFiles }) {
  const ref = useRef(null);
  const [queue, setQueue] = useState([]);
  const [over, setOver] = useState(false);
  const add = async (files) => {
    for (const file of [...files]) {
      const key = `${file.name}-${Math.random()}`;
      setQueue((q) => [...q, { key, name: file.name, pct: 0 }]);
      try {
        const r = await uploadFile(p.id, file, (pct) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, pct } : x))));
        onFiles(r.product);
      } catch (e) { toast(`${file.name}: ${e.message}`); }
      setQueue((q) => q.filter((x) => x.key !== key));
    }
  };
  const remove = async (f) => {
    if (!confirm(`Delete ${f.name}? Buyers will no longer be able to download it.`)) return;
    try { onFiles(await api(`/products/${p.id}/files/${f.id}`, 'DELETE')); } catch (e) { toast(e.message); }
  };
  const download = async (f) => {
    const r = await fetch(`/api/products/${p.id}/files/${f.id}`, { headers: tokenHeader() });
    if (!r.ok) return toast('Download failed');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = f.name; a.click();
  };
  return (
    <Panel title={`Files${p.files.length ? ` (${p.files.length})` : ''}`}>
      <div className={`pr-drop ${over ? 'over' : ''}`} onClick={() => ref.current?.click()} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
        <Icon name="download" size={22} className="flip-y" /><b>Drop files here or click to upload</b><small>PDFs, e-books, templates, zips, audio, video — anything you sell</small>
      </div>
      <input ref={ref} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {queue.map((q) => <div key={q.key} className="pr-up"><span>{q.name}</span><div className="meter"><div style={{ width: `${Math.round(q.pct * 100)}%` }} /></div><small>{Math.round(q.pct * 100)}%</small></div>)}
      {p.files.length > 0 && (
        <table className="tbl compact pr-files"><tbody>{p.files.map((f) => (
          <tr key={f.id}><td><Icon name={/^video/.test(f.type) ? 'play' : 'clip'} size={15} /> {f.name}</td><td className="muted sm">{bytes(f.size)}</td>
            <td className="r"><button className="icon-btn" title="Download" onClick={() => download(f)}><Icon name="download" size={15} /></button><button className="icon-btn danger" title="Delete" onClick={() => remove(f)}><Icon name="trash" size={15} /></button></td></tr>
        ))}</tbody></table>
      )}
      {p.files.length > 0 && p.lessons.length > 0 && <p className="hint">Files used in a lesson appear inside that lesson; the rest are listed as downloads.</p>}
    </Panel>
  );
}

function LinksPanel({ p, set }) {
  const links = p.links || [];
  const upd = (i, k, v) => set({ links: links.map((l, n) => (n === i ? { ...l, [k]: v } : l)) });
  return (
    <Panel title="Links" actions={<button className="btn ghost sm" onClick={() => set({ links: [...links, { label: '', url: '' }] })}><Icon name="plus" size={14} /> Add link</button>}>
      {!links.length ? <p className="muted sm">Share something hosted elsewhere — a Notion page, Google Drive folder, Canva template, private Telegram group or community invite.</p> : links.map((l, i) => (
        <div key={i} className="pr-link">
          <input placeholder="Label, e.g. Join the private community" value={l.label} onChange={(e) => upd(i, 'label', e.target.value)} />
          <input placeholder="https://…" value={l.url} onChange={(e) => upd(i, 'url', e.target.value)} />
          <button className="icon-btn danger" onClick={() => set({ links: links.filter((_, n) => n !== i) })}><Icon name="trash" size={15} /></button>
        </div>
      ))}
    </Panel>
  );
}

function LessonsPanel({ p, set }) {
  const lessons = p.lessons || [];
  const [open, setOpen] = useState(null);
  const upd = (i, patch) => set({ lessons: lessons.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const move = (i, d) => { const a = [...lessons]; [a[i], a[i + d]] = [a[i + d], a[i]]; set({ lessons: a }); };
  const add = () => { set({ lessons: [...lessons, { id: `n${Date.now().toString(36)}`, title: `Lesson ${lessons.length + 1}`, section: lessons.at(-1)?.section || '', videoUrl: '', videoFileId: '', body: '', fileIds: [], dripDays: 0 }] }); setOpen(lessons.length); };
  const videos = p.files.filter((f) => /^video\//.test(f.type));
  return (
    <Panel title={`Course lessons${lessons.length ? ` (${lessons.length})` : ''}`} actions={<button className="btn ghost sm" onClick={add}><Icon name="plus" size={14} /> Add lesson</button>}>
      {!lessons.length ? <p className="muted sm">Turn this product into a course: each lesson can have a video (YouTube, Vimeo, Loom, Google Drive or an uploaded file), notes and downloads. Buyers get a course player with progress tracking. Use “unlocks after” to drip lessons out over time.</p> : (
        <div className="pr-lessons">{lessons.map((l, i) => (
          <div key={l.id} className={`pr-lesson ${open === i ? 'open' : ''}`}>
            <div className="pr-lh" onClick={() => setOpen(open === i ? null : i)}>
              <span className="num">{i + 1}</span>
              <div><b>{l.title || 'Untitled lesson'}</b><small className="muted">{[l.section, (l.videoUrl || l.videoFileId) && 'video', l.fileIds?.length && `${l.fileIds.length} file${l.fileIds.length > 1 ? 's' : ''}`, l.dripDays && `unlocks day ${l.dripDays}`].filter(Boolean).join(' · ')}</small></div>
              <span className="row" onClick={(e) => e.stopPropagation()}>
                {i > 0 && <button className="icon-btn xs" onClick={() => move(i, -1)}>↑</button>}
                {i < lessons.length - 1 && <button className="icon-btn xs" onClick={() => move(i, 1)}>↓</button>}
                <button className="icon-btn xs danger" onClick={() => set({ lessons: lessons.filter((_, n) => n !== i) })}><Icon name="x" size={12} /></button>
              </span>
            </div>
            {open === i && (
              <div className="pr-lb form2">
                <label className="fld"><span>Title</span><input value={l.title} maxLength={160} onChange={(e) => upd(i, { title: e.target.value })} /></label>
                <label className="fld"><span>Module / section <small className="muted">· groups lessons</small></span><input value={l.section} maxLength={80} placeholder="e.g. Week 1 — Foundations" onChange={(e) => upd(i, { section: e.target.value })} /></label>
                <label className="fld"><span>Video link</span><input value={l.videoUrl} placeholder="https://youtu.be/… (unlisted works)" onChange={(e) => upd(i, { videoUrl: e.target.value, ...(e.target.value ? { videoFileId: '' } : {}) })} /></label>
                <label className="fld"><span>…or an uploaded video</span><select value={l.videoFileId || ''} onChange={(e) => upd(i, { videoFileId: e.target.value, ...(e.target.value ? { videoUrl: '' } : {}) })}><option value="">{videos.length ? 'None' : 'Upload an MP4 in Files first'}</option>{videos.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
                <label className="fld full"><span>Notes</span><textarea rows={4} maxLength={20000} value={l.body} placeholder="Key points, homework, links…" onChange={(e) => upd(i, { body: e.target.value })} /></label>
                <div className="fld full"><span>Downloads in this lesson</span>
                  {p.files.length ? <div className="chips">{p.files.filter((f) => f.id !== l.videoFileId).map((f) => { const on = l.fileIds.includes(f.id); return <button key={f.id} type="button" className={on ? 'on' : ''} onClick={() => upd(i, { fileIds: on ? l.fileIds.filter((x) => x !== f.id) : [...l.fileIds, f.id] })}>{on ? '✓ ' : ''}{f.name}</button>; })}</div> : <small className="muted">Upload files above to attach them to lessons.</small>}
                </div>
                <label className="fld"><span>Unlocks after (days)</span><input type="number" min="0" max="3650" value={l.dripDays} onChange={(e) => upd(i, { dripDays: Number(e.target.value) || 0 })} /><small className="hint">0 = available immediately. Counted from the day of purchase.</small></label>
              </div>
            )}
          </div>
        ))}</div>
      )}
    </Panel>
  );
}

function BuyersTab({ p }) {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [g, setG] = useState({ email: '', name: '', notify: true });
  const load = () => api(`/products/${p.id}/buyers`).then(setRows);
  useEffect(() => { load(); }, [p.id]);
  const grant = async (e) => {
    e.preventDefault();
    try { const r = await api(`/products/${p.id}/grant`, 'POST', g); navigator.clipboard?.writeText(r.library); toast(g.notify ? 'Access given — we’ve emailed their library link (also copied)' : 'Access given — library link copied'); setG({ email: '', name: '', notify: true }); load(); } catch (x) { toast(x.message); }
  };
  const act = async (a, what) => {
    try {
      if (what === 'revoke') { if (!confirm(`Remove ${a.email}’s access to ${p.name}?`)) return; await api(`/access-admin/${a.id}/revoke`, 'POST'); }
      else if (what === 'restore') await api(`/access-admin/${a.id}/restore`, 'POST', {});
      else if (what === 'copy') { const r = await api(`/access-admin/${a.id}/link`, 'POST', {}); navigator.clipboard?.writeText(r.library); toast('Library link copied'); return; }
      else if (what === 'send') { const r = await api(`/access-admin/${a.id}/link`, 'POST', { send: true }); toast(r.emailed === 'sent' ? `Emailed ${a.email}` : 'Email isn’t set up — link copied instead'); if (r.emailed !== 'sent') navigator.clipboard?.writeText(r.library); return; }
      else if (what === 'reset') { if (!confirm('Give this buyer a new library link? The old link (and any copies they shared) stops working.')) return; const r = await api(`/access-admin/${a.id}/link`, 'POST', { reset: true, send: true }); toast(r.emailed === 'sent' ? 'New link emailed' : 'New link copied'); navigator.clipboard?.writeText(r.library); return; }
      load();
    } catch (e) { toast(e.message); }
  };
  const shown = (rows || []).filter((a) => `${a.email} ${a.name}`.toLowerCase().includes(q.toLowerCase()));
  const status = (a) => (a.revoked ? <span className="pill bad">{a.revokeReason === 'refunded' ? 'refunded' : 'removed'}</span> : a.expiresAt && a.expiresAt < Date.now() ? <span className="pill warn">expired</span> : <span className="pill ok">active</span>);
  return (
    <>
      <Panel title="Give access manually" className="pr-grant">
        <form className="pr-grant-f" onSubmit={grant}>
          <input type="email" required placeholder="buyer@email.com" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} />
          <input placeholder="Name (optional)" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
          <label className="tog"><input type="checkbox" checked={g.notify} onChange={(e) => setG({ ...g, notify: e.target.checked })} /><span />Email them the link</label>
          <button className="btn primary">Give access</button>
        </form>
        <p className="hint">For sales made outside your funnels (UPI transfers, offline, gifts).</p>
      </Panel>
      <Panel pad={false} title={`Buyers${rows ? ` (${num(rows.length)})` : ''}`} actions={<div className="search"><Icon name="search" size={16} /><input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
        {!rows ? <div className="skeleton" /> : !rows.length ? <Empty icon="users" title="No buyers yet" text="Everyone who buys or signs up for this product shows up here, with their downloads and course progress." /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Buyer</th><th>How</th><th>Since</th><th>Access</th><th className="r">Downloads</th>{p.lessons?.length > 0 && <th className="r">Lessons</th>}<th>Email</th><th /></tr></thead>
            <tbody>{shown.slice(0, 500).map((a) => (
              <tr key={a.id}><td><b>{a.name || '—'}</b><small className="sub-t">{a.email}</small></td><td className="muted sm">{a.via === 'manual' ? 'Added by you' : a.via === 'signup' ? 'Free sign-up' : 'Purchase'}</td>
                <td className="muted sm">{fmtDate(a.at)}</td><td>{status(a)}{a.expiresAt && !a.revoked && <small className="sub-t">until {fmtDate(a.expiresAt)}</small>}</td>
                <td className="r">{num(a.downloads)}</td>{p.lessons?.length > 0 && <td className="r">{a.lessonsDone}/{p.lessons.length}</td>}
                <td className="muted sm">{a.emailed === 'sent' ? '✓ sent' : a.emailed === 'failed' ? <span className="pill bad">failed</span> : a.emailed === 'not-configured' ? 'email off' : '—'}</td>
                <td className="r"><div className="row end">
                  <button className="icon-btn" title="Copy library link" onClick={() => act(a, 'copy')}><Icon name="link" size={15} /></button>
                  <button className="icon-btn" title="Email the library link again" onClick={() => act(a, 'send')}><Icon name="send" size={15} /></button>
                  <button className="icon-btn" title="New link (stops a shared link)" onClick={() => act(a, 'reset')}><Icon name="undo" size={15} /></button>
                  {a.revoked ? <button className="btn ghost sm" onClick={() => act(a, 'restore')}>Restore</button> : <button className="icon-btn danger" title="Remove access" onClick={() => act(a, 'revoke')}><Icon name="x" size={15} /></button>}
                </div></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

function SettingsTab({ p, set, onDelete }) {
  return (
    <div className="pr-cols">
      <div className="pr-main">
        <Panel title="Access">
          <div className="form2">
            <label className="fld"><span>Access lasts</span><select value={[0, 30, 90, 180, 365, 730].includes(p.accessDays) ? p.accessDays : 'custom'} onChange={(e) => e.target.value !== 'custom' && set({ accessDays: Number(e.target.value) })}>
              <option value={0}>Lifetime</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>6 months</option><option value={365}>1 year</option><option value={730}>2 years</option>{![0, 30, 90, 180, 365, 730].includes(p.accessDays) && <option value="custom">{p.accessDays} days</option>}
            </select><small className="hint">Counted from each buyer’s purchase. Changes apply to new buyers.</small></label>
            <label className="fld"><span>Downloads per file</span><input type="number" min="0" max="1000" value={p.downloadLimit} onChange={(e) => set({ downloadLimit: Number(e.target.value) || 0 })} /><small className="hint">0 = unlimited. Stops one buyer from passing files around; streaming lesson videos doesn’t count.</small></label>
          </div>
        </Panel>
        <Panel title="Protection built in">
          <ul className="checks sm">
            <li>Files are private — every download link is signed and expires after 2 hours.</li>
            <li>Library links are emailed only to the buyer; you can reset one if it gets shared.</li>
            <li>Nothing is delivered on demo checkouts — only after a verified Razorpay payment.</li>
            <li>Refunds (from Orders or your Razorpay dashboard) remove access automatically.</li>
          </ul>
        </Panel>
      </div>
      <aside className="pr-side">
        <Panel title="Danger zone">
          <p className="muted sm">Deleting this product removes its files and every buyer’s access. Invoices and orders are kept.</p>
          <button className="btn ghost danger" onClick={() => { if (confirm(`Delete ${p.name}?`)) onDelete(); }}><Icon name="trash" size={15} /> Delete product</button>
        </Panel>
      </aside>
    </div>
  );
}
