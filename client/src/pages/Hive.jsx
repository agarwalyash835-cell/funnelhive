// Hive AI — chat on the left, the funnel being built on the right ("Lovable for funnels")
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Send, Square, Plus, Trash2, Check, X, Loader2, Monitor, Smartphone, ExternalLink, PanelLeft, MessageSquare, Eye, Pencil } from 'lucide-react';
import { api } from '../api';
import { Layout, toast, ago } from '../ui';
import { Page } from '../blocks';

const SUGGESTIONS = [
  'Build a funnel for my home bakery in Pune — custom birthday cakes from ₹899',
  'Create a webinar funnel for my stock-market course at ₹2,999 with a ₹499 upsell',
  'Add an abandoned-checkout automation: email after 30 minutes, WhatsApp next morning at 10',
  'Make the landing page darker and more premium, and add a FAQ about refunds',
];

// minimal, safe formatting for replies: **bold**, `code`, bullet lists, links
function Rich({ text }) {
  const lines = String(text || '').split('\n');
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g).map((p, i) => (
    /^\*\*.+\*\*$/.test(p) ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b>
      : /^`.+`$/.test(p) ? <code key={`${k}-${i}`}>{p.slice(1, -1)}</code>
        : /^https?:\/\//.test(p) ? <a key={`${k}-${i}`} href={p} target="_blank" rel="noreferrer">{p}</a> : p));
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `l${i}`)}</li>)}</ul>); list = []; } };
  lines.forEach((l, i) => {
    const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)/.exec(l);
    if (m) list.push(m[1]); else { flush(); if (l.trim()) out.push(<p key={`p${i}`}>{inline(l, `p${i}`)}</p>); }
  });
  flush();
  return <div className="rich">{out}</div>;
}

const ToolChips = ({ tools }) => (tools?.length ? (
  <ul className="hv-tools">{tools.map((t, i) => (
    <li key={t.id || i} className={t.status || (t.ok === false ? 'error' : 'done')}>
      {t.status === 'running' ? <Loader2 size={13} className="spin-i" /> : t.ok === false || t.status === 'error' ? <X size={13} /> : <Check size={13} />}
      <span>{t.summary || t.label || t.name}</span>
    </li>
  ))}</ul>
) : null);

