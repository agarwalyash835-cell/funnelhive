// The shared kit of storefront sections. Every theme uses these; a theme picks variants through theme.layout
// (header, hero, cats, card, product, footer) and the home page's section order. Styling: storeThemes.css
// (.sv-* for the kit, .th-<id> for a theme's own touches). CSS-only effects, lazy images with width / height.
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LANGS } from './i18n.js';
import { rupees, offPct, catIcon, waLink, bundleOf, compareSet, heroOf } from './tokens.js';

export const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);
export const getJson = (url) => fetch(url).then((r) => r.json().then((d) => (r.ok ? d : { error: d.error || 'Not available' }))).catch(() => ({ error: 'Network problem — check your connection' }));

// ---------- small pieces ----------
const Svg = ({ d, size = 20, sw = 1.8, fill = 'none' }) => <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const IC = {
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2M10 21h.01M17 21h.01',
  bag: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm10 3-5-5',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v.01M18 14v.01',
  upi: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  chat: 'M4 5h16v11H9l-5 4V5Z',
  check: 'M5 12.5l4.5 4.5L19 7',
  pin: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  seal: 'M12 3l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1L12 3Zm-3 9 2 2 4-4',
  gem: 'M6 4h12l3 5-9 11L3 9l3-5Zm-3 5h18M9 4l3 16M15 4l-3 16',
  tool: 'M14.5 5.5a4 4 0 0 0 5 5L12 18l-3 3-3-3 3-3 7.5-7.5Zm0 0L17 3M4 4l6 6',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
};
export const Icon = ({ n, size }) => <Svg d={IC[n]} size={size} />;
const WaGlyph = () => <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.7 11.7 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.6-.4Z" /></svg>;
const PERK_ICON = { freeDelivery: 'truck', fastDelivery: 'truck', returns7: 'arrow', exchange: 'arrow', warranty: 'lock', emi: 'cash', authentic: 'check', crueltyFree: 'check', fresh: 'check', handmade: 'check',
  hallmark: 'seal', certified: 'gem', installation: 'tool', licensed: 'cross', bakedFresh: 'check' };
// "Purity: 22KT (916)" → "22KT (916)": the values of the first highlights, for a card's spec line
const specLine = (hl = [], n = 2) => hl.slice(0, n).map((h) => h.split(/:\s*/).pop()).join(' · ');
// the FSSAI mark: a green dot in a square for veg, a brown triangle for non-veg
export function Diet({ d }) {
  const { t } = useStore();
  return d === 'veg' || d === 'nonveg' ? <i className={`sv-diet ${d}`} role="img" aria-label={t(d)} title={t(d)} /> : null;
}

