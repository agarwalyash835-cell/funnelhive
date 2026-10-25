// Hive AI — chat on the left, the funnel being built on the right ("Lovable for funnels")
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sparkles, Square, Plus, Trash2, Check, X, Loader2, Monitor, Smartphone, ExternalLink, PanelLeft, MessageSquare, Eye, Pencil, ArrowUp, Rocket, Presentation, GraduationCap, Workflow } from 'lucide-react';
import { api } from '../api';
import { Layout, toast, ago, confirmDialog, loadFailed } from '../ui';
import { Page } from '../blocks';

const SUGGESTIONS = [
  { icon: Rocket, title: 'Sales funnel', text: 'Build a funnel for my home bakery in Pune — custom birthday cakes from ₹899' },
  { icon: Presentation, title: 'Webinar funnel', text: 'Create a webinar funnel for my stock-market course at ₹2,999 with a ₹499 upsell' },
  { icon: GraduationCap, title: 'Online course', text: 'Create a 6-lesson course on Instagram Reels for coaches, with a quiz and a certificate' },
  { icon: Workflow, title: 'Follow-ups', text: 'Add an abandoned-checkout automation: email after 30 minutes, WhatsApp next morning at 10' },
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

// what Hive is doing right now, in plain words (the step names stay the same; only the live line is friendlier)
const DOING = {
  create_funnel: 'Building your funnel', create_funnel_from_template: 'Setting up the template', create_website: 'Building your website', duplicate_funnel: 'Copying the funnel',
  get_funnel: 'Looking at your funnel', get_page: 'Reading the page', list_funnels: 'Looking at your funnels', list_templates: 'Browsing templates',
  update_section: 'Updating the page', add_section: 'Adding a section', remove_section: 'Removing a section', move_section: 'Rearranging the page', replace_page: 'Rewriting the page',
  add_step: 'Adding a page', remove_step: 'Removing a page', reorder_steps: 'Reordering pages', update_funnel: 'Updating the funnel', publish_funnel: 'Getting it ready to go live',
  write_marketing_copy: 'Writing your copy', generate_image: 'Creating your image', configure_checkout: 'Setting up checkout', create_product: 'Creating your product', list_products: 'Checking your products',
  create_coupon: 'Creating your coupon', split_test: 'Setting up the A/B test', get_sales: 'Checking your sales', get_analytics: 'Checking your traffic', ads_report: 'Reading your ad results',
  create_automation: 'Writing your follow-ups', update_automation: 'Updating the automation', find_contacts: 'Finding contacts', tag_contacts: 'Tagging contacts', draft_broadcast: 'Drafting your broadcast',
  configure_calendar: 'Setting up your calendar', configure_webinar: 'Setting up your webinar', create_quote: 'Preparing your quote', create_course: 'Writing your course', add_quiz: 'Writing the quiz',
  setup_crm: 'Setting up your CRM', create_pipeline: 'Creating your pipeline', connect_domain: 'Connecting your domain', run_app_action: 'Working in your ads account', find_app_actions: 'Checking your ads account',
};
const LONG = new Set(['create_funnel', 'create_website', 'create_course', 'generate_image']);
const MAGIC = ['Working the magic ✨', 'Genie under way 🧞', 'Brewing something good ☕', 'Polishing the pixels', 'Teaching your page to sell', 'Lining up the details', 'Sprinkling some conversion dust', 'Almost there…'];
function LiveStatus({ tools }) {
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 3200); return () => clearInterval(t); }, []);
  const run = [...tools].reverse().find((t) => t.status === 'running');
  const doing = run ? DOING[run.name] || 'Working on it' : tools.length ? 'Putting it all together' : 'Thinking it through';
  return (
    <span className="hv-typing" aria-live="polite">
      <i /><i /><i /> <b>{doing}…</b> <span className="hv-magic" key={n}>{MAGIC[n % MAGIC.length]}</span>
      {run && LONG.has(run.name) && <small className="hv-long">Big job — usually about a minute</small>}
    </span>
  );
}

