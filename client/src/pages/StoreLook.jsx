import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { toast, inr } from '../ui';
import { t } from '../appI18n';
import { THEME_LIST, themeOf } from '../storeThemes/index.js';
import { FONT_PAIRS, HERO_LAYOUTS, SECTION_NAMES, sectionsOf, heroOf, fontOf, brandOf } from '../storeThemes/tokens.js';
import { LABELS } from '../storeThemes/i18n.js';
import ThemeThumb from '../storeThemes/Thumb.jsx';

// Sell → Store: the storefront's look (theme gallery, options, live preview) and "Describe your shop" — the AI
// drafts the whole store, the seller previews it on the real theme and applies it (nothing changes before Apply).
const PERKS = ['freeDelivery', 'fastDelivery', 'returns7', 'exchange', 'warranty', 'emi', 'authentic', 'crueltyFree', 'fresh', 'handmade'];
const upload = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => api('/uploads', 'POST', { type: file.type, data: r.result }).then((d) => resolve(d.url), reject);
  r.onerror = () => reject(new Error(t('Couldn’t read that file')));
  r.readAsDataURL(file);
});
// the store's own preview link, on this origin (the frame talks to this page with postMessage)
export const framePath = (s) => { try { return s.handle && s.previewUrl ? `/s/${s.handle}?pv=${new URL(s.previewUrl).searchParams.get('pv')}` : null; } catch { return null; } };