// an image in a fixed-ratio box: lazy unless it's above the fold, with width / height so nothing jumps
export function Img({ src, alt = '', portrait, eager }) {
  if (!src) return <span className="sv-noimg" aria-hidden="true" />;
  return <img src={src} alt={alt} width={portrait ? 600 : 400} height={portrait ? 800 : 400} loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? { fetchpriority: 'high' } : {})} />;
}
export function Price({ l, big }) {
  const { t } = useStore();
  const off = offPct(l.price, l.mrp);
  return <div className={`sv-price${big ? ' big' : ''}`}><b>{rupees(l.price)}</b>{l.mrp ? <s>{rupees(l.mrp)}</s> : null}{off > 0 && <em>{t('off', { n: off })}</em>}</div>;
}
export const Stars = ({ r, n }) => <span className="sv-stars" aria-label={`${r} / 5`}><i>★</i>{Number(r).toFixed(1)}{n ? <small>({Number(n).toLocaleString('en-IN')})</small> : null}</span>;
export function AddButton({ l, qty = 1, className = '' }) {
  const { cart, t, cartWord, toast } = useStore();
  if (l.soldOut) return <button type="button" className={`sv-btn ${className}`} disabled>{t('soldOut')}</button>;
  return <button type="button" className={`sv-btn ${className}`} onClick={() => { cart.add(l.id, qty); toast(t('added', { c: t(cartWord) })); }}>{t(cartWord === 'bag' ? 'addToBag' : 'addToCart')}</button>;
}
// grocery's quick add: ADD → − n +
export function Stepper({ l }) {
  const { cart, t } = useStore();
  const n = cart.cart.find((x) => x.id === l.id)?.qty || 0;
  if (l.soldOut) return <button type="button" className="sv-add" disabled>{t('soldOut')}</button>;
  if (!n) return <button type="button" className="sv-add" onClick={() => cart.add(l.id)}>{t('add')}<span aria-hidden="true">+</span></button>;
  const max = l.kind === 'digital' ? 1 : l.stock ?? 999;
  return <div className="sv-stepper"><button type="button" onClick={() => cart.setQty(l.id, n - 1)} aria-label="−">−</button><b aria-live="polite">{n}</b><button type="button" disabled={n >= max} onClick={() => cart.setQty(l.id, Math.min(max, n + 1))} aria-label="+">+</button></div>;
}
function SpecBadges({ l }) {
  const { perks, t } = useStore();
  const out = [];
  if (perks.includes('emi') && l.price >= 3000) out.push(<span key="emi" className="sv-pill hot">{t('emiFrom', { p: rupees(Math.ceil(l.price / 6)) })}</span>);
  if (perks.includes('warranty')) out.push(<span key="w" className="sv-pill">{t('warranty')}</span>);
  return out.length ? <div className="sv-pills">{out}</div> : null;
}
export function LangToggle() {
  const { lang, setLang } = useStore();
  return <div className="sv-lang" role="group" aria-label="Language">{LANGS.map(([k, l]) => <button type="button" key={k} aria-pressed={lang === k} onClick={() => setLang(k)} lang={k}>{l}</button>)}</div>;
}
export function PayBadges() {
  const { s } = useStore();
  return <div className="sv-paybadges" aria-label="Payment options">{['UPI', 'RuPay', 'Visa', 'Mastercard', ...(s.cod?.enabled ? ['COD'] : [])].map((x) => <span key={x}>{x}</span>)}</div>;
}
function CopyCode({ code }) {
  const { t } = useStore();
  const [ok, setOk] = useState(false);
  return <button type="button" className="sv-code" onClick={() => { navigator.clipboard?.writeText(code).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 1500); }}>{code}<small>{ok ? t('copied') : t('copy')}</small></button>;
}
export function PincodeCheck({ compact }) {
  const { base, qs, t } = useStore();
  const [pin, setPin] = useState(() => { try { return localStorage.getItem('ff_pin') || ''; } catch { return ''; } });
  const [r, setR] = useState(null);
  const check = async (e) => {
    e.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pin)) return setR({ valid: false, message: t('pinPh') });
    const x = await getJson(`${base}/pincode${qs ? `${qs}&` : '?'}pin=${pin}`);
    setR(x);
    try { localStorage.setItem('ff_pin', pin); } catch {}
  };
  const bad = r && (!r.valid || !r.deliverable || r.error);
  const msg = !r ? '' : r.error || (!r.valid || !r.deliverable ? r.message : `${r.state ? t('deliversTo', { s: r.state }) : t('delivers')} · ${r.cod ? t('codYes') : t('codNo')}`);
  return (
    <form className={`sv-pin${compact ? ' compact' : ''}`} onSubmit={check}>
      {!compact && <label htmlFor="sv-pin-in"><Icon n="pin" size={16} />{t('checkPin')}</label>}
      <div><input id="sv-pin-in" inputMode="numeric" maxLength={6} placeholder={t('pinPh')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={t('pinPh')} /><button type="submit">{t('check')}</button></div>
      {msg && <small className={bad ? 'bad' : 'ok'} role="status">{msg}</small>}
    </form>
  );
}

