import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, Copy as CopyIcon, Trash2, EyeOff } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { BLOCK_TYPES, BLOCK_GROUPS, BLOCK_ICONS, STYLES, ELEMENT_TYPES, STYLE_DEFAULTS, FORM_FIELD_TYPES, Page, newElement, freshIds, applyLayout, defaultSection, withCopy, POPUP_SIZES, POPUP_TRIGGERS, POPUP_FREQ, POPUP_BLOCKS, POPUP_MAX, POPUP_MAX_BLOCKS } from '../blocks';
import { BlockIcon, ElementIcon, StepIcon } from '../blockIcons';
import { Icon, toast, Modal, ago, confirmDialog, promptDialog } from '../ui';
import { LANGS } from '../i18n';
import { FONT_CHOICES } from '../fonts';

const uid = () => Math.random().toString(36).slice(2, 10);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
const clone = (x) => JSON.parse(JSON.stringify(x));
const mk = (type, over = {}) => (type === 'section'
  ? { id: uid(), type, props: { ...defaultSection(), ...over } }
  : { id: uid(), type, props: { ...clone(BLOCK_TYPES[type].defaults), ...(type === 'countdown' ? { endsAt: Date.now() + 7 * 864e5 } : {}), ...over } }); // a new countdown: a real deadline, a week out
const FLOATING = ['proof', 'exitpopup', 'stickybar', 'whatsapp'];
const REAL_ONLY = ['countdown', 'livecount', 'stock', 'proof'];
// Copy/paste between funnels goes through localStorage, so it works across tabs and funnels
const CLIP_KEY = 'ff_clipboard_block';
const readClip = () => { try { const c = JSON.parse(localStorage.getItem(CLIP_KEY)); return c?.type && c?.props ? c : null; } catch { return null; } };
// Set a value at a dotted path ("items.2.title") without mutating
const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, path, value) => {
  const [k, ...rest] = String(path).split('.');
  const cur = Array.isArray(obj) ? [...obj] : { ...obj };
  cur[k] = rest.length ? setPath(cur[k] ?? (/^\d+$/.test(rest[0]) ? [] : {}), rest.join('.'), value) : value;
  return cur;
};

// Button link fields only appear once "Open a link" / "Scroll to a section" is chosen
const linkFieldShown = (key, props = {}) => {
  // countdown: the deadline for a fixed date, the minutes for a per-visitor timer (offers have no mode: minutes stay)
  const cd = props.mode || (Number(props.endsAt) > 0 ? 'fixed' : 'evergreen');
  if (key === 'endsAt') return cd === 'fixed';
  if (key === 'minutes' && 'mode' in props) return cd === 'evergreen';
  const m = /^(cta|button)(Url|NewTab)$/.exec(key);
  if (!m) return true;
  const action = props[`${m[1]}Action`];
  return m[2] === 'Url' ? action === 'url' || action === 'scroll' || action === 'popup' : action === 'url';
};
// a button set to "Open a pop-up": its link field becomes a choice of this step's pop-ups
const isPopupLink = (key, props = {}) => (key === 'url' ? props.action : /^(cta|button)Url$/.test(key) ? props[`${key.slice(0, -3)}Action`] : null) === 'popup';
function PopupPick({ popups = [], value, onChange }) {
  return (
    <div className="fld"><label>pop-up to open</label>
      <select value={popups.some((p) => p.id === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a pop-up…</option>
        {popups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {!popups.length && <span className="hint">This step has no pop-ups yet — add one in Step → Pop-ups.</span>}
    </div>
  );
}
const newPopup = (n) => ({ id: uid(), name: `Pop-up ${n}`, size: 'center', trigger: { type: 'exit' }, frequency: 'session', after: 'message', blocks: [mk('optin', { eyebrow: '', title: 'Get the free guide', subtitle: 'Enter your email and we’ll send it straight away.', askPhone: false, points: [] })] });

const STEP_TYPES = {
  landing: { icon: '🏠', label: 'Landing page', blocks: () => [mk('hero'), mk('features'), mk('testimonials'), mk('cta')] },
  optin: { icon: '📝', label: 'Opt-in page', blocks: () => [mk('hero', { ctaText: 'Get instant access' }), mk('optin')] },
  sales: { icon: '💡', label: 'Sales page', blocks: () => [mk('hellobar'), mk('hero'), mk('problem'), mk('features'), mk('testimonials'), mk('pricing'), mk('guarantee'), mk('faq'), mk('cta')] },
  checkout: { icon: '💳', label: 'Checkout', blocks: (f) => [mk('checkout', { productName: f.name })] },
  upsell: { icon: '⬆️', label: 'One-click upsell', blocks: () => [mk('offer'), mk('guarantee')] },
  downsell: { icon: '⬇️', label: 'Downsell', blocks: () => [mk('offer', { progress: 'Step 2 of 3 · One last chance', headline: 'No problem — how about the *Lite version*?', productName: 'Lite Version', emoji: '🎁', price: 399, mrp: 999, acceptText: 'Yes, add the Lite version', declineText: 'No thanks, take me to my order' })] },
  thankyou: { icon: '🎉', label: 'Thank you', blocks: () => [mk('thankyou', { headline: 'Order confirmed! 🎉', body: 'Details are on your email & WhatsApp.', steps: [{ text: 'Check your inbox for access details' }, { text: 'Save our WhatsApp number' }] }), mk('crosssell')] },
};
const MID_FUNNEL = ['checkout', 'upsell', 'downsell', 'thankyou']; // never in search results (server: domains.js)
const PALETTES = [['#6366f1', '#ec4899'], ['#ff9933', '#e11d48'], ['#16a34a', '#0ea5e9'], ['#9f1239', '#a16207'], ['#7c3aed', '#06b6d4'], ['#0f766e', '#22c55e'], ['#111827', '#f59e0b'], ['#2563eb', '#7c3aed']];
// each page style's background and panel colours (blocks.jsx STYLES) — a style missing here falls back to neutral
const STYLE_SWATCH = { aurora: ['#ffffff', '#eef0ff'], midnight: ['#060913', '#1e2a4a'], luxe: ['#fbf8f3', '#e3d8c6'], fresh: ['#ffffff', '#ecfdf5'], bold: ['#fffaf0', '#111111'], clean: ['#ffffff', '#f1f5f9'], editorial: ['#fafaf7', '#121212'], organic: ['#fbf6ee', '#f3e9d8'], tech: ['#07090d', '#21262d'], playful: ['#fffdf5', '#ffe9a8'], royal: ['#14101f', '#d4af5f'], noir: ['#0a0a0a', '#262626'], glass: ['#0b0b1a', '#3b3b8f'], swiss: ['#f2f1ec', '#0d0d0d'], pastel: ['#fdf8fb', '#efe3ee'], studio: ['#f6f4ef', '#e2ddd1'] };
const swatchOf = (k) => STYLE_SWATCH[k] || ['#ffffff', '#e5e7eb'];
const SUGGEST = ['Add an upsell and a downsell', 'Add cross-sells to the thank-you page', 'Make it dark', 'Change colour to saffron', 'Add FAQ and a guarantee', 'Remove the countdown'];
const DEVICES = [['desktop', 'desktop', '100%'], ['tablet', 'tablet', '820px'], ['mobile', 'mobile', '390px']];
// Which drop zones each kind of drag can land in
const ACCEPT = { 'new-block': ['blocks'], 'move-block': ['blocks'], 'new-el': ['col', 'blocks'], 'move-el': ['col', 'blocks'], step: ['steps'] };

// ---------- image optimisation: big photos are shrunk in the browser before upload ----------
const MAX_W = 1920, SMALL_W = 800, MB = 1024 * 1024;
const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function encode(bmp, w, q) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.max(1, Math.round((bmp.height * w) / bmp.width));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const b = await new Promise((res) => c.toBlob(res, 'image/webp', q));
  return b?.type === 'image/webp' ? b : null; // some browsers cannot write WebP
}
async function isAnimatedWebp(file) {
  if (file.type !== 'image/webp') return false;
  const h = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return String.fromCharCode(...h.slice(12, 16)) === 'VP8X' && (h[20] & 0x02) !== 0;
}
// → { main, small? }: WebP at most 1920px wide, plus an 800px copy for phones. GIFs and animations are left alone.
export async function optimiseImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function' || (await isAnimatedWebp(file))) return { main: file };
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return { main: file }; }
  try {
    const w = Math.min(MAX_W, bmp.width);
    const webp = await encode(bmp, w, 0.82);
    if (!webp) return { main: file };
    const main = webp.size < file.size || bmp.width > MAX_W ? webp : file;
    const small = main === webp && w > SMALL_W + 100 ? await encode(bmp, SMALL_W, 0.8) : null;
    return { main, small };
  } finally { bmp.close?.(); }
}

async function uploadImage(file) {
  if (!file) return null;
  const big = /^image\/(jpeg|png|webp)$/.test(file.type) ? 25 : 5; // photos get compressed first
  if (file.size > big * MB) throw new Error(`Images must be ${big} MB or smaller`);
  const { main, small } = await optimiseImage(file);
  if (main.size > 5 * MB) throw new Error('This image is still over 5 MB after compressing — try a smaller one');
  const body = { type: main.type, data: await toDataUrl(main) };
  if (small) body.small = await toDataUrl(small);
  return (await api('/uploads', 'POST', body)).url;
}

