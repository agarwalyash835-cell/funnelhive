import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '../blocks';
import { tr } from '../i18n';

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// Razorpay Checkout is loaded only when someone actually pays
const loadRazorpay = () => (window.Razorpay ? Promise.resolve() : new Promise((resolve, reject) => {
  const sc = document.createElement('script');
  sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
  sc.onload = resolve;
  sc.onerror = () => reject(new Error('Couldn’t open the payment window — please check your internet connection and try again'));
  document.head.appendChild(sc);
}));

// Stripe (international cards): the Payment Element in a small dialog on the page
const loadStripe = () => (window.Stripe ? Promise.resolve() : new Promise((resolve, reject) => {
  const sc = document.createElement('script');
  sc.src = 'https://js.stripe.com/v3/';
  sc.onload = resolve;
  sc.onerror = () => reject(new Error('Couldn’t load the card form — please check your internet connection and try again'));
  document.head.appendChild(sc);
}));
const fmtMoney = (n, iso) => { try { return new Intl.NumberFormat(iso === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: iso || 'INR', maximumFractionDigits: 2 }).format(n); } catch { return `${iso} ${n}`; } };
async function stripeDialog(st, returnUrl) {
  await loadStripe();
  const stripe = window.Stripe(st.publishableKey);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('style', 'position:fixed;inset:0;z-index:9999;background:rgba(15,15,25,.55);display:grid;place-items:center;padding:16px;font-family:inherit');
    const box = document.createElement('div');
    box.setAttribute('style', 'background:#fff;color:#111;border-radius:16px;width:100%;max-width:440px;max-height:92vh;overflow:auto;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative');
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', 'Close'); x.setAttribute('style', 'position:absolute;top:8px;right:12px;border:0;background:none;font-size:26px;cursor:pointer;color:#666');
    const h = document.createElement('h3'); h.textContent = st.name || 'Payment'; h.setAttribute('style', 'margin:0 0 2px;font-size:18px');
    const sub = document.createElement('p'); sub.textContent = `${st.description || ''}${st.amount ? ` · ${fmtMoney(st.amount, st.currency)}` : ''}`; sub.setAttribute('style', 'margin:0 0 16px;color:#555;font-size:14px');
    const el = document.createElement('div');
    const err = document.createElement('p'); err.setAttribute('role', 'alert'); err.setAttribute('style', 'color:#b91c1c;font-size:13.5px;min-height:18px;margin:10px 0 0');
    const pay = document.createElement('button'); pay.textContent = st.amount ? `Pay ${fmtMoney(st.amount, st.currency)}` : 'Pay now';
    pay.setAttribute('style', `margin-top:10px;width:100%;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:${st.color || '#6366f1'}`);
    const note = document.createElement('small'); note.textContent = '🔒 Secured by Stripe'; note.setAttribute('style', 'display:block;text-align:center;margin-top:10px;color:#777');
    box.append(x, h, sub, el, err, pay, note); wrap.append(box); document.body.append(wrap);
    const elements = stripe.elements({ clientSecret: st.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: st.color || '#6366f1', borderRadius: '10px' } } });
    elements.create('payment', { layout: 'tabs' }).mount(el);
    const done = (v) => { wrap.remove(); resolve(v); };
    x.onclick = () => done({ error: 'Payment cancelled — you can try again whenever you’re ready' });
    pay.onclick = async () => {
      pay.disabled = true; pay.style.opacity = '.6'; err.textContent = '';
      const r = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: returnUrl } });
      if (r.error) { err.textContent = r.error.message || 'The payment didn’t go through'; pay.disabled = false; pay.style.opacity = '1'; return; }
      done({ ok: true });
    };
  });
}

const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} },
};

