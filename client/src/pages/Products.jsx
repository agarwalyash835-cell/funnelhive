import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, Modal, toast, num, ago, confirmDialog, loadFailed } from '../ui';

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
  useEffect(() => { api('/products').then(setD).catch(loadFailed); }, []);
  const create = async (e) => {
    e.preventDefault();
    try { const p = await api('/products', 'POST', { name }); nav(`/products/${p.id}`); } catch (x) { toast(x.message); }
  };
  const buyers = (d?.products || []).reduce((s, p) => s + p.buyers, 0);
  return (
    <Layout title="Products" subtitle="What buyers get after they pay — files, links or a full course, delivered automatically." actions={<button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New product</button>}>
      {!d ? <div className="skeleton" /> : (
        <>
          {!d.payments && <div className="setup-warn"><Icon name="shield" size={18} /><div><b>Products are delivered only after a real payment.</b> Connect Razorpay or Stripe in <Link to="/settings">Settings → Payments</Link> — demo checkouts never hand out files. Free products on opt-ins work right away.</div></div>}
          {!d.email.configured && <div className="setup-warn"><Icon name="send" size={18} /><div><b>Delivery emails are off.</b> Buyers still get an “Open your purchase” button on the thank-you page, but to email them their library link, connect email in <Link to="/settings">Settings → Email sending</Link>.</div></div>}
          <div className="kpis k4">
            <div className="kpi"><span className="kpi-l">Products</span><b className="kpi-v">{num(d.products.length)}</b></div>
            <div className="kpi"><span className="kpi-l">Buyers with access</span><b className="kpi-v">{num(buyers)}</b></div>
            <div className="kpi"><span className="kpi-l">Storage used</span><b className="kpi-v">{bytes(d.storage.used)}</b><small>of {bytes(d.storage.max)}</small></div>
            <div className="kpi"><span className="kpi-l">Largest file</span><b className="kpi-v">{bytes(d.storage.fileMax)}</b><small>per upload</small></div>
          </div>
          {d.products.length > 0 && <p className="hint pr-recover">Buyers who lose their email can get their library link again at <a href={d.recoverUrl} target="_blank" rel="noreferrer">{d.recoverUrl}</a> <button className="icon-btn xs" title="Copy" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(d.recoverUrl); toast('Link copied'); }}><Icon name="copy" size={12} /></button> — put it on your website or WhatsApp auto-reply.</p>}
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
      const x = await api(`/products/${id}`, 'PUT', { name: p.name, description: p.description, note: p.note, cover: p.cover, links: p.links, lessons: p.lessons, includes: p.includes || [], certificate: p.certificate || { enabled: false }, accessDays: p.accessDays, downloadLimit: p.downloadLimit, hsn: p.hsn || '', gstRate: p.gstRate ?? '', origin: p.origin || '' });
      const next = { ...x, usage: p.usage };
      setP(next); setSaved(JSON.stringify(next)); toast('Product saved');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  // file changes are saved on the server right away; keep unsaved edits to everything else
  const onFiles = (product) => { const next = { ...p, files: product.files, lessons: p.lessons.map((l) => ({ ...l, fileIds: l.fileIds.filter((fid) => product.files.some((f) => f.id === fid)), videoFileId: product.files.some((f) => f.id === l.videoFileId) ? l.videoFileId : '' })) }; setP(next); setSaved(JSON.stringify({ ...JSON.parse(saved), files: product.files })); };
  const del = async () => {
    try { await api(`/products/${id}`, 'DELETE'); nav('/products'); toast('Product deleted'); } catch (e) {
      if (/buyer/.test(e.message) && await confirmDialog({ title: 'Delete anyway?', text: e.message, confirm: 'Delete', danger: true })) { await api(`/products/${id}?confirm=1`, 'DELETE'); nav('/products'); toast('Product deleted'); } else if (!/buyer/.test(e.message)) toast(e.message);
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

// a video's protected stream: being prepared, ready, or failed (with a retry)
function StreamBadge({ p, f, onFiles }) {
  const st = f.hls?.status;
  const go = async () => { try { onFiles((await api(`/products/${p.id}/files/${f.id}/stream`, 'POST')).product); toast('Preparing the protected stream'); } catch (e) { toast(e.message); } };
  if (st === 'ready') return <span className="pill ok" title="Encrypted streaming with the student’s email over the video — no download link">🔒 Protected</span>;
  if (st === 'queued' || st === 'processing') return <span className="pill info"><span className="spin dark" /> {st === 'queued' ? 'Waiting to prepare' : 'Preparing protected stream'}</span>;
  if (st === 'failed') return <span className="pill bad" title={f.hls.error}>Couldn’t prepare <button className="btn ghost sm" onClick={go}>Retry</button></span>;
  return <button className="btn ghost sm" onClick={go}>🔒 Protect</button>;
}
function FilesPanel({ p, onFiles }) {
  const ref = useRef(null);
  // while a video is being prepared, check back now and then
  const preparing = p.files.some((f) => ['queued', 'processing'].includes(f.hls?.status));
  useEffect(() => { if (!preparing) return; const t = setInterval(() => api(`/products/${p.id}`).then((x) => onFiles(x)).catch(() => {}), 15000); return () => clearInterval(t); }, [preparing, p.id]);
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
    if (!await confirmDialog({ title: `Delete ${f.name}?`, text: 'Buyers will no longer be able to download it.', confirm: 'Delete', danger: true })) return;
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
          <tr key={f.id}><td><Icon name={/^video/.test(f.type) ? 'play' : 'clip'} size={15} /> {f.name}{/^video/.test(f.type) && <> <StreamBadge p={p} f={f} onFiles={onFiles} /></>}</td><td className="muted sm">{bytes(f.size)}</td>
            <td className="r"><button className="icon-btn" title="Download" aria-label="Download" onClick={() => download(f)}><Icon name="download" size={15} /></button><button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => remove(f)}><Icon name="trash" size={15} /></button></td></tr>
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
          <button className="icon-btn danger" aria-label="Remove link" onClick={() => set({ links: links.filter((_, n) => n !== i) })}><Icon name="trash" size={15} /></button>
        </div>
      ))}
    </Panel>
  );
}

