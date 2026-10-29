import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { loadRazorpay } from '../api';
import { buyerPost, confirmPaid } from '../buyerFetch';
import { stripeDialog } from '../stripePay';
import '../store.css';

// The public store (/s/<handle>): home with categories, search and sort, product pages, a cart kept in this browser,
// and one checkout for the whole cart. The server prices everything (server/store.js) — this page only shows it.
const IN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const getJson = (url) => fetch(url).then((r) => r.json().then((d) => (r.ok ? d : { error: d.error || 'Not available' }))).catch(() => ({ error: 'Network problem — check your connection' }));
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

export default function Store() {
  const { handle } = useParams();
  const rest = useParams()['*'] || '';
  const { search } = useLocation();
  const pv = new URLSearchParams(search).get('pv');
  const qs = pv ? `?pv=${encodeURIComponent(pv)}` : '';
  const [data, setData] = useState(null);
  const cart = useCart(handle);
  const base = `/api/s/${handle}`;
  useEffect(() => { getJson(`${base}${qs}`).then(setData); }, [base, qs]);
  useEffect(() => { if (data?.store) { document.title = data.store.name; document.documentElement.style.setProperty('--st-brand', data.store.color); } }, [data]);
  if (!data) return <div className="st-page"><div className="st-wrap"><div className="st-skel" /></div></div>;
  if (data.error) return <div className="st-page"><div className="st-wrap st-empty"><h2>{data.error}</h2></div></div>;
  const s = data.store;
  const home = `/s/${handle}${qs}`;
  const m = rest.match(/^p\/([\w-]+)/);
  return (
    <div className="st-page" style={{ '--st-brand': s.color }}>
      <header className="st-top">
        <Link to={home} className="st-brand">{s.logo ? <img src={s.logo} alt="" /> : null}<span>{s.name}</span></Link>
        <Link to={`/s/${handle}/cart${qs}`} className="st-cartbtn" aria-label="Cart">🛒<span>{cart.count}</span></Link>
      </header>
      {!s.enabled && <div className="st-note">Preview — this store isn’t open yet, so nothing can be bought.</div>}
      <main className="st-wrap">
        {m ? <Product base={base} qs={qs} id={m[1]} cart={cart} handle={handle} />
          : rest.startsWith('cart') ? <Cart base={base} data={data} cart={cart} home={home} />
          : <Home data={data} base={base} qs={qs} cart={cart} handle={handle} />}
      </main>
      <footer className="st-foot">
        {Object.entries(s.policies || {}).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer">{{ refund: 'Refunds', shipping: 'Shipping', terms: 'Terms', privacy: 'Privacy', contact: 'Contact' }[k]}</a>)}
        <span>© {s.name}</span>
      </footer>
    </div>
  );
}

function Card({ l, to, onAdd }) {
  return (
    <div className="st-card">
      <Link to={to} className="st-img">{l.images[0] ? <img src={l.images[0]} alt={l.title} loading="lazy" /> : <span />}{l.mrp && <em>{Math.round((1 - l.price / l.mrp) * 100)}% off</em>}</Link>
      <Link to={to} className="st-title">{l.title}</Link>
      <div className="st-price"><b>{rs(l.price)}</b>{l.mrp && <s>{rs(l.mrp)}</s>}</div>
      {l.soldOut ? <button className="st-btn" disabled>Sold out</button> : <button className="st-btn" onClick={() => onAdd(l.id)}>Add to cart</button>}
    </div>
  );
}

function Home({ data, base, qs, cart, handle }) {
  const s = data.store;
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('');
  const [added, setAdded] = useState('');
  const list = useMemo(() => {
    let l = data.listings.filter((x) => (!cat || x.category === cat) && (!q || `${x.title} ${x.description} ${x.category}`.toLowerCase().includes(q.toLowerCase())));
    if (sort === 'price_asc') l = [...l].sort((a, b) => a.price - b.price);
    if (sort === 'price_desc') l = [...l].sort((a, b) => b.price - a.price);
    if (sort === 'name') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [data, cat, q, sort]);
  const cats = s.categories.filter((c) => data.listings.some((l) => l.category === c));
  const add = (id) => { cart.add(id); setAdded(id); setTimeout(() => setAdded(''), 1500); };
  return (
    <>
      {(s.tagline || s.about) && <section className="st-hero"><h1>{s.tagline || s.name}</h1>{s.about && <p>{s.about}</p>}</section>}
      <div className="st-tools">
        <input type="search" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="">Featured</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option></select>
      </div>
      {cats.length > 0 && <div className="st-cats"><button className={!cat ? 'on' : ''} onClick={() => setCat('')}>All</button>{cats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>}
      {!list.length ? <p className="st-empty">No products found.</p> : <div className="st-grid">{list.map((l) => <Card key={l.id} l={l} to={`/s/${handle}/p/${l.id}${qs}`} onAdd={add} />)}</div>}
      {added && <div className="st-toast">Added to cart · <Link to={`/s/${handle}/cart${qs}`}>View cart</Link></div>}
    </>
  );
}

function Product({ base, qs, id, cart, handle }) {
  const [d, setD] = useState(null);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  useEffect(() => { getJson(`${base}/p/${id}${qs}`).then(setD); }, [base, id, qs]);
  useEffect(() => { if (d?.listing) document.title = `${d.listing.title} · ${d.store.name}`; }, [d]);
  if (!d) return <div className="st-skel" />;
  if (d.error) return <p className="st-empty">{d.error}</p>;
  const l = d.listing;
  const max = l.kind === 'digital' ? 1 : Math.max(1, l.stock);
  return (
    <div className="st-prod">
      <div className="st-gallery">
        <div className="st-main">{l.images[img] ? <img src={l.images[img]} alt={l.title} /> : <span />}</div>
        {l.images.length > 1 && <div className="st-thumbs">{l.images.map((u, i) => <button key={u + i} className={i === img ? 'on' : ''} onClick={() => setImg(i)}><img src={u} alt="" /></button>)}</div>}
      </div>
      <div className="st-info">
        <h1>{l.title}</h1>
        <div className="st-price big"><b>{rs(l.price)}</b>{l.mrp && <><s>{rs(l.mrp)}</s><em>{Math.round((1 - l.price / l.mrp) * 100)}% off</em></>}</div>
        <small className="st-tax">Inclusive of all taxes{l.kind === 'digital' ? ' · instant download' : ''}</small>
        {l.kind === 'physical' && (l.soldOut ? <p className="st-stock out">Sold out</p> : l.stock <= 5 ? <p className="st-stock">Only {l.stock} left</p> : null)}
        {!l.soldOut && <div className="st-buy">
          {l.kind === 'physical' && <div className="st-qty"><button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less">−</button><span>{qty}</span><button onClick={() => setQty(Math.min(max, qty + 1))} aria-label="More">+</button></div>}
          <button className="st-btn" onClick={() => { cart.add(l.id, qty); setAdded(true); }}>Add to cart</button>
        </div>}
        {added && <p className="st-ok">Added · <Link to={`/s/${handle}/cart${qs}`}>Go to cart</Link></p>}
        {l.description && <div className="st-desc">{l.description}</div>}
      </div>
    </div>
  );
}

function Cart({ base, data, cart, home }) {
  const s = data.store;
  const byId = Object.fromEntries(data.listings.map((l) => [l.id, l]));
  const [f, setF] = useState(() => ({ name: '', email: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '', coupon: '', method: 'online' }));
  const [quote, setQuote] = useState(null);
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
  const pay = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const address = needsAddress ? { line1: f.line1, line2: f.line2, city: f.city, state: f.state, pincode: f.pincode } : undefined;
    const b = body({ name: f.name, phone: f.phone, address, source: 'store' });
    let r;
    if (f.method === 'cod') r = await buyerPost(`${base}/cod`, b);
    else {
      const st = await buyerPost(`${base}/pay/start`, b);
      if (st.error) r = st;
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
        {err && <p className="st-err" role="alert">{err}</p>}
        <button className="st-btn big" disabled={busy || !quote || !s.enabled}>{busy ? 'Processing…' : f.method === 'cod' ? `Place order · ${quote ? rs(quote.total) : ''}` : `Pay ${quote ? rs(quote.total) : ''}`}</button>
        <small className="st-tax">🔒 Secure checkout{s.payments === 'demo' ? ' (demo — no payment taken)' : ''}</small>
      </form>
    </div>
  );
}
