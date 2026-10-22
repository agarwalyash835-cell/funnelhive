// The student's members area ("school"): /learn/<handle>/… — sign in with an emailed code, take courses
// (resume, quizzes, questions, AI tutor, certificates) and join the community (spaces, posts, likes, levels).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { videoSource } from '../blocks';
import { alertDialog, confirmDialog } from '../ui';
import '../learn.css';

// ---------- helpers ----------
const tokenKey = (h) => `ff_learn_${h}`;
const getTok = (h) => { try { return localStorage.getItem(tokenKey(h)) || ''; } catch { return ''; } };
const setTok = (h, t) => { try { if (t) localStorage.setItem(tokenKey(h), t); else localStorage.removeItem(tokenKey(h)); } catch {} };
function useApi(handle, onSignedOut) {
  return useCallback(async (path, method = 'GET', body) => {
    let r;
    try {
      r = await fetch(`/api/learn/${handle}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Student': getTok(handle) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Network problem — check your connection and try again'); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && d.signin) { setTok(handle, ''); onSignedOut?.(); }
    if (!r.ok) { const e = new Error(d.error || 'Something went wrong — please try again'); e.status = r.status; throw e; }
    return d;
  }, [handle]);
}
const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const linkify = (text) => String(text || '').split(/(https?:\/\/[^\s]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p));
const Avatar = ({ a, size = 36 }) => (
  <span className={`ln-av ${a?.kind === 'owner' ? 'own' : ''}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
    {a?.kind === 'owner' && a.logo ? <img src={a.logo} alt="" /> : a?.initials || '?'}
    {a?.level ? <i className="ln-lvl">{a.level}</i> : null}
  </span>
);
const Name = ({ a }) => <b className="ln-name">{a?.name}{a?.badge && <em className="ln-badge">{a.badge}</em>}</b>;
function Spinner() { return <span className="ln-spin" aria-label="Loading" />; }
function Empty({ icon, title, text, children }) { return <div className="ln-empty"><div className="ln-empty-ic">{icon}</div><h3>{title}</h3>{text && <p>{text}</p>}{children}</div>; }

// ---------- the installable app ----------
// Chrome / Android offer "install" once; we keep the offer for our own button
let installOffer = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installOffer = e; window.dispatchEvent(new Event('ff:installable')); });
}
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
const iOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
function useInstall() {
  const [can, setCan] = useState(() => !!installOffer);
  useEffect(() => { const h = () => setCan(true); window.addEventListener('ff:installable', h); return () => window.removeEventListener('ff:installable', h); }, []);
  if (standalone()) return null;
  if (can) return { kind: 'prompt', go: async () => { installOffer.prompt(); const r = await installOffer.userChoice.catch(() => null); if (r?.outcome === 'accepted') { installOffer = null; setCan(false); } } };
  if (iOS()) return { kind: 'ios' };
  return null;
}
// the school's own app identity: manifest, theme colour, home-screen icon; the service worker for fast, offline-aware loading
function useAppShell(handle, school) {
  useEffect(() => {
    if (!school) return;
    const put = (sel, make) => { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el); } return el; };
    put('link[rel="manifest"]', () => Object.assign(document.createElement('link'), { rel: 'manifest' })).href = `/api/learn/${handle}/manifest.webmanifest`;
    put('meta[name="theme-color"]', () => Object.assign(document.createElement('meta'), { name: 'theme-color' })).content = school.color || '#6366f1';
    put('link[rel="apple-touch-icon"]', () => Object.assign(document.createElement('link'), { rel: 'apple-touch-icon' })).href = school.logo || `/api/learn/${handle}/icon.svg`;
    put('meta[name="apple-mobile-web-app-capable"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-capable' })).content = 'yes';
    put('meta[name="apple-mobile-web-app-title"]', () => Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title' })).content = school.name;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/learn-sw.js', { scope: '/learn/' }).catch(() => {});
  }, [handle, school?.name, school?.color, school?.logo]);
}
function InstallBanner({ school }) {
  const install = useInstall();
  const key = 'ff_learn_install_hidden';
  const [hidden, setHidden] = useState(() => { try { return !!localStorage.getItem(key); } catch { return false; } });
  if (!install || hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(key, '1'); } catch {} };
  return (
    <div className="ln-install">
      <span className="ln-install-ic">📲</span>
      <div><b>Get the {school.name} app</b><small>{install.kind === 'ios' ? 'Tap the Share button, then “Add to Home Screen”.' : 'Open your courses in one tap, full screen.'}</small></div>
      {install.kind === 'prompt' && <button className="ln-btn sm" onClick={install.go}>Install</button>}
      <button className="ln-x" aria-label="Hide" onClick={hide}>×</button>
    </div>
  );
}

