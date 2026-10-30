import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { loadRazorpay } from '../api';
import { buyerPost, confirmPaid } from '../buyerFetch';
import { stripeDialog } from '../stripePay';
import { themeOf } from '../storeThemes/index.js';
import { themeVars, fontHref, fontOf, sectionsOf, cartTotal } from '../storeThemes/tokens.js';
import { label } from '../storeThemes/i18n.js';
import { StoreCtx, SECTIONS, Announcement, Header, Footer, WhatsAppButton, CartBar, ProductPage, PolicyPage, getJson } from '../storeThemes/kit.jsx';
import '../store.css';
import '../storeThemes/storeThemes.css';

// The public store (/s/<handle>): a renderer of the sections its theme picks (client/src/storeThemes/) — home,
// product pages, policy pages — plus a cart kept in this browser and one checkout for the whole cart. The server
// prices everything (server/store.js) — this page only shows it. Demo stores (/s/demo-<theme>) browse and price a
// cart but can't check out. Opened in a frame by Store settings (?pv=…), it previews unsaved theme changes and
// AI drafts sent with postMessage.
const IN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function useCart(handle) {
  const key = `ff_cart_${handle}`;
  const [cart, setCart] = useState(() => store.get(key));
  useEffect(() => store.set(key, cart), [key, cart]);
  return {
    cart,
    count: cart.reduce((s, x) => s + x.qty, 0),
    add: (id, qty = 1) => setCart((c) => (c.some((x) => x.id === id) ? c.map((x) => (x.id === id ? { ...x, qty: Math.min(999, x.qty + qty) } : x)) : [...c, { id, qty }])),
    setQty: (id, qty) => setCart((c) => (qty < 1 ? c.filter((x) => x.id !== id) : c.map((x) => (x.id === id ? { ...x, qty: Math.min(999, qty) } : x)))),
    remove: (id) => setCart((c) => c.filter((x) => x.id !== id)),
    clear: () => setCart([]),
  };
}
const setMetaTag = (sel, attr, v) => { let m = document.head.querySelector(sel); if (!m) { m = document.createElement('meta'); m.setAttribute(attr, sel.match(/"(.+)"/)[1]); document.head.appendChild(m); } m.setAttribute('content', v || ''); };
const setMeta = (title, desc) => {
  document.title = title;
  setMetaTag('meta[name="description"]', 'name', (desc || '').slice(0, 200));
  setMetaTag('meta[property="og:title"]', 'property', title);
  setMetaTag('meta[property="og:description"]', 'property', (desc || '').slice(0, 200));
};
const langKey = (h) => `ff_lang_${h}`;

