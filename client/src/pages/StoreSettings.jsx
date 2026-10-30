import { useEffect, useState } from 'react';
import { api } from '../api';
import { Layout, Panel, Empty, toast, confirmDialog, inr, loadFailed } from '../ui';
import { t } from '../appI18n';
import { ThemePanel, AiSetup, PolicyPages } from './StoreLook.jsx';
import '../store.css';
import '../storeThemes/storeLook.css';

// Sell → Store: the seller's online shop (server/store.js) — on/off, address, look, shipping and COD, policies,
// and the catalog: digital Products and Inventory items, each with store-only title, photos, category, price / MRP.
const upload = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => api('/uploads', 'POST', { type: file.type, data: r.result }).then((d) => resolve(d.url), reject);
  r.onerror = () => reject(new Error(t('Couldn’t read that file')));
  r.readAsDataURL(file);
});

export default function StoreSettings() {
  const [d, setD] = useState(null);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  const load = () => api('/store').then((x) => { setD(x); setS({ ...x.store, cats: (x.store.categories || []).join(', ') }); }).catch(loadFailed);
  useEffect(() => { load(); }, []);
  if (!d || !s) return <Layout title={t('Store')}><div className="skeleton" style={{ height: 200 }} /></Layout>;
  const set = (p) => setS({ ...s, ...p });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/store', 'PUT', { enabled: !!s.enabled, handle: s.handle || '', name: s.name, tagline: s.tagline, about: s.about, color: s.color, logo: s.logo, categories: String(s.cats || '').split(',').map((x) => x.trim()).filter(Boolean), shipping: { fee: Number(s.shipping?.fee) || 0, freeAbove: Number(s.shipping?.freeAbove) || 0 }, cod: { enabled: !!s.cod?.enabled, fee: Number(s.cod?.fee) || 0 }, policies: s.policies || {}, theme: s.theme || 'classic', themeOptions: s.themeOptions || {}, policyPages: s.policyPages || {} });
      setD({ ...d, store: r.store }); setS({ ...r.store, cats: (r.store.categories || []).join(', ') });
      toast(t('Store saved'));
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const listed = new Set(d.listings.map((l) => `${l.kind}:${l.refId}`));
  const options = [...d.products.map((p) => ({ v: `product:${p.id}`, label: `${t('Digital')} · ${p.name}` })), ...d.items.map((i) => ({ v: `item:${i.id}`, label: `${t('Stock')} · ${i.name}${i.sale_rate != null ? ` · ${inr(i.sale_rate)}` : ''}` }))].filter((o) => !listed.has(o.v));
  const add = async () => {
    if (!pick) return;
    const [kind, refId] = pick.split(':');
    const src = kind === 'product' ? d.products.find((p) => p.id === refId) : d.items.find((i) => i.id === refId);
    let price;
    if (kind === 'product' || src.sale_rate == null) {
      const v = window.prompt(t('Price for {name} (₹)', { name: src.name }));
      if (v == null) return;
      price = Number(v);
    }
    try {
      const l = await api('/store/listings', 'POST', { kind, refId, ...(price != null ? { price } : {}), ...(kind === 'item' && src.category ? { category: src.category } : {}) });
      setD({ ...d, listings: [...d.listings, l] }); setPick('');
    } catch (e) { toast(e.message); }
  };
  const nameOf = (l) => (l.kind === 'product' ? d.products.find((p) => p.id === l.refId)?.name : d.items.find((i) => i.id === l.refId)?.name) || t('(removed)');
  const pol = s.policies || {};
  return (
    <Layout title={t('Store')} subtitle={t('Your online shop: many products in one cart, one checkout, GST invoices and stock kept in step.')} actions={s.url && <>
      <a className="btn" href={s.previewUrl} target="_blank" rel="noreferrer">{t('Preview')}</a>
      {s.enabled && <a className="btn primary" href={s.url} target="_blank" rel="noreferrer">{t('Open store')}</a>}
    </>}>
      <Panel title={t('Describe your shop')}>
        <p className="hint">{t('Write a sentence or two — AI picks a theme and drafts your store’s words, categories, policies and product descriptions. You preview it first.')}</p>
        <AiSetup d={d} s={s} onApplied={load} />
      </Panel>
      <Panel title={t('Look & theme')}>
        <ThemePanel s={s} set={set} onSave={save} busy={busy} />
      </Panel>
      <Panel title={t('Store settings')}>
        <div className="st-set">
          <label className="fcheck"><input type="checkbox" checked={!!s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span><b>{t('Store is open')}</b><small className="muted"> · {t('buyers can see and buy')}</small></span></label>
          <label>{t('Store address')}<div className="st-handle"><span>/s/</span><input value={s.handle || ''} onChange={(e) => set({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="my-shop" /></div></label>
          <label>{t('Store name')}<input value={s.name || ''} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>{t('Tagline')}<input value={s.tagline || ''} onChange={(e) => set({ tagline: e.target.value })} /></label>
          <label className="st-full">{t('About')}<textarea rows={2} value={s.about || ''} onChange={(e) => set({ about: e.target.value })} /></label>
          <label>{t('Brand colour')}<input type="color" value={s.color || '#6366f1'} onChange={(e) => set({ color: e.target.value })} /></label>
          <label>{t('Logo')}<div className="st-logo">{s.logo && <img src={s.logo} alt="" />}<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) try { set({ logo: await upload(f) }); } catch (er) { toast(er.message); } }} />{s.logo && <button type="button" className="btn sm" onClick={() => set({ logo: '' })}>{t('Remove')}</button>}</div></label>
          <label className="st-full">{t('Categories')}<input value={s.cats || ''} onChange={(e) => set({ cats: e.target.value })} placeholder={t('Tea, Ware, Gifts')} /></label>
          <h4 className="st-full">{t('Shipping (stock items)')}</h4>
          <label>{t('Shipping fee (₹)')}<input type="number" min={0} value={s.shipping?.fee || ''} placeholder="0" onChange={(e) => set({ shipping: { ...s.shipping, fee: e.target.value } })} /></label>
          <label>{t('Free shipping above (₹)')}<input type="number" min={0} value={s.shipping?.freeAbove || ''} placeholder={t('never')} onChange={(e) => set({ shipping: { ...s.shipping, freeAbove: e.target.value } })} /></label>
          <label className="fcheck"><input type="checkbox" checked={!!s.cod?.enabled} onChange={(e) => set({ cod: { ...s.cod, enabled: e.target.checked } })} /><span><b>{t('Cash on Delivery')}</b><small className="muted"> · {t('PIN codes and risk rules: Settings → Cash on Delivery')}</small></span></label>
          {s.cod?.enabled && <label>{t('COD fee (₹)')}<input type="number" min={0} value={s.cod?.fee || ''} placeholder="0" onChange={(e) => set({ cod: { ...s.cod, fee: e.target.value } })} /></label>}
          <h4 className="st-full">{t('Policy links')}</h4>
          {[['refund', 'Refund policy'], ['shipping', 'Shipping policy'], ['terms', 'Terms'], ['privacy', 'Privacy policy'], ['contact', 'Contact page']].map(([k, l]) => <label key={k}>{t(l)}<input value={pol[k] || ''} placeholder="https://" onChange={(e) => set({ policies: { ...pol, [k]: e.target.value } })} /></label>)}
          <div className="st-full"><button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Saving…') : t('Save')}</button></div>
        </div>
      </Panel>
      <Panel title={t('Policy pages')}>
        <PolicyPages s={s} set={set} />
        <div className="sl-actions"><button className="btn primary" disabled={busy} onClick={save}>{busy ? t('Saving…') : t('Save')}</button></div>
      </Panel>
      <Panel title={t('Catalog')} actions={options.length > 0 && <div className="st-add"><select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">{t('Add to store…')}</option>{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select><button className="btn primary sm" disabled={!pick} onClick={add}>{t('Add')}</button></div>}>
        {!d.inventory && <p className="hint">{t('Physical stock items appear here when the Inventory add-on is on.')}</p>}
        {!d.listings.length ? <Empty icon="tag" title={t('Nothing for sale yet')} text={t('Add your Products (downloads, courses) or Inventory items to the store.')} /> : (
          <div className="st-list">{d.listings.map((l) => <ListingRow key={l.id} l={l} name={nameOf(l)} item={l.kind === 'item' ? d.items.find((i) => i.id === l.refId) : null} cats={s.categories || []}
            onSaved={(x) => setD({ ...d, listings: d.listings.map((y) => (y.id === x.id ? x : y)) })}
            onDelete={async () => { if (!(await confirmDialog({ title: t('Remove from store?'), text: t('The product or stock item itself is kept.') }))) return; await api(`/store/listings/${l.id}`, 'DELETE'); setD({ ...d, listings: d.listings.filter((y) => y.id !== l.id) }); }} />)}</div>
        )}
      </Panel>
      <Panel title={t('Sell on Google & Instagram')}><StoreFeeds feeds={d.store.feeds} open={!!d.store.enabled} /></Panel>
      <Panel title={t('Reviews')}><StoreReviews /></Panel>
    </Layout>
  );
}

// product feeds (server/store-feeds.js): links the seller pastes once; prices, stock and photos then stay in step
function StoreFeeds({ feeds, open }) {
  if (!feeds) return <p className="hint">{t('Choose your store address in Store settings first — your product links are made from it.')}</p>;
  const copy = (u) => navigator.clipboard?.writeText(u).then(() => toast(t('Link copied')), () => toast(u));
  const row = (label, url, steps) => (
    <div className="st-feed">
      <b>{label}</b>
      <div className="st-feed-url"><input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={label} /><button type="button" className="btn sm" onClick={() => copy(url)}>{t('Copy')}</button></div>
      <ol className="hint">{steps.map((x) => <li key={x}>{x}</li>)}</ol>
    </div>
  );
  return (
    <div className="st-feeds">
      <p className="hint">{t('Your products — names, prices, photos and stock — as links that Google and Meta read every day. Paste each link once; after that your listings stay up to date by themselves. Products need at least one photo to be listed.')}</p>
      {!open && <p className="hint warn">{t('Your store is closed, so these links show nothing yet. Open your store first.')}</p>}
      {row(t('Google Shopping (free listings and Shopping ads)'), feeds.google, [
        t('Create a free account at merchants.google.com and verify your store’s website address.'),
        t('Go to Products → Add products → Add products from a file → Add a file from a link (scheduled fetch).'),
        t('Paste this link, set the country to India and the language to English, and choose a daily fetch.'),
      ])}
      {row(t('Instagram, Facebook and WhatsApp catalogue (Meta)'), feeds.meta, [
        t('Open business.facebook.com/commerce → Add catalogue → E-commerce → Upload product info.'),
        t('Choose Data feed → Use a URL → paste this link, and pick a daily schedule.'),
        t('Connect the catalogue to your Instagram shop, Facebook page or WhatsApp Business to tag products.'),
      ])}
      {row(t('Google search (sitemap)'), feeds.sitemap, [
        t('In search.google.com/search-console, add your store’s address as a property.'),
        t('Go to Sitemaps, paste this link and press Submit — Google then finds every product page.'),
      ])}
      <p className="hint">{t('Downloads and courses are listed on Meta only — Google Shopping doesn’t allow digital products.')}</p>
    </div>
  );
}

// buyers' reviews (left from their order page after delivery) — hide one to take it off the store
function StoreReviews() {
  const [list, setList] = useState(null);
  useEffect(() => { api('/store/reviews').then((r) => setList(r.reviews)).catch(loadFailed); }, []);
  if (!list) return <div className="skeleton" style={{ height: 60 }} />;
  if (!list.length) return <Empty icon="star" title={t('No reviews yet')} text={t('After an order is delivered, the buyer gets a link to rate what they bought. Reviews show on your products.')} />;
  const toggle = async (r) => {
    try { const x = await api(`/store/reviews/${r.id}`, 'PUT', { hidden: !r.hidden }); setList(list.map((y) => (y.id === r.id ? { ...y, hidden: x.hidden } : y))); } catch (e) { toast(e.message); }
  };
  return (
    <div className="st-list">{list.map((r) => (
      <div key={r.id} className={`st-row${r.hidden ? ' off' : ''}`}><div className="st-row-head">
        <div><b>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} · {r.product || t('(removed)')}</b>
          <small className="muted">{r.name}{r.size ? ` · ${r.size}` : ''} · #{r.orderId} · {new Date(r.at).toLocaleDateString('en-IN')}{r.hidden ? ` · ${t('Hidden')}` : ''}</small>
          {r.text && <p style={{ margin: '4px 0 0' }}>{r.text}</p>}</div>
        <button type="button" className="btn sm" onClick={() => toggle(r)}>{r.hidden ? t('Show') : t('Hide')}</button>
      </div></div>
    ))}</div>
  );
}

const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim()).filter(Boolean);