// ---------- the app ----------
export default function Learn() {
  const { handle, '*': rest = '' } = useParams();
  const nav = useNavigate();
  const [qs] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [signedIn, setSignedIn] = useState(() => !!getTok(handle));
  const [linking, setLinking] = useState(() => !!qs.get('t') && !getTok(handle)); // signing in from the emailed link
  const api = useApi(handle, () => setSignedIn(false));
  const go = (p) => nav(`/learn/${handle}${p ? `/${p}` : ''}`);
  // only a reply to the token we sent may sign us out (a slower, older request mustn't undo a fresh sign-in)
  const load = () => {
    const sent = getTok(handle);
    return fetch(`/api/learn/${handle}`, { headers: { 'X-Student': sent } }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (sent !== getTok(handle)) return;
      setInfo(d);
      if (!d.me && sent) { setTok(handle, ''); setSignedIn(false); }
    }).catch((e) => setErr(e.message || 'This school couldn’t be loaded'));
  };
  useEffect(() => { load(); }, [handle, signedIn]);
  // the emailed library link (?t=L…) signs straight in
  useEffect(() => {
    const t = qs.get('t');
    if (!t || signedIn) return;
    fetch(`/api/learn/${handle}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) })
      .then((r) => r.json()).then((d) => { if (d.token) { setTok(handle, d.token); setSignedIn(true); nav(`/learn/${handle}`, { replace: true }); } }).catch(() => {}).finally(() => setLinking(false));
  }, []);
  useEffect(() => { if (info?.school?.name) document.title = info.school.name; }, [info?.school?.name]);
  useAppShell(handle, info?.school);
  const accent = info?.school?.color || '#6366f1';
  if (err) return <div className="ln" style={{ '--acc': accent }}><Empty icon="🔒" title="School not found" text={err} /></div>;
  if (!info || linking || (signedIn && !info.me && getTok(handle))) return <div className="ln ln-loading" style={{ '--acc': accent }}><Spinner /></div>;
  if (!signedIn || !info.me) return <div className="ln" style={{ '--acc': accent }}><SignIn handle={handle} school={info.school} onDone={(t) => { setTok(handle, t); setSignedIn(true); }} /></div>;
  const [section, a1, a2] = rest.split('/');
  return (
    <div className="ln" style={{ '--acc': accent }}>
      <Shell handle={handle} school={info.school} me={info.me} section={section || 'home'} go={go} api={api} onSignOut={async () => { await api('/logout', 'POST').catch(() => {}); setTok(handle, ''); setSignedIn(false); }}>
        {section === 'course' ? <CoursePage key={a1} handle={handle} api={api} pid={a1} lid={a2} go={go} tutor={info.school.tutor} />
          : section === 'community' ? <Community api={api} sid={a1} go={go} />
            : section === 'post' ? <PostPage api={api} id={a1} go={go} />
              : section === 'leaderboard' ? <Leaderboard api={api} />
                : section === 'profile' ? <Profile api={api} me={info.me} onSaved={load} />
                  : section === 'certificate' ? <CertificatePage api={api} pid={a1} go={go} />
                    : <Home api={api} school={info.school} go={go} />}
      </Shell>
    </div>
  );
}

// ---------- sign in: email → 6-digit code ----------
function SignIn({ handle, school, onDone }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => { if (!wait) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const post = async (path, body) => { const r = await fetch(`/api/learn/${handle}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d; };
  const send = async (e) => {
    e?.preventDefault(); setBusy(true); setMsg('');
    try { await post('/code', { email }); setStep('code'); setWait(30); } catch (x) { setMsg(x.message); }
    setBusy(false);
  };
  const verify = async (e) => {
    e?.preventDefault(); setBusy(true); setMsg('');
    try { onDone((await post('/login', { email, code })).token); } catch (x) { setMsg(x.message); setBusy(false); }
  };
  useEffect(() => { if (code.length === 6 && step === 'code' && !busy) verify(); }, [code]);
  return (
    <div className="ln-auth">
      <div className="ln-auth-card">
        {school.cover && <div className="ln-auth-cover" style={{ backgroundImage: `url("${school.cover}")` }} />}
        <div className="ln-auth-in">
          <div className="ln-brand big">{school.logo ? <img src={school.logo} alt="" /> : <span className="ln-logo">{(school.name || 'S')[0]}</span>}</div>
          <h1>{school.name}</h1>
          {school.tagline && <p className="ln-mute">{school.tagline}</p>}
          {step === 'email' ? (
            <form onSubmit={send}>
              <label className="ln-field"><span>Your email</span><input type="email" required autoFocus autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              <button className="ln-btn block" disabled={busy}>{busy ? <Spinner /> : 'Send me a sign-in code'}</button>
              <p className="ln-mute sm">{school.openJoin ? 'New here? The same code creates your free account.' : 'Use the email you bought with — no password needed.'}</p>
            </form>
          ) : (
            <form onSubmit={verify}>
              <p className="ln-mute">We sent a 6-digit code to <b>{email}</b>.</p>
              <label className="ln-field"><span>Code</span><input className="ln-code" required autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" /></label>
              <button className="ln-btn block" disabled={busy || code.length !== 6}>{busy ? <Spinner /> : 'Sign in'}</button>
              <div className="ln-row sm"><button type="button" className="ln-link" onClick={() => { setStep('email'); setCode(''); }}>Use another email</button><button type="button" className="ln-link" disabled={wait > 0 || busy} onClick={send}>{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button></div>
            </form>
          )}
          {msg && <p className="ln-err" role="alert">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------- the frame: top bar, tabs, notifications ----------
const TABS = [['home', 'Home', '🏠'], ['community', 'Community', '💬'], ['leaderboard', 'Leaderboard', '🏆', 'Leaders'], ['profile', 'Profile', '👤']];
function Shell({ handle, school, me, section, go, api, onSignOut, children }) {
  const install = useInstall();
  const [bell, setBell] = useState(null);
  const [unread, setUnread] = useState(0);
  const [menu, setMenu] = useState(false);
  useEffect(() => { api('/home').then((d) => setUnread(d.unread)).catch(() => {}); }, [section]);
  const openBell = async () => { if (bell) return setBell(null); const n = await api('/notifications?read=1').catch(() => []); setBell(n); setUnread(0); };
  return (
    <>
      <header className="ln-top">
        <button className="ln-brand" onClick={() => go('')}>{school.logo ? <img src={school.logo} alt="" /> : <span className="ln-logo">{(school.name || 'S')[0]}</span>}<b>{school.name}</b></button>
        <nav className="ln-tabs" aria-label="Main">{TABS.slice(0, 3).map(([k, l]) => <button key={k} className={section === k || (k === 'community' && section === 'post') ? 'on' : ''} onClick={() => go(k === 'home' ? '' : k)}>{l}</button>)}</nav>
        <div className="ln-top-r">
          <div className="ln-pop-wrap">
            <button className="ln-icon" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} onClick={openBell}>🔔{unread > 0 && <i className="ln-dot">{unread > 9 ? '9+' : unread}</i>}</button>
            {bell && (
              <div className="ln-pop" role="dialog" aria-label="Notifications">
                <h4>Notifications</h4>
                {bell.length === 0 ? <p className="ln-mute sm">Nothing yet — replies and answers show up here.</p> : bell.map((n) => <button key={n.id} className={`ln-note ${n.read ? '' : 'new'}`} onClick={() => { setBell(null); go(n.link); }}><span>{n.text}</span><small>{ago(n.at)}</small></button>)}
              </div>
            )}
          </div>
          <div className="ln-pop-wrap">
            <button className="ln-me" onClick={() => setMenu((m) => !m)} aria-label="Your account"><Avatar a={{ initials: me.initials, level: me.level }} size={34} /></button>
            {menu && (
              <div className="ln-pop small" onClick={() => setMenu(false)}>
                <div className="ln-pop-me"><b>{me.name || me.email}</b><small>Level {me.level} · {me.levelName}</small></div>
                <button onClick={() => go('profile')}>Profile & certificates</button>
                {install?.kind === 'prompt' && <button onClick={install.go}>📲 Install the app</button>}
                <button onClick={onSignOut}>Sign out</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="ln-main">{children}</main>
      <nav className="ln-bottom" aria-label="Main">{TABS.map(([k, l, ic, short]) => <button key={k} className={section === k || (k === 'community' && section === 'post') || (k === 'home' && section === 'course') ? 'on' : ''} onClick={() => go(k === 'home' ? '' : k)}><span>{ic}</span>{short || l}</button>)}</nav>
    </>
  );
}

// ---------- home ----------
function LevelCard({ me, compact }) {
  const pct = me.next ? Math.min(100, Math.round(((me.points - (me.from || 0)) / Math.max(1, me.next - (me.from || 0))) * 100)) : 100;
  return (
    <div className={`ln-level ${compact ? 'compact' : ''}`}>
      <div className="ln-ring" style={{ '--p': pct }}><span>{me.level}</span></div>
      <div><b>Level {me.level} · {me.levelName}</b><small>{me.points} points{me.next ? ` · ${me.next - me.points} to level ${me.level + 1}` : ' · top level'}</small></div>
    </div>
  );
}
function Home({ api, school, go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/home').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Empty icon="⚠️" title="Couldn’t load" text={err} />;
  if (!d) return <div className="ln-skel" />;
  const courses = d.courses.filter((c) => c.status === 'active');
  const withLessons = courses.filter((c) => c.lessons?.length);
  // continue: the most recently opened course that still has lessons left
  const unfinished = withLessons.filter((c) => c.lessons.some((l) => !l.done && !l.locked));
  const resume = [...unfinished].filter((c) => c.resume).sort((a, b) => b.resume.at - a.resume.at)[0] || unfinished[0];
  const pctOf = (c) => (c.lessons?.length ? Math.round((c.lessons.filter((l) => l.done).length / c.lessons.length) * 100) : 0);
  return (
    <div className="ln-home">
      <section className="ln-hello">
        <div><h1>{d.me.name ? `Welcome back, ${d.me.name.split(' ')[0]} 👋` : 'Welcome 👋'}</h1>{school.welcome ? <p className="ln-mute">{linkify(school.welcome)}</p> : <p className="ln-mute">Pick up where you left off, or say hello in the community.</p>}</div>
        <LevelCard me={d.me} />
      </section>
      <InstallBanner school={school} />
      {resume && (
        <button className="ln-resume" onClick={() => go(`course/${resume.productId}/${resume.resume?.lessonId || resume.lessons.find((l) => !l.done && !l.locked)?.id || ''}`)}>
          <div className="ln-resume-cover" style={resume.cover ? { backgroundImage: `url("${resume.cover}")` } : undefined}>{!resume.cover && '▶'}</div>
          <div className="ln-resume-b"><small>Continue learning</small><b>{resume.name}</b><span>{resume.lessons.find((l) => l.id === resume.resume?.lessonId)?.title || resume.lessons.find((l) => !l.done && !l.locked)?.title || 'Start the first lesson'}</span><div className="ln-bar"><i style={{ width: `${pctOf(resume)}%` }} /></div></div>
          <span className="ln-resume-go">Resume →</span>
        </button>
      )}
      <div className="ln-cols">
        <div>
          <h2 className="ln-h2">Your courses</h2>
          {courses.length === 0 ? <Empty icon="📚" title="No courses yet" text="When you buy a course, it appears here." />
            : <div className="ln-grid">{courses.map((c) => (
              <button key={c.productId} className="ln-card" onClick={() => go(c.lessons?.length ? `course/${c.productId}` : `course/${c.productId}`)}>
                <div className="ln-cover" style={c.cover ? { backgroundImage: `url("${c.cover}")` } : undefined}>{!c.cover && <span>{c.lessons?.length ? '▶' : '⬇'}</span>}{c.certificate && pctOf(c) === 100 && <em className="ln-cert-tag">🎓 Certified</em>}</div>
                <div className="ln-card-b"><b>{c.name}</b>{c.lessons?.length ? <><div className="ln-bar"><i style={{ width: `${pctOf(c)}%` }} /></div><small>{pctOf(c)}% · {c.lessons.filter((l) => l.done).length}/{c.lessons.length} lessons</small></> : <small>{c.files?.length || 0} downloads</small>}</div>
              </button>
            ))}</div>}
          {d.recent.length > 0 && <>
            <h2 className="ln-h2">From the community <button className="ln-link" onClick={() => go('community')}>See all</button></h2>
            <div className="ln-feed">{d.recent.map((p) => <PostCard key={p.id} p={p} onOpen={() => go(`post/${p.id}`)} />)}</div>
          </>}
        </div>
        <aside>
          <div className="ln-panel"><h3>Leaderboard <small>30 days</small></h3>
            {d.leaderboard.top.length === 0 ? <p className="ln-mute sm">Like and help others to earn points.</p> : <ol className="ln-lb mini">{d.leaderboard.top.slice(0, 5).map((r) => <li key={r.id}><span className="ln-rank">{r.rank}</span><Avatar a={r} size={28} /><b>{r.name}</b><em>+{r.points}</em></li>)}</ol>}
            <button className="ln-link" onClick={() => go('leaderboard')}>Full leaderboard →</button>
          </div>
          {d.certs.length > 0 && <div className="ln-panel"><h3>Certificates</h3>{d.certs.map((c) => <a key={c.id} className="ln-certrow" href={`/cert/${c.id}`} target="_blank" rel="noreferrer">🎓 <span>{c.course}</span></a>)}</div>}
          {d.spaces.length > 0 && <div className="ln-panel"><h3>Spaces</h3>{d.spaces.map((s) => <button key={s.id} className="ln-spacerow" onClick={() => go(`community/${s.id}`)}><span>{s.emoji}</span>{s.name}</button>)}</div>}
        </aside>
      </div>
    </div>
  );
}

// ---------- a course ----------
function CoursePage({ handle, api, pid, lid, go, tutor }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('lesson');
  const [side, setSide] = useState(false);
  const [toast, setToast] = useState(null);
  const load = () => api('/home').then((d) => { const x = d.courses.find((k) => k.productId === pid && k.status === 'active'); if (!x) throw new Error('This course isn’t in your account'); setC(x); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [pid]);
  const lessons = c?.lessons || [];
  const cur = lessons.find((l) => l.id === lid) || lessons.find((l) => l.id === c?.resume?.lessonId) || lessons.find((l) => !l.done && !l.locked) || lessons[0];
  useEffect(() => { setTab('lesson'); window.scrollTo?.(0, 0); }, [cur?.id]);
  const sections = useMemo(() => { const m = []; for (const l of lessons) { const s = m.at(-1); if (s && s.name === l.section) s.items.push(l); else m.push({ name: l.section, items: [l] }); } return m; }, [c]);
  if (err) return <Empty icon="🔒" title="Course not available" text={err}><button className="ln-btn" onClick={() => go('')}>Back home</button></Empty>;
  if (!c) return <div className="ln-skel" />;
  if (!lessons.length) return <Downloads c={c} go={go} />;
  const i = lessons.findIndex((l) => l.id === cur.id);
  const next = lessons.slice(i + 1).find((l) => !l.locked), prev = [...lessons.slice(0, i)].reverse().find((l) => !l.locked);
  const done = lessons.filter((l) => l.done).length, pct = Math.round((done / lessons.length) * 100);
  const mark = async (v, t) => {
    const r = await api('/progress', 'POST', { accessId: c.accessId, lessonId: cur.id, done: v, t }).catch((e) => { setToast(e.message); return null; });
    if (!r) return;
    if (r.cert) setToast('🎓 Course complete — your certificate is ready!');
    await load();
    if (v && next && !r.cert) go(`course/${pid}/${next.id}`);
  };
  return (
    <div className="ln-course">
      <aside className={`ln-outline ${side ? 'open' : ''}`}>
        <button className="ln-back" onClick={() => go('')}>← Home</button>
        <h2>{c.name}</h2>
        <div className="ln-bar big"><i style={{ width: `${pct}%` }} /></div>
        <small className="ln-mute">{pct}% complete · {done}/{lessons.length} lessons</small>
        {c.certificate && pct === 100 && <button className="ln-btn sm block" onClick={() => go(`certificate/${pid}`)}>🎓 View certificate</button>}
        <nav>{sections.map((s, k) => (
          <div key={k} className="ln-sec">{s.name && <h4>{s.name}</h4>}
            {s.items.map((l) => (
              <button key={l.id} disabled={l.locked} className={`ln-les ${l.id === cur.id ? 'on' : ''} ${l.done ? 'done' : ''}`} onClick={() => { setSide(false); go(`course/${pid}/${l.id}`); }}>
                <span className="ln-tick">{l.locked ? '🔒' : l.done ? '✓' : ''}</span>
                <span className="ln-les-t">{l.title}{l.locked ? <small>{l.needLevel ? `Unlocks at level ${l.needLevel}` : `Opens ${day(l.opensAt)}`}</small> : l.quiz ? <small>Quiz{l.quizResult?.passed ? ' · passed' : ''}</small> : null}</span>
              </button>
            ))}
          </div>
        ))}</nav>
      </aside>
      <section className="ln-lesson">
        <button className="ln-outline-btn" onClick={() => setSide(true)}>☰ Lessons · {done}/{lessons.length}</button>
        {side && <div className="ln-scrim" onClick={() => setSide(false)} />}
        <Player api={api} accessId={c.accessId} lesson={cur} resumeAt={c.resume?.lessonId === cur.id ? c.resume.t : 0} onProgress={(t) => api('/progress', 'POST', { accessId: c.accessId, lessonId: cur.id, t }).catch(() => {})} />
        <div className="ln-lh">
          <div><small className="ln-mute">{cur.section ? `${cur.section} · ` : ''}Lesson {i + 1} of {lessons.length}</small><h1>{cur.title}</h1></div>
          {!cur.quiz && <button className={`ln-btn ${cur.done ? 'ghost' : ''}`} onClick={() => mark(!cur.done)}>{cur.done ? '✓ Completed' : 'Mark complete'}</button>}
        </div>
        <div className="ln-seg" role="tablist">
          {[['lesson', 'Lesson'], ...(cur.quiz ? [['quiz', `Quiz${cur.quizResult?.passed ? ' ✓' : ''}`]] : []), ['questions', 'Questions'], ...(tutor ? [['tutor', '✨ Ask AI']] : [])].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {tab === 'lesson' && <div className="ln-body">
          {cur.body ? linkify(cur.body) : <p className="ln-mute">Watch the video above.</p>}
          {cur.files?.length > 0 && <div className="ln-files"><h4>Downloads</h4>{cur.files.map((f) => <a key={f.id} className="ln-file" href={f.url || undefined}>{/pdf/.test(f.type) ? '📄' : '⬇'} <span>{f.name}</span>{f.left != null && <small>{f.left} left</small>}</a>)}</div>}
          {cur.quiz && !cur.quizResult?.passed && <div className="ln-callout">This lesson ends with a quiz. <button className="ln-link" onClick={() => setTab('quiz')}>Take the quiz →</button></div>}
        </div>}
        {tab === 'quiz' && cur.quiz && <Quiz key={cur.id} api={api} c={c} lesson={cur} onPassed={async (r) => { if (r.cert) setToast('🎓 Course complete — your certificate is ready!'); await load(); }} />}
        {tab === 'questions' && <Thread api={api} path={`/lesson/${pid}/${cur.id}/comments`} placeholder="Ask a question about this lesson…" empty="No questions yet — ask the first one. The instructor answers here." />}
        {tab === 'tutor' && <Tutor key={cur.id} api={api} pid={pid} lid={cur.id} />}
        <div className="ln-pn">
          {prev ? <button className="ln-btn ghost" onClick={() => go(`course/${pid}/${prev.id}`)}>← {prev.title}</button> : <span />}
          {next && <button className="ln-btn ghost" onClick={() => go(`course/${pid}/${next.id}`)}>{next.title} →</button>}
        </div>
      </section>
      {toast && <div className="ln-toast" role="status" onAnimationEnd={() => setToast(null)}>{toast}{/certificate/.test(toast) && <button className="ln-link" onClick={() => go(`certificate/${pid}`)}>Open</button>}</div>}
    </div>
  );
}
function Player({ lesson, resumeAt, onProgress, api, accessId }) {
  const ref = useRef(null);
  const last = useRef(0);
  const vs = lesson.videoUrl ? videoSource(lesson.videoUrl) : null;
  const src = lesson.video || (vs?.kind === 'video' ? vs.src : null);
  useEffect(() => { last.current = 0; }, [lesson.id]);
  const events = {
    onLoadedMetadata: (e) => { if (resumeAt > 5 && resumeAt < e.target.duration - 5) e.target.currentTime = resumeAt; },
    onTimeUpdate: (e) => { const t = Math.floor(e.target.currentTime); if (Math.abs(t - last.current) >= 15) { last.current = t; onProgress(t); } },
    onPause: (e) => onProgress(Math.floor(e.target.currentTime)),
  };
  if (lesson.hls) return <SecurePlayer key={lesson.id} api={api} accessId={accessId} fileId={lesson.hls.fileId} events={events} />;
  if (src) return (
    <div className="ln-video">
      <video ref={ref} src={src} controls controlsList="nodownload" disablePictureInPicture playsInline preload="metadata" onContextMenu={(e) => e.preventDefault()} {...events} />
    </div>
  );
  if (vs?.src) return <div className="ln-video"><iframe src={vs.src} title={lesson.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>;
  return null;
}
// A protected lesson video: encrypted stream (hls.js, or Safari's own player) with the student's email drifting
// across it, so a screen recording shows who shared it
function SecurePlayer({ api, accessId, fileId, events }) {
  const ref = useRef(null);
  const [mark, setMark] = useState('');
  const [pos, setPos] = useState({ x: 8, y: 10 });
  const [err, setErr] = useState('');
  useEffect(() => {
    let hls, gone = false;
    api('/video', 'POST', { accessId, fileId }).then(async (r) => {
      if (gone) return;
      setMark(r.mark);
      const v = ref.current;
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = r.src; return; }
      const { default: Hls } = await import('hls.js');
      if (gone) return;
      if (!Hls.isSupported()) return setErr('This browser can’t play protected video — try Chrome or Safari');
      hls = new Hls({ maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setErr('The video couldn’t load — reopen the lesson'); });
      hls.loadSource(r.src);
      hls.attachMedia(v);
    }).catch((e) => setErr(e.message));
    return () => { gone = true; hls?.destroy(); };
  }, [fileId]);
  useEffect(() => { if (!mark) return; const t = setInterval(() => setPos({ x: 4 + Math.random() * 62, y: 6 + Math.random() * 78 }), 7000); return () => clearInterval(t); }, [mark]);
  return (
    <div className="ln-video" onContextMenu={(e) => e.preventDefault()}>
      <video ref={ref} controls controlsList="nodownload noremoteplayback" disablePictureInPicture playsInline preload="metadata" {...events} />
      {mark && <span className="ln-mark" style={{ left: `${pos.x}%`, top: `${pos.y}%` }} aria-hidden="true">{mark}</span>}
      {err && <div className="ln-video-err">{err}</div>}
    </div>
  );
}
function Quiz({ api, c, lesson, onPassed }) {
  const qs = lesson.quiz.questions;
  const [ans, setAns] = useState(() => qs.map(() => null));
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const x = await api('/quiz', 'POST', { accessId: c.accessId, lessonId: lesson.id, answers: ans }); setR(x); if (x.passed) onPassed(x); } catch (e) { setR({ error: e.message }); }
    setBusy(false);
  };
  return (
    <div className="ln-quiz">
      {lesson.quizResult && !r && <p className="ln-mute">Your best score: <b>{lesson.quizResult.score}%</b>{lesson.quizResult.passed ? ' — passed ✓' : ` (pass mark ${lesson.quiz.pass}%)`}</p>}
      {qs.map((q, i) => (
        <fieldset key={i} className={`ln-q ${r?.results ? (r.results[i].correct ? 'right' : 'wrong') : ''}`}>
          <legend><span>{i + 1}</span>{q.q}</legend>
          {q.options.map((o, k) => (
            <label key={k} className={`ln-opt ${ans[i] === k ? 'on' : ''} ${r?.results && r.results[i].answer === k ? 'answer' : ''}`}>
              <input type="radio" name={`q${i}`} checked={ans[i] === k} disabled={!!r?.results} onChange={() => setAns(ans.map((a, j) => (j === i ? k : a)))} />{o}
            </label>
          ))}
          {r?.results && r.results[i].explain && <p className="ln-explain">{r.results[i].explain}</p>}
        </fieldset>
      ))}
      {r?.error && <p className="ln-err">{r.error}</p>}
      {r?.results ? (
        <div className={`ln-result ${r.passed ? 'pass' : 'fail'}`}>
          <b>{r.passed ? `🎉 Passed — ${r.score}%` : `${r.score}% — you need ${r.pass}% to pass`}</b>
          {!r.passed && <button className="ln-btn" onClick={() => { setR(null); setAns(qs.map(() => null)); }}>Try again</button>}
        </div>
      ) : <button className="ln-btn" disabled={busy || ans.some((a) => a == null)} onClick={submit}>{busy ? <Spinner /> : ans.some((a) => a == null) ? `Answer all ${qs.length} questions` : 'Submit answers'}</button>}
    </div>
  );
}
function Tutor({ api, pid, lid }) {
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [msgs]);
  const ask = async (e) => {
    e.preventDefault();
    const text = q.trim(); if (!text || busy) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: 'user', text }]); setQ(''); setBusy(true);
    try { const r = await api('/tutor', 'POST', { productId: pid, lessonId: lid, question: text, history }); setMsgs((m) => [...m, { role: 'assistant', text: r.answer }]); } catch (x) { setMsgs((m) => [...m, { role: 'assistant', text: x.message, error: true }]); }
    setBusy(false);
  };
  return (
    <div className="ln-tutor">
      {msgs.length === 0 && <p className="ln-mute">Ask anything about this course — the AI tutor answers from the lessons. For anything personal, ask under <b>Questions</b> so the instructor sees it.</p>}
      <div className="ln-chat">{msgs.map((m, i) => <div key={i} className={`ln-msg ${m.role} ${m.error ? 'err' : ''}`}>{linkify(m.text)}</div>)}{busy && <div className="ln-msg assistant"><Spinner /></div>}<div ref={end} /></div>
      <form className="ln-compose" onSubmit={ask}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Can you explain step 2 more simply?" maxLength={1000} /><button className="ln-btn" disabled={!q.trim() || busy}>Ask</button></form>
    </div>
  );
}
function Downloads({ c, go }) {
  return (
    <div className="ln-narrow">
      <button className="ln-back" onClick={() => go('')}>← Home</button>
      <h1>{c.name}</h1>
      {c.note && <p className="ln-body">{linkify(c.note)}</p>}
      <div className="ln-files">{c.files.map((f) => <a key={f.id} className="ln-file" href={f.url || undefined}>⬇ <span>{f.name}</span>{f.left != null && <small>{f.left} left</small>}</a>)}
        {c.links.map((l, i) => <a key={i} className="ln-file" href={l.url} target="_blank" rel="noopener noreferrer">🔗 <span>{l.label}</span></a>)}</div>
    </div>
  );
}

// ---------- comment threads (lesson questions, post comments) ----------
function Thread({ api, path, placeholder, empty, postPath }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api(path).then((x) => setList(Array.isArray(x) ? x : x.comments)).catch(() => setList([]));
  useEffect(() => { load(); }, [path]);
  const send = async (e) => {
    e.preventDefault(); if (!text.trim()) return;
    setBusy(true);
    try { await api(postPath || path, 'POST', { body: text, parentId: reply?.id }); setText(''); setReply(null); await load(); } catch (x) { alertDialog({ text: x.message, buyer: true }); }
    setBusy(false);
  };
  const like = async (r) => { const x = await api('/like', 'POST', { target: `reply:${r.id}`, on: !r.liked }).catch(() => null); if (x) setList((l) => l.map((y) => (y.id === r.id ? { ...y, liked: x.liked, likes: x.likes } : y))); };
  const del = async (r) => { if (!await confirmDialog({ title: 'Delete your comment?', confirm: 'Delete', danger: true, buyer: true })) return; await api(`/comments/${r.id}`, 'DELETE').catch(() => {}); load(); };
  if (!list) return <div className="ln-skel sm" />;
  const top = list.filter((r) => !r.parentId);
  const Item = ({ r, child }) => (
    <div className={`ln-cmt ${child ? 'child' : ''}`}>
      <Avatar a={r.author} size={child ? 28 : 34} />
      <div className="ln-cmt-b">
        <div className="ln-meta"><Name a={r.author} /><small>{ago(r.at)}</small></div>
        <p>{linkify(r.body)}</p>
        <div className="ln-acts">
          <button className={r.liked ? 'on' : ''} onClick={() => like(r)} aria-pressed={r.liked}>👍 {r.likes || ''}</button>
          {!child && <button onClick={() => setReply(r)}>Reply</button>}
          {r.mine && <button onClick={() => del(r)}>Delete</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="ln-thread">
      {top.length === 0 && <p className="ln-mute">{empty}</p>}
      {top.map((r) => <div key={r.id}><Item r={r} />{list.filter((x) => x.parentId === r.id).map((x) => <Item key={x.id} r={x} child />)}</div>)}
      <form className="ln-compose" onSubmit={send}>
        {reply && <div className="ln-replying">Replying to {reply.author.name} <button type="button" className="ln-link" onClick={() => setReply(null)}>Cancel</button></div>}
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={reply ? 'Write a reply…' : placeholder} maxLength={3000} />
        <button className="ln-btn" disabled={busy || !text.trim()}>{busy ? <Spinner /> : 'Post'}</button>
      </form>
    </div>
  );
}

// ---------- community ----------
function PostCard({ p, onOpen, onLike }) {
  return (
    <article className={`ln-post ${p.pinned ? 'pinned' : ''}`}>
      <header className="ln-meta"><Avatar a={p.author} /><div><Name a={p.author} /><small>{ago(p.at)}{p.pinned && ' · 📌 Pinned'}</small></div></header>
      <button className="ln-post-b" onClick={onOpen}>
        {p.title && <h3>{p.title}</h3>}
        {p.body && <p className="ln-clamp">{p.body}</p>}
        {p.images?.[0] && <img className="ln-post-img" src={p.images[0]} alt="" loading="lazy" />}
      </button>
      <footer className="ln-acts">
        {onLike ? <button className={p.liked ? 'on' : ''} onClick={onLike} aria-pressed={p.liked}>👍 {p.likes || 'Like'}</button> : <span>👍 {p.likes}</span>}
        <button onClick={onOpen}>💬 {p.comments || 'Comment'}</button>
      </footer>
    </article>
  );
}
function Community({ api, sid, go }) {
  const [spaces, setSpaces] = useState(null);
  const [feed, setFeed] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/home').then((d) => { setSpaces(d.spaces); if (!sid && d.spaces[0]) go(`community/${d.spaces[0].id}`); }).catch((e) => setErr(e.message)); }, []);
  const load = (before) => api(`/spaces/${sid}/posts${before ? `?before=${before}` : ''}`).then((d) => setFeed((f) => (before ? { ...d, posts: [...f.posts, ...d.posts] } : d))).catch((e) => (e.status === 403 ? setFeed({ locked: e.message, posts: [] }) : setErr(e.message)));
  useEffect(() => { if (sid) { setFeed(null); load(); } }, [sid]);
  const like = async (p) => { const x = await api('/like', 'POST', { target: `post:${p.id}`, on: !p.liked }).catch(() => null); if (x) setFeed((f) => ({ ...f, posts: f.posts.map((y) => (y.id === p.id ? { ...y, liked: x.liked, likes: x.likes } : y)) })); };
  const post = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api(`/spaces/${sid}/posts`, 'POST', draft); setDraft({ title: '', body: '' }); setOpen(false); await load(); } catch (x) { alertDialog({ text: x.message, buyer: true }); }
    setBusy(false);
  };
  if (err) return <Empty icon="💬" title="Community unavailable" text={err} />;
  if (!spaces) return <div className="ln-skel" />;
  if (!spaces.length) return <Empty icon="💬" title="No community yet" text="When the community opens, its spaces appear here." />;
  const cur = spaces.find((s) => s.id === sid);
  return (
    <div className="ln-comm">
      <aside className="ln-spaces">{spaces.map((s) => <button key={s.id} className={s.id === sid ? 'on' : ''} onClick={() => go(`community/${s.id}`)}><span>{s.locked ? '🔒' : s.emoji}</span>{s.name}{s.locked && <small className="ln-lock">L{s.minLevel}</small>}</button>)}</aside>
      <section>
        {cur && <div className="ln-space-h"><h1>{cur.emoji} {cur.name}</h1>{cur.description && <p className="ln-mute">{cur.description}</p>}</div>}
        {feed?.locked && <Empty icon="🔒" title={feed.locked} text="Earn points when people like your posts and comments, and when you finish lessons. Your level is on the Leaderboard tab." />}
        {cur && !cur.locked && !feed?.locked && cur.postBy !== 'admins' && (
          open ? (
            <form className="ln-composer" onSubmit={post}>
              <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Title (optional)" maxLength={200} />
              <textarea rows={4} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Share a win, ask a question, start a conversation…" maxLength={10000} />
              <div className="ln-row"><button type="button" className="ln-link" onClick={() => setOpen(false)}>Cancel</button><button className="ln-btn" disabled={busy || (!draft.title.trim() && !draft.body.trim())}>{busy ? <Spinner /> : 'Post'}</button></div>
            </form>
          ) : <button className="ln-composer closed" onClick={() => setOpen(true)}>✏️ Write something…</button>
        )}
        {!feed ? <div className="ln-skel" /> : feed.locked ? null : feed.posts.length === 0 ? <Empty icon="🌱" title="Nothing here yet" text={cur?.postBy === 'admins' ? 'Announcements will appear here.' : 'Be the first to post.'} />
          : <div className="ln-feed">{feed.posts.map((p) => <PostCard key={p.id} p={p} onOpen={() => go(`post/${p.id}`)} onLike={() => like(p)} />)}</div>}
        {feed?.more && <button className="ln-btn ghost block" onClick={() => load(feed.posts.filter((p) => !p.pinned).at(-1)?.at)}>Load more</button>}
      </section>
    </div>
  );
}
function PostPage({ api, id, go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api(`/posts/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <Empty icon="🔍" title="Post not found" text={err}><button className="ln-btn" onClick={() => go('community')}>Back to community</button></Empty>;
  if (!d) return <div className="ln-skel" />;
  const p = d.post;
  const like = async () => { const x = await api('/like', 'POST', { target: `post:${p.id}`, on: !p.liked }).catch(() => null); if (x) setD({ ...d, post: { ...p, liked: x.liked, likes: x.likes } }); };
  const del = async () => { if (!await confirmDialog({ title: 'Delete your post?', text: 'Its comments go too.', confirm: 'Delete', danger: true, buyer: true })) return; await api(`/posts/${p.id}`, 'DELETE'); go(`community/${p.spaceId}`); };
  return (
    <div className="ln-narrow">
      <button className="ln-back" onClick={() => go(`community/${p.spaceId}`)}>← Back</button>
      <article className="ln-post full">
        <header className="ln-meta"><Avatar a={p.author} /><div><Name a={p.author} /><small>{ago(p.at)}{p.editedAt && ' · edited'}</small></div>{p.mine && <button className="ln-link" onClick={del}>Delete</button>}</header>
        {p.title && <h1>{p.title}</h1>}
        {p.body && <div className="ln-body">{linkify(p.body)}</div>}
        {p.images?.map((src) => <img key={src} className="ln-post-img" src={src} alt="" />)}
        <footer className="ln-acts"><button className={p.liked ? 'on' : ''} onClick={like} aria-pressed={p.liked}>👍 {p.likes || 'Like'}</button><span>💬 {d.comments.length}</span></footer>
      </article>
      <Thread api={api} path={`/posts/${p.id}`} postPath={`/posts/${p.id}/comments`} placeholder="Write a comment…" empty="No comments yet." />
    </div>
  );
}

// ---------- leaderboard, profile, certificate ----------
function Leaderboard({ api }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api(`/leaderboard?days=${days}`).then(setD).catch(() => setD({ top: [] })); }, [days]);
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="ln-narrow">
      <h1>Leaderboard</h1>
      {d?.me && <LevelCard me={d.me} />}
      <div className="ln-seg" role="tablist">{[[7, '7 days'], [30, '30 days'], [0, 'All time']].map(([k, l]) => <button key={k} className={days === k ? 'on' : ''} onClick={() => setDays(k)}>{l}</button>)}</div>
      {!d ? <div className="ln-skel" /> : d.top.length === 0 ? <Empty icon="🏆" title="No points yet" text="Earn points when people like your posts and comments, and when you finish lessons." />
        : <ol className="ln-lb">{d.top.map((r) => <li key={r.id}><span className="ln-rank">{medal[r.rank - 1] || r.rank}</span><Avatar a={r} size={36} /><b>{r.name}</b><em>{days ? '+' : ''}{r.points}</em></li>)}</ol>}
      {d?.levels && (
        <div className="ln-panel"><h3>Levels</h3>
          <ul className="ln-levels">{d.levels.map((n, i) => <li key={i} className={d.me?.level === i + 1 ? 'on' : ''}><span>{i + 1}</span><b>{n}</b><small>{d.levelPoints[i]} pts</small></li>)}</ul>
          <p className="ln-mute sm">1 point for each like you receive and each lesson you finish, 2 for a passed quiz, 10 for a finished course.</p>
        </div>
      )}
    </div>
  );
}
function Profile({ api, me, onSaved }) {
  const [v, setV] = useState({ name: me.name || '', bio: me.bio || '', alerts: me.alerts !== false });
  const [saved, setSaved] = useState(false);
  const [certs, setCerts] = useState([]);
  useEffect(() => { api('/home').then((d) => setCerts(d.certs)).catch(() => {}); }, []);
  const save = async (e) => { e.preventDefault(); await api('/me', 'PUT', v); setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000); };
  return (
    <div className="ln-narrow">
      <h1>Your profile</h1>
      <LevelCard me={me} />
      <form className="ln-panel" onSubmit={save}>
        <label className="ln-field"><span>Name</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} /></label>
        <label className="ln-field"><span>About you</span><textarea rows={3} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} maxLength={300} placeholder="A line about yourself for the community" /></label>
        <label className="ln-check"><input type="checkbox" checked={v.alerts} onChange={(e) => setV({ ...v, alerts: e.target.checked })} /><span>Email me (and WhatsApp) when someone replies to me or answers my question</span></label>
        <p className="ln-mute sm">Signed in as {me.email}</p>
        <button className="ln-btn">{saved ? 'Saved ✓' : 'Save'}</button>
      </form>
      {certs.length > 0 && <div className="ln-panel"><h3>Your certificates</h3>{certs.map((c) => <a key={c.id} className="ln-certrow" href={`/cert/${c.id}`} target="_blank" rel="noreferrer">🎓 <span>{c.course}</span><small>{day(c.at)}</small></a>)}</div>}
    </div>
  );
}
function CertificatePage({ api, pid, go }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/certificate/${pid}`).then(setC).catch((e) => setErr(e.message)); }, [pid]);
  if (err) return <Empty icon="🎓" title="Not yet" text={err}><button className="ln-btn" onClick={() => go(`course/${pid}`)}>Back to the course</button></Empty>;
  if (!c) return <div className="ln-skel" />;
  return <div className="ln-narrow"><button className="ln-back" onClick={() => go(`course/${pid}`)}>← Back to the course</button><Certificate c={c} /></div>;
}

// The certificate itself (also the public check page, /cert/<number>); prints as a clean A4 landscape page
export function Certificate({ c }) {
  const url = `${location.origin}/cert/${c.id}`;
  return (
    <div className="ln-certwrap">
      <div className="ln-cert">
        <div className="ln-cert-in">
          <small className="ln-cert-school">{c.school}</small>
          <h1>{c.title || 'Certificate of completion'}</h1>
          <p>This certifies that</p>
          <h2>{c.name}</h2>
          <p>has successfully completed</p>
          <h3>{c.course}</h3>
          <div className="ln-cert-foot">
            <div><b>{day(c.at)}</b><small>Date</small></div>
            <div className="ln-cert-seal">🎓</div>
            <div>{c.signer ? <><b>{c.signer}</b><small>{c.signerRole || 'Instructor'}</small></> : <><b>{c.school}</b><small>Issued by</small></>}</div>
          </div>
          <small className="ln-cert-id">Certificate no. {c.id} · check it at {url.replace(/^https?:\/\//, '')}</small>
        </div>
      </div>
      <div className="ln-cert-acts">
        <button className="ln-btn" onClick={() => window.print()}>Download PDF</button>
        <a className="ln-btn ghost" href={`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(c.course)}&organizationName=${encodeURIComponent(c.school)}&issueYear=${new Date(c.at).getFullYear()}&issueMonth=${new Date(c.at).getMonth() + 1}&certUrl=${encodeURIComponent(url)}&certId=${c.id}`} target="_blank" rel="noopener noreferrer">Add to LinkedIn</a>
      </div>
    </div>
  );
}
export function CertCheck() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch(`/api/cert/${id}`).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setC(d); document.title = `${d.name} · ${d.course}`; }).catch((e) => setErr(e.message || 'Not found')); }, [id]);
  return (
    <div className="ln" style={{ '--acc': '#6366f1' }}>
      <main className="ln-main">
        {err ? <Empty icon="❌" title="Certificate not found" text="There’s no certificate with this number. Check the link." />
          : !c ? <div className="ln-skel" />
            : <><p className="ln-verified">✓ Genuine certificate issued by {c.school}</p><Certificate c={c} /></>}
      </main>
    </div>
  );
}
