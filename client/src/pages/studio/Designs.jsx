// Studio Designs (server studio/designs.js): posts with words on them — festive greetings, sale posters, launches,
// customer quotes, before/after, events, stories, YouTube thumbnails and carousels — in English or any Indian language.
// The seller picks a kind, a template, a size and a language and writes a brief: Studio writes the words and draws a
// free preview in the brand's colours; the words can be checked before anything is spent; "Make the picture" is the
// only paid step; every change after that (words, colours, template, lettering, size) is a free re-draw.
// Self-contained: <Designs onClose={…} /> (opened from Studio).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Modal, Icon, toast } from '../../ui';

const KINDS = [['post', 'Post / story'], ['thumbnail', 'YouTube thumbnail'], ['carousel', 'Carousel']];
const FAMILY = [['', 'Template’s own'], ['sans', 'Clean'], ['serif', 'Classic'], ['display', 'Heavy']];
const IDEAS = {
  post: ['Diwali greeting from our store, warm and traditional', 'Holi sale: 30% off all kurtas, 10–14 March', 'Launching our new cold-pressed mustard oil, ₹249 a litre', 'Independence Day sale — 15 August only'],
  thumbnail: ['I tried the cheapest ghee in India — honest review', '5 mistakes new sellers make on Instagram'],
  carousel: ['5 ways to keep ghee fresh for months', 'How to choose the right saree for a wedding'],
};
const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const CSS = `
.dz{display:grid;grid-template-columns:minmax(320px,420px) 1fr;gap:18px;min-height:520px}
.dz-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.dz label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}
.dz textarea,.dz input[type=text],.dz select{width:100%}
.dz-kinds{display:flex;gap:6px;flex-wrap:wrap}
.dz-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:420px;overflow:auto;padding:2px}
.dz-tpl{text-align:left;border:1px solid var(--border,#ddd);border-radius:10px;padding:8px;background:var(--card,#fff);cursor:pointer;font-size:12px;line-height:1.3}
.dz-tpl b{display:block;font-size:12.5px;margin-top:6px}
.dz-thumb{display:grid;place-items:center;width:100%;aspect-ratio:1/1;border-radius:7px;overflow:hidden;background:var(--c-surface-2,#f3f3f3)}
.dz-thumb.portrait{aspect-ratio:4/5}.dz-thumb.story{aspect-ratio:9/16}.dz-thumb.thumbnail{aspect-ratio:16/9}
.dz-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}
.dz-tpl:hover .dz-thumb img{transform:scale(1.04)}
.dz-tpl.on{border-color:var(--accent,#6d28d9);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent,#6d28d9) 25%,transparent)}
.dz-slides{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px}
.dz-slide{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.dz-slide img{max-height:420px;max-width:100%;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.15);background:#222}
.dz-slides.many .dz-slide img{max-height:300px}
.dz-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.dz-tag{display:inline-flex;gap:6px;align-items:center;font-size:12px;padding:2px 8px;border-radius:99px;background:var(--soft,#f2f0fb)}
.dz-score{display:flex;gap:14px;font-size:13px}
.dz-score b{font-size:20px}
.dz-recent{display:flex;gap:8px;overflow-x:auto}
.dz-recent button{border:0;padding:0;background:none;cursor:pointer}
.dz-recent img{height:72px;border-radius:6px}
.dz-sw{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (max-width:760px){.dz{grid-template-columns:1fr}}
`;

