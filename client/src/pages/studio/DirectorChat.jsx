// The creative director: Hive's chat (POST /api/hive/chat, streamed) in its Studio scope (only Studio's tools, told how
// to edit), one thread per thing being worked on (a Reel, an image, or the mode when nothing is open), and told what's on
// the canvas and what the seller has pointed at with each message — so "make the background darker" or "swap this for
// a close-up" lands on the right thing (studio_edit). Anything it changes shows up on the canvas as it happens.
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Square, ArrowUp, Check, X, Loader2, Plus, Crosshair } from 'lucide-react';
import { api } from '../../api';
import { toast } from '../../ui';

const KEY = 'ff_studio_thread';
const keyOf = (scope) => `${KEY}:${scope}`;
const savedThread = (scope) => { try { return localStorage.getItem(keyOf(scope)) || null; } catch { return null; } };
const saveThread = (scope, id) => { try { if (id) localStorage.setItem(keyOf(scope), id); else localStorage.removeItem(keyOf(scope)); } catch { /* private mode */ } };
// the canvas, said to the director with each message (and left out when the thread is shown)
const CTX = /\n\n\(Studio context: [\s\S]*\)$/;
const clean = (t) => String(t || '').replace(CTX, '');
const DOING = { studio_make_images: 'Making the images', studio_make_clip: 'Making the clip', studio_status: 'Looking at your Studio', studio_redo: 'Redoing it', studio_make_reel: 'Writing your Reel', studio_approve_reel: 'Starting the Reel', studio_edit_reel: 'Changing the Reel', studio_edit: 'Making the change', studio_undo: 'Going back', studio_memory: 'Reading your brand notes', studio_remember: 'Remembering that', studio_check: 'Checking quality and virality', studio_storyboard: 'Drawing up the storyboard', studio_change_scene: 'Changing the scene', studio_animate: 'Bringing the scenes to life', studio_make_design: 'Drafting the design', studio_make_thumbnail: 'Drafting the thumbnail', studio_make_carousel: 'Drafting the carousel', studio_finish_design: 'Making the picture', studio_edit_design: 'Changing the design', studio_design: 'Looking at the design' };

function Rich({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => (/^\*\*.+\*\*$/.test(p) ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b> : /^`.+`$/.test(p) ? <code key={`${k}-${i}`}>{p.slice(1, -1)}</code> : p));
  const out = []; let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `l${i}`)}</li>)}</ul>); list = []; } };
  String(text || '').split('\n').forEach((l, i) => { const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)/.exec(l); if (m) list.push(m[1]); else { flush(); if (l.trim()) out.push(<p key={`p${i}`}>{inline(l, `p${i}`)}</p>); } });
  flush();
  return <div className="sxc-rich">{out}</div>;
}

const waiting = (t) => t.pending && !t.resolved;
function Tools({ tools, onDecide, deciding }) {
  if (!tools?.length) return null;
  return (
    <ul className="sxc-tools">{tools.map((t, i) => (
      <li key={t.id || i} className={waiting(t) ? 'confirm' : t.resolved === 'cancelled' ? 'cancelled' : t.status === 'running' ? 'running' : t.ok === false || t.status === 'error' ? 'error' : 'done'}>
        {t.status === 'running' ? <Loader2 size={13} className="spin-i" /> : t.ok === false || t.status === 'error' || t.resolved === 'cancelled' ? <X size={13} /> : waiting(t) ? <Square size={12} /> : <Check size={13} />}
        <span>{t.summary || (t.status === 'running' && DOING[t.name] ? `${DOING[t.name]}…` : t.label || DOING[t.name] || 'Working')}</span>
        {waiting(t) && onDecide && <span className="sxc-ok"><button type="button" className="btn sm primary" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, true)}>Confirm</button><button type="button" className="btn sm" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, false)}>Cancel</button></span>}
        {t.images?.length > 0 && <span className="sxc-strip">{t.images.slice(0, 8).map((m) => <img key={m.url} src={m.url} alt={m.label || ''} title={m.caption || m.label} loading="lazy" />)}</span>}
      </li>
    ))}</ul>
  );
}