export default function Hive() {
  const [status, setStatus] = useState(null);
  const [threads, setThreads] = useState([]);
  const [tid, setTid] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(null); // the turn in progress: { tools: [], thinking }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [funnelId, setFunnelId] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [stepId, setStepId] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [side, setSide] = useState(true);
  const [mob, setMob] = useState('chat');
  const abort = useRef(null);
  const endRef = useRef(null);
  const boxRef = useRef(null);

  const loadThreads = () => api('/hive/threads').then(setThreads).catch(() => {});
  useEffect(() => { api('/hive/status').then(setStatus); loadThreads(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, live]);
  const loadFunnel = async (id) => {
    if (!id) { setFunnel(null); return; }
    try { const f = await api(`/funnels/${id}`); setFunnel(f); setStepId((s) => (f.steps.some((x) => x.id === s) ? s : f.steps[0]?.id)); } catch { setFunnel(null); }
  };
  useEffect(() => { loadFunnel(funnelId); }, [funnelId]);

  const openThread = async (id) => {
    if (busy) return;
    setTid(id); setLive(null); setMob('chat');
    if (!id) { setMsgs([]); setFunnelId(null); return; }
    const t = await api(`/hive/threads/${id}`);
    setMsgs(t.messages); setFunnelId(t.funnelId);
  };
  const removeThread = async (id) => { if (!confirm('Delete this chat? Funnels it built are kept.')) return; await api(`/hive/threads/${id}`, 'DELETE'); if (id === tid) openThread(null); loadThreads(); };

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', text: message, at: Date.now() }]);
    setLive({ tools: [], thinking: '' });
    const ac = new AbortController(); abort.current = ac;
    let finalFunnel = funnelId;
    try {
      const res = await fetch('/api/hive/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ff_token')}` }, body: JSON.stringify({ message, threadId: tid, funnelId }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Hive AI is unavailable right now'); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
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
          if (ev.type === 'thread') { setTid(ev.threadId); }
          else if (ev.type === 'thinking') setLive((l) => ({ ...l, thinking: ev.text }));
          else if (ev.type === 'tool') {
            setLive((l) => ({ ...l, tools: ev.status === 'running' ? [...l.tools, ev] : l.tools.map((t) => (t.id === ev.id ? { ...t, ...ev } : t)) }));
            if (ev.status === 'done' && ev.funnelId) { if (ev.funnelId !== finalFunnel) { finalFunnel = ev.funnelId; setFunnelId(ev.funnelId); } else loadFunnel(ev.funnelId); }
          } else if (ev.type === 'reply') {
            setMsgs((m) => [...m, { role: 'assistant', text: ev.text, tools: ev.tools, at: Date.now() }]);
            if (ev.funnelId && ev.funnelId !== finalFunnel) setFunnelId(ev.funnelId); else if (ev.funnelId) loadFunnel(ev.funnelId);
          } else if (ev.type === 'error') setMsgs((m) => [...m, { role: 'assistant', text: ev.error, error: true, at: Date.now() }]);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setMsgs((m) => [...m, { role: 'assistant', text: e.message, error: true, at: Date.now() }]);
      else setMsgs((m) => [...m, { role: 'assistant', text: 'Stopped.', at: Date.now() }]);
    }
    setLive(null); setBusy(false); abort.current = null;
    loadThreads();
    setTimeout(() => boxRef.current?.focus(), 0);
  };

  const step = funnel?.steps.find((s) => s.id === stepId) || funnel?.steps[0];
  const ready = status?.ready;
  const empty = !msgs.length && !live;

  return (
    <Layout title={<span className="hv-title"><Sparkles size={20} /> Hive AI</span>} subtitle="Describe it — Hive builds the funnel, pages, offers and automations while you watch." wide>
      <div className={`hive ${side ? '' : 'no-side'} mob-${mob}`}>
        <aside className="hv-threads">
          <button className="btn primary block" onClick={() => openThread(null)} disabled={busy}><Plus size={15} /> New chat</button>
          <div className="hv-tlist">
            {threads.map((t) => (
              <div key={t.id} className={`hv-t ${t.id === tid ? 'on' : ''}`} onClick={() => openThread(t.id)}>
                <MessageSquare size={14} /><span title={t.title}>{t.title}</span><small>{ago(t.updatedAt)}</small>
                <button className="icon-btn xs" title="Delete chat" onClick={(e) => { e.stopPropagation(); removeThread(t.id); }}><Trash2 size={12} /></button>
              </div>
            ))}
            {!threads.length && <p className="hint">Your chats appear here.</p>}
          </div>
        </aside>

        <section className="hv-chat">
          <div className="hv-chat-h">
            <button className="icon-btn" title={side ? 'Hide chats' : 'Show chats'} onClick={() => setSide(!side)}><PanelLeft size={17} /></button>
            <b>{threads.find((t) => t.id === tid)?.title || 'New chat'}</b>
            <span className="muted sm">{status?.provider}</span>
          </div>
          <div className="hv-msgs">
            {empty && (
              <div className="hv-empty">
                <span className="hv-logo"><Sparkles size={26} /></span>
                <h2>What are we building today?</h2>
                <p className="muted">Hive builds complete funnels — landing page, checkout, upsells, thank-you page — then edits anything you ask: copy, sections, design, coupons and automations.</p>
                {ready === false && <p className="hv-warn">Hive AI needs an AI model with tool support on the server (KIE_API_KEY with a DeepSeek, GPT or Kimi model).</p>}
                <div className="hv-sugg">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={!ready}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`hv-msg ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'assistant' && <span className="hv-av"><Sparkles size={14} /></span>}
                <div className="hv-bub">{m.role === 'assistant' ? <><ToolChips tools={m.tools} /><Rich text={m.text} /></> : m.text}</div>
              </div>
            ))}
            {live && (
              <div className="hv-msg assistant live">
                <span className="hv-av"><Sparkles size={14} /></span>
                <div className="hv-bub">
                  {live.thinking && <Rich text={live.thinking} />}
                  <ToolChips tools={live.tools} />
                  <span className="hv-typing"><i /><i /><i /> {live.tools.some((t) => t.status === 'running' && t.name === 'create_funnel') ? 'Building your funnel — about a minute' : 'Working'}</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form className="hv-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={boxRef} rows={2} value={input} onChange={(e) => setInput(e.target.value)} disabled={!ready}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={ready === false ? 'Hive AI isn’t available on this server yet' : funnel ? `Ask Hive to change “${funnel.name}”, add a page, an offer or an automation…` : 'Describe your business, or what you want to build…'} />
            {busy ? <button type="button" className="btn ghost" onClick={() => abort.current?.abort()}><Square size={14} /> Stop</button>
              : <button className="btn primary" disabled={!input.trim() || !ready}><Send size={15} /> Send</button>}
          </form>
        </section>

        <section className="hv-prev">
          <div className="hv-prev-h">
            {funnel ? <>
              <div className="hv-steps">{funnel.steps.map((s) => <button key={s.id} className={s.id === step?.id ? 'on' : ''} onClick={() => setStepId(s.id)}>{s.name}</button>)}</div>
              <div className="seg sm">
                <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} title="Desktop"><Monitor size={14} /></button>
                <button className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')} title="Phone"><Smartphone size={14} /></button>
              </div>
              <Link className="btn ghost sm" to={`/funnels/${funnel.id}`}><Pencil size={13} /> Edit</Link>
              <a className="btn ghost sm" href={`/f/${funnel.slug}${step ? `/${step.slug}` : ''}${funnel.published ? '' : '?preview=1'}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {funnel.published ? 'Live' : 'Preview'}</a>
            </> : <span className="muted sm">The funnel Hive builds or edits shows up here, live.</span>}
          </div>
          <div className="hv-canvas">
            {funnel && step ? (
              <div className={`hv-frame ${device}`}><Page key={`${step.id}-${funnel.version}`} blocks={step.blocks} theme={funnel.theme} ctx={{ live: false }} /></div>
            ) : (
              <div className="hv-blank"><Eye size={30} /><b>Nothing to preview yet</b><span>Start by telling Hive what you sell.</span></div>
            )}
          </div>
        </section>

        <nav className="hv-mobtabs">
          <button className={mob === 'chat' ? 'on' : ''} onClick={() => setMob('chat')}><MessageSquare size={16} /> Chat</button>
          <button className={mob === 'preview' ? 'on' : ''} onClick={() => setMob('preview')}><Eye size={16} /> Preview{funnel ? '' : ''}</button>
        </nav>
      </div>
    </Layout>
  );
}
