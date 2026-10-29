import { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { WorkspaceSwitch } from './pages/Team';
import { api, meCache, logout, stopImpersonating, fmtDate } from './api';
import { t, tx, uiLang, setUiLang, applyUiLang, UI_LANGS } from './appI18n';
import { House, Funnel, LayoutTemplate, ChartLine, Target, Users, ShoppingCart, Sparkles, Settings, Plus, Search, Eye, Copy, Trash2, Pencil, ExternalLink, Undo2, Redo2, Monitor, Tablet, Smartphone, Send, GripVertical, Download, Check, X, Workflow, LogOut, Zap, Tag, Link2, Globe, Menu, ChevronRight, Split, Layers, Palette, WandSparkles, Wallet, Play, Clock, ClipboardList, Bookmark, ShieldCheck, CreditCard, Box, RotateCcw, Mail, Phone, Receipt, Vault, Bell as BellIcon, MessageCircle, Bot, Image, List, Mic, Paperclip, CalendarDays, PanelLeft } from 'lucide-react';

// One icon set everywhere: Lucide (ISC licence), the same line icons as the page builder's sections and the CRM's
// industry styles. The names are FunnelHive's own, so screens ask for "cart" or "bot" and get the Lucide drawing.
const ICONS = {
  home: House, funnel: Funnel, layout: LayoutTemplate, chart: ChartLine, target: Target, users: Users, cart: ShoppingCart, sparkles: Sparkles, settings: Settings,
  plus: Plus, search: Search, eye: Eye, copy: Copy, trash: Trash2, edit: Pencil, external: ExternalLink, undo: Undo2, redo: Redo2, desktop: Monitor, tablet: Tablet,
  mobile: Smartphone, send: Send, grip: GripVertical, download: Download, check: Check, x: X, flow: Workflow, logout: LogOut, bolt: Zap, tag: Tag, link: Link2,
  globe: Globe, menu: Menu, chevron: ChevronRight, split: Split, layers: Layers, palette: Palette, wand: WandSparkles, wallet: Wallet, play: Play, clock: Clock,
  clip: ClipboardList, bookmark: Bookmark, shield: ShieldCheck, card: CreditCard, box: Box, refund: RotateCcw, mail: Mail, phone: Phone, receipt: Receipt,
  vault: Vault, bell: BellIcon, chat: MessageCircle, bot: Bot, image: Image, list: List, mic: Mic, attach: Paperclip, calendar: CalendarDays, panel: PanelLeft,
};
export const Icon = ({ name, size = 18, stroke = 1.75, className = '' }) => {
  const C = ICONS[name] || Zap;
  return <C size={size} strokeWidth={stroke === 2 ? 1.75 : stroke} className={`ic-svg ${className}`} aria-hidden="true" />;
};

export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');
export const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  return t('{n}d ago', { n: Math.floor(s / 86400) });
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

export const BRAND = 'FunnelHive';
const LOOK_KEY = 'ff_ui';
// the app's look: Studio (default) or Liquid Glass — remembered on this device
export const currentLook = () => { try { return localStorage.getItem(LOOK_KEY) === 'glass' ? 'glass' : 'studio'; } catch { return 'studio'; } };
export const applyLook = (look = currentLook()) => { if (typeof document !== 'undefined') document.documentElement.classList.toggle('glass', look === 'glass'); };
const toggleLook = () => { const next = currentLook() === 'glass' ? 'studio' : 'glass'; try { localStorage.setItem(LOOK_KEY, next); } catch {} applyLook(next); };
// where live funnel pages are served (PAGES_URL on the server, else this app)
export const pagesOrigin = () => (typeof window !== 'undefined' && window.__PAGES_URL__) || location.origin;

// ---------- app shell ----------
// The menu stays short: a few everyday pages, then small groups. Optional tools join the menu once you use them
// (or pin them) — the rest wait under "More tools". Account pages live in the profile menu; Ctrl+K jumps anywhere.
const PAGES = {
  '/': ['home', 'Dashboard', 'Your numbers at a glance'],
  '/funnels': ['funnel', 'Funnels', 'Build, publish and test your sales funnels'],
  '/hive': ['sparkles', 'Hive AI', 'Ask AI to build, write and analyse for you'],
  '/orders': ['cart', 'Orders', 'Sales, refunds, shipping and abandoned checkouts'],
  '/reports': ['chart', 'Reports', 'Revenue, refunds, cohorts and lifetime value'],
  '/ads': ['target', 'Ads', 'Which ads bring leads, calls and sales — spend, ROAS and lifetime value per ad'],
  '/products': ['box', 'Products', 'Courses, downloads and memberships buyers get access to'],
  '/school': ['bookmark', 'School', 'Courses, community and your students'],
  '/quotes': ['receipt', 'Quotes', 'Send a custom price and get paid online'],
  '/tally': ['wallet', 'Tally', 'Your TallyPrime books — money owed, vouchers, stock — and vouchers saved straight into Tally'],
  '/inbox': ['chat', 'Inbox', 'Every WhatsApp chat in one place, with AI replies and your team'],
  '/chatbots': ['bot', 'Chatbots & AI agent', 'WhatsApp chatbots on a canvas, and an AI agent that answers customers'],
  '/contacts': ['users', 'CRM', 'Your leads, customers and pipeline — styled for your business (real estate, clinic, consultant…)'],
  '/vault': ['vault', 'Vault', 'Private files by folder and contact, saved passwords and secure notes'],
  '/automations': ['flow', 'Automations', 'Follow-up emails and WhatsApp that run by themselves'],
  '/broadcasts': ['mail', 'Campaigns', 'WhatsApp, email and AI calling campaigns to a segment of your list'],
  '/bookings': ['clock', 'Bookings', 'Your booking page, call types and calls'],
  '/webinars': ['play', 'Webinars', 'Live or scheduled sessions with sign-ups and reminders'],
  '/templates': ['layout', 'Templates', '100+ ready-made funnels to start from'],
  '/settings': ['settings', 'Settings', 'Business profile, payments, domains and team'],
  '/billing': ['card', 'Plan & billing', 'Your FunnelHive plan and invoices'],
  '/agency': ['layers', 'Agency', 'Client accounts you manage'],
  '/admin': ['shield', 'Admin', 'Platform settings and every account'],
};
const GROUPS = [[null, ['/', '/funnels', '/hive']], ['Chat', ['/inbox', '/chatbots']], ['Sell', ['/orders', '/reports', '/ads', '/products', '/school', '/quotes', '/tally']], ['Audience', ['/contacts', '/vault', '/automations', '/broadcasts']], ['Meet', ['/bookings', '/webinars']]];
const CORE = ['/', '/funnels', '/hive', '/orders', '/reports', '/ads', '/school', '/contacts', '/vault'];
const TOOLS = GROUPS.flatMap(([, l]) => l).filter((to) => to !== '/');
// the everyday menu for each industry (its CRM kit); an agency can set its own for its clients; the rest wait under
// "More tools". Accounts that never picked an industry keep the standard menu.
const INDUSTRY_MENU = {
  general: ['/funnels', '/hive', '/contacts', '/webinars', '/products', '/school', '/orders', '/automations'],
  realestate: ['/funnels', '/hive', '/contacts', '/bookings', '/quotes', '/ads', '/automations', '/broadcasts'],
  clinic: ['/funnels', '/hive', '/contacts', '/bookings', '/orders', '/automations', '/broadcasts'],
  consultant: ['/funnels', '/hive', '/contacts', '/quotes', '/bookings', '/automations', '/vault'],
  education: ['/funnels', '/hive', '/contacts', '/webinars', '/bookings', '/orders', '/automations', '/broadcasts'],
  fitness: ['/funnels', '/hive', '/contacts', '/bookings', '/orders', '/automations', '/broadcasts'],
  finance: ['/funnels', '/hive', '/contacts', '/bookings', '/quotes', '/vault', '/automations'],
  interior: ['/funnels', '/hive', '/contacts', '/bookings', '/quotes', '/vault', '/automations'],
  events: ['/funnels', '/hive', '/contacts', '/quotes', '/bookings', '/vault', '/automations'],
  travel: ['/funnels', '/hive', '/contacts', '/quotes', '/orders', '/automations', '/broadcasts'],
  auto: ['/funnels', '/hive', '/contacts', '/bookings', '/quotes', '/ads', '/automations'],
  professional: ['/funnels', '/hive', '/contacts', '/quotes', '/bookings', '/vault', '/automations'],
  recruitment: ['/funnels', '/hive', '/contacts', '/bookings', '/vault', '/automations'],
  homeservices: ['/funnels', '/hive', '/contacts', '/bookings', '/quotes', '/ads', '/automations'],
  hospitality: ['/funnels', '/hive', '/contacts', '/bookings', '/orders', '/automations', '/broadcasts'],
  store: ['/funnels', '/hive', '/orders', '/reports', '/products', '/ads', '/contacts', '/automations', '/broadcasts'],
  manufacturer: ['/tally', '/contacts', '/quotes', '/hive', '/funnels', '/inbox', '/broadcasts', '/automations'],
  retailer: ['/tally', '/contacts', '/inbox', '/broadcasts', '/hive', '/funnels', '/orders', '/automations'],
  distributor: ['/tally', '/contacts', '/inbox', '/quotes', '/broadcasts', '/hive', '/automations'],
  abroad: ['/funnels', '/hive', '/contacts', '/webinars', '/bookings', '/vault', '/automations'],
  wellness: ['/funnels', '/hive', '/contacts', '/bookings', '/webinars', '/orders', '/automations'],
  saas: ['/funnels', '/hive', '/contacts', '/webinars', '/bookings', '/quotes', '/automations'],
  ngo: ['/funnels', '/hive', '/contacts', '/orders', '/broadcasts', '/automations'],
};
const everyday = (me) => {
  const m = me?.nav?.clientMenu || INDUSTRY_MENU[me?.nav?.industry];
  return m ? ['/', ...m] : CORE;
};
// the words a business uses: the CRM is "Patients" / "Students" / "Buyers"…, bookings are "Site visits", "Demo classes"…
const BOOKING_WORD = { realestate: 'Site visits', clinic: 'Appointments', education: 'Demo classes', fitness: 'Appointments', interior: 'Site visits', auto: 'Test drives', homeservices: 'Site surveys', recruitment: 'Interviews', abroad: 'Counselling', wellness: 'Sessions', saas: 'Demos', consultant: 'Meetings', finance: 'Meetings', professional: 'Consultations' };
const labelOf = (to, me) => {
  const kit = me?.settings?.crmKit, id = me?.nav?.industry;
  if (to === '/contacts' && kit?.labels?.title && id && id !== 'general') return kit.labels.title;
  if (to === '/bookings' && BOOKING_WORD[id]) return BOOKING_WORD[id];
  return PAGES[to][1];
};
const ACCOUNT = ['/settings', '/billing', '/agency', '/admin'];
const USED = { '/inbox': 'inbox', '/chatbots': 'inbox', '/products': 'products', '/quotes': 'quotes', '/bookings': 'bookings', '/webinars': 'webinars', '/automations': 'automations', '/broadcasts': 'broadcasts' };
// which permission areas (custom team roles) open each page
const PAGE_AREAS = { '/inbox': ['inbox'], '/chatbots': ['inbox'], '/funnels': ['funnels'], '/templates': ['funnels'], '/hive': ['ai'], '/orders': ['orders'], '/reports': ['dashboard'], '/ads': ['ads'], '/products': ['products'], '/school': ['products'], '/quotes': ['quotes'], '/tally': ['tally'], '/contacts': ['crm'], '/vault': ['files', 'secrets'], '/automations': ['automations'], '/broadcasts': ['broadcasts'], '/bookings': ['bookings'], '/webinars': ['webinars'], '/settings': ['settings', 'team'] };
const NAV_KEY = 'ff_nav';
const navLocal = () => { try { return { pinned: [], hidden: [], closed: [], ...JSON.parse(localStorage.getItem(NAV_KEY) || '{}') }; } catch { return { pinned: [], hidden: [], closed: [] }; } };
// pages a person may open here (a team member doesn't see the owner's billing; one limited to some funnels sees only those)
const allowed = (to, me) => {
  if (to === '/admin') return !!me?.admin;
  if (to === '/tally' && !me?.nav?.tally) return false; // an add-on we switch on per account
  // a sub-account (a client of an agency / partner) has no agency tools of its own; its billing page shows its plan
  if (!me?.workspace) return !(to === '/agency' && me?.billing?.agencyManaged) && !(to === '/billing' && me?.billing?.agencyManaged && !me?.billing?.resold);
  if (to === '/billing' || to === '/agency') return false;
  if (me.workspace.funnelIds) return to === '/' || to === '/funnels'; // limited to some funnels: nothing account-wide
  if (me.workspace.custom) { // a custom role: the pages its areas can at least view (the server enforces it)
    const p = me.perms || {}, can = (...k) => k.some((x) => p[x] && p[x] !== 'none');
    return to === '/' || (PAGE_AREAS[to] ? can(...PAGE_AREAS[to]) : false);
  }
  if (to === '/vault') return me.workspace.role !== 'viewer';
  return to !== '/settings' || ['admin', 'agency'].includes(me.workspace.role);
};
// a tool is in the menu when it's an everyday page, you use it, you pinned it, or you're on it — unless you hid it
const inMenu = (to, me, p, here) => allowed(to, me) && !p.hidden.includes(to) && (everyday(me).includes(to) || p.pinned.includes(to) || !!me?.nav?.used?.[USED[to]] || (to === '/tally' && !!me?.nav?.tally) || here === to);
const badgeOf = (to, me) => (to === '/orders' && me?.nav?.ship ? [me.nav.ship, t('{n} to ship', { n: me.nav.ship })] : to === '/bookings' && me?.nav?.calls ? [me.nav.calls, t(me.nav.calls > 1 ? '{n} calls in the next 24 hours' : '{n} call in the next 24 hours', { n: me.nav.calls })] : null);

function SideNav({ me, onGo }) {
  // the layout is saved on your account (so it follows you to every device); this browser keeps a copy
  const [p, setP] = useState(() => ({ pinned: [], hidden: [], closed: [], ...(me?.nav?.prefs || navLocal()) }));
  const fromServer = me?.nav?.prefs ? JSON.stringify(me.nav.prefs) : '';
  useEffect(() => { if (fromServer) setP({ pinned: [], hidden: [], closed: [], ...JSON.parse(fromServer) }); }, [fromServer]);
  const [more, setMore] = useState(false);
  const here = '/' + (location.pathname.split('/')[1] || '');
  const save = (n) => { setP(n); try { localStorage.setItem(NAV_KEY, JSON.stringify(n)); } catch {} api('/me/menu', 'PUT', n).catch(() => {}); };
  const custom = p.pinned.length > 0 || p.hidden.length > 0;
  const kitName = me?.nav?.clientMenu ? null : me?.nav?.industry && me?.settings?.crmKit?.name;
  const toggleGroup = (g) => save({ ...p, closed: p.closed.includes(g) ? p.closed.filter((x) => x !== g) : [...p.closed, g] });
  const setShown = (to, on) => save({ ...p, pinned: on ? [...new Set([...p.pinned, to])] : p.pinned.filter((x) => x !== to), hidden: on ? p.hidden.filter((x) => x !== to) : [...new Set([...p.hidden, to])] });
  const waiting = TOOLS.filter((to) => allowed(to, me) && !inMenu(to, me, p, here));
  const link = (to) => {
    const ic = PAGES[to][0], b = badgeOf(to, me);
    return <NavLink key={to} to={to} end={to === '/'} onClick={onGo} title={t(labelOf(to, me))}><Icon name={ic} /><span className="nav-l">{t(labelOf(to, me))}</span>{b && <span className="nav-badge" title={b[1]}>{b[0]}</span>}</NavLink>;
  };
  return (
    <nav>
      {GROUPS.map(([g, list]) => {
        const items = list.filter((to) => inMenu(to, me, p, here));
        if (!items.length) return null;
        if (!g) return <div key="main" className="nav-g">{items.map(link)}</div>;
        const shut = p.closed.includes(g) && !items.includes(here);
        return (
          <div key={g} className="nav-g">
            <button type="button" className="nav-gh" aria-expanded={!shut} onClick={() => toggleGroup(g)}>{t(g)}<Icon name="chevron" size={12} className={shut ? 'nav-chev' : 'nav-chev open'} /></button>
            {!shut && items.map(link)}
          </div>
        );
      })}
      <div className="nav-more">
        <button type="button" className={`nav-more-b ${more ? 'on' : ''}`} onClick={() => setMore(!more)} aria-expanded={more}><Icon name="plus" />{t('More tools')}{waiting.length > 0 && <span className="nav-n">{waiting.length}</span>}</button>
        {more && (
          <div className="nav-pop" role="dialog" aria-label={t('More tools')}>
            <p className="nav-pop-h">{kitName ? t('Your menu is set up for {k}. Tick any tool to show it, untick to tuck it away — tools also join once you start using them.', { k: kitName }) : t('Tools join your menu once you start using them. Tick one to keep it there, untick to tuck it away.')}</p>
            {custom && <button type="button" className="btn ghost sm nav-reset" onClick={() => save({ ...p, pinned: [], hidden: [] })}>{t(kitName ? 'Reset to my industry’s menu' : 'Reset the menu')}</button>}
            {TOOLS.filter((to) => allowed(to, me)).map((to) => {
              const [ic, , desc] = PAGES[to], label = labelOf(to, me), on = inMenu(to, me, p, null);
              return (
                <div key={to} className="nav-tool">
                  <Link to={to} onClick={() => { setMore(false); onGo?.(); }}><Icon name={ic} size={16} /><span><b>{t(label)}</b><small>{t(desc)}</small></span></Link>
                  <label className="nav-pin" title={t(on ? 'Remove from the menu' : 'Keep in the menu')}><input type="checkbox" checked={on} onChange={(e) => setShown(to, e.target.checked)} />{t('In menu')}</label>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}

function ProfileMenu({ me, onGo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => { if (!open) return undefined; const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const go = () => { setOpen(false); onGo?.(); };
  return (
    <div className="me-wrap" ref={ref}>
      {open && (
        <div className="me-menu" role="menu">
          {ACCOUNT.filter((to) => allowed(to, me)).map((to) => <Link key={to} role="menuitem" to={to} onClick={go}><Icon name={PAGES[to][0]} size={15} />{t(PAGES[to][1])}</Link>)}
          <hr />
          <button type="button" role="menuitem" onClick={() => { toggleLook(); setOpen(false); }}><Icon name="palette" size={15} />{t(currentLook() === 'glass' ? 'Switch to the standard look' : 'Switch to Liquid Glass')}</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new Event('ff:jump')); }}><Icon name="search" size={15} />{t('Jump to…')}<kbd>Ctrl K</kbd></button>
          <button type="button" role="menuitem" onClick={logout}><Icon name="logout" size={15} />{t('Log out')}</button>
        </div>
      )}
      <button type="button" className="me" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={t('Settings, billing and your account')}>
        <span className="me-av">{(me?.name || '?')[0]?.toUpperCase()}</span>
        <div><b>{me?.name}</b><small>{me?.email}</small></div>
        <Icon name="settings" size={16} />
      </button>
    </div>
  );
}

// Ctrl+K: type a page or funnel name and jump there
function Jump({ me }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [funnels, setFunnels] = useState(null);
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); } };
    const j = () => setOpen(true);
    window.addEventListener('keydown', k); window.addEventListener('ff:jump', j);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('ff:jump', j); };
  }, []);
  useEffect(() => { if (open) { setQ(''); setSel(0); if (!funnels) api('/funnels').then(setFunnels).catch(() => setFunnels([])); } }, [open]);
  if (!open) return null;
  const s = q.trim().toLowerCase();
  const pages = Object.entries(PAGES).filter(([to]) => allowed(to, me)).map(([to, [ic, , desc]]) => ({ to, ic, label: t(labelOf(to, me)), desc: t(desc) }));
  const fl = (funnels || []).map((f) => ({ to: `/funnels/${f.id}`, ic: 'funnel', label: f.name, desc: t(f.published ? 'Funnel · live' : 'Funnel · draft') }));
  const hits = [...pages, ...fl].filter((x) => !s || `${x.label} ${x.desc}`.toLowerCase().includes(s)).slice(0, 9);
  const go = (x) => { if (!x) return; setOpen(false); nav(x.to); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') go(hits[sel]);
    else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <div className="m-scrim jump-scrim" onMouseDown={() => setOpen(false)}>
      <div className="jump" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('Jump to')}>
        <div className="jump-in"><Icon name="search" size={17} /><input autoFocus value={q} placeholder={t('Jump to a page or funnel…')} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={key} /><kbd>Esc</kbd></div>
        <div className="jump-list">{hits.length ? hits.map((x, i) => <button type="button" key={x.to} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(x)}><Icon name={x.ic} size={16} /><span><b>{x.label}</b><small>{x.desc}</small></span></button>) : <p className="muted sm">{t('Nothing matches “{q}”.', { q })}</p>}</div>
      </div>
    </div>
  );
}