// selected: { id, kind, target, label, url } — what the seller pointed at; onUnselect drops it back to the whole thing
export function DirectorChat({ reel, mode, selected, onUnselect, onActivity, onCollapse }) {
  const scope = reel?.id || (selected?.id && selected.kind !== 'reel' ? selected.id : `mode-${mode}`);
  const [ready, setReady] = useState(null);
  const [tid, setTid] = useState(() => savedThread(scope));
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const abort = useRef(null), endRef = useRef(null), boxRef = useRef(null);
  useEffect(() => { api('/hive/status').then((s) => setReady(!!s.ready)).catch(() => setReady(false)); }, []);
  // each thing has its own conversation: switching brings back that thing's thread
  useEffect(() => {
    if (busy) return;
    const t = savedThread(scope);
    setTid(t); setMsgs([]);
    if (t) api(`/hive/threads/${t}`).then((x) => setMsgs(x.messages || [])).catch(() => { saveThread(scope, null); setTid(null); });
  }, [scope]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, live]);
  useEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = 'auto'; b.style.height = `${Math.min(160, b.scrollHeight)}px`; }, [input]);

  const chip = selected && !(selected.kind === 'reel' && selected.target === 'reel') ? selected : null;
  const pointed = chip ? ` They have selected: ${chip.label} (studio_edit target "${chip.target}" on item ${chip.id}) — “this”, “it” and “here” mean that.` : '';
  const context = () => (reel
    ? `(Studio context: the seller has the Reel “${reel.title}” open (id ${reel.id}, status ${reel.status}).${pointed} Use the Studio tools on this Reel unless they say otherwise; say the credits before anything paid.)`
    : chip
      ? `(Studio context: the seller is in Studio with ${chip.label.toLowerCase()} selected (id ${chip.id}, studio_edit target "${chip.target}") — “this” and “it” mean that. Use the Studio tools; say the credits before anything paid.)`
      : `(Studio context: the seller is in Studio making ${mode === 'clip' ? 'video clips' : mode === 'reel' ? 'Reels' : mode === 'image' ? 'images' : mode}. Use the Studio tools; say the credits before anything paid.)`);

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: message, at: Date.now() }]);
    setLive({ tools: [] });
    const ac = new AbortController(); abort.current = ac;
    let threadId = tid;
    const here = scope;
    try {
      // the streamed reply can't go through api(): this light call first refreshes an old sign-in the same way
      await api('/hive/status').catch(() => {});
      const res = await fetch('/api/hive/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ message: `${message}\n\n${context()}`, threadId: tid, scope: 'studio' }) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        // out of credits or the plan ended: the app's upgrade prompt, as everywhere else
        if (res.status === 402) window.dispatchEvent(new CustomEvent('ff:paywall', { detail: e }));
        if (res.status === 401) await api('/hive/status').catch(() => {}); // signs out, or back to the agency, as api() does
        throw new Error(e.error || 'Your creative director is unavailable right now');
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6));
          if (ev.type === 'thread') { threadId = ev.threadId; setTid(ev.threadId); saveThread(here, ev.threadId); }
          else if (ev.type === 'thinking') setLive((l) => ({ ...l, thinking: ev.text }));
          else if (ev.type === 'tool') {
            setLive((l) => ({ ...l, tools: ev.status === 'running' ? [...l.tools, ev] : l.tools.map((t) => (t.id === ev.id ? { ...t, ...ev } : t)) }));
            if (ev.status !== 'running' && String(ev.name || '').startsWith('studio_')) onActivity?.();
          } else if (ev.type === 'reply') setMsgs((m) => [...m, { role: 'assistant', text: ev.text, tools: ev.tools, at: Date.now() }]);
          else if (ev.type === 'error') setMsgs((m) => [...m, { role: 'assistant', text: ev.error, error: true, at: Date.now() }]);
        }
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e.name === 'AbortError' ? 'Stopped.' : e.message, error: e.name !== 'AbortError', at: Date.now() }]);
    }
    setLive(null); setBusy(false); abort.current = null;
    onActivity?.();
    if (threadId) setTimeout(() => api(`/hive/threads/${threadId}`).then((t) => setMsgs(t.messages || [])).catch(() => {}), ac.signal.aborted ? 1200 : 0);
    setTimeout(() => boxRef.current?.focus(), 0);
  };
  const decide = async (pendingId, ok) => {
    if (deciding || !tid) return;
    setDeciding(pendingId);
    try {
      const r = await api(`/hive/threads/${tid}/confirm`, 'POST', { pendingId, ok });
      setMsgs((m) => [...m.map((x) => (x.tools ? { ...x, tools: x.tools.map((t) => (t.pending === pendingId ? { ...t, resolved: r.cancelled ? 'cancelled' : r.ok ? 'done' : 'error', summary: r.summary, ok: r.ok, ...(r.images ? { images: r.images } : {}) } : t)) } : x)), { role: 'assistant', text: r.summary, error: !r.ok, at: Date.now() }]);
      onActivity?.();
    } catch (e) { toast(e.message); }
    setDeciding(null);
  };
  const fresh = () => { if (busy) return; saveThread(scope, null); setTid(null); setMsgs([]); boxRef.current?.focus(); };

  const sceneSel = chip?.target?.startsWith('scene:');
  const sugg = reel
    ? (reel.status === 'script_ready' ? ['Make the first two seconds impossible to scroll past', 'Check this before I spend anything', 'Rewrite it in Hindi, same story']
      : reel.status === 'storyboard_ready' ? (sceneSel ? ['Make this one warmer and closer', 'Swap this for a close-up of the product', 'Drop this scene'] : ['Which scene is weakest? Fix it', 'Make scene 1 warmer and closer', 'Animate it — what will it cost?'])
        : sceneSel ? ['Swap this for a close-up', 'Make the camera push in slowly here', 'Remove this scene'] : ['Make it look more matte and filmic', 'Captions on the left, in a serif font', 'Music a bit quieter', 'Undo the last change'])
    : chip?.kind === 'image' ? ['Make the background darker', 'Warmer, morning light', 'Remove the clutter around the product']
      : chip?.kind === 'clip' ? ['Slower, with a gentle push-in', 'Keep the camera still'] : mode === 'reel' ? ['Write a 30s launch Reel for my product, Hindi voiceover', 'Plan a festive-sale Reel with a WhatsApp call to action', 'What do you remember about my brand?']
        : mode === 'clip' ? ['Turn my latest image into a slow push-in clip', 'Suggest three clip ideas for my product'] : ['Make 4 product shots on a festive table', 'Shoot my product like a premium brand would', 'What do you remember about my brand?'];
  const empty = !msgs.length && !live;

  return (
    <div className="sxc">
      <header className="sxc-h">
        <span className="sxc-av" aria-hidden="true"><Sparkles size={14} /></span>
        <div className="sxc-who"><b>Creative director</b><small className={ready ? 'on' : ''}><i />{ready == null ? 'Connecting…' : ready ? (reel ? `On “${reel.title}”` : 'Ready when you are') : 'Offline'}</small></div>
        <button type="button" className="icon-btn" title="New conversation" aria-label="New conversation" disabled={busy} onClick={fresh}><Plus size={16} /></button>
        {onCollapse && <button type="button" className="icon-btn sxc-fold" title="Hide the director" aria-label="Hide the director" onClick={onCollapse}><X size={16} /></button>}
      </header>
      <div className="sxc-msgs" aria-live="polite">
        {empty && (
          <div className="sxc-empty">
            <span className="sxc-orb" aria-hidden="true"><Sparkles size={22} /></span>
            <h3>Brief me like you’d brief an agency</h3>
            <p>I write the scripts, plan the shots, check them before you spend — and change anything you point at. Click a scene or a picture, then just say what should be different.</p>
            {ready === false && <p className="sxc-warn">The director isn’t switched on yet — everything on the canvas still works.</p>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`sxc-msg ${m.role}${m.error ? ' err' : ''}`}>
            {m.role === 'assistant' ? <><Tools tools={m.tools} onDecide={busy ? null : decide} deciding={deciding} /><Rich text={m.text} /></> : <p>{clean(m.text)}</p>}
          </div>
        ))}
        {live && (
          <div className="sxc-msg assistant live">
            {live.thinking && <Rich text={live.thinking} />}
            <Tools tools={live.tools} />
            <span className="sxc-typing"><i /><i /><i /> {(() => { const run = [...live.tools].reverse().find((t) => t.status === 'running'); return run ? `${DOING[run.name] || 'Working on it'}…` : 'Thinking it through…'; })()}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {!busy && ready && <div className="sxc-sugg">{sugg.map((x) => <button key={x} type="button" onClick={() => send(x)}>{x}</button>)}</div>}
      {chip && (
        <div className="sxc-sel" aria-label="What your message is about">
          {chip.url ? <img src={chip.url} alt="" /> : <Crosshair size={14} aria-hidden="true" />}
          <span>Editing <b>{chip.label}</b></span>
          {onUnselect && <button type="button" className="icon-btn" aria-label="Talk about the whole thing instead" title="Talk about the whole thing instead" onClick={onUnselect}><X size={13} /></button>}
        </div>
      )}
      <form className="sxc-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={boxRef} rows={1} value={input} disabled={!ready} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={ready === false ? 'The director is offline' : chip ? `What should change in ${chip.label.toLowerCase()}?` : reel ? 'Ask for a change to this Reel…' : 'Tell me what you want to make…'} aria-label="Message the creative director" />
        {busy ? <button type="button" className="sxc-send stop" aria-label="Stop" onClick={() => abort.current?.abort()}><Square size={13} /></button>
          : <button className="sxc-send" aria-label="Send" disabled={!input.trim() || !ready}><ArrowUp size={17} /></button>}
      </form>
    </div>
  );
}