export default function Store() {
  const { handle } = useParams();
  const rest = useParams()['*'] || '';
  const { search } = useLocation();
  const navigate = useNavigate();
  const sp = new URLSearchParams(search);
  const pv = sp.get('pv');
  const qs = pv ? `?pv=${encodeURIComponent(pv)}` : '';
  const [data, setData] = useState(null);
  const [preview, setPreview] = useState(null);
  const [langPick, setLangPick] = useState(() => { try { return localStorage.getItem(langKey(handle)); } catch { return null; } });
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState('');
  const [toastMsg, setToast] = useState('');
  const cart = useCart(handle);
  const base = `/api/s/${handle}`;
  useEffect(() => { getJson(`${base}${qs}`).then(setData); }, [base, qs]);
  // Store settings shows unsaved theme changes and AI drafts in a frame: { store, listings, extra } overrides
  useEffect(() => {
    if (!pv || window.parent === window) return undefined;
    const on = (e) => { if (e.origin === window.location.origin && e.data?.type === 'ff-store-preview') setPreview(e.data.preview || null); };
    window.addEventListener('message', on);
    window.parent.postMessage({ type: 'ff-store-ready' }, window.location.origin);
    return () => window.removeEventListener('message', on);
  }, [pv]);
  const view = useMemo(() => {
    if (!data?.store) return null;
    const themeParam = pv ? sp.get('theme') : null;
    const s = { ...data.store, ...(preview?.store || {}) };
    if (themeParam) s.theme = themeParam;
    const over = preview?.listings || {};
    const listings = [...data.listings.map((l) => (over[l.id] ? { ...l, ...over[l.id] } : l)), ...(preview?.extra || [])];
    return { s, listings, byId: Object.fromEntries(listings.map((l) => [l.id, l])) };
  }, [data, preview, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const theme = themeOf(view?.s.theme);
  const opts = view?.s.themeOptions || {};
  const vars = useMemo(() => themeVars(theme, opts, view?.s.color), [theme, opts, view?.s.color]);
  const font = fontOf(theme, opts);
  useEffect(() => {
    if (!view) return;
    let el = document.getElementById('sv-font');
    if (!el) { el = document.createElement('link'); el.id = 'sv-font'; el.rel = 'stylesheet'; document.head.appendChild(el); }
    const href = fontHref(font);
    if (el.href !== href) el.href = href;
    document.documentElement.style.background = vars['--st-bg'];
    return () => { document.documentElement.style.background = ''; };
  }, [font, view, vars]);
  const isHome = !rest.match(/^(p\/|cart|policy\/)/);
  useEffect(() => { if (view && isHome) setMeta(opts.seo?.title || (view.s.tagline ? `${view.s.name} — ${view.s.tagline}` : view.s.name), opts.seo?.description || view.s.tagline || view.s.about); }, [view, isHome]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toastMsg) return undefined; const x = setTimeout(() => setToast(''), 2200); return () => clearTimeout(x); }, [toastMsg]);
  if (!data) return <div className="st-page"><div className="st-wrap"><div className="st-skel" /></div></div>;
  if (data.error) return <div className="st-page"><div className="st-wrap st-empty"><h2>{data.error}</h2></div></div>;
  const { s, listings, byId } = view;
  const lang = langPick || (opts.lang === 'hi' ? 'hi' : 'en');
  const t = (k, v) => label(lang, k, v);
  const link = (p) => `/s/${handle}${p}${qs}`;
  const cats = (s.categories || []).filter((c) => listings.some((l) => l.category === c));
  const ctx = {
    s, data, theme, opts, lang, t, cart, listings, byId, base, qs, handle, link, cats, q, setQ, cat, setCat, sort, setSort, navigate, setMeta,
    setLang: (k) => { setLangPick(k); try { localStorage.setItem(langKey(handle), k); } catch {} },
    cartWord: theme.copy.cart, perks: opts.perks || [], cartSum: cartTotal(cart.cart, byId), year: new Date().getFullYear(),
    toast: setToast,
    goCat: (c) => { setCat(c); setQ(''); if (!isHome) navigate(link('')); setTimeout(() => document.getElementById('sv-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); },
  };
  const m = rest.match(/^p\/([\w-]+)/), pol = rest.match(/^policy\/(\w+)/);
  const onCart = rest.startsWith('cart');
  const home = link('');
  return (
    <StoreCtx.Provider value={ctx}>
      <div className={`st-page sv-root th-${theme.id}${theme.tokens.dark ? ' sv-dark' : ''}`} style={vars} lang={lang}>
        {s.demo && <div className="sv-demo"><span>{t('demo')}</span><a href={`/login?from=${encodeURIComponent(handle)}`}>{t('demoCta')} →</a></div>}
        <Announcement />
        <Header home={isHome} />
        {!s.enabled && <div className="st-note">{t('preview')}</div>}
        <main className="sv-main">
          {m ? <ProductPage id={m[1]} />
            : pol ? <PolicyPage k={pol[1]} />
            : onCart ? <div className="sv-wrap sv-cartwrap">{s.demo && <div className="sv-democheck"><b>{t('demoCheckout')}</b><a className="sv-btn" href={`/login?from=${encodeURIComponent(handle)}`}>{t('demoCta')}</a></div>}<Cart base={base} data={{ ...data, store: s, listings }} cart={cart} home={home} /></div>
            : <div className="sv-home">{sectionsOf(theme, opts).map((k) => { const C = SECTIONS[k]; return C ? <C key={k} /> : null; })}</div>}
        </main>
        <Footer />
        {!onCart && !m && <CartBar />}
        <WhatsAppButton product={m ? byId[m[1]]?.title : ''} />
        {toastMsg && <div className="sv-toast" role="status">{toastMsg} · <Link to={link('/cart')}>{t('viewCart')}</Link></div>}
      </div>
    </StoreCtx.Provider>
  );
}

function Cart({ base, data, cart, home }) {
  const s = data.store;
  const byId = Object.fromEntries(data.listings.map((l) => [l.id, l]));
  const [f, setF] = useState(() => ({ name: '', email: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', coupon: '', method: 'online' }));
  const [quote, setQuote] = useState(null);
  const [agree, setAgree] = useState(false); // COD with a non-refundable advance: the buyer's tick
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [code, setCode] = useState('');
  const [couponErr, setCouponErr] = useState('');
  const set = (p) => setF({ ...f, ...p });
  const items = cart.cart.filter((x) => byId[x.id]);
  const body = (extra = {}) => ({ cart: items, coupon: code || undefined, email: f.email, method: f.method === 'cod' ? 'cod' : undefined, ...extra });
  const key = JSON.stringify([items, code, f.method]);
  useEffect(() => {
    if (!items.length) { setQuote(null); return; }
    buyerPost(`${base}/quote`, body()).then((r) => {
      if (r.error && r.code === 'coupon') { setCouponErr(r.error); setCode(''); } else if (r.error) { setErr(r.error); setQuote(null); } else { setErr(''); setQuote(r); }
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (done) return (
    <div className="st-done">
      <h2>Thank you{f.name ? `, ${f.name.split(' ')[0]}` : ''}!</h2>
      <p>Your order <b>#{done.orderId}</b> is {done.provider === 'cod' ? 'booked — pay in cash when it arrives' : 'confirmed'}.</p>
      {done.access && <p><a className="st-btn" href={done.access}>Get your downloads</a></p>}
      {done.invoice && <p><a href={done.invoice} target="_blank" rel="noreferrer">View your GST invoice</a></p>}
      <Link to={home}>Continue shopping</Link>
    </div>
  );
  if (!items.length) return <div className="st-empty"><h2>Your cart is empty</h2><Link className="st-btn" to={home}>Shop now</Link></div>;
  const needsAddress = quote?.needsAddress;
  // Cash on Delivery with an advance paid online first (server/cod.js): { amount, due, keep } from the quote
  const adv = f.method === 'cod' ? quote?.prepaid : null;
  const pay = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const address = needsAddress ? { line1: f.line1, line2: f.line2, city: f.city, state: f.state, pincode: f.pincode } : undefined;
    const b = body({ name: f.name, phone: f.phone, address, source: 'store', ...(adv ? { acceptAdvance: agree } : {}) });
    let r;
    if (f.method === 'cod' && !adv) r = await buyerPost(`${base}/cod`, b);
    else {
      const st = await buyerPost(`${base}/pay/start`, b);
      if (st.error) r = st;
      else if (st.provider === 'cod') r = st;
      else if (st.provider === 'demo') r = await buyerPost(`${base}/order`, b);
      else if (st.provider === 'free') r = st;
      else if (st.provider === 'stripe') {
        const back = new URL(location.href);
        try { const x = await stripeDialog(st, back.toString()); r = x.error ? x : await confirmPaid(`${base}/pay/stripe/verify`, { payment: st.payment }); } catch (er) { r = { error: er.message }; }
      } else {
        try {
          await loadRazorpay();
          r = await new Promise((resolve) => {
            const rz = new window.Razorpay({
              key: st.key, order_id: st.order_id, amount: st.amount, currency: st.currency, name: st.name, description: st.description, prefill: st.prefill, theme: { color: st.color }, retry: { enabled: true },
              handler: async (resp) => resolve(await confirmPaid(`${base}/pay/verify`, { payment: st.payment, ...resp })),
              modal: { ondismiss: () => resolve({ error: 'Payment cancelled — you can try again whenever you’re ready' }) },
            });
            rz.open();
          });
        } catch (er) { r = { error: er.message }; }
      }
    }
    setBusy(false);
    if (r?.error) return setErr(r.error);
    cart.clear();
    setDone({ ...r, provider: r.provider || (f.method === 'cod' ? 'cod' : 'online') });
  };
  return (
    <div className="st-cart">
      <section>
        <h2>Your cart</h2>
        {items.map((x) => { const l = byId[x.id]; return (
          <div className="st-line" key={x.id}>
            {l.images[0] ? <img src={l.images[0]} alt="" /> : <span className="st-ph" />}
            <div className="st-line-info"><b>{l.title}</b><small>{rs(l.price)}{l.kind === 'physical' && l.stock <= 5 ? ` · only ${l.stock} left` : ''}</small>
              {l.kind === 'physical' ? <div className="st-qty sm"><button onClick={() => cart.setQty(x.id, x.qty - 1)} aria-label="Less">−</button><span>{x.qty}</span><button onClick={() => cart.setQty(x.id, Math.min(l.stock, x.qty + 1))} aria-label="More">+</button></div> : null}
            </div>
            <div className="st-line-end"><b>{rs(l.price * (l.kind === 'digital' ? 1 : x.qty))}</b><button className="st-link" onClick={() => cart.remove(x.id)}>Remove</button></div>
          </div>
        ); })}
        <div className="st-coupon"><input placeholder="Coupon code" value={f.coupon} onChange={(e) => set({ coupon: e.target.value })} /><button type="button" className="st-btn ghost" onClick={() => { setCouponErr(''); setCode(f.coupon.trim()); }}>Apply</button></div>
        {couponErr && <small className="st-err">{couponErr}</small>}
        {quote && <dl className="st-sum">
          <dt>Subtotal</dt><dd>{rs(quote.subtotal)}</dd>
          {quote.discount > 0 && <><dt>Discount ({quote.coupon})</dt><dd>−{rs(quote.discount)}</dd></>}
          {quote.needsAddress && <><dt>Shipping</dt><dd>{quote.shipping ? rs(quote.shipping) : 'Free'}</dd></>}
          {quote.codFee > 0 && <><dt>COD fee</dt><dd>{rs(quote.codFee)}</dd></>}
          <dt className="tot">Total</dt><dd className="tot">{rs(quote.total)}</dd>
        </dl>}
        {quote?.needsAddress && s.shipping?.freeAbove > 0 && quote.shipping > 0 && <small className="st-tax">Free shipping on orders above {rs(s.shipping.freeAbove)}</small>}
      </section>
      <form className="st-form" onSubmit={pay}>
        <h2>Checkout</h2>
        <input required placeholder="Full name" value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />
        <input type="email" required={!!quote?.digital} placeholder={quote?.digital ? 'Email (downloads are sent here)' : 'Email'} value={f.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
        <input type="tel" required={f.method === 'cod'} placeholder="Mobile number" value={f.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" />
        {needsAddress && <>
          <input required placeholder="Address" value={f.line1} onChange={(e) => set({ line1: e.target.value })} autoComplete="address-line1" />
          <input placeholder="Landmark (optional)" value={f.line2} onChange={(e) => set({ line2: e.target.value })} autoComplete="address-line2" />
          <div className="st-two"><input required placeholder="City" value={f.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" /><input required inputMode="numeric" maxLength={6} placeholder="PIN code" value={f.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })} autoComplete="postal-code" /></div>
          <select required value={f.state} onChange={(e) => set({ state: e.target.value })}><option value="">State</option>{IN_STATES.map((x) => <option key={x}>{x}</option>)}</select>
        </>}
        {quote?.codAllowed && <div className="st-methods">
          <label><input type="radio" checked={f.method === 'online'} onChange={() => set({ method: 'online' })} /> Pay online</label>
          <label><input type="radio" checked={f.method === 'cod'} onChange={() => set({ method: 'cod' })} /> Cash on Delivery{s.cod?.fee ? ` (+${rs(s.cod.fee)})` : ''}</label>
        </div>}
        {adv && <div className="st-methods">
          <p><b>Pay {rs(adv.amount)} now to confirm, {rs(adv.due)} on delivery</b></p>
          {adv.keep && <label><input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {rs(adv.amount)} is non-refundable if you refuse the delivery</label>}
        </div>}
        {err && <p className="st-err" role="alert">{err}</p>}
        <button className="st-btn big" disabled={busy || !quote || !s.enabled || s.demo}>{busy ? 'Processing…' : adv ? `Pay ${rs(adv.amount)} now · ${rs(adv.due)} on delivery` : f.method === 'cod' ? `Place order · ${quote ? rs(quote.total) : ''}` : `Pay ${quote ? rs(quote.total) : ''}`}</button>
        <small className="st-tax">🔒 Secure checkout{s.payments === 'demo' ? ' (demo — no payment taken)' : ''}</small>
      </form>
    </div>
  );
}
