// Studio with a Reel open (server studio/reels.js). The canvas is the storyboard: one large card per scene — its
// opening (and, for a storyline, closing) still or clip, the line spoken over it, its status live — and, once made, the
// finished video above it. Under the canvas, the timeline: scene blocks sized by length, the voice lines, the music bed
// and the captions; clicking a block selects that scene. The inspector on the right: how it's made and what it costs,
// the check before spending, the editor's notes, voice, captions, sizes and the closing card.
//   Script ready      → edit the words, shots and movement; storyboard first (pictures only) or approve the whole Reel
//   Storyboard ready  → change, reword, move or drop any scene; then animate
//   Made              → download each size, copy the link for ads, redo a shot, reword a line, apply the editor's notes
//   Stopped           → retry only what's missing
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Icon, toast, promptDialog, confirmDialog } from '../../ui';
import { Viewer } from '../StudioViewer';
import { okStatus, band, RATIO, Score, Section, Seg, Field, Ratio } from './shared';
import { extOf } from './extensions';

const STEPS = ['Script', 'Shots', 'Voiceover', 'Edit', 'Done'];
const SIZES = [['9:16', 'Reels'], ['1:1', 'Square'], ['4:5', 'Feed'], ['16:9', 'Wide']];
const STATUS_LINE = { script_ready: 'Check the script and storyboard, then approve — nothing is made until you do.', storyboard: 'Drawing the storyboard: a picture for each scene, about a minute. The voiceover is recorded meanwhile.', storyboard_ready: 'Your storyboard: change, move or drop any scene, then animate it.', producing: 'Making the shots and recording the voiceover. Each is checked as it’s made.', editing: 'Putting it together: clips, voiceover, captions, logo and the closing card.', ready: 'Ready to download or put in an ad.', needs_review: 'Ready — but something needs a look.', failed: 'Stopped part-way — retry to finish only what’s missing.' };
const STEP_WORD = { queued: 'Queued', rendering: 'Rendering', checking: 'Checking', needs_review: 'Look', failed: 'Failed' };

function stepsOf(r) {
  const shotsDone = r.shots?.length && r.shots.every((s) => okStatus(s.clip));
  const voiceDone = r.lines?.length && r.lines.every((l) => l.url);
  const st = { Script: r.status === 'script_ready' ? 'now' : 'done' };
  if (r.status === 'script_ready') return st;
  if (r.storyboard && r.status !== 'failed') return { ...st, Shots: 'now', Voiceover: voiceDone ? 'done' : 'now' };
  st.Shots = shotsDone ? 'done' : 'now';
  st.Voiceover = voiceDone ? 'done' : 'now';
  if (r.status === 'editing') st.Edit = 'now';
  if (['ready', 'needs_review'].includes(r.status)) st.Shots = st.Voiceover = st.Edit = st.Done = 'done';
  if (r.status === 'failed') { const e = r.error || ''; if (/shot/i.test(e)) st.Shots = 'stop'; else if (/voice/i.test(e)) st.Voiceover = 'stop'; else st.Edit = 'stop'; }
  return st;
}

function CapDemo({ id, text }) {
  const w = String(text || 'Only ₹499 today').split(/\s+/).slice(0, 4);
  if (id === 'pop') return <span className="cap-pop">{w.slice(0, -1).join(' ')} <em>{w.at(-1)}</em></span>;
  if (id === 'karaoke') return <span className="cap-karaoke">{w.slice(0, -1).join(' ')} <em>{w.at(-1)}</em></span>;
  if (id === 'lower') return <span className="cap-lower">{w.join(' ')}</span>;
  if (id === 'minimal') return <span className="cap-minimal">{w.join(' ')}</span>;
  return <span className="cap-none">No captions</span>;
}

