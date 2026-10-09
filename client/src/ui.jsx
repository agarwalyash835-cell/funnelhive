import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { WorkspaceSwitch } from './pages/Team';
import { api, logout, stopImpersonating, fmtDate } from './api';

const P = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  funnel: 'M3 4h18l-7 8v6l-4 2v-8z',
  layout: 'M3 3h18v18H3zM3 9h18M9 21V9',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sparkles: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  copy: 'M9 9h13v13H9zM5 15H2V2h13v3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  redo: 'M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8',
  desktop: 'M2 4h20v12H2zM8 20h8M12 16v4',
  tablet: 'M5 2h14v20H5zM12 18h.01',
  mobile: 'M7 2h10v20H7zM12 18h.01',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  flow: 'M3 3h6v6H3zM15 15h6v6h-6zM6 9v3h12v3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20',
  menu: 'M3 6h18M3 12h18M3 18h18',
  chevron: 'M9 18l6-6-6-6',
  split: 'M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22zM7.5 10.5h.01M10.5 7h.01M15 7.5h.01M17 11h.01',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  play: 'M5 3l14 9-14 9z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  clip: 'M9 3h6v3H9zM8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  card: 'M2 5h20v14H2zM2 10h20M6 15h4',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  refund: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8M12 8v4l3 2',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2zM9 7h6M9 11h6M9 15h4',
};
export const Icon = ({ name, size = 18, stroke = 2, className = '' }) => (
  <svg className={`ic-svg ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'grip' ? 3.2 : stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={P[name] || P.bolt} />
  </svg>
);

export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
export const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const cell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);
export function downloadCSV(name, rows) {
  rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

// ---------- app shell ----------
const NAV = [
  ['/', 'home', 'Dashboard'],
  ['/funnels', 'funnel', 'Funnels'],
  ['/templates', 'layout', 'Templates'],
  ['/hive', 'sparkles', 'Hive AI'],
  ['/contacts', 'users', 'Contacts'],
  ['/automations', 'flow', 'Automations'],
  ['/broadcasts', 'mail', 'Broadcasts'],
  ['/products', 'box', 'Products'],
  ['/bookings', 'clock', 'Bookings'],
  ['/webinars', 'play', 'Webinars'],
  ['/orders', 'cart', 'Orders'],
  ['/quotes', 'receipt', 'Quotes'],
  ['/agency', 'layers', 'Agency'],
  ['/settings', 'settings', 'Settings'],
  ['/billing', 'card', 'Plan & billing'],
];
export const BRAND = 'FunnelHive';
// where live funnel pages are served (PAGES_URL on the server, else this app)
export const pagesOrigin = () => (typeof window !== 'undefined' && window.__PAGES_URL__) || location.origin;

export function Layout({ title, subtitle, actions, children, wide }) {
  const [me, setMe] = useState(null);
  const [open, setOpen] = useState(false);
  const [paywall, setPaywall] = useState(null);
  useEffect(() => { api('/me').then((m) => { setMe(m); if (m.brand) document.title = m.brand; if (m.whiteLabel?.primary) document.documentElement.style.setProperty('--primary', m.whiteLabel.primary); if (m.pagesUrl) window.__PAGES_URL__ = m.pagesUrl; window.__FF_BIZ_TZ__ = m.settings?.timezone || 'Asia/Kolkata'; }).catch(() => {}); }, []);
  useEffect(() => { const h = (e) => setPaywall(e.detail || {}); window.addEventListener('ff:paywall', h); return () => window.removeEventListener('ff:paywall', h); }, []);
  return (
    <div className="app">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">{me?.whiteLabel?.logo ? <img className="logo img" src={me.whiteLabel.logo} alt="" /> : <span className="logo" style={me?.whiteLabel?.primary ? { background: me.whiteLabel.primary } : undefined}><Icon name="bolt" size={18} /></span>}{me?.brand || BRAND}</div>
        <nav>
          {NAV.filter(([to]) => !(me?.workspace && (to === '/billing' || to === '/agency' || (to === '/settings' && !['admin', 'agency'].includes(me.workspace.role)))) && !(to === '/billing' && me?.billing?.agencyManaged)).map(([to, ic, label]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}><Icon name={ic} />{label}</NavLink>
          ))}
          {me?.admin && <NavLink to="/admin" onClick={() => setOpen(false)}><Icon name="shield" />Admin</NavLink>}
        </nav>
        <div className="side-foot">
          <WorkspaceSwitch me={me} />
          {me?.billing?.status === 'trialing' && !me.workspace && !me.billing.agencyManaged && <Link to="/billing" className="trial-chip"><Icon name="clock" size={14} />{me.billing.daysLeft} day{me.billing.daysLeft === 1 ? '' : 's'} left in trial<b>Upgrade</b></Link>}
          <div className={`ai-status ${me?.aiEnabled ? 'on' : ''}`}><Icon name="sparkles" size={14} />{me?.aiEnabled ? `AI · ${me.credits?.limit == null ? 'unlimited' : `${Math.max(0, me.credits.limit - me.credits.used)} credits left`}` : 'Offline AI assistant'}</div>
          <div className="me">
            <span className="me-av">{(me?.name || '?')[0]?.toUpperCase()}</span>
            <div><b>{me?.name}</b><small>{me?.email}</small></div>
            <button className="icon-btn" title="Log out" onClick={logout}><Icon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn burger" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="tb-title"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
          <div className="tb-actions">{actions}</div>
        </header>
        {me?.workspace && <div className="app-banner info ws"><Icon name="users" size={15} />You’re working in the <b>{me.workspace.name}</b> workspace as {({ admin: 'an admin', marketer: 'a marketer', sales: 'sales & support', viewer: 'a viewer' })[me.workspace.role]}.</div>}
        {me?.impersonating && <div className="app-banner imp"><Icon name="eye" size={15} />You’re signed in as <b>{me.email}</b> (support view).<button onClick={stopImpersonating}>Back to admin</button></div>}
        {me?.announcement && <div className="app-banner info"><Icon name="bolt" size={15} />{me.announcement}</div>}
        {me?.billing && !me.billing.ok && <div className="app-banner bad"><Icon name="clock" size={15} />{me.billing.reason || 'Your account is read-only.'}{me.billing.status !== 'suspended' && <span>{me.billing.pagesLive ? ` Your live pages stay up until ${fmtDate(me.billing.pagesOfflineAt)}.` : ' Your live pages are offline.'}</span>}{me.billing.status !== 'suspended' && <Link to="/billing">Choose a plan</Link>}</div>}
        {me && !me.emailVerified && <VerifyBanner me={me} />}
        <div className={`content ${wide ? 'wide' : ''}`}>{typeof children === 'function' ? children(me) : children}</div>
      </main>
      {paywall && <Paywall info={paywall} onClose={() => setPaywall(null)} />}
    </div>
  );
}

function Paywall({ info, onClose }) {
  const nav = useNavigate();
  return (
    <Modal title={info.credits ? 'AI credits used up' : 'Choose a plan to continue'} onClose={onClose} width={460}>
      <div className="paywall">
        <span className="empty-ic"><Icon name={info.credits ? 'sparkles' : 'card'} size={26} /></span>
        <p>{info.error}</p>
        {info.credits ? <p className="muted sm">You can keep editing by hand — everything except AI works as usual.</p> : <p className="muted sm">Everything you’ve built is safe. Subscribe to keep editing, publishing and running automations.</p>}
        <div className="row center">{!info.credits && <button className="btn primary" onClick={() => { onClose(); nav('/billing'); }}>See plans</button>}<button className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  );
}

function VerifyBanner({ me }) {
  const [sent, setSent] = useState('');
  const resend = async () => { const r = await api('/auth/resend-verification', 'POST'); setSent(r.emailConfigured ? 'Sent! Check your inbox.' : 'Email isn’t configured on this server — the link was printed in the server console.'); };
  return <div className="verify-banner"><Icon name="send" size={15} />Please verify <b>{me.email}</b> so you can recover your account.{sent ? <span>{sent}</span> : <button onClick={resend}>Resend link</button>}</div>;
}

export const Panel = ({ title, actions, children, className = '', pad = true }) => (
  <section className={`panel ${className}`}>
    {(title || actions) && <div className="panel-h"><h3>{title}</h3><div className="row">{actions}</div></div>}
    <div className={pad ? 'panel-b' : ''}>{children}</div>
  </section>
);

export const Empty = ({ icon = 'sparkles', title, text, children }) => (
  <div className="empty"><span className="empty-ic"><Icon name={icon} size={26} /></span><h3>{title}</h3>{text && <p>{text}</p>}{children}</div>
);

export function Modal({ title, onClose, children, width = 640 }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="m-scrim" onMouseDown={onClose}>
      <div className="m-box" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="m-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

let toastSet;
export function Toaster() {
  const [t, setT] = useState(null);
  toastSet = setT;
  useEffect(() => { if (t) { const h = setTimeout(() => setT(null), 2600); return () => clearTimeout(h); } }, [t]);
  return t ? <div className="app-toast"><Icon name="check" size={16} />{t}</div> : null;
}
export const toast = (m) => toastSet && toastSet(m);

export const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
export const RangePicker = ({ value, onChange }) => (
  <div className="seg">{RANGES.map(([d, l]) => <button key={d} className={value === d ? 'on' : ''} onClick={() => onChange(d)}>{l}</button>)}</div>
);

// ---------- Create funnel (AI / template / blank) ----------
const EXAMPLES = ['Online yoga classes for working women, ₹499', 'Homemade mango pickles delivered across India', 'UPSC coaching with personal mentorship', 'Rooftop solar installation in Pune', 'Bridal makeup artist in Jaipur', 'Stock market course for beginners'];
export function CreateFunnel({ onClose, aiEnabled }) {
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);
  const gen = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/ai/generate', 'POST', { prompt, lang });
      if (r.usedAI && r.quality) toast(r.quality.finalIssues === 0 ? `✅ Quality check passed — ${r.steps.length} pages at template standard` : 'Funnel ready — review the highlighted sections');
      nav(`/funnels/${r.id}`);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const blank = async () => nav(`/funnels/${(await api('/funnels', 'POST', { name: 'Untitled funnel' })).id}`);
  return (
    <Modal title="Create a new funnel" onClose={onClose} width={720}>
      <form className="create-ai" onSubmit={gen}>
        <div className="ca-badge"><Icon name="sparkles" size={14} /> AI funnel builder</div>
        <h2>Describe your business in one line</h2>
        <p className="muted">We’ll build the landing page, checkout, upsell, downsell, cross-sells and thank-you page — with copy, FOMO and pricing.</p>
        <textarea ref={ref} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Online yoga classes for working women, ₹499" />
        <label className="lang-pick">Page language <select value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option></select></label>
        <div className="sugg">{EXAMPLES.map((x) => <button type="button" key={x} onClick={() => setPrompt(x)}>{x}</button>)}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg" disabled={busy || prompt.length < 5}>{busy ? <><span className="spin" /> Building your funnel…</> : <><Icon name="wand" /> Generate my funnel</>}</button>
        {busy && <p className="hint center">Takes about a minute: the AI writes every page, then each one is checked against our template quality bar and fixed where needed.</p>}
        {!aiEnabled && <p className="hint">Running offline: we’ll match your description to the best of our 100+ expert templates. Add a KIE_API_KEY on the server for fully custom AI copy.</p>}
      </form>
      <div className="create-alt">
        <button onClick={() => nav('/templates')}><Icon name="layout" /><div><b>Pick a template</b><small>100+ proven designs: sales, VSL & webinar funnels</small></div></button>
        <button onClick={blank}><Icon name="plus" /><div><b>Start from scratch</b><small>Blank page with drag & drop</small></div></button>
      </div>
    </Modal>
  );
}