// an action Hive proposed that waits for the seller (sending, publishing, deleting…): Confirm / Cancel
const waiting = (t) => t.pending && !t.resolved;
const ToolChips = ({ tools, onDecide, deciding }) => (tools?.length ? (
  <ul className="hv-tools">{tools.map((t, i) => (
    <li key={t.id || i} className={waiting(t) ? 'confirm' : t.resolved === 'cancelled' ? 'cancelled' : t.status === 'confirm' ? 'confirm' : t.status || (t.ok === false ? 'error' : 'done')}>
      {t.status === 'running' ? <Loader2 size={13} className="spin-i" /> : t.ok === false || t.status === 'error' || t.resolved === 'cancelled' ? <X size={13} /> : waiting(t) ? <Square size={13} /> : <Check size={13} />}
      <span>{t.summary || (t.status === 'running' && DOING[t.name] ? `${DOING[t.name]}…` : t.label || t.name)}</span>
      {waiting(t) && onDecide && (
        <span className="hv-ok">
          <button className="btn sm primary" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, true)}>Confirm</button>
          <button className="btn sm" disabled={deciding === t.pending} onClick={() => onDecide(t.pending, false)}>Cancel</button>
        </span>
      )}
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
  const [deciding, setDeciding] = useState(null);
  const endRef = useRef(null);
  const boxRef = useRef(null);
  const [first, setFirst] = useState('');
  useEffect(() => { api('/me').then((m) => setFirst(String(m?.name || '').trim().split(/\s+/)[0] || '')).catch(() => {}); }, []);
  // the box grows with what's typed (up to ~8 lines)
  useEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = 'auto'; b.style.height = `${Math.min(220, b.scrollHeight)}px`; }, [input]);

  const loadThreads = () => api('/hive/threads').then(setThreads).catch(() => {});
  useEffect(() => { api('/hive/status').then(setStatus).catch(loadFailed); loadThreads(); }, []);
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
  // the seller confirms (or cancels) an action Hive proposed
  const decide = async (pendingId, ok) => {
    if (deciding) return;
    setDeciding(pendingId);
    try {
      const r = await api(`/hive/threads/${tid}/confirm`, 'POST', { pendingId, ok });
      setMsgs((m) => [...m.map((x) => (x.tools ? { ...x, tools: x.tools.map((t) => (t.pending === pendingId ? { ...t, resolved: r.cancelled ? 'cancelled' : r.ok ? 'done' : 'error', summary: r.summary, ok: r.ok } : t)) } : x)), { role: 'assistant', text: r.summary, error: !r.ok, at: Date.now() }]);
      if (r.funnelId && r.funnelId !== funnelId) setFunnelId(r.funnelId); else loadFunnel(funnelId);
    } catch (e) { toast(e.message); }
    setDeciding(null);
  };
  const removeThread = async (id) => { if (!await confirmDialog({ title: 'Delete this chat?', text: 'Funnels it built are kept.', confirm: 'Delete', danger: true })) return; await api(`/hive/threads/${id}`, 'DELETE'); if (id === tid) openThread(null); loadThreads(); };

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
  // a question asked from elsewhere in the app (e.g. the CRM's Ask Hive bar): /hive?ask=…
  const [params, setParams] = useSearchParams();
  const asked = useRef(false);
  useEffect(() => {
    const q = params.get('ask');
    if (!status || !q || asked.current) return;
    asked.current = true; setParams({}, { replace: true });
    if (ready) send(q); else setInput(q);
  }, [status]);
  const empty = !msgs.length && !live;
  const composer = (
    <form className="hv-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea ref={boxRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} disabled={!ready}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        placeholder={ready === false ? 'Hive AI isn’t switched on yet' : funnel ? `Ask Hive to change “${funnel.name}”, add a page, an offer or an automation…` : 'Describe your business, or what you want to build…'} />
      <div className="hv-input-bar">
        <span className="hv-hint">{busy ? 'Hive is working…' : 'Enter to send · Shift + Enter for a new line'}</span>
        {busy ? <button type="button" className="hv-stop" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={13} /> Stop</button>
          : <button className="hv-send" disabled={!input.trim() || !ready} aria-label="Send"><ArrowUp size={18} /></button>}
      </div>
    </form>
  );

  return (
    <Layout title={<span className="hv-title"><Sparkles size={20} /> Hive AI</span>} subtitle="Describe it — Hive builds the funnel, pages, offers and automations while you watch." wide>
      <div className={`hive ${side ? '' : 'no-side'} ${funnel ? 'with-prev' : 'no-prev'} ${empty ? 'is-empty' : ''} mob-${mob}`}>
        <aside className="hv-threads">
          <button className="hv-new" onClick={() => openThread(null)} disabled={busy}><Plus size={15} /> New chat</button>
          {threads.length > 0 && <small className="hv-tlabel">Recent</small>}
          <div className="hv-tlist">
            {threads.map((t) => (
              <div key={t.id} className={`hv-t ${t.id === tid ? 'on' : ''}`} onClick={() => openThread(t.id)}>
                <MessageSquare size={14} /><span title={t.title}>{t.title}</span><small>{ago(t.updatedAt)}</small>
                <button className="icon-btn xs" title="Delete chat" aria-label="Delete chat" onClick={(e) => { e.stopPropagation(); removeThread(t.id); }}><Trash2 size={12} /></button>
              </div>
            ))}
            {!threads.length && <p className="hv-tnone">Your chats with Hive appear here.</p>}
          </div>
        </aside>

        <section className="hv-chat">
          <div className="hv-chat-h">
            <button className="icon-btn" title={side ? 'Hide chats' : 'Show chats'} aria-label={side ? 'Hide chats' : 'Show chats'} onClick={() => setSide(!side)}><PanelLeft size={17} /></button>
            <b>{threads.find((t) => t.id === tid)?.title || 'New chat'}</b>
            {status?.provider && <span className="hv-prov" title="Only you (the platform owner) see this">{status.provider}</span>}
            <span className={`hv-state ${ready ? 'on' : ''}`}><i />{ready ? 'Hive AI' : 'Offline'}</span>
          </div>
          <div className="hv-msgs">
            {empty && (
              <div className="hv-empty">
                <span className="hv-orb" aria-hidden="true"><Sparkles size={28} /></span>
                <h2>{first ? `Hi ${first}, what are we building today?` : 'What are we building today?'}</h2>
                <p>Describe your business in a sentence. Hive builds the whole funnel — pages, checkout, upsells, course, follow-ups — and changes anything you ask.</p>
                {ready === false && <p className="hv-warn">Hive AI isn’t switched on yet — check back soon.</p>}
                {composer}
                <div className="hv-sugg">{SUGGESTIONS.map((x) => (
                  <button key={x.title} onClick={() => send(x.text)} disabled={!ready}>
                    <span className="hv-sugg-ic"><x.icon size={16} /></span>
                    <b>{x.title}</b>
                    <small>{x.text}</small>
                  </button>
                ))}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`hv-msg ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'assistant' && <span className="hv-av"><Sparkles size={14} /></span>}
                <div className="hv-bub">{m.role === 'assistant' ? <><ToolChips tools={m.tools} onDecide={busy ? null : decide} deciding={deciding} /><Rich text={m.text} /></> : m.text}</div>
              </div>
            ))}
            {live && (
              <div className="hv-msg assistant live">
                <span className="hv-av"><Sparkles size={14} /></span>
                <div className="hv-bub">
                  {live.thinking && <Rich text={live.thinking} />}
                  <ToolChips tools={live.tools} />
                  <LiveStatus tools={live.tools} />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          {!empty && <div className="hv-dock">{composer}</div>}
        </section>

        <section className="hv-prev">
          <div className="hv-prev-h">
            {funnel ? <>
              <div className="hv-steps">{funnel.steps.map((s) => <button key={s.id} className={s.id === step?.id ? 'on' : ''} onClick={() => setStepId(s.id)}>{s.name}</button>)}</div>
              <div className="seg sm">
                <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} title="Desktop" aria-label="Desktop"><Monitor size={14} /></button>
                <button className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')} title="Phone" aria-label="Phone"><Smartphone size={14} /></button>
              </div>
              <Link className="btn ghost sm" to={`/funnels/${funnel.id}`}><Pencil size={13} /> Edit</Link>
              <a className="btn ghost sm" href={`/f/${funnel.slug}${step ? `/${step.slug}` : ''}${funnel.published ? '' : `?preview=1&pv=${funnel.previewKey || ''}`}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {funnel.published ? 'Live' : 'Preview'}</a>
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