// everything the Reel's canvas, timeline and inspector share: the script being edited, the costs, every action
function useReel(r, d, onChange) {
  const editing = r.status === 'script_ready';
  const made = ['ready', 'needs_review'].includes(r.status);
  const working = ['producing', 'editing'].includes(r.status);
  const boarding = r.status === 'storyboard_ready';
  const [s, setS] = useState(r.script);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scene, setScene] = useState(0);
  const [size, setSize] = useState(Object.keys(r.outputs || {})[0] || r.sizes?.[0] || '9:16');
  const [view, setView] = useState(null);
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
  // 'photo': a free zoom or pan per still; 'story:480p': an opening and a closing still per scene, animated between them
  const [res, setRes] = useState(r.cost?.motion === 'photo' ? 'photo' : r.cost?.motion === 'story' ? `story:${r.res}` : resOpts.includes(r.res) ? r.res : resOpts.at(-1));
  const motionOf = (x) => (x === 'photo' ? 'photo' : x.startsWith('story:') ? 'story' : 'video'), resOf = (x) => x.replace('story:', '');
  const choices = [...resOpts.map((x) => `story:${x}`), ...resOpts, 'photo'];
  const labelOf = (x) => (x === 'photo' ? 'Photo motion' : x.startsWith('story:') ? `Storyline ${resOf(x)}` : `AI video ${x}`);
  const perSec = (x) => (vm?.per5s?.[x] ?? tier?.clipCreditsPer5s?.[x] ?? 0) / 5;
  const [board, setBoard] = useState(true);
  const boardAt = (x) => (x === 'photo' ? est.video?.storyboard : x.startsWith('story:') ? est.story?.storyboard : est.video?.storyboard) ?? '…';
  const costAt = (x) => (x === 'photo' ? est.video?.photo : x.startsWith('story:') ? est.story?.byRes?.[resOf(x)] : est.video?.byRes?.[x]) ?? '…';
  const retryCost = (r.shots || []).reduce((t, x, i) => t + (x.image?.status === 'failed' ? x.image.redoCredits || 0 : 0) + (x.clip ? (x.clip.status === 'failed' ? x.clip.redoCredits || 0 : 0) : res === 'photo' ? 0 : Math.ceil(perSec(resOf(res)) * (s.shots[i]?.seconds || 5))), 0);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(null);
  const video = useRef(null);
  const [time, setTime] = useState(0);
  useEffect(() => { if (!dirty) setS(r.script); }, [r.script]);
  useEffect(() => { if (r.outputs && !r.outputs[size]) setSize(Object.keys(r.outputs)[0]); }, [r.outputs]);
  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => { if (!r.reviewing) return undefined; const t = setInterval(onChange, 5000); return () => clearInterval(t); }, [r.reviewing]);

  const act = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) toast(msg); setDirty(false); await onChange(); } catch (e) { toast(e.message); } setBusy(false); };
  const edit = (p) => { setS((x) => ({ ...x, ...p })); setDirty(true); };
  const n = Math.max(s.lines.length, s.shots.length);
  const sceneOf = (i) => ({ line: s.lines[i], shot: s.shots[i], made: r.shots?.[i], voice: r.lines?.[i] });
  const setLine = (i, text) => edit({ lines: s.lines.map((l, j) => (j === i ? text : l)) });
  const setShot = (i, p) => edit({ shots: s.shots.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const addScene = () => { edit({ lines: [...s.lines, 'A new line'], shots: [...s.shots, { image: s.shots.at(-1)?.image || '', motion: 'Slow push-in', seconds: 5 }] }); setScene(n); };
  const dropScene = (i) => { edit({ lines: s.lines.filter((_, j) => j !== i), shots: s.shots.filter((_, j) => j !== i) }); setScene((x) => Math.max(0, Math.min(x, n - 2))); };
  const save = () => act(() => api(`/studio/reels/${r.id}/script`, 'PUT', { script: s }), 'Saved');
  const settings = (p) => (editing ? act(() => api(`/studio/reels/${r.id}/script`, 'PUT', { script: s, ...p })) : act(() => api(`/studio/reels/${r.id}`, 'PUT', p), p.voice ? 'Recording the voiceover again in the new voice' : 'Re-editing'));
  const reword = async (i) => { const text = await promptDialog({ title: `Line ${i + 1}`, label: 'New words', value: r.lines[i].text }); if (text && text !== r.lines[i].text) act(() => api(`/studio/reels/${r.id}`, 'PUT', { lines: [{ i, text }] }), 'Recording that line again, then re-editing'); };
  const redoShot = async (i) => { const c = r.shots?.[i]?.clip || {}; const note = await promptDialog({ title: `Redo shot ${i + 1} · about ${c.redoCredits || '?'} credits`, text: `A new ${c.seconds || ''}-second clip at ${c.res || res} uses about ${c.redoCredits || '?'} credits. What should change?${c.fix ? ` Leave it empty to use the quality check's suggestion: “${c.fix}”` : ' Leave it empty to just try again.'}`, label: 'Change', value: '', confirm: 'Redo shot' }); if (note !== null && note !== undefined) act(() => api(`/studio/reels/${r.id}`, 'PUT', { shots: [{ i, note }] }), 'Redoing that shot, then re-editing'); };
  const applyNote = async (a) => {
    const put = (body, msg) => act(() => api(`/studio/reels/${r.id}`, 'PUT', body), msg);
    if (a.type === 'redo_shot') {
      const c = r.shots?.[a.i]?.clip || {};
      if (await confirmDialog({ title: `Redo shot ${a.i + 1}? · about ${c.redoCredits || '?'} credits`, text: `A new ${c.seconds ? `${c.seconds}-second ` : ''}${c.photo ? 'picture' : 'clip'} is made with this change: “${a.note}” — about ${c.redoCredits || '?'} credits. Then the Reel is edited again.`, confirm: `Redo shot · ${c.redoCredits || '?'} credits` })) put({ shots: [{ i: a.i, note: a.note }] }, 'Redoing that shot, then re-editing');
    } else if (a.type === 'reword_line') put({ lines: [{ i: a.i, text: a.text }] }, 'Recording that line again, then re-editing');
    else if (a.type === 'end_card') put({ endCard: a.endCard }, 'Re-editing with the new closing card');
    else if (a.type === 'captions') put({ captions: { style: a.style } }, 'Re-editing with the new captions');
  };
  const noteChange = (a) => (a.type === 'redo_shot' ? `New shot: ${a.note}` : a.type === 'reword_line' ? `Say: “${a.text}”` : a.type === 'end_card' ? `Card: ${[a.endCard.headline, a.endCard.offer, a.endCard.cta].filter(Boolean).join(' · ')}` : a.type === 'captions' ? `Captions: ${d.captionStyles?.find((c) => c.id === a.style)?.name || a.style}` : '');
  const approve = async () => {
    if (board) {
      if (!(await confirmDialog({ title: `Make the storyboard? · about ${boardAt(res)} credits`, text: `A picture for each of the ${s.shots.length} scene${s.shots.length === 1 ? '' : 's'}${res.startsWith('story:') ? ' (an opening and a closing one each)' : ''} and the voiceover — about ${boardAt(res)} credits, ready in about a minute. Then change, move or drop any scene, and animate it when it’s right (about ${typeof costAt(res) === 'number' && typeof boardAt(res) === 'number' ? costAt(res) - boardAt(res) : '…'} credits more, asked then).`, confirm: `Make the storyboard · ${boardAt(res)} credits` }))) return;
      return act(() => api(`/studio/reels/${r.id}/approve`, 'POST', { script: s, storyboard: true, motion: motionOf(res), vmodel, ...(res === 'photo' ? {} : { res: resOf(res) }) }), 'Drawing your storyboard — about a minute');
    }
    const label = (x) => labelOf(x).toLowerCase();
    const other = choices.filter((x) => x !== res).map((x) => `${label(x)}: about ${costAt(x)} credits`).join(' · ');
    if (!(await confirmDialog({ title: `Make this Reel? · about ${costAt(res)} credits`, text: `${s.shots.length} shot${s.shots.length === 1 ? '' : 's'} ${res === 'photo' ? 'as stills with a smooth zoom or pan' : res.startsWith('story:') ? `as a storyline (an opening and a closing still each, animated between them) at ${resOf(res)}` : `at ${res}`} and ${s.lines.length} voiceover line${s.lines.length === 1 ? '' : 's'} will be made, checked and edited together — about ${costAt(res)} credits.${other ? ` (${other}.)` : ''} A shot that fails its check isn't redone on its own: you'll see it and decide. Below 720p is sharpened up to 720p for free. This takes several minutes.`, confirm: `Make it · ${costAt(res)} credits` }))) return;
    act(() => api(`/studio/reels/${r.id}/approve`, 'POST', { script: s, motion: motionOf(res), vmodel, ...(res === 'photo' ? {} : { res: resOf(res) }) }), 'Making your Reel — it carries on if you leave');
  };
  const scene$ = (b, msg) => act(() => api(`/studio/reels/${r.id}/storyboard-scene`, 'POST', b), msg);
  const changePic = async (i, part = 'start') => { const c = r.sceneCredits?.[part] ?? '?'; const note = await promptDialog({ title: `Change scene ${i + 1}’s picture · about ${c} credits`, text: `Say what should be different — it’s made again with your note${r.motion === 'story' && part === 'start' ? ', and its closing picture after it' : ''}. About ${c} credits.`, label: 'Change', value: '', confirm: `Make it again · ${c} credits` }); if (note) scene$({ i, note, part }, 'Making that picture again — about a minute'); };
  const rewordScene = async (i) => { const text = await promptDialog({ title: `Scene ${i + 1}`, label: 'New words', value: s.lines[i] || '' }); if (text && text !== s.lines[i]) scene$({ i, text }, 'Recording that line again'); };
  const dropBoard = async (i) => { if (await confirmDialog({ title: `Drop scene ${i + 1}?`, text: 'Its picture and its line are left out of the Reel.', confirm: 'Drop scene' })) scene$({ i, drop: true }); };
  const moveBoard = (i, to) => { scene$({ i, to }); setScene(to); };
  const animate = async () => { const c = r.cost?.animate ?? '…'; if (await confirmDialog({ title: `Animate the storyboard? · about ${c} credits`, text: `Each scene’s picture becomes ${r.motion === 'photo' ? 'a smooth zoom or pan' : `a clip at ${r.res}`}, in order, then it’s edited with the voiceover, captions, music and the closing card — about ${c} credits. A clip that fails its check isn’t redone on its own: you’ll see it and decide. This takes several minutes.`, confirm: `Animate · ${c} credits` })) act(() => api(`/studio/reels/${r.id}/animate`, 'POST', {}), 'Bringing your scenes to life — it carries on if you leave'); };
  const retry = async () => { if (await confirmDialog({ title: `Carry on? · about ${retryCost} credits`, text: `Only what's missing is made again — about ${retryCost} credits. Nothing that worked is made again.`, confirm: `Carry on · ${retryCost} credits` })) act(() => api(`/studio/reels/${r.id}/retry`, 'POST'), 'Carrying on from where it stopped'); };
  const play = (v) => {
    if (playing === v.id) { audio.current?.pause(); return setPlaying(null); }
    audio.current?.pause();
    audio.current = new Audio(v.sample); audio.current.onended = () => setPlaying(null);
    audio.current.play().catch(() => toast('Couldn’t play the sample'));
    setPlaying(v.id);
  };
  const shotItems = (r.shots || []).map((x, i) => ({ ...(x.clip?.url ? x.clip : x.image || {}), kind: x.clip?.url ? 'clip' : 'image', prompt: s.shots[i]?.motion ? `${s.shots[i].image}\nMovement: ${s.shots[i].motion}` : s.shots[i]?.image || '' })).filter((x) => x.url);
  const openShot = (media) => { const k = shotItems.findIndex((x) => x.id === media?.id); if (k >= 0) setView(k); };
  // the timeline: each scene's length (a voice-only line counts 3 seconds), and where it starts
  const lens = Array.from({ length: n }, (_, i) => Number(s.shots[i]?.seconds) || 3);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  const scale = made && r.duration ? r.duration / total : 1;
  const seek = (i) => { setScene(i); if (video.current && made) { video.current.currentTime = starts[i] * scale; video.current.play?.().catch(() => {}); } };
  const nowScene = made && time ? Math.max(0, starts.findIndex((st, i) => time / scale >= st && time / scale < st + lens[i])) : null;
  return { r, d, s, edit, dirty, busy, editing, made, working, boarding, scene: Math.min(scene, Math.max(0, n - 1)), setScene, size, setSize, view, setView, tier, vms, vm, vmodel, setVmodel, res, setRes, choices, labelOf, board, setBoard, boardAt, costAt, retryCost, n, sceneOf, setLine, setShot, addScene, dropScene, save, settings, reword, redoShot, applyNote, noteChange, approve, changePic, rewordScene, dropBoard, moveBoard, animate, retry, play, playing, shotItems, openShot, lens, total, starts, seek, video, time, setTime, nowScene, act, onChange };
}

export function ReelWorkspace({ r, d, onChange, onClose, extensions, openMemory }) {
  const ed = useReel(r, d, onChange);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && ed.view == null && !document.querySelector('.modal, .dialog, [role=alertdialog]') && !e.target.closest?.('input, textarea, select')) onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [ed.view]);
  return (
    <>
      <main className="sxw-stage sxw-reel" aria-label="Storyboard">
        <ReelHeader ed={ed} onClose={onClose} />
        <ReelCanvas ed={ed} extensions={extensions} />
        <ReelTimeline ed={ed} />
      </main>
      <aside className="sxw-inspect" aria-label="Reel settings"><ReelInspector ed={ed} extensions={extensions} openMemory={openMemory} /></aside>
      {ed.view != null && ed.shotItems[ed.view] && <Viewer items={ed.shotItems} index={ed.view} onIndex={ed.setView} onClose={() => ed.setView(null)} />}
    </>
  );
}

function ReelHeader({ ed, onClose }) {
  const { r, d, s, busy, editing, boarding, made } = ed;
  const st = stepsOf(r);
  return (
    <header className="sxs-reelh">
      <button type="button" className="sxs-back" onClick={onClose} aria-label="Back to all work" title="Back to all work (Esc)"><span style={{ display: 'grid', transform: 'rotate(180deg)' }}><Icon name="chevron" size={16} /></span></button>
      <div className="sxs-title"><h2>{s.title}</h2><small>{r.seconds}s · {d.languages?.find((x) => x.id === r.lang)?.name || r.lang} · {d.tiers.find((t) => t.id === r.tier)?.name}</small></div>
      <nav className="sxr-stepper" aria-label="Progress">{STEPS.map((k, i) => <span key={k} className={`sxr-step ${st[k] || ''}`}><b>{st[k] === 'done' ? '✓' : st[k] === 'stop' ? '!' : i + 1}</b><span>{k}</span></span>)}</nav>
      <div className="sxs-cta">
        {editing && <><button className="btn ghost" disabled={busy || !ed.dirty} onClick={ed.save}>Save</button><button className="btn primary" disabled={busy} onClick={ed.approve}><Icon name="play" size={14} /> {ed.board ? `Storyboard · ${ed.boardAt(ed.res)} cr` : `Approve · ${ed.costAt(ed.res)} cr`}</button></>}
        {boarding && <button className="btn primary" disabled={busy} onClick={ed.animate}><Icon name="play" size={14} /> Animate · {r.cost?.animate ?? '…'} cr</button>}
        {r.status === 'failed' && <button className="btn primary" disabled={busy} onClick={ed.retry}><Icon name="redo" size={14} /> Retry · {ed.retryCost} cr</button>}
        {made && r.outputs?.[ed.size] && <a className="btn primary" href={r.outputs[ed.size]} download><Icon name="download" size={14} /> Download {ed.size}</a>}
      </div>
    </header>
  );
}

// one scene's picture: the still or clip, or its state while it's being made
function Frame({ media, status, aspect, working, label, onOpen, selected, isClip }) {
  const [w, h] = (RATIO[aspect] || [9, 16]);
  const busy = status && ['queued', 'rendering', 'checking'].includes(status);
  return (
    <button type="button" className={`sxs-frame${busy ? ' busy' : ''}${!media?.url && !busy && !working ? ' empty' : ''}`} style={{ aspectRatio: `${w} / ${h}` }} aria-label={label} onClick={(e) => { e.stopPropagation(); onOpen?.(); }} disabled={!media}>
      {media?.url ? (isClip ? <video src={media.url} poster={media.poster || undefined} muted loop playsInline preload="metadata" autoPlay={selected} ref={(el) => { if (el) { if (selected) el.play?.().catch(() => {}); else el.pause?.(); } }} /> : <img src={media.url} alt="" loading="lazy" />)
        : busy || working ? <span className="sxs-frame-wait"><span className="spin" /><small>{STEP_WORD[status] || 'Making'}…</small></span>
          : <span className="sxs-frame-empty"><Icon name="image" size={20} /><small>Drawn when you approve</small></span>}
      {status && status !== 'ready' && media?.url && <span className={`sx-badge ${status === 'needs_review' ? 'warn' : status === 'failed' ? 'bad' : ''}`}>{STEP_WORD[status] || status}</span>}
    </button>
  );
}

function ReelCanvas({ ed, extensions }) {
  const { r, d, s, busy, editing, boarding, made, working, n } = ed;
  const aspect = r.aspect || r.sizes?.[0] || '9:16';
  const refs = useRef([]);
  useEffect(() => { refs.current[ed.scene]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); }, [ed.scene]);
  const sceneExt = extOf(extensions, 'scene', d), concept = extOf(extensions, 'concept', d);
  const [rw, rh] = (RATIO[ed.size] || [9, 16]);
  return (
    <div className="sxs-canvas sxs-board" data-aspect={aspect.replace(':', 'x')}>
      <p className="sxs-status">{(working || r.status === 'storyboard_ready' || editing) && <i className="sxs-dot" />}{STATUS_LINE[r.storyboard && r.status === 'producing' ? 'storyboard' : r.status]}</p>
      {r.status === 'failed' && <div className="sxr-note bad"><b>{r.error || 'It stopped part-way.'}</b><span>Retry finishes only what’s missing — nothing that worked is made again.</span></div>}
      {r.status === 'needs_review' && r.issues?.length > 0 && <div className="sxr-note"><b>Have a look at:</b><ul>{r.issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {concept.map((x) => <x.ConceptBar key={x.id} r={r} d={d} act={ed.act} busy={busy} load={ed.onChange} />)}
      {made && r.outputs && (
        <section className="sxs-final" aria-label="Your Reel">
          <div className={`sxr-phone r-${ed.size.replace(':', 'x')}`} style={{ aspectRatio: `${rw} / ${rh}` }}>
            <div className="sxr-screen">{r.outputs[ed.size] ? <video key={r.outputs[ed.size]} ref={ed.video} src={r.outputs[ed.size]} poster={r.poster || undefined} controls playsInline onTimeUpdate={(e) => ed.setTime(e.currentTarget.currentTime)} /> : <span>Nothing to show yet</span>}</div>
          </div>
          <div className="sxs-final-side">
            <h3>Your Reel</h3>
            {r.duration && <small className="muted">{r.duration}s · {Object.keys(r.outputs).length} size{Object.keys(r.outputs).length === 1 ? '' : 's'}</small>}
            <div className="sx-modes">{Object.keys(r.outputs).map((k) => <button key={k} type="button" className={ed.size === k ? 'on' : ''} onClick={() => ed.setSize(k)}><Ratio a={k} />{k}</button>)}</div>
            <div className="row">
              {r.outputs[ed.size] && <a className="btn primary" href={r.outputs[ed.size]} download><Icon name="download" size={14} /> Download {ed.size}</a>}
              <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(r.links?.[ed.size] || ''); toast('Link copied — paste it in your ad, or ask Hive to put it in an ad'); }}><Icon name="link" size={14} /> Link for ads</button>
            </div>
          </div>
        </section>
      )}
      <div className="sxs-scenes">
        {Array.from({ length: n }, (_, i) => {
          const c = ed.sceneOf(i);
          const clip = c.made?.clip?.url ? c.made.clip : null, still = c.made?.image, end = c.made?.end;
          const media = clip || (still?.url ? still : null);
          const status = c.made?.clip?.status || c.made?.image?.status;
          const story = (r.motion === 'story' || c.shot?.end) && !clip;
          const check = c.voice?.url ? (c.voice.check && !c.voice.check.ok ? 'warn' : 'ok') : null;
          const sel = ed.scene === i;
          return (
            <article key={i} ref={(el) => { refs.current[i] = el; }} className={`sxs-scene${sel ? ' on' : ''}${story ? ' pair' : ''}${ed.nowScene === i ? ' now' : ''}`} onClick={() => ed.setScene(i)} tabIndex={-1} aria-label={`Scene ${i + 1}`}>
              <div className="sxs-scene-h"><span className="sxs-no">{String(i + 1).padStart(2, '0')}</span><span>{c.shot ? `${c.shot.seconds}s` : 'voice only'}</span>
                {sceneExt.map((x) => x.SceneTag && <x.SceneTag key={x.id} r={r} i={i} shot={c.made || c.shot} />)}
                <span className="grow" />{status && <span className={`sxs-st ${status}`}>{status === 'ready' ? '✓ Checked' : STEP_WORD[status] || status}</span>}</div>
              <div className="sxs-frames">
                <Frame media={media} status={status} aspect={aspect} working={working} isClip={!!clip} selected={sel} label={`Open scene ${i + 1}`} onOpen={() => ed.openShot(media)} />
                {story && <Frame media={end?.url ? end : null} status={end?.status} aspect={aspect} working={working} label={`Scene ${i + 1}, the end`} onOpen={() => ed.openShot(end)} />}
              </div>
              {story && <div className="sxs-pairlbl"><span>Opening</span><span>Closing</span></div>}
              {editing ? (
                <div className="sxs-fields" onClick={(e) => e.stopPropagation()}>
                  <label>Said<textarea rows={2} maxLength={220} value={c.line || ''} onChange={(e) => ed.setLine(i, e.target.value)} onFocus={() => ed.setScene(i)} /></label>
                  {c.shot && <><label>Shows<textarea rows={3} maxLength={600} value={c.shot.image} onChange={(e) => ed.setShot(i, { image: e.target.value })} onFocus={() => ed.setScene(i)} /></label>
                    <label>Movement<input maxLength={300} value={c.shot.motion} onChange={(e) => ed.setShot(i, { motion: e.target.value })} onFocus={() => ed.setScene(i)} /></label></>}
                  {n > 1 && <button type="button" className="btn ghost sm" onClick={() => ed.dropScene(i)}><Icon name="trash" size={13} /> Remove scene</button>}
                </div>
              ) : <>
                <p className="sxs-line">“{c.line}”</p>
                <div className="sxr-meta">
                  {check && <span className={`sxr-check ${check}`}>{check === 'ok' ? '✓ Voice checked' : `⚠ ${c.voice.check.issues.join('; ')}`}</span>}
                  {!c.voice?.url && working && <span>{c.voice?.tries ? `Recording again (try ${c.voice.tries + 1})…` : 'Recording…'}</span>}
                  {c.voice?.error && !c.voice.url && <span className="sxr-check warn">⚠ {c.voice.error}</span>}
                  {c.made?.clip?.issues?.length > 0 && <span className="sxr-check warn">⚠ {c.made.clip.issues.join('; ')}</span>}
                </div>
                {c.voice?.url && <audio src={c.voice.url} controls preload="none" onClick={(e) => e.stopPropagation()} />}
                {boarding && <div className="sxs-acts" onClick={(e) => e.stopPropagation()}>
                  {c.made && <button className="btn ghost sm" disabled={busy} onClick={() => ed.changePic(i)}><Icon name="wand" size={13} /> Change · {r.sceneCredits?.start}</button>}
                  {c.made?.end && <button className="btn ghost sm" disabled={busy} onClick={() => ed.changePic(i, 'end')}>Change the end · {r.sceneCredits?.end}</button>}
                  {c.line != null && <button className="btn ghost sm" disabled={busy} onClick={() => ed.rewordScene(i)}><Icon name="edit" size={13} /> Reword</button>}
                  {c.made && <><button className="btn ghost sm" aria-label={`Move scene ${i + 1} earlier`} disabled={busy || i === 0} onClick={() => ed.moveBoard(i, i - 1)}>←</button><button className="btn ghost sm" aria-label={`Move scene ${i + 1} later`} disabled={busy || i >= (r.shots?.length || 0) - 1} onClick={() => ed.moveBoard(i, i + 1)}>→</button></>}
                  {n > 1 && <button className="btn ghost sm" disabled={busy} onClick={() => ed.dropBoard(i)} aria-label={`Drop scene ${i + 1}`}><Icon name="trash" size={13} /></button>}
                  {sceneExt.map((x) => x.SceneActions && <x.SceneActions key={x.id} r={r} i={i} act={ed.act} busy={busy} />)}
                </div>}
                {made && <div className="sxs-acts" onClick={(e) => e.stopPropagation()}>{c.shot && <button className="btn ghost sm" disabled={busy} onClick={() => ed.redoShot(i)}><Icon name="redo" size={13} /> Redo shot</button>}<button className="btn ghost sm" disabled={busy} onClick={() => ed.reword(i)}><Icon name="edit" size={13} /> Reword</button></div>}
              </>}
            </article>
          );
        })}
        {editing && n < 8 && <button type="button" className="sxs-add" onClick={ed.addScene}><Icon name="plus" size={18} /><span>Add a scene</span></button>}
      </div>
    </div>
  );
}

// the timeline: scenes by length, voice lines, the music bed, the captions; ← → move between scenes
function ReelTimeline({ ed }) {
  const { r, d, s, n, lens, total, starts } = ed;
  const pct = (x) => `${(x / total) * 100}%`;
  const capName = r.captions?.style ? d.captionStyles?.find((c) => c.id === r.captions.style)?.name || r.captions.style : 'No captions';
  const key = (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); ed.seek(Math.min(n - 1, ed.scene + 1)); } else if (e.key === 'ArrowLeft') { e.preventDefault(); ed.seek(Math.max(0, ed.scene - 1)); } };
  const marks = []; for (let t = 0; t <= total; t += total > 40 ? 10 : 5) marks.push(t);
  const scale = ed.made && r.duration ? r.duration / total : 1;
  return (
    <section className="sxt" aria-label="Timeline" tabIndex={0} onKeyDown={key}>
      <div className="sxt-head"><b>Timeline</b><small>{Math.round(total * scale)}s · {n} scene{n === 1 ? '' : 's'}</small><span className="grow" /><small className="sx-kbd">← → scenes</small></div>
      <div className="sxt-scroll">
        <div className="sxt-body" style={{ minWidth: Math.max(520, total * 22) }}>
          <div className="sxt-ruler">{marks.map((t) => <span key={t} style={{ left: pct(t) }}>{Math.round(t * scale)}s</span>)}</div>
          <div className="sxt-track scenes"><span className="sxt-lbl">Scenes</span>
            <div className="sxt-lane">{Array.from({ length: n }, (_, i) => {
              const m = ed.sceneOf(i).made, thumb = m?.image?.url || m?.clip?.poster;
              return <button key={i} type="button" tabIndex={-1} className={`sxt-block${ed.scene === i ? ' on' : ''}`} style={{ left: pct(starts[i]), width: pct(lens[i]) }} onClick={() => ed.seek(i)} title={s.shots[i]?.image || `Scene ${i + 1}`}>{thumb && <img src={thumb} alt="" />}<span>{i + 1}</span></button>;
            })}</div>
          </div>
          <div className="sxt-track voice"><span className="sxt-lbl">Voice</span>
            <div className="sxt-lane">{s.lines.map((l, i) => {
              const v = r.lines?.[i], st = v?.url ? (v.check && !v.check.ok ? 'warn' : 'ok') : v?.error ? 'bad' : ed.working ? 'rec' : '';
              return <button key={i} type="button" tabIndex={-1} className={`sxt-line ${st}`} style={{ left: pct(starts[i] ?? 0), width: pct(lens[i] ?? 3) }} onClick={() => ed.seek(i)} title={l}><i />{l}</button>;
            })}</div>
          </div>
          <div className="sxt-track music"><span className="sxt-lbl">Music</span><div className="sxt-lane"><span className="sxt-bed" title={s.music || ''}><Icon name="play" size={11} /> {s.music || 'Chosen to fit the mood when it’s edited'}</span></div></div>
          <div className="sxt-track caps"><span className="sxt-lbl">Captions</span>
            <div className="sxt-lane">{r.captions?.style ? s.lines.map((l, i) => <span key={i} className="sxt-cap" style={{ left: pct(starts[i] ?? 0), width: pct(lens[i] ?? 3) }}>{String(l || '').split(/\s+/).slice(0, 3).join(' ')}</span>) : <span className="sxt-bed off">{capName}</span>}</div>
          </div>
          {ed.made && ed.time > 0 && <span className="sxt-playhead" style={{ left: `calc(var(--sxt-lbl) + (100% - var(--sxt-lbl)) * ${Math.min(1, ed.time / (total * scale))})` }} />}
        </div>
      </div>
    </section>
  );
}

