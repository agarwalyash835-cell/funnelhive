import React, { lazy, Suspense } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { loggedIn } from './api';
import ErrorBoundary, { initMonitoring } from './ErrorBoundary';
// Live funnel pages are in the first download; every other screen loads its own chunk when opened,
// so a buyer opening a funnel never downloads the dashboard.
import Public from './pages/Public';
import './styles.css';
import './app-polish.css';
import './quote-designs.css';
import './page-variants.css';
import './page-premium.css';
import './app-products.css';
import './glass.css';

const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Toaster = named(() => import('./ui'), 'Toaster');
const Auth = lazy(() => import('./pages/Auth'));
const Verify = named(() => import('./pages/AuthLinks'), 'Verify');
const Reset = named(() => import('./pages/AuthLinks'), 'Reset');
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Funnels = lazy(() => import('./pages/Funnels'));
const Editor = lazy(() => import('./pages/Editor'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Orders = lazy(() => import('./pages/Orders'));
const Reports = lazy(() => import('./pages/Reports'));
const Ads = lazy(() => import('./pages/Ads'));
const Products = lazy(() => import('./pages/Products'));
const Library = lazy(() => import('./pages/Library'));
const Learn = lazy(() => import('./pages/Learn'));
const School = lazy(() => import('./pages/School'));
const CertCheck = named(() => import('./pages/Learn'), 'CertCheck');
const SaleInvoice = lazy(() => import('./pages/SaleInvoice'));
const Bookings = lazy(() => import('./pages/Bookings'));
const BookingManage = lazy(() => import('./pages/BookingManage'));
const MeetPage = lazy(() => import('./pages/MeetPage'));
const Quotes = lazy(() => import('./pages/Quotes'));
const Vault = lazy(() => import('./pages/Vault'));
const QuotePublic = lazy(() => import('./pages/QuotePublic'));
const Webinars = lazy(() => import('./pages/Webinars'));
const Broadcasts = lazy(() => import('./pages/Broadcasts'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Chatbots = lazy(() => import('./pages/Chatbots'));
const AcceptInvite = named(() => import('./pages/Team'), 'AcceptInvite');
const Developers = lazy(() => import('./pages/Developers'));
const Agency = lazy(() => import('./pages/Agency'));
const ShareImport = named(() => import('./pages/Agency'), 'ShareImport');
const ClientReport = named(() => import('./pages/Agency'), 'ClientReport');
const WebinarJoin = lazy(() => import('./pages/WebinarJoin'));
const Settings = lazy(() => import('./pages/Settings'));
const Hive = lazy(() => import('./pages/Hive'));
const Automations = lazy(() => import('./pages/Automations'));
const Billing = lazy(() => import('./pages/Billing'));
const Invoice = lazy(() => import('./pages/Invoice'));
const Admin = lazy(() => import('./pages/Admin'));
const Landing = lazy(() => import('./pages/Landing'));
const Terms = named(() => import('./pages/Legal'), 'Terms');
const Privacy = named(() => import('./pages/Legal'), 'Privacy');
const Refunds = named(() => import('./pages/Legal'), 'Refunds');
const Contact = named(() => import('./pages/Legal'), 'Contact');
const TemplateGallery = named(() => import('./pages/Templates'), 'TemplateGallery');
const TemplatePreview = named(() => import('./pages/Templates'), 'TemplatePreview');

// the app's look (same rule as applyLook in ui.jsx, which isn't in the funnel-page bundle)
try { document.documentElement.classList.toggle('glass', localStorage.getItem('ff_ui') === 'glass'); } catch {}

// Each lazy screen gets its own Suspense — the live funnel page (Public) has none, so its server HTML hydrates as is
const L = (C, props) => <Suspense fallback={<div className="skeleton" style={{ margin: 24 }} />}><C {...props} /></Suspense>;
const Private = ({ children }) => (loggedIn() ? children : <Navigate to="/login" />);
const P = (C, props) => <Private>{L(C, props)}</Private>;

// Toasts belong to the dashboard; a funnel page never renders (or downloads) them
function AppToaster() {
  const { pathname } = useLocation();
  return pathname.startsWith('/f/') ? null : <Suspense fallback={null}><Toaster /></Suspense>;
}
// a boundary per screen: moving to another page clears a crash
function Screens({ children, variant }) {
  const { pathname } = useLocation();
  return <ErrorBoundary variant={variant} resetKey={pathname}>{children}</ErrorBoundary>;
}

// The dashboard's language: switching it re-renders every screen (appI18n.js). Adds no DOM, so funnel pages hydrate as before.
function LangRoot({ children }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => { const h = () => setN((x) => x + 1); window.addEventListener('ff:lang', h); return () => window.removeEventListener('ff:lang', h); }, []);
  return <React.Fragment key={n}>{children}</React.Fragment>;
}

// A seller's own domain only ever shows their funnel
const onDomain = typeof window !== 'undefined' && !!window.__FF_DOMAIN__;
const onFunnel = onDomain || /^\/(f|learn|cert)\/[^/]/.test(location.pathname);

const app = onDomain ? (
  <BrowserRouter>
    <Screens variant="page">
      <Routes>
        <Route path="/access/:token?" element={L(Library)} />
        <Route path="/invoice/:id" element={L(SaleInvoice)} />
        <Route path="/booking/:id" element={L(BookingManage)} />
        <Route path="/webinar/:id" element={L(WebinarJoin)} />
        <Route path="/learn/:handle/*" element={L(Learn)} />
        <Route path="/cert/:id" element={L(CertCheck)} />
        <Route path="/:step?" element={<Public />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Screens>
  </BrowserRouter>
) : (
  <LangRoot>
  <BrowserRouter>
    <AppToaster />
    <Screens variant={onFunnel ? 'page' : 'app'}>
      <Routes>
        <Route path="/login" element={L(Auth)} />
        <Route path="/verify" element={L(Verify)} />
        <Route path="/share/:token" element={L(ShareImport)} />
        <Route path="/report/:token" element={L(ClientReport)} />
        <Route path="/reset" element={L(Reset)} />
        <Route path="/team/accept" element={L(AcceptInvite)} />
        <Route path="/" element={loggedIn() ? L(Dashboard) : L(Landing)} />
        <Route path="/pricing" element={L(Landing)} />
        <Route path="/terms" element={L(Terms)} />
        <Route path="/privacy" element={L(Privacy)} />
        <Route path="/refunds" element={L(Refunds)} />
        <Route path="/contact" element={L(Contact)} />
        <Route path="/funnels" element={P(Funnels)} />
        <Route path="/funnels/:id" element={P(Editor)} />
        <Route path="/funnels/:id/analytics" element={P(Analytics)} />
        <Route path="/contacts/:key?" element={P(Contacts)} />
        <Route path="/orders" element={P(Orders)} />
        <Route path="/reports" element={P(Reports)} />
        <Route path="/ads" element={P(Ads)} />
        <Route path="/products/:id?" element={P(Products)} />
        <Route path="/access/:token?" element={L(Library)} />
        <Route path="/invoice/:id" element={L(SaleInvoice)} />
        <Route path="/bookings" element={P(Bookings)} />
        <Route path="/meet/:handle/:cal?" element={L(MeetPage)} />
        <Route path="/learn/:handle/*" element={L(Learn)} />
        <Route path="/cert/:id" element={L(CertCheck)} />
        <Route path="/booking/:id" element={L(BookingManage)} />
        <Route path="/school" element={P(School)} />
        <Route path="/quotes" element={P(Quotes)} />
        <Route path="/vault" element={P(Vault)} />
        <Route path="/q/:id" element={L(QuotePublic)} />
        <Route path="/webinars" element={P(Webinars)} />
        <Route path="/broadcasts" element={P(Broadcasts)} />
        <Route path="/campaigns" element={P(Broadcasts)} />
        <Route path="/inbox/:id?" element={P(Inbox)} />
        <Route path="/chatbots/:id?" element={P(Chatbots)} />
        <Route path="/developers" element={P(Developers)} />
        <Route path="/agency" element={P(Agency)} />
        <Route path="/webinar/:id" element={L(WebinarJoin)} />
        <Route path="/settings" element={P(Settings)} />
        <Route path="/hive" element={P(Hive)} />
        <Route path="/billing" element={P(Billing)} />
        <Route path="/billing/invoices/:id" element={P(Invoice)} />
        <Route path="/admin" element={P(Admin)} />
        <Route path="/admin/invoices/:id" element={P(Invoice, { admin: true })} />
        <Route path="/ai" element={<Navigate to="/hive" replace />} />
        <Route path="/automations/:id?" element={P(Automations)} />
        <Route path="/templates" element={P(TemplateGallery)} />
        <Route path="/t/:id" element={L(TemplatePreview)} />
        <Route path="/f/:slug" element={<Public />} />
        <Route path="/f/:slug/:step" element={<Public />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Screens>
  </BrowserRouter>
  </LangRoot>
);

// A live funnel page arrives server-rendered: hydrate that HTML (no flash, no layout shift) when the browser's
// first render is sure to match it. Anything that depends on the visitor (a saved countdown or offer timer,
// an A/B variant, preview mode) renders fresh in the browser, as before.
function canHydrate(root) {
  const f = window.__FUNNEL__;
  if (!onFunnel || !f?.steps?.length || !root.firstElementChild || root.firstElementChild.tagName === 'SCRIPT') return false;
  const qs = new URLSearchParams(location.search);
  if (qs.get('preview') === '1') return false;
  const parts = location.pathname.split('/').filter(Boolean);
  const slug = onDomain ? f.slug : parts[1];
  if (slug !== f.slug) return false;
  const stepSlug = onDomain ? parts[0] : parts[2];
  const step = f.steps.find((s) => s.slug === stepSlug) || f.steps[0];
  if (step.ab?.enabled) return false;
  const json = JSON.stringify(step.blocks || []);
  return !json.includes('"type":"countdown"') && !json.includes('"type":"offer"');
}

// After a deploy, an open tab still points at the old build's file names: when a page chunk fails to load,
// reload once to pick up the new build (a short guard stops a reload loop if the server is really down)
const reloadedAt = () => { try { return Number(sessionStorage.getItem('ff_chunk_reload') || 0); } catch { return 0; } };
const reloadForNewBuild = (e) => {
  if (Date.now() - reloadedAt() < 30000) return;
  e?.preventDefault?.();
  try { sessionStorage.setItem('ff_chunk_reload', String(Date.now())); } catch {}
  location.reload();
};
window.addEventListener('vite:preloadError', reloadForNewBuild);
window.addEventListener('unhandledrejection', (e) => { if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(e.reason?.message || e.reason))) reloadForNewBuild(e); });

const root = document.getElementById('root');
if (canHydrate(root)) {
  // the page's data script has run; it isn't part of the React tree
  root.querySelectorAll(':scope > script').forEach((s) => s.remove());
  window.__FF_HYDRATING__ = true;
  // a mismatch isn't fatal: React renders the page fresh, exactly as createRoot would have
  hydrateRoot(root, app, { onRecoverableError: (e) => console.warn('Page re-rendered in the browser:', e?.message || e) });
} else {
  createRoot(root).render(app);
}

// Dashboard forms are written as <div class="fld"><label>Name</label><input/></div>: link each label to the field
// after it, so tapping the label focuses the field and screen readers announce its name (done once, for every form)
let fldN = 0;
const linkLabels = () => {
  for (const l of document.querySelectorAll('.fld > label')) {
    const el = l.nextElementSibling;
    if (!el || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'checkbox') continue;
    if (l.htmlFor && document.getElementById(l.htmlFor)) continue; // already linked (by us, or written with htmlFor)
    if (!el.id) el.id = `fld-${++fldN}`;
    l.htmlFor = el.id;
  }
};
let fldQueued = false;
setTimeout(() => {
  linkLabels();
  new MutationObserver(() => { if (!fldQueued) { fldQueued = true; setTimeout(() => { fldQueued = false; linkLabels(); }, 50); } }).observe(document.body, { childList: true, subtree: true });
}, 1000);
initMonitoring({ lazy: onFunnel });
