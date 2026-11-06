// The members area's book reader and audiobook player.
// Reader: a PDF arrives encrypted through a 10-minute link only this signed-in member can use; it's decrypted in
// memory and each page is drawn onto a canvas with the member's email across it (no text layer, no download, no
// print). Honest about the limit: no web reader stops a screenshot — the watermark shows whose copy it was.
// Audiobook: the course's lessons as chapters — resume each where it stopped, 0.75×–2×, ±15 s, plays on from one
// chapter to the next, lock-screen / headphone controls on phones (Media Session).
import { useEffect, useMemo, useRef, useState } from 'react';

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
export const isAudio = (f) => /^audio\//.test(f?.type || '') || /\.(mp3|m4a|aac|ogg|wav)$/i.test(f?.name || '');
export const isPdf = (f) => /pdf/.test(f?.type || '') || /\.pdf$/i.test(f?.name || '');

let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  // the legacy build: also runs on older Android phones
  const [lib, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjs = lib;
  return lib;
}

// the member's email, diagonally across the whole page, drawn into the page image itself
function watermark(ctx, w, h, text) {
  ctx.save();
  const size = Math.max(14, Math.round(w / 26));
  ctx.font = `600 ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  ctx.fillStyle = 'rgba(70, 70, 110, 0.13)';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 6);
  const step = ctx.measureText(text).width + size * 3;
  const span = Math.hypot(w, h);
  for (let y = -span / 2, row = 0; y < span / 2; y += size * 5, row++) {
    for (let x = -span / 2 - (row % 2) * step / 2; x < span / 2; x += step) ctx.fillText(text, x, y);
  }
  ctx.restore();
}

function Page({ doc, n, width, ratio, mark, onSeen }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setNear(true); if (e.intersectionRatio > 0.5) onSeen(n); }), { rootMargin: '600px 0px', threshold: [0, 0.5] });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near || !width) return;
    let task, gone = false;
    doc.getPage(n).then((page) => {
      if (gone) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${width}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
      const ctx = c.getContext('2d');
      task = page.render({ canvasContext: ctx, viewport: vp });
      return task.promise.then(() => { if (!gone && mark) watermark(ctx, c.width, c.height, mark); });
    }).catch(() => {});
    return () => { gone = true; task?.cancel?.(); };
  }, [near, width, doc, n]);
  return <div ref={box} className="ln-rd-page" style={{ minHeight: near ? undefined : Math.round(width * ratio) }} data-page={n}><canvas ref={canvas} aria-label={`Page ${n}`} /></div>;
}

export function PdfReader({ api, token, accessId, file, onClose, t }) {
  const [doc, setDoc] = useState(null);
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [ratio, setRatio] = useState(1.414);
  const [zoom, setZoom] = useState(1);
  const [cur, setCur] = useState(1);
  const [width, setWidth] = useState(0);
  const body = useRef(null);
  const lastKey = `ff_reader_page_${file.id}`;
  useEffect(() => {
    let gone = false, d = null;
    (async () => {
      const r = await api('/reader', 'POST', { accessId, fileId: file.id });
      const res = await fetch(r.src, { headers: { 'X-Student': token } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'This file couldn’t be opened — try again');
      const enc = await res.arrayBuffer();
      const key = await crypto.subtle.importKey('raw', b64(r.key), 'AES-CTR', false, ['decrypt']);
      const data = await crypto.subtle.decrypt({ name: 'AES-CTR', counter: b64(r.iv), length: 64 }, key, enc);
      const lib = await loadPdfjs();
      d = await lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
      if (gone) return d.destroy();
      const p1 = await d.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      setRatio(v.height / v.width);
      setInfo(r); setDoc(d);
    })().catch((e) => !gone && setErr(e.message || 'This file couldn’t be opened — try again'));
    return () => { gone = true; d?.destroy(); };
  }, [file.id]);
  // the page width follows the window (and the zoom)
  useEffect(() => {
    const fit = () => setWidth(Math.min((body.current?.clientWidth || 800) - 24, 900) * zoom);
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [zoom, doc]);
  // back to the page they were on
  useEffect(() => { if (!doc) return; const p = Number(store.get(lastKey)) || 1; if (p > 1) setTimeout(() => body.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView(), 50); }, [doc]);
  useEffect(() => { if (doc) store.set(lastKey, String(cur)); }, [cur]);
  // no printing or saving from the reader; Escape closes it
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && /^[psc]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', k, true);
    document.body.classList.add('ln-reading');
    return () => { window.removeEventListener('keydown', k, true); document.body.classList.remove('ln-reading'); };
  }, []);
  const pages = useMemo(() => (doc ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : []), [doc]);
  return (
    <div className="ln-reader" role="dialog" aria-modal="true" aria-label={file.name} onContextMenu={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>
      <header className="ln-rd-bar">
        <button className="ln-x" aria-label={t('Close')} onClick={onClose}>×</button>
        <b className="ln-rd-title">{file.name}</b>
        {doc && <span className="ln-rd-pg">{t('Page {i} of {n}', { i: cur, n: doc.numPages })}</span>}
        <span className="ln-rd-zoom">
          <button aria-label={t('Zoom out')} disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}>−</button>
          <button aria-label={t('Zoom in')} disabled={zoom >= 2.4} onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))}>+</button>
        </span>
      </header>
      <div className="ln-rd-body" ref={body}>
        {(info?.readOnly || file.readOnly) && <p className="ln-rd-note">🔒 {t('Read-only: this book opens here and can’t be downloaded or printed. Your email is on every page.')} {t('No reader can stop screenshots — the watermark shows whose copy it was.')}</p>}
        {err ? <p className="ln-err" role="alert">{t(err)}</p>
          : !doc ? <div className="ln-rd-wait"><span className="ln-spin" /> {t('Opening the book…')}</div>
            : pages.map((n) => <Page key={n} doc={doc} n={n} width={width} ratio={ratio} mark={info.mark} onSeen={setCur} />)}
      </div>
    </div>
  );
}

// ---------- the audiobook ----------
const clock = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const audioOf = (l) => l.files?.find(isAudio);

export function Audiobook({ c, cur, api, go, pid, reload, school, t }) {
  const el = useRef(null);
  const last = useRef(0);
  const wantPlay = useRef(false);
  const seekTo = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(() => Number(store.get('ff_learn_speed')) || 1);
  const [pos, setPos] = useState({}); // positions saved in this visit, on top of the server's
  const [fin, setFin] = useState({}); // chapters finished in this visit (no refetch mid-play: that would swap the stream links)
  const chapters = c.lessons.filter((l) => l.locked || audioOf(l));
  const i = chapters.findIndex((l) => l.id === cur.id);
  const audio = audioOf(cur);
  const next = chapters.slice(i + 1).find((l) => !l.locked), prev = [...chapters.slice(0, Math.max(0, i))].reverse().find((l) => !l.locked);
  const save = (extra = {}) => {
    const v = el.current; if (!v) return;
    const s = Math.floor(v.currentTime);
    setPos((p) => ({ ...p, [cur.id]: s }));
    return api('/progress', 'POST', { accessId: c.accessId, lessonId: cur.id, t: s, ...extra }).catch(() => null);
  };
  const open = (l, play) => { if (!l || l.locked) return; wantPlay.current = play ?? playing; go(`course/${pid}/${l.id}`); };
  const skip = (d) => { const v = el.current; if (v) v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.5, v.currentTime + d)); };
  const toggle = () => { const v = el.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  useEffect(() => { last.current = 0; setTime(0); setDur(0); }, [cur.id]);
  useEffect(() => { if (el.current) el.current.playbackRate = speed; store.set('ff_learn_speed', String(speed)); }, [speed]);
  // lock screen, headphones, car: what's playing and the buttons
  useEffect(() => {
    const ms = navigator.mediaSession; if (!ms) return;
    try {
      ms.metadata = new window.MediaMetadata({ title: cur.title, artist: school?.name || '', album: c.name, artwork: c.cover ? [{ src: c.cover, sizes: '512x512' }] : [] });
      const h = { play: () => el.current?.play(), pause: () => el.current?.pause(), seekbackward: () => skip(-15), seekforward: () => skip(15), previoustrack: prev ? () => open(prev, true) : null, nexttrack: next ? () => open(next, true) : null, seekto: (e) => { if (el.current && e.seekTime != null) el.current.currentTime = e.seekTime; } };
      for (const [k, fn] of Object.entries(h)) { try { ms.setActionHandler(k, fn); } catch {} }
    } catch {}
  }, [cur.id, next?.id, prev?.id]);
  const posOf = (l) => pos[l.id] ?? l.pos ?? 0;
  const events = {
    onLoadedMetadata: (e) => {
      const v = e.target; setDur(v.duration || 0); v.playbackRate = speed;
      const at = seekTo.current ?? posOf(cur); seekTo.current = null;
      if (at > 3 && at < (v.duration || Infinity) - 5) v.currentTime = at;
      if (wantPlay.current) { wantPlay.current = false; v.play().catch(() => {}); }
    },
    onTimeUpdate: (e) => {
      const v = e.target; setTime(v.currentTime);
      try { navigator.mediaSession?.setPositionState?.({ duration: v.duration || 0, playbackRate: v.playbackRate, position: Math.min(v.currentTime, v.duration || 0) }); } catch {}
      if (Math.abs(v.currentTime - last.current) >= 15) { last.current = v.currentTime; save(); }
    },
    onPlay: () => setPlaying(true),
    onPause: () => { setPlaying(false); save(); },
    // the chapter's done: on to the next one, still playing
    onEnded: async () => {
      setPlaying(false);
      await api('/progress', 'POST', { accessId: c.accessId, lessonId: cur.id, done: true }).catch(() => null);
      // "continue listening" now points at the next chapter
      if (next) api('/progress', 'POST', { accessId: c.accessId, lessonId: next.id, t: 0 }).catch(() => null);
      setPos((p) => ({ ...p, [cur.id]: 0 }));
      setFin((f) => ({ ...f, [cur.id]: true }));
      if (next) open(next, true); else reload();
    },
    // a stream link lasts 2 hours: fetch fresh ones and carry on from the same second
    onError: () => { if (el.current?.currentTime) seekTo.current = el.current.currentTime; wantPlay.current = playing; reload(); },
  };
  return (
    <div className="ln-ab">
      <div className="ln-ab-card">
        <div className="ln-ab-cover" style={c.cover ? { backgroundImage: `url("${c.cover}")` } : undefined}>{!c.cover && '🎧'}</div>
        <small className="ln-mute">{t('Chapter {i} of {n}', { i: i + 1, n: chapters.length })}</small>
        <h1>{cur.title}</h1>
        {audio?.view ? <audio ref={el} src={audio.view} preload="metadata" controlsList="nodownload" {...events} /> : <p className="ln-mute">{t('This chapter has no audio yet.')}</p>}
        <input className="ln-ab-seek" type="range" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(time)} onChange={(e) => { if (el.current) el.current.currentTime = Number(e.target.value); }} aria-label={t('Position')} />
        <div className="ln-ab-times"><span>{clock(time)}</span><span>{dur ? `−${clock(dur - time)}` : '--:--'}</span></div>
        <div className="ln-ab-ctl">
          <button aria-label={t('Previous chapter')} disabled={!prev} onClick={() => open(prev)}>⏮</button>
          <button aria-label={t('Back 15 seconds')} onClick={() => skip(-15)}>↺<small>15</small></button>
          <button className="ln-ab-play" aria-label={playing ? t('Pause') : t('Play')} disabled={!audio?.view} onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
          <button aria-label={t('Forward 15 seconds')} onClick={() => skip(15)}>↻<small>15</small></button>
          <button aria-label={t('Next chapter')} disabled={!next} onClick={() => open(next)}>⏭</button>
        </div>
        <div className="ln-ab-speed" role="group" aria-label={t('Speed')}>{SPEEDS.map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
      </div>
      <div className="ln-ab-list">
        <h3>{t('Chapters')}</h3>
        {chapters.map((l, k) => (
          <button key={l.id} disabled={l.locked} className={`ln-les ${l.id === cur.id ? 'on' : ''} ${l.done || fin[l.id] ? 'done' : ''}`} onClick={() => open(l, l.id === cur.id ? playing : true)}>
            <span className="ln-tick">{l.locked ? '🔒' : l.done || fin[l.id] ? '✓' : k + 1}</span>
            <span className="ln-les-t">{l.title}{!l.locked && posOf(l) > 3 && !l.done && !fin[l.id] ? <small>{t('Resume at {t}', { t: clock(posOf(l)) })}</small> : null}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