function ImageField({ label, value, onChange, hint, aspect = '16:9' }) {
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const ref = useRef();
  // an image made by AI from a description, stored in the seller's media like an upload
  const generate = async () => {
    const prompt = await promptDialog({ title: 'Generate an image with AI', text: 'Describe what it should show — the subject, the setting and the mood. No words, prices or real people’s faces. Uses 10 AI credits and takes about half a minute.', placeholder: 'e.g. A calm yoga studio at sunrise, women practising on mats, warm light, photo', confirm: 'Generate' });
    if (!prompt?.trim()) return;
    setMaking(true);
    try { onChange((await api('/ai/image', 'POST', { prompt, aspect })).url); toast('Image ready'); } catch (e) { toast(e.message); }
    setMaking(false);
  };
  const pick = async (file) => {
    setBusy(true);
    try { onChange(await uploadImage(file)); toast('Image uploaded'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <div className="fld"><label>{label}</label>
      {value && <div className="img-prev"><img src={value} alt="" /><button className="icon-btn xs danger" title="Remove image" aria-label="Remove image" onClick={() => onChange('')}><Icon name="x" size={12} /></button></div>}
      <div className="upl" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        <button className="btn ghost sm" onClick={() => ref.current.click()} disabled={busy}>{busy ? <span className="spin dark" /> : <Icon name="download" size={14} className="flip" />} {value ? 'Replace' : 'Upload image'}</button>
        <button className="btn ghost sm" onClick={generate} disabled={busy || making} title="Uses 10 AI credits">{making ? <><span className="spin dark" /> Making…</> : <><Icon name="sparkles" size={14} /> Generate with AI</>}</button>
        <span className="hint">or drop a file · PNG, JPG, WebP · max 5 MB</span>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(e) => pick(e.target.files[0])} />
      </div>
      <input placeholder="…or paste an image URL" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function GalleryField({ value, onChange }) {
  const items = value || [];
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const addFiles = async (files) => {
    setBusy(true);
    const added = [];
    for (const file of [...files].slice(0, 12)) { try { added.push({ src: await uploadImage(file), caption: '' }); } catch (e) { toast(e.message); } }
    onChange([...items, ...added]);
    setBusy(false);
  };
  const set = (i, k, v) => onChange(items.map((it, n) => (n === i ? { ...it, [k]: v } : it)));
  return (
    <div className="fld"><label>Images <small>({items.length})</small></label>
      <div className="gal-ed">
        {items.map((it, i) => (
          <div key={i} className="gal-ed-item">
            <img src={it.src} alt="" />
            <input placeholder="Caption (optional)" value={it.caption || ''} onChange={(e) => set(i, 'caption', e.target.value)} />
            <input placeholder="Image description (for screen readers and SEO)" aria-label="Image description (for screen readers and SEO)" value={it.alt || ''} onChange={(e) => set(i, 'alt', e.target.value)} />
            <div className="row">
              {i > 0 && <button className="icon-btn xs" title="Move left" aria-label="Move left" onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>←</button>}
              <button className="icon-btn xs danger" title="Remove" aria-label="Remove" onClick={() => onChange(items.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="upl" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
        <button className="btn ghost sm" onClick={() => ref.current.click()} disabled={busy}>{busy ? <span className="spin dark" /> : <Icon name="plus" size={14} />} Add images</button>
        <span className="hint">select several at once · max 5 MB each</span>
        <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden onChange={(e) => addFiles(e.target.files)} />
      </div>
    </div>
  );
}

function FormFieldsField({ value, onChange }) {
  const items = value || [];
  const set = (i, k, v) => onChange(items.map((it, n) => (n === i ? { ...it, [k]: v } : it)));
  return (
    <div className="fld"><label>Form fields <small>({items.length})</small></label>
      {items.map((it, i) => (
        <div className="li" key={i}>
          <div className="li-h"><span>#{i + 1}</span><span className="row">
            {i > 0 && <button className="icon-btn xs" aria-label="Move up" onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>}
            <button className="icon-btn xs danger" aria-label="Remove" onClick={() => onChange(items.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
          </span></div>
          <input placeholder="Question / label" value={it.label || ''} onChange={(e) => set(i, 'label', e.target.value)} />
          <div className="row nowrap">
            <select value={it.type || 'text'} onChange={(e) => set(i, 'type', e.target.value)}>{FORM_FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <label className="tog mini"><input type="checkbox" checked={!!it.required} onChange={(e) => set(i, 'required', e.target.checked)} /><span />Required</label>
          </div>
          {it.type === 'select' && <input placeholder="Options, separated by commas" value={it.options || ''} onChange={(e) => set(i, 'options', e.target.value)} />}
          {it.type === 'select' && <input placeholder="Not a fit if they choose… (comma-separated, optional)" value={it.reject || ''} onChange={(e) => set(i, 'reject', e.target.value)} title="Qualification: applicants who pick one of these see the 'not a fit' message instead of the next step" />}
          {['text', 'email', 'tel', 'number', 'textarea'].includes(it.type || 'text') && <input placeholder="Placeholder (optional)" value={it.placeholder || ''} onChange={(e) => set(i, 'placeholder', e.target.value)} />}
        </div>
      ))}
      <button className="btn ghost sm block" onClick={() => onChange([...items, { label: 'New question', type: 'text', required: false }])}><Icon name="plus" size={14} /> Add field</button>
      <span className="hint">Answers appear in Contacts and in the lead.created webhook. Include an Email or Phone field so you can follow up. For applications, list the answers that mean “not a fit” — those applicants are saved as not qualified and see your “not a fit” message.</span>
    </div>
  );
}

// Quiz: the questions (each answer points to a result, or adds points, and can tag the contact) and the results
const moveIn = (list, i, d) => { const a = [...list]; [a[i + d], a[i]] = [a[i], a[i + d]]; return a; };
function QuizQuestionsField({ value, onChange, props }) {
  const items = value || [];
  const outs = props?.outcomes || [];
  const points = props?.scoring === 'points';
  const setQ = (i, patch) => onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const setA = (i, j, patch) => setQ(i, { answers: (items[i].answers || []).map((a, n) => (n === j ? { ...a, ...patch } : a)) });
  return (
    <div className="fld"><label>Questions <small>({items.length})</small></label>
      {items.map((it, i) => (
        <div className="li quiz-li" key={i}>
          <div className="li-h"><span>Q{i + 1}</span><span className="row">
            {i > 0 && <button className="icon-btn xs" aria-label="Move up" onClick={() => onChange(moveIn(items, i, -1))}>↑</button>}
            <button className="icon-btn xs danger" aria-label="Remove question" onClick={() => onChange(items.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
          </span></div>
          <input placeholder="Question" value={it.q || ''} onChange={(e) => setQ(i, { q: e.target.value })} />
          <label className="tog mini"><input type="checkbox" checked={!!it.multi} onChange={(e) => setQ(i, { multi: e.target.checked })} /><span />Pick more than one</label>
          {(it.answers || []).map((a, j) => (
            <div className="quiz-ans" key={j}>
              <input placeholder={`Answer ${j + 1}`} value={a.text || ''} onChange={(e) => setA(i, j, { text: e.target.value })} />
              {points
                ? <input type="number" className="xs" title="Points" placeholder="pts" value={a.points ?? ''} onChange={(e) => setA(i, j, { points: e.target.value === '' ? '' : Number(e.target.value) })} />
                : <select title="Counts towards this result" value={a.outcome ?? ''} onChange={(e) => setA(i, j, { outcome: e.target.value === '' ? '' : Number(e.target.value) })}><option value="">→ no result</option>{outs.map((o, n) => <option key={n} value={n}>→ {o.title || `Result ${n + 1}`}</option>)}</select>}
              <input className="xs" placeholder="tag" title="Tag the contact when they pick this (optional)" value={a.tag || ''} onChange={(e) => setA(i, j, { tag: e.target.value })} />
              <input className="xs" placeholder="image URL" title="Picture answer (optional)" value={a.image || ''} onChange={(e) => setA(i, j, { image: e.target.value })} />
              <button className="icon-btn xs danger" aria-label="Remove answer" onClick={() => setQ(i, { answers: it.answers.filter((_, n) => n !== j) })}><Icon name="x" size={12} /></button>
            </div>
          ))}
          {(it.answers || []).length < 8 && <button className="btn ghost sm" onClick={() => setQ(i, { answers: [...(it.answers || []), { text: '', ...(points ? { points: 0 } : {}) }] })}><Icon name="plus" size={12} /> Answer</button>}
        </div>
      ))}
      {items.length < 20 && <button className="btn ghost sm block" onClick={() => onChange([...items, { q: 'New question', answers: [{ text: 'Option A' }, { text: 'Option B' }] }])}><Icon name="plus" size={14} /> Add question</button>}
      <span className="hint">{points ? 'Give each answer points — the total picks the result by its “from score”.' : 'Point each answer at a result — the result with the most answers wins.'} Tags go on the CRM contact, so automations can follow up per answer.</span>
    </div>
  );
}
function QuizOutcomesField({ value, onChange, props }) {
  const items = value || [];
  const points = props?.scoring === 'points';
  const set = (i, patch) => onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  return (
    <div className="fld"><label>Results <small>({items.length})</small></label>
      {items.map((it, i) => (
        <div className="li quiz-li" key={i}>
          <div className="li-h"><span>Result {i + 1}</span><span className="row">
            {i > 0 && <button className="icon-btn xs" aria-label="Move up" onClick={() => onChange(moveIn(items, i, -1))}>↑</button>}
            <button className="icon-btn xs danger" aria-label="Remove result" onClick={() => onChange(items.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
          </span></div>
          <input placeholder="Result title, e.g. The Starter Path" value={it.title || ''} onChange={(e) => set(i, { title: e.target.value })} />
          <textarea rows={3} placeholder="What it means for them, and what you recommend" value={it.body || ''} onChange={(e) => set(i, { body: e.target.value })} />
          {points && <input type="number" placeholder="From score (e.g. 10)" value={it.min ?? ''} onChange={(e) => set(i, { min: e.target.value === '' ? '' : Number(e.target.value) })} />}
          <input placeholder="Button text (empty = no button)" value={it.buttonText || ''} onChange={(e) => set(i, { buttonText: e.target.value })} />
          <input placeholder="Button link (empty = next step of this funnel)" value={it.url || ''} onChange={(e) => set(i, { url: e.target.value })} />
          <div className="row nowrap"><input placeholder="Tag for this result" value={it.tag || ''} onChange={(e) => set(i, { tag: e.target.value })} /><input placeholder="Image URL (optional)" value={it.image || ''} onChange={(e) => set(i, { image: e.target.value })} /></div>
        </div>
      ))}
      {items.length < 8 && <button className="btn ghost sm block" onClick={() => onChange([...items, { title: `Result ${items.length + 1}`, body: '', buttonText: 'Continue', url: '', tag: '' }])}><Icon name="plus" size={14} /> Add result</button>}
      <span className="hint">Each result can send people to a different page — a course, a product or your booking page. Use “Someone finishes a quiz” in Automations to follow up per result.</span>
    </div>
  );
}

// Friendlier names where the prop name reads awkwardly
const FIELD_LABELS = {
  alt: 'image description',
  ctaText: 'button text', ctaAction: 'button action', ctaUrl: 'button link or section', ctaNewTab: 'open in a new tab',
  buttonAction: 'button action', buttonUrl: 'button link or section', buttonNewTab: 'open in a new tab',
  secondaryText: 'small link text', secondaryUrl: 'small link goes to',
};
// The seller's digital products, loaded once per editor session (refreshed when the picker opens)
let productCache = null;
const loadProducts = (fresh) => { if (!productCache || fresh) productCache = api('/products').then((r) => r.products).catch(() => []); return productCache; };
function ProductSelect({ value, onChange, compact }) {
  const [list, setList] = useState(null);
  useEffect(() => { let on = true; loadProducts().then((l) => on && setList(l)); return () => { on = false; }; }, []);
  const missing = value && list && !list.some((p) => p.id === value);
  return (
    <div className={`prod-pick ${compact ? 'compact' : ''}`}>
      <select value={value || ''} onFocus={() => loadProducts(true).then(setList)} onChange={(e) => onChange(e.target.value)}>
        <option value="">{compact ? 'Deliver: nothing' : '— Nothing to deliver —'}</option>
        {(list || []).map((p) => <option key={p.id} value={p.id}>{compact ? `Deliver: ${p.name}` : p.name}</option>)}
        {missing && <option value={value}>⚠ Deleted product</option>}
      </select>
      {!compact && <Link className="prod-pick-l" to="/products" target="_blank">{list?.length ? 'Manage products ↗' : 'Create a product ↗'}</Link>}
    </div>
  );
}

let calendarCache = null;
function CalendarSelect({ value, onChange }) {
  const [list, setList] = useState(null);
  useEffect(() => { let on = true; (calendarCache ||= api('/calendars').catch(() => [])).then((l) => on && setList(l)); return () => { on = false; }; }, []);
  return (
    <div className="prod-pick">
      <select value={value || ''} onFocus={() => { calendarCache = api('/calendars').catch(() => []); calendarCache.then(setList); }} onChange={(e) => onChange(e.target.value)}>
        <option value="">{list?.[0] ? `Default — ${list[0].name}` : 'Default calendar'}</option>
        {(list || []).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.duration} min</option>)}
      </select>
      <Link className="prod-pick-l" to="/bookings?tab=calendars" target="_blank">Set your available hours ↗</Link>
    </div>
  );
}

function Field({ def, value, onChange, props }) {
  const [key, kind, sub, hint] = def;
  const label = FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').toLowerCase();
  if (key === 'image' || key === 'src') return <ImageField label={label === 'src' ? 'image' : label} value={value} onChange={onChange} hint={hint} />;
  if (key === 'logo') return <ImageField label="logo" value={value} onChange={onChange} hint={hint} aspect="1:1" />;
  if (kind === 'gallery') return <GalleryField value={value} onChange={onChange} />;
  if (kind === 'formfields') return <FormFieldsField value={value} onChange={onChange} />;
  if (kind === 'quizquestions') return <QuizQuestionsField value={value} onChange={onChange} props={props} />;
  if (kind === 'quizoutcomes') return <QuizOutcomesField value={value} onChange={onChange} props={props} />;
  if (kind === 'calendar') return <div className="fld"><label>calendar</label><CalendarSelect value={value} onChange={onChange} />{hint && <span className="hint">{hint}</span>}</div>;
  if (kind === 'product') return <div className="fld"><label>{key === 'bumpProductId' ? 'deliver with the order bump' : key === 'productId' && hint?.startsWith('Free') ? 'free product (lead magnet)' : 'deliver after payment'}</label><ProductSelect value={value} onChange={onChange} />{hint && <span className="hint">{hint}</span>}</div>;
  if (kind === 'code') return <div className="fld"><label>{label}</label><textarea className="code-area" rows={8} spellCheck={false} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="<iframe src=…></iframe>" />{hint && <span className="hint">{hint}</span>}</div>;
  // a date and time in the seller's own time zone, saved as a timestamp
  if (kind === 'datetime') {
    const local = Number(value) > 0 ? new Date(Number(value) - new Date(Number(value)).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    return <div className="fld"><label>{label}</label><input type="datetime-local" value={local} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).getTime() : 0)} />{hint && <span className="hint">{hint}</span>}</div>;
  }
  if (kind === 'bool') return <label className="tog"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /><span />{label}</label>;
  if (kind === 'select') return <div className="fld"><label>{label}</label><select value={value ?? sub[0][0]} onChange={(e) => onChange(e.target.value)}>{sub.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{hint && <span className="hint">{hint}</span>}</div>;
  if (kind === 'list') {
    const items = value || [];
    const set = (i, k, v) => onChange(items.map((it, n) => (n === i ? { ...it, [k]: v } : it)));
    return (
      <div className="fld"><label>{label} <small>({items.length})</small></label>
        {hint && <span className="hint">{hint}</span>}
        {items.map((it, i) => (
          <div className="li" key={i}>
            <div className="li-h"><span>#{i + 1}</span><span className="row">
              {i > 0 && <button className="icon-btn xs" aria-label="Move up" onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }}>↑</button>}
              <button className="icon-btn xs danger" aria-label="Remove" onClick={() => onChange(items.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
            </span></div>
            {sub.map((k) => (k === 'productId' ? <ProductSelect key={k} compact value={it[k]} onChange={(v) => set(i, k, v)} /> : k === 'quote' || k === 'a' || k === 'text' && sub.length === 1
              ? <textarea key={k} rows={2} placeholder={k} value={it[k] || ''} onChange={(e) => set(i, k, e.target.value)} />
              : <input key={k} placeholder={k} value={it[k] ?? ''} onChange={(e) => set(i, k, e.target.value)} />))}
          </div>
        ))}
        <button className="btn ghost sm block" onClick={() => onChange([...items, Object.fromEntries(sub.filter((k) => k !== 'productId').map((k) => [k, '']))])}><Icon name="plus" size={14} /> Add item</button>
      </div>
    );
  }
  return (
    <div className="fld"><label>{label}</label>
      {kind === 'long'
        ? <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
        : <input type={kind === 'number' ? 'number' : 'text'} value={value ?? ''} onChange={(e) => onChange(kind === 'number' ? Number(e.target.value) : e.target.value)} />}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

// ---------- per-section design ----------
const SPACING = [['', 'Default'], ['none', 'None'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']];
const INK_PRESETS = [['', 'Auto'], ['#ffffff', 'White'], ['#0f172a', 'Dark']];
function StylePanel({ value, onChange }) {
  const st = { ...STYLE_DEFAULTS, ...(value || {}) };
  const set = (k, v) => onChange({ ...st, [k]: v });
  const custom = Object.entries(value || {}).some(([k, v]) => v !== STYLE_DEFAULTS[k] && v !== '' && v !== false);
  return (
    <details className="stylep" open={custom}>
      <summary><Icon name="palette" size={14} /> Section style {custom && <span className="pill ok">customised</span>}</summary>
      <div className="fld"><label>Background colour</label>
        <div className="row"><input type="color" className="sw-in" value={st.bg || '#ffffff'} onChange={(e) => set('bg', e.target.value)} /><input value={st.bg} placeholder="Theme default" onChange={(e) => set('bg', e.target.value)} />{st.bg && <button className="icon-btn xs" title="Reset" aria-label="Reset" onClick={() => set('bg', '')}><Icon name="x" size={12} /></button>}</div>
      </div>
      <ImageField label="Background image" value={st.bgImage} onChange={(v) => set('bgImage', v)} />
      {st.bgImage && <div className="fld"><label>Darken image: {st.overlay}%</label><input type="range" min="0" max="80" step="5" value={st.overlay} onChange={(e) => set('overlay', Number(e.target.value))} /></div>}
      <div className="fld"><label>Text colour</label>
        <div className="row">{INK_PRESETS.map(([v, l]) => <button key={l} className={`chipbtn ${st.textColor === v ? 'on' : ''}`} onClick={() => set('textColor', v)}>{l}</button>)}<input type="color" className="sw-in" value={st.textColor || '#0f172a'} onChange={(e) => set('textColor', e.target.value)} /></div>
      </div>
      <div className="form2c">
        <div className="fld"><label>Space above</label><select value={st.padTop} onChange={(e) => set('padTop', e.target.value)}>{SPACING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="fld"><label>Space below</label><select value={st.padBottom} onChange={(e) => set('padBottom', e.target.value)}>{SPACING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="fld"><label>Content width</label><select value={st.width} onChange={(e) => set('width', e.target.value)}><option value="">Default</option><option value="narrow">Narrow</option><option value="wide">Wide</option><option value="full">Full width</option></select></div>
        <div className="fld"><label>Alignment</label><select value={st.align} onChange={(e) => set('align', e.target.value)}><option value="">Default</option><option value="left">Left</option><option value="center">Centre</option></select></div>
      </div>
      <label className="tog"><input type="checkbox" checked={st.hideMobile} onChange={(e) => set('hideMobile', e.target.checked)} /><span />Hide on phones</label>
      <label className="tog"><input type="checkbox" checked={st.hideDesktop} onChange={(e) => set('hideDesktop', e.target.checked)} /><span />Hide on desktop</label>
      <div className="fld"><label>Anchor ID</label><input value={st.anchor} placeholder="e.g. pricing" onChange={(e) => set('anchor', e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))} /><span className="hint">Buttons set to “Scroll to a section” can jump here with #{st.anchor || 'your-id'}</span></div>
      {custom && <button className="btn ghost sm" onClick={() => onChange(undefined)}>Reset section style</button>}
    </details>
  );
}

// a funnel's own business details on its Terms / Refund / Privacy pages (several brands in one workspace);
// blank fields use the workspace's (Settings → Privacy). Saved on its own, outside the autosave.
function LegalPanel({ f, onSaved }) {
  const [l, setL] = useState({ businessName: '', email: '', phone: '', address: '', refundDays: '', ...(f.legal || {}) });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setL({ ...l, [k]: v });
  const save = async () => {
    setBusy(true);
    try { const r = await api(`/funnels/${f.id}/legal`, 'PUT', l); onSaved(r.legal); toast(r.legal ? 'Legal details saved for this funnel' : 'This funnel uses your workspace details'); } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return (
    <details className="stylep" open={!!f.legal}>
      <summary><Icon name="settings" size={14} /> Legal details for this funnel (optional) {f.legal && <span className="pill ok">own details</span>}</summary>
      <p className="hint">Shown on this funnel’s Terms, Refund and Privacy pages and its checkout links. Leave blank to use your workspace details.</p>
      <div className="fld"><label>Business name</label><input value={l.businessName} maxLength={120} onChange={(e) => set('businessName', e.target.value)} /></div>
      <div className="fld"><label>Support email</label><input type="email" value={l.email} maxLength={200} onChange={(e) => set('email', e.target.value)} /></div>
      <div className="fld"><label>Phone / WhatsApp</label><input value={l.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} /></div>
      <div className="fld"><label>Address</label><textarea rows={2} value={l.address} maxLength={400} onChange={(e) => set('address', e.target.value)} /></div>
      <div className="fld"><label>Refund window (days, 0 = no refunds)</label><input type="number" min="0" max="365" value={l.refundDays ?? ''} placeholder="Workspace default" onChange={(e) => set('refundDays', e.target.value)} /></div>
      <button className="btn sm" disabled={busy} onClick={save}>Save legal details</button>
    </details>
  );
}

// a funnel's own pixel / analytics / Google Ads ids (another brand's ad account); blank fields use the
// account's (Settings → Tracking). Saved on its own, outside the autosave.
const ADS_FIELDS = [['conversionId', 'Google Ads conversion ID', 'AW-123456789'], ['purchaseLabel', 'Purchase label', 'AbC-D_efG12'], ['leadLabel', 'Lead label', ''], ['bookingLabel', 'Booking label', '']];
function TrackingPanel({ f }) {
  const blank = { fbPixel: '', ga4: '', googleAds: {}, metaToken: '' };
  const [t, setT] = useState(blank);
  const [info, setInfo] = useState(null); // { tracking, workspace, capi, canSetToken }
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/funnels/${f.id}/tracking`).then((r) => { setInfo(r); setT({ ...blank, ...(r.tracking || {}), googleAds: r.tracking?.googleAds || {}, metaToken: '' }); }).catch(() => {}); }, [f.id]);
  const ws = info?.workspace || {};
  const using = (v) => (v ? `Using your account’s: ${v}` : 'Not set in your account');
  const send = async (body, msg) => {
    setBusy(true);
    try {
      const r = await api(`/funnels/${f.id}/tracking`, 'PUT', body);
      setInfo({ ...info, tracking: r.tracking });
      setT({ ...blank, ...(r.tracking || {}), googleAds: r.tracking?.googleAds || {}, metaToken: '' });
      toast(r.tracking ? msg : 'This funnel uses your account’s tracking');
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  const { metaToken, ...ids } = t;
  const save = () => send({ ...ids, ...(metaToken ? { metaToken } : {}) }, 'Tracking saved for this funnel');
  const own = info?.tracking;
  return (
    <details className="stylep" open={!!own}>
      <summary><Icon name="settings" size={14} /> Tracking for this funnel (optional) {own && <span className="pill ok">own tracking</span>}</summary>
      <p className="hint">For a funnel that runs on a different ad account. Each blank field uses your account’s setting (Settings → Tracking).</p>
      <div className="fld"><label>Meta (Facebook) Pixel ID</label><input value={t.fbPixel} maxLength={20} placeholder={using(ws.fbPixel)} onChange={(e) => setT({ ...t, fbPixel: e.target.value })} /></div>
      {t.fbPixel && t.fbPixel !== ws.fbPixel && (
        <div className="fld"><label>Conversions API token for this pixel {own?.metaToken && <small className="ok-t">· saved</small>}</label>
          <input type="password" value={t.metaToken} disabled={!info?.canSetToken} placeholder={own?.metaToken ? '•••••••• (saved)' : 'Events Manager → this pixel → Settings → Generate access token'} onChange={(e) => setT({ ...t, metaToken: e.target.value })} />
          <span className="hint">{info?.canSetToken ? 'Optional. Without it, this pixel gets browser events only (server-side events never go to another pixel).' : 'Only the owner or an admin can add a token.'}</span>
          {own?.metaToken && info?.canSetToken && <button className="btn ghost sm" disabled={busy} onClick={() => send({ ...ids, metaToken: '' }, 'Token removed')}>Remove token</button>}
        </div>
      )}
      <div className="fld"><label>Google Analytics 4 ID</label><input value={t.ga4} maxLength={24} placeholder={using(ws.ga4)} onChange={(e) => setT({ ...t, ga4: e.target.value })} /></div>
      {ADS_FIELDS.map(([k, l, ph]) => (
        <div className="fld" key={k}><label>{l}</label><input value={t.googleAds[k] || ''} maxLength={40} placeholder={ws.googleAds?.[k] ? using(ws.googleAds[k]) : ph || 'Optional'} onChange={(e) => setT({ ...t, googleAds: { ...t.googleAds, [k]: e.target.value } })} /></div>
      ))}
      <div className="row">
        <button className="btn sm" disabled={busy || !info} onClick={save}>Save tracking</button>
        {own && <button className="btn ghost sm" disabled={busy} onClick={async () => (await confirmDialog({ title: 'Clear this funnel’s tracking and use your account settings?', confirm: 'Clear' })) && send({ fbPixel: '', ga4: '', googleAds: {}, metaToken: '' })}>Clear (use account settings)</button>}
      </div>
    </details>
  );
}

// ---------- pointer-based drag & drop (mouse + touch) ----------
// Mouse drags start after a 5px move; touch drags start after a 260ms long-press (so swiping still scrolls).
function useDnd(onDrop, onBegin) {
  const st = useRef(null);
  const latestDrop = useRef(onDrop);
  latestDrop.current = onDrop;
  const latestBegin = useRef(onBegin);
  latestBegin.current = onBegin;
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(null);
  const [dropAt, setDropAt] = useState(null);

  const compute = (x, y, payload) => {
    let z = document.elementFromPoint(x, y)?.closest('[data-drop]');
    while (z && !ACCEPT[payload.kind].includes(z.dataset.drop)) z = z.parentElement?.closest('[data-drop]');
    if (!z) return null;
    const zone = z.dataset.drop;
    const items = [...z.children].filter((c) => c.classList.contains(zone === 'blocks' ? 'blk-item' : zone === 'col' ? 'el-slot' : 'stepi'));
    let index = items.length;
    for (let i = 0; i < items.length; i++) { const r = items[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { index = i; break; } }
    return { zone, index, block: z.dataset.block, col: z.dataset.col != null ? Number(z.dataset.col) : undefined };
  };

  useEffect(() => {
    // Stop the page scrolling under a finger that is dragging
    const tm = (e) => { if (st.current?.started) e.preventDefault(); };
    window.addEventListener('touchmove', tm, { passive: false });
    return () => window.removeEventListener('touchmove', tm);
  }, []);

  const cleanup = () => {
    const s = st.current;
    if (!s) return;
    clearTimeout(s.timer); cancelAnimationFrame(s.raf);
    s.ghost?.remove();
    window.removeEventListener('pointermove', s.move);
    window.removeEventListener('pointerup', s.up);
    window.removeEventListener('pointercancel', s.cancel);
    document.body.classList.remove('dnd-on');
    st.current = null;
    setDragging(null); setDropAt(null);
  };

  const start = (e, payload, label) => {
    if (e.button > 0) return;
    e.stopPropagation();
    cleanup();
    const s = { payload, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', started: false, last: null };
    const begin = () => {
      s.started = true;
      s.ghost = Object.assign(document.createElement('div'), { className: 'dnd-ghost', textContent: label || 'Moving' });
      document.body.appendChild(s.ghost);
      document.body.classList.add('dnd-on');
      setDragging(payload);
      latestBegin.current?.(payload);
      const tick = () => {
        // auto-scroll the canvas when dragging near its top/bottom edge
        const c = document.querySelector('.ed-canvas');
        if (c) { const r = c.getBoundingClientRect(); if (s.y < r.top + 70) c.scrollTop -= 14; else if (s.y > r.bottom - 70) c.scrollTop += 14; }
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
      s.move({ clientX: s.x, clientY: s.y, preventDefault() {} });
    };
    s.move = (ev) => {
      s.x = ev.clientX; s.y = ev.clientY;
      if (!s.started) {
        const d = Math.hypot(s.x - s.x0, s.y - s.y0);
        if (s.touch) { if (d > 8) cleanup(); } else if (d > 5) begin();
        return;
      }
      ev.preventDefault();
      s.ghost.style.transform = `translate(${s.x + 14}px, ${s.y + 14}px)`;
      const d = compute(s.x, s.y, s.payload);
      if (JSON.stringify(d) !== JSON.stringify(s.last)) { s.last = d; setDropAt(d); }
    };
    s.up = () => {
      if (s.started) {
        const d = compute(s.x, s.y, s.payload) || s.last;
        suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
        cleanup();
        if (d) latestDrop.current(payload, d);
      } else cleanup();
    };
    s.cancel = () => cleanup();
    if (s.touch) s.timer = setTimeout(begin, 260);
    st.current = s;
    window.addEventListener('pointermove', s.move, { passive: false });
    window.addEventListener('pointerup', s.up);
    window.addEventListener('pointercancel', s.cancel);
  };
  return { start, dragging, dropAt, suppressClick };
}

export default function Editor() {
  const { id } = useParams();
  const [f, setF] = useState(null);
  const [me, setMe] = useState(null);
  const [stepId, setStepId] = useState(null);
  const [sel, setSel] = useState(null);
  const [selEl, setSelEl] = useState(null);
  const [variant, setVariant] = useState('A');
  const [popupId, setPopupId] = useState(null);   // editing one of the step's pop-ups instead of the page
  const [popPreview, setPopPreview] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [view, setView] = useState('canvas');
  const [left, setLeft] = useState('add');
  const [right, setRight] = useState('ai');
  const [status, setStatus] = useState('Saved');
  const [stepMenu, setStepMenu] = useState(false);
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: 'I can edit this funnel for you. Tell me what to change — e.g. “add an upsell and a downsell”, “make it dark” or “add FAQ”. I’ll update the funnel for you.' }]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const hist = useRef({ past: [], future: [], last: 0 });
  const fRef = useRef(null);         // always the newest funnel, even between renders
  const loaded = useRef(false);
  const verRef = useRef(1);          // server version this editor is based on
  const [publishing, setPublishing] = useState(false);
  const skipSave = useRef(false);    // set when f is replaced by a copy that is already saved
  const [conflict, setConflict] = useState(null);
  const [legalMiss, setLegalMiss] = useState([]); // business & legal details still missing (publishing needs them)
  const [history, setHistory] = useState(null);
  const [mob, setMob] = useState('canvas'); // phone layout: which panel is open
  const [saved, setSaved] = useState([]);
  const [clip, setClip] = useState(readClip);
  const chatEnd = useRef();
  const dropHandler = useRef(() => {});
  // On phones the Add / Steps drawer covers the page: slide it away once a drag starts so there is somewhere to drop
  const dnd = useDnd((payload, d) => dropHandler.current(payload, d), (payload) => { if (payload.kind !== 'step' && window.matchMedia('(max-width: 1000px)').matches) setMob('canvas'); });

  useEffect(() => {
    api(`/funnels/${id}`).then((d) => { verRef.current = d.version || 1; setF(d); setStepId(d.steps[0]?.id); });
    api('/me').then(setMe);
    api('/saved').then(setSaved).catch(() => {});
  }, [id]);
  // a live funnel missing the seller's legal details stays live, with a warning here
  useEffect(() => { if (f?.published) api(`/funnels/${id}/legal-check`).then((r) => setLegalMiss(r.missing || [])).catch(() => {}); }, [id, f?.published]);
  // the clipboard may be filled from another tab
  useEffect(() => { const k = (e) => { if (e.key === CLIP_KEY) setClip(readClip()); }; window.addEventListener('storage', k); return () => window.removeEventListener('storage', k); }, []);

  // One save at a time: a slow save and the next edit never race each other into a false “Conflict”,
  // because each save goes out on the version the previous one got back
  const saving = useRef(Promise.resolve());
  const dirty = useRef(false); // an edit is waiting for the autosave timer
  const save = (data = f) => {
    dirty.current = false;
    const run = () => saveNow(data);
    const p = saving.current.then(run, run);
    saving.current = p;
    return p;
  };
  const saveNow = async (data) => {
    setStatus('Saving…');
    try {
      const r = await api(`/funnels/${id}`, 'PUT', { name: data.name, steps: data.steps, theme: data.theme, published: data.published, baseVersion: verRef.current });
      verRef.current = r.version;
      setStatus('Saved');
      return true;
    } catch (e) {
      if (e.status === 409) { setConflict(e.data.funnel); setStatus('Conflict'); }
      else { setStatus('Not saved'); dirty.current = true; toast(e.message); } // still unsaved: closing the tab warns
      return false;
    }
  };
  // Replace the editor's copy with one the server already has (no save round-trip)
  const adopt = (nf) => { skipSave.current = true; verRef.current = nf.version || verRef.current; fRef.current = nf; setF(nf); if (!nf.steps.some((s) => s.id === stepId)) setStepId(nf.steps[0]?.id); };
  // Debounced autosave
  useEffect(() => {
    if (!f) return;
    if (!loaded.current) { loaded.current = true; return; }
    if (skipSave.current) { skipSave.current = false; setStatus('Saved'); return; }
    if (conflict) return;
    setStatus('Unsaved');
    dirty.current = true;
    const t = setTimeout(() => save(f), 700);
    return () => clearTimeout(t);
  }, [f]);
  // leaving the editor right after an edit still saves it; closing the tab with an edit unsaved asks first
  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); if (dirty.current && fRef.current) save(fRef.current); };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const k = (e) => {
      if (!f) return;
      if (e.defaultPrevented || document.querySelector('.m-scrim, .dlg-scrim')) return; // a dialog is open: its keys are its own
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && sel && !selEl && !typing && !window.getSelection()?.toString()) { e.preventDefault(); copyBlock(sel); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !typing && readClip()) { e.preventDefault(); pasteBlock(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !typing) { e.preventDefault(); selEl ? elAction('del', sel, selEl) : removeBlock(sel); }
      else if (e.key === 'Escape') { if (selEl) setSelEl(null); else setSel(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, thinking]);

  // piece toolbar (see pickPiece below)
  const [piece, setPiece] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!piece) return;
    const re = () => setTick((x) => x + 1);
    window.addEventListener('scroll', re, true); window.addEventListener('resize', re);
    return () => { window.removeEventListener('scroll', re, true); window.removeEventListener('resize', re); };
  }, [piece]);
  useEffect(() => { if (piece && piece.bid !== sel) setPiece(null); }, [sel]);
  if (!f) return <div className="ed-loading"><span className="spin dark" /> Loading editor…</div>;
  fRef.current = f;

  // ---------- state helpers ----------
  // Every change builds on fRef (the newest copy), so two edits in quick succession never overwrite each other
  const commit = (nf, group) => {
    const h = hist.current, now = Date.now();
    if (!(group && now - h.last < 900)) { h.past.push(fRef.current); if (h.past.length > 80) h.past.shift(); }
    h.last = group ? now : 0; h.future = [];
    fRef.current = nf;
    setF(nf);
  };
  const undo = () => { const h = hist.current; if (!h.past.length) return; h.future.push(fRef.current); fRef.current = h.past.pop(); setF(fRef.current); };
  const redo = () => { const h = hist.current; if (!h.future.length) return; h.past.push(fRef.current); fRef.current = h.future.pop(); setF(fRef.current); };
  const step = f.steps.find((s) => s.id === stepId) || f.steps[0];
  const abOn = !!step.ab?.enabled;
  const isB = abOn && variant === 'B';
  const popup = popupId ? (step.popups || []).find((p) => p.id === popupId) : null;
  const blocks = popup ? popup.blocks : isB ? step.ab.blocks : step.blocks;
  const setPopups = (fn, group) => patchStep((s) => ({ popups: fn(s.popups || []) }), group);
  const patch = (p, group) => commit({ ...fRef.current, ...p }, group);
  const patchStep = (p, group) => { const lf = fRef.current; commit({ ...lf, steps: lf.steps.map((s) => (s.id === step.id ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s)) }, group); };
  const setBlocks = (nb, group) => patchStep((s) => (popup ? { popups: (s.popups || []).map((p) => (p.id === popup.id ? { ...p, blocks: nb.slice(0, POPUP_MAX_BLOCKS) } : p)) } : isB ? { ab: { ...s.ab, blocks: nb } } : { blocks: nb }), group);
  const latestBlocks = () => { const s = fRef.current.steps.find((x) => x.id === step.id); return popup ? ((s.popups || []).find((p) => p.id === popup.id)?.blocks || []) : isB ? s.ab.blocks : s.blocks; };
  const selBlock = blocks.find((b) => b.id === sel);
  const updateBlock = (bid, fn, group) => setBlocks(latestBlocks().map((b) => (b.id === bid ? fn(b) : b)), group);
  const setProp = (k, v) => updateBlock(sel, (b) => ({ ...b, props: k === 'layout' && b.type === 'section' ? applyLayout(b.props, v) : { ...setPath(withCopy(b.type, b.props), k, v), ...(b.type === 'stock' && k === 'left' ? { setAt: Date.now() } : {}) } }), true); // stock: real orders after this count down

  // section elements
  const findEl = (b, eid) => { for (let c = 0; c < (b?.props.columns || []).length; c++) { const i = b.props.columns[c].elements.findIndex((e) => e.id === eid); if (i >= 0) return { c, i, el: b.props.columns[c].elements[i] }; } return null; };
  const mapCols = (b, fn) => ({ ...b, props: { ...b.props, columns: b.props.columns.map(fn) } });
  const takeEl = (list, bid, eid) => {
    let taken = null;
    const out = list.map((b) => (b.id !== bid ? b : mapCols(b, (c) => ({ ...c, elements: c.elements.filter((e) => (e.id === eid ? ((taken = e), false) : true)) }))));
    return [out, taken];
  };
  const putEl = (list, bid, col, idx, el) => list.map((b) => (b.id !== bid ? b : mapCols(b, (c, ci) => (ci !== col ? c : { ...c, elements: [...c.elements.slice(0, idx), el, ...c.elements.slice(idx)] }))));
  const updateEl = (bid, eid, fn, group) => updateBlock(bid, (b) => mapCols(b, (c) => ({ ...c, elements: c.elements.map((e) => (e.id === eid ? fn(e) : e)) })), group);
  const elAction = (action, bid, eid) => {
    const b = blocks.find((x) => x.id === bid);
    const loc = findEl(b, eid);
    if (!loc) return;
    if (action === 'del') { setBlocks(takeEl(blocks, bid, eid)[0]); if (selEl === eid) setSelEl(null); }
    if (action === 'dup') { const c = { ...clone(loc.el), id: uid() }; setBlocks(putEl(blocks, bid, loc.c, loc.i + 1, c)); setSel(bid); setSelEl(c.id); }
    if (action === 'up' || action === 'down') {
      const to = loc.i + (action === 'up' ? -1 : 1);
      if (to < 0 || to >= b.props.columns[loc.c].elements.length) return;
      const [nb, el] = takeEl(blocks, bid, eid);
      setBlocks(putEl(nb, bid, loc.c, to, el));
    }
  };
  const sectionWith = (el) => ({ id: uid(), type: 'section', props: { layout: '1', valign: 'top', gap: 'md', columns: [{ id: uid(), elements: [el] }] } });
  const insertIndex = () => {
    let at = sel ? blocks.findIndex((b) => b.id === sel) + 1 : blocks.findIndex((b) => FLOATING.includes(b.type));
    if (at <= 0 && !sel) at = blocks.length;
    return at;
  };
  const addElement = (type) => {
    if (dnd.suppressClick.current) return;
    const el = newElement(type);
    if (selBlock?.type === 'section') {
      const loc = selEl && findEl(selBlock, selEl);
      setBlocks(putEl(blocks, selBlock.id, loc ? loc.c : 0, loc ? loc.i + 1 : selBlock.props.columns[0].elements.length, el));
      setSelEl(el.id);
    } else {
      const nb = [...blocks]; const s = sectionWith(el); nb.splice(insertIndex(), 0, s); setBlocks(nb);
      setSel(s.id); setSelEl(el.id);
    }
    setRight('edit'); setMob('canvas');
    setTimeout(() => document.querySelector('.el.el-sel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const insertAt = (type, at) => {
    if (popup && blocks.length >= POPUP_MAX_BLOCKS) return toast(`A pop-up holds up to ${POPUP_MAX_BLOCKS} sections`);
    if (popup && !POPUP_BLOCKS.includes(typeof type === 'string' ? type : type?.type)) return toast('That section can’t go in a pop-up');
    const b = typeof type === 'string' ? mk(type) : freshIds(type);
    if (popup && b.type === 'countdown') b.props.mode = 'fixed'; // pop-ups only count down to a real, fixed deadline
    const nb = [...blocks];
    nb.splice(at, 0, b);
    setBlocks(nb);
    setSel(b.id); setSelEl(null); setRight('edit');
  };
  const addBlock = (type) => {
    if (dnd.suppressClick.current) return;
    insertAt(type, insertIndex());
    setMob('canvas');
    setTimeout(() => document.querySelector('.wrap.sel')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  // ---- piece toolbar: move / duplicate / remove a single item, line of text or box inside a section ----
  const pickPiece = (t) => {
    const w = t?.closest?.('[data-bid]');
    if (!w || t.closest('.tools, .el-tools')) return setPiece(null);
    const text = t.closest('.ed-text[data-k]'), item = t.closest('[data-item]'), box = t.closest('[data-rm]'), el = t.closest('[data-el]');
    if (!text && !item && !box) return setPiece(null);
    const soleText = item && text && item.querySelectorAll('.ed-text').length === 1; // "remove item" already covers it
    setPiece({ bid: w.dataset.bid, eid: el?.dataset.el, k: text && !text.dataset.keep && !soleText ? text.dataset.k : null, item: item?.dataset.item, box: box?.dataset.rm, boxLabel: box?.dataset.rmLabel });
  };
  const pieceNode = (p) => {
    const w = document.querySelector(`.frame [data-bid="${CSS.escape(p.bid)}"]`);
    const scope = w && (p.eid ? w.querySelector(`[data-el="${CSS.escape(p.eid)}"]`) : w);
    if (!scope) return null;
    return (p.k && scope.querySelector(`[data-k="${CSS.escape(p.k)}"]`)) || (p.item && scope.querySelector(`[data-item="${CSS.escape(p.item)}"]`)) || (p.box && scope.querySelector(`[data-rm="${CSS.escape(p.box)}"]`));
  };
  const pieceOp = (op) => {
    const p = piece;
    if (!p) return;
    document.activeElement?.blur?.(); // save any text being typed first
    const m = p.item ? /^(.*)\.(\d+)$/.exec(p.item) : null;
    const key = m?.[1], i = m ? Number(m[2]) : -1;
    const apply = (props) => {
      if (op === 'text') return setPath(props, p.k, '');
      if (op === 'box') return setPath(props, p.box, false);
      const arr = [...(getPath(props, key) || [])];
      if (op === 'del') arr.splice(i, 1);
      if (op === 'dup') arr.splice(i + 1, 0, clone(arr[i]));
      if (op === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (op === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      return setPath(props, key, arr);
    };
    if (p.eid) updateEl(p.bid, p.eid, (e) => ({ ...e, props: apply(e.props) }));
    else updateBlock(p.bid, (b) => ({ ...b, props: apply(withCopy(b.type, b.props)) }));
    const to = op === 'up' ? i - 1 : op === 'down' ? i + 1 : op === 'dup' ? i + 1 : null;
    setPiece(to != null && to >= 0 ? { ...p, item: `${key}.${to}`, k: p.k && p.k.startsWith(`${p.item}.`) ? `${key}.${to}${p.k.slice(p.item.length)}` : null } : null);
  };
  const copyBlock = (bid) => {
    const b = latestBlocks().find((x) => x.id === bid);
    if (!b) return;
    localStorage.setItem(CLIP_KEY, JSON.stringify({ type: b.type, props: b.props }));
    setClip(readClip()); toast('Section copied — paste it into any funnel');
  };
  const pasteBlock = () => {
    const c = readClip();
    if (!c) return;
    insertAt(c, insertIndex()); setMob('canvas'); toast('Section pasted');
  };
  const saveToLibrary = async (bid) => {
    const b = latestBlocks().find((x) => x.id === bid);
    if (!b) return;
    const name = await promptDialog({ title: 'Save to your library', text: 'Name this section so you can find it later', label: 'Name', value: `${BLOCK_TYPES[b.type]?.label || b.type} — ${f.name}`.slice(0, 80), confirm: 'Save' });
    if (name === null) return;
    try { const item = await api('/saved', 'POST', { name, block: { type: b.type, props: b.props } }); setSaved((x) => [item, ...x]); toast('Saved to your library'); } catch (e) { toast(e.message); }
  };
  const deleteSaved = async (sid) => { if (!await confirmDialog({ title: 'Remove this saved section from your library?', confirm: 'Remove', danger: true })) return; await api(`/saved/${sid}`, 'DELETE'); setSaved((x) => x.filter((i) => i.id !== sid)); };
  const removeBlock = (bid) => { setBlocks(blocks.filter((b) => b.id !== bid)); if (sel === bid) { setSel(null); setSelEl(null); } };
  const dupBlock = (bid) => { const i = blocks.findIndex((b) => b.id === bid); const c = freshIds(blocks[i]); const nb = [...blocks]; nb.splice(i + 1, 0, c); setBlocks(nb); setSel(c.id); setSelEl(null); };
  const moveBlock = (from, to) => { const nb = [...blocks]; const [b] = nb.splice(from, 1); nb.splice(to > from ? to - 1 : to, 0, b); setBlocks(nb); };

  const editPopup = (pid) => { setPopupId(pid); setSel(null); setSelEl(null); setView('canvas'); setMob('canvas'); };
  const selectStep = (sid) => { setStepId(sid); setPopupId(null); setSel(null); setSelEl(null); setVariant('A'); setView('canvas'); setMob('canvas'); };
  const addStep = (type) => {
    const t = STEP_TYPES[type];
    const s = { id: uid(), name: t.label, type, slug: slugify(type), blocks: t.blocks(f) };
    while (f.steps.some((x) => x.slug === s.slug)) s.slug += '-2';
    const steps = [...f.steps];
    const ty = steps.findIndex((x) => x.type === 'thankyou');
    steps.splice(type === 'thankyou' || ty < 0 ? steps.length : ty, 0, s);
    patch({ steps });
    selectStep(s.id); setStepMenu(false);
  };
  const dupStep = () => { const s = { ...clone(step), id: uid(), name: `${step.name} copy`, slug: `${step.slug}-copy` }; s.blocks = s.blocks.map(freshIds); const steps = [...f.steps]; steps.splice(f.steps.indexOf(step) + 1, 0, s); patch({ steps }); selectStep(s.id); };
  const delStep = async () => { if (f.steps.length < 2 || !await confirmDialog({ title: `Delete the “${step.name}” step?`, confirm: 'Delete', danger: true })) return; const steps = f.steps.filter((s) => s.id !== step.id); patch({ steps }); selectStep(steps[0].id); };

  // ---------- drop handling ----------
  dropHandler.current = (payload, d) => {
    if (payload.kind === 'step') {
      const steps = [...f.steps]; const from = steps.findIndex((s) => s.id === payload.id);
      if (d.index === from || d.index === from + 1) return;
      const [s] = steps.splice(from, 1); steps.splice(d.index > from ? d.index - 1 : d.index, 0, s);
      return patch({ steps });
    }
    if (d.zone === 'blocks') {
      if (payload.kind === 'new-block') return insertAt(payload.block || payload.type, d.index);
      if (payload.kind === 'move-block') { const from = blocks.findIndex((b) => b.id === payload.id); if (from >= 0 && d.index !== from && d.index !== from + 1) moveBlock(from, d.index); return; }
      // an element dropped between sections gets a section of its own
      let nb = blocks, el;
      if (payload.kind === 'move-el') [nb, el] = takeEl(blocks, payload.blockId, payload.elId); else el = newElement(payload.type);
      if (!el) return;
      const s = sectionWith(el); nb = [...nb]; nb.splice(d.index, 0, s); setBlocks(nb);
      setSel(s.id); setSelEl(el.id); setRight('edit');
      return;
    }
    if (d.zone === 'col') {
      let nb = blocks, el, idx = d.index;
      if (payload.kind === 'move-el') {
        const src = findEl(blocks.find((b) => b.id === payload.blockId), payload.elId);
        if (!src) return;
        const same = payload.blockId === d.block && src.c === d.col;
        if (same && (idx === src.i || idx === src.i + 1)) return;
        [nb, el] = takeEl(blocks, payload.blockId, payload.elId);
        if (same && src.i < idx) idx--;
      } else el = newElement(payload.type);
      setBlocks(putEl(nb, d.block, d.col, idx, el));
      setSel(d.block); setSelEl(el.id); setRight('edit');
    }
  };

  // ---------- AI chat ----------
  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || thinking) return;
    setInput('');
    const history = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    setThinking(true);
    try {
      if (!(await save(f))) throw new Error('your latest edits could not be saved — resolve that first'); // the server edits the saved copy
      const r = await api('/ai/chat', 'POST', { funnelId: f.id, stepId: step.id, message, history });
      if (r.changes.length) { hist.current.past.push(f); hist.current.future = []; adopt(r.funnel); }
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, changes: r.changes }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: `Sorry — ${e.message}` }]); }
    setThinking(false);
  };

  const openHistory = async () => { setHistory('loading'); setHistory(await api(`/funnels/${f.id}/revisions`)); };
  const restore = async (r) => {
    if (!await confirmDialog({ title: `Restore the version from ${new Date(r.at).toLocaleString('en-IN')}?`, text: 'Your current version is kept in history.', confirm: 'Restore' })) return;
    if (status !== 'Saved' && !(await save(f))) return;
    const nf = await api(`/funnels/${f.id}/revisions/${r.id}/restore`, 'POST');
    hist.current.past.push(f); hist.current.future = [];
    adopt(nf); setHistory(null); setSel(null); setSelEl(null); toast('Older version restored');
  };
  const loadLatest = () => { hist.current = { past: [], future: [], last: 0 }; adopt(conflict); setConflict(null); toast('Loaded the latest version'); };
  const keepMine = async () => { verRef.current = conflict.version; setConflict(null); if (await save(f)) toast('Your version was saved'); };
  const publish = async () => {
    if (publishing) return; // a second click while the first is still going
    setPublishing(true);
    try { await publishNow(); } finally { setPublishing(false); }
  };
  const publishNow = async () => {
    // going live needs the business & legal details (the server checks too)
    if (!f.published) { const r = await api(`/funnels/${f.id}/legal-check`).catch(() => ({ missing: [] })); setLegalMiss(r.missing || []); if (r.missing?.length) return toast(`Add your ${r.missing.join(', ')} in Settings → Business & legal before publishing`); if (r.warnings?.length && !(await confirmDialog({ title: 'Check your refund promise', text: r.warnings.join(' '), confirm: 'Publish anyway' }))) return; }
    const nf = { ...f, published: !f.published }; commit(nf);
    if (!(await save(nf))) { if (nf.published) adopt({ ...nf, published: false }); return; }
    toast(nf.published ? 'Your funnel is live' : 'Funnel unpublished');
  };
  const liveUrl = `${(typeof window !== 'undefined' && window.__PAGES_URL__) || location.origin}/f/${f.slug}`;
  const width = DEVICES.find((d) => d[0] === device)[2];
  const nextFor = (i, accept) => { let n = i + 1; if (accept) while (f.steps[n]?.type === 'downsell') n++; return f.steps[n]; };
  const dropAt = dnd.dropAt;
  const selElLoc = selBlock?.type === 'section' && selEl ? findEl(selBlock, selEl) : null;
  const blockCtx = (b) => ({
    live: false, editable: true, selEl, dropAt,
    onEdit: (k, v) => updateBlock(b.id, (x) => ({ ...x, props: setPath(withCopy(x.type, x.props), k, v) })),
    onEditEl: (bid, eid, k, v) => updateEl(bid, eid, (e) => ({ ...e, props: setPath(e.props, k, v) })),
    onSelectEl: (bid, eid) => { setSel(bid); setSelEl(eid); setRight('edit'); },
    onElAction: elAction,
    onDragStart: dnd.start,
  });

  let pieceBar = null;
  const pn = piece && view !== 'flow' && pieceNode(piece);
  if (pn) {
    const r = pn.getBoundingClientRect();
    const im = piece.item && /^(.*)\.(\d+)$/.exec(piece.item);
    const listLen = im ? (getPath(piece.eid ? findEl(selBlock, piece.eid)?.el?.props : withCopy(selBlock?.type, selBlock?.props), im[1]) || []).length : 0;
    const top = r.top > 96 ? r.top - 40 : r.bottom + 8;
    pieceBar = createPortal(
      <div className="piece-bar" style={{ top, left: Math.max(8, Math.min(r.left, window.innerWidth - 330)) }} onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
        {im && <>
          <span className="pb-l">Item {Number(im[2]) + 1}</span>
          <button title="Move up" aria-label="Move up" disabled={Number(im[2]) === 0} onClick={() => pieceOp('up')}><ChevronUp size={15} /></button>
          <button title="Move down" aria-label="Move down" disabled={Number(im[2]) >= listLen - 1} onClick={() => pieceOp('down')}><ChevronDown size={15} /></button>
          <button title="Duplicate item" aria-label="Duplicate item" onClick={() => pieceOp('dup')}><CopyIcon size={14} /></button>
          <button className="danger" title="Remove item" onClick={() => pieceOp('del')}><Trash2 size={14} /> Remove item</button>
        </>}
        {piece.k && !(im && listLen <= 0) && <button className="danger" title="Remove this text" onClick={() => pieceOp('text')}><Trash2 size={14} /> {im ? 'Text' : 'Remove'}</button>}
        {piece.box && <button className="danger" title={`Hide the ${piece.boxLabel || 'box'}`} onClick={() => pieceOp('box')}><EyeOff size={14} /> Hide {piece.boxLabel || 'box'}</button>}
      </div>,
      document.body,
    );
  }

  return (
    <div className={`ed mob-${mob}`}>
      {pieceBar}
      {popPreview && (step.popups || []).some((p) => p.id === popPreview) && createPortal(
        <div className="pop-preview"><Page blocks={[]} theme={f.theme} ctx={{ live: false, lang: f.theme?.lang }} popupPreview={step.popups.find((p) => p.id === popPreview)} onClosePreview={() => setPopPreview(null)} /></div>,
        document.body,
      )}
      {f.published && legalMiss.length > 0 && (
        <div className="conflict"><Icon name="shield" size={16} /><span><b>This live funnel is missing your {legalMiss.join(', ')}.</b> Indian consumer law needs them on your pages.</span>
          <Link className="btn primary sm" to="/settings#legal">Add in Settings → Business & legal</Link></div>
      )}
      {conflict && (
        <div className="conflict"><Icon name="split" size={16} /><span><b>This funnel was changed somewhere else</b> (another tab, device or teammate). Your latest edits are not saved yet.</span>
          <button className="btn ghost sm" onClick={loadLatest}>Load their version</button><button className="btn primary sm" onClick={keepMine}>Keep my version</button></div>
      )}
      {history && (
        <Modal title="Version history" onClose={() => setHistory(null)} width={560}>
          <div className="hist">
            {history === 'loading' ? <div className="center muted"><span className="spin dark" /></div> : !history.length ? <p className="muted center">No earlier versions yet. A restore point is saved automatically before each burst of edits and before every AI change.</p> : history.map((r) => (
              <div className="hist-row" key={r.id}>
                <div><b>{r.label}</b><small>{new Date(r.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {ago(r.at)} · {r.steps} steps, {r.sections} sections</small></div>
                <button className="btn ghost sm" onClick={() => restore(r)}>Restore</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      <header className="ed-top">
        <Link to="/funnels" className="icon-btn" title="All funnels" aria-label="All funnels"><Icon name="chevron" className="flip" /></Link>
        <input className="ed-name" value={f.name} onChange={(e) => patch({ name: e.target.value }, true)} />
        <span className={`ed-status ${status === 'Saved' ? 'ok' : ''}`}>{status === 'Saved' ? <><Icon name="check" size={13} /> Saved</> : status}</span>
        <div className="ed-mid">
          <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo (Ctrl+Z)" onClick={undo} disabled={!hist.current.past.length}><Icon name="undo" size={17} /></button>
          <button className="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo (Ctrl+Y)" onClick={redo} disabled={!hist.current.future.length}><Icon name="redo" size={17} /></button>
          <span className="sep" />
          <div className="seg hide-m">{DEVICES.map(([k, ic]) => <button key={k} title={k} aria-label={k} className={device === k ? 'on' : ''} onClick={() => setDevice(k)}><Icon name={ic} size={16} /></button>)}</div>
          <div className="seg">
            <button className={view === 'canvas' ? 'on' : ''} onClick={() => setView('canvas')}><Icon name="layers" size={15} /> Page</button>
            <button className={view === 'flow' ? 'on' : ''} onClick={() => setView('flow')}><Icon name="flow" size={15} /> Flow</button>
          </div>
        </div>
        <button className="btn ghost hide-m" title="Version history" aria-label="Version history" onClick={openHistory}><Icon name="clock" size={16} /></button>
        <Link className="btn ghost hide-m" to={`/funnels/${f.id}/analytics`}><Icon name="chart" size={16} /></Link>
        <Link className="btn ghost" to={`/f/${f.slug}/${step.slug}?preview=1&pv=${f.previewKey || ''}`}><Icon name="eye" size={16} /> Preview</Link>
        {f.published && <button className="btn ghost" title={liveUrl} aria-label={liveUrl} onClick={() => { navigator.clipboard?.writeText(liveUrl); toast('Live link copied'); }}><Icon name="link" size={16} /></button>}
        <button className={`btn ${f.published ? 'live' : 'primary'}`} onClick={publish} disabled={publishing}>{f.published ? <><span className="live-dot" /> Live</> : <><Icon name="send" size={15} /> Publish</>}</button>
      </header>

      <div className="ed-cols">
        {/* ---------------- left ---------------- */}
        <aside className="ed-left">
          <div className="tabs">
            <button className={left === 'steps' ? 'on' : ''} onClick={() => setLeft('steps')}><Icon name="funnel" size={15} /> Steps</button>
            <button className={left === 'add' ? 'on' : ''} onClick={() => setLeft('add')}><Icon name="plus" size={15} /> Add</button>
            <button className={left === 'theme' ? 'on' : ''} onClick={() => setLeft('theme')}><Icon name="palette" size={15} /> Design</button>
          </div>
          <div className="ed-scroll">
            {left === 'steps' && (
              <>
                <div className="steplist" data-drop="steps">
                  {f.steps.map((s, i) => (
                    <div key={s.id} className={`stepi ${s.id === step.id ? 'on' : ''} ${dropAt?.zone === 'steps' && dropAt.index === i ? 'over' : ''} ${dnd.dragging?.id === s.id ? 'dragging' : ''}`}
                      onClick={() => { if (!dnd.suppressClick.current) selectStep(s.id); }}
                      onPointerDown={(e) => dnd.start(e, { kind: 'step', id: s.id }, s.name)}>
                      <span className="grip"><Icon name="grip" size={14} /></span>
                      <span className="st-ic"><StepIcon type={s.type} size={16} /></span>
                      <div><b>{s.name}</b><small>/{s.slug}{s.ab?.enabled && ' · A/B'}</small></div>
                    </div>
                  ))}
                  {dropAt?.zone === 'steps' && dropAt.index === f.steps.length && <div className="drop-line" />}
                </div>
                <div className="addstep">
                  <button className="btn soft block" onClick={() => setStepMenu(!stepMenu)}><Icon name="plus" size={15} /> Add step</button>
                  {stepMenu && <div className="stepmenu">{Object.entries(STEP_TYPES).map(([k, t]) => <button key={k} onClick={() => addStep(k)}><span className="ti-box sm"><StepIcon type={k} size={14} /></span>{t.label}</button>)}</div>}
                </div>
                <p className="hint">Drag steps to reorder (on a phone, press and hold first). Upsells are shown after checkout; accepting one skips the downsell.</p>
              </>
            )}
            {left === 'add' && (
              <>
                <p className="hint top">Drag onto the page — or tap to add {sel ? 'below the selection' : 'at the end'}. On a phone, press and hold to drag.</p>
                {clip && <button className="btn soft block paste-btn" onClick={pasteBlock}><Icon name="clip" size={15} /> Paste {BLOCK_TYPES[clip.type]?.label || 'section'} <kbd>Ctrl V</kbd></button>}
                {saved.length > 0 && (
                  <div className="pgroup">
                    <h5>My saved sections <small>· {saved.length}</small></h5>
                    <div className="saved-list">
                      {saved.map((it) => (
                        <div key={it.id} className="saved-item" onClick={() => { if (!dnd.suppressClick.current) { insertAt(it.block, insertIndex()); setMob('canvas'); } }} onPointerDown={(e) => { if (!e.target.closest('.saved-x')) dnd.start(e, { kind: 'new-block', block: it.block }, it.name); }}>
                          <span className="ti-box sm"><BlockIcon type={it.block.type} size={14} /></span><b title={it.name}>{it.name}</b>
                          <button className="saved-x" title="Remove from library" aria-label="Remove from library" onClick={(e) => { e.stopPropagation(); deleteSaved(it.id); }}><Icon name="x" size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pgroup">
                  <h5>Elements <small>· go inside a custom section</small></h5>
                  <div className="pgrid el-grid">
                    {Object.entries(ELEMENT_TYPES).map(([t, d]) => (
                      <button key={t} className="pitem" onClick={() => addElement(t)} onPointerDown={(e) => dnd.start(e, { kind: 'new-el', type: t }, d.label)}>
                        <span className="ti-box"><ElementIcon type={t} size={17} /></span>{d.label}
                      </button>
                    ))}
                  </div>
                </div>
                {popup && <p className="hint">Adding to the pop-up “{popup.name}” — only sections that fit in a pop-up are shown.</p>}
                {BLOCK_GROUPS.map(([g, all]) => [g, popup ? all.filter((t) => POPUP_BLOCKS.includes(t)) : all]).filter(([, types]) => types.length).map(([g, types]) => (
                  <div key={g} className="pgroup">
                    <h5>{g === 'Essentials' ? 'Sections · full-width blocks' : g}</h5>
                    <div className="pgrid">
                      {types.map((t) => (
                        <button key={t} className="pitem" onClick={() => addBlock(t)} onPointerDown={(e) => dnd.start(e, { kind: 'new-block', type: t }, BLOCK_TYPES[t].label)}>
                          <span className="ti-box"><BlockIcon type={t} size={17} /></span>{BLOCK_TYPES[t].label.replace('FOMO: ', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
            {left === 'theme' && (
              <>
                <h5>Style</h5>
                <div className="stylegrid">
                  {Object.entries(STYLES).map(([k, label]) => (
                    <button key={k} className={`stylec ${(f.theme?.style || 'aurora') === k ? 'on' : ''}`} onClick={() => patch({ theme: { ...f.theme, style: k } })}>
                      <span className="sw" style={{ background: `linear-gradient(135deg, ${swatchOf(k)[0]} 50%, ${swatchOf(k)[1]} 50%)` }}><i style={{ background: f.theme?.primary }} /></span>
                      <b>{label.split(' — ')[0]}</b><small>{label.split(' — ')[1]}</small>
                    </button>
                  ))}
                </div>
                <h5>Colours</h5>
                <div className="colors">
                  <label>Primary<input type="color" value={f.theme?.primary || '#6366f1'} onChange={(e) => patch({ theme: { ...f.theme, primary: e.target.value } }, true)} /></label>
                  <label>Secondary<input type="color" value={f.theme?.secondary || '#ec4899'} onChange={(e) => patch({ theme: { ...f.theme, secondary: e.target.value } }, true)} /></label>
                </div>
                <h5>Typography & shape <small>· applies to the whole funnel</small></h5>
                <div className="fld"><label>Page language <small className="muted">· buttons, form labels, checkout &amp; booking text</small></label><select value={f.theme?.lang || 'en'} onChange={(e) => patch({ theme: { ...f.theme, lang: e.target.value === 'en' ? undefined : e.target.value } })}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="fld"><label>Heading font</label><select value={f.theme?.headingFont || ''} onChange={(e) => patch({ theme: { ...f.theme, headingFont: e.target.value || undefined } })}><option value="">Style default</option>{Object.entries(FONT_CHOICES).map(([k, v]) => <option key={k} value={k}>{k}{v.indic ? ' · हिन्दी ✓' : ''}</option>)}</select></div>
                <div className="fld"><label>Body font</label><select value={f.theme?.bodyFont || ''} onChange={(e) => patch({ theme: { ...f.theme, bodyFont: e.target.value || undefined } })}><option value="">Style default</option>{Object.entries(FONT_CHOICES).map(([k, v]) => <option key={k} value={k}>{k}{v.indic ? ' · हिन्दी ✓' : ''}</option>)}</select></div>
                <div className="form2c">
                  <div className="fld"><label>Corners</label><select value={f.theme?.radius || ''} onChange={(e) => patch({ theme: { ...f.theme, radius: e.target.value || undefined } })}><option value="">Style default</option><option value="sharp">Sharp</option><option value="soft">Soft</option><option value="round">Round</option><option value="pill">Pill buttons</option></select></div>
                  <div className="fld"><label>Text size</label><select value={f.theme?.textSize || ''} onChange={(e) => patch({ theme: { ...f.theme, textSize: e.target.value || undefined } })}><option value="">Normal</option><option value="sm">Compact</option><option value="lg">Large</option></select></div>
                </div>
                <p className="hint">Fonts marked हिन्दी ✓ also display Hindi and Marathi text beautifully.</p>
                <h5>Quick palettes</h5>
                <div className="palettes">{PALETTES.map(([a, b]) => <button key={a + b} title={`${a} / ${b}`} aria-label={`${a} / ${b}`} style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} onClick={() => patch({ theme: { ...f.theme, primary: a, secondary: b } })} />)}</div>
              </>
            )}
          </div>
        </aside>

        {/* ---------------- canvas ---------------- */}
        <section className="ed-canvas" onClick={() => { setSel(null); setSelEl(null); }}>
          {view === 'flow' ? (
            <div className="flowmap">
              {f.steps.map((s, i) => {
                const offer = s.type === 'upsell' || s.type === 'downsell';
                return (
                  <div className="fm-col" key={s.id}>
                    <button className={`fm-card ${s.id === step.id ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); selectStep(s.id); }}>
                      <span className="fm-ic"><StepIcon type={s.type} size={22} /></span>
                      <b>{s.name}</b><small>/{s.slug}</small>
                      <span className="fm-meta">{s.blocks.length} sections{s.ab?.enabled && ' · A/B test'}</span>
                    </button>
                    {i < f.steps.length - 1 && (offer ? (
                      <div className="fm-branches">
                        <span className="yes">✓ Accept → {nextFor(i, true)?.name || 'end'}</span>
                        <span className="no">✕ Decline → {nextFor(i, false)?.name || 'end'}</span>
                      </div>
                    ) : <div className="fm-arrow">→</div>)}
                  </div>
                );
              })}
              <button className="fm-card add" onClick={(e) => { e.stopPropagation(); setLeft('steps'); setStepMenu(true); }}><Icon name="plus" size={22} /><b>Add step</b></button>
            </div>
          ) : (
            <>
              <div className="cv-bar" onClick={(e) => e.stopPropagation()}>
                {popup ? <>
                  <button className="btn ghost sm" onClick={() => editPopup(null)}><Icon name="chevron" size={13} className="flip" /> Back to page</button>
                  <span className="cv-step">Pop-up: <b>{popup.name}</b></span>
                  <button className="btn soft sm" onClick={() => setPopPreview(popup.id)}><Icon name="eye" size={14} /> Preview pop-up</button>
                  <button className="btn ghost sm" onClick={() => setRight('step')}><Icon name="settings" size={14} /> Pop-up settings</button>
                </> : <span className="cv-step"><StepIcon type={step.type} size={14} /> {step.name}</span>}
                {!popup && (step.popups || []).length > 0 && <div className="seg sm">{step.popups.map((p) => <button key={p.id} title={`Edit the pop-up “${p.name}”`} onClick={() => editPopup(p.id)}>{p.name}</button>)}</div>}
                {abOn && !popup && <div className="seg sm ab"><button className={variant === 'A' ? 'on' : ''} onClick={() => { setVariant('A'); setSel(null); setSelEl(null); }}>Variant A</button><button className={variant === 'B' ? 'on' : ''} onClick={() => { setVariant('B'); setSel(null); setSelEl(null); }}>Variant B</button></div>}
                <span className="muted sm">{blocks.length} sections</span>
              </div>
              <div className={`frame ${dnd.dragging ? 'dragging-any' : ''} ${popup ? `frame-pop pop-${popup.size}` : ''}`} style={{ maxWidth: popup ? `min(${width}, ${{ center: '600px', corner: '420px' }[popup.size] || '100%'})` : width }} data-drop="blocks" onFocusCapture={(e) => pickPiece(e.target)} onClickCapture={(e) => pickPiece(e.target)}>
                {blocks.length === 0 && (
                  <div className={`cv-empty ${dnd.dragging ? 'drag' : ''}`}>
                    <Icon name="layers" size={30} /><b>Drag sections or elements here</b><span>{popup ? 'Opt-in forms, text, images, buttons, a countdown or a video work well in a pop-up' : 'or ask the AI on the right to build this page'}</span>
                  </div>
                )}
                {blocks.map((b, i) => (
                  <div className="blk-item" key={b.id}>
                    {dropAt?.zone === 'blocks' && dropAt.index === i && <div className="drop-line" />}
                    <div data-bid={b.id} className={`wrap ${sel === b.id ? 'sel' : ''} ${sel === b.id && selEl ? 'child-sel' : ''} ${dnd.dragging?.id === b.id ? 'dragging' : ''}`}
                      onClick={(e) => { e.stopPropagation(); setSel(b.id); setSelEl(null); setRight('edit'); }}>
                      <div className="tools" onClick={(e) => e.stopPropagation()}>
                        <span className="handle" onPointerDown={(e) => dnd.start(e, { kind: 'move-block', id: b.id }, BLOCK_TYPES[b.type]?.label)} title="Drag to move"><Icon name="grip" size={13} /></span>
                        <span className="tl"><BlockIcon type={b.type} size={12} /> {BLOCK_TYPES[b.type]?.label || b.type}</span>
                        <button disabled={i === 0} onClick={() => moveBlock(i, i - 1)} title="Move up" aria-label="Move up">↑</button>
                        <button disabled={i === blocks.length - 1} onClick={() => moveBlock(i, i + 2)} title="Move down" aria-label="Move down">↓</button>
                        <button onClick={() => { setSel(b.id); setSelEl(null); setRight('edit'); setMob('right'); }} title="Edit all settings" aria-label="Edit all settings"><Icon name="edit" size={13} /></button>
                        <button onClick={() => dupBlock(b.id)} title="Duplicate" aria-label="Duplicate"><Icon name="copy" size={13} /></button>
                        <button onClick={() => copyBlock(b.id)} title="Copy (paste into any funnel)" aria-label="Copy (paste into any funnel)"><Icon name="clip" size={13} /></button>
                        <button onClick={() => saveToLibrary(b.id)} title="Save to my library" aria-label="Save to my library"><Icon name="bookmark" size={13} /></button>
                        <button onClick={() => removeBlock(b.id)} title="Delete" aria-label="Delete"><Icon name="trash" size={13} /></button>
                      </div>
                      <Page blocks={[b]} theme={f.theme} ctx={blockCtx(b)} />
                    </div>
                  </div>
                ))}
                {dropAt?.zone === 'blocks' && dropAt.index === blocks.length && blocks.length > 0 && <div className="drop-line" />}
                {blocks.length > 0 && <div className={`dz-end ${dnd.dragging && dnd.dragging.kind !== 'step' ? 'show' : ''}`}>Drop here to add at the end</div>}
              </div>
            </>
          )}
        </section>

        {/* ---------------- right ---------------- */}
        <aside className="ed-right">
          <div className="tabs">
            <button className={right === 'ai' ? 'on' : ''} onClick={() => setRight('ai')}><Icon name="sparkles" size={15} /> AI chat</button>
            <button className={right === 'edit' ? 'on' : ''} onClick={() => setRight('edit')}><Icon name="edit" size={15} /> Edit</button>
            <button className={right === 'step' ? 'on' : ''} onClick={() => setRight('step')}><Icon name="settings" size={15} /> Step</button>
          </div>

          {right === 'ai' && (
            <div className="chat">
              <div className="msgs">
                {msgs.map((m, i) => (
                  <div key={i} className={`msg ${m.role}`}>
                    {m.role === 'assistant' && <span className="bot"><Icon name="sparkles" size={13} /></span>}
                    <div className="bubble">
                      <p>{m.content}</p>
                      {m.changes?.length > 0 && <div className="changes">{m.changes.map((c) => <span key={c}><Icon name="check" size={12} /> {c}</span>)}</div>}
                    </div>
                  </div>
                ))}
                {thinking && <div className="msg assistant"><span className="bot"><Icon name="sparkles" size={13} /></span><div className="bubble typing"><i /><i /><i /></div></div>}
                <div ref={chatEnd} />
              </div>
              {msgs.length < 4 && <div className="sugg col">{SUGGEST.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
              <form className="chat-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea rows={2} value={input} placeholder={`Ask anything about “${step.name}”…`} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className="btn primary" disabled={!input.trim() || thinking}><Icon name="send" size={16} /></button>
              </form>
              <p className="hint">{me?.aiEnabled ? `FunnelHive AI${me.aiProvider ? ` · ${me.aiProvider}` : ''} — can rewrite copy and redesign pages.` : 'Offline assistant — structural edits only (copywriting and redesigns turn on with full AI).'}</p>
            </div>
          )}

          {right === 'edit' && (
            <div className="ed-scroll insp">
              {selBlock && selElLoc ? (
                <>
                  <button className="crumb" onClick={() => setSelEl(null)}><Icon name="chevron" size={13} className="flip" /> {BLOCK_TYPES.section.label}</button>
                  <div className="insp-h"><span className="ti-box lg"><ElementIcon type={selElLoc.el.type} size={19} /></span><div><b>{ELEMENT_TYPES[selElLoc.el.type]?.label}</b><small>Column {selElLoc.c + 1} · changes save automatically</small></div>
                    <button className="icon-btn" title="Move up" aria-label="Move up" onClick={() => elAction('up', selBlock.id, selEl)}>↑</button>
                    <button className="icon-btn" title="Move down" aria-label="Move down" onClick={() => elAction('down', selBlock.id, selEl)}>↓</button>
                    <button className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => elAction('dup', selBlock.id, selEl)}><Icon name="copy" size={15} /></button>
                    <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => elAction('del', selBlock.id, selEl)}><Icon name="trash" size={15} /></button>
                  </div>
                  {ELEMENT_TYPES[selElLoc.el.type]?.fields.map((d) => { const ch = (v) => updateEl(selBlock.id, selEl, (e) => ({ ...e, props: { ...e.props, [d[0]]: v } }), true); return isPopupLink(d[0], selElLoc.el.props) ? <PopupPick key={selEl + d[0]} popups={step.popups} value={selElLoc.el.props[d[0]]} onChange={ch} /> : <Field key={selEl + d[0]} def={d} value={selElLoc.el.props[d[0]]} onChange={ch} />; })}
                </>
              ) : selBlock ? (
                <>
                  <div className="insp-h"><span className="ti-box lg"><BlockIcon type={selBlock.type} size={19} /></span><div><b>{BLOCK_TYPES[selBlock.type]?.label}</b><small>Changes save automatically</small></div>
                    <button className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={() => dupBlock(selBlock.id)}><Icon name="copy" size={15} /></button>
                    <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => removeBlock(selBlock.id)}><Icon name="trash" size={15} /></button>
                  </div>
                  {REAL_ONLY.includes(selBlock.type) && <p className="hint">Shows only real numbers — fake urgency is not allowed under Indian e-commerce rules.</p>}
                  {BLOCK_TYPES[selBlock.type]?.fields.filter((d) => linkFieldShown(d[0], selBlock.props) && !(popup && selBlock.type === 'countdown' && d[0] === 'mode')).map((d) => (isPopupLink(d[0], selBlock.props)
                    ? <PopupPick key={selBlock.id + d[0]} popups={step.popups} value={selBlock.props[d[0]]} onChange={(v) => setProp(d[0], v)} />
                    : <Field key={selBlock.id + d[0]} def={d} value={withCopy(selBlock.type, selBlock.props)[d[0]]} onChange={(v) => setProp(d[0], v)} props={selBlock.props} />))}
                  {popup && selBlock.type === 'optin' && <p className="hint">After someone signs up here, the pop-up {popup.after === 'next' ? 'closes and they go to the next step' : 'closes and thanks them'} — change it in Pop-up settings.</p>}
                  {!FLOATING.includes(selBlock.type) && <StylePanel key={`st-${selBlock.id}`} value={selBlock.props._style} onChange={(v) => updateBlock(selBlock.id, (b) => { const props = { ...b.props }; if (v) props._style = v; else delete props._style; return { ...b, props }; }, true)} />}
                  {selBlock.type === 'section' && (
                    <div className="sec-els">
                      <h5>Elements</h5>
                      {selBlock.props.columns.map((c, ci) => (
                        <div key={c.id || ci} className="sec-col">
                          <small>Column {ci + 1}</small>
                          {c.elements.map((e) => <button key={e.id} className="el-chip" onClick={() => setSelEl(e.id)}><ElementIcon type={e.type} size={12} /> {ELEMENT_TYPES[e.type]?.label}</button>)}
                          {!c.elements.length && <span className="muted sm">Empty — drag elements in</span>}
                        </div>
                      ))}
                      <p className="hint">Click an element on the page to edit it. Drag elements between columns, or from <b>Add → Elements</b>.</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="insp-empty">
                  <Icon name="edit" size={26} />
                  <b>Click any section to edit it</b>
                  <p>Every word, price, colour and timer is editable. Tips:</p>
                  <ul><li><b>Click any heading or paragraph on the page</b> to type over it</li><li>Drag sections and elements from <b>Add</b> onto the page</li><li><kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo</li><li><kbd>Del</kbd> removes the selection</li><li>Wrap words in <code>*stars*</code> to highlight them</li></ul>
                </div>
              )}
            </div>
          )}

          {right === 'step' && (
            <div className="ed-scroll insp">
              <div className="fld"><label>Step name</label><input value={step.name} onChange={(e) => patchStep({ name: e.target.value }, true)} /></div>
              <div className="fld"><label>Step type</label><select value={step.type} onChange={(e) => patchStep({ type: e.target.value })}>{Object.entries(STEP_TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></div>
              <div className="fld"><label>URL</label><div className="urlrow"><span>/f/{f.slug}/</span><input value={step.slug} onChange={(e) => patchStep({ slug: slugify(e.target.value) }, true)} /></div></div>
              <h5>SEO</h5>
              <div className="fld"><label>Page title</label><input value={step.seo?.title || ''} placeholder={`${step.name} · ${f.name}`} onChange={(e) => patchStep({ seo: { ...step.seo, title: e.target.value } }, true)} /></div>
              <div className="fld"><label>Meta description</label><textarea rows={3} value={step.seo?.description || ''} onChange={(e) => patchStep({ seo: { ...step.seo, description: e.target.value } }, true)} /></div>
              {/* checkout, upsell, downsell and thank-you pages are always hidden (they only make sense mid-purchase) */}
              {MID_FUNNEL.includes(step.type) || f.seo?.noindex
                ? <label className="tog"><input type="checkbox" checked disabled /><span />Hidden from search engines<small className="hint"> · {f.seo?.noindex ? 'the whole funnel is hidden' : 'always, for this kind of page'}</small></label>
                : <label className="tog"><input type="checkbox" checked={!!step.seo?.noindex} onChange={(e) => patchStep({ seo: { ...step.seo, noindex: e.target.checked } })} /><span />Hide this page from search engines</label>}
              {['upsell', 'downsell', 'thankyou'].includes(step.type) && f.steps.indexOf(step) > 0 && (<>
                <h5>Who can open this page</h5>
                <label className="tog"><input type="checkbox" checked={!step.open} onChange={(e) => patchStep({ open: !e.target.checked })} /><span />Only people who bought (or signed up) in this funnel</label>
                <p className="hint">{step.open ? 'Anyone with the link can open this page — fine for a page with nothing private on it.' : 'Someone who opens the link without buying is sent back to the start, so a shared link never gives away your bonus, download link or group invite.'}</p>
              </>)}
              <h5>Pop-ups <small>· {(step.popups || []).length} of {POPUP_MAX}</small></h5>
              <p className="hint">Each pop-up is built from sections like the page. Visitors can always close it, and nobody who has already signed up sees it again.</p>
              {(step.popups || []).map((p, i) => {
                const set = (k, v, group) => setPopups((list) => list.map((x) => (x.id === p.id ? { ...x, [k]: v } : x)), group);
                const tt = p.trigger?.type || 'exit';
                return (
                  <div className={`li popi ${p.id === popupId ? 'on' : ''}`} key={p.id}>
                    <div className="li-h"><span>#{i + 1}</span><span className="row">
                      <button className="icon-btn xs" title="Preview" aria-label={`Preview ${p.name}`} onClick={() => setPopPreview(p.id)}><Icon name="eye" size={12} /></button>
                      <button className="icon-btn xs danger" title="Delete pop-up" aria-label={`Delete ${p.name}`} onClick={async () => { if (!await confirmDialog({ title: `Delete the pop-up “${p.name}”?`, confirm: 'Delete', danger: true })) return; if (popupId === p.id) editPopup(null); setPopups((list) => list.filter((x) => x.id !== p.id)); }}><Icon name="trash" size={12} /></button>
                    </span></div>
                    <div className="fld"><label>Name</label><input value={p.name} maxLength={60} onChange={(e) => set('name', e.target.value, true)} /></div>
                    <div className="fld"><label>Shape</label><select value={p.size || 'center'} onChange={(e) => set('size', e.target.value)}>{POPUP_SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                    <div className="fld"><label>Show it</label><select value={tt} onChange={(e) => set('trigger', { type: e.target.value, ...(e.target.value === 'delay' ? { value: 10 } : e.target.value === 'scroll' ? { value: 50 } : {}) })}>{POPUP_TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      {tt === 'exit' && <span className="hint">Computers: when the mouse heads for the tab bar. Phones: a quick scroll back up after reading.</span>}
                      {tt === 'click' && <span className="hint">Set any button’s action to “Open a pop-up” and pick this one.</span>}
                    </div>
                    {tt === 'delay' && <div className="fld"><label>Seconds after the page opens</label><input type="number" min="0" max="600" value={p.trigger?.value ?? 10} onChange={(e) => set('trigger', { type: 'delay', value: Number(e.target.value) }, true)} /></div>}
                    {tt === 'scroll' && <div className="fld"><label>After scrolling this much of the page (%)</label><input type="number" min="0" max="100" value={p.trigger?.value ?? 50} onChange={(e) => set('trigger', { type: 'scroll', value: Number(e.target.value) }, true)} /></div>}
                    <div className="fld"><label>How often</label><select value={p.frequency || 'session'} onChange={(e) => set('frequency', e.target.value)}>{POPUP_FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                    <div className="fld"><label>After someone signs up in it</label><select value={p.after || 'message'} onChange={(e) => set('after', e.target.value)}><option value="message">Close it and say thank you</option><option value="next">Close it and go to the next step</option></select></div>
                    {(p.after || 'message') === 'message' && <div className="fld"><label>Thank-you text</label><input value={p.thanks || ''} maxLength={300} placeholder="Thank you! Check your inbox." onChange={(e) => set('thanks', e.target.value, true)} /></div>}
                    <button className={`btn ${p.id === popupId ? 'primary' : 'soft'} sm block`} onClick={() => editPopup(p.id === popupId ? null : p.id)}><Icon name="edit" size={14} /> {p.id === popupId ? 'Back to the page' : 'Design this pop-up'}</button>
                  </div>
                );
              })}
              {(step.popups || []).length < POPUP_MAX && <button className="btn ghost sm block" onClick={() => { const np = newPopup((step.popups || []).length + 1); setPopups((list) => [...list, np].slice(0, POPUP_MAX)); editPopup(np.id); }}><Icon name="plus" size={14} /> Add a pop-up</button>}
              <h5>A/B split test</h5>
              <label className="tog"><input type="checkbox" checked={abOn} onChange={(e) => { patchStep({ ab: e.target.checked ? { enabled: true, split: 50, blocks: step.ab?.blocks || step.blocks.map(freshIds) } : { ...step.ab, enabled: false } }); setVariant(e.target.checked ? 'B' : 'A'); }} /><span />Test two versions of this page</label>
              {abOn && (
                <div className="abbox">
                  <label>Traffic to variant B: <b>{step.ab.split}%</b><input type="range" min="10" max="90" step="5" value={step.ab.split} onChange={(e) => patchStep({ ab: { ...step.ab, split: Number(e.target.value) } }, true)} /></label>
                  <p className="hint">Edit Variant B on the canvas (toggle above the page). Results appear in Analytics.</p>
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => { patchStep({ ab: { ...step.ab, enabled: false } }); setVariant('A'); toast('Kept variant A'); }}>Keep A</button>
                    <button className="btn ghost sm" onClick={() => { patchStep({ blocks: step.ab.blocks, ab: { ...step.ab, enabled: false } }); setVariant('A'); toast('Variant B is now the page'); }}>Make B the winner</button>
                  </div>
                </div>
              )}
              <h5>Funnel</h5>
              <LegalPanel key={f.id} f={f} onSaved={(legal) => setF((x) => { const n = { ...x }; if (legal) n.legal = legal; else delete n.legal; return n; })} />
              <TrackingPanel key={`t-${f.id}`} f={f} />
              <label className="tog"><input type="checkbox" checked={!!f.seo?.noindex} onChange={async (e) => { try { const r = await api(`/funnels/${f.id}/seo`, 'PUT', { noindex: e.target.checked }); setF((x) => { const n = { ...x }; if (r.seo) n.seo = r.seo; else delete n.seo; return n; }); } catch (err) { toast(err.message); } }} /><span />Hide the whole funnel from search engines</label>
              <h5>Danger zone</h5>
              <div className="row"><button className="btn ghost sm" onClick={dupStep}><Icon name="copy" size={14} /> Duplicate step</button><button className="btn ghost sm danger" onClick={delStep} disabled={f.steps.length < 2}><Icon name="trash" size={14} /> Delete step</button></div>
            </div>
          )}
        </aside>
      </div>
      <nav className="ed-mobbar">
        <button className={mob === 'left' && left === 'steps' ? 'on' : ''} onClick={() => { setLeft('steps'); setMob(mob === 'left' && left === 'steps' ? 'canvas' : 'left'); }}><Icon name="funnel" size={18} />Steps</button>
        <button className={mob === 'left' && left === 'add' ? 'on' : ''} onClick={() => { setLeft('add'); setMob(mob === 'left' && left === 'add' ? 'canvas' : 'left'); }}><Icon name="plus" size={18} />Add</button>
        <button className={mob === 'canvas' ? 'on' : ''} onClick={() => setMob('canvas')}><Icon name="layers" size={18} />Page</button>
        <button className={mob === 'right' && right === 'edit' ? 'on' : ''} onClick={() => { setRight('edit'); setMob(mob === 'right' && right === 'edit' ? 'canvas' : 'right'); }}><Icon name="edit" size={18} />Edit</button>
        <button className={mob === 'right' && right === 'ai' ? 'on' : ''} onClick={() => { setRight('ai'); setMob(mob === 'right' && right === 'ai' ? 'canvas' : 'right'); }}><Icon name="sparkles" size={18} />AI</button>
      </nav>
    </div>
  );
}