// A lesson's quiz: questions with options, the right one ticked, an optional explanation; AI can write it from the lesson
function QuizEditor({ l, onChange }) {
  const [busy, setBusy] = useState(false);
  const z = l.quiz;
  const setQ = (i, patch) => onChange({ ...z, questions: z.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) });
  const blankQ = () => ({ q: '', options: ['', ''], answer: 0, explain: '' });
  const ai = async () => {
    if (String(l.body || '').trim().length < 40) return toast('Write the lesson notes first — the quiz is made from them');
    setBusy(true);
    try { onChange(await api('/ai/quiz', 'POST', { title: l.title, text: l.body, count: 4 })); toast('Quiz written — check it over'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  if (!z) return (
    <div className="fld full"><span>Quiz</span>
      <div className="row"><button type="button" className="btn ghost sm" onClick={() => onChange({ pass: 70, questions: [blankQ()] })}><Icon name="plus" size={14} /> Add a quiz</button>
        <button type="button" className="btn ghost sm" onClick={ai} disabled={busy}>{busy ? <span className="spin dark" /> : <Icon name="sparkles" size={14} />} Write with AI</button></div>
      <small className="hint">Students must pass it to finish the lesson. Answers are checked on our server — never shown before they try.</small>
    </div>
  );
  return (
    <div className="fld full pr-quiz"><span>Quiz · pass mark <input className="pr-pass" type="number" min="0" max="100" value={z.pass} onChange={(e) => onChange({ ...z, pass: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />%
      <button type="button" className="btn ghost sm" onClick={ai} disabled={busy}>{busy ? <span className="spin dark" /> : <Icon name="sparkles" size={12} />} Rewrite with AI</button>
      <button type="button" className="btn ghost sm danger" onClick={() => onChange(null)}>Remove quiz</button></span>
      <label className="tog"><input type="checkbox" checked={!!z.showAnswers} onChange={(e) => onChange({ ...z, showAnswers: e.target.checked })} /><span />Show the right answers after a failed try too <small className="hint">· otherwise only after they pass</small></label>
      {z.questions.map((q, i) => (
        <div key={i} className="pr-qq">
          <div className="row"><b>{i + 1}.</b><input value={q.q} maxLength={500} placeholder="Question" onChange={(e) => setQ(i, { q: e.target.value })} />{z.questions.length > 1 && <button type="button" className="icon-btn xs danger" aria-label="Remove question" onClick={() => onChange({ ...z, questions: z.questions.filter((_, n) => n !== i) })}><Icon name="x" size={12} /></button>}</div>
          {q.options.map((o, k) => (
            <label key={k} className={`pr-qo ${q.answer === k ? 'on' : ''}`}>
              <input type="radio" name={`ans-${l.id}-${i}`} checked={q.answer === k} onChange={() => setQ(i, { answer: k })} title="The right answer" />
              <input value={o} maxLength={300} placeholder={`Option ${k + 1}`} onChange={(e) => setQ(i, { options: q.options.map((x, n) => (n === k ? e.target.value : x)) })} />
              {q.options.length > 2 && <button type="button" className="icon-btn xs" aria-label="Remove option" onClick={() => setQ(i, { options: q.options.filter((_, n) => n !== k), answer: q.answer === k ? 0 : q.answer > k ? q.answer - 1 : q.answer })}><Icon name="x" size={11} /></button>}
            </label>
          ))}
          <div className="row">{q.options.length < 6 && <button type="button" className="btn ghost sm" onClick={() => setQ(i, { options: [...q.options, ''] })}>+ Option</button>}
            <input className="pr-explain" value={q.explain || ''} maxLength={600} placeholder="Why it’s right (shown after they answer) — optional" onChange={(e) => setQ(i, { explain: e.target.value })} /></div>
        </div>
      ))}
      {z.questions.length < 30 && <button type="button" className="btn ghost sm" onClick={() => onChange({ ...z, questions: [...z.questions, blankQ()] })}><Icon name="plus" size={14} /> Add question</button>}
      <small className="hint">Tick the circle next to the right answer.</small>
    </div>
  );
}

// "Write the course with AI": topic → modules, full lessons and quizzes, added to this product for you to edit
function AiCourse({ p, set, onClose }) {
  const [v, setV] = useState({ topic: p.name || '', audience: '', level: 'beginner', lessons: 10, language: 'English', notes: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const c = await api('/ai/course', 'POST', v);
      const lessons = c.lessons.map((l, i) => ({ id: `n${Date.now().toString(36)}${i}`, videoUrl: '', videoFileId: '', fileIds: [], dripDays: 0, ...l }));
      set({ lessons: [...(p.lessons || []), ...lessons], ...(!p.description && c.description ? { description: c.description } : {}) });
      toast(`${lessons.length} lessons added — review them, add your videos, then Save`);
      onClose();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <Modal title="Write the course with AI" onClose={busy ? () => {} : onClose} width={560}>
      <div className="form2">
        <label className="fld full"><span>What does the course teach?</span><input autoFocus value={v.topic} maxLength={500} onChange={(e) => setV({ ...v, topic: e.target.value })} placeholder="e.g. Stock market basics for salaried beginners" /></label>
        <label className="fld full"><span>Who is it for?</span><input value={v.audience} maxLength={300} onChange={(e) => setV({ ...v, audience: e.target.value })} placeholder="e.g. Working professionals in India, 25–40" /></label>
        <label className="fld"><span>Level</span><select value={v.level} onChange={(e) => setV({ ...v, level: e.target.value })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label className="fld"><span>About how many lessons</span><input type="number" min="3" max="30" value={v.lessons} onChange={(e) => setV({ ...v, lessons: Number(e.target.value) || 10 })} /></label>
        <label className="fld"><span>Language</span><select value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })}>{['English', 'Hindi', 'Hinglish', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="fld full"><span>Your outline or notes <small className="muted">· optional — the AI follows them</small></span><textarea rows={4} maxLength={6000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Paste your module list, a workshop transcript, or bullet points…" /></label>
      </div>
      <p className="hint">Writes modules, full lessons and a quiz at the end of each module (5 AI credits). Lessons are added below the ones you have — nothing is saved until you press Save.</p>
      <div className="row end"><button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={go} disabled={busy || v.topic.trim().length < 4}>{busy ? <><span className="spin" /> Writing… (about a minute)</> : <><Icon name="sparkles" size={15} /> Write the course</>}</button></div>
    </Modal>
  );
}

// A certificate when a student finishes every lesson and passes every quiz
function WatermarkPanel({ p, set }) {
  return (
    <Panel title="Video watermark">
      <label className="tog" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={p.watermark !== false} onChange={(e) => set({ watermark: e.target.checked })} /><span /> Show each student’s email faintly on the course videos</label>
      <p className="hint">It drifts across the video, so if someone screen-records and shares a lesson you can see whose account it came from. Barely noticeable while watching. Recommended for paid courses.</p>
    </Panel>
  );
}

function CertificatePanel({ p, set }) {
  const c = p.certificate || { enabled: false };
  const upd = (patch) => set({ certificate: { ...c, ...patch } });
  return (
    <Panel title="Certificate">
      <label className="tog" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!c.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /><span /> Give a certificate when a student finishes this course</label>
      {c.enabled && <div className="form2" style={{ marginTop: 12 }}>
        <label className="fld full"><span>Title</span><input value={c.title || ''} maxLength={120} onChange={(e) => upd({ title: e.target.value })} placeholder="Certificate of completion" /></label>
        <label className="fld"><span>Signed by</span><input value={c.signer || ''} maxLength={80} onChange={(e) => upd({ signer: e.target.value })} placeholder="Your name" /></label>
        <label className="fld"><span>Their role</span><input value={c.signerRole || ''} maxLength={80} onChange={(e) => upd({ signerRole: e.target.value })} placeholder="Founder & coach" /></label>
      </div>}
      <p className="hint">Finished = every lesson done and every quiz passed. Each certificate has a number anyone can check online, and students can add it to LinkedIn.</p>
    </Panel>
  );
}

function LessonsPanel({ p, set }) {
  const lessons = p.lessons || [];
  const [open, setOpen] = useState(null);
  const [ai, setAi] = useState(false);
  const upd = (i, patch) => set({ lessons: lessons.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const move = (i, d) => { const a = [...lessons]; [a[i], a[i + d]] = [a[i + d], a[i]]; set({ lessons: a }); };
  const add = () => { set({ lessons: [...lessons, { id: `n${Date.now().toString(36)}`, title: `Lesson ${lessons.length + 1}`, section: lessons.at(-1)?.section || '', videoUrl: '', videoFileId: '', body: '', fileIds: [], dripDays: 0 }] }); setOpen(lessons.length); };
  const videos = p.files.filter((f) => /^video\//.test(f.type));
  return (
    <Panel title={`Course lessons${lessons.length ? ` (${lessons.length})` : ''}`} actions={<span className="row"><button className="btn ghost sm" onClick={() => setAi(true)}><Icon name="sparkles" size={14} /> Write course with AI</button><button className="btn ghost sm" onClick={add}><Icon name="plus" size={14} /> Add lesson</button></span>}>
      {ai && <AiCourse p={p} set={set} onClose={() => setAi(false)} />}
      {!lessons.length ? <p className="muted sm">Turn this product into a course: each lesson can have a video (YouTube, Vimeo, Loom, Google Drive or an uploaded file), notes and downloads. Buyers get a course player with progress tracking. Use “unlocks after” to drip lessons out over time.</p> : (
        <div className="pr-lessons">{lessons.map((l, i) => (
          <div key={l.id} className={`pr-lesson ${open === i ? 'open' : ''}`}>
            <div className="pr-lh" onClick={() => setOpen(open === i ? null : i)}>
              <span className="num">{i + 1}</span>
              <div><b>{l.title || 'Untitled lesson'}</b><small className="muted">{[l.section, (l.videoUrl || l.videoFileId) && 'video', l.fileIds?.length && `${l.fileIds.length} file${l.fileIds.length > 1 ? 's' : ''}`, l.dripDays && `unlocks day ${l.dripDays}`, l.quiz && `quiz · ${l.quiz.questions.length} q`, l.minLevel > 1 && `🔒 level ${l.minLevel}`].filter(Boolean).join(' · ')}</small></div>
              <span className="row" onClick={(e) => e.stopPropagation()}>
                {i > 0 && <button className="icon-btn xs" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>}
                {i < lessons.length - 1 && <button className="icon-btn xs" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>}
                <button className="icon-btn xs danger" aria-label="Remove lesson" onClick={() => set({ lessons: lessons.filter((_, n) => n !== i) })}><Icon name="x" size={12} /></button>
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
                <label className="fld"><span>Unlocks at level <small className="muted">· community points</small></span><select value={l.minLevel || 1} onChange={(e) => upd(i, { minLevel: Number(e.target.value) })}><option value={1}>Any level</option>{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Level {n}</option>)}</select><small className="hint">A bonus lesson students earn by being active in your community.</small></label>
                <QuizEditor l={l} onChange={(quiz) => upd(i, { quiz })} />
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
      if (what === 'revoke') { if (!await confirmDialog({ title: `Remove ${a.email}’s access to ${p.name}?`, confirm: 'Remove access', danger: true })) return; await api(`/access-admin/${a.id}/revoke`, 'POST'); }
      else if (what === 'restore') await api(`/access-admin/${a.id}/restore`, 'POST', {});
      else if (what === 'copy') { const r = await api(`/access-admin/${a.id}/link`, 'POST', {}); navigator.clipboard?.writeText(r.library); toast('Library link copied'); return; }
      else if (what === 'send') { const r = await api(`/access-admin/${a.id}/link`, 'POST', { send: true }); toast(r.emailed === 'sent' ? `Emailed ${a.email}` : 'Email isn’t set up — link copied instead'); if (r.emailed !== 'sent') navigator.clipboard?.writeText(r.library); return; }
      else if (what === 'reset') { if (!await confirmDialog({ title: 'Give this buyer a new library link?', text: 'The old link (and any copies they shared) stops working.', confirm: 'New link' })) return; const r = await api(`/access-admin/${a.id}/link`, 'POST', { reset: true, send: true }); toast(r.emailed === 'sent' ? 'New link emailed' : 'New link copied'); navigator.clipboard?.writeText(r.library); return; }
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
                  <button className="icon-btn" title="Copy library link" aria-label="Copy library link" onClick={() => act(a, 'copy')}><Icon name="link" size={15} /></button>
                  <button className="icon-btn" title="Email the library link again" aria-label="Email the library link again" onClick={() => act(a, 'send')}><Icon name="send" size={15} /></button>
                  <button className="icon-btn" title="New link (stops a shared link)" aria-label="New link (stops a shared link)" onClick={() => act(a, 'reset')}><Icon name="undo" size={15} /></button>
                  {a.revoked ? <button className="btn ghost sm" onClick={() => act(a, 'restore')}>Restore</button> : <button className="icon-btn danger" title="Remove access" aria-label="Remove access" onClick={() => act(a, 'revoke')}><Icon name="x" size={15} /></button>}
                </div></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </>
  );
}

// A bundle: buying this product also unlocks the products ticked here (one level — no bundle inside a bundle)
function BundlePanel({ p, set }) {
  const [all, setAll] = useState(null);
  useEffect(() => { api('/products').then((d) => setAll((d.products || d).filter((x) => x.id !== p.id))).catch(() => setAll([])); }, [p.id]);
  const inc = p.includes || [];
  const choices = (all || []).filter((x) => !(x.includes || []).length);
  const toggle = (id) => set({ includes: inc.includes(id) ? inc.filter((x) => x !== id) : [...inc, id] });
  return (
    <Panel title="Bundle">
      <p className="hint" style={{ marginTop: 0 }}>Sell several products as one: buyers of <b>{p.name}</b> also get every product ticked here, for as long as their access to this one lasts. A refund takes them all back.</p>
      {!all ? <div className="skeleton" style={{ height: 40 }} /> : choices.length === 0 ? <p className="hint">Create the products first, then tick them here.</p> : (
        <div className="pr-bundle" style={{ display: 'grid', gap: 6 }}>
          {choices.map((x) => <label key={x.id} className="pr-check"><input type="checkbox" checked={inc.includes(x.id)} onChange={() => toggle(x.id)} /><span>{x.name}</span></label>)}
        </div>
      )}
    </Panel>
  );
}

function SettingsTab({ p, set, onDelete }) {
  return (
    <div className="pr-cols">
      <div className="pr-main">
        {p.lessons?.length > 0 && <WatermarkPanel p={p} set={set} />}
        <CertificatePanel p={p} set={set} />
        <BundlePanel p={p} set={set} />
        <Panel title="Access">
          <div className="form2">
            <label className="fld"><span>Access lasts</span><select value={[0, 30, 90, 180, 365, 730].includes(p.accessDays) ? p.accessDays : 'custom'} onChange={(e) => e.target.value !== 'custom' && set({ accessDays: Number(e.target.value) })}>
              <option value={0}>Lifetime</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>6 months</option><option value={365}>1 year</option><option value={730}>2 years</option>{![0, 30, 90, 180, 365, 730].includes(p.accessDays) && <option value="custom">{p.accessDays} days</option>}
            </select><small className="hint">Counted from each buyer’s purchase. Changes apply to new buyers.</small></label>
            <label className="fld"><span>Downloads per file</span><input type="number" min="0" max="1000" value={p.downloadLimit} onChange={(e) => set({ downloadLimit: Number(e.target.value) || 0 })} /><small className="hint">0 = unlimited. Stops one buyer from passing files around; streaming lesson videos doesn’t count.</small></label>
          </div>
        </Panel>
        <Panel title="GST on invoices">
          <div className="form2">
            <label className="fld"><span>HSN / SAC code</span><input value={p.hsn || ''} inputMode="numeric" maxLength={8} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, '') })} placeholder="Invoice default" /><small className="hint">Courses/coaching: SAC 999293 or 998431 — ask your CA. Physical goods: the HSN on your purchase invoice.</small></label>
            <label className="fld"><span>GST rate</span><select value={p.gstRate ?? ''} onChange={(e) => set({ gstRate: e.target.value === '' ? null : Number(e.target.value) })}><option value="">Invoice default</option>{[0, 0.25, 3, 5, 12, 18, 28, 40].map((r) => <option key={r} value={r}>{r}%</option>)}</select><small className="hint">Used on this product’s invoice lines. Empty = the rate in Settings → GST invoices.</small></label>
          </div>
        </Panel>
        <Panel title="Physical goods">
          <div className="form2">
            <label className="fld"><span>Country of origin</span><input value={p.origin || ''} maxLength={60} onChange={(e) => set({ origin: e.target.value })} placeholder="Your default from Settings (else India)" /><small className="hint">Shown under the product at checkout when it ships (required for goods sold online in India). Leave empty for digital products.</small></label>
          </div>
        </Panel>
        <Panel title="Protection built in">
          <ul className="checks sm">
            <li>Files are private — every download link is signed and expires after 2 hours.</li>
            <li>Library links are emailed only to the buyer; you can reset one if it gets shared.</li>
            <li>Nothing is delivered on demo checkouts — only after a verified payment (Razorpay or Stripe).</li>
            <li>Refunds (from Orders or your Razorpay dashboard) remove access automatically.</li>
          </ul>
        </Panel>
      </div>
      <aside className="pr-side">
        <Panel title="Danger zone">
          <p className="muted sm">Deleting this product removes its files and every buyer’s access. Invoices and orders are kept.</p>
          <button className="btn ghost danger" onClick={async () => { if (await confirmDialog({ title: `Delete ${p.name}?`, confirm: 'Delete', danger: true })) onDelete(); }}><Icon name="trash" size={15} /> Delete product</button>
        </Panel>
      </aside>
    </div>
  );
}
