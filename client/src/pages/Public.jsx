import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '../blocks';

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
// One event to Meta + GA4. Purchases carry only the amount just charged and a unique id
// (eventID / transaction_id) so the ad platforms never count the same sale twice.
const track = (event, data = {}, id) => {
  try {
    if (window.fbq) window.fbq('track', event, data, id ? { eventID: id } : undefined);
    if (window.gtag) {
      if (event === 'Purchase') window.gtag('event', 'purchase', { value: data.value, currency: data.currency, transaction_id: id });
      else if (event === 'Lead') window.gtag('event', 'generate_lead', data);
      else window.gtag('event', 'page_view', { page_location: location.href, page_title: document.title });
    }
  } catch {}
};
const purchase = (r) => r && r.orderId && track('Purchase', { value: r.added ?? r.total, currency: 'INR' }, r.txn || r.orderId);

export default function Public() {
  const params = useParams();
  // On a seller's own domain the page lives at "/" and "/<step>" — the funnel comes from the server render
  const onDomain = typeof window !== 'undefined' && !!window.__FF_DOMAIN__;
  const slug = onDomain ? window.__FUNNEL__?.slug : params.slug;
  const stepSlug = params.step;
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const preview = qs.get('preview') === '1' ? '?preview=1' : '';
  // The server-rendered page embeds the funnel data — reuse it instead of fetching again
  const embedded = typeof window !== 'undefined' && window.__FUNNEL__?.slug === slug ? window.__FUNNEL__ : null;
  const [f, setF] = useState(embedded);
  const [err, setErr] = useState('');
  const source = useMemo(() => trafficSource(qs), []);
  const visitor = useMemo(visitorId, []);

  useEffect(() => {
    if (embedded) { if (!preview) loadTracking(embedded.tracking); return; }
    fetch(`/api/public/${slug}${preview}`).then(async (r) => {
      const d = await r.json();
      if (r.ok) { setF(d); if (!preview) loadTracking(d.tracking); } else setErr(d.error);
    });
  }, [slug]);

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
    window.scrollTo(0, 0);
  }, [step?.id]);

  const ctx = useMemo(() => {
    if (!f || !step) return { live: false };
    const go = (i) => { const n = f.steps[i]; if (n) nav(onDomain ? `/${n.slug}` : `/f/${slug}/${n.slug}${preview}`); };
    const convert = () => post(`/api/public/${slug}/event${preview}`, { stepId: step.id, type: 'convert', variant, source, visitor });
    const key = `ff_order_${slug}${preview ? "_preview" : ""}`; // preview never reuses a real order id
    const base = `/api/public/${slug}`;
    // Charge through Razorpay when the seller connected it; otherwise (and in preview) the demo checkout
    const charge = async (body) => {
      const st = await post(`${base}/pay/start${preview}`, body);
      if (st.error) return st;
      if (st.provider === 'demo') return post(`${base}/order${preview}`, body);
      if (st.provider === 'free') return st;
      try { await loadRazorpay(); } catch (e) { return { error: e.message }; }
      return new Promise((resolve) => {
        const rz = new window.Razorpay({
          key: st.key, order_id: st.order_id, amount: st.amount, currency: st.currency, name: st.name, description: st.description,
          prefill: st.prefill, theme: { color: st.color }, retry: { enabled: true },
          handler: async (resp) => resolve(await post(`${base}/pay/verify${preview}`, { payment: st.payment, ...resp })),
          modal: { ondismiss: () => resolve({ error: 'Payment cancelled — you can try again whenever you’re ready' }) },
        });
        rz.open();
      });
    };
    return {
      live: true,
      onNext: async () => {
        if (blocks.some((b) => b.type === 'optin')) return document.getElementById('optin')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (blocks.some((b) => b.type === 'checkout')) return document.querySelector('.co-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await convert(); go(idx + 1);
      },
      onOptin: async (data) => {
        await post(`${base}/lead${preview}`, { ...data, stepId: step.id, source, visitor });
        store.set('ff_email', data.email, sessionStorage);
        track('Lead');
        await convert(); go(idx + 1);
      },
      onAbandon: (data) => post(`${base}/abandon${preview}`, { ...data, stepId: step.id, visitor }),
      onForm: async (data) => {
        const r = await post(`${base}/lead${preview}`, { ...data, stepId: step.id, source, visitor });
        if (r.error) throw new Error(r.error);
        if (data.email) store.set('ff_email', data.email, sessionStorage);
        track('Lead');
        await convert();
      },
      onFormNext: () => go(idx + 1),
      onCoupon: (code, email) => post(`${base}/coupon${preview}`, { code, email, stepId: step.id }),
      onClaim: (code) => code && store.set(`ff_coupon_${slug}`, code, sessionStorage),
      getPendingCoupon: () => store.get(`ff_coupon_${slug}`, sessionStorage),
      onCheckout: async (data) => {
        const r = await charge({ ...data, stepId: step.id, source, visitor });
        if (!r.orderId) return { error: r.error || 'Payment could not be completed — please try again' };
        store.set(key, r.orderId, sessionStorage);
        store.set('ff_email', data.email, sessionStorage);
        purchase(r);
        await convert(); go(idx + 1);
      },
      // One-click: reuses the order created at checkout — no re-entry of payment details
      onAccept: async () => {
        const r = await charge({ stepId: step.id, orderId: store.get(key, sessionStorage), email: store.get('ff_email', sessionStorage), visitor });
        if (!r.orderId) return { error: r.error || 'That didn’t go through — please try again' };
        store.set(key, r.orderId, sessionStorage);
        purchase(r);
        await convert();
        let n = idx + 1;
        while (f.steps[n]?.type === 'downsell') n++; // accepting an upsell skips the downsells
        go(n);
      },
      onDecline: () => go(idx + 1),
      onCrossSell: async (blockId, itemIndex) => {
        const r = await charge({ stepId: step.id, orderId: store.get(key, sessionStorage), email: store.get('ff_email', sessionStorage), blockId, itemIndex, source, visitor });
        if (!r.orderId) return { error: r.error || 'That didn’t go through — please try again' };
        store.set(key, r.orderId, sessionStorage);
        purchase(r);
        return r;
      },
    };
  }, [f, step?.id, variant]);

  if (err) return <div className="notfound"><h1>404</h1><p>{err}</p></div>;
  if (!step) return null;
  return (
    <>
      {preview && <div className="previewbar">Preview mode — nothing is recorded{step.ab?.enabled && ` · showing variant ${variant}`}</div>}
      <Page blocks={blocks} theme={f.theme} ctx={ctx} />
    </>
  );
}
