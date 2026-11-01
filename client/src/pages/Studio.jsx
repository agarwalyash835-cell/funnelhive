// Studio: AI images and short clips for ads and pages (server studio/). Make images (optionally keeping your real
// product from a photo), turn one into a clip, watch them render, get each one quality-checked; redo with a note,
// download, delete. Tiers only — Quick, Standard, Cinematic.
import { useEffect, useRef, useState } from 'react';
import { api, fmtDate } from '../api';
import { Layout, Panel, Icon, Empty, toast, confirmDialog, promptDialog } from '../ui';
import { ReelView } from './StudioReel';

const STATUS = { script_ready: ['Script ready', 'warn'], producing: ['Making…', 'info'], editing: ['Editing…', 'info'], queued: ['Queued', 'info'], rendering: ['Rendering…', 'info'], checking: ['Checking quality…', 'info'], ready: ['Ready', 'ok'], needs_review: ['Needs a look', 'warn'], failed: ['Failed', 'bad'] };
const ACTIVE = ['queued', 'rendering', 'checking', 'producing', 'editing'];
const TIER_HINT = { quick: 'Fast drafts', standard: 'Good for most ads', cinematic: 'Best quality, slowest' };
const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

export default function Studio() {
  const [d, setD] = useState(null);
  const [mode, setMode] = useState('image');
  const [v, setV] = useState({ prompt: '', tier: 'standard', aspect: '1:1', count: 1, ref: '', sourceId: '', seconds: 5, lang: 'en', length: 30, voice: 'female', captions: 'pop', sizes: ['9:16'], logo: '' });
  const [open, setOpen] = useState(null); // a Reel's id
  const logoFile = useRef();
  const [busy, setBusy] = useState(false);
  const file = useRef();
  const load = () => api('/studio').then(setD).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  // while something renders, look again every few seconds
  const live = !!d?.assets?.some((a) => ACTIVE.includes(a.status));
  useEffect(() => { if (!live) return undefined; const t = setInterval(load, 5000); return () => clearInterval(t); }, [live]);
  if (d === false) return <Layout title="Studio"><Empty icon="wand" title="Studio didn’t load" text="Reload the page to try again." /></Layout>;
  if (!d) return <Layout title="Studio"><div className="skeleton" /></Layout>;
  if (!d.on) return <Layout title="Studio" subtitle="AI images and clips for your ads and pages"><Empty icon="wand" title="Studio isn’t on for your account yet" text="Studio makes product images, scenes and short video clips for your ads, checked for quality before you see them. Ask us to switch it on." /></Layout>;

  const images = d.assets.filter((a) => a.kind === 'image' && a.url && a.status === 'ready');
  const set = (p) => setV({ ...v, ...p });
  const upload = async (f, key = 'ref') => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Pick a JPG, PNG or WebP photo under 5 MB');
    try { const r = await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) }); if (key === 'logo') { set({ logo: r.url }); toast('Logo added'); } else { set({ ref: r.url, sourceId: '' }); toast('Photo added — your product will look like this'); } } catch (e) { toast(e.message); }
  };
  const make = async () => {
    setBusy(true);
    try {
      if (mode === 'reel') {
        const r = await api('/studio/reels', 'POST', { brief: v.prompt, lang: v.lang, seconds: v.length, tier: v.tier, voice: v.voice, captions: v.captions, sizes: v.sizes, ...(v.ref ? { ref: v.ref } : {}), ...(v.logo ? { logo: v.logo } : {}) });
        set({ prompt: '' }); await load(); setOpen(r.id); setBusy(false); return;
      }
      if (mode === 'image') await api('/studio/images', 'POST', { prompt: v.prompt, tier: v.tier, aspect: v.aspect, count: v.count, ...(v.ref ? { ref: v.ref } : {}) });
      else await api('/studio/clips', 'POST', { prompt: v.prompt, tier: v.tier, aspect: v.aspect, seconds: v.seconds, ...(v.sourceId ? { sourceId: v.sourceId } : v.ref ? { ref: v.ref } : {}) });
      toast(mode === 'image' ? 'Started — usually under a minute' : 'Started — clips take a few minutes');
      set({ prompt: '' }); load();
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const redo = async (a) => {
    const note = await promptDialog({ title: 'Make it again', text: 'What should change? (optional)', label: 'Change', value: '' });
    if (note === null || note === undefined) return;
    try { await api(`/studio/assets/${a.id}/redo`, 'POST', { note }); load(); } catch (e) { toast(e.message); }
  };
  const remove = async (a) => { if (!(await confirmDialog({ title: 'Delete this?', confirm: 'Delete', danger: true }))) return; try { await api(`/studio/assets/${a.id}`, 'DELETE'); load(); } catch (e) { toast(e.message); } };
  const toClip = (a) => { setMode('clip'); setV({ ...v, sourceId: a.id, ref: '', aspect: '9:16', prompt: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const src = v.sourceId ? images.find((x) => x.id === v.sourceId)?.url : v.ref;

  return (
    <Layout title="Studio" subtitle="AI images and clips for your ads and pages — each one checked for quality">
      <Panel>
        <div className="row between">
          <span className="seg" role="tablist">{[['image', 'Images'], ['clip', 'Video clip'], ['reel', 'Reel (full ad)']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); set({ aspect: k === 'image' ? '1:1' : '9:16' }); }}>{l}</button>)}</span>
          <span className="seg sm" role="radiogroup" aria-label="Quality">{d.tiers.map((t) => <button key={t.id} type="button" role="radio" aria-checked={v.tier === t.id} title={TIER_HINT[t.id]} className={v.tier === t.id ? 'on' : ''} onClick={() => set({ tier: t.id })}>{t.name}</button>)}</span>
        </div>
        <div className="st-make">
          <div className="st-src">
            {src ? <img src={src} alt="" /> : <span className="muted sm">{mode === 'clip' ? 'Start from an image (optional)' : 'Your product photo (optional)'}</span>}
            <div className="row">
              <button type="button" className="btn ghost sm" onClick={() => file.current?.click()}><Icon name="image" size={14} /> {src ? 'Change' : 'Add photo'}</button>
              {src && <button type="button" className="btn ghost sm" onClick={() => set({ ref: '', sourceId: '' })}>Remove</button>}
            </div>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            {mode === 'reel' && <>
              {v.logo ? <img src={v.logo} alt="Logo" className="st-logo" /> : null}
              <button type="button" className="btn ghost sm" onClick={() => logoFile.current?.click()}>{v.logo ? 'Change logo' : 'Add your logo'}</button>
              <input ref={logoFile} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => { upload(e.target.files?.[0], 'logo'); e.target.value = ''; }} />
            </>}
          </div>
          <div className="st-form">
            <label>{mode === 'image' ? 'Describe the image' : mode === 'clip' ? 'What happens in the clip' : 'What is the ad about? Product, who it’s for, the offer'}<textarea rows={3} maxLength={1500} value={v.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder={mode === 'image' ? 'A jar of desi ghee on a wooden kitchen counter, warm morning light, a brass spoon beside it' : mode === 'clip' ? 'Slow push-in on the jar as steam rises from a bowl of rice beside it' : 'Our farm-made desi ghee, ₹499 a litre, for families who want pure ghee — order on WhatsApp'} /></label>
            {mode === 'reel' ? (
              <div className="row wrap">
                <label>Language<select value={v.lang} onChange={(e) => set({ lang: e.target.value })}>{d.languages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>Length<select value={v.length} onChange={(e) => set({ length: Number(e.target.value) })}>{d.lengths.map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
                <label>Voice<select value={v.voice} onChange={(e) => set({ voice: e.target.value })}><option value="female">Female</option><option value="male">Male</option></select></label>
                <label>Captions<select value={v.captions} onChange={(e) => set({ captions: e.target.value })}>{d.captionStyles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <div className="rl-sizes"><span className="muted sm">Sizes</span>{[['9:16', 'Reels / Shorts'], ['1:1', 'Square'], ['4:5', 'Feed'], ['16:9', 'Wide']].map(([k, l]) => { const on = v.sizes.includes(k); return <label key={k} className="row"><input type="checkbox" checked={on} disabled={on && v.sizes.length === 1} onChange={() => set({ sizes: on ? v.sizes.filter((x) => x !== k) : [...v.sizes, k] })} />{k} · {l}</label>; })}</div>
              </div>
            ) : <div className="row wrap">
              <label>Shape<select value={v.aspect} onChange={(e) => set({ aspect: e.target.value })}>{d.aspects.map((a) => <option key={a} value={a}>{({ '9:16': '9:16 · Reels / Stories', '1:1': '1:1 · Square', '16:9': '16:9 · Wide', '4:5': '4:5 · Feed', '3:4': '3:4 · Portrait' })[a] || a}</option>)}</select></label>
              {mode === 'image'
                ? <label>How many<select value={v.count} onChange={(e) => set({ count: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                : <label>Length<select value={v.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })}>{[4, 5, 6, 8, 10, 15].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>}
            </div>}
            <button className="btn primary" disabled={busy || v.prompt.trim().length < 3} onClick={make}><Icon name="wand" size={15} /> {busy ? (mode === 'reel' ? 'Writing the script…' : 'Starting…') : mode === 'image' ? 'Make images' : mode === 'clip' ? 'Make clip' : 'Write the script'}</button>
            {mode === 'reel' && <p className="hint">You’ll see the script first — lines, shots and the closing card — and nothing is made until you approve it.</p>}
            {mode === 'clip' && <p className="hint">Clips are silent for now. Low-resolution renders are sharpened to 720p.</p>}
          </div>
        </div>
      </Panel>

      {!d.assets.length ? <Empty icon="image" title="Nothing made yet" text="Describe a product shot or a scene above. Add your real product photo to keep it exactly as it is." /> : (
        <div className="st-grid">{d.assets.map((a) => {
          const [label, tone] = STATUS[a.status] || [a.status, ''];
          if (a.kind === 'reel') return (
            <div key={a.id} className={`st-card st-${a.status}`}>
              <button type="button" className="st-media st-reel" style={{ aspectRatio: '9 / 16' }} onClick={() => setOpen(a.id)} aria-label={`Open ${a.title}`}>
                {a.poster ? <img src={a.poster} alt="" /> : <span className={ACTIVE.includes(a.status) ? 'spin dark' : 'muted sm'}>{ACTIVE.includes(a.status) ? '' : 'Script'}</span>}
                <span className="st-play"><Icon name="play" size={18} /></span>
              </button>
              <div className="st-meta">
                <span className="row"><span className={`pill ${tone}`}>{label}</span><small className="muted">Reel · {a.seconds}s · {(a.sizes || ['9:16']).join(', ')}</small></span>
                <b className="sm">{a.title}</b>
                {a.issues?.length > 0 && <ul className="st-issues">{a.issues.slice(0, 2).map((x) => <li key={x}>{x}</li>)}</ul>}
                <div className="row"><button className="btn primary sm" onClick={() => setOpen(a.id)}>{a.status === 'script_ready' ? 'Check the script' : 'Open'}</button><button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => remove(a)}><Icon name="trash" size={14} /></button></div>
              </div>
            </div>
          );
          return (
            <div key={a.id} className={`st-card st-${a.status}`}>
              <div className="st-media" style={{ aspectRatio: a.aspect.replace(':', ' / ') }}>
                {a.url ? (a.kind === 'clip' ? <video src={a.url} poster={a.poster || undefined} controls preload="none" playsInline /> : <img src={a.url} alt={a.prompt} loading="lazy" />) : <span className={ACTIVE.includes(a.status) ? 'spin dark' : ''} />}
              </div>
              <div className="st-meta">
                <span className="row"><span className={`pill ${tone}`}>{label}</span><small className="muted">{a.kind === 'clip' ? `Clip · ${a.seconds}s` : 'Image'} · {d.tiers.find((t) => t.id === a.tier)?.name}{a.enhanced ? ' · sharpened' : ''}</small></span>
                <p className="sm st-prompt">{a.prompt}</p>
                {a.issues?.length > 0 && <ul className="st-issues">{a.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
                {a.error && <p className="sm bad-t">{a.error}</p>}
                <small className="muted">{fmtDate(a.doneAt || a.at)}{a.attempts > 1 ? ` · ${a.attempts} tries` : ''}</small>
                {!ACTIVE.includes(a.status) && (
                  <div className="row">
                    {a.url && <a className="btn ghost sm" href={a.url} download><Icon name="download" size={13} /> Download</a>}
                    {a.kind === 'image' && a.status === 'ready' && <button className="btn ghost sm" onClick={() => toClip(a)}><Icon name="play" size={13} /> Make a clip</button>}
                    <button className="btn ghost sm" onClick={() => redo(a)}><Icon name="redo" size={13} /> Redo</button>
                    <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => remove(a)}><Icon name="trash" size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}</div>
      )}
      {open && d.assets.find((a) => a.id === open) && <ReelView key={open + d.assets.find((a) => a.id === open).status} r={d.assets.find((a) => a.id === open)} styles={d.captionStyles} onClose={() => setOpen(null)} onChange={load} />}
    </Layout>
  );
}