// The bell: new orders, leads, bookings, quotes, failed payments. Checked every minute while the tab is open.
const NOTE_ICON = { order: 'cart', lead: 'users', booking: 'clock', booking_cancelled: 'x', quote_paid: 'wallet', quote_accepted: 'check', quote_declined: 'x', payment_failed: 'card', refund: 'refund', whatsapp: 'chat' };
function Bell({ me }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef();
  const load = () => api('/notifications').then((r) => { setItems(r.items); setUnread(r.unread); }).catch(() => {});
  useEffect(() => { if (me?.nav) setUnread(me.nav.unread || 0); }, [me]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60000);
    const v = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, []);
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => { if (!open) return undefined; const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  // "(3) FunnelHive" in the browser tab
  useEffect(() => { const base = document.title.replace(/^\(\d+\+?\) /, ''); document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base; }, [unread, me]);
  const read = (body) => api('/notifications/read', 'POST', body).then((r) => setUnread(r.unread)).catch(() => {});
  const go = (n) => {
    setOpen(false);
    if (!n.read) { setItems((l) => l?.map((x) => (x.id === n.id ? { ...x, read: true } : x))); read({ ids: [n.id] }); }
    if (n.link) nav(n.link);
  };
  const all = () => { setItems((l) => l?.map((x) => ({ ...x, read: true }))); read({ all: true }); };
  return (
    <div className="bell-wrap" ref={ref}>
      <button type="button" className="icon-btn bell" onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title={unread ? t(unread > 1 ? '{n} new notifications' : '{n} new notification', { n: unread }) : t('Notifications')} aria-label={unread ? t(unread > 1 ? '{n} new notifications' : '{n} new notification', { n: unread }) : t('Notifications')}>
        <Icon name="bell" />{unread > 0 && <span className="bell-n">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label={t('Notifications')}>
          <div className="bell-h"><b>{t('Notifications')}</b>{unread > 0 && <button type="button" onClick={all}>{t('Mark all read')}</button>}</div>
          <div className="bell-list">
            {!items ? <p className="muted sm">{t('Loading…')}</p> : !items.length ? <p className="muted sm">{t('Nothing yet. New orders, leads and bookings show up here.')}</p> : items.map((n) => (
              <button type="button" key={n.id} className={`bell-item ${n.read ? '' : 'new'} k-${n.kind}`} onClick={() => go(n)}>
                <span className="bell-ic"><Icon name={NOTE_ICON[n.kind] || 'bolt'} size={15} /></span>
                <span className="bell-t"><b>{n.title}</b>{n.body && <small>{n.body}</small>}<em>{ago(n.at)}</em></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "Build with AI" in a module: one sentence → a draft the seller checks (onDraft(prompt) does the work and may throw)
export function AiPrompt({ title = 'Build with AI', hint, placeholder, ideas = [], onDraft, action = 'Draft it', compact }) {
  const [p, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e?.preventDefault();
    if (p.trim().length < 8) return toast(t('Describe it in a sentence'));
    setBusy(true);
    try { await onDraft(p.trim()); setP(''); } catch (er) { toast(er.message); }
    setBusy(false);
  };
  return (
    <form className={`ai-bar ${compact ? 'compact' : ''}`} onSubmit={go}>
      <div className="ai-bar-h"><span className="ai-bar-ic"><Icon name="sparkles" size={15} /></span><b>{t(title)}</b>{hint && <small>{t(hint)}</small>}</div>
      <div className="ai-bar-in"><input value={p} onChange={(e) => setP(e.target.value)} placeholder={placeholder} disabled={busy} aria-label={t(title)} /><button className="btn ai" disabled={busy || p.trim().length < 8}>{busy ? <><span className="spin" />{t('Drafting…')}</> : <><Icon name="wand" size={15} />{t(action)}</>}</button></div>
      {ideas.length > 0 && !busy && <div className="ai-bar-ideas">{ideas.map((x) => <button type="button" key={x} onClick={() => setP(x)}>{x}</button>)}</div>}
    </form>
  );
}

// the main menu folded to icons (every screen, remembered in this browser)
export const sideMini = () => { try { return localStorage.getItem('ff_side_mini') === '1'; } catch { return false; } };

// a screen whose data didn't load: Layout shows a banner with Reload instead of an endless skeleton
export const loadFailed = () => window.dispatchEvent(new Event('ff:loadfail'));

export function Layout({ title, subtitle, actions, children, wide }) {
  const [me, setMe] = useState(meCache.data);
  const [loadFail, setLoadFail] = useState(false);
  useEffect(() => { const h = () => setLoadFail(true); window.addEventListener('ff:loadfail', h); return () => window.removeEventListener('ff:loadfail', h); }, []);
  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(sideMini);
  const fold = () => setMini((m) => { const n = !m; try { localStorage.setItem('ff_side_mini', n ? '1' : ''); } catch { /* private mode */ } window.dispatchEvent(new Event('ff:side')); return n; });
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { e.preventDefault(); fold(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const [paywall, setPaywall] = useState(null);
  useEffect(() => { (Date.now() - meCache.at < 30000 ? Promise.resolve(meCache.data) : api('/me').then((m) => { Object.assign(meCache, { data: m, at: Date.now() }); return m; })).then((m) => { setMe(m); if (m.brand) document.title = m.brand; if (m.whiteLabel?.primary) document.documentElement.style.setProperty('--primary', m.whiteLabel.primary); if (m.pagesUrl) window.__PAGES_URL__ = m.pagesUrl; window.__FF_BIZ_TZ__ = m.settings?.timezone || 'Asia/Kolkata'; if (m.uiLang) setUiLang(m.uiLang); }).catch(() => {}); }, []);
  useEffect(() => { applyUiLang(); }, []);
  useEffect(() => { const h = (e) => setPaywall(e.detail || {}); window.addEventListener('ff:paywall', h); return () => window.removeEventListener('ff:paywall', h); }, []);
  return (
    <div className={`app ${mini ? 'mini' : ''}`}>
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">{me?.whiteLabel?.logo ? <img className="logo img" src={me.whiteLabel.logo} alt="" /> : <span className="logo" style={me?.whiteLabel?.primary ? { background: me.whiteLabel.primary } : undefined}><Icon name="bolt" size={18} /></span>}<span className="brand-n">{me?.brand || BRAND}</span><button type="button" className="side-fold" onClick={fold} title={t(mini ? 'Show the menu (Ctrl+B)' : 'Fold the menu to icons (Ctrl+B)')} aria-label={t(mini ? 'Show the menu' : 'Fold the menu')}><Icon name="panel" size={16} /></button></div>
        <button type="button" className="side-jump" onClick={() => window.dispatchEvent(new Event('ff:jump'))}><Icon name="search" size={15} />{t('Jump to…')}<kbd>Ctrl K</kbd></button>
        <SideNav me={me} onGo={() => setOpen(false)} />
        <div className="side-foot">
          <WorkspaceSwitch me={me} />
          {me?.billing?.status === 'trialing' && !me.workspace && !me.billing.agencyManaged && <Link to="/billing" className="trial-chip"><Icon name="clock" size={14} />{t(me.billing.daysLeft === 1 ? '{n} day left in trial' : '{n} days left in trial', { n: me.billing.daysLeft })}<b>{t('Upgrade')}</b></Link>}
          <div className={`ai-status ${me?.aiEnabled ? 'on' : ''}`}><Icon name="sparkles" size={14} />{me?.aiEnabled ? (me.credits?.limit == null ? t('AI · unlimited') : t('AI · {n} credits left', { n: Math.max(0, me.credits.limit - me.credits.used) })) : t('Offline AI assistant')}</div>
          <ProfileMenu me={me} onGo={() => setOpen(false)} />
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn burger" aria-label={t('Open menu')} onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="tb-title">{title && <h1>{title}</h1>}{subtitle && <p>{subtitle}</p>}</div>
          <div className="tb-actions">{actions}</div>
          {me && <Bell me={me} />}
        </header>
        {loadFail && <div className="app-banner bad" role="alert"><span>Part of this page didn’t load — check your connection.</span><button onClick={() => location.reload()}>Reload</button></div>}
        {me?.workspace && <div className="app-banner info ws"><Icon name="users" size={15} /><span>{tx('You’re working in the {name} workspace as {role}.', { name: <b>{me.workspace.name}</b>, role: (t(({ admin: 'an admin', marketer: 'a marketer', sales: 'sales & support', viewer: 'a viewer', agency: 'their agency' })[me.workspace.role] || '') || me.workspace.roleName || '') })}</span></div>}
        {me?.impersonating && <div className="app-banner imp"><Icon name="eye" size={15} /><span>{tx('You’re signed in as {email} (support view).', { email: <b>{me.email}</b> })}</span><button onClick={stopImpersonating}>{t('Back to admin')}</button></div>}
        {me?.announcement && <div className="app-banner info"><Icon name="bolt" size={15} />{me.announcement}</div>}
        {me?.billing && !me.billing.ok && <div className="app-banner bad"><Icon name="clock" size={15} />{me.billing.reason || t('Your account is read-only.')}{me.billing.status !== 'suspended' && <span>{me.billing.pagesLive ? t(' Your live pages stay up until {date}.', { date: fmtDate(me.billing.pagesOfflineAt) }) : t(' Your live pages are offline.')}</span>}{me.billing.status !== 'suspended' && <Link to="/billing">{t('Choose a plan')}</Link>}</div>}
        {me && !me.emailVerified && <VerifyBanner me={me} />}
        <div className={`content ${wide ? 'wide' : ''}`}>{typeof children === 'function' ? children(me) : children}</div>
      </main>
      {paywall && <Paywall info={paywall} onClose={() => setPaywall(null)} />}
      <Jump me={me} />
    </div>
  );
}

function Paywall({ info, onClose }) {
  const nav = useNavigate();
  return (
    <Modal title={t(info.credits ? 'AI credits used up' : 'Choose a plan to continue')} onClose={onClose} width={460}>
      <div className="paywall">
        <span className="empty-ic"><Icon name={info.credits ? 'sparkles' : 'card'} size={26} /></span>
        <p>{info.error}</p>
        {info.credits ? <p className="muted sm">{t('You can keep editing by hand — everything except AI works as usual.')}</p> : <p className="muted sm">{t('Everything you’ve built is safe. Subscribe to keep editing, publishing and running automations.')}</p>}
        <div className="row center">{!info.credits && <button className="btn primary" onClick={() => { onClose(); nav('/billing'); }}>{t('See plans')}</button>}<button className="btn ghost" onClick={onClose}>{t('Close')}</button></div>
      </div>
    </Modal>
  );
}

function VerifyBanner({ me }) {
  const [sent, setSent] = useState('');
  const resend = async () => { const r = await api('/auth/resend-verification', 'POST'); setSent(t(r.emailConfigured ? 'Sent! Check your inbox.' : 'Email isn’t configured on this server — the link was printed in the server console.')); };
  return <div className="verify-banner"><Icon name="send" size={15} /><span>{tx('Please verify {email} so you can recover your account.', { email: <b>{me.email}</b> })}</span>{sent ? <span>{sent}</span> : <button onClick={resend}>{t('Resend link')}</button>}</div>;
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

// Open dialogs, topmost last — only the top one answers Esc and keeps Tab inside it
const layers = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function useDialogFocus(ref, onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement : null)); // read before autoFocus moves it
  useEffect(() => {
    const me = {}, box = ref.current;
    layers.push(me);
    if (!box.contains(document.activeElement)) box.focus(); // children with autoFocus keep it
    const k = (e) => {
      if (layers[layers.length - 1] !== me) return;
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (!box.contains(at)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (at === first || at === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      layers.splice(layers.indexOf(me), 1);
      if (opener?.isConnected && opener.focus) opener.focus(); // back to the button that opened it
    };
  }, []);
}

export function Modal({ title, onClose, children, width = 640 }) {
  const ref = useRef(null), id = useId();
  useDialogFocus(ref, onClose);
  return (
    <div className="m-scrim" onMouseDown={onClose}>
      <div className="m-box" ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="m-head"><h3 id={`${id}-t`}>{title}</h3><button className="icon-btn" aria-label={t('Close')} onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

// ---------- confirm / prompt / alert (in place of the browser's own boxes) ----------
// Each call mounts its own small React root, so it works on buyer pages without the app layout too.
// buyer: true styles it like the buyer pages (library, bookings, quotes) and takes their accent colour.
function Dialog({ kind, title, text, label, placeholder, type = 'text', value = '', confirm, cancel, danger, confirmWord, readOnly, buyer, done }) {
  // buyer pages follow their own language — the dashboard's language only changes the seller's own dialogs
  const L = buyer ? (s) => s : t;
  if (cancel === undefined) cancel = L('Cancel');
  const [v, setV] = useState(value ?? '');
  const ref = useRef(null), id = useId();
  const ok = kind !== 'prompt' || !confirmWord || v.trim() === confirmWord;
  const no = () => done(kind === 'prompt' ? null : kind === 'confirm' ? false : undefined);
  const yes = () => ok && done(kind === 'prompt' ? (confirmWord ? v.trim() : v) : kind === 'confirm' ? true : undefined);
  useDialogFocus(ref, no);
  const acc = buyer ? getComputedStyle(document.querySelector('.lib') || document.body).getPropertyValue('--acc').trim() : '';
  const b = (cls) => (buyer ? `lib-btn ${cls === 'ghost' ? 'ghost' : ''}` : `btn ${cls}`);
  return (
    <div className={`dlg-scrim${buyer ? ' buyer' : ''}`} style={acc ? { '--acc': acc } : undefined} onMouseDown={no}>
      <div className="dlg" ref={ref} role={kind === 'alert' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={`${id}-${title ? 't' : 'd'}`} aria-describedby={title && text ? `${id}-d` : undefined} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        {title && <h3 id={`${id}-t`}>{title}</h3>}
        {text && <p id={`${id}-d`} className="dlg-text">{text}</p>}
        {kind === 'prompt' && (
          <label className="dlg-field">
            {(label || confirmWord) && <span>{label || (buyer ? <>Type <b>{confirmWord}</b> to confirm</> : tx('Type {word} to confirm', { word: <b>{confirmWord}</b> }))}</span>}
            <input autoFocus type={type} value={v} placeholder={placeholder} readOnly={readOnly} onFocus={readOnly ? (e) => e.target.select() : undefined} autoComplete={type === 'password' ? 'current-password' : 'off'} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); yes(); } }} />
          </label>
        )}
        <div className="dlg-foot">
          {kind !== 'alert' && cancel && <button type="button" className={b('ghost')} onClick={no}>{cancel}</button>}
          <button type="button" autoFocus={kind !== 'prompt'} className={`${b('primary')}${danger ? ' dlg-danger' : ''}`} disabled={!ok} onClick={yes}>{confirm || L(kind === 'alert' ? 'OK' : kind === 'prompt' ? 'Continue' : 'Confirm')}</button>
        </div>
      </div>
    </div>
  );
}
function openDialog(kind, opts) {
  const o = typeof opts === 'string' ? { text: opts } : opts || {};
  return new Promise((resolve) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    let settled = false;
    // Unmount first (focus goes back to the opener), then answer — so a follow-up dialog opens from the right place
    const done = (v) => { if (settled) return; settled = true; setTimeout(() => { root.unmount(); el.remove(); resolve(v); }); };
    root.render(<Dialog kind={kind} {...o} done={done} />);
  });
}
// confirmDialog({ title, text, confirm: 'Delete', danger: true }) → true / false
export const confirmDialog = (o) => openDialog('confirm', o);
// promptDialog({ title, text, label, placeholder, value, type: 'text' | 'password', confirmWord, readOnly }) → the text, or null if cancelled
// (confirmWord keeps the button off until it's typed; readOnly shows a value to copy; cancel: null hides Cancel)
export const promptDialog = (o) => openDialog('prompt', o);
// alertDialog({ title, text }) → resolves when closed
export const alertDialog = (o) => openDialog('alert', o);

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
  <div className="seg">{RANGES.map(([d, l]) => <button key={d} className={value === d ? 'on' : ''} onClick={() => onChange(d)}>{t(l)}</button>)}</div>
);

// ---------- Create funnel (AI / template / blank) ----------
const EXAMPLES = ['Online yoga classes for working women, ₹499', 'Homemade mango pickles delivered across India', 'UPSC coaching with personal mentorship', 'Rooftop solar installation in Pune', 'Bridal makeup artist in Jaipur', 'Stock market course for beginners'];
// Drafting a funnel with AI (about a minute): stage, seconds and progress — used by the "New funnel" dialog and the dashboard prompt
const DRAFT_STAGES = [[0, 'Understanding your offer'], [6, 'Planning the funnel steps'], [14, 'Writing the sales page'], [26, 'Writing checkout, bump & upsell'], [38, 'Writing the thank-you page'], [48, 'Quality-checking every section'], [62, 'Almost there — polishing the copy']];
// Before drafting, a vague brief ("free guide that grows my email list") gets a few quick questions so the page
// is about the seller's business, not the nearest template. `asking` holds them until answered or skipped.
export function useFunnelDraft() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [asking, setAsking] = useState(null);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  useEffect(() => { if (!busy) return undefined; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);
  const stage = [...DRAFT_STAGES].reverse().find(([s]) => secs >= s)[1];
  const progress = Math.min(95, Math.round((secs / 70) * 100));
  const build = async (prompt, lang, design) => {
    setAsking(null); setBusy(true); setErr('');
    try {
      const r = await api('/ai/generate', 'POST', { prompt, lang, ...design });
      if (r.usedAI && r.quality) toast(r.quality.finalIssues === 0 ? t('Quality check passed — {n} pages ready', { n: r.steps.length }) : t('Funnel ready — review the highlighted sections'));
      nav(`/funnels/${r.id}`);
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  // the brief with the answers so far, as the builder gets it
  const full = (a) => (a.answers.length ? `${a.prompt}\n\nMore details:\n${a.answers.map((x) => `- ${x.q} ${x.a}`).join('\n')}` : a.prompt);
  // one question at a time: the next one is chosen from the brief and every answer so far
  const ask = async (st) => {
    setChecking(true); setErr('');
    let c = { ready: true };
    try { c = await api('/ai/clarify', 'POST', { prompt: st.prompt, answers: st.answers }); } catch { /* the check is a nicety: build anyway */ }
    setChecking(false);
    if (c.ready || !c.question) return build(full(st), st.lang, st.design);
    setAsking({ ...st, understood: c.understood || st.understood || '', question: c.question, max: c.max || 4 });
  };
  const start = (prompt, lang = 'en', design = {}) => ask({ prompt, lang, design, answers: [] });
  const answer = (a) => { const v = String(a || '').trim(); if (!v || !asking) return; ask({ ...asking, answers: [...asking.answers, { q: asking.question.q, a: v, question: asking.question }] }); };
  const back = () => { if (!asking?.answers.length) return setAsking(null); const prev = asking.answers.at(-1); setAsking({ ...asking, answers: asking.answers.slice(0, -1), question: prev.question || { id: 'prev', q: prev.q, options: [] }, retype: prev.question?.options?.includes(prev.a) ? '' : prev.a }); };
  const skip = () => build(full(asking), asking.lang, asking.design);
  return { busy, checking, asking, err, secs, stage: t(stage), progress, start, answer, skip, back, cancel: () => setAsking(null) };
}

// One question at a time for a vague brief: tap an option or type your own, then the next one
export function BriefQuestions({ draft }) {
  const { understood, question: q, answers, max, retype } = draft.asking;
  const [typed, setTyped] = useState(retype || '');
  const ref = useRef();
  useEffect(() => { setTyped(retype || ''); ref.current?.focus(); }, [q.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (v) => draft.answer(v);
  return (
    <div className="brief-q" key={q.q}>
      <div className="bq-head"><Icon name="sparkles" size={16} /><div><b>{answers.length ? t('One more thing') : t('A quick question first')}</b><small>{understood || t('So the page is about your business — not a guess.')}</small></div></div>
      {answers.length > 0 && <div className="bq-done">{answers.map((x, i) => <span key={i} title={x.q}>✓ {x.a}</span>)}</div>}
      <form className="bq-item" onSubmit={(e) => { e.preventDefault(); go(typed); }}>
        <label htmlFor="bq-a">{q.q}</label>
        {!!q.options?.length && <div className="bq-opts">{q.options.map((o) => <button type="button" key={o} disabled={draft.checking} onClick={() => go(o)}>{o}</button>)}</div>}
        <div className="bq-type"><input ref={ref} id="bq-a" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={q.options?.length ? t('Or type your own answer') : t('Type your answer')} disabled={draft.checking} /><button className="btn primary" disabled={!typed.trim() || draft.checking}>{draft.checking ? <span className="spin" /> : t('Next')}</button></div>
      </form>
      <div className="bq-foot">
        <span className="bq-step">{t('Question {n} of up to {m}', { n: answers.length + 1, m: max })}</span>
        {answers.length > 0 && <button type="button" className="linkish" onClick={draft.back}>{t('Back')}</button>}
        <button type="button" className="linkish" onClick={draft.skip}>{t('Skip — build with what I’ve told you')}</button>
        <button type="button" className="linkish" onClick={draft.cancel}>{t('Edit my description')}</button>
      </div>
    </div>
  );
}

// The seller's design picks: page length, look and brand colour ('' = Hive AI picks)
export const PAGE_LOOKS = [['', 'Let AI pick'], ['aurora', 'Soft gradients'], ['clean', 'Clean & minimal'], ['midnight', 'Dark & glowing'], ['bold', 'Bold & loud'], ['luxe', 'Premium cream'], ['fresh', 'Fresh & friendly'], ['organic', 'Warm & earthy'], ['pastel', 'Pastel'], ['royal', 'Royal & gold'], ['editorial', 'Magazine'], ['noir', 'Black & white'], ['glass', 'Frosted glass'], ['tech', 'Tech / neon'], ['playful', 'Playful'], ['swiss', 'Swiss grid'], ['studio', 'Modern studio']];
const LENGTHS = [['short', 'Short', 'About 7 sections — a quick read'], ['standard', 'Standard', 'About 11 sections'], ['detailed', 'Detailed', 'Long-form: every section']];
export const DEFAULT_DESIGN = { length: 'standard', style: '', primary: '' };
export function DesignPicker({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="design-pick">
      <div className="dp-row"><span>{t('Page length')}</span><div className="seg">{LENGTHS.map(([k, l, h]) => <button type="button" key={k} title={t(h)} className={value.length === k ? 'on' : ''} onClick={() => set('length', k)}>{t(l)}</button>)}</div></div>
      <div className="dp-row"><span>{t('Look')}</span><select value={value.style} onChange={(e) => set('style', e.target.value)} aria-label={t('Page look')}>{PAGE_LOOKS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
      <div className="dp-row"><span>{t('Brand colour')}</span>
        <label className="dp-color"><input type="checkbox" checked={!!value.primary} onChange={(e) => set('primary', e.target.checked ? '#6366f1' : '')} />{value.primary ? <input type="color" value={value.primary} onChange={(e) => set('primary', e.target.value)} aria-label={t('Brand colour')} /> : <small>{t('Let AI pick')}</small>}</label>
      </div>
    </div>
  );
}
export const DRAFT_EXAMPLES = EXAMPLES;

export function CreateFunnel({ onClose, aiEnabled }) {
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [lang, setLang] = useState('en');
  const [design, setDesign] = useState(DEFAULT_DESIGN);
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);
  const draft = useFunnelDraft();
  const { busy, checking, err, secs, stage, progress, start } = draft;
  const gen = (e) => { e?.preventDefault(); start(prompt, lang, design); };
  const blank = async () => nav(`/funnels/${(await api('/funnels', 'POST', { name: 'Untitled funnel' })).id}`);
  return (
    <Modal title={t('Create a new funnel')} onClose={onClose} width={720}>
      {draft.asking && !busy ? <div className="create-ai"><BriefQuestions draft={draft} /></div> : (
      <form className="create-ai" onSubmit={gen}>
        <div className="ca-badge"><Icon name="sparkles" size={14} /> {t('AI funnel builder')}</div>
        <h2>{t('Describe your business in one line')}</h2>
        <p className="muted">{t('We’ll build the landing page, checkout, upsell, downsell, cross-sells and thank-you page — with copy, FOMO and pricing.')}</p>
        <textarea ref={ref} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('e.g. Online yoga classes for working women, ₹499')} />
        <label className="lang-pick">{t('Page language')} <select value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option></select></label>
        <DesignPicker value={design} onChange={setDesign} />
        <div className="sugg">{EXAMPLES.map((x) => <button type="button" key={x} onClick={() => setPrompt(x)}>{x}</button>)}</div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary lg" disabled={busy || checking || prompt.length < 5}>{busy ? <><span className="spin" /> {stage}… <small className="gen-secs">{secs}s</small></> : checking ? <><span className="spin" /> {t('Reading your description…')}</> : <><Icon name="wand" /> {t('Generate my funnel')}</>}</button>
        {busy && <div className="gen-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>}
        {busy && <p className="hint">{t('Hive AI writes every page, then checks each one against our template quality bar — about a minute. Keep this window open.')}</p>}
        {!aiEnabled && <p className="hint">{t('Running offline: we’ll match your description to the best of our 100+ expert templates. Fully custom AI copy turns on when full AI is enabled.')}</p>}
      </form>
      )}
      <div className="create-alt">
        <button onClick={() => nav('/templates')}><Icon name="layout" /><div><b>{t('Pick a template')}</b><small>{t('100+ proven designs: sales, VSL & webinar funnels')}</small></div></button>
        <button onClick={blank}><Icon name="plus" /><div><b>{t('Start from scratch')}</b><small>{t('Blank page with drag & drop')}</small></div></button>
      </div>
    </Modal>
  );
}

// ---------- Hive WhatsApp's approved templates, for automations and broadcasts ----------
// fetched once a minute at most; null while loading, or when Hive WhatsApp isn't in use (then a name is typed as before)
let waTpls = null;
export function useWaTemplates() {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (!waTpls || Date.now() - waTpls.at > 60000) waTpls = { at: Date.now(), p: api('/channels/whatsapp/hive/templates/approved').then((r) => r.templates, () => null) };
    let on = true;
    waTpls.p.then((l) => { if (on) setList(l); });
    return () => { on = false; };
  }, []);
  return list;
}
// a select of the approved templates, plus "Other (type a name)" for one that isn't listed
export function WaTemplateSelect({ list, value, onPick, inputProps }) {
  const known = list.some((t) => t.name === value);
  const [other, setOther] = useState(!!value && !known);
  return (
    <>
      <select value={other ? '__other' : known ? value : ''} onChange={(e) => { const name = e.target.value; setOther(name === '__other'); if (name !== '__other') onPick(list.find((t) => t.name === name) || null); }}>
        <option value="">{t(list.length ? 'Choose an approved template…' : 'No approved templates yet')}</option>
        {list.map((t) => <option key={`${t.name}:${t.language}`} value={t.name}>{t.name}{t.category ? ` · ${t.category.toLowerCase()}` : ''}</option>)}
        <option value="__other">{t('Other (type a name)')}</option>
      </select>
      {other && <input {...inputProps} />}
    </>
  );
}
// how many variables the chosen template takes, with its wording
export function WaTemplateInfo({ t: tpl }) {
  if (!tpl) return null;
  return <p className="hint" style={{ whiteSpace: 'pre-wrap' }}>{tpl.vars ? t(tpl.vars > 1 ? 'This template has {n} variables: fill them in order.' : 'This template has {n} variable: fill them in order.', { n: tpl.vars }) : t('This template has no variables — leave the variables empty.')}{'\n'}<span className="muted">{tpl.body}</span></p>;
}