function ListingRow({ l, name, item, cats, onSaved, onDelete }) {
  const [x, setX] = useState(l);
  const [open, setOpen] = useState(false);
  const set = (p) => setX({ ...x, ...p });
  const save = async (patch) => {
    try { const r = await api(`/store/listings/${l.id}`, 'PUT', patch || { title: x.title, description: x.description, category: x.category, highlights: listOf(x.highlights), sizes: listOf(x.sizes), badge: x.badge || '', byline: x.byline || '', diet: x.diet || '', price: x.price === '' ? null : x.price, mrp: x.mrp === '' ? null : x.mrp, images: x.images, visible: x.visible, sort: Number(x.sort) || 0 }); setX(r); onSaved(r); if (!patch) toast(t('Saved')); } catch (e) { toast(e.message); }
  };
  const price = x.price ?? item?.sale_rate;
  const [ai, setAi] = useState(false);
  const rewrite = async () => {
    setAi(true);
    try { const r = await api(`/store/listings/${l.id}/ai`, 'POST', {}); setX((c) => ({ ...c, ...r.draft })); toast(t('Rewritten — check it, then Save')); } catch (e) { toast(e.message); }
    setAi(false);
  };
  return (
    <div className={`st-row${x.visible === false ? ' off' : ''}`}>
      <div className="st-row-head" onClick={() => setOpen(!open)}>
        {x.images?.[0] ? <img src={x.images[0]} alt="" /> : <span className="st-ph" />}
        <div><b>{x.title || name}</b><small className="muted">{l.kind === 'product' ? t('Digital') : `${t('Stock')}: ${item?.stock ?? '—'}`} · {price != null ? inr(price) : t('no price')}{x.category ? ` · ${x.category}` : ''}</small></div>
        <label className="fcheck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={x.visible !== false} onChange={(e) => save({ visible: e.target.checked })} />{t('Visible')}</label>
      </div>
      {open && <div className="st-set">
        <label>{t('Title')}<input value={x.title || ''} placeholder={name} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>{t('Category')}<select value={x.category || ''} onChange={(e) => set({ category: e.target.value })}><option value="">—</option>{[...new Set([...cats, x.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>{t('Price (₹)')}<input type="number" min={0} value={x.price ?? ''} placeholder={item?.sale_rate != null ? `${item.sale_rate} (${t('sale rate')})` : ''} onChange={(e) => set({ price: e.target.value })} /></label>
        <label>{t('MRP / compare-at (₹)')}<input type="number" min={0} value={x.mrp ?? ''} onChange={(e) => set({ mrp: e.target.value })} /></label>
        <label className="st-full"><span className="sl-row">{t('Description')}<button type="button" className="btn sm" disabled={ai} onClick={rewrite}>{ai ? t('Writing…') : t('Rewrite with AI')}</button></span><textarea rows={3} value={x.description || ''} onChange={(e) => set({ description: e.target.value })} /></label>
        <label>{t('Highlights')}<input value={Array.isArray(x.highlights) ? x.highlights.join(', ') : x.highlights || ''} placeholder={t('Pure cotton, Hand-block printed')} onChange={(e) => set({ highlights: e.target.value })} /></label>
        <label>{t('Sizes (the buyer picks one)')}<input value={Array.isArray(x.sizes) ? x.sizes.join(', ') : x.sizes || ''} placeholder="S, M, L, XL" onChange={(e) => set({ sizes: e.target.value })} /></label>
        <label>{t('Badge')}<input maxLength={20} value={x.badge || ''} placeholder={t('New drop / Bestseller')} onChange={(e) => set({ badge: e.target.value })} /></label>
        <label>{t('Byline')}<input maxLength={80} value={x.byline || ''} placeholder={t('Author · Publisher, or 22KT · 4.2 g')} onChange={(e) => set({ byline: e.target.value })} /></label>
        <label>{t('Food mark')}<select value={x.diet || ''} onChange={(e) => set({ diet: e.target.value })}><option value="">—</option><option value="veg">{t('Veg (green dot)')}</option><option value="nonveg">{t('Non-veg (brown triangle)')}</option></select></label>
        <div className="st-full st-imgs">{(x.images || []).map((u, i) => <span key={u + i}><img src={u} alt="" /><button type="button" aria-label={t('Remove')} onClick={() => set({ images: x.images.filter((_, j) => j !== i) })}>×</button></span>)}
          {(x.images || []).length < 8 && <label className="btn sm">{t('Add photo')}<input hidden type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) try { const u = await upload(f); setX((c) => ({ ...c, images: [...(c.images || []), u] })); } catch (er) { toast(er.message); } }} /></label>}</div>
        <label>{t('Order in list')}<input type="number" min={0} value={x.sort || 0} onChange={(e) => set({ sort: e.target.value })} /></label>
        <div className="st-full st-actions"><button className="btn primary sm" onClick={() => save()}>{t('Save')}</button><button className="btn sm danger" onClick={onDelete}>{t('Remove from store')}</button></div>
      </div>}
    </div>
  );
}