// Where did this visitor come from? utm_source wins, then the referrer's domain
function trafficSource(qs) {
  const utm = qs.get('utm_source');
  if (utm) { store.set('ff_src', utm.toLowerCase(), sessionStorage); return utm.toLowerCase(); }
  const saved = store.get('ff_src', sessionStorage);
  if (saved) return saved;
  const ref = document.referrer && !document.referrer.startsWith(location.origin) ? new URL(document.referrer).hostname : '';
  const map = [['facebook', 'facebook'], ['fb.', 'facebook'], ['instagram', 'instagram'], ['google', 'google'], ['youtube', 'youtube'], ['whatsapp', 'whatsapp'], ['wa.me', 'whatsapp'], ['t.co', 'twitter'], ['linkedin', 'linkedin']];
  const src = ref ? (map.find(([k]) => ref.includes(k))?.[1] || ref.replace(/^www\./, '')) : 'direct';
  store.set('ff_src', src, sessionStorage);
  return src;
}
// Ad attribution: the UTM tags and click ids of the visit that brought this person here. A new tagged
// click replaces the old one (like the ad platforms count it); an untagged visit keeps it for 30 days.
const ATTR_DAYS = 30;
function captureAttr(qs) {
  let saved = null;
  try { saved = JSON.parse(store.get('ff_attr') || 'null'); } catch {}
  if (saved && Date.now() - (saved.at || 0) > ATTR_DAYS * 864e5) saved = null;
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  const fromUrl = Object.fromEntries(keys.map((k) => [k, qs.get(k)]).filter(([, v]) => v));
  const ref = document.referrer && !document.referrer.startsWith(location.origin) ? (() => { try { return new URL(document.referrer).hostname; } catch { return ''; } })() : '';
  if (Object.keys(fromUrl).length || (!saved && ref)) {
    saved = { ...fromUrl, ...(ref ? { ref } : {}), landing: location.pathname, at: Date.now() };
    store.set('ff_attr', JSON.stringify(saved));
  }
  if (!saved) return undefined;
  const { at, ...attr } = saved;
  return attr;
}
const cookie = (n) => { try { return decodeURIComponent((document.cookie.match(new RegExp(`(?:^|; )${n}=([^;]*)`)) || [])[1] || ''); } catch { return ''; } };
// what the ad platforms match server-side events on (Meta's _fbp/_fbc cookies, GA's client id)
function browserIds(attr) {
  let fbc = cookie('_fbc');
  if (!fbc && attr?.fbclid) { try { fbc = `fb.1.${JSON.parse(store.get('ff_attr') || '{}').at || Date.now()}.${attr.fbclid}`; } catch {} }
  const ga = (cookie('_ga').match(/^GA\d\.\d\.(\d+\.\d+)$/) || [])[1];
  return { fbp: cookie('_fbp') || undefined, fbc: fbc || undefined, ga, url: location.href.slice(0, 500) };
}
const eventId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

function visitorId() {
  let v = store.get('ff_vid');
  if (!v) { v = Math.random().toString(36).slice(2, 12); store.set('ff_vid', v); }
  return v;
}