// a template's look, drawn by the server with its sample words in the seller's brand (signed in, so fetched, not linked)
const sampleCache = new Map();
function Sample({ id, format }) {
  const key = `${id}|${format}`;
  const [url, setUrl] = useState(sampleCache.get(key) || '');
  useEffect(() => {
    if (sampleCache.has(key)) { setUrl(sampleCache.get(key)); return undefined; }
    let live = true;
    fetch(`/api/studio/designs/templates/${id}/sample?format=${format}`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token') || ''}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (!b) return; const u = URL.createObjectURL(b); sampleCache.set(key, u); if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  return <span className={`dz-thumb ${format}`}>{url ? <img src={url} alt="" loading="lazy" /> : <i className="spin dark" />}</span>;
}

export function Designs({ onClose }) {
  const [menu, setMenu] = useState(null);
  const [images, setImages] = useState([]);
  const [kind, setKind] = useState('post');
  const [v, setV] = useState({ template: '', format: 'square', lang: 'en', brief: '', slides: 5, bg: 'ai', photo: '', typography: false, tier: 'standard' });
  const [d, setD] = useState(null); // the design open on the right
  const [edit, setEdit] = useState(null); // its words / colours / lettering, being edited
  const [busy, setBusy] = useState('');
  const file = useRef(null);
  const set = (p) => setV((x) => ({ ...x, ...p }));

  useEffect(() => {
    api('/studio/designs').then(setMenu).catch((e) => { toast(e.message); onClose?.(); });
    api('/studio').then((s) => setImages((s.assets || []).filter((a) => a.kind === 'image' && a.url && a.status !== 'failed'))).catch(() => {});
  }, []);
  // while the picture is being made, look again every few seconds
  useEffect(() => {
    if (d?.status !== 'producing') return undefined;
    const t = setInterval(() => { api(`/studio/designs/${d.id}`).then(open).catch(() => {}); }, 4000);
    return () => clearInterval(t);
  }, [d?.id, d?.status]);

  const templates = useMemo(() => (menu?.templates || []).filter((t) => (kind === 'carousel' ? t.id === 'carousel-cover' : t.group === kind)), [menu, kind]);
  const tpl = (id) => menu?.templates.find((t) => t.id === id);
  const sameKind = d ? (menu?.templates || []).filter((t) => t.group === tpl(d.slides[0].template)?.group) : [];
  const open = (x) => { setD(x); setEdit({ slides: x.slides.map((s) => ({ ...s.text })), template: x.slides[0].template, colours: x.colours?.length ? x.colours : tpl(x.slides[0].template)?.colours || ['#111111', '#ffcc00'], family: '', format: x.format }); };
  const pickKind = (k) => { setKind(k); set({ template: '', format: k === 'thumbnail' ? 'thumbnail' : k === 'carousel' ? 'portrait' : 'square' }); };
  const upload = async (f) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Pick a JPG, PNG or WebP picture under 5 MB');
    try { const r = await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) }); set({ photo: r.url, bg: 'photo' }); } catch (e) { toast(e.message); }
  };
  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { toast(e.message); } finally { setBusy(''); } };

  const start = () => run('write', async () => {
    const body = { brief: v.brief, group: kind, template: kind === 'carousel' ? undefined : v.template || undefined, format: v.format, lang: v.lang, slides: v.slides, bg: v.bg, typography: v.typography && v.lang === 'en' && v.bg === 'ai', tier: v.tier };
    if (v.bg === 'photo') { if (v.photo.startsWith('studio:')) body.photoId = v.photo.slice(7); else body.photo = v.photo; }
    const x = await api('/studio/designs', 'POST', body);
    open(x);
    setMenu((m) => ({ ...m, designs: [x, ...m.designs] }));
  });
  const save = () => run('save', async () => {
    const body = { slides: edit.slides.map((text, i) => ({ i, text })), colours: edit.colours, format: edit.format, ...(edit.family ? { family: edit.family } : {}) };
    if (edit.template !== d.slides[0].template && d.group !== 'carousel') body.template = edit.template;
    open(await api(`/studio/designs/${d.id}`, 'PUT', body));
    toast('Updated — no credits used');
  });
  const check = () => run('check', async () => setD(await api(`/studio/designs/${d.id}/assess`, 'POST', {})));
  const apply = (s) => setEdit((e) => ({ ...e, slides: e.slides.map((t, i) => (i === s.i ? { ...t, ...s.text } : t)) }));
  const make = () => run('make', async () => open(await api(`/studio/designs/${d.id}/make`, 'POST', {})));
  const zip = () => run('zip', async () => {
    const r = await fetch(`/api/studio/designs/${d.id}/zip`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
    if (!r.ok) throw new Error('The download didn’t work — try again');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'design.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  if (!menu) return <Modal title="Designs" onClose={onClose} width={1100}><div className="skeleton" /></Modal>;
  const fieldsOf = (id) => tpl(id)?.fields || [];
  return (
    <Modal title="Designs — posts, stories, thumbnails and carousels with words" onClose={onClose} width={1180}>
      <style>{CSS}</style>
      <div className="dz">
        <div className="dz-col">
          <div className="dz-kinds">{KINDS.map(([k, label]) => <button key={k} type="button" className={`btn sm ${kind === k ? '' : 'ghost'}`} onClick={() => pickKind(k)}>{label}</button>)}</div>
          {kind !== 'carousel' && (
            <div className="dz-tpls" role="listbox" aria-label="Template">
              <button type="button" className={`dz-tpl ${!v.template ? 'on' : ''}`} onClick={() => set({ template: '' })}><b>Let Studio pick</b>The best layout for your brief</button>
              {templates.map((t) => <button key={t.id} type="button" className={`dz-tpl ${v.template === t.id ? 'on' : ''}`} title={t.note} onClick={() => set({ template: t.id })}><Sample id={t.id} format={kind === 'thumbnail' ? 'thumbnail' : v.format === 'story' ? 'story' : v.format === 'portrait' ? 'portrait' : 'square'} /><b>{t.name}</b></button>)}
            </div>
          )}
          <label>What is it for?<textarea rows={3} maxLength={1500} value={v.brief} placeholder={IDEAS[kind][0]} onChange={(e) => set({ brief: e.target.value })} /></label>
          <div className="sx-hint sm">{IDEAS[kind].slice(1).map((x) => <button key={x} type="button" className="btn ghost sm" onClick={() => set({ brief: x })}>{x}</button>)}</div>
          <div className="row">
            <label>Size<select value={v.format} onChange={(e) => set({ format: e.target.value })}>{menu.formats.map((f) => <option key={f.id} value={f.id}>{f.label} · {f.width}×{f.height}</option>)}</select></label>
            <label>Language<select value={v.lang} onChange={(e) => set({ lang: e.target.value })}>{menu.languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          </div>
          {kind === 'carousel' && <label>Slides<input type="number" min={3} max={10} value={v.slides} onChange={(e) => set({ slides: Number(e.target.value) })} /></label>}
          <label>Picture behind the words
            <select value={v.bg === 'photo' ? v.photo || 'photo' : v.bg} onChange={(e) => { const x = e.target.value; if (x === 'ai' || x === 'none') set({ bg: x, photo: '' }); else if (x === 'upload') file.current?.click(); else set({ bg: 'photo', photo: x }); }}>
              <option value="ai">Made by Studio (credits when you go ahead)</option>
              <option value="none">Brand colours only (free)</option>
              <option value="upload">Upload my photo…</option>
              {v.photo && !v.photo.startsWith('studio:') && <option value={v.photo}>My uploaded photo</option>}
              {images.slice(0, 20).map((a) => <option key={a.id} value={`studio:${a.id}`}>Studio image: {a.prompt.slice(0, 40)}</option>)}
            </select>
          </label>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          {v.bg === 'ai' && <label>Quality<select value={v.tier} onChange={(e) => set({ tier: e.target.value })}>{menu.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} · about {t.credits} credits</option>)}</select></label>}
          {v.bg === 'ai' && kind !== 'carousel' && v.lang === 'en' && (
            <label style={{ flexDirection: 'row', alignItems: 'center', fontWeight: 400 }}><input type="checkbox" checked={v.typography} onChange={(e) => set({ typography: e.target.checked })} /> <span><b>AI lettering</b> <span className="dz-tag">experimental · English only</span><br /><span className="muted sm">The picture paints the headline in a stylised way. It may not be spelled perfectly — Studio’s own lettering always is.</span></span></label>
          )}
          <button type="button" className="btn" disabled={!!busy || v.brief.trim().length < 6} onClick={start}>{busy === 'write' ? 'Writing…' : <><Icon name="sparkles" size={15} /> Write it and preview (free)</>}</button>
          {menu.designs.length > 0 && (<><h4 style={{ margin: '8px 0 0' }}>Recent</h4><div className="dz-recent">{menu.designs.slice(0, 12).map((x) => x.url && <button key={x.id} type="button" title={x.prompt} onClick={() => open(x)}><img src={x.url} alt={x.prompt.slice(0, 60)} /></button>)}</div></>)}
        </div>

        <div className="dz-col">
          {!d ? <div className="muted" style={{ margin: 'auto', textAlign: 'center', maxWidth: 420 }}><Icon name="image" size={28} /><p>Pick a kind and a template, say what it’s for, and Studio writes the words and draws a preview in your brand colours. Hindi, Marathi, Gujarati, Tamil and the rest are always spelled and shaped right — the words are drawn by Studio, not by the picture model.</p></div> : (
            <>
              <div className="dz-sw">
                <span className="dz-tag">{d.status === 'producing' ? 'Making the picture…' : d.preview ? 'Free preview' : d.status === 'failed' ? 'Picture failed' : 'Ready'}</span>
                {d.typography && <span className="dz-tag">AI lettering</span>}
                {d.size && <span className="muted sm">{d.size.label} · {d.size.width}×{d.size.height}</span>}
                {d.error && <span className="sm" style={{ color: 'var(--danger,#c00)' }}>{d.error}</span>}
              </div>
              <div className={`dz-slides ${d.slides.length > 1 ? 'many' : ''}`}>
                {d.slides.map((s, i) => (
                  <div className="dz-slide" key={i}>
                    {s.url && <img src={`${s.url}${s.url.includes('?') ? '&' : '?'}v=${d.version}`} alt={`Slide ${i + 1}`} />}
                    {s.url && <a className="btn ghost sm" href={s.url} download={`slide-${i + 1}.png`}><Icon name="download" size={13} /> PNG</a>}
                  </div>
                ))}
              </div>
              <div className="dz-sw">
                {d.preview && d.status !== 'producing' && <button type="button" className="btn" disabled={!!busy} onClick={make}>{busy === 'make' ? 'Starting…' : `Make the picture — about ${d.credits} credits`}</button>}
                {d.status === 'failed' && d.bg === 'ai' && <button type="button" className="btn" disabled={!!busy} onClick={make}>Try the picture again — about {d.credits} credits</button>}
                <button type="button" className="btn ghost" disabled={!!busy || d.status === 'producing'} onClick={check}>{busy === 'check' ? 'Checking…' : 'Check quality and reach (free)'}</button>
                {d.outputs.length > 1 && <button type="button" className="btn ghost" disabled={!!busy} onClick={zip}><Icon name="download" size={14} /> All slides (.zip)</button>}
              </div>
              {d.assessment && (
                <div className="panel" style={{ padding: 12 }}>
                  <div className="dz-score"><span>Quality <b>{d.assessment.quality ?? '–'}</b></span><span>Reach <b>{d.assessment.virality ?? '–'}</b></span><span className="muted">{d.assessment.verdict}</span></div>
                  {d.assessment.problems.length > 0 && <ul className="sm">{d.assessment.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                  {d.assessment.slides.map((s) => <div key={s.i} className="sm row"><span>Slide {s.i + 1}: {Object.entries(s.text).map(([k, t]) => `${k}: “${t}”`).join(' · ')}</span><button type="button" className="btn ghost sm" onClick={() => apply(s)}>Use this</button></div>)}
                </div>
              )}
              {edit && d.status !== 'producing' && (
                <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="row">
                    {d.group !== 'carousel' && <label>Template<select value={edit.template} onChange={(e) => setEdit({ ...edit, template: e.target.value })}>{sameKind.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
                    <label>Size<select value={edit.format} onChange={(e) => setEdit({ ...edit, format: e.target.value })}>{menu.formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></label>
                    <label>Lettering<select value={edit.family} onChange={(e) => setEdit({ ...edit, family: e.target.value })}>{FAMILY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  </div>
                  <div className="dz-sw">
                    <span className="sm">Colours</span>
                    {[0, 1].map((k) => <input key={k} type="color" aria-label={k ? 'Accent colour' : 'Main colour'} value={edit.colours[k] || '#ffcc00'} onChange={(e) => { const c = [...edit.colours]; c[k] = e.target.value; setEdit({ ...edit, colours: c }); }} />)}
                    <span className="muted sm">Put *stars* around words to highlight them</span>
                  </div>
                  {edit.slides.map((text, i) => (
                    <div key={i}>
                      {edit.slides.length > 1 && <h5 style={{ margin: '4px 0' }}>Slide {i + 1}</h5>}
                      <div className="dz-fields">
                        {fieldsOf(i === 0 && d.group !== 'carousel' ? edit.template : d.slides[i].template).map((f) => (
                          <label key={f.key}>{f.label}<input type="text" maxLength={f.max + 4} value={text[f.key] || ''} onChange={(e) => setEdit({ ...edit, slides: edit.slides.map((t, j) => (j === i ? { ...t, [f.key]: e.target.value } : t)) })} /></label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div><button type="button" className="btn" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Drawing…' : 'Update (free)'}</button></div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
export default Designs;
