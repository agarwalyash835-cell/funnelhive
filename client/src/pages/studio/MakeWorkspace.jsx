// Studio when no Reel is open: the canvas is the work (a masonry gallery, newest first, live progress on what's being
// made), the prompt bar sits under it, and the inspector on the right holds the settings and what it will cost.
// Image and clip: the words are checked for quality and virality first (free), then the credits are confirmed.
// Reel: the brief becomes a script (free) and the Reel opens on the canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Icon, toast, confirmDialog, promptDialog } from '../../ui';
import { Viewer } from '../StudioViewer';
import { ACTIVE, WAIT, BADGE, TIER_HINT, ASPECT_NAME, USUALLY, IDEAS, ago, toDataUrl, dayOf, aspectOf, Ratio, Score, Section, Seg, Field } from './shared';
import { extOf } from './extensions';

export function useComposer(d, mode, v) {
  // the tier's models (the first is its default): what each makes, what it costs
  const tierInfo = d?.tiers?.find((t) => t.id === v.tier) || d?.tiers?.[0];
  const vms = tierInfo?.models?.video || [], ims = tierInfo?.models?.image || [];
  const vm = vms.find((m) => m.id === v.vmodel) || vms[0], im = ims.find((m) => m.id === v.imodel) || ims[0];
  const resOpts = vm?.res || tierInfo?.clipRes || [];
  const res = resOpts.includes(v.res) ? v.res : vm?.defaultRes || resOpts.at(-1);
  const perSec = (r) => (vm?.per5s?.[r] ?? tierInfo?.clipCreditsPer5s?.[r] ?? 0) / 5;
  // a clip's exact cost comes from the server (some models charge per clip, by length)
  const [clipCredits, setClipCredits] = useState(null);
  useEffect(() => { if (mode !== 'clip' || !vm) return undefined; let live = true; setClipCredits(null); api('/studio/estimate', 'POST', { kind: 'clip', tier: v.tier, model: vm?.id, seconds: v.seconds, res }).then((e) => live && setClipCredits(e.credits)).catch(() => {}); return () => { live = false; }; }, [mode, v.tier, vm?.id, v.seconds, res]);
  // a Reel's price follows its script, so before the script exists it's an estimate for a typical one
  const [reelEst, setReelEst] = useState(null);
  useEffect(() => { if (mode !== 'reel' || !vm) return undefined; let live = true; api('/studio/estimate', 'POST', { kind: 'reel', tier: v.tier, seconds: v.length, vmodel: vm?.id, imodel: im?.id, res }).then((e) => live && setReelEst(e)).catch(() => {}); return () => { live = false; }; }, [mode, v.tier, vm?.id, im?.id, v.length, res]);
  const cost = mode === 'image' ? (im?.credits ?? tierInfo?.imageCredits ?? 0) * v.count : mode === 'clip' ? clipCredits ?? Math.ceil(perSec(res) * v.seconds) : null;
  return { tierInfo, vms, ims, vm, im, resOpts, res, perSec, cost, reelEst };
}

