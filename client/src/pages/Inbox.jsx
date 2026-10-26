import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Layout, Icon, Modal, toast } from '../ui';
import '../chat.css';

// /inbox/:id? — every WhatsApp conversation in one place: the team replies, chatbots and the AI agent work
// alongside, and AI suggests replies, rewrites drafts and sums a chat up. Refreshes itself every few seconds.
const FILTERS = [['all', 'Open'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['bots', 'Bots & AI'], ['resolved', 'Resolved']];
const REWRITE = [['polish', 'Fix grammar & polish'], ['friendly', 'Make it friendlier'], ['formal', 'Make it professional'], ['shorter', 'Make it shorter'], ['hinglish', 'Hinglish'], ['hindi', 'Hindi (देवनागरी)'], ['english', 'English']];
const HUES = ['#16a34a', '#0d9488', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#ea580c', '#ca8a04'];
const hue = (s) => HUES[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];
const initials = (c) => (c.name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';
export const Avatar = ({ c, sm, dot }) => <span className={`cav ${sm ? 'sm' : ''}`} style={{ background: `linear-gradient(135deg, ${hue(c.num || c.name)}, ${hue(`${c.num}x`)})` }}>{initials(c)}{dot != null && <i className={`cdot ${dot ? '' : 'off'}`} />}</span>;
const clock = (t) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const short = (t) => { const d = new Date(t), now = new Date(); if (d.toDateString() === now.toDateString()) return clock(t); const y = new Date(now - 86400000); if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const dayOf = (t) => { const d = new Date(t), now = new Date(); if (d.toDateString() === now.toDateString()) return 'Today'; if (d.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday'; return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
const left = (t) => { const m = Math.max(0, Math.round((t - Date.now()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const WHO = { contact: '', team: 'You', app: 'You · WhatsApp app', bot: 'Chatbot', ai: 'AI' };
const display = (c) => c.name || `+${c.num}`;
// WhatsApp's own formatting: *bold*, _italic_, ~strike~, and links
export const waFmt = (s) => String(s || '').split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/[^\s<]+)/g).map((p, i) => (
  /^\*[^*]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : /^_[^_]+_$/.test(p) ? <i key={i}>{p.slice(1, -1)}</i> : /^~[^~]+~$/.test(p) ? <s key={i}>{p.slice(1, -1)}</s>
    : /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" style={{ color: '#0e7490', textDecoration: 'underline' }}>{p}</a> : p));

// polls while the tab is visible
function useEvery(fn, ms, deps) {
  useEffect(() => {
    fn();
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function Inbox() {
  const { id } = useParams();
  const nav = useNavigate();
  const [meta, setMeta] = useState(null);
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const wideScreen = () => typeof window !== 'undefined' && window.innerWidth >= 1500;
  const [side, setSide] = useState(() => { try { return wideScreen() && localStorage.getItem('ff_ib_side') !== '0'; } catch { return wideScreen(); } });
  // the inbox fills the window below whatever banners are showing
  const shell = useRef();
  useLayoutEffect(() => {
    const fit = () => { const el = shell.current; if (el) el.style.setProperty('--ib-h', `${Math.max(520, window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 20)}px`); };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
  const [startOpen, setStartOpen] = useState(false);
  const loadMeta = () => api('/inbox/meta').then(setMeta).catch(() => {});
  useEffect(() => { loadMeta(); }, []);
  const loadList = () => api(`/inbox?filter=${filter}&q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => {});
  useEvery(loadList, 5000, [filter, q]);
  const toggleSide = () => { setSide(!side); if (wideScreen()) try { localStorage.setItem('ff_ib_side', side ? '0' : '1'); } catch {} };
  const connected = meta ? meta.connected : true;
  return (
    <Layout wide title="Inbox" subtitle="Every WhatsApp chat in one place — your team, chatbots and the AI agent working together." actions={<>
      <Link className="btn ghost sm" to="/chatbots"><Icon name="bot" size={15} />Chatbots &amp; AI agent</Link>
      {connected && <button className="btn primary sm" onClick={() => setStartOpen(true)}><Icon name="plus" size={15} />New chat</button>}
    </>}>
      {!connected ? <NotConnected /> : (
        <div ref={shell} className={`ib ${side && id ? '' : 'no-side'} ${id ? 'has-conv' : ''}`}>
          <aside className="ib-list">
            <div className="ib-lh">
              <div className="ib-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or message" /></div>
              <div className="ib-filters" role="tablist">
                {FILTERS.map(([k, label]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}{list?.counts?.[k] > 0 && <i>{list.counts[k]}</i>}</button>)}
              </div>
            </div>
            <div className="ib-convs">
              {!list ? [0, 1, 2, 3].map((i) => <div key={i} className="ib-skel" />) : !list.convs.length ? (
                <div className="ib-empty"><Icon name="chat" size={26} /><p className="sm">{q ? 'No chats match your search.' : filter === 'all' ? 'No open chats — new WhatsApp messages land here.' : 'Nothing here right now.'}</p></div>
              ) : list.convs.map((c) => (
                <button key={c.id} className={`ib-conv ${c.id === id ? 'on' : ''} ${c.unread ? 'unread' : ''}`} onClick={() => nav(`/inbox/${c.id}`)}>
                  <Avatar c={c} dot={c.window.open} />
                  <div>
                    <div className="t1"><b>{display(c)}</b><time>{short(c.lastAt)}</time></div>
                    <div className="t2"><span>{c.lastDir === 'out' && `${c.lastBy === 'ai' ? '✨ ' : c.lastBy === 'bot' ? '🤖 ' : 'You: '}`}{c.lastText || '…'}</span>{c.unread > 0 && <em className="ib-n">{c.unread}</em>}</div>
                    {(c.ai || c.bot || c.labels.length > 0 || (c.human && c.handoff)) && <div className="t3">
                      {c.ai && <span className="ai-chip"><Icon name="sparkles" size={11} />AI replying</span>}
                      {c.bot && <span className="bot-chip"><Icon name="bot" size={11} />{c.bot.name}</span>}
                      {c.human && c.handoff && c.status !== 'resolved' && <span className="pill warn">Needs you</span>}
                      {c.labels.slice(0, 2).map((l) => <span key={l} className="tag">{l}</span>)}
                    </div>}
                  </div>
                </button>
              ))}
            </div>
          </aside>
          {id ? <Thread key={id} id={id} meta={meta} onChange={loadList} onBack={() => nav('/inbox')} side={side} toggleSide={toggleSide} /> : (
            <section className="ib-thread"><div className="ib-empty"><span className="orb"><Icon name="chat" size={38} /></span><h3>Pick a chat</h3><p className="sm">Reply yourself, hand it to the AI agent, or let a chatbot take care of it.<br />{meta?.agent?.on ? <>Your AI agent <b className="ai-txt">{meta.agent.name}</b> is answering new chats.</> : <Link to="/chatbots?tab=agent" className="ai-txt">Switch on the AI agent →</Link>}</p></div></section>
          )}
        </div>
      )}
      {startOpen && <StartChat onClose={() => setStartOpen(false)} onDone={(cid) => { setStartOpen(false); loadList(); nav(`/inbox/${cid}`); }} />}
    </Layout>
  );
}

function NotConnected() {
  return (
    <div className="ib" style={{ gridTemplateColumns: '1fr' }}>
      <div className="ib-empty">
        <span className="orb"><Icon name="chat" size={38} /></span>
        <h3>Connect your WhatsApp number</h3>
        <p className="sm" style={{ maxWidth: 440 }}>The inbox, chatbots and the AI agent work on your Hive WhatsApp API number. Add your API key in Settings → Channels → Hive WhatsApp, and connect the webhook — messages start arriving here straight away.</p>
        <Link className="btn primary" to="/settings">Open Settings</Link>
      </div>
    </div>
  );
}

// ---------- one conversation ----------
function Thread({ id, meta, onChange, onBack, side, toggleSide }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const box = useRef();
  const atBottom = useRef(true);
  const lastCount = useRef(0);
  const load = (read) => api(`/inbox/${id}${read ? '?read=1' : ''}`).then((x) => { setD(x); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(true).then(onChange); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(document.hasFocus()); }, 3000);
    return () => clearInterval(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // stay pinned to the newest message unless the person scrolled up to read
  useEffect(() => {
    const n = d?.messages.length || 0;
    if (box.current && (atBottom.current || n !== lastCount.current) && (atBottom.current || lastCount.current === 0)) box.current.scrollTop = box.current.scrollHeight;
    lastCount.current = n;
  }, [d]);
  const patch = async (body) => { try { const r = await api(`/inbox/${id}`, 'PATCH', body); setD((x) => ({ ...x, conv: r.conv })); load(); onChange(); } catch (e) { toast(e.message); } };
  if (err) return <section className="ib-thread"><div className="ib-empty"><p>{err}</p><button className="btn ghost sm" onClick={onBack}>Back to the inbox</button></div></section>;
  if (!d) return <section className="ib-thread"><div className="ib-empty"><span className="spin dark" /></div></section>;
  const c = d.conv;
  const items = [];
  let day = '';
  for (const m of d.messages) {
    const dd = dayOf(m.at);
    if (dd !== day) { items.push(<div key={`d${m.at}`} className="ib-day">{dd}</div>); day = dd; }
    items.push(<Msg key={m.id} m={m} convId={id} agent={meta?.agent?.name} />);
  }
  return (
    <>
      <section className="ib-thread">
        <header className="ib-th">
          <button className="icon-btn ib-back" onClick={onBack} aria-label="Back"><Icon name="chevron" className="flip" /></button>
          <Avatar c={c} sm dot={c.window.open} />
          <div className="who"><b>{display(c)}</b><small>+{c.num}{c.window.open ? ` · window closes in ${left(c.window.closesAt)}` : ' · 24-hour window closed'}</small></div>
          <select value={c.assignee || ''} onChange={(e) => patch({ assignee: e.target.value || null })} aria-label="Assigned to">
            <option value="">Unassigned</option>
            {(meta?.team || []).map((p) => <option key={p.id} value={p.id}>{p.id === meta.me ? `${p.name} (you)` : p.name}</option>)}
          </select>
          {c.status === 'resolved' ? <button className="btn ghost sm" onClick={() => patch({ status: 'open' })}>Reopen</button> : <button className="btn live sm" onClick={() => patch({ status: 'resolved' })}><Icon name="check" size={14} />Resolve</button>}
          <button className="icon-btn" onClick={toggleSide} title={side ? 'Hide details' : 'Show details'} aria-label="Contact details"><Icon name="users" size={17} /></button>
        </header>
        {c.ai && <div className="ib-banner ai"><Icon name="sparkles" size={15} /><span><b>{meta?.agent?.name || 'The AI agent'}</b> is replying to this chat{c.intent ? ` · topic: ${c.intent}` : ''}</span><button className="btn ghost sm" onClick={() => patch({ ai: false })}>Take over</button></div>}
        {c.bot && <div className="ib-banner bot"><Icon name="bot" size={15} /><span>Chatbot <b>{c.bot.name}</b> is {c.bot.wait === 'time' ? 'waiting to send the next step' : 'waiting for an answer'}</span><button className="btn ghost sm" onClick={() => patch({ stopBot: true })}>Stop & take over</button></div>}
        {c.human && c.handoff && c.status !== 'resolved' && !c.ai && <div className="ib-banner hand"><Icon name="bell" size={15} /><span>Needs a person — {c.handoff.reason}</span>{meta?.agent?.on && <button className="btn ghost sm" onClick={() => patch({ ai: true })}><Icon name="sparkles" size={14} />Hand back to AI</button>}</div>}
        <div className="ib-msgs" ref={box} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {items}
        </div>
        <Composer c={c} contact={d.contact} meta={meta} onSent={() => { atBottom.current = true; load(); onChange(); }} patch={patch} />
      </section>
      {side && <Details c={c} contact={d.contact} meta={meta} patch={patch} onClose={toggleSide} onSummary={(s) => setD((x) => ({ ...x, conv: { ...x.conv, summary: s } }))} />}
    </>
  );
}

const Tick = ({ s }) => (s === 'read' ? <span className="read">✓✓</span> : s === 'delivered' ? <span>✓✓</span> : s === 'failed' ? <span className="fail">!</span> : s === 'sending' ? <span>◷</span> : <span>✓</span>);
function Msg({ m, convId, agent }) {
  if (m.dir === 'note') return <div className={`ib-note ${m.by === 'system' ? 'sys' : ''}`}>{m.by !== 'system' && <b>Note{m.author ? ` · ${m.author}` : ''}</b>}{m.text}</div>;
  const cls = m.dir === 'in' ? 'in' : `out ${m.by === 'bot' ? 'bot' : m.by === 'ai' ? 'ai' : ''}`;
  const by = m.dir === 'out' && (m.by === 'ai' ? <><Icon name="sparkles" size={11} /><span className="ai-txt">{agent || 'AI agent'}</span></> : m.by === 'bot' ? <><Icon name="bot" size={11} />Chatbot</> : m.author || WHO[m.by]);
  return (
    <div className={`bub ${cls}`}>
      {by && <div className="by">{by}{m.type === 'template' && <span className="pill" style={{ fontSize: 10 }}>template</span>}</div>}
      {m.media && <Media m={m} convId={convId} />}
      {m.text ? waFmt(m.text) : m.media ? '' : <span className="muted">(empty message)</span>}
      {(m.buttons?.length > 0 || m.list) && <div className="bub-btns">{(m.buttons || m.list.rows).map((b, i) => <span key={i}>{b}</span>)}</div>}
      {m.error && <div className="bub-err">Not delivered: {m.error}</div>}
      <div className="meta">{clock(m.at)}{m.dir === 'out' && <Tick s={m.status} />}</div>
    </div>
  );
}
// a customer's photo shows inline; other files download (fetched with the session, never a public link)
function Media({ m, convId }) {
  const [url, setUrl] = useState(m.media.link || '');
  const fetchIt = async () => {
    const r = await fetch(`/api/inbox/${convId}/media/${m.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('ff_token')}` } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Couldn’t open the file');
    return URL.createObjectURL(await r.blob());
  };
  useEffect(() => { if (m.media.type === 'image' && m.media.has && !url) fetchIt().then(setUrl).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (m.media.type === 'image' && url) return <a className="bub-media" href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.media.caption || 'Photo'} /></a>;
  const label = { image: '📷 Photo', video: '🎬 Video', audio: '🎤 Voice note', voice: '🎤 Voice note', document: `📄 ${m.media.filename || 'Document'}`, sticker: '🙂 Sticker' }[m.media.type] || 'File';
  const open = async () => { try { const u = await fetchIt(); const a = document.createElement('a'); a.href = u; a.download = m.media.filename || `whatsapp-${m.media.type}`; a.click(); } catch (e) { toast(e.message); } };
  return <button className="bub-file" onClick={open} disabled={!m.media.has}><Icon name="download" size={15} />{label}{m.media.caption && <span className="muted"> — {m.media.caption}</span>}</button>;
}

// ---------- writing a reply ----------
function Composer({ c, contact, meta, onSent, patch }) {
  const [mode, setMode] = useState('reply');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [sugs, setSugs] = useState(null);
  const [menu, setMenu] = useState('');
  const [qi, setQi] = useState(0);
  const [tpl, setTpl] = useState(false);
  const ta = useRef();
  const fileIn = useRef();
  useEffect(() => { setText(''); setSugs(null); setMode('reply'); }, [c.id]);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(160, el.scrollHeight)}px`; } }, [text]);
  const quick = (meta?.quick || []);
  const slash = mode === 'reply' && /^\/[\w-]*$/.test(text) ? quick.filter((x) => x.short.startsWith(text.slice(1).toLowerCase())) : [];
  const send = async (body) => {
    setBusy('send');
    try { await api(`/inbox/${c.id}/messages`, 'POST', body); setText(''); setSugs(null); onSent(); } catch (e) { toast(e.message); if (e.data?.window === false) setTpl(true); }
    setBusy('');
  };
  const submit = () => { const t = text.trim(); if (!t || busy) return; send(mode === 'note' ? { note: t } : { text: t }); };
  const key = (e) => {
    if (slash.length && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) { e.preventDefault(); setQi((i) => (e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(slash.length - 1, i + 1))); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (slash.length) setText(slash[Math.min(qi, slash.length - 1)].text); else submit(); }
  };
  const suggest = async () => { setBusy('sug'); setSugs([]); try { setSugs((await api(`/inbox/${c.id}/ai/suggest`, 'POST')).suggestions); } catch (e) { toast(e.message); setSugs(null); } setBusy(''); };
  const rewrite = async (m) => { setMenu(''); setBusy('rw'); try { setText((await api('/inbox/ai/rewrite', 'POST', { text, mode: m })).text); } catch (e) { toast(e.message); } setBusy(''); };
  const attach = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('Send a photo (JPG, PNG or WebP)');
    setBusy('send');
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      const up = await api('/uploads', 'POST', { type: file.type, data });
      await api(`/inbox/${c.id}/messages`, 'POST', { image: new URL(up.url, location.origin).href, text: text.trim() });
      setText(''); onSent();
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const [bots, setBots] = useState(null);
  const runBot = async () => {
    setMenu('');
    const flows = (await api('/waflows').catch(() => ({ flows: [] }))).flows;
    if (!flows.length) return toast('Make a chatbot first (Chatbots → New chatbot)');
    setBots(flows);
  };
  const startBot = async (f) => { setBots(null); try { await api(`/inbox/${c.id}/bot`, 'POST', { flowId: f.id }); onSent(); toast(`“${f.name}” started`); } catch (e) { toast(e.message); } };
  if (contact.optedOut) return <div className="ib-comp"><div className="ib-closed"><p>This contact unsubscribed from your WhatsApp messages (they replied STOP). You can still add notes.</p></div></div>;
  const closed = !c.window.open && mode === 'reply';
  return (
    <div className={`ib-comp ${mode === 'note' ? 'note' : ''}`}>
      {bots && <Modal title="Run a chatbot on this chat" onClose={() => setBots(null)} width={480}><div style={{ display: 'grid', gap: 8 }}>{bots.map((f) => <button key={f.id} className="cb-card click" onClick={() => startBot(f)}><b>{f.name}</b><small>{f.problems.length ? `Needs fixing: ${f.problems[0].msg}` : f.trigger.type === 'manual' ? 'Started by hand' : f.active ? 'Live' : 'Off'}</small></button>)}</div></Modal>}
      {slash.length > 0 && <div className="ib-pop">{slash.map((x, i) => <button key={x.id} className={i === qi ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); setText(x.text); }}><b>/{x.short}</b><small>{x.text}</small></button>)}</div>}
      {sugs && <div className="ib-sugs">{!sugs.length ? <span className="ai-chip"><span className="spin" style={{ width: 11, height: 11 }} />Thinking of replies…</span> : sugs.map((s, i) => <button key={i} className="ib-sug" onClick={() => { setText(s); setSugs(null); ta.current?.focus(); }}>{s}</button>)}{sugs.length > 0 && <button className="icon-btn xs" onClick={() => setSugs(null)} aria-label="Hide suggestions"><Icon name="x" size={12} /></button>}</div>}
      <div className="ib-ctabs">
        <button className={mode === 'reply' ? 'on' : ''} onClick={() => setMode('reply')}>Reply</button>
        <button className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Internal note</button>
        <span className={`ib-win ${c.window.open ? 'ok' : ''}`}>{c.window.open ? `Free replies for ${left(c.window.closesAt)}` : 'Window closed — templates only'}</span>
      </div>
      {closed || tpl ? (
        <div className="ib-closed">
          <p>It’s been more than 24 hours since {display(c)} last wrote, so WhatsApp only allows an approved template. Once they reply, you can chat freely again.</p>
          <TemplateSend convId={c.id} onSent={() => { setTpl(false); onSent(); }} />
          {c.window.open && <button className="btn ghost sm" onClick={() => setTpl(false)}>Back to typing</button>}
        </div>
      ) : (
        <>
          <div className="ib-input">
            <textarea ref={ta} rows={1} value={text} onChange={(e) => { setText(e.target.value); setQi(0); }} onKeyDown={key} placeholder={mode === 'note' ? 'A note only your team sees…' : 'Type a reply…  ( / for quick replies)'} disabled={busy === 'rw'} />
            <button className="ib-send" onClick={submit} disabled={!text.trim() || !!busy} aria-label="Send" style={mode === 'note' ? { background: '#ca8a04' } : undefined}>{busy === 'send' ? <span className="spin" /> : <Icon name={mode === 'note' ? 'check' : 'send'} size={18} />}</button>
          </div>
          {mode === 'reply' && (
            <div className="ib-tools" style={{ position: 'relative' }}>
              {meta?.ai && <button className="btn ai sm" onClick={suggest} disabled={busy === 'sug'}><Icon name="sparkles" size={14} />Suggest replies</button>}
              {meta?.ai && <button className="btn ghost sm" onClick={() => setMenu(menu === 'rw' ? '' : 'rw')} disabled={!text.trim() || busy === 'rw'}>{busy === 'rw' ? <span className="spin dark" /> : <Icon name="wand" size={14} />}Rewrite</button>}
              <button className="icon-btn" title="Send a photo" onClick={() => fileIn.current?.click()}><Icon name="image" size={16} /></button>
              <input ref={fileIn} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { attach(e.target.files[0]); e.target.value = ''; }} />
              <button className="icon-btn" title="Quick replies" onClick={() => setMenu(menu === 'quick' ? '' : 'quick')}><Icon name="bolt" size={16} /></button>
              <button className="icon-btn" title="More" onClick={() => setMenu(menu === 'more' ? '' : 'more')}><Icon name="menu" size={16} /></button>
              {menu === 'rw' && <div className="ib-menu" style={{ left: 120 }}>{REWRITE.map(([k, l]) => <button key={k} onClick={() => rewrite(k)}>{l}</button>)}</div>}
              {menu === 'quick' && <QuickMenu quick={quick} meta={meta} onPick={(t) => { setText(t); setMenu(''); }} />}
              {menu === 'more' && <div className="ib-menu" style={{ left: 200 }}>
                <button onClick={() => { setMenu(''); setTpl(true); }}><Icon name="mail" size={15} />Send a template</button>
                <button onClick={runBot}><Icon name="bot" size={15} />Run a chatbot here</button>
                {meta?.agent?.on && !c.ai && <button onClick={() => { setMenu(''); patch({ ai: true }); }}><Icon name="sparkles" size={15} />Hand this chat to the AI</button>}
              </div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuickMenu({ quick, meta, onPick }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="ib-menu" style={{ left: 160, width: 320, maxHeight: 320, overflowY: 'auto' }}>
      {quick.map((x) => <button key={x.id} onClick={() => onPick(x.text)} style={{ display: 'grid' }}><b>/{x.short}</b><small className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.text}</small></button>)}
      {!quick.length && <p className="hint" style={{ padding: '4px 10px' }}>Save answers you send often, then type “/” and their shortcut.</p>}
      <button onClick={() => setEdit(true)}><Icon name="edit" size={14} />Manage quick replies</button>
      {edit && <QuickEditor quick={quick} meta={meta} onClose={() => setEdit(false)} />}
    </div>
  );
}
function QuickEditor({ quick, meta, onClose }) {
  const [list, setList] = useState(quick.length ? quick : [{ short: 'price', text: '' }]);
  const save = async () => { try { const r = await api('/inbox/quick', 'PUT', { quick: list }); meta.quick = r.quick; toast('Quick replies saved'); onClose(); } catch (e) { toast(e.message); } };
  const set = (i, k, v) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Modal title="Quick replies" onClose={onClose} width={620}>
      <p className="hint top">Type “/” and the shortcut in the reply box to drop the text in. Use them for prices, addresses, payment details, timings.</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {list.map((x, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: 6 }}>
            <input value={x.short} onChange={(e) => set(i, 'short', e.target.value)} placeholder="shortcut" />
            <textarea rows={2} value={x.text} onChange={(e) => set(i, 'text', e.target.value)} placeholder="The message" />
            <button className="icon-btn danger" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn ghost sm" onClick={() => setList([...list, { short: '', text: '' }])}><Icon name="plus" size={14} />Add</button><span style={{ flex: 1 }} /><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  );
}

// an approved template, with its variables filled in (the first one defaults to the contact's first name)
function TemplateSend({ convId, phone, name, onSent }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState(null);
  const [vals, setVals] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/inbox/templates').then((r) => setList(r.templates)).catch((e) => { setList([]); toast(e.message); }); }, []);
  const choose = (n) => { const t = list.find((x) => x.name === n) || null; setPick(t); setVals(Array.from({ length: t?.vars || 0 }, (_, i) => (i === 0 && name ? name.split(' ')[0] : ''))); };
  const preview = pick ? pick.body.replace(/\{\{(\d+)\}\}/g, (m, k) => vals[k - 1] || m) : '';
  const go = async () => {
    setBusy(true);
    try {
      const body = { template: pick.name, language: pick.language, params: vals, preview };
      const r = convId ? await api(`/inbox/${convId}/messages`, 'POST', body) : await api('/inbox/start', 'POST', { ...body, phone, name });
      onSent(r.id);
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  if (!list) return <span className="spin dark" />;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <select value={pick?.name || ''} onChange={(e) => choose(e.target.value)}><option value="">{list.length ? 'Choose an approved template…' : 'No approved templates yet — create one in Settings → Channels'}</option>{list.map((t) => <option key={`${t.name}${t.language}`} value={t.name}>{t.name} · {t.category.toLowerCase()}</option>)}</select>
      {pick && <>
        {vals.map((v, i) => <input key={i} value={v} onChange={(e) => setVals(vals.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Value for {{${i + 1}}}`} />)}
        <div className="bub out" style={{ alignSelf: 'stretch', maxWidth: '100%' }}>{preview}</div>
        <button className="btn primary sm" onClick={go} disabled={busy || vals.some((v) => !v.trim())}>{busy ? <span className="spin" /> : <Icon name="send" size={14} />}Send template</button>
      </>}
    </div>
  );
}
function StartChat({ onClose, onDone }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  return (
    <Modal title="Start a WhatsApp chat" onClose={onClose} width={520}>
      <p className="hint top">WhatsApp lets a business write first only with an approved template. When they reply, you can chat freely for 24 hours.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="sm strong">WhatsApp number<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
        <label className="sm strong">Name (optional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" /></label>
        {phone.replace(/\D/g, '').length >= 10 && <TemplateSend phone={phone} name={name} onSent={onDone} />}
      </div>
    </Modal>
  );
}

// ---------- the right-hand panel: the contact, labels, AI insights ----------
function Details({ c, contact, meta, patch, onClose, onSummary }) {
  const [busy, setBusy] = useState(false);
  const [lab, setLab] = useState('');
  const sum = c.summary;
  const summarise = async () => { setBusy(true); try { onSummary((await api(`/inbox/${c.id}/ai/summary`, 'POST')).summary); } catch (e) { toast(e.message); } setBusy(false); };
  const addLabel = (e) => { e.preventDefault(); const l = lab.trim(); if (l) patch({ labels: [...c.labels, l] }); setLab(''); };
  const known = useMemo(() => (meta?.labels || []).filter((l) => !c.labels.includes(l)), [meta, c.labels]);
  return (
    <aside className="ib-side">
      <button className="icon-btn" style={{ justifySelf: 'end', marginBottom: -12 }} onClick={onClose} aria-label="Close details"><Icon name="x" size={15} /></button>
      <div className="ib-prof">
        <Avatar c={c} />
        <b>{contact.name || display(c)}</b>
        <small>{contact.phone}</small>
        {contact.key && <Link className="btn ghost sm" to={`/contacts/${encodeURIComponent(contact.key)}`}><Icon name="external" size={13} />Open in CRM</Link>}
      </div>
      <div className="ib-card">
        <h4><Icon name="sparkles" size={12} />AI insights{meta?.ai && <button className="btn ghost sm" onClick={summarise} disabled={busy}>{busy ? <span className="spin dark" /> : sum ? 'Refresh' : 'Summarise'}</button>}</h4>
        {sum ? (
          <div className="ib-ai">
            <div className="row"><span className={`temp ${sum.temperature}`}>{sum.temperature} lead</span><span className="pill">{sum.sentiment}</span>{sum.intent && <span className="pill">{sum.intent}</span>}</div>
            <p>{sum.text}</p>
            {sum.next && <p><b>Next step:</b> {sum.next}</p>}
          </div>
        ) : <p className="hint" style={{ margin: 0 }}>{meta?.ai ? 'Get a quick read of this chat: what they want, how hot the lead is, and what to do next.' : 'AI isn’t switched on for this account.'}</p>}
      </div>
      <div className="ib-card">
        <h4>Details</h4>
        <div className="ib-kv"><span>Email</span><b>{contact.email || '—'}</b><span>Status</span><b style={{ textTransform: 'capitalize' }}>{c.status}</b>{contact.tags.length > 0 && <><span>Tags</span><b>{contact.tags.join(', ')}</b></>}</div>
      </div>
      <div className="ib-card">
        <h4>Labels</h4>
        <form className="ib-tags" onSubmit={addLabel}>
          {c.labels.map((l) => <span key={l} className="lab">{l}<button type="button" onClick={() => patch({ labels: c.labels.filter((x) => x !== l) })} aria-label={`Remove ${l}`}>×</button></span>)}
          <input list="ib-labels" value={lab} onChange={(e) => setLab(e.target.value)} placeholder="+ label" />
          <datalist id="ib-labels">{known.map((l) => <option key={l} value={l} />)}</datalist>
        </form>
      </div>
      {contact.notes.length > 0 && <div className="ib-card"><h4>From the CRM</h4>{contact.notes.map((n, i) => <p key={i} className="sm" style={{ margin: 0 }}><b>{n.title}</b>{n.text && <><br /><span className="muted">{n.text}</span></>}</p>)}</div>}
    </aside>
  );
}