function ReelInspector({ ed, extensions, openMemory }) {
  const { r, d, s, busy, editing, boarding, made, working } = ed;
  const voice = d.voices?.find((v) => v.id === r.voice);
  const sel = ed.sceneOf(ed.scene);
  return (
    <>
      <div className="sxi-head"><b>Reel</b><small>{r.seconds}s · {(r.sizes || ['9:16']).join(', ')}</small></div>
      {editing && <Section id="reel-make" title="How it’s made" icon="play">
        {ed.vms.length > 1 && <Field label="Video model" hint={ed.vm?.note}><select value={ed.vm?.id} onChange={(e) => ed.setVmodel(e.target.value)}>{ed.vms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        <Field label="Motion" hint="Storyline: an opening and a closing still per scene, animated between them. AI video: animated from the opening still. Photo motion: a zoom or pan, far cheaper."><select value={ed.res} onChange={(e) => ed.setRes(e.target.value)}>{ed.choices.map((x) => <option key={x} value={x}>{ed.labelOf(x)} · about {ed.costAt(x)} credits</option>)}</select></Field>
        <label className="sxi-toggle" title="See every scene’s picture first (about a minute), change any of them, then animate — the clips are paid for only then"><input type="checkbox" checked={ed.board} onChange={(e) => ed.setBoard(e.target.checked)} /><span><b>Storyboard first</b><small>Pictures now, clips only once the scenes are right</small></span></label>
      </Section>}
      <div className="sxi-cost">
        {editing ? <><span className="sxi-lbl">{ed.board ? 'Storyboard now' : 'Whole Reel'}</span><b className="sxi-big">{ed.board ? ed.boardAt(ed.res) : ed.costAt(ed.res)}<small> credits</small></b><small>{ed.board ? `Then about ${typeof ed.costAt(ed.res) === 'number' && typeof ed.boardAt(ed.res) === 'number' ? ed.costAt(ed.res) - ed.boardAt(ed.res) : '…'} more to animate — asked then.` : `${ed.labelOf(ed.res)} · ${s.shots.length} shots · ${s.lines.length} lines.`}</small>
          <button className="btn primary" disabled={busy} onClick={ed.approve}><Icon name="play" size={14} /> {ed.board ? 'Make the storyboard' : 'Approve and make'}</button></>
          : boarding ? <><span className="sxi-lbl">Animate</span><b className="sxi-big">{r.cost?.animate ?? '…'}<small> credits</small></b><small>Each picture becomes {r.motion === 'photo' ? 'a zoom or pan' : `a clip at ${r.res}`}, then it’s edited.</small><button className="btn primary" disabled={busy} onClick={ed.animate}><Icon name="play" size={14} /> Animate</button></>
            : r.status === 'failed' ? <><span className="sxi-lbl">Finish what’s missing</span><b className="sxi-big">{ed.retryCost}<small> credits</small></b><button className="btn primary" disabled={busy} onClick={ed.retry}><Icon name="redo" size={14} /> Retry</button></>
              : <><span className="sxi-lbl">Cost</span><b className="sxi-big">{r.cost?.credits ?? '…'}<small> credits</small></b><small>{made ? 'Changes below only redo what changed.' : working ? 'Being made — it carries on if you leave.' : ''}</small></>}
      </div>
      {(editing || boarding) && <PlanCheck r={r} s={s} edit={ed.edit} dirty={ed.dirty} onChange={ed.onChange} />}
      {r.standard && <StandardCheck r={r} edit={editing ? ed.edit : null} />}
      {made && (r.reviewing || r.review) && <Section id="reel-notes" title="Editor’s notes" icon="eye">
        {r.reviewing && !r.review && <p className="sxi-say"><span className="spin dark" /> Watching the finished video…</p>}
        {r.review && <>
          <div className="sxi-scores">{r.review.score != null && <Score value={r.review.score} label="Score" />}{r.review.virality != null && <Score value={r.review.virality} label="Virality" title={r.review.viralityWhy} hot />}</div>
          {r.review.summary && <p className="sxi-say">{r.review.summary}</p>}
          {r.review.suggestions.length === 0 && <p className="sxi-hint">Nothing to change — it’s ready to run.</p>}
          {r.review.suggestions.map((x, k) => {
            const cost = x.action?.type === 'redo_shot' ? r.shots?.[x.action.i]?.clip?.redoCredits : null;
            return (
              <div key={k} className="sxr-tip">
                <span className="no">{x.area}{x.scene != null ? ` · scene ${x.scene + 1}` : ''}</span>
                <b>{x.problem}</b>{x.fix && <span>{x.fix}</span>}
                {x.action && <small className="muted">{ed.noteChange(x.action)}</small>}
                {x.action && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => ed.applyNote(x.action)}><Icon name={x.action.type === 'redo_shot' ? 'redo' : 'check'} size={13} /> Apply{x.action.type === 'redo_shot' ? ` · ${cost ?? '?'} credits` : ''}</button>}
              </div>
            );
          })}
        </>}
      </Section>}
      <Section id="reel-voice" title="Voice" icon="mic" open={false} extra={<small className="muted">{voice?.name || 'Auto'}</small>}>
        <p className="sxi-hint">{voice ? `Speaking as ${voice.name} — ${voice.note}.` : 'Pick a voice. Press ▶ to hear it.'}{made ? ' Changing it records the voiceover again.' : ''}</p>
        <div className="sxr-voices">{(d.voices || []).map((v) => (
          <div key={v.id} role="button" tabIndex={0} aria-pressed={r.voice === v.id} className={`sxr-voice${r.voice === v.id ? ' on' : ''}`} onClick={() => !working && !busy && r.voice !== v.id && ed.settings({ voice: v.id })} onKeyDown={(e) => { if (e.key === 'Enter' && !working && r.voice !== v.id) ed.settings({ voice: v.id }); }}>
            <button type="button" className="play" aria-label={`Hear ${v.name}`} onClick={(e) => { e.stopPropagation(); ed.play(v); }}><Icon name={ed.playing === v.id ? 'x' : 'play'} size={13} /></button>
            <b>{v.name}</b><small>{v.note}</small>
          </div>
        ))}</div>
      </Section>
      <Section id="reel-captions" title="Captions" icon="list" open={false}>
        <p className="sxi-hint">Captions follow the words as they’re spoken.{made ? ' Changing the style only re-edits — nothing is made again.' : ''}</p>
        <div className="sxr-styles">{[...(d.captionStyles || []), { id: 'none', name: 'No captions' }].map((c) => {
          const on = (r.captions?.style || 'none') === c.id;
          return <button key={c.id} type="button" className={`sxr-style${on ? ' on' : ''}`} disabled={working || busy} onClick={() => !on && ed.settings({ captions: c.id === 'none' ? null : { style: c.id } })}><span className="demo"><CapDemo id={c.id} text={sel.line} /></span><span className="t">{c.name}</span></button>;
        })}</div>
      </Section>
      <Section id="reel-format" title="Sizes & closing card" icon="layout" open={false}>
        <p className="sxi-hint">Sizes to export — each is a separate video, framed for where it’s shown.</p>
        <div className="sxr-sizes">{SIZES.map(([k, l]) => {
          const on = (r.sizes || ['9:16']).includes(k), list = r.sizes || ['9:16'];
          return <button key={k} type="button" className={`sxr-size${on ? ' on' : ''}`} aria-pressed={on} disabled={working || busy || (on && list.length === 1)} onClick={() => ed.settings({ sizes: on ? list.filter((x) => x !== k) : [...list, k] })}><Ratio a={k} scale={1.3} />{k}<small className="muted">{l}</small></button>;
        })}</div>
        {[['headline', 'Headline', 40], ['offer', 'Offer or price', 40], ['cta', 'Call to action', 30]].map(([k, l, max]) => (
          <Field key={k} label={l}><input maxLength={max} value={s.endCard?.[k] || ''} disabled={!editing && !made} onChange={(e) => ed.edit({ endCard: { ...s.endCard, [k]: e.target.value } })} /></Field>
        ))}
        {made && ed.dirty && <button className="btn primary" disabled={busy} onClick={() => ed.act(() => api(`/studio/reels/${r.id}`, 'PUT', { endCard: s.endCard }), 'Re-editing with the new closing card')}>Apply the closing card</button>}
      </Section>
      <button type="button" className="sxi-memory" onClick={openMemory}><Icon name="sparkles" size={14} /><span><b>What Studio remembers</b><small>Used in every new script</small></span><Icon name="chevron" size={14} /></button>
      {extOf(extensions, 'inspector', d).map((x) => <Section key={x.id} id={`ext-${x.id}`} title={x.label} icon={x.icon}><x.Panel d={d} reel={r} mode="reel" load={ed.onChange} /></Section>)}
    </>
  );
}

// the check before spending: the plan read for quality and virality — the hook, every scene's pictures and movement,
// every line, the closing card, the music — with each suggested change one click away (applied to the script here, so
// it's in what gets approved). Free: nothing is made.
// the Creative Standard (server/studio/standard.js): the format's rules, each ✓ / ✗ with its fix, the playbook picks, the
// gate; the free script fixes (a shorter hook, the product moved up) in one click before anything is made
function StandardCheck({ r, edit }) {
  const st = r.standard, mark = (ok) => (ok === false ? '✗' : ok ? '✓' : '·');
  return (
    <Section id="reel-standard" title="Standard" icon="check" extra={<small className="muted">{st.label}</small>}>
      {(r.hook || r.structure) && <p className="sxi-hint">{[r.hook && `Hook: ${r.hook.label}`, r.structure && `Structure: ${r.structure.label}`].filter(Boolean).join(' · ')}</p>}
      {r.gate && <p className="sxi-say">{r.gate.ready ? `Meets the standard — score ${r.gate.score} (bar ${r.gate.bar})` : `Not ready to post yet — ${r.gate.score != null ? `score ${r.gate.score}, the bar is ${r.gate.bar}` : 'not reviewed'}`}</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {st.rules.map((x) => <li key={x.id} title={x.fix || ''} style={{ margin: '4px 0' }}><b style={{ color: x.ok === false ? 'var(--danger,#c00)' : 'inherit' }}>{mark(x.ok)}</b> {x.label}{x.detail && <small className="muted"> — {x.detail}</small>}{x.auto && <small className="muted"> · fixed for free</small>}{x.ok === false && x.fix && <small> · {x.fix}</small>}</li>)}
      </ul>
      {edit && st.script && <button type="button" className="btn ghost sm" onClick={() => edit({ lines: st.script.lines, shots: st.script.shots })}><Icon name="check" size={13} /> Apply the free fixes{st.changes?.length ? ` (${st.changes.length})` : ''}</button>}
    </Section>
  );
}

function PlanCheck({ r, s, edit, dirty, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = r.assessment;
  const run = async (again) => {
    setBusy(true); setErr('');
    try {
      if (dirty) await api(`/studio/reels/${r.id}/script`, 'PUT', { script: s });
      await api(`/studio/reels/${r.id}/assess`, 'POST', again ? { again: true } : {});
      await onChange();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => { if (!a && !busy) run(false); }, [r.id]);
  const shot = (i, p) => edit({ shots: s.shots.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const line = (i, text) => edit({ lines: s.lines.map((x, j) => (j === i ? text : x)) });
  const Use = ({ on, label }) => <button type="button" className="btn ghost sm" onClick={on}><Icon name="check" size={13} /> {label}</button>;
  return (
    <Section id="reel-check" title="Before you spend" icon="shield">
      {a && <div className="sxi-scores"><Score value={a.quality} label="Quality" title="Production quality" /><Score value={a.virality} label="Virality" title="Watched to the end, shared, acted on" hot /></div>}
      {busy && <p className="sxi-say"><span className="spin dark" /> Checking every scene, picture and line…</p>}
      {!a && busy && <div className="sxi-skel"><i /><i /><i /></div>}
      {err && <p className="sxi-hint">{err}</p>}
      {a && <>
        {a.verdict && <p className="sxi-say">{a.verdict}</p>}
        {(a.hook?.problem || a.hook?.line || a.hook?.image) && <div className="sxr-tip"><span className="no">hook · first 2 seconds</span>{a.hook.problem && <b>{a.hook.problem}</b>}
          {a.hook.line && <small className="muted">“{a.hook.line}”</small>}{a.hook.line && <Use on={() => line(0, a.hook.line)} label="Use this first line" />}
          {a.hook.image && <Use on={() => shot(0, { image: a.hook.image })} label="Use this first picture" />}</div>}
        {a.scenes.filter((x) => x.problem || x.image || x.end || x.motion || x.line).map((x) => (
          <div key={x.i} className="sxr-tip"><span className="no">scene {x.i + 1}{x.score != null ? <> · <span className={`sxr-check ${band(x.score)}`}>{x.score}</span></> : ''}</span>{x.problem && <b>{x.problem}</b>}
            {x.line && <><small className="muted">“{x.line}”</small><Use on={() => line(x.i, x.line)} label="Use this line" /></>}
            {x.image && <Use on={() => shot(x.i, { image: x.image })} label="Use the better picture" />}
            {x.end && <Use on={() => shot(x.i, { end: x.end })} label="Use the better ending" />}
            {x.motion && <Use on={() => shot(x.i, { motion: x.motion })} label="Use the better movement" />}</div>
        ))}
        {a.voice?.problem && <div className="sxr-tip"><span className="no">voice{a.voice.score != null ? ` · ${a.voice.score}` : ''}</span><b>{a.voice.problem}</b></div>}
        {a.endCard && <div className="sxr-tip"><span className="no">closing card</span><small className="muted">{[a.endCard.headline, a.endCard.offer, a.endCard.cta].filter(Boolean).join(' · ')}</small><Use on={() => edit({ endCard: { headline: a.endCard.headline || s.endCard?.headline || '', offer: a.endCard.offer || s.endCard?.offer || '', cta: a.endCard.cta || s.endCard?.cta || '' } })} label="Use this card" /></div>}
        {a.music && <div className="sxr-tip"><span className="no">music</span><small className="muted">{a.music}</small><Use on={() => edit({ music: a.music })} label="Use this mood" /></div>}
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(true)}><Icon name="redo" size={13} /> Check again{dirty ? ' with my changes' : ''}</button>
      </>}
    </Section>
  );
}
