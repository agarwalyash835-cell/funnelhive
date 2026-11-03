// Studio → the Reel editor (server studio/reels.js), full screen:
//   top     the steps (Script → Shots → Voiceover → Edit → Done), what's happening, and the next action
//   left    the storyboard: each scene's picture or clip, the line spoken over it, its check — editable before approval;
//           storyboard first: the pictures are made, then each scene can be changed, moved or dropped before animating
//   middle  a phone-sized preview: the finished video in each size, or the selected scene with its caption style
//   right   voice (with samples), caption style (visual), sizes and the closing card
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon, toast, promptDialog, confirmDialog } from '../ui';
import { Viewer } from './StudioViewer';

const STEPS = ['Script', 'Shots', 'Voiceover', 'Edit', 'Done'];
const SIZES = [['9:16', 'Reels'], ['1:1', 'Square'], ['4:5', 'Feed'], ['16:9', 'Wide']];
const RATIO = { '9:16': [9, 16], '1:1': [13, 13], '4:5': [11, 13.75], '16:9': [16, 9] };
const okStatus = (a) => a && ['ready', 'needs_review'].includes(a.status);

// where the Reel is: each step done / now / stopped
function stepsOf(r) {
  const shotsDone = r.shots?.length && r.shots.every((s) => okStatus(s.clip));
  const voiceDone = r.lines?.length && r.lines.every((l) => l.url);
  const st = { Script: r.status === 'script_ready' ? 'now' : 'done' };
  if (r.status === 'script_ready') return st;
  if (r.storyboard && r.status !== 'failed') return { ...st, Shots: 'now', Voiceover: voiceDone ? 'done' : 'now' };
  st.Shots = shotsDone ? 'done' : 'now';
  st.Voiceover = voiceDone ? 'done' : 'now';
  if (r.status === 'editing') { st.Edit = 'now'; }
  if (['ready', 'needs_review'].includes(r.status)) { st.Shots = st.Voiceover = st.Edit = st.Done = 'done'; }
  if (r.status === 'failed') {
    const e = r.error || '';
    if (/shot/i.test(e)) st.Shots = 'stop'; else if (/voice/i.test(e)) st.Voiceover = 'stop'; else st.Edit = 'stop';
  }
  return st;
}
const STATUS_LINE = { script_ready: 'Check the script and storyboard, then approve — nothing is made until you do.', storyboard: 'Drawing the storyboard: a picture for each scene, about a minute. The voiceover is recorded meanwhile.', storyboard_ready: 'Your storyboard: change, move or drop any scene, then animate it.', producing: 'Making the shots and recording the voiceover. Each is checked as it’s made.', editing: 'Putting it together: clips, voiceover, captions, logo and the closing card.', ready: 'Ready to download or put in an ad.', needs_review: 'Ready — but something needs a look (below).', failed: 'Stopped part-way — retry to finish only what’s missing.' };

function CapDemo({ id, text }) {
  const w = String(text || 'Only ₹499 today').split(/\s+/).slice(0, 4);
  if (id === 'pop') return <span className="cap-pop">{w.slice(0, -1).join(' ')} <em>{w.at(-1)}</em></span>;
  if (id === 'karaoke') return <span className="cap-karaoke">{w.slice(0, -1).join(' ')} <em>{w.at(-1)}</em></span>;
  if (id === 'lower') return <span className="cap-lower">{w.join(' ')}</span>;
  if (id === 'minimal') return <span className="cap-minimal">{w.join(' ')}</span>;
  return <span className="cap-none">No captions</span>;
}

