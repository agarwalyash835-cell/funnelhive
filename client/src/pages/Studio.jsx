// Studio: AI images, video clips and finished Reels for ads and pages (server studio/). One composer at the top (what
// to make, your product photo, the settings), a gallery underneath with live progress, a full-screen viewer to zoom
// and browse, and the Reel editor for videos made from a brief. Tiers only — Quick, Standard, Cinematic.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Layout, Icon, Empty, toast, confirmDialog, promptDialog } from '../ui';
import { Viewer } from './StudioViewer';
import { ReelEditor } from './StudioReel';
import '../studio.css';

const ACTIVE = ['queued', 'rendering', 'checking', 'producing', 'editing'];
const WAIT = { queued: ['Waiting to start', 0], rendering: ['Rendering', 1], checking: ['Checking quality', 2], producing: ['Making shots and voiceover', 1], editing: ['Editing the video', 2] };
const BADGE = { ready: null, needs_review: ['Needs a look', 'warn'], failed: ['Couldn’t be made', 'bad'], script_ready: ['Script ready', ''] };
const TIER_HINT = { quick: 'Fast drafts', standard: 'Good for most ads', cinematic: 'Best quality, slowest' };
const RATIO = { '9:16': [9, 16], '1:1': [12, 12], '16:9': [16, 9], '4:5': [10, 12.5], '3:4': [10, 13.3] };
const ASPECT_NAME = { '9:16': 'Reels / Stories', '1:1': 'Square', '16:9': 'Wide', '4:5': 'Feed', '3:4': 'Portrait' };
const ago = (t) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const toDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
const Ratio = ({ a }) => { const [w, h] = RATIO[a] || [12, 12]; return <span className="sx-ratio" style={{ width: w, height: h }} />; };
const dayOf = (t) => { const d = new Date(t), now = new Date(); const same = (x) => x.toDateString() === d.toDateString(); if (same(now)) return 'Today'; const y = new Date(now); y.setDate(now.getDate() - 1); return same(y) ? 'Yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }); };

// how long things usually take (from real runs), so a seller knows whether to wait or come back
const USUALLY = { image: 'usually about a minute', clip: 'usually 2–4 minutes', reel: 'usually 6–12 minutes — we’ll tell you when it’s ready' };
// one-tap starting points: what sellers on the platform actually make
const IDEAS = {
  image: ['My product on a clean white background, soft studio light', 'My product on a festive Diwali table with diyas and marigolds', 'Lifestyle shot: a happy family using my product at home', 'Flat lay of my product with its ingredients around it'],
  clip: ['Slow push-in on the product as light moves across it', 'The product rotates slowly on a turntable', 'Hands pick up the product and show it to the camera', 'Steam rises and the camera pulls back to reveal the table'],
  reel: ['Launch offer: introduce my product, the price, and how to order on WhatsApp', 'Festive sale: 20% off this week only, free delivery', 'Problem → solution: why customers switch to my product', 'Customer story: a happy buyer shows how they use it'],
};
const PREFS = 'ff_studio_prefs';
const savedPrefs = () => { try { const p = JSON.parse(localStorage.getItem(PREFS) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } };
const savePrefs = (mode, v) => { try { localStorage.setItem(PREFS, JSON.stringify({ tier: v.tier, res: v.res, aspect: v.aspect, count: v.count, seconds: v.seconds, lang: v.lang, length: v.length, voice: v.voice, captions: v.captions, sizes: v.sizes })); } catch { /* private mode */ } };

export default function Studio() {
  const [d, setD] = useState(null);
  const [mode, setMode] = useState('image');
  // the composer opens with this browser's last settings (never the words or pictures)
  const [v, setV] = useState(() => ({ prompt: '', tier: 'standard', res: '', aspect: '1:1', count: 1, ref: '', sourceId: '', seconds: 5, lang: 'en', length: 30, voice: '', captions: 'pop', sizes: ['9:16'], logo: '', ...savedPrefs() }));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(null); // index in the viewable list
  const [open, setOpen] = useState(null); // a Reel's id
  const [, tick] = useState(0);
  const file = useRef(), logoFile = useRef(), box = useRef();
  const seen = useRef(null); // ids that were still being made at the last look
  const load = () => api('/studio').then((x) => {
    // something finished while the seller waited: say so (and on the tab, if they're elsewhere)
    const was = seen.current, now = new Set((x.assets || []).filter((a) => ACTIVE.includes(a.status)).map((a) => a.id));
    if (was) for (const a of x.assets || []) if (was.has(a.id) && !now.has(a.id) && !a.reelId) {
      const what = a.kind === 'reel' ? `Your Reel “${a.title}”` : a.kind === 'clip' ? 'Your clip' : 'Your image';
      toast(a.status === 'failed' ? `${what} couldn’t be made — open it to retry` : a.status === 'needs_review' ? `${what} is ready — have a look` : `${what} is ready`);
      if (document.hidden) document.title = `● ${document.title.replace(/^● /, '')}`;
    }
    seen.current = now; setD(x);
  }).catch(() => setD(false));
  useEffect(() => { load(); const back = () => { document.title = document.title.replace(/^● /, ''); }; document.addEventListener('visibilitychange', back); return () => document.removeEventListener('visibilitychange', back); }, []);
  useEffect(() => { savePrefs(mode, v); }, [mode, v.tier, v.res, v.aspect, v.count, v.seconds, v.lang, v.length, v.voice, v.captions, v.sizes.join()]);
  const live = !!d?.assets?.some((a) => ACTIVE.includes(a.status));
  // while something renders: look again every few seconds, and keep the timers moving
  useEffect(() => { if (!live) return undefined; const p = setInterval(load, 4000), t = setInterval(() => tick((n) => n + 1), 1000); return () => { clearInterval(p); clearInterval(t); }; }, [live]);
  const assets = d?.assets || [];
  const counts = useMemo(() => ({ all: assets.length, image: assets.filter((a) => a.kind === 'image').length, clip: assets.filter((a) => a.kind === 'clip').length, reel: assets.filter((a) => a.kind === 'reel').length, live: assets.filter((a) => ACTIVE.includes(a.status)).length, review: assets.filter((a) => a.status === 'needs_review' || a.status === 'failed').length }), [assets]);
  // newest first, always (the day headings rely on it)
  const shown = [...assets].sort((x, y) => y.at - x.at).filter((a) => filter === 'all' || (filter === 'live' ? ACTIVE.includes(a.status) : filter === 'review' ? ['needs_review', 'failed'].includes(a.status) : a.kind === filter));
  // what the viewer can step through: finished images and clips in the shown order
  const viewable = shown.filter((a) => a.kind !== 'reel' && a.url);
  const reel = open && assets.find((a) => a.id === open);

  if (d === false) return <Layout title="Studio"><Empty icon="wand" title="Studio didn’t load" text="Reload the page to try again." /></Layout>;
  if (!d) return <Layout title="Studio" wide><div className="skeleton" /></Layout>;
  if (!d.on) return <Layout title="Studio" subtitle="AI images, video clips and Reels for your ads and pages"><Empty icon="wand" title="Studio isn’t on for your account yet" text="Studio makes product photos, scenes, short video clips and finished Reels for your ads, each one checked for quality before you see it. Ask us to switch it on." /></Layout>;

  const set = (p) => setV((x) => ({ ...x, ...p }));
  // what it costs, said before anything is made: the tier's prices (server studio/models.js), the clip resolution chosen
  const tierInfo = d.tiers.find((t) => t.id === v.tier) || d.tiers[0];
  const resOpts = tierInfo?.clipRes || [];
  const res = resOpts.includes(v.res) ? v.res : resOpts.at(-1);
  const perSec = (r) => (tierInfo?.clipCreditsPer5s?.[r] || 0) / 5;
  const cost = mode === 'image' ? (tierInfo?.imageCredits || 0) * v.count : mode === 'clip' ? Math.ceil(perSec(res) * v.seconds) : null;
  const images = assets.filter((a) => a.kind === 'image' && a.url && a.status !== 'failed');
  const src = v.sourceId ? images.find((x) => x.id === v.sourceId)?.url : v.ref;
  const upload = async (f, key = 'ref') => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Pick a JPG, PNG or WebP picture under 5 MB');
    try { const r = await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) }); if (key === 'logo') set({ logo: r.url }); else set({ ref: r.url, sourceId: '' }); } catch (e) { toast(e.message); }
  };
  const changeMode = (k) => { setMode(k); set({ aspect: k === 'image' ? v.aspect === '9:16' ? '1:1' : v.aspect : '9:16' }); };
  const make = async () => {
    setBusy(true);
    try {
      if (mode === 'reel') {
        const r = await api('/studio/reels', 'POST', { brief: v.prompt, lang: v.lang, seconds: v.length, tier: v.tier, res, voice: v.voice || 'female', captions: v.captions, sizes: v.sizes, aspect: v.sizes?.[0] || '9:16', ...(v.ref ? { ref: v.ref } : {}), ...(v.logo ? { logo: v.logo } : {}) });
        set({ prompt: '' }); await load(); setOpen(r.id);
      } else {
        if (mode === 'image') await api('/studio/images', 'POST', { prompt: v.prompt, tier: v.tier, aspect: v.aspect, count: v.count, ...(v.ref ? { ref: v.ref } : {}) });
        else {
          // a video costs real credits: say how many, and go ahead only on a yes
          const other = resOpts.filter((r) => r !== res).map((r) => `${r}: about ${Math.ceil(perSec(r) * v.seconds)} credits`).join(' · ');
          if (!(await confirmDialog({ title: `Make this ${v.seconds}-second clip?`, text: `It uses about ${cost} credits at ${res}.${other ? ` (${other}.)` : ''} Clips below 720p are sharpened up to 720p for free.`, confirm: `Make it · ${cost} credits` }))) { setBusy(false); return; }
          await api('/studio/clips', 'POST', { prompt: v.prompt, tier: v.tier, res, aspect: v.aspect, seconds: v.seconds, ...(v.sourceId ? { sourceId: v.sourceId } : v.ref ? { ref: v.ref } : {}) });
        }
        set({ prompt: '' }); setFilter('all'); load();
      }
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const redo = async (a) => {
    const fix = a.fix ? ` Leave it empty to use the quality check's suggestion: “${a.fix}”` : ' Leave it empty to just try again.';
    const note = await promptDialog({ title: `Make it again · about ${a.redoCredits || '?'} credits`, text: `This makes a new ${a.kind === 'clip' ? `${a.seconds}-second clip at ${a.res}` : 'image'} and uses about ${a.redoCredits || '?'} credits. What should change?${fix}`, label: 'Change', value: '', confirm: 'Redo' });
    if (note === null || note === undefined) return;
    try { await api(`/studio/assets/${a.id}/redo`, 'POST', { note }); setView(null); load(); } catch (e) { toast(e.message); }
  };
  const remove = async (a) => { if (!(await confirmDialog({ title: 'Delete this?', text: 'It’s removed from Studio.', confirm: 'Delete', danger: true }))) return; try { await api(`/studio/assets/${a.id}`, 'DELETE'); setView(null); load(); } catch (e) { toast(e.message); } };
  const animate = (a) => { setMode('clip'); set({ sourceId: a.id, ref: '', aspect: a.aspect === '1:1' ? '9:16' : a.aspect, prompt: '' }); setView(null); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => box.current?.focus(), 300); };
  const openCard = (a) => { if (a.kind === 'reel') return setOpen(a.id); const i = viewable.findIndex((x) => x.id === a.id); if (i >= 0) setView(i); };
  const canGo = v.prompt.trim().length >= (mode === 'reel' ? 10 : 3) && !busy;
  const voices = d.voices || [];

  const actionsFor = (a) => (
    <div className="sxv-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <a className="btn primary" href={a.url} download><Icon name="download" size={15} /> Download</a>
      {a.kind === 'image' ? <button className="btn ghost" onClick={() => animate(a)}><Icon name="play" size={15} /> Animate</button> : <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(new URL(a.url, location.origin).href); toast('Link copied'); }}><Icon name="link" size={15} /> Copy link</button>}
      <button className="btn ghost" onClick={() => redo(a)}><Icon name="redo" size={15} /> Redo</button>
      <button className="btn ghost" onClick={() => remove(a)}><Icon name="trash" size={15} /> Delete</button>
    </div>
  );

  let lastDay = '';
  return (
    <Layout title="Studio" subtitle="AI images, video clips and Reels for your ads — each one checked for quality" wide>
      <div className="sx">
        <section className="sx-compose" aria-label="Make something">
          <div className="sx-modes" role="tablist">
            {[['image', 'image', 'Image'], ['clip', 'play', 'Video clip'], ['reel', 'wand', 'Reel · full ad']].map(([k, ic, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => changeMode(k)}><Icon name={ic} size={15} />{l}</button>)}
          </div>
          <div className="sx-prompt">
            <button type="button" className="sx-ref" title={mode === 'clip' ? 'Start from a picture' : 'Your product photo — kept exactly as it is'} onClick={() => file.current?.click()}>
              {src ? <><img src={src} alt="" /><span className="sx-x" role="button" aria-label="Remove picture" onClick={(e) => { e.stopPropagation(); set({ ref: '', sourceId: '' }); }}><Icon name="x" size={12} /></span></> : <><Icon name="image" size={18} /><small>{mode === 'clip' ? 'Start picture' : 'Product photo'}</small></>}
            </button>
            <textarea ref={box} rows={3} maxLength={1500} value={v.prompt} onChange={(e) => set({ prompt: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canGo) make(); }}
              placeholder={mode === 'image' ? 'Describe the picture — e.g. a jar of desi ghee on a wooden kitchen counter, warm morning light, a brass spoon beside it' : mode === 'clip' ? 'Describe the movement — e.g. slow push-in on the jar as steam rises from a bowl of rice beside it' : 'What’s the ad about? The product, who it’s for and the offer — e.g. our farm-made desi ghee, ₹499 a litre, for families who want pure ghee; order on WhatsApp'} />
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="sx-bar">
            <label className="sx-pill" title={TIER_HINT[v.tier]}><span className="lbl">Quality</span>{d.tiers.find((t) => t.id === v.tier)?.name}<select value={v.tier} onChange={(e) => set({ tier: e.target.value })}>{d.tiers.map((t) => <option key={t.id} value={t.id}>{t.name} — {TIER_HINT[t.id]}</option>)}</select></label>
            {mode !== 'reel' && <label className="sx-pill"><Ratio a={v.aspect} />{v.aspect}<select value={v.aspect} onChange={(e) => set({ aspect: e.target.value })}>{d.aspects.map((x) => <option key={x} value={x}>{x} · {ASPECT_NAME[x] || ''}</option>)}</select></label>}
            {mode === 'image' && <label className="sx-pill"><span className="lbl">Versions</span>{v.count}<select value={v.count} onChange={(e) => set({ count: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
            {mode !== 'image' && resOpts.length > 1 && <label className="sx-pill" title="Lower resolution costs fewer credits; below 720p is sharpened up to 720p for free"><span className="lbl">Video</span>{res}<select value={res} onChange={(e) => set({ res: e.target.value })}>{resOpts.map((r) => <option key={r} value={r}>{r} · {mode === 'clip' ? `about ${Math.ceil(perSec(r) * v.seconds)} credits` : `${Math.round(perSec(r) * 10) / 10} credits a second`}</option>)}</select></label>}
            {mode === 'clip' && <label className="sx-pill"><span className="lbl">Length</span>{v.seconds}s<select value={v.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })}>{[4, 5, 6, 8, 10, 15].map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>}
            {mode === 'reel' && <>
              <label className="sx-pill" title="The shape every scene is made in — wide for a video on a web page (a sales letter), vertical for Reels and Stories"><span className="lbl">Frame</span>{ASPECT_NAME[v.sizes[0]] || 'Reels / Stories'}<select value={v.sizes[0] || '9:16'} onChange={(e) => set({ sizes: [e.target.value] })}>{['9:16', '16:9', '1:1', '4:5'].map((a) => <option key={a} value={a}>{a} · {a === '16:9' ? 'Web page / sales letter' : ASPECT_NAME[a]}</option>)}</select></label>
              <label className="sx-pill"><span className="lbl">Length</span>{v.length}s<select value={v.length} onChange={(e) => set({ length: Number(e.target.value) })}>{d.lengths.map((n) => <option key={n} value={n}>{n} seconds</option>)}</select></label>
              <label className="sx-pill"><span className="lbl">Language</span>{d.languages.find((x) => x.id === v.lang)?.name}<select value={v.lang} onChange={(e) => set({ lang: e.target.value })}>{d.languages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <label className="sx-pill"><span className="lbl">Voice</span>{voices.find((x) => x.id === v.voice)?.name || 'Auto'}<select value={v.voice} onChange={(e) => set({ voice: e.target.value })}><option value="">Auto (Monika, Indian female)</option>{voices.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.note}</option>)}</select></label>
              <label className="sx-pill"><span className="lbl">Captions</span>{d.captionStyles.find((x) => x.id === v.captions)?.name}<select value={v.captions} onChange={(e) => set({ captions: e.target.value })}>{d.captionStyles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <button type="button" className="sx-pill" onClick={() => logoFile.current?.click()}>{v.logo ? <img src={v.logo} alt="" style={{ height: 18, maxWidth: 60, objectFit: 'contain' }} /> : <Icon name="plus" size={14} />}{v.logo ? 'Logo' : 'Add logo'}</button>
              <input ref={logoFile} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => { upload(e.target.files?.[0], 'logo'); e.target.value = ''; }} />
            </>}
            <span className="grow" />
            <button className="btn primary sx-go" disabled={!canGo} onClick={make}><Icon name="wand" size={16} /> {busy ? (mode === 'reel' ? 'Writing the script…' : 'Starting…') : mode === 'image' ? `Make ${v.count > 1 ? `${v.count} images` : 'image'} · ${cost} credits` : mode === 'clip' ? `Make clip · ${cost} credits` : 'Write the script (free)'}</button>
          </div>
          {!v.prompt.trim() && <div className="sx-ideas" aria-label="Ideas"><span className="lbl">Try</span>{IDEAS[mode].map((x) => <button key={x} type="button" onClick={() => { set({ prompt: x }); box.current?.focus(); }}>{x}</button>)}</div>}
          <p className="sx-hint">{mode === 'reel' ? 'You’ll see the script, the storyboard and what the video will cost first — nothing is made until you approve it.' : mode === 'clip' ? 'Clips start from your picture when you add one, so the product stays the same. Clips are silent; Reels add voice and captions.' : 'Add your real product photo to keep it exactly as it is.'} {USUALLY[mode][0].toUpperCase() + USUALLY[mode].slice(1)}. <span style={{ opacity: .7 }}>Ctrl + Enter to start.</span></p>
        </section>

        <div className="sx-filters" role="tablist" aria-label="Show">
          {[['all', 'All'], ['image', 'Images'], ['clip', 'Clips'], ['reel', 'Reels'], ['live', 'In progress'], ['review', 'Needs a look']].map(([k, l]) => (counts[k] || k === 'all') ? <button key={k} type="button" className={`sx-chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}<span className="n">{counts[k]}</span></button> : null)}
        </div>

        {!shown.length ? <Empty icon="image" title={assets.length ? 'Nothing here' : 'Nothing made yet'} text={assets.length ? 'Try another filter.' : 'Describe a product shot, a short clip or a whole Reel above. Add your real product photo to keep it exactly as it is.'} /> : (
          <div className="sx-grid">{shown.map((a) => {
            const day = dayOf(a.at), head = day !== lastDay ? (lastDay = day) : null;
            const [w, h] = (a.aspect || '1:1').split(':').map(Number);
            const wait = WAIT[a.status], badge = BADGE[a.status];
            return [
              head && <div key={`h-${a.id}`} className="sx-group" style={{ columnSpan: 'all' }}>{head}</div>,
              <div key={a.id} className={`sx-card st-${a.status}`} role="button" tabIndex={0} onClick={() => openCard(a)} onKeyDown={(e) => { if (e.key === 'Enter') openCard(a); }} aria-label={a.title || a.prompt}>
                {a.status === 'failed' && a.kind !== 'reel' ? (
                  <div className="sx-fail"><b>Couldn’t be made</b><p>{a.error || a.prompt}</p><div className="row"><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); redo(a); }}><Icon name="redo" size={13} /> Try again</button><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); remove(a); }}>Delete</button></div></div>
                ) : wait ? (
                  <div className="sx-wait" style={{ aspectRatio: `${w} / ${h}` }}>
                    <span className="spin dark" />
                    <b>{wait[0]}…</b>
                    <span className="sx-steps">{[0, 1, 2].map((i) => <i key={i} className={i < wait[1] ? 'on' : i === wait[1] ? 'now' : ''} />)}</span>
                    <small className="sx-eta">{USUALLY[a.kind]?.split(' — ')[0]}</small>
                    <small>{ago(a.at)} · {a.kind === 'reel' ? `Reel · ${a.seconds}s` : a.kind === 'clip' ? `${a.seconds}s clip` : 'image'}{a.attempts > 1 ? ` · try ${a.attempts}` : ''}</small>
                  </div>
                ) : a.kind === 'clip' ? <video src={a.url} poster={a.poster || undefined} muted loop playsInline preload="none" style={{ aspectRatio: `${w} / ${h}`, objectFit: 'cover' }} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                  : a.kind === 'reel' ? (a.poster ? <img src={a.poster} alt="" style={{ aspectRatio: '9 / 16', objectFit: 'cover' }} /> : <div className="sx-wait" style={{ aspectRatio: '9 / 16', animation: 'none' }}><Icon name="wand" size={22} /><b>{a.title}</b><small>Script ready — open to check it</small></div>)
                  : <img src={a.url} alt={a.prompt} loading="lazy" />}
                {badge && !(a.status === 'failed' && a.kind !== 'reel') && <span className={`sx-badge ${badge[1]}`}>{badge[0]}</span>}
                {!wait && a.status !== 'failed' && <span className="sx-kind">{a.kind === 'reel' ? `Reel · ${a.seconds}s` : a.kind === 'clip' ? `Clip · ${a.seconds}s` : d.tiers.find((t) => t.id === a.tier)?.name}</span>}
                {!wait && a.status !== 'failed' && (
                  <div className="sx-over">
                    <p>{a.title || a.prompt}</p>
                    <div className="sx-acts" onClick={(e) => e.stopPropagation()}>
                      {a.kind === 'reel' ? <button onClick={() => setOpen(a.id)}><Icon name="edit" size={13} /> Open editor</button> : <>
                        <button onClick={() => openCard(a)} aria-label="View"><Icon name="eye" size={14} /></button>
                        {a.url && <a href={a.url} download aria-label="Download"><Icon name="download" size={14} /></a>}
                        {a.kind === 'image' && <button onClick={() => animate(a)}><Icon name="play" size={13} /> Animate</button>}
                        <button onClick={() => redo(a)} aria-label="Redo"><Icon name="redo" size={14} /></button>
                      </>}
                      <button onClick={() => remove(a)} aria-label="Delete"><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                )}
              </div>,
            ];
          })}</div>
        )}
      </div>
      {view != null && viewable[view] && <Viewer items={viewable.map((a) => ({ ...a, tierName: d.tiers.find((t) => t.id === a.tier)?.name }))} index={view} onIndex={setView} onClose={() => setView(null)} actions={actionsFor} />}
      {reel && <ReelEditor r={reel} d={d} onClose={() => setOpen(null)} onChange={load} />}
    </Layout>
  );
}
