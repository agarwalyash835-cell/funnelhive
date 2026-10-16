import { Component } from 'react';

// ---------- browser error reporting ----------
// Sentry is loaded only when the server has a DSN set (/api/site → sentryDsn), and only as its own chunk, so it
// never adds to a funnel page's first load. Nothing personal is sent: no request bodies, cookies, user, emails
// or the private tokens in buyer links (/access/<token>, /q/<id>…).
const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
const scrub = (s) => (typeof s === 'string' ? s.replace(EMAIL, '[email]').replace(/\/(access|share|report|booking|invoice|q|webinar|reset|verify)\/[^/?#\s"']+/g, '/$1/:id').replace(/[?#][^\s"']*/g, '') : s);
const scrubUrl = (u) => (typeof u === 'string' ? scrub(u) : u);

let sentry = null; // the loading promise: resolves to the Sentry module, or null when reporting is off
function loadSentry() {
  if (sentry) return sentry;
  sentry = fetch('/api/site').then((r) => (r.ok ? r.json() : {})).then(async (site) => {
    if (!site?.sentryDsn) return null;
    const S = await import('./sentry');
    S.init({
      dsn: site.sentryDsn,
      environment: location.hostname,
      sendDefaultPii: false,
      sampleRate: 1,
      beforeBreadcrumb: (b) => {
        if (b.category === 'console' || b.category === 'ui.input') return null;
        if (b.data?.url) b.data.url = scrubUrl(b.data.url);
        if (b.data?.from) b.data.from = scrubUrl(b.data.from);
        if (b.data?.to) b.data.to = scrubUrl(b.data.to);
        if (b.message) b.message = scrub(b.message);
        return b;
      },
      beforeSend: (e) => {
        delete e.user;
        if (e.request) { delete e.request.data; delete e.request.cookies; delete e.request.headers; delete e.request.query_string; e.request.url = scrubUrl(e.request.url); }
        if (e.message) e.message = scrub(e.message);
        for (const x of e.exception?.values || []) x.value = scrub(x.value);
        if (e.transaction) e.transaction = scrub(e.transaction);
        delete e.extra;
        return e;
      },
    });
    return S;
  }).catch(() => null);
  return sentry;
}

// Send one error (caught by a boundary, or thrown before Sentry was loaded)
export function reportError(error, extra) {
  loadSentry().then((S) => { if (S) S.captureException(error, extra?.componentStack ? { contexts: { react: { componentStack: scrub(extra.componentStack) } } } : undefined); });
}

// The dashboard loads reporting once the page is idle; funnel pages load it only when something actually breaks
export function initMonitoring({ lazy = false } = {}) {
  if (typeof window === 'undefined') return;
  if (!lazy) { const go = () => loadSentry(); (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(go); return; }
  let sent = 0;
  const onErr = (e) => { if (sentry || sent++ > 2) return; const err = e?.reason || e?.error; if (err instanceof Error) reportError(err); };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);
}

// ---------- error boundary ----------
// A crash in one screen shows a way out instead of a blank white page.
// variant "page": a seller's funnel page — the page's own title and a reload button, nothing about the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, copied: false, details: '' };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    // a page chunk from the previous build (the app was updated while this tab was open): reload once
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String(error?.message))) {
      let last = 0; try { last = Number(sessionStorage.getItem('ff_chunk_reload') || 0); } catch {}
      if (Date.now() - last > 30000) { try { sessionStorage.setItem('ff_chunk_reload', String(Date.now())); } catch {} location.reload(); return; }
    }
    this.setState({ info });
    reportError(error, info);
  }
  componentDidUpdate(prev) {
    // moving to another screen clears the error
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, info: null, copied: false, details: '' });
  }
  copy = () => {
    const { error, info } = this.state;
    const text = [`${error?.name || 'Error'}: ${error?.message || error}`, `Page: ${location.pathname}`, `Time: ${new Date().toISOString()}`, `Browser: ${navigator.userAgent}`, '', error?.stack || '', info?.componentStack || ''].join('\n');
    const done = () => this.setState({ copied: true });
    const show = () => this.setState({ details: text }); // no clipboard access: show the details to copy by hand
    try { navigator.clipboard.writeText(text).then(done, show); } catch { show(); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    const reload = () => location.reload();
    if (this.props.variant === 'page') {
      const title = (typeof document !== 'undefined' && document.title) || 'This page';
      return (
        <div role="alert" style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24, font: '16px/1.5 system-ui, -apple-system, sans-serif', color: '#111827', background: '#fff' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>{title}</h1>
          <p style={{ margin: '0 0 18px', color: '#4b5563' }}>This page didn’t load properly. Please try again.</p>
          <div><button onClick={reload} style={{ background: '#111827', color: '#fff', border: 0, borderRadius: 10, padding: '11px 22px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Reload page</button></div>
        </div>
      );
    }
    return (
      <div role="alert" style={{ minHeight: '60vh', display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24 }}>
        <div className="panel" style={{ maxWidth: 440, padding: '28px 26px' }}>
          <h2 style={{ margin: '0 0 6px' }}>Something went wrong</h2>
          <p className="muted" style={{ margin: '0 0 18px' }}>This screen hit a problem. Reloading usually fixes it — your saved work is safe.</p>
          <button className="btn primary" onClick={reload}>Reload</button>
          <p style={{ margin: '14px 0 0', fontSize: 13 }}><a href="#" onClick={(e) => { e.preventDefault(); this.copy(); }}>{this.state.copied ? 'Error details copied' : 'Copy error details'}</a></p>
          {this.state.details && <textarea readOnly value={this.state.details} onFocus={(e) => e.target.select()} style={{ width: '100%', height: 120, marginTop: 10, fontSize: 11, fontFamily: 'monospace' }} />}
        </div>
      </div>
    );
  }
}