// ---------- chrome ----------
export function Announcement() {
  const { s, opts, t } = useStore();
  const text = opts.announcement || (s.shipping?.freeAbove > 0 ? t('freeAbove', { p: rupees(s.shipping.freeAbove) }) : '');
  return text ? <div className="sv-ann"><span>{text}</span></div> : null;
}
export function Header({ home }) {
  const { s, theme, t, cart, link, cats, goCat, q, setQ, cartWord, navigate } = useStore();
  const v = theme.layout.header;
  const search = (
    <form className="sv-search" role="search" onSubmit={(e) => { e.preventDefault(); if (!home) navigate(link('')); setTimeout(() => document.getElementById('sv-grid')?.scrollIntoView({ behavior: 'smooth' }), 60); }}>
      <Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPh')} aria-label={t('search')} />
    </form>
  );
  return (
    <header className={`sv-hdr hdr-${v}`}>
      <div className="sv-hdr-row">
        {(v === 'center' || v === 'soft') && <span className="sv-hdr-start"><LangToggle /></span>}
        <Link to={link('')} className="sv-brand">{s.logo ? <img src={s.logo} alt="" height="34" /> : null}<span>{s.name}</span></Link>
        {v === 'bar' && search}
        <div className="sv-hdr-end">
          {v !== 'center' && v !== 'soft' && <LangToggle />}
          <Link to={link('/cart')} className="sv-cartbtn" aria-label={`${t(cartWord)} (${cart.count})`}><Icon n={cartWord === 'bag' ? 'bag' : 'cart'} size={22} /><span className="sv-cartword">{t(cartWord)}</span>{cart.count > 0 && <b>{cart.count}</b>}</Link>
        </div>
      </div>
      {v === 'search' && <div className="sv-hdr-row2">{search}</div>}
      {v === 'center' && cats.length > 0 && <nav className="sv-catnav" aria-label={t('categories')}>{cats.slice(0, 8).map((c) => <button type="button" key={c} onClick={() => goCat(c)}>{c}</button>)}</nav>}
    </header>
  );
}
export function Footer() {
  const { s, t, link, cats, goCat, year, opts } = useStore();
  const pol = [...(s.policyPages || []).map((p) => ({ k: p.k, to: link(`/policy/${p.k}`) })), ...Object.entries(s.policies || {}).filter(([k]) => !(s.policyPages || []).some((p) => p.k === k)).map(([k, u]) => ({ k, href: u }))];
  return (
    <footer className="sv-foot">
      <div className="sv-foot-in">
        <div className="sv-foot-brand"><b>{s.name}</b>{s.tagline && <p>{s.tagline}</p>}{opts.credentials && <p className="sv-cred">{opts.credentials}</p>}<PayBadges /></div>
        {cats.length > 0 && <div><h4>{t('shop')}</h4>{cats.slice(0, 6).map((c) => <button type="button" key={c} onClick={() => goCat(c)}>{c}</button>)}</div>}
        {pol.length > 0 && <div><h4>{t('help')}</h4>{pol.map((p) => (p.to ? <Link key={p.k} to={p.to}>{t(p.k)}</Link> : <a key={p.k} href={p.href} target="_blank" rel="noreferrer">{t(p.k)}</a>))}</div>}
      </div>
      <div className="sv-foot-base"><span>© {year} {s.name}</span><LangToggle /><a className="sv-made" href="/">{t('madeWith')}</a></div>
    </footer>
  );
}
export function WhatsAppButton({ product }) {
  const { s, t } = useStore();
  if (!s.whatsapp) return null;
  return <a className="sv-wa" href={waLink(s.whatsapp, product ? t('askWa', { p: product }) : '')} target="_blank" rel="noreferrer" aria-label={t('chat')}><WaGlyph /></a>;
}
export function CartBar() {
  const { cart, t, link, cartSum } = useStore();
  if (!cart.count) return null;
  return <Link className="sv-cbar" to={link('/cart')}><span>{cart.count === 1 ? t('item') : t('items', { n: cart.count })} · <b>{rupees(cartSum)}</b></span><span>{t('viewCart')} <Icon n="arrow" size={18} /></span></Link>;
}