export function MakeWorkspace({ d, mode, v, set, assets, load, onOpenReel, openMemory, extensions, modeExt, onSelect }) {
  const c = useComposer(d, mode, v);
  const { tierInfo, vms, ims, vm, im, resOpts, res, perSec, cost } = c;
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(null);
  const [check, setCheck] = useState(null); // the last before-you-spend check, kept in the inspector
  const file = useRef(), logoFile = useRef(), box = useRef();

  const counts = useMemo(() => ({ all: assets.length, image: assets.filter((a) => a.kind === 'image').length, clip: assets.filter((a) => a.kind === 'clip').length, reel: assets.filter((a) => a.kind === 'reel').length, live: assets.filter((a) => ACTIVE.includes(a.status)).length, review: assets.filter((a) => a.status === 'needs_review' || a.status === 'failed').length }), [assets]);
  const shown = [...assets].sort((x, y) => y.at - x.at).filter((a) => filter === 'all' || (filter === 'live' ? ACTIVE.includes(a.status) : filter === 'review' ? ['needs_review', 'failed'].includes(a.status) : a.kind === filter));
  const viewable = shown.filter((a) => a.kind !== 'reel' && a.url);
  const images = assets.filter((a) => a.kind === 'image' && a.url && a.status !== 'failed');
  const src = v.sourceId ? images.find((x) => x.id === v.sourceId)?.url : v.ref;
  // the brand kit a Reel is made with (a client's, or another of the seller's brands): only asked when there's a choice
  const kits = d.kits || [];
  const kit = kits.find((k) => k.id === v.kitId) || kits.find((k) => k.isDefault) || null;
  const voices = d.voices || [];

  const upload = async (f, key = 'ref') => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) return toast('Pick a JPG, PNG or WebP picture under 5 MB');
    try { const r = await api('/uploads', 'POST', { type: f.type, data: await toDataUrl(f) }); if (key === 'logo') set({ logo: r.url }); else set({ ref: r.url, sourceId: '' }); } catch (e) { toast(e.message); }
  };
  const make = async () => {
    setBusy(true);
    try {
      if (mode === 'reel') {
        const r = await api('/studio/reels', 'POST', { brief: v.prompt, lang: v.lang, seconds: v.length, tier: v.tier, vmodel: vm?.id, imodel: im?.id, res, voice: v.voice || undefined, captions: v.captions, sizes: v.sizes, aspect: v.sizes?.[0] || '9:16', ...(v.motion ? { motion: v.motion } : {}), ...(v.presenter ? { presenter: { style: v.presenter } } : {}), ...(v.ref ? { ref: v.ref } : {}), ...(v.logo ? { logo: v.logo } : {}), ...(kit ? { kitId: kit.id } : {}) });
        set({ prompt: '' }); await load(); onOpenReel(r.id);
      } else {
        // before spending: the words checked for quality and virality, and a stronger version offered (free)
        let prompt = v.prompt;
        const chk = await api('/studio/assess', 'POST', { kind: mode, prompt, aspect: v.aspect, seconds: v.seconds, ...(v.sourceId ? { sourceId: v.sourceId } : v.ref ? { ref: v.ref } : {}) }).catch(() => null);
        if (chk) {
          setCheck({ ...chk, for: prompt });
          const why = `Quality ${chk.quality ?? '–'}/100 · Virality ${chk.virality ?? '–'}/100. ${chk.verdict}${chk.problems.length ? `\n\n• ${chk.problems.join('\n• ')}` : ''}`;
          if (chk.prompt && await confirmDialog({ title: 'Before you spend', text: `${why}\n\nA stronger version:\n“${chk.prompt}”`, confirm: 'Use the stronger version', cancel: 'Keep mine' })) { prompt = chk.prompt; set({ prompt }); }
        }
        if (mode === 'image' && !(await confirmDialog({ title: `Make ${v.count > 1 ? `${v.count} images` : 'this image'}?`, text: `${im?.name || 'The image model'} makes ${v.count > 1 ? 'them' : 'it'} for about ${cost} credits.`, confirm: `Make it · ${cost} credits` }))) { setBusy(false); return; }
        // the picture shown is the one sent: a Studio image picked with "Animate" is a saved file of the seller's, so it goes as the reference
        if (mode === 'image') await api('/studio/images', 'POST', { prompt, tier: v.tier, model: im?.id, aspect: v.aspect, count: v.count, ...(src ? { ref: src } : {}) });
        else {
          // a video costs real credits: say how many, and go ahead only on a yes
          const other = resOpts.filter((r) => r !== res).map((r) => `${r}: about ${Math.ceil(perSec(r) * v.seconds)} credits`).join(' · ');
          if (!(await confirmDialog({ title: `Make this ${v.seconds}-second clip?`, text: `${vm?.name || 'The video model'} makes it at ${res} for about ${cost} credits.${other ? ` (${other}.)` : ''} Clips below 720p are sharpened up to 720p for free.`, confirm: `Make it · ${cost} credits` }))) { setBusy(false); return; }
          await api('/studio/clips', 'POST', { prompt, tier: v.tier, model: vm?.id, res, aspect: v.aspect, seconds: v.seconds, ...(v.sourceId ? { sourceId: v.sourceId } : v.ref ? { ref: v.ref } : {}) });
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
  const animate = (a) => { set({ sourceId: a.id, ref: '', aspect: a.aspect === '1:1' ? '9:16' : a.aspect, prompt: '' }, 'clip'); setView(null); setTimeout(() => box.current?.focus(), 200); };
  // the image or clip open in the viewer is the one selected (the Director chat's "this one"); null once it's closed
  const selected = view != null ? viewable[view] || null : null;
  useEffect(() => { onSelect?.(selected); }, [selected?.id]);
  useEffect(() => () => onSelect?.(null), []);
  const openCard = (a) => { if (a.kind === 'reel') return onOpenReel(a.id); const i = viewable.findIndex((x) => x.id === a.id); if (i >= 0) setView(i); };
  const canGo = v.prompt.trim().length >= (mode === 'reel' ? 10 : 3) && !busy;
  const go = mode === 'image' ? `Make ${v.count > 1 ? `${v.count} images` : 'image'}` : mode === 'clip' ? 'Make clip' : 'Write the script';
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
    <>
      <main className="sxw-stage" aria-label="Canvas">
        <div className="sxs-bar">
          <div className="sxs-filters" role="tablist" aria-label="Show">
            {[['all', 'All work'], ['image', 'Images'], ['clip', 'Clips'], ['reel', 'Reels'], ['live', 'In progress'], ['review', 'Needs a look']].map(([k, l]) => (counts[k] || k === 'all') ? <button key={k} type="button" role="tab" aria-selected={filter === k} className={`sx-chip${filter === k ? ' on' : ''}${k === 'live' ? ' live' : ''}`} onClick={() => setFilter(k)}>{k === 'live' && <i className="sxs-dot" />}{l}<span className="n">{counts[k]}</span></button> : null)}
          </div>
        </div>
        <div className="sxs-canvas">
          {!shown.length ? (
            <div className="sxs-hero">
              <span className="sxs-hero-art" aria-hidden="true"><i /><i /><i /></span>
              <h2>{assets.length ? 'Nothing here' : mode === 'reel' ? 'Your first Reel starts with a brief' : mode === 'clip' ? 'Bring a product shot to life' : 'Studio-grade product shots, in a minute'}</h2>
              <p>{assets.length ? 'Try another filter.' : mode === 'reel' ? 'Say what you sell, who it’s for and the offer. You get the script, the storyboard and the price before anything is made.' : 'Describe it below — or ask the creative director on the left. Add your real product photo to keep it exactly as it is.'}</p>
              {!assets.length && <div className="sxs-ideas">{IDEAS[mode]?.map((x) => <button key={x} type="button" onClick={() => { set({ prompt: x }); box.current?.focus(); }}>{x}</button>)}</div>}
            </div>
          ) : (
            <div className="sx-grid">{shown.map((a) => {
              const day = dayOf(a.at), head = day !== lastDay ? (lastDay = day) : null;
              const [w, h] = aspectOf(a.aspect);
              const wait = WAIT[a.status], badge = BADGE[a.status];
              return [
                head && <div key={`h-${a.id}`} className="sx-group" style={{ columnSpan: 'all' }}>{head}</div>,
                <div key={a.id} className={`sx-card st-${a.status}${selected?.id === a.id ? ' on' : ''}`} style={selected && selected.id !== a.id ? { opacity: 0.55, transition: 'opacity .2s, transform .2s' } : selected?.id === a.id ? { transform: 'scale(1.02)', transition: 'opacity .2s, transform .2s' } : undefined} aria-pressed={selected?.id === a.id} role="button" tabIndex={0} onClick={() => openCard(a)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openCard(a); }} aria-label={a.title || a.prompt}>
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
                    : a.kind === 'reel' ? (a.poster ? <img src={a.poster} alt="" style={{ aspectRatio: '9 / 16', objectFit: 'cover' }} /> : <div className="sx-wait sx-script" style={{ aspectRatio: '9 / 16' }}><Icon name="wand" size={22} /><b>{a.title}</b><small>{a.status === 'storyboard_ready' ? 'Storyboard ready — open it' : 'Script ready — open to check it'}</small></div>)
                    : a.url ? <img src={a.url} alt={a.prompt} loading="lazy" /> : <div className="sx-wait" style={{ aspectRatio: `${w} / ${h}`, animation: 'none' }}><Icon name="image" size={20} /></div>}
                  {badge && !(a.status === 'failed' && a.kind !== 'reel') && <span className={`sx-badge ${badge[1]}`}>{badge[0]}</span>}
                  {!wait && a.status !== 'failed' && <span className="sx-kind">{a.kind === 'reel' ? `Reel · ${a.seconds}s` : a.kind === 'clip' ? `Clip · ${a.seconds}s` : d.tiers.find((t) => t.id === a.tier)?.name}</span>}
                  {!wait && a.status !== 'failed' && (
                    <div className="sx-over">
                      <p>{a.title || a.prompt}</p>
                      <div className="sx-acts" onClick={(e) => e.stopPropagation()}>
                        {a.kind === 'reel' ? <button onClick={() => onOpenReel(a.id)}><Icon name="edit" size={13} /> Open</button> : <>
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

        <section className="sxs-prompt" aria-label="Make something">
          {!v.prompt.trim() && shown.length > 0 && <div className="sx-ideas" aria-label="Ideas">{IDEAS[mode]?.slice(0, 3).map((x) => <button key={x} type="button" onClick={() => { set({ prompt: x }); box.current?.focus(); }}>{x}</button>)}</div>}
          <div className="sx-prompt">
            <button type="button" className="sx-ref" title={mode === 'clip' ? 'Start from a picture' : 'Your product photo — kept exactly as it is'} onClick={() => file.current?.click()}>
              {src ? <><img src={src} alt="" /><span className="sx-x" role="button" aria-label="Remove picture" onClick={(e) => { e.stopPropagation(); set({ ref: '', sourceId: '' }); }}><Icon name="x" size={12} /></span></> : <><Icon name="image" size={18} /><small>{mode === 'clip' ? 'Start picture' : 'Product photo'}</small></>}
            </button>
            <textarea ref={box} rows={2} maxLength={1500} value={v.prompt} onChange={(e) => set({ prompt: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canGo) make(); }} aria-label="Describe what to make"
              placeholder={mode === 'image' ? 'Describe the picture — e.g. a jar of desi ghee on a wooden kitchen counter, warm morning light, a brass spoon beside it' : mode === 'clip' ? 'Describe the movement — e.g. slow push-in on the jar as steam rises from a bowl of rice beside it' : 'What’s the ad about? The product, who it’s for and the offer — e.g. our farm-made desi ghee, ₹499 a litre; order on WhatsApp'} />
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <button className="btn primary sx-go" disabled={!canGo} onClick={make} title="Ctrl + Enter">
              {busy ? <><span className="spin" /> {mode === 'reel' ? 'Writing…' : 'Starting…'}</> : <><Icon name="wand" size={16} /> {go}<span className="sx-go-c">{mode === 'reel' ? 'free' : `${cost ?? '…'} cr`}</span></>}
            </button>
          </div>
          <p className="sx-hint">{mode === 'reel' ? 'You’ll see the script, the storyboard and the price first — nothing is made until you approve.' : mode === 'clip' ? 'Clips start from your picture when you add one, so the product stays the same. Clips are silent; Reels add voice and captions.' : 'Add your real product photo to keep it exactly as it is.'} <span className="sx-kbd">Ctrl + Enter</span></p>
        </section>
      </main>

      <aside className="sxw-inspect" aria-label="Settings">
        <div className="sxi-head"><b>{mode === 'image' ? 'Image' : mode === 'clip' ? 'Video clip' : 'Reel · full ad'}</b><small>{USUALLY[mode]?.split(' — ')[0]}</small></div>
        {mode === 'reel' && kits.length > 1 && <Section id="make-kit" title="Brand" icon="layout" extra={<small className="muted">{kit?.label}</small>}>
          <Field label="Brand kit" hint="Its logo, colours, font, call to action and legal line — and whatever it locks"><select value={kit?.id || ''} onChange={(e) => set({ kitId: e.target.value })}>{kits.map((k) => <option key={k.id} value={k.id}>{k.label}{k.isDefault ? ' (default)' : ''}</option>)}</select></Field>
        </Section>}
        {mode === 'reel' && <Recommend brief={v.prompt} v={v} set={set} />}
        <Section id="make-quality" title="Quality" icon="sparkles">
          <div className="sxi-tiers">{d.tiers.map((t) => <button key={t.id} type="button" className={v.tier === t.id ? 'on' : ''} aria-pressed={v.tier === t.id} onClick={() => set({ tier: t.id })}><b>{t.name}</b><small>{TIER_HINT[t.id]}</small></button>)}</div>
          {mode !== 'image' && vms.length > 0 && <Field label="Video model" hint={vm?.note}><select value={vm?.id} onChange={(e) => set({ vmodel: e.target.value })}>{vms.map((m) => <option key={m.id} value={m.id}>{m.name} · from {Math.min(...Object.values(m.per5s))} credits / 5s</option>)}</select></Field>}
          {(mode === 'image' || mode === 'reel') && ims.length > 0 && <Field label={mode === 'reel' ? 'Stills model' : 'Image model'} hint={im?.note}><select value={im?.id} onChange={(e) => set({ imodel: e.target.value })}>{ims.map((m) => <option key={m.id} value={m.id}>{m.name}{v.ref && !m.product ? ' (can’t keep your product photo)' : ''} · {m.credits} credits</option>)}</select></Field>}
          {mode !== 'image' && resOpts.length > 1 && <Field label="Resolution" hint="Below 720p is sharpened up to 720p for free"><Seg label="Resolution" value={res} onChange={(r) => set({ res: r })} options={resOpts.map((r) => [r, r, mode === 'clip' ? `${Math.ceil(perSec(r) * v.seconds)} cr` : `${Math.round(perSec(r) * 10) / 10}/s`])} /></Field>}
        </Section>
        <Section id="make-frame" title="Frame" icon="layout">
          {mode !== 'reel' ? <Seg label="Frame" wrap value={v.aspect} onChange={(a) => set({ aspect: a })} options={d.aspects.map((x) => [x, <><Ratio a={x} />{x}</>, ASPECT_NAME[x]])} />
            : <Seg label="Frame" wrap value={v.sizes[0] || '9:16'} onChange={(a) => set({ sizes: [a] })} options={['9:16', '16:9', '1:1', '4:5'].map((a) => [a, <><Ratio a={a} />{a}</>, a === '16:9' ? 'Web page' : ASPECT_NAME[a]])} />}
          {mode === 'image' && <Field label="Versions"><Seg label="Versions" value={v.count} onChange={(n) => set({ count: n })} options={[1, 2, 3, 4].map((n) => [n, String(n)])} /></Field>}
          {mode === 'clip' && <Field label="Length"><Seg label="Length" value={v.seconds} onChange={(n) => set({ seconds: n })} options={[4, 5, 6, 8, 10, 15].map((n) => [n, `${n}s`])} /></Field>}
          {mode === 'reel' && <Field label="Length"><Seg label="Length" value={v.length} onChange={(n) => set({ length: n })} options={d.lengths.map((n) => [n, `${n}s`])} /></Field>}
        </Section>
        {mode === 'reel' && <Section id="make-voice" title="Voice & captions" icon="mic">
          <Field label="Language"><select value={v.lang} onChange={(e) => set({ lang: e.target.value })}>{d.languages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Voice"><select value={v.voice} onChange={(e) => set({ voice: e.target.value })}><option value="">Auto (your usual, or Priya)</option>{voices.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.note}</option>)}</select></Field>
          <Field label="Captions"><select value={v.captions} onChange={(e) => set({ captions: e.target.value })}>{d.captionStyles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <div className="sxi-logo">
            <button type="button" className="btn ghost sm" onClick={() => logoFile.current?.click()}>{v.logo ? <img src={v.logo} alt="" /> : <Icon name="plus" size={14} />}{v.logo ? 'Change logo' : 'Add your logo'}</button>
            {v.logo && <button type="button" className="icon-btn" aria-label="Remove logo" onClick={() => set({ logo: '' })}><Icon name="x" size={14} /></button>}
            <input ref={logoFile} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={(e) => { upload(e.target.files?.[0], 'logo'); e.target.value = ''; }} />
          </div>
        </Section>}
        <div className="sxi-cost">
          {mode === 'reel' ? <>
            <span className="sxi-lbl">Script</span><b className="sxi-big">Free</b>
            <small>A typical {v.length}s Reel at {res}: storyboard about {c.reelEst?.storyboard ?? '…'} credits, finished about {c.reelEst?.byRes?.[res] ?? c.reelEst?.credits ?? '…'}. You approve each step.</small>
          </> : <>
            <span className="sxi-lbl">Estimated cost</span><b className="sxi-big">{cost ?? '…'}<small> credits</small></b>
            <small>{mode === 'image' ? `${im?.name || 'Image model'} · ${v.count} × ${v.aspect}` : `${vm?.name || 'Video model'} · ${v.seconds}s at ${res}`}. Asked again before anything is made.</small>
          </>}
        </div>
        {check && mode !== 'reel' && <Section id="make-check" title="Before you spend" icon="shield">
          <div className="sxi-scores"><Score value={check.quality} label="Quality" /><Score value={check.virality} label="Virality" hot /></div>
          {check.verdict && <p className="sxi-say">{check.verdict}</p>}
          {check.problems?.length > 0 && <ul className="sxi-list">{check.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
          {check.prompt && v.prompt !== check.prompt && <button type="button" className="btn ghost sm" onClick={() => { set({ prompt: check.prompt }); box.current?.focus(); }}><Icon name="check" size={13} /> Use the stronger version</button>}
        </Section>}
        <button type="button" className="sxi-memory" onClick={openMemory} title="Your brand, taste, characters and usual choices — every new Reel script uses them"><Icon name="sparkles" size={14} /><span><b>What Studio remembers</b><small>Brand, taste, characters, usual choices</small></span><Icon name="chevron" size={14} /></button>
        {extOf(extensions, 'inspector', d).map((x) => <Section key={x.id} id={`ext-${x.id}`} title={x.label} icon={x.icon}><x.Panel d={d} mode={mode} load={load} /></Section>)}
        {modeExt?.Inspector && <modeExt.Inspector d={d} load={load} />}
      </aside>
      {view != null && viewable[view] && <Viewer items={viewable.map((a) => ({ ...a, tierName: d.tiers.find((t) => t.id === a.tier)?.name }))} index={view} onIndex={setView} onClose={() => setView(null)} actions={actionsFor} />}
    </>
  );
}

// what the video is for → what to make it with (server studio/recommend.js): the recommendation, why, what it costs,
// and a cheaper and a more premium choice — one click applies it, and every setting below can still be changed
const MOTION_NAME = { story: 'storyline', video: 'AI video', photo: 'photo motion' };
function Recommend({ brief, v, set }) {
  const [purpose, setPurpose] = useState('');
  const [rec, setRec] = useState(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => api('/studio/recommend', 'POST', { brief, purpose: purpose || undefined, seconds: v.length }).then((x) => live && setRec(x)).catch(() => {}), purpose ? 0 : 600);
    return () => { live = false; clearTimeout(t); };
  }, [brief, purpose, v.length]);
  if (!rec?.settings) return null;
  const s = rec.settings;
  const applied = v.tier === s.tier && v.vmodel === s.vmodel && v.imodel === s.imodel && (v.res || '') === s.res && v.motion === s.motion && v.sizes?.[0] === s.aspect;
  const apply = (x) => set({ tier: x.tier, vmodel: x.vmodel, imodel: x.imodel, res: x.res, motion: x.motion, sizes: [x.aspect], length: x.seconds, presenter: x.presenter || '' });
  const Choice = ({ c, label }) => (c ? <button type="button" className="btn ghost sm" onClick={() => apply(c.settings)} title={`${c.settings.vmodel} · ${c.settings.res} · ${MOTION_NAME[c.settings.motion]}`}>{label} · {c.credits} cr</button> : null);
  return (
    <Section id="make-recommend" title="Recommended for this video" icon="wand">
      <Field label="What is it for?" hint={rec.guessed && !purpose ? 'Guessed from your brief — change it if it’s something else' : ''}>
        <select value={purpose || rec.purpose} onChange={(e) => setPurpose(e.target.value)}>{rec.purposes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      </Field>
      <div className="sxi-rec">
        <b>{s.tier[0].toUpperCase() + s.tier.slice(1)} · {s.res} · {s.aspect} · {MOTION_NAME[s.motion]}{s.presenter ? ' · talking presenter' : ''}</b>
        <small>{rec.why}</small>
        <span className="sxi-rec-c">About {rec.credits} credits for {s.seconds}s</span>
      </div>
      <div className="row">
        <button type="button" className="btn primary sm" disabled={applied} onClick={() => apply(s)}><Icon name="check" size={13} /> {applied ? 'Using the recommendation' : 'Use the recommendation'}</button>
        <Choice c={rec.cheaper} label="Cheaper" /><Choice c={rec.premium} label="More premium" />
      </div>
    </Section>
  );
}
