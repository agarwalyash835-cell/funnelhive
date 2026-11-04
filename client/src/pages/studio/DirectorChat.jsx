// The creative director: Hive's chat (POST /api/hive/chat, streamed), kept to one thread for Studio and told what's on
// the canvas (the open Reel, or what's being made) with each message, so it can use its Studio tools on it — write a
// Reel, check it before spending, change a scene, animate. Anything it changes shows up on the canvas as it happens.
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Square, ArrowUp, Check, X, Loader2, Plus } from 'lucide-react';
import { api } from '../../api';
import { toast } from '../../ui';

const KEY = 'ff_studio_thread';
const savedThread = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };
const saveThread = (id) => { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
// the canvas, said to the director with each message (and left out when the thread is shown)
const CTX = /\n\n\(Studio context: [\s\S]*\)$/;
const clean = (t) => String(t || '').replace(CTX, '');
const DOING = { studio_make_images: 'Making the images', studio_make_clip: 'Making the clip', studio_status: 'Looking at your Studio', studio_redo: 'Redoing it', studio_make_reel: 'Writing your Reel', studio_approve_reel: 'Starting the Reel', studio_edit_reel: 'Changing the Reel', studio_memory: 'Reading your brand notes', studio_remember: 'Remembering that', studio_check: 'Checking quality and virality', studio_storyboard: 'Drawing up the storyboard', studio_change_scene: 'Changing the scene', studio_animate: 'Bringing the scenes to life' };

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

export function DirectorChat({ reel, mode, onActivity, onCollapse }) {
  const [ready, setReady] = useState(null);
  const [tid, setTid] = useState(savedThread);
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const abort = useRef(null), endRef = useRef(null), boxRef = useRef(null);
  useEffect(() => { api('/hive/status').then((s) => setReady(!!s.ready)).catch(() => setReady(false)); }, []);
  useEffect(() => { if (!tid) return; api(`/hive/threads/${tid}`).then((t) => setMsgs(t.messages || [])).catch(() => { saveThread(null); setTid(null); }); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, live]);
  useEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = 'auto'; b.style.height = `${Math.min(160, b.scrollHeight)}px`; }, [input]);

  const context = () => (reel
    ? `(Studio context: the seller has the Reel “${reel.title}” open (id ${reel.id}, status ${reel.status}). Use the Studio tools on this Reel unless they say otherwise; say the credits before anything paid.)`
    : `(Studio context: the seller is in Studio making ${mode === 'clip' ? 'video clips' : mode === 'reel' ? 'Reels' : mode === 'image' ? 'images' : mode}. Use the Studio tools; say the credits before anything paid.)`);

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: message, at: Date.now() }]);
    setLive({ tools: [] });
    const ac = new AbortController(); abort.current = ac;
    let threadId = tid;
    try {
      const res = await fetch('/api/hive/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ message: `${message}\n\n${context()}`, threadId: tid }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Your creative director is unavailable right now'); }
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
          if (ev.type === 'thread') { threadId = ev.threadId; setTid(ev.threadId); saveThread(ev.threadId); }
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
  const fresh = () => { if (busy) return; saveThread(null); setTid(null); setMsgs([]); boxRef.current?.focus(); };

  const sugg = reel
    ? (reel.status === 'script_ready' ? ['Make the first two seconds impossible to scroll past', 'Check this before I spend anything', 'Rewrite it in Hindi, same story'] : reel.status === 'storyboard_ready' ? ['Which scene is weakest? Fix it', 'Make scene 1 warmer and closer', 'Animate it — what will it cost?'] : ['What would make this Reel perform better?', 'Make a 15-second cut of this idea', 'Remember: I like warm morning light'])
    : mode === 'reel' ? ['Write a 30s launch Reel for my product, Hindi voiceover', 'Plan a festive-sale Reel with a WhatsApp call to action', 'What do you remember about my brand?']
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
            <p>I write the scripts, plan the shots, check them for quality and virality before you spend, and change anything you point at.</p>
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
      <form className="sxc-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={boxRef} rows={1} value={input} disabled={!ready} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={ready === false ? 'The director is offline' : reel ? 'Ask for a change to this Reel…' : 'Tell me what you want to make…'} aria-label="Message the creative director" />
        {busy ? <button type="button" className="sxc-send stop" aria-label="Stop" onClick={() => abort.current?.abort()}><Square size={13} /></button>
          : <button className="sxc-send" aria-label="Send" disabled={!input.trim() || !ready}><ArrowUp size={17} /></button>}
      </form>
    </div>
  );
}