// ---------- home sections ----------
const scrollToGrid = () => document.getElementById('sv-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
export function Hero() {
  const { s, opts, theme, t, listings } = useStore();
  const layout = heroOf(theme, opts);
  const title = opts.heroTitle || s.tagline || s.name;
  const text = opts.heroText || (opts.heroTitle ? '' : (s.about || '').slice(0, 180));
  const pics = opts.heroImage ? [opts.heroImage] : listings.filter((l) => l.images[0]).slice(0, 3).map((l) => l.images[0]);
  const portrait = (theme.id === 'fashion' || theme.portrait) && !opts.heroImage;
  return (
    <section className={`sv-hero hero-${layout}${opts.heroImage ? ' own' : ''}`}>
      {layout !== 'minimal' && pics.length > 0 && <div className={`sv-hero-art n${pics.length}`}>{pics.map((u, i) => <Img key={u + i} src={u} portrait={portrait} eager={i === 0} />)}</div>}
      <div className="sv-hero-copy">
        {layout !== 'minimal' && s.tagline && opts.heroTitle && <span className="sv-kicker">{s.name}</span>}
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        <button type="button" className="sv-btn" onClick={scrollToGrid}>{opts.heroCta || t('shopNow')}<Icon n="arrow" size={18} /></button>
      </div>
    </section>
  );
}
export function Delivery() {
  const { s, opts, t } = useStore();
  const free = s.shipping?.freeAbove > 0 ? t('freeAbove', { p: rupees(s.shipping.freeAbove) }) : '';
  if (!opts.deliveryNote && !free) return null;
  return (
    <section className="sv-sec"><div className="sv-deliv">
      <span className="sv-deliv-ic"><Icon n="truck" size={26} /></span>
      <div className="sv-deliv-txt"><b>{opts.deliveryNote || free}</b>{opts.deliveryNote && free && <small>{free}</small>}</div>
      {s.pincode && <PincodeCheck compact />}
    </div></section>
  );
}
export function Offers() {
  const { opts, t } = useStore();
  const list = opts.offers || [];
  if (!list.length) return null;
  return <section className="sv-sec"><h2 className="sv-h2">{t('offers')}</h2><div className="sv-offers">{list.map((o, i) => <div className={`sv-offer o${i % 3}`} key={i}><b>{o.title}</b>{o.note && <span>{o.note}</span>}{o.code && <CopyCode code={o.code} />}</div>)}</div></section>;
}
export function Categories() {
  const { theme, cats, listings, t, goCat, cat } = useStore();
  if (cats.length < 2) return null;
  const v = theme.layout.cats;
  const img = (c) => listings.find((l) => l.category === c && l.images[0])?.images[0];
  return (
    <section className="sv-sec">
      <h2 className="sv-h2">{t(theme.copy.cats || 'categories')}</h2>
      <div className={`sv-cats cats-${v}`}>
        {cats.map((c) => (
          <button type="button" key={c} className={cat === c ? 'on' : ''} onClick={() => goCat(c)}>
            {(v === 'tiles' || v === 'rail') && <span className="sv-cat-ic" aria-hidden="true">{catIcon(c)}</span>}
            {(v === 'portrait' || v === 'circles') && <span className="sv-cat-img">{img(c) ? <Img src={img(c)} portrait={v === 'portrait'} /> : <i aria-hidden="true">{catIcon(c)}</i>}</span>}
            <span className="sv-cat-name">{c}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
export function NewRail() {
  const { listings, theme, t } = useStore();
  if (listings.length < 6) return null;
  const list = [...listings.filter((l) => l.badge), ...listings.filter((l) => !l.badge)].slice(0, 8);
  return <section className="sv-sec"><div className="sv-sec-head"><h2 className="sv-h2">{t(theme.copy.new)}</h2><button type="button" className="sv-more" onClick={scrollToGrid}>{t('shopAll')}<Icon n="arrow" size={16} /></button></div><div className="sv-rail">{list.map((l) => <Card key={l.id} l={l} />)}</div></section>;
}
export function Lookbook() {
  const { listings, t, link } = useStore();
  const list = listings.filter((l) => l.images[0]).slice(0, 6);
  if (list.length < 3) return null;
  return (
    <section className="sv-sec sv-look">
      <h2 className="sv-h2">{t('lookbook')}</h2>
      <div className="sv-look-strip">{list.map((l, i) => <Link key={l.id} to={link(`/p/${l.id}`)} className="sv-look-item"><Img src={l.images[0]} portrait /><span><small>{t('look', { n: String(i + 1).padStart(2, '0') })}</small>{l.title}</span></Link>)}</div>
    </section>
  );
}
export function Bundles() {
  const { listings, cats, t, cart, theme, link, toast, cartWord } = useStore();
  const b = bundleOf(listings, cats);
  if (!b.length) return null;
  const total = b.reduce((x, l) => x + l.price, 0), mrp = b.reduce((x, l) => x + (l.mrp || l.price), 0);
  return (
    <section className="sv-sec"><div className="sv-bundle">
      <div className="sv-bundle-head"><h2 className="sv-h2">{theme.copy.bundle ? t(theme.copy.bundle) : theme.id === 'fashion' ? t('completeLook') : t('routine')}</h2><p>{t(theme.copy.bundle ? `${theme.copy.bundle}Sub` : 'routineSub')}</p></div>
      <div className="sv-bundle-row">{b.map((l, i) => <Fragment key={l.id}>{i > 0 && <span className="sv-plus" aria-hidden="true">+</span>}<Link className="sv-bundle-item" to={link(`/p/${l.id}`)}><span className="sv-stepno">{i + 1}</span><Img src={l.images[0]} /><small>{l.category}</small><b>{l.title}</b><span>{rupees(l.price)}</span></Link></Fragment>)}</div>
      <div className="sv-bundle-foot">{mrp > total && <s>{rupees(mrp)}</s>}<button type="button" className="sv-btn" onClick={() => { b.forEach((l) => cart.add(l.id)); toast(t('added', { c: t(cartWord) })); }}>{t('addRoutine', { n: b.length, p: rupees(total) })}</button></div>
    </div></section>
  );
}
export function Compare() {
  const { listings, cats, t, link } = useStore();
  const c = compareSet(listings, cats);
  if (!c) return null;
  const rows = Math.max(...c.items.map((l) => l.highlights.length));
  return (
    <section className="sv-sec">
      <div className="sv-sec-head"><h2 className="sv-h2">{t('compare')} · {c.category}</h2></div>
      <p className="sv-sub">{t('compareSub')}</p>
      <div className="sv-cmp" style={{ '--n': c.items.length }}>
        {c.items.map((l) => (
          <div className="sv-cmp-col" key={l.id}>
            <Link to={link(`/p/${l.id}`)} className="sv-cmp-img"><Img src={l.images[0]} /></Link>
            <Link to={link(`/p/${l.id}`)} className="sv-cmp-title">{l.title}</Link>
            <Price l={l} />
            <ul>{Array.from({ length: rows }, (_, i) => <li key={i}>{l.highlights[i] || '—'}</li>)}</ul>
            <AddButton l={l} />
          </div>
        ))}
      </div>
    </section>
  );
}
export function Grid() {
  const { listings, cats, t, theme, q, setQ, cat, setCat, sort, setSort } = useStore();
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    let l = listings.filter((x) => (!cat || x.category === cat) && (!term || `${x.title} ${x.description} ${x.category}`.toLowerCase().includes(term)));
    if (sort === 'price_asc') l = [...l].sort((a, b) => a.price - b.price);
    if (sort === 'price_desc') l = [...l].sort((a, b) => b.price - a.price);
    if (sort === 'name') l = [...l].sort((a, b) => a.title.localeCompare(b.title));
    return l;
  }, [listings, cat, q, sort]);
  const headerSearch = ['search', 'bar'].includes(theme.layout.header);
  return (
    <section className="sv-sec sv-gridsec" id="sv-grid">
      <div className="sv-sec-head"><h2 className="sv-h2">{cat || t(theme.copy.grid)} <span className="sv-count">{list.length}</span></h2></div>
      <div className="sv-tools">
        {!headerSearch && <label className="sv-search"><Icon n="search" size={18} /><input type="search" placeholder={t('searchPh')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} /></label>}
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort"><option value="">{t('sortFeatured')}</option><option value="price_asc">{t('sortLow')}</option><option value="price_desc">{t('sortHigh')}</option><option value="name">{t('sortName')}</option></select>
      </div>
      {cats.length > 1 && <div className="sv-chiprow"><button type="button" className={!cat ? 'on' : ''} onClick={() => setCat('')}>{t('all')}</button>{cats.map((c) => <button type="button" key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>}
      {!list.length ? <p className="sv-empty">{t('noProducts')}</p> : <div className={`sv-grid grid-${theme.layout.card}`}>{list.map((l) => <Card key={l.id} l={l} />)}</div>}
    </section>
  );
}
export function Trust() {
  const { s, t, perks } = useStore();
  const items = [
    s.cod?.enabled && ['cash', t('cod'), t('codSub')], ['upi', t('upi'), t('upiSub')], ['lock', t('secure'), t('secureSub')], s.whatsapp && ['chat', t('support'), t('supportSub')],
    ...perks.map((p) => [PERK_ICON[p] || 'check', t(p), '']),
  ].filter(Boolean).slice(0, 8);
  return <section className="sv-sec sv-trust"><h2 className="sv-h2">{t('trustTitle')}</h2><div className="sv-trust-grid">{items.map(([ic, h, sub]) => <div key={h}><span className="sv-trust-ic"><Icon n={ic} size={22} /></span><b>{h}</b>{sub && <small>{sub}</small>}</div>)}</div></section>;
}
export function About() {
  const { s, t } = useStore();
  if (!s.about) return null;
  return <section className="sv-sec sv-about"><h2 className="sv-h2">{t('about')}</h2><p>{s.about}</p></section>;
}
// badges in a row (the store's perks: hallmarked, licensed, free installation…) and its licence / registration line
export function PromiseStrip() {
  const { opts, perks, t } = useStore();
  if (!perks.length && !opts.credentials) return null;
  return (
    <section className="sv-sec sv-promise">
      {perks.length > 0 && <div className="sv-promise-row">{perks.map((p) => <span key={p} className="sv-seal"><span className="sv-seal-ic"><Icon n={PERK_ICON[p] || 'check'} size={20} /></span>{t(p)}</span>)}</div>}
      {opts.credentials && <p className="sv-cred">{opts.credentials}</p>}
    </section>
  );
}
// the theme's "talk to us" panel (video call / try at home, send a prescription, bulk enquiry…) — opens WhatsApp
// with a first message; in a demo store it says what it would do. Compact on product pages (theme.assist.product).
export function Assist({ product }) {
  const { s, theme, t, toast } = useStore();
  const a = theme.assist;
  const acts = !a ? [] : product ? [a.product].filter(Boolean) : a.actions || [];
  if (!acts.length || (!s.whatsapp && !s.demo)) return null;
  const btn = (k, i) => {
    const cls = `sv-btn${i ? ' ghost' : ''}`, kids = <><WaGlyph />{t(k)}</>;
    return s.whatsapp
      ? <a key={k} className={cls} href={waLink(s.whatsapp, t(`${k}Wa`, { p: product || s.name }))} target="_blank" rel="noreferrer">{kids}</a>
      : <button key={k} type="button" className={cls} onClick={() => toast(t('demoWa'))}>{kids}</button>;
  };
  if (product) return <div className="sv-assist-mini">{acts.map(btn)}</div>;
  return (
    <section className="sv-sec"><div className="sv-assist">
      <div className="sv-assist-txt"><h2 className="sv-h2">{t(a.title)}</h2><p>{t(`${a.title}Sub`)}</p></div>
      <div className="sv-assist-act">{acts.map(btn)}</div>
    </div></section>
  );
}
// shop the room: one piece from each of the first four categories, arranged as a collage with numbered pins
export function Room() {
  const { listings, cats, t, cart, link, toast, cartWord } = useStore();
  const b = bundleOf(listings.filter((l) => l.images[0]), cats, 4);
  if (b.length < 3) return null;
  const total = b.reduce((x, l) => x + l.price, 0);
  return (
    <section className="sv-sec"><div className="sv-room">
      <div className="sv-room-head"><h2 className="sv-h2">{t('shopRoom')}</h2><p>{t('shopRoomSub')}</p></div>
      <div className={`sv-room-scene n${b.length}`}>{b.map((l, i) => <Link key={l.id} to={link(`/p/${l.id}`)} className={`sv-room-pc p${i + 1}`} aria-label={l.title}><Img src={l.images[0]} /><span className="sv-pinno">{i + 1}</span></Link>)}</div>
      <ol className="sv-room-list">{b.map((l, i) => <li key={l.id}><span className="sv-pinno">{i + 1}</span><Link to={link(`/p/${l.id}`)}>{l.title}<small>{specLine(l.highlights, 1) || l.category}</small></Link><b>{rupees(l.price)}</b></li>)}</ol>
      <button type="button" className="sv-btn" onClick={() => { b.forEach((l) => cart.add(l.id)); toast(t('added', { c: t(cartWord) })); }}>{t('addRoutine', { n: b.length, p: rupees(total) })}</button>
    </div></section>
  );
}
export const SECTIONS = { hero: Hero, delivery: Delivery, offers: Offers, categories: Categories, new: NewRail, lookbook: Lookbook, bundles: Bundles, compare: Compare, grid: Grid, trust: Trust, about: About, promise: PromiseStrip, assist: Assist, room: Room };

// ---------- product card ----------
export function Card({ l }) {
  const { theme, t, link } = useStore();
  const v = theme.layout.card, to = link(`/p/${l.id}`), off = offPct(l.price, l.mrp);
  return (
    <article className={`sv-card card-${v}${l.soldOut ? ' out' : ''}`}>
      <Link to={to} className="sv-card-img" aria-label={l.title}>
        <Img src={l.images[0]} alt="" portrait={v === 'editorial' || v === 'book'} />
        {l.badge ? <em className="sv-badge">{l.badge}</em> : off >= 5 && v !== 'editorial' && v !== 'luxe' ? <em className="sv-badge off">{t('off', { n: off })}</em> : null}
        {l.diet && <span className="sv-card-diet"><Diet d={l.diet} /></span>}
        {l.soldOut && <span className="sv-soldout">{t('soldOut')}</span>}
      </Link>
      <div className="sv-card-body">
        {v === 'soft' && l.highlights?.length ? <div className="sv-chips">{l.highlights.slice(0, 2).map((h) => <span key={h}>{h}</span>)}</div> : null}
        <Link to={to} className="sv-card-title">{l.title}</Link>
        {l.byline && (v === 'book' || v === 'clinic') ? <small className="sv-byline">{l.byline}</small> : null}
        {(v === 'luxe' || v === 'room') && l.highlights?.length ? <small className="sv-specline">{specLine(l.highlights)}</small> : null}
        {(v === 'compact' || v === 'treat' || v === 'clinic') && l.unit ? <small className="sv-unit">{l.unit}</small> : null}
        {l.rating ? <Stars r={l.rating} n={l.reviews} /> : null}
        {v === 'spec' && l.highlights?.length ? <ul className="sv-specs">{l.highlights.slice(0, 3).map((h) => <li key={h}>{h}</li>)}</ul> : null}
        <Price l={l} />
        {(v === 'spec' || v === 'room') && <SpecBadges l={l} />}
        {v === 'editorial' && l.sizes?.length ? <div className="sv-sizes sm">{l.sizes.slice(0, 6).map((z) => <span key={z}>{z}</span>)}</div> : null}
      </div>
      <div className="sv-card-act">{v === 'compact' || v === 'treat' ? <Stepper l={l} /> : <AddButton l={l} className={v === 'editorial' || v === 'luxe' ? 'line' : ''} />}</div>
    </article>
  );
}

// ---------- product page ----------
export function ProductPage({ id }) {
  const { base, qs, byId, theme, t, link, s, listings, setMeta, goCat, cart } = useStore();
  const [d, setD] = useState(null);
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  useEffect(() => { setD(null); setImg(0); setQty(1); getJson(`${base}/p/${id}${qs}`).then(setD); window.scrollTo(0, 0); }, [base, id, qs]);
  const l = byId[id] ? { ...d?.listing, ...byId[id], ...(d?.listing ? { stock: d.listing.stock, soldOut: d.listing.soldOut } : {}) } : d?.listing;
  useEffect(() => { if (l) setMeta(`${l.title} · ${s.name}`, l.description || s.tagline); }, [l?.id, l?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return d?.error ? <p className="sv-empty">{d.error}</p> : <div className="sv-skel" />;
  const v = theme.layout.product, hl = l.highlights || [], max = l.kind === 'digital' ? 1 : Math.max(1, l.stock ?? 1);
  const related = listings.filter((x) => x.id !== l.id && x.category === l.category).slice(0, 8);
  const pics = l.images.length ? l.images : [''];
  const portrait = theme.id === 'fashion' || !!theme.portrait;
  const inCart = cart.cart.find((x) => x.id === l.id);
  return (
    <div className={`sv-prod prod-${v}`}>
      <nav className="sv-crumbs" aria-label="Breadcrumb"><Link to={link('')}>{t('home')}</Link>{l.category && <><span aria-hidden="true">/</span><button type="button" onClick={() => goCat(l.category)}>{l.category}</button></>}</nav>
      <div className="sv-prod-grid">
        <div className={`sv-gallery${v === 'stack' ? ' stack' : ''}`}>
          {v === 'stack'
            ? pics.map((u, i) => <div className="sv-gimg" key={u + i}><Img src={u} alt={i ? '' : l.title} portrait={portrait} eager={i === 0} /></div>)
            : <><div className="sv-gimg main"><Img src={pics[img]} alt={l.title} portrait={portrait} eager />{l.badge && <em className="sv-badge">{l.badge}</em>}</div>
              {pics.length > 1 && <div className="sv-thumbs">{pics.map((u, i) => <button type="button" key={u + i} className={i === img ? 'on' : ''} onClick={() => setImg(i)} aria-label={`${i + 1}`}><Img src={u} /></button>)}</div>}</>}
        </div>
        <div className="sv-pinfo">
          {(l.badge && v === 'stack') || l.category ? <span className="sv-kicker">{v === 'stack' && l.badge ? l.badge : l.category}</span> : null}
          <h1>{l.diet && <Diet d={l.diet} />}{l.title}</h1>
          {l.byline && <p className="sv-byline">{l.byline}</p>}
          {l.rating ? <Stars r={l.rating} n={l.reviews} /> : null}
          <Price l={l} big />
          <small className="sv-tax">{t('inclTax')}{l.kind === 'digital' ? ` · ${t('instant')}` : ''}{l.unit ? ` · ${l.unit}` : ''}</small>
          {v === 'tech' && <SpecBadges l={l} />}
          {v === 'soft' && hl.length > 0 && <div className="sv-block"><h3>{t('benefits')}</h3><div className="sv-chips lg">{hl.map((h) => <span key={h}>{h}</span>)}</div></div>}
          {l.sizes?.length > 0 && <div className="sv-block"><h3>{t('sizes')}</h3><div className="sv-sizes">{l.sizes.map((z) => <span key={z}>{z}</span>)}</div><small className="sv-tax">{t('sizeNote')}</small></div>}
          {l.kind === 'physical' && !l.soldOut && l.stock <= 5 && <p className="sv-low">{t('onlyLeft', { n: l.stock })}</p>}
          <div className="sv-buy">
            {l.kind !== 'digital' && !l.soldOut && <div className="sv-qty"><button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="−">−</button><span>{qty}</span><button type="button" onClick={() => setQty(Math.min(max, qty + 1))} aria-label="+">+</button></div>}
            <AddButton l={l} qty={qty} className="big" />
          </div>
          {inCart && <Link className="sv-incart" to={link('/cart')}><Icon n="check" size={16} />{t('inCart')} · {inCart.qty} — {t('viewCart')}</Link>}
          {theme.assist?.product && <Assist product={l.title} />}
          {s.pincode && l.kind !== 'digital' && <PincodeCheck />}
          <PerkRow />
          {v === 'table' && hl.length > 0 && <div className="sv-block"><h3>{t('details')}</h3><table className="sv-dtable"><tbody>{hl.map((h) => { const i = h.indexOf(':'); return i > 0 ? <tr key={h}><th scope="row">{h.slice(0, i)}</th><td>{h.slice(i + 1).trim()}</td></tr> : <tr key={h}><td colSpan={2}>{h}</td></tr>; })}</tbody></table></div>}
          {theme.note && <p className="sv-note">{t(theme.note)}</p>}
          {v === 'tech' && hl.length > 0 && <div className="sv-block"><h3>{t('specs')}</h3><div className="sv-spec-tiles">{hl.map((h) => <span key={h}>{h}</span>)}</div></div>}
          {v !== 'tech' && v !== 'soft' && v !== 'table' && hl.length > 0 && <div className="sv-block"><h3>{t('highlights')}</h3><ul className="sv-hl">{hl.map((h) => <li key={h}><Icon n="check" size={16} />{h}</li>)}</ul></div>}
          {l.description && <div className="sv-block sv-desc"><h3>{t('description')}</h3><p>{l.description}</p></div>}
          {s.whatsapp && <a className="sv-wa-inline" href={waLink(s.whatsapp, t('askWa', { p: l.title }))} target="_blank" rel="noreferrer"><WaGlyph />{t('chat')}</a>}
        </div>
      </div>
      {related.length > 0 && <section className="sv-sec sv-related"><h2 className="sv-h2">{t('youMayLike')}</h2><div className="sv-rail">{related.map((x) => <Card key={x.id} l={x} />)}</div></section>}
      <div className="sv-pbar"><Price l={l} /><AddButton l={l} qty={qty} /></div>
    </div>
  );
}
function PerkRow() {
  const { s, t, perks } = useStore();
  const items = [...(s.cod?.enabled ? [['cash', t('cod')]] : []), ['lock', t('secure')], ...perks.slice(0, 3).map((p) => [PERK_ICON[p] || 'check', t(p)])];
  return <ul className="sv-perks">{items.map(([ic, txt]) => <li key={txt}><Icon n={ic} size={18} />{txt}</li>)}</ul>;
}

// ---------- policy page ----------
export function PolicyPage({ k }) {
  const { base, qs, t, link, s, setMeta } = useStore();
  const [d, setD] = useState(null);
  useEffect(() => { getJson(`${base}/policy/${k}${qs}`).then(setD); window.scrollTo(0, 0); }, [base, k, qs]);
  useEffect(() => { setMeta(`${t(k)} · ${s.name}`, ''); }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="sv-skel" />;
  if (d.error) return <p className="sv-empty">{d.error}</p>;
  return (
    <article className="sv-policy">
      <Link to={link('')} className="sv-more">← {t('back')}</Link>
      <h1>{t(k)}</h1>
      {d.policy.draft && <p className="sv-draft">{t('draft')}</p>}
      {d.policy.text.split(/\n+/).map((p, i) => (p.length < 60 && !/[.:;,]$/.test(p) ? <h3 key={i}>{p}</h3> : <p key={i}>{p}</p>))}
    </article>
  );
}