export function ReelEditor({ r, d, onClose, onChange }) {
  const editing = r.status === 'script_ready';
  const made = ['ready', 'needs_review'].includes(r.status);
  const working = ['producing', 'editing'].includes(r.status);
  const [s, setS] = useState(r.script);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('voice');
  const [scene, setScene] = useState(0);
  const [size, setSize] = useState(Object.keys(r.outputs || {})[0] || r.sizes?.[0] || '9:16');
  const [view, setView] = useState(null);
  const [playing, setPlaying] = useState(null);
  // what it costs (studio/models.js reelCost, asked of the server so it follows the storyboard as scenes are added or
  // removed, and the video model chosen): the stills, a clip per shot, the voiceover and the music
  const tier = d.tiers.find((t) => t.id === r.tier) || d.tiers[0];
  const vms = tier?.models?.video || [];
  const [vmodel, setVmodel] = useState(r.cost?.vmodel || vms[0]?.id);
  const vm = vms.find((m) => m.id === vmodel) || vms[0];
  const resOpts = vm?.res || tier?.clipRes || [];
  const [est, setEst] = useState({});
  useEffect(() => {
    if (!editing) return undefined;
    let live = true;
    const q = (motion) => api('/studio/estimate', 'POST', { kind: 'reel', tier: r.tier, seconds: r.seconds, shots: s.shots.length, lines: s.lines.length, vmodel, imodel: r.cost?.imodel, motion });
    Promise.all([q('video'), q('story')]).then(([v, st]) => live && setEst({ video: v, story: st })).catch(() => {});
    return () => { live = false; };
  }, [vmodel, s.shots.length, s.lines.length, editing]);
  // 'photo': each still gets a free zoom or pan from the editor instead of an AI clip — stills and voice only
  // 'story:480p': storyline — an opening and a closing still per scene, and the AI animates from one to the other
  const [res, setRes] = useState(r.cost?.motion === 'photo' ? 'photo' : r.cost?.motion === 'story' ? `story:${r.res}` : resOpts.includes(r.res) ? r.res : resOpts.at(-1));
  const motionOf = (x) => (x === 'photo' ? 'photo' : x.startsWith('story:') ? 'story' : 'video'), resOf = (x) => x.replace('story:', '');
  const choices = [...resOpts.map((x) => `story:${x}`), ...resOpts, 'photo'];
  const labelOf = (x) => (x === 'photo' ? 'Photo motion' : x.startsWith('story:') ? `Storyline ${resOf(x)}` : `AI video ${x}`);
  const perSec = (x) => (vm?.per5s?.[x] ?? tier?.clipCreditsPer5s?.[x] ?? 0) / 5;
  // storyboard first: only the pictures (and the voiceover) now; the clips are priced and made after the scenes are right
  const [board, setBoard] = useState(true);
  const boardAt = (x) => (x === 'photo' ? est.video?.storyboard : x.startsWith('story:') ? est.story?.storyboard : est.video?.storyboard) ?? '…';
  const costAt = (x) => (x === 'photo' ? est.video?.photo : x.startsWith('story:') ? est.story?.byRes?.[resOf(x)] : est.video?.byRes?.[x]) ?? '…';
  // a Reel that stopped: only what's missing is made again — the failed stills and clips, and clips not started yet
  const retryCost = (r.shots || []).reduce((t, x, i) => t + (x.image?.status === 'failed' ? x.image.redoCredits || 0 : 0) + (x.clip ? (x.clip.status === 'failed' ? x.clip.redoCredits || 0 : 0) : res === 'photo' ? 0 : Math.ceil(perSec(resOf(res)) * (s.shots[i]?.seconds || 5))), 0);
  const audio = useRef(null);
  // a new script from the server (another tab, or after approving) replaces local edits only when there are none
  useEffect(() => { if (!dirty) setS(r.script); }, [r.script]);
  useEffect(() => { if (r.outputs && !r.outputs[size]) setSize(Object.keys(r.outputs)[0]); }, [r.outputs]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && view == null) onClose(); };
    document.addEventListener('keydown', key);
    const was = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = was; audio.current?.pause(); };
  }, [view]);

  const act = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) toast(msg); setDirty(false); await onChange(); } catch (e) { toast(e.message); } setBusy(false); };
  const edit = (p) => { setS((x) => ({ ...x, ...p })); setDirty(true); };
  const n = Math.max(s.lines.length, s.shots.length);
  const sceneOf = (i) => ({ line: s.lines[i], shot: s.shots[i], made: r.shots?.[i], voice: r.lines?.[i] });
  const setLine = (i, text) => edit({ lines: s.lines.map((l, j) => (j === i ? text : l)) });
  const setShot = (i, p) => edit({ shots: s.shots.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const addScene = () => edit({ lines: [...s.lines, 'A new line'], shots: [...s.shots, { image: s.shots.at(-1)?.image || '', motion: 'Slow push-in', seconds: 5 }] });
  const dropScene = (i) => edit({ lines: s.lines.filter((_, j) => j !== i), shots: s.shots.filter((_, j) => j !== i) });
  const settings = (p) => (editing ? act(() => api(`/studio/reels/${r.id}/script`, 'PUT', { script: s, ...p })) : act(() => api(`/studio/reels/${r.id}`, 'PUT', p), p.voice ? 'Recording the voiceover again in the new voice' : 'Re-editing'));
  const reword = async (i) => { const text = await promptDialog({ title: `Line ${i + 1}`, label: 'New words', value: r.lines[i].text }); if (text && text !== r.lines[i].text) act(() => api(`/studio/reels/${r.id}`, 'PUT', { lines: [{ i, text }] }), 'Recording that line again, then re-editing'); };
  const redoShot = async (i) => { const c = r.shots?.[i]?.clip || {}; const note = await promptDialog({ title: `Redo shot ${i + 1} · about ${c.redoCredits || '?'} credits`, text: `A new ${c.seconds || ''}-second clip at ${c.res || res} uses about ${c.redoCredits || '?'} credits. What should change?${c.fix ? ` Leave it empty to use the quality check's suggestion: “${c.fix}”` : ' Leave it empty to just try again.'}`, label: 'Change', value: '', confirm: 'Redo shot' }); if (note !== null && note !== undefined) act(() => api(`/studio/reels/${r.id}`, 'PUT', { shots: [{ i, note }] }), 'Redoing that shot, then re-editing'); };
  const approve = async () => {
    if (board) {
      if (!(await confirmDialog({ title: `Make the storyboard? · about ${boardAt(res)} credits`, text: `A picture for each of the ${s.shots.length} scene${s.shots.length === 1 ? '' : 's'}${res.startsWith('story:') ? ' (an opening and a closing one each)' : ''} and the voiceover — about ${boardAt(res)} credits, ready in about a minute. Then change, move or drop any scene, and animate it when it’s right (about ${typeof costAt(res) === 'number' && typeof boardAt(res) === 'number' ? costAt(res) - boardAt(res) : '…'} credits more, asked then).`, confirm: `Make the storyboard · ${boardAt(res)} credits` }))) return;
      return act(() => api(`/studio/reels/${r.id}/approve`, 'POST', { script: s, storyboard: true, motion: motionOf(res), vmodel, ...(res === 'photo' ? {} : { res: resOf(res) }) }), 'Drawing your storyboard — about a minute');
    }
    const label = (x) => labelOf(x).toLowerCase();
    const other = choices.filter((x) => x !== res).map((x) => `${label(x)}: about ${costAt(x)} credits`).join(' · ');
    if (!(await confirmDialog({ title: `Make this Reel? · about ${costAt(res)} credits`, text: `${s.shots.length} shot${s.shots.length === 1 ? '' : 's'} ${res === 'photo' ? 'as stills with a smooth zoom or pan' : res.startsWith('story:') ? `as a storyline (an opening and a closing still each, animated between them) at ${resOf(res)}` : `at ${res}`} and ${s.lines.length} voiceover line${s.lines.length === 1 ? '' : 's'} will be made, checked and edited together — about ${costAt(res)} credits.${other ? ` (${other}.)` : ''} A shot that fails its check isn't redone on its own: you'll see it and decide. Below 720p is sharpened up to 720p for free. This takes several minutes.`, confirm: `Make it · ${costAt(res)} credits` }))) return;
    act(() => api(`/studio/reels/${r.id}/approve`, 'POST', { script: s, motion: motionOf(res), vmodel, ...(res === 'photo' ? {} : { res: resOf(res) }) }), 'Making your Reel — you can close this, it carries on');
  };
  // the storyboard: one scene changed at a time (a new picture costs credits; words, order and dropping are free)
  const boarding = r.status === 'storyboard_ready';
  const scene$ = (b, msg) => act(() => api(`/studio/reels/${r.id}/storyboard-scene`, 'POST', b), msg);
  const changePic = async (i, part = 'start') => { const c = r.sceneCredits?.[part] ?? '?'; const note = await promptDialog({ title: `Change scene ${i + 1}’s picture · about ${c} credits`, text: `Say what should be different — it’s made again with your note${r.motion === 'story' && part === 'start' ? ', and its closing picture after it' : ''}. About ${c} credits.`, label: 'Change', value: '', confirm: `Make it again · ${c} credits` }); if (note) scene$({ i, note, part }, 'Making that picture again — about a minute'); };
  const rewordScene = async (i) => { const text = await promptDialog({ title: `Scene ${i + 1}`, label: 'New words', value: s.lines[i] || '' }); if (text && text !== s.lines[i]) scene$({ i, text }, 'Recording that line again'); };
  const dropBoard = async (i) => { if (await confirmDialog({ title: `Drop scene ${i + 1}?`, text: 'Its picture and its line are left out of the Reel.', confirm: 'Drop scene' })) scene$({ i, drop: true }); };
  const animate = async () => { const c = r.cost?.animate ?? '…'; if (await confirmDialog({ title: `Animate the storyboard? · about ${c} credits`, text: `Each scene’s picture becomes ${r.motion === 'photo' ? 'a smooth zoom or pan' : `a clip at ${r.res}`}, in order, then it’s edited with the voiceover, captions, music and the closing card — about ${c} credits. A clip that fails its check isn’t redone on its own: you’ll see it and decide. This takes several minutes.`, confirm: `Animate · ${c} credits` })) act(() => api(`/studio/reels/${r.id}/animate`, 'POST', {}), 'Bringing your scenes to life — you can close this, it carries on'); };
  const play = (v) => {
    if (playing === v.id) { audio.current?.pause(); return setPlaying(null); }
    audio.current?.pause();
    audio.current = new Audio(v.sample); audio.current.onended = () => setPlaying(null);
    audio.current.play().catch(() => toast('Couldn’t play the sample'));
    setPlaying(v.id);
  };
  const st = stepsOf(r);
  const shotItems = (r.shots || []).map((x, i) => ({ ...(x.clip?.url ? x.clip : x.image || {}), kind: x.clip?.url ? 'clip' : 'image', prompt: s.shots[i]?.motion ? `${s.shots[i].image}\nMovement: ${s.shots[i].motion}` : s.shots[i]?.image || '' })).filter((x) => x.url);
  const sel = sceneOf(Math.min(scene, n - 1));
  const selMedia = sel.made?.clip?.url ? { kind: 'clip', ...sel.made.clip } : sel.made?.image?.url ? { kind: 'image', ...sel.made.image } : null;
  const voice = d.voices?.find((v) => v.id === r.voice);
  const [rw, rh] = (RATIO[size] || [9, 16]);

  return (
    <div className="sxr" role="dialog" aria-modal="true" aria-label={s.title}>
      <header className="sxr-top">
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        <div><h2>{s.title}</h2><small>{r.seconds}s · {d.languages?.find((x) => x.id === r.lang)?.name || r.lang} · {d.tiers.find((t) => t.id === r.tier)?.name}</small></div>
        <nav className="sxr-stepper" aria-label="Progress">{STEPS.map((k, i) => <span key={k} className={`sxr-step ${st[k] || ''}`}><b>{st[k] === 'done' ? '✓' : st[k] === 'stop' ? '!' : i + 1}</b>{k}</span>)}</nav>
        <div className="row">
          {editing && <><button className="btn ghost" disabled={busy || !dirty} onClick={() => act(() => api(`/studio/reels/${r.id}/script`, 'PUT', { script: s }), 'Saved')}>Save</button>{vms.length > 1 && <label className="sx-pill" title={vm?.note}><span className="lbl">Model</span>{vm?.name}<select value={vm?.id} onChange={(e) => setVmodel(e.target.value)}>{vms.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.note}</option>)}</select></label>}<label className="sx-pill" title="Storyline: an opening and a closing still per scene, animated from one to the other — the scene tells its moment. AI video: animated from the opening still. Photo motion: a zoom or pan over each still, far cheaper. Below 720p is sharpened up to 720p for free"><span className="lbl">Video</span>{labelOf(res)}<select value={res} onChange={(e) => setRes(e.target.value)}>{choices.map((x) => <option key={x} value={x}>{labelOf(x)} · about {costAt(x)} credits</option>)}</select></label><label className="sx-pill" title="See every scene’s picture first (about a minute), change any of them, then animate — the clips are paid for only then"><input type="checkbox" checked={board} onChange={(e) => setBoard(e.target.checked)} /> Storyboard first</label><button className="btn primary" disabled={busy} onClick={approve}><Icon name="play" size={14} /> {board ? `Make the storyboard · ${boardAt(res)} credits` : `Approve and make · ${costAt(res)} credits`}</button></>}
          {boarding && <button className="btn primary" disabled={busy} onClick={animate}><Icon name="play" size={14} /> Animate · {r.cost?.animate ?? '…'} credits</button>}
          {r.status === 'failed' && <button className="btn primary" disabled={busy} onClick={async () => { if (await confirmDialog({ title: `Carry on? · about ${retryCost} credits`, text: `Only what's missing is made again — about ${retryCost} credits. Nothing that worked is made again.`, confirm: `Carry on · ${retryCost} credits` })) act(() => api(`/studio/reels/${r.id}/retry`, 'POST'), 'Carrying on from where it stopped'); }}><Icon name="redo" size={14} /> Retry · {retryCost} credits</button>}
          {made && r.outputs?.[size] && <><a className="btn primary" href={r.outputs[size]} download><Icon name="download" size={14} /> Download {size}</a><button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(r.links?.[size] || ''); toast('Link copied — paste it in your ad, or ask Hive to put it in an ad'); }}><Icon name="link" size={14} /> Link for ads</button></>}
        </div>
      </header>

      <div className="sxr-body">
        <section className="sxr-col" aria-label="Storyboard">
          <h4>Storyboard · {n} scene{n === 1 ? '' : 's'}</h4>
          <p className="sx-hint" style={{ margin: 0 }}>{STATUS_LINE[r.storyboard && r.status === 'producing' ? 'storyboard' : r.status]}</p>
          {r.status === 'failed' && <div className="sxr-note bad"><b>{r.error || 'It stopped part-way.'}</b><span>Retry finishes only what’s missing — nothing that worked is made again.</span></div>}
          {r.status === 'needs_review' && r.issues?.length > 0 && <div className="sxr-note"><b>Have a look at:</b><ul>{r.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {Array.from({ length: n }, (_, i) => {
            const c = sceneOf(i), media = c.made?.clip?.url ? c.made.clip : c.made?.image?.url ? c.made.image : null, step = c.made?.clip?.status || c.made?.image?.status;
            const check = c.voice?.url ? (c.voice.check && !c.voice.check.ok ? 'warn' : 'ok') : null;
            return (
              <article key={i} className="sxr-scene" onClick={() => setScene(i)} style={scene === i ? { borderColor: 'var(--c-accent)' } : undefined}>
                <button type="button" className="sxr-thumb" aria-label={`View scene ${i + 1}`} onClick={(e) => { e.stopPropagation(); setScene(i); const k = shotItems.findIndex((x) => x.id === media?.id); if (k >= 0) setView(k); }}>
                  {media ? (c.made?.clip?.url ? <video src={media.url} poster={media.poster || undefined} muted playsInline preload="metadata" /> : <img src={media.url} alt="" />) : working ? <span className="spin dark" /> : <Icon name="image" size={18} />}
                  {step && step !== 'ready' && <span className={`sx-badge ${step === 'needs_review' ? 'warn' : step === 'failed' ? 'bad' : ''}`}>{({ queued: 'Queued', rendering: 'Rendering', checking: 'Checking', needs_review: 'Look', failed: 'Failed' })[step] || step}</span>}
                </button>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                  <span className="no">Scene {i + 1}{c.shot ? ` · ${c.shot.seconds}s` : ' · voice only'}</span>
                  {editing ? <>
                    <label className="sm">Said<textarea rows={2} maxLength={220} value={c.line || ''} onChange={(e) => setLine(i, e.target.value)} /></label>
                    {c.shot && <><label className="sm">Shows<textarea rows={2} maxLength={600} value={c.shot.image} onChange={(e) => setShot(i, { image: e.target.value })} /></label>
                    <label className="sm">Movement<input maxLength={300} value={c.shot.motion} onChange={(e) => setShot(i, { motion: e.target.value })} /></label></>}
                    {n > 1 && <button type="button" className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => dropScene(i)}>Remove scene</button>}
                  </> : <>
                    <p className="sxr-say">“{c.line}”</p>
                    <div className="sxr-meta">
                      {check && <span className={`sxr-check ${check}`}>{check === 'ok' ? '✓ Voice checked' : `⚠ ${c.voice.check.issues.join('; ')}`}</span>}
                      {!c.voice?.url && working && <span>{c.voice?.tries ? `Recording again (try ${c.voice.tries + 1})…` : 'Recording…'}</span>}
                      {c.voice?.error && !c.voice.url && <span className="sxr-check warn">⚠ {c.voice.error}</span>}
                      {c.made?.clip?.issues?.length > 0 && <span className="sxr-check warn">⚠ {c.made.clip.issues.join('; ')}</span>}
                    </div>
                    {c.voice?.url && <audio src={c.voice.url} controls preload="none" />}
                    {c.made?.end && !c.made.clip?.url && <div className="row" style={{ alignItems: 'center', gap: 6 }}><small className="muted">Ends on</small>{c.made.end.url ? <img src={c.made.end.url} alt={`Scene ${i + 1}, the end`} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} /> : <span className="spin dark" />}</div>}
                    {boarding && <div className="row" style={{ flexWrap: 'wrap' }}>
                      {c.made && <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); changePic(i); }}><Icon name="wand" size={13} /> Change · {r.sceneCredits?.start}</button>}
                      {c.made?.end && <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); changePic(i, 'end'); }}>Change the end · {r.sceneCredits?.end}</button>}
                      {c.line != null && <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); rewordScene(i); }}><Icon name="edit" size={13} /> Reword</button>}
                      {c.made && <><button className="btn ghost sm" aria-label={`Move scene ${i + 1} up`} disabled={busy || i === 0} onClick={(e) => { e.stopPropagation(); scene$({ i, to: i - 1 }); }}>↑</button><button className="btn ghost sm" aria-label={`Move scene ${i + 1} down`} disabled={busy || i >= (r.shots?.length || 0) - 1} onClick={(e) => { e.stopPropagation(); scene$({ i, to: i + 1 }); }}>↓</button></>}
                      {n > 1 && <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); dropBoard(i); }}><Icon name="trash" size={13} /> Drop</button>}
                    </div>}
                    {made && <div className="row">{c.shot && <button className="btn ghost sm" disabled={busy} onClick={() => redoShot(i)}><Icon name="redo" size={13} /> Redo shot</button>}<button className="btn ghost sm" disabled={busy} onClick={() => reword(i)}><Icon name="edit" size={13} /> Reword</button></div>}
                  </>}
                </div>
              </article>
            );
          })}
          {editing && n < 8 && <button type="button" className="btn ghost" onClick={addScene}><Icon name="plus" size={14} /> Add a scene</button>}
        </section>

        <section className="sxr-col sxr-center" aria-label="Preview">
          <h4 style={{ justifySelf: 'start' }}>{made ? 'Your Reel' : 'Preview'}</h4>
          <div className={`sxr-phone r-${size.replace(':', 'x')}`} style={{ aspectRatio: `${rw} / ${rh}` }}>
            <div className="sxr-screen">
              {made && r.outputs?.[size] ? <video key={r.outputs[size]} src={r.outputs[size]} poster={r.poster || undefined} controls playsInline />
                : selMedia ? (selMedia.kind === 'clip' ? <video key={selMedia.url} src={selMedia.url} muted autoPlay loop playsInline /> : <img src={selMedia.url} alt="" />)
                : <span style={{ padding: 20 }}>{editing ? 'The scenes appear here as they’re made' : working ? 'Making scene ' + (scene + 1) + '…' : 'Nothing to show yet'}</span>}
              {!made && r.captions?.style && sel.line && <span className="sxr-cap" style={{ textTransform: r.captions.style === 'pop' ? 'uppercase' : 'none', fontSize: r.captions.style === 'minimal' ? 13 : r.captions.style === 'lower' ? 14 : 18 }}><CapDemo id={r.captions.style} text={sel.line} /></span>}
            </div>
          </div>
          {r.outputs && <div className="sx-modes">{Object.keys(r.outputs).map((k) => <button key={k} type="button" className={size === k ? 'on' : ''} onClick={() => setSize(k)}>{k}</button>)}</div>}
          {made && r.duration && <small className="muted">{r.duration}s · {Object.keys(r.outputs || {}).length} size{Object.keys(r.outputs || {}).length === 1 ? '' : 's'}</small>}
        </section>

        <section className="sxr-col" aria-label="Settings">
          <div className="sxr-tabs" role="tablist">{[['voice', 'Voice'], ['captions', 'Captions'], ['format', 'Sizes & ending']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === 'voice' && <>
            <p className="sx-hint">{voice ? `Speaking as ${voice.name} — ${voice.note}.` : 'Pick a voice. Press ▶ to hear it.'}{made ? ' Changing it records the voiceover again.' : ''}</p>
            <div className="sxr-voices">{(d.voices || []).map((v) => (
              <div key={v.id} role="button" tabIndex={0} className={`sxr-voice${r.voice === v.id ? ' on' : ''}`} onClick={() => !working && !busy && r.voice !== v.id && settings({ voice: v.id })} onKeyDown={(e) => { if (e.key === 'Enter' && !working && r.voice !== v.id) settings({ voice: v.id }); }}>
                <button type="button" className="play" aria-label={`Hear ${v.name}`} onClick={(e) => { e.stopPropagation(); play(v); }}><Icon name={playing === v.id ? 'x' : 'play'} size={13} /></button>
                <b>{v.name}</b><small>{v.note}</small>
              </div>
            ))}</div>
          </>}
          {tab === 'captions' && <>
            <p className="sx-hint">Captions follow the words as they’re spoken.{made ? ' Changing the style only re-edits — nothing is made again.' : ''}</p>
            <div className="sxr-styles">{[...(d.captionStyles || []), { id: 'none', name: 'No captions' }].map((c) => {
              const on = (r.captions?.style || 'none') === c.id;
              return <button key={c.id} type="button" className={`sxr-style${on ? ' on' : ''}`} disabled={working || busy} onClick={() => !on && settings({ captions: c.id === 'none' ? null : { style: c.id } })}><span className="demo"><CapDemo id={c.id} text={sel.line} /></span><span className="t">{c.name}</span></button>;
            })}</div>
          </>}
          {tab === 'format' && <>
            <p className="sx-hint">Sizes to export — each is a separate video, framed for where it’s shown.</p>
            <div className="sxr-sizes">{SIZES.map(([k, l]) => {
              const on = (r.sizes || ['9:16']).includes(k), list = r.sizes || ['9:16'];
              return <button key={k} type="button" className={`sxr-size${on ? ' on' : ''}`} disabled={working || busy || (on && list.length === 1)} onClick={() => settings({ sizes: on ? list.filter((x) => x !== k) : [...list, k] })}><span className="sx-ratio" style={{ width: RATIO[k][0] * 1.3, height: RATIO[k][1] * 1.3 }} />{k}<small className="muted">{l}</small></button>;
            })}</div>
            <h4>Closing card</h4>
            {[['headline', 'Headline', 40], ['offer', 'Offer or price', 40], ['cta', 'Call to action', 30]].map(([k, l, max]) => (
              <label key={k} className="sm">{l}<input maxLength={max} value={s.endCard?.[k] || ''} disabled={!editing && !made} onChange={(e) => edit({ endCard: { ...s.endCard, [k]: e.target.value } })} /></label>
            ))}
            {made && dirty && <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/studio/reels/${r.id}`, 'PUT', { endCard: s.endCard }), 'Re-editing with the new closing card')}>Apply the closing card</button>}
          </>}
        </section>
      </div>
      {view != null && shotItems[view] && <Viewer items={shotItems} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </div>
  );
}