export function PreviewFrame({ src, preview, height = 720 }) {
  const ref = useRef(null);
  const [mode, setMode] = useState('phone');
  const post = () => ref.current?.contentWindow?.postMessage({ type: 'ff-store-preview', preview }, window.location.origin);
  useEffect(() => {
    const on = (e) => { if (e.origin === window.location.origin && e.data?.type === 'ff-store-ready' && e.source === ref.current?.contentWindow) post(); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  });
  useEffect(post, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sl-frame">
      <div className="sl-seg" role="group">{[['phone', t('Phone')], ['desktop', t('Desktop')]].map(([k, l]) => <button type="button" key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div>
      <div className={`sl-device ${mode}`} style={{ '--h': `${height}px` }}><iframe ref={ref} title={t('Store preview')} src={src} /></div>
    </div>
  );
}

export function ThemePanel({ s, set, onSave, busy }) {
  const theme = themeOf(s.theme);
  const o = s.themeOptions || {};
  const setO = (p) => set({ themeOptions: { ...o, ...p } });
  const [show, setShow] = useState(false);
  const src = framePath(s);
  const preview = useMemo(() => ({ store: { theme: s.theme || 'classic', themeOptions: o, name: s.name, tagline: s.tagline, about: s.about, color: s.color } }), [s.theme, o, s.name, s.tagline, s.about, s.color]); // eslint-disable-line react-hooks/exhaustive-deps
  const order = sectionsOf(theme, o);
  const all = [...order, ...Object.keys(SECTION_NAMES).filter((k) => !order.includes(k))];
  const move = (k, d) => { const l = [...order]; const i = l.indexOf(k), j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setO({ sections: l }); };
  const toggle = (k, on) => setO({ sections: on ? [...order, k] : order.filter((x) => x !== k) });
  const offers = o.offers || [];
  const setOffer = (i, p) => setO({ offers: offers.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <>
      <div className="sl-gallery">
        {THEME_LIST.map((th) => (
          <div key={th.id} className={`sl-theme${(s.theme || 'classic') === th.id ? ' on' : ''}`}>
            <button type="button" className="sl-pick" onClick={() => { set({ theme: th.id }); setShow(true); }} aria-pressed={(s.theme || 'classic') === th.id}>
              <ThemeThumb theme={th} />
              <span><b>{th.name}</b> · {t(th.industry)}</span>
              <small className="muted">{t(th.blurb)}</small>
            </button>
            {th.demo && <a className="sl-demo" href={`/s/${th.demo}`} target="_blank" rel="noreferrer">{t('Live demo')} ↗</a>}
          </div>
        ))}
      </div>
      <div className="sl-look">
        <div className="st-set">
          <label>{t('Accent colour')}<div className="sl-row"><input type="color" value={brandOf(theme, o, s.color)} onChange={(e) => setO({ accent: e.target.value })} />{o.accent && <button type="button" className="btn sm" onClick={() => setO({ accent: '' })}>{t('Theme colour')}</button>}</div></label>
          <label>{t('Fonts')}<select value={fontOf(theme, o)} onChange={(e) => setO({ font: e.target.value === theme.font ? '' : e.target.value })}>{Object.entries(FONT_PAIRS).map(([k, f]) => <option key={k} value={k}>{t(f.name)} — {f.heading}{f.body !== f.heading ? ` + ${f.body}` : ''}</option>)}</select></label>
          <label>{t('Hero layout')}<select value={heroOf(theme, o) || 'minimal'} onChange={(e) => setO({ hero: e.target.value })}>{Object.entries(HERO_LAYOUTS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
          <label>{t('Shop language (buyers can switch)')}<select value={o.lang || 'en'} onChange={(e) => setO({ lang: e.target.value })}><option value="en">English</option><option value="hi">हिन्दी</option></select></label>
          <label className="st-full">{t('Announcement bar')}<input maxLength={140} value={o.announcement || ''} placeholder={t('Free delivery above ₹499 · COD available')} onChange={(e) => setO({ announcement: e.target.value })} /></label>
          <label>{t('Hero headline')}<input maxLength={90} value={o.heroTitle || ''} placeholder={s.tagline || s.name} onChange={(e) => setO({ heroTitle: e.target.value })} /></label>
          <label>{t('Hero button')}<input maxLength={30} value={o.heroCta || ''} placeholder={t('Shop now')} onChange={(e) => setO({ heroCta: e.target.value })} /></label>
          <label className="st-full">{t('Hero text')}<input maxLength={240} value={o.heroText || ''} onChange={(e) => setO({ heroText: e.target.value })} /></label>
          <label>{t('Banner picture')}<div className="st-logo">{o.heroImage && <img src={o.heroImage} alt="" />}<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) try { setO({ heroImage: await upload(f) }); } catch (er) { toast(er.message); } }} />{o.heroImage && <button type="button" className="btn sm" onClick={() => setO({ heroImage: '' })}>{t('Remove')}</button>}</div></label>
          <label>{t('Delivery note')}<input maxLength={120} value={o.deliveryNote || ''} placeholder={t('Delivery in 45 minutes · Order by 7 pm')} onChange={(e) => setO({ deliveryNote: e.target.value })} /></label>
          <div className="st-full"><b className="sl-h">{t('Promises shown to buyers')}</b><small className="muted"> · {t('tick only what you really offer')}</small>
            <div className="sl-checks">{PERKS.map((p) => <label key={p} className="fcheck"><input type="checkbox" checked={(o.perks || []).includes(p)} onChange={(e) => setO({ perks: e.target.checked ? [...(o.perks || []), p].slice(0, 6) : (o.perks || []).filter((x) => x !== p) })} />{LABELS.en[p]}</label>)}</div></div>
          <div className="st-full"><b className="sl-h">{t('Home page sections')}</b>
            <div className="sl-sections">{all.map((k) => { const on = order.includes(k); return (
              <div key={k} className={on ? '' : 'off'}><label className="fcheck"><input type="checkbox" checked={on} disabled={k === 'grid'} onChange={(e) => toggle(k, e.target.checked)} />{t(SECTION_NAMES[k])}</label>
                {on && <span><button type="button" className="btn sm" aria-label={t('Up')} onClick={() => move(k, -1)}>↑</button><button type="button" className="btn sm" aria-label={t('Down')} onClick={() => move(k, 1)}>↓</button></span>}</div>); })}</div></div>
          <div className="st-full"><b className="sl-h">{t('Offers strip')}</b><small className="muted"> · {t('a coupon code must exist in Coupons to work')}</small>
            {offers.map((x, i) => <div key={i} className="sl-offer"><input placeholder={t('Flat ₹50 off')} value={x.title} onChange={(e) => setOffer(i, { title: e.target.value })} /><input placeholder={t('On orders above ₹499')} value={x.note || ''} onChange={(e) => setOffer(i, { note: e.target.value })} /><input placeholder={t('CODE')} value={x.code || ''} onChange={(e) => setOffer(i, { code: e.target.value.toUpperCase() })} /><button type="button" className="btn sm" onClick={() => setO({ offers: offers.filter((_, j) => j !== i) })}>×</button></div>)}
            {offers.length < 6 && <button type="button" className="btn sm" onClick={() => setO({ offers: [...offers, { title: '', note: '', code: '' }] })}>{t('Add offer')}</button>}</div>
          <label className="fcheck st-full"><input type="checkbox" checked={o.whatsapp !== false} onChange={(e) => setO({ whatsapp: e.target.checked })} /><span>{t('WhatsApp chat button')}<small className="muted"> · {t('uses your support WhatsApp number from Settings')}</small></span></label>
          <label>{t('Search title (SEO)')}<input maxLength={70} value={o.seo?.title || ''} placeholder={s.name} onChange={(e) => setO({ seo: { ...o.seo, title: e.target.value } })} /></label>
          <label>{t('Search description (SEO)')}<input maxLength={170} value={o.seo?.description || ''} placeholder={s.tagline} onChange={(e) => setO({ seo: { ...o.seo, description: e.target.value } })} /></label>
          <div className="st-full sl-actions"><button className="btn primary" disabled={busy} onClick={onSave}>{busy ? t('Saving…') : t('Save look')}</button>{src && <button type="button" className="btn" onClick={() => setShow(!show)}>{show ? t('Hide preview') : t('Preview my store')}</button>}{!src && <small className="muted">{t('Choose your store address below to preview your own store.')}</small>}</div>
        </div>
        {show && src && <PreviewFrame src={src} preview={preview} />}
      </div>
    </>
  );
}

// the AI's draft as a preview: store fields, and copy for listed products (by listing id) or new ones (shown as extras)
function draftPreview(draft, s, d) {
  const byRef = Object.fromEntries(d.listings.map((l) => [`${l.kind}:${l.refId}`, l]));
  const listings = {}, extra = [];
  for (const x of draft.listings) {
    const patch = { ...(x.title ? { title: x.title } : {}), ...(x.description ? { description: x.description } : {}), ...(x.category ? { category: x.category } : {}), highlights: x.highlights || [], ...(x.badge ? { badge: x.badge } : {}) };
    const l = byRef[x.ref];
    if (l) { listings[l.id] = patch; continue; }
    const [kind, id] = x.ref.split(':');
    const it = kind === 'item' && d.items.find((i) => i.id === id);
    if (it && it.sale_rate != null) extra.push({ id: `draft-${id}`, title: it.name, description: '', category: '', images: [], price: Number(it.sale_rate), kind: 'physical', unit: it.unit || '', stock: Math.max(0, Math.floor(it.stock || 0)), soldOut: false, ...patch });
  }
  return { store: { theme: draft.theme, themeOptions: { ...(s.themeOptions || {}), ...draft.options }, name: draft.name || s.name, tagline: draft.tagline || s.tagline, about: draft.about || s.about, categories: [...new Set([...draft.categories, ...(s.categories || [])])] }, listings, extra };
}

export function AiSetup({ d, s, onApplied }) {
  const [prompt, setPrompt] = useState('');
  const pool = useMemo(() => [
    ...d.listings.map((l) => ({ ref: `${l.kind}:${l.refId}`, name: l.title || (l.kind === 'product' ? d.products.find((p) => p.id === l.refId)?.name : d.items.find((i) => i.id === l.refId)?.name) || '', listed: true })),
    ...d.items.filter((i) => !d.listings.some((l) => l.kind === 'item' && l.refId === i.id)).map((i) => ({ ref: `item:${i.id}`, name: i.name, price: i.sale_rate, listed: false })),
    ...d.products.filter((p) => !d.listings.some((l) => l.kind === 'product' && l.refId === p.id)).map((p) => ({ ref: `product:${p.id}`, name: p.name, listed: false })),
  ].filter((x) => x.name), [d]);
  const [picks, setPicks] = useState(() => pool.filter((x) => x.listed).slice(0, 24).map((x) => x.ref));
  const [banner, setBanner] = useState(false);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState(null);
  const src = framePath(s);
  const preview = useMemo(() => (draft ? draftPreview(draft, s, d) : null), [draft, s, d]);
  const run = async () => {
    setBusy('draft');
    try {
      const r = await api('/store/ai-setup', 'POST', { prompt, picks });
      let x = r.draft;
      if (banner && x.bannerPrompt) {
        setBusy('banner');
        try { const img = await api('/ai/image', 'POST', { prompt: x.bannerPrompt, aspect: '16:9' }); x = { ...x, options: { ...x.options, heroImage: img.url, hero: x.options.hero === 'minimal' ? 'banner' : x.options.hero } }; } catch (e) { toast(`${t('Banner picture skipped')}: ${e.message}`); }
      }
      setDraft(x);
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const apply = async () => {
    setBusy('apply');
    try {
      const r = await api('/store/ai-setup/apply', 'POST', { draft });
      toast(t('Applied — {u} products updated, {c} added', { u: r.updated, c: r.created }) + (r.skipped.length ? `. ${t('Set a price, then add')}: ${r.skipped.join(', ')}` : ''));
      setDraft(null);
      onApplied();
    } catch (e) { toast(e.message); }
    setBusy('');
  };
  const th = draft && themeOf(draft.theme);
  return (
    <div className="sl-ai">
      {!draft ? (
        <div className="st-set">
          <label className="st-full">{t('Describe your shop in a sentence or two — Hindi or English')}
            <textarea rows={3} maxLength={1200} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('e.g. Hum Jaipur se hand-block print kurte aur sarees bechte hain. ₹999 se upar free shipping, 7 din exchange.')} /></label>
          {pool.length > 0 && <div className="st-full"><b className="sl-h">{t('Write titles and descriptions for')}</b><small className="muted"> · {picks.length}/24</small>
            <div className="sl-picks">{pool.map((x) => <label key={x.ref} className="fcheck"><input type="checkbox" checked={picks.includes(x.ref)} disabled={!picks.includes(x.ref) && picks.length >= 24} onChange={(e) => setPicks(e.target.checked ? [...picks, x.ref] : picks.filter((r) => r !== x.ref))} />{x.name}{!x.listed && <small className="muted"> · {x.price != null ? `${t('not in store yet')} · ${inr(x.price)}` : t('needs a price')}</small>}</label>)}</div></div>}
          <label className="fcheck st-full"><input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} /><span>{t('Also make a banner picture')}<small className="muted"> · {t('10 more AI credits')}</small></span></label>
          <div className="st-full sl-actions"><button className="btn primary" disabled={!!busy || prompt.trim().length < 8} onClick={run}>{busy === 'banner' ? t('Making the banner…') : busy ? t('Drafting your store…') : t('Draft my store · 5 credits')}</button><small className="muted">{t('Nothing changes until you press Apply.')}</small></div>
        </div>
      ) : (
        <div className="sl-draft">
          <div className="sl-draft-info">
            <span className="sl-tag">{t('Draft')} · {th.name} ({t(th.industry)})</span>
            <h3>{draft.name}</h3>
            {draft.tagline && <p>{draft.tagline}</p>}
            <dl>
              {draft.options.announcement && <><dt>{t('Announcement')}</dt><dd>{draft.options.announcement}</dd></>}
              {draft.options.heroTitle && <><dt>{t('Hero')}</dt><dd><b>{draft.options.heroTitle}</b>{draft.options.heroText ? ` — ${draft.options.heroText}` : ''}</dd></>}
              {draft.categories.length > 0 && <><dt>{t('Categories')}</dt><dd>{draft.categories.join(', ')}</dd></>}
              <dt>{t('Products')}</dt><dd>{t('{n} written', { n: draft.listings.length })}</dd>
              {Object.keys(draft.policyPages).length > 0 && <><dt>{t('Policy pages')}</dt><dd>{Object.keys(draft.policyPages).join(', ')} — <i>{t('drafts: review them before buyers see them')}</i></dd></>}
              {draft.options.seo?.title && <><dt>SEO</dt><dd>{draft.options.seo.title}</dd></>}
            </dl>
            <div className="sl-actions"><button className="btn primary" disabled={!!busy} onClick={apply}>{busy === 'apply' ? t('Applying…') : t('Apply to my store')}</button><button className="btn" disabled={!!busy} onClick={() => setDraft(null)}>{t('Discard')}</button></div>
          </div>
          {src ? <PreviewFrame src={src} preview={preview} /> : <p className="hint">{t('Choose your store address to see the draft on your store. Meanwhile:')} {th.demo && <a href={`/s/${th.demo}`} target="_blank" rel="noreferrer">{t('this theme’s live demo')} ↗</a>}</p>}
        </div>
      )}
    </div>
  );
}

export function PolicyPages({ s, set }) {
  const pages = s.policyPages || {};
  const setP = (k, p) => set({ policyPages: { ...pages, [k]: { ...(pages[k] || { text: '', draft: false }), ...p } } });
  return (
    <div className="st-set">
      {[['refund', 'Refund policy'], ['shipping', 'Shipping policy'], ['terms', 'Terms'], ['privacy', 'Privacy policy']].map(([k, l]) => (
        <label key={k} className="st-full">
          <span className="sl-row">{t(l)}{pages[k]?.text && (pages[k].draft ? <span className="sl-tag warn">{t('Draft — not shown to buyers')}</span> : <span className="sl-tag">{t('Live')}</span>)}</span>
          <textarea rows={pages[k]?.text ? 6 : 2} value={pages[k]?.text || ''} placeholder={t('Write it here, or use Describe your shop to draft it')} onChange={(e) => setP(k, { text: e.target.value })} />
          {pages[k]?.text && pages[k].draft && <span className="sl-row"><button type="button" className="btn sm" onClick={() => setP(k, { draft: false })}>{t('I’ve reviewed it — show to buyers')}</button><small className="muted">{t('then Save')}</small></span>}
        </label>
      ))}
    </div>
  );
}