// Meta Pixel + GA4, injected once per page load when configured
function loadTracking(t) {
  if (!t || window.__ffTracking) return;
  window.__ffTracking = true;
  if (t.fbPixel) {
    /* eslint-disable */
    !function (f, b, e, v, n, t2, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t2 = b.createElement(e); t2.async = !0; t2.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t2, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', t.fbPixel);
  }
  if (t.ga4) {
    const s = document.createElement('script');
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${t.ga4}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', t.ga4, { send_page_view: false }); // page views are sent per step below
  }
}
// One event to Meta + GA4. Each carries a unique id (Meta eventID / GA4 transaction_id) that the server
// also uses for its Conversions API / Measurement Protocol copy, so the platforms count it once.
// Purchases carry only the amount just charged, so upsells are never double-counted.
const GA = { Lead: 'generate_lead', InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_payment_info', ViewContent: 'view_item' };
const track = (event, data = {}, id) => {
  try {
    if (window.fbq) window.fbq('track', event, data, id ? { eventID: id } : undefined);
    if (window.gtag) {
      if (event === 'Purchase') window.gtag('event', 'purchase', { value: data.value, currency: data.currency, transaction_id: id });
      else if (GA[event]) window.gtag('event', GA[event], { ...(data.value != null ? { value: data.value, currency: data.currency || 'INR' } : {}), ...(data.content_name ? { item_name: data.content_name } : {}) });
      else window.gtag('event', 'page_view', { page_location: location.href, page_title: document.title });
    }
  } catch {}
};
let CURRENCY = 'INR'; // the funnel's currency, for pixel events
const purchase = (r) => r && r.orderId && track('Purchase', { value: r.added ?? r.total, currency: CURRENCY }, r.txn || r.orderId);

export default function Public() {
  const params = useParams();
  // On a seller's own domain the page lives at "/" and "/<step>" — the funnel comes from the server render
  const onDomain = typeof window !== 'undefined' && !!window.__FF_DOMAIN__;
  const slug = onDomain ? window.__FUNNEL__?.slug : params.slug;
  const stepSlug = params.step;
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const preview = qs.get('preview') === '1' ? `?preview=1${qs.get('pv') ? `&pv=${encodeURIComponent(qs.get('pv'))}` : ''}` : '';
  // The server-rendered page embeds the funnel data — reuse it instead of fetching again
  const embedded = typeof window !== 'undefined' && window.__FUNNEL__?.slug === slug ? window.__FUNNEL__ : null;
  const [f, setF] = useState(embedded);
  const [err, setErr] = useState('');
  const source = useMemo(() => trafficSource(qs), []);
  const attr = useMemo(() => captureAttr(qs), []);
  const visitor = useMemo(visitorId, []);

  useEffect(() => {
    if (embedded) return;
    fetch(`/api/public/${slug}${preview}`).then(async (r) => {
      const d = await r.json();
      if (r.ok) setF(d); else setErr(d.error);
    });
  }, [slug]);
  // consent (DPDP): with the seller's banner on, pixels load only after the visitor accepts
  const [choice, setChoice] = useState(() => store.get('ff_consent'));
  const needsConsent = !!f?.privacy?.banner;
  useEffect(() => { if (f && !preview && (!needsConsent || choice === 'yes')) loadTracking(f.tracking); }, [f?.slug, choice]);
  const decide = (v) => { store.set('ff_consent', v); setChoice(v); };

  if (f?.currency) CURRENCY = f.currency;
  const idx = f ? Math.max(0, f.steps.findIndex((s) => s.slug === stepSlug)) : 0;
  const step = f?.steps[idx];

  // A/B split: each visitor is assigned a variant once per step and keeps it
  const variant = useMemo(() => {
    if (!step?.ab?.enabled) return 'A';
    const k = `ff_ab_${step.id}`;
    let v = store.get(k);
    if (!v) { v = Math.random() * 100 < (Number(step.ab.split) || 50) ? 'B' : 'A'; store.set(k, v); }
    return v;
  }, [step?.id]);
  const blocks = step ? (variant === 'B' && step.ab?.blocks ? step.ab.blocks : step.blocks) : [];
  // a webinar registration page: load its upcoming sessions (shown in the hero and the form)
  const regBlock = blocks.find((b) => (b.type === 'optin' || b.type === 'form') && b.props && 'webinarId' in b.props);
  const [sessions, setSessions] = useState(null);
  useEffect(() => {
    if (!regBlock || !slug) { setSessions(null); return; }
    fetch(`/api/public/${slug}/sessions${preview ? `${preview}&` : '?'}webinarId=${encodeURIComponent(regBlock.props.webinarId || '')}`).then((r) => r.json()).then((d) => setSessions(d.sessions ? d : null)).catch(() => {});
  }, [step?.id]);

  useEffect(() => {
    if (!step) return;
    post(`/api/public/${slug}/event${preview}`, { stepId: step.id, type: 'view', variant, source, visitor });
    // Same rule as the server render: SEO title → this step's headline → step + funnel name
    document.title = step.seo?.title || (blocks.find((b) => b.type === 'hero')?.props.headline || '').replace(/\*/g, '').trim() || `${step.name} · ${f.name}`;
    if (step.seo?.description) {
      let m = document.querySelector('meta[name="description"]');
      if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
      m.content = step.seo.description;
    }
    track('PageView');
    if (['landing', 'sales', 'optin'].includes(step.type)) track('ViewContent', { content_name: step.name, content_type: 'product' });
    window.scrollTo(0, 0);
  }, [step?.id]);

  // back from a bank page (Stripe redirect): confirm and continue as if the dialog had finished
  useEffect(() => {
    const pid = qs.get('ff_pay');
    if (!pid || !f || !step) return;
    post(`/api/public/${slug}/pay/stripe/verify${preview}`, { payment: pid }).then((r) => {
      if (!r?.orderId) return;
      store.set(`ff_order_${slug}${preview ? '_preview' : ''}`, r.orderId, sessionStorage);
      purchase(r);
      const n = f.steps[idx + 1];
      if (n) nav(onDomain ? `/${n.slug}` : `/f/${slug}/${n.slug}${preview}`, { replace: true });
    });
  }, [f?.slug, step?.id]);

  const ctx = useMemo(() => {
    if (!f || !step) return { live: false };
    const go = (i) => { const n = f.steps[i]; if (n) nav(onDomain ? `/${n.slug}` : `/f/${slug}/${n.slug}${preview}`); };
    const convert = () => post(`/api/public/${slug}/event${preview}`, { stepId: step.id, type: 'convert', variant, source, visitor });
    const key = `ff_order_${slug}${preview ? "_preview" : ""}`; // preview never reuses a real order id
    // the buyer's receipt / invoice links, shown on the thank-you page
    const dkey = `ff_delivery_${slug}${preview ? '_preview' : ''}`;
    const remember = (r) => { if (!r?.access && !r?.invoice && !r?.webinar) return; let d = {}; try { d = JSON.parse(store.get(dkey, sessionStorage) || '{}'); } catch {} store.set(dkey, JSON.stringify({ ...d, ...(r.access ? { access: r.access } : {}), ...(r.invoice ? { invoice: r.invoice } : {}), ...(r.webinar ? { webinar: r.webinar } : {}) }), sessionStorage); };
    let delivery = null;
    try { delivery = JSON.parse(store.get(dkey, sessionStorage) || 'null'); } catch {}
    const ids = () => ({ ...browserIds(attr), ...(needsConsent && choice !== 'yes' ? { consent: false } : {}) });
    const base = `/api/public/${slug}`;
    // Charge through Razorpay when the seller connected it; otherwise (and in preview) the demo checkout
    const charge = async (body) => {
      const st = await post(`${base}/pay/start${preview}`, body);
      if (st.error) return st;
      if (st.provider === 'demo') return post(`${base}/order${preview}`, body);
      if (st.provider === 'free' || st.provider === 'cod') return st;
      if (st.provider === 'stripe') {
        if (st.orderId) return st; // one-click: the saved card was charged
        // a payment method that leaves the page (bank redirect) comes back here with ff_pay to finish
        const back = new URL(location.href); back.searchParams.set('ff_pay', st.payment);
        try { const r = await stripeDialog(st, back.toString()); if (r.error) return r; } catch (e) { return { error: e.message }; }
        return post(`${base}/pay/stripe/verify${preview}`, { payment: st.payment });
      }
      try { await loadRazorpay(); } catch (e) { return { error: e.message }; }
      track('AddPaymentInfo', { value: (st.amount || 0) / 100 || body.total || 0, currency: 'INR' });
      return new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: st.key, ...(st.subscription_id ? { subscription_id: st.subscription_id, recurring: 1 } : { order_id: st.order_id, amount: st.amount, currency: st.currency }), name: st.name, description: st.description,
          prefill: st.prefill, theme: { color: st.color }, retry: { enabled: true },
          handler: async (resp) => resolve(await post(`${base}/pay/verify${preview}`, { payment: st.payment, ...resp })),
          modal: { ondismiss: () => resolve({ error: 'Payment cancelled — you can try again whenever you’re ready' }) },
        });
        rz.open();
      });
    };
    return {
      live: true, lang: f.theme?.lang || 'en', gstInvoices: !!f.gstInvoices, delivery, webinar: sessions, privacy: f.privacy || null,
      onNext: async () => {
        if (blocks.some((b) => b.type === 'optin')) return document.getElementById('optin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (blocks.some((b) => b.type === 'checkout')) return document.querySelector('.co-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await convert(); go(idx + 1);
      },
      onOptin: async (data) => {
        const id = eventId('lead');
        const r = await post(`${base}/lead${preview}`, { ...data, stepId: step.id, source, visitor, attr, tk: ids(), eventId: id });
        if (r?.error) throw new Error(r.error);
        store.set('ff_email', data.email, sessionStorage);
        remember(r);
        track('Lead', {}, r?.eventId || id);
        await convert(); go(idx + 1);
      },
      onAbandon: (data) => post(`${base}/abandon${preview}`, { ...data, stepId: step.id, visitor, attr }),
      onForm: async (data) => {
        const id = eventId('lead');
        const r = await post(`${base}/lead${preview}`, { ...data, stepId: step.id, source, visitor, attr, tk: ids(), eventId: id });
        if (r.error) throw new Error(r.error);
        if (data.email) store.set('ff_email', data.email, sessionStorage);
        if (data.name) store.set('ff_name', data.name, sessionStorage);
        if (data.phone) store.set('ff_phone', data.phone, sessionStorage);
        remember(r);
        if (r.qualified !== false) track('Lead', {}, r.eventId || id);
        await convert();
      },
      onFormNext: () => go(idx + 1),
      // booking calendar: free slots and the booking itself
      prefill: { email: store.get('ff_email', sessionStorage) || '', name: store.get('ff_name', sessionStorage) || '', phone: store.get('ff_phone', sessionStorage) || '' },
      onSlots: (blockId) => fetch(`${base}/slots${preview ? `${preview}&` : '?'}stepId=${step.id}&blockId=${blockId}`).then((r) => r.json()),
      onBook: async (blockId, data) => {
        const r = await fetch(`${base}/book${preview}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, stepId: step.id, blockId, attr }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return { error: d.error || 'Booking failed — please try again', taken: r.status === 409 };
        // a paid call: pay in Razorpay Checkout, then the server confirms the held slot
        if (d.pay) {
          try { await loadRazorpay(); } catch (e) { return { error: e.message }; }
          track('InitiateCheckout', { value: d.pay.amount / 100, currency: 'INR' });
          const v = await new Promise((resolve) => {
            const rz = new window.Razorpay({
              key: d.pay.key, order_id: d.pay.order_id, amount: d.pay.amount, currency: d.pay.currency, name: d.pay.name, description: d.pay.description,
              prefill: d.pay.prefill, theme: { color: d.pay.color }, retry: { enabled: true },
              handler: async (resp) => resolve(await post(`${base}/book/verify${preview}`, { payment: d.pay.payment, ...resp })),
              modal: { ondismiss: () => resolve({ error: 'Payment cancelled — your time is held for 15 minutes if you’d like to try again', retry: true }) },
            });
            rz.open();
          });
          if (v.error) return v;
          track('Purchase', { value: d.pay.amount / 100, currency: 'INR' }, eventId('purchase'));
          track('Schedule', { content_name: step.name }, eventId('book'));
          await convert();
          return v;
        }
        track('Schedule', { content_name: step.name }, eventId('book'));
        await convert();
        return d.preview ? { start: data.start, end: data.start + 1800000, manage: null } : d;
      },
      onCoupon: (code, email) => post(`${base}/coupon${preview}`, { code, email, stepId: step.id }),
      onClaim: (code) => code && store.set(`ff_coupon_${slug}`, code, sessionStorage),
      getPendingCoupon: () => store.get(`ff_coupon_${slug}`, sessionStorage),
      onCheckout: async (data) => {
        const id = eventId('ic');
        track('InitiateCheckout', { value: data.total, currency: 'INR' }, id);
        const body = { ...data, stepId: step.id, source, visitor, attr, tk: ids(), eventId: id };
        const r = data.method === 'cod' ? await post(`${base}/cod${preview}`, body) : await charge(body);
        if (!r.orderId) return { error: r.error || tr(f.theme?.lang, 'Payment could not be completed — please try again') };
        store.set(key, r.orderId, sessionStorage);
        store.set('ff_email', data.email, sessionStorage);
        remember(r);
        purchase(r);
        await convert(); go(idx + 1);
      },
      // One-click: reuses the order created at checkout — no re-entry of payment details
      onAccept: async () => {
        const r = await charge({ stepId: step.id, orderId: store.get(key, sessionStorage), email: store.get('ff_email', sessionStorage), visitor, tk: ids() });
        if (!r.orderId) return { error: r.error || 'That didn’t go through — please try again' };
        store.set(key, r.orderId, sessionStorage);
        remember(r);
        purchase(r);
        await convert();
        let n = idx + 1;
        while (f.steps[n]?.type === 'downsell') n++; // accepting an upsell skips the downsells
        go(n);
      },
      onDecline: () => go(idx + 1),
      onCrossSell: async (blockId, itemIndex) => {
        const r = await charge({ stepId: step.id, orderId: store.get(key, sessionStorage), email: store.get('ff_email', sessionStorage), blockId, itemIndex, source, visitor, tk: ids() });
        if (!r.orderId) return { error: r.error || 'That didn’t go through — please try again' };
        store.set(key, r.orderId, sessionStorage);
        remember(r);
        purchase(r);
        return r;
      },
    };
  }, [f, step?.id, variant, sessions, choice]);

  if (err) return <div className="notfound"><h1>404</h1><p>{err}</p></div>;
  if (!step) return null;
  return (
    <>
      {preview && <div className="previewbar">Preview mode — nothing is recorded{step.ab?.enabled && ` · showing variant ${variant}`}</div>}
      <Page blocks={blocks} theme={f.theme} ctx={ctx} />
      {needsConsent && !choice && !preview && (
        <div role="dialog" aria-label="Cookie consent" style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 9000, maxWidth: 560, margin: '0 auto', background: '#111827', color: '#f9fafb', borderRadius: 14, padding: '14px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.35)', font: '14px/1.5 system-ui, sans-serif', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: '1 1 260px' }}>{tr(f.theme?.lang, 'We use cookies to measure our ads and improve this page.')} <a href={f.privacy.policy} target="_blank" rel="noreferrer" style={{ color: '#a5b4fc' }}>{tr(f.theme?.lang, 'Privacy Policy')}</a></span>
          <button onClick={() => decide('no')} style={{ background: 'transparent', color: '#f9fafb', border: '1px solid #4b5563', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>{tr(f.theme?.lang, 'Reject')}</button>
          <button onClick={() => decide('yes')} style={{ background: '#f9fafb', color: '#111827', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer' }}>{tr(f.theme?.lang, 'Accept')}</button>
        </div>
      )}
    </>
  );
}
