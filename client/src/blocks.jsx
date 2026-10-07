import { useEffect, useRef, useState } from 'react';
import { ensureFonts, FONT_CHOICES } from './fonts';
import { GripVertical, Copy as CopyIcon, Trash2 } from 'lucide-react';

export const STYLES = {
  aurora: 'Aurora — light, soft gradients',
  midnight: 'Midnight — dark, glowing',
  luxe: 'Luxe — serif, premium',
  fresh: 'Fresh — soft & friendly',
  bold: 'Bold — high contrast',
  clean: 'Clean — minimal',
  editorial: 'Editorial — magazine, black & white',
  organic: 'Organic — warm, earthy, handmade',
  tech: 'Tech — dark, neon, monospace',
  playful: 'Playful — bright & chunky',
  royal: 'Royal — jewel tones & gold',
};

const T = 'text', LONG = 'long', NUM = 'number', B = 'bool', L = 'list';
const HL = 'Wrap words in *stars* to highlight them';

// Field schema drives the editor's inspector: [key, kind, listSubKeys, hint]
export const BLOCK_TYPES = {
  section: { label: 'Custom section', fields: [['layout', 'select', [['1', 'One column'], ['1-1', 'Two equal columns'], ['2-1', 'Wide + narrow'], ['1-2', 'Narrow + wide'], ['1-1-1', 'Three columns'], ['1-1-1-1', 'Four columns']]], ['valign', 'select', [['top', 'Align to top'], ['center', 'Align to middle']]], ['gap', 'select', [['sm', 'Tight spacing'], ['md', 'Normal spacing'], ['lg', 'Roomy spacing']]]], defaults: { layout: '1', valign: 'top', gap: 'md', columns: [{ id: 'c1', elements: [] }] } },
  hero: { label: 'Hero', fields: [['badge', T], ['headline', LONG, null, HL], ['subheadline', LONG], ['ctaText', T], ['ctaAction', 'select', [['next', 'Go to the next step'], ['url', 'Open a link'], ['scroll', 'Scroll to a section']]], ['ctaUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['ctaNewTab', B, null, 'Open the link in a new tab'], ['secondaryText', T], ['secondaryUrl', T, null, 'Where the small link goes — a section id (default: how-it-works) or https://…'], ['socialText', T], ['rating', NUM], ['reviews', T], ['image', T, null, 'Optional image URL — replaces the product card'], ['cardEmoji', T], ['cardTitle', T], ['cardPrice', T], ['cardMrp', T], ['cardPoints', L, ['text']], ['chip1', T], ['chip2', T], ['cardTag', T, null, 'Small label on the product card'], ['showCard', B, null, 'Show the product card (when there is no image)'], ['showTrust', B, null, 'Show the avatars & rating row']], defaults: { badge: '⭐ Rated 4.9 by 10,000+ customers', headline: 'Your big promise — *the result they want*', subheadline: 'One sentence that makes the reader want it.', ctaText: 'Get Started', secondaryText: 'See how it works', socialText: 'Loved by 10,000+ customers', rating: 4.9, reviews: '2,300', image: '', cardEmoji: '🚀', cardTitle: 'Your Product', cardPrice: '₹499', cardMrp: '₹1,999', cardPoints: [{ text: 'Key benefit one' }, { text: 'Key benefit two' }], chip1: '🔥 120 joined today', chip2: '🔒 Secure payment' } },
  stats: { label: 'Stats strip', fields: [['items', L, ['value', 'label']]], defaults: { items: [{ value: '10,000+', label: 'happy customers' }, { value: '4.9★', label: 'rating' }, { value: '200+', label: 'cities' }, { value: '95%', label: 'satisfaction' }] } },
  problem: { label: 'Pain points', fields: [['eyebrow', T], ['title', T], ['subtitle', T], ['items', L, ['text']], ['closing', T]], defaults: { eyebrow: 'Sound familiar?', title: 'You are not alone if…', subtitle: '', items: [{ text: 'Problem one' }, { text: 'Problem two' }, { text: 'Problem three' }], closing: 'There is a better way 👇' } },
  features: { label: 'Features', fields: [['eyebrow', T], ['title', T], ['subtitle', T], ['items', L, ['icon', 'title', 'text']]], defaults: { eyebrow: 'The solution', title: 'Why you will love it', subtitle: '', items: [{ icon: '⚡', title: 'Benefit one', text: 'Describe it.' }, { icon: '🎯', title: 'Benefit two', text: 'Describe it.' }] } },
  steps: { label: 'How it works', fields: [['eyebrow', T], ['title', T], ['items', L, ['title', 'text']]], defaults: { eyebrow: 'How it works', title: 'Get started in 3 simple steps', items: [{ title: 'Sign up', text: 'Takes 2 minutes' }, { title: 'Get access', text: 'Instantly' }, { title: 'See results', text: 'Fast' }] } },
  compare: { label: 'Comparison', fields: [['eyebrow', T], ['title', T], ['leftTitle', T], ['rightTitle', T], ['rows', L, ['left', 'right']], ['tag', T, null, 'Label on the highlighted column']], defaults: { eyebrow: 'Why us', title: 'The difference is clear', leftTitle: 'Others', rightTitle: 'Us', rows: [{ left: 'Slow', right: 'Fast' }] } },
  testimonials: { label: 'Testimonials', fields: [['eyebrow', T], ['title', T], ['items', L, ['name', 'quote', 'tag']]], defaults: { eyebrow: 'Success stories', title: 'What people say', items: [{ name: 'Happy Customer, Pune', quote: 'Amazing results!', tag: 'Verified' }] } },
  mentor: { label: 'Expert / About', fields: [['eyebrow', T], ['name', T], ['role', T], ['bio', LONG], ['image', T], ['points', L, ['text']], ['badge', T, null, 'Badge on the photo']], defaults: { eyebrow: 'Meet your expert', name: 'Expert Name', role: 'Title · 10 years', bio: 'Short credibility-building bio.', image: '', points: [{ text: '10,000+ students' }] } },
  bonuses: { label: 'Bonus stack', fields: [['eyebrow', T], ['title', T], ['items', L, ['icon', 'title', 'value']], ['totalText', T], ['freeLabel', T, null, 'Corner tag on each bonus'], ['itemLabel', T, null, 'Numbered label, e.g. "Bonus #"'], ['worthLabel', T, null, 'Text before the value']], defaults: { eyebrow: 'Exclusive bonuses', title: 'Order today and get these FREE', items: [{ icon: '🎁', title: 'Bonus one', value: '₹999' }], totalText: 'Total value: ₹999 — free today' } },
  guarantee: { label: 'Guarantee', fields: [['title', T], ['body', LONG], ['days', NUM, null, '0 shows a "100% free" seal'], ['showSeal', B, null, 'Show the seal']], defaults: { title: '7-Day Money-Back Guarantee', body: 'Try it risk-free.', days: 7 } },
  video: { label: 'Video', fields: [['url', T, null, 'YouTube (incl. Shorts), Vimeo, Loom, Google Drive or an .mp4 link']], defaults: { url: '' } },
  image: { label: 'Image', fields: [['src', T], ['alt', T, null, 'Describe the image — helps SEO and screen readers'], ['caption', T], ['link', T, null, 'Optional: make the image a link'], ['width', 'select', [['narrow', 'Narrow'], ['normal', 'Normal'], ['full', 'Full width']]], ['rounded', B], ['shadow', B]], defaults: { src: '', alt: '', caption: '', link: '', width: 'normal', rounded: true, shadow: false } },
  gallery: { label: 'Image gallery', fields: [['eyebrow', T], ['title', T], ['columns', 'select', [['2', '2 per row'], ['3', '3 per row'], ['4', '4 per row']]], ['items', 'gallery', ['src', 'caption']]], defaults: { eyebrow: '', title: 'See it for yourself', columns: '3', items: [] } },
  spacer: { label: 'Spacer', fields: [['height', NUM, null, 'Height in pixels']], defaults: { height: 48 } },
  divider: { label: 'Divider', fields: [['style', 'select', [['line', 'Solid line'], ['dashed', 'Dashed'], ['dots', 'Dots']]]], defaults: { style: 'line' } },
  html: { label: 'Custom code / embed', fields: [['code', 'code', null, 'Paste HTML or an embed code (Calendly, Typeform, Google Maps, Razorpay button…). It runs in a secure sandbox.'], ['height', NUM, null, '0 = size automatically'], ['title', T, null, 'Short description for screen readers']], defaults: { code: '', height: 0, title: 'Embedded content' } },
  form: { label: 'Form', fields: [['title', T], ['subtitle', T], ['fields', 'formfields'], ['buttonText', T], ['after', 'select', [['message', 'Show a thank-you message'], ['next', 'Go to the next step']]], ['successMessage', T], ['note', T]], defaults: { title: 'Tell us about yourself', subtitle: 'We’ll get back to you within 24 hours.', fields: [{ label: 'Full name', type: 'text', required: true }, { label: 'Email', type: 'email', required: true }, { label: 'WhatsApp number', type: 'tel', required: false }, { label: 'What do you need help with?', type: 'select', options: 'Getting started, Pricing, Something else', required: false }], buttonText: 'Send', after: 'message', successMessage: 'Thank you! We’ll be in touch shortly.', note: '🔒 We never share your details.' } },
  text: { label: 'Text', fields: [['title', T], ['body', LONG]], defaults: { title: 'Heading', body: 'Your copy here.' } },
  countdown: { label: 'Countdown', fields: [['label', T], ['minutes', NUM]], defaults: { label: 'Offer ends in', minutes: 15 } },
  optin: { label: 'Opt-in form', fields: [['eyebrow', T], ['title', T], ['subtitle', T], ['buttonText', T], ['askPhone', B], ['points', L, ['text']], ['nameLabel', T], ['emailLabel', T], ['phoneLabel', T], ['secureText', T]], defaults: { eyebrow: '100% free', title: 'Get the free guide', subtitle: 'Enter your details to get instant access.', buttonText: 'Send it to me', askPhone: true, points: [] } },
  checkout: { label: 'Checkout', fields: [['productName', T], ['description', T], ['price', NUM], ['mrp', NUM], ['currency', T], ['bumpEnabled', B], ['bumpTitle', T], ['bumpDescription', T], ['bumpPrice', NUM], ['buttonText', T], ['step1', T, null, 'Heading above the details'], ['step2', T, null, 'Heading above payment methods'], ['secureText', T], ['summaryTitle', T], ['perks', L, ['text']]], defaults: { productName: 'My Product', description: 'Instant access', price: 499, mrp: 1999, currency: '₹', bumpEnabled: true, bumpTitle: 'Add the bonus pack', bumpDescription: 'Extra templates and checklists.', bumpPrice: 99, buttonText: 'Pay Securely' } },
  offer: { label: 'Upsell / downsell offer', fields: [['progress', T], ['headline', LONG, null, HL], ['description', LONG], ['productName', T], ['emoji', T], ['price', NUM], ['mrp', NUM], ['currency', T], ['bullets', L, ['text']], ['minutes', NUM, null, 'Offer timer — 0 hides it'], ['acceptText', T], ['declineText', T], ['tag', T, null, 'Label on the product card'], ['oneClickText', T]], defaults: { progress: 'Step 2 of 3 · Customise your order', headline: 'Wait! Add the *VIP upgrade* to your order', description: 'One click adds it — no need to re-enter payment details.', productName: 'VIP Upgrade', emoji: '👑', price: 999, mrp: 2999, currency: '₹', bullets: [{ text: 'Personal 1-on-1 support' }, { text: 'Advanced resources' }], minutes: 10, acceptText: 'Yes! Add it to my order', declineText: 'No thanks' } },
  crosssell: { label: 'Cross-sells', fields: [['title', T], ['subtitle', T], ['eyebrow', T], ['items', L, ['emoji', 'name', 'desc', 'price']], ['buttonText', T]], defaults: { title: 'Customers also bought', subtitle: 'Add these to your order with one click.', items: [{ emoji: '📚', name: 'Advanced Masterclass', desc: 'Go deeper with expert sessions.', price: 499 }, { emoji: '🧾', name: 'Templates Pack', desc: 'Ready-to-use resources.', price: 299 }], buttonText: 'Add to my order' } },
  pricing: { label: 'Pricing box', fields: [['badge', T], ['title', T], ['mrp', NUM], ['price', NUM], ['currency', T], ['bullets', L, ['text']], ['buttonText', T], ['buttonAction', 'select', [['next', 'Go to the next step'], ['url', 'Open a link'], ['scroll', 'Scroll to a section']]], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab'], ['note', T], ['priceNote', T, null, 'Line under the price'], ['payMethods', T, null, 'Payment badges, separated by ·']], defaults: { badge: 'Limited-time offer', title: 'Your Product', mrp: 1999, price: 499, currency: '₹', bullets: [{ text: 'Everything included' }], buttonText: 'Enroll Now', note: '🔒 Secure checkout' } },
  faq: { label: 'FAQ', fields: [['eyebrow', T], ['title', T], ['items', L, ['q', 'a']]], defaults: { eyebrow: 'FAQ', title: 'Questions? We have answers.', items: [{ q: 'Question?', a: 'Answer.' }] } },
  cta: { label: 'Final call to action', fields: [['headline', T], ['subheadline', T], ['buttonText', T], ['buttonAction', 'select', [['next', 'Go to the next step'], ['url', 'Open a link'], ['scroll', 'Scroll to a section']]], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab'], ['note', T]], defaults: { headline: 'Ready to start?', subheadline: '', buttonText: 'Get Started', note: '' } },
  thankyou: { label: 'Thank you', fields: [['headline', T], ['body', LONG], ['steps', L, ['text']]], defaults: { headline: 'Thank you! 🎉', body: 'Check your email.', steps: [] } },
  // ---- FOMO blocks (each refreshes every 9–10 seconds) ----
  hellobar: { label: 'FOMO: Hello bar', fields: [['messages', L, ['text']]], defaults: { messages: [{ text: '🔥 Flash sale: flat 75% OFF today only' }, { text: '⏰ Offer ends tonight — hurry!' }] } },
  livecount: { label: 'FOMO: Live viewers', fields: [['text', T], ['min', NUM], ['max', NUM]], defaults: { text: 'people are viewing this page right now', min: 24, max: 68 } },
  stock: { label: 'FOMO: Seats / stock left', fields: [['label', T, null, '{n} is replaced by the live number'], ['total', NUM], ['left', NUM]], defaults: { label: 'Only {n} seats left at this price!', total: 50, left: 11 } },
  proof: { label: 'FOMO: Social proof popup', fields: [['action', T], ['intervalSec', NUM], ['items', L, ['name', 'city']]], defaults: { action: 'just enrolled', intervalSec: 9, items: [{ name: 'Rahul S.', city: 'Pune' }, { name: 'Priya M.', city: 'Delhi' }] } },
  exitpopup: { label: 'FOMO: Exit-intent popup', fields: [['title', T], ['body', T], ['code', T], ['buttonText', T]], defaults: { title: 'Wait! Don’t go yet', body: 'Grab an extra 10% OFF on your order.', code: 'STAY10', buttonText: 'Claim my discount' } },
  stickybar: { label: 'Sticky buy bar', fields: [['text', T], ['price', T], ['buttonText', T], ['buttonAction', 'select', [['next', 'Go to the next step'], ['url', 'Open a link'], ['scroll', 'Scroll to a section']]], ['buttonUrl', T, null, 'https://…, WhatsApp (https://wa.me/…), tel:… or mailto:… — or a section id like pricing'], ['buttonNewTab', B, null, 'Open the link in a new tab']], defaults: { text: 'Offer ends soon', price: '₹499', buttonText: 'Buy Now' } },
  whatsapp: { label: 'WhatsApp chat button', fields: [['number', T, null, 'Leave 919999999999 to use the Support WhatsApp from Settings'], ['message', T], ['label', T]], defaults: { number: '919999999999', message: 'Hi! I have a question.', label: 'Chat with us' } },
};

// Every main section has several designs. The first one is the original look (also used when unset).
export const VARIANTS = {
  hero: [['split', 'Split — copy and product card'], ['center', 'Centred — big headline'], ['banner', 'Banner — full colour or photo'], ['editorial', 'Editorial — magazine style']],
  stats: [['strip', 'Strip'], ['cards', 'Tiles'], ['band', 'Colour band']],
  problem: [['cards', 'Cards'], ['list', 'Crossed-out list'], ['split', 'Title beside the list']],
  features: [['cards', 'Cards, 2 columns'], ['grid', 'Icon grid, 3 columns'], ['list', 'Checklist beside the title'], ['zigzag', 'Big numbered rows']],
  steps: [['columns', 'Columns'], ['timeline', 'Timeline'], ['cards', 'Numbered cards']],
  compare: [['columns', 'Two columns'], ['table', 'Table']],
  testimonials: [['cards', 'Cards'], ['spotlight', 'Spotlight — one big quote'], ['wall', 'Wall of love'], ['chat', 'WhatsApp chats']],
  mentor: [['split', 'Photo and bio'], ['story', 'Founder story'], ['card', 'Centred card']],
  bonuses: [['dark', 'Dark band'], ['light', 'Light cards']],
  guarantee: [['box', 'Box with seal'], ['strip', 'Slim strip']],
  pricing: [['card', 'Single card'], ['split', 'What’s included + price']],
  faq: [['accordion', 'Accordion'], ['two', 'Two columns']],
  cta: [['banner', 'Gradient banner'], ['plain', 'Plain and centred']],
};
for (const [type, list] of Object.entries(VARIANTS)) BLOCK_TYPES[type].fields.unshift(['variant', 'select', list, 'Layout of this section']);
const vOf = (type, p) => (VARIANTS[type]?.some(([k]) => k === p.variant) ? p.variant : VARIANTS[type]?.[0][0]);

export const BLOCK_GROUPS = [
  ['Essentials', ['section', 'hero', 'text', 'image', 'gallery', 'video', 'stats', 'cta', 'spacer', 'divider', 'html']],
  ['Persuasion', ['problem', 'features', 'steps', 'compare', 'testimonials', 'mentor', 'bonuses', 'guarantee', 'faq']],
  ['Sell', ['pricing', 'optin', 'form', 'checkout', 'offer', 'crosssell', 'thankyou']],
  ['FOMO & urgency', ['hellobar', 'countdown', 'livecount', 'stock', 'proof', 'exitpopup', 'stickybar', 'whatsapp']],
];
export const BLOCK_ICONS = { section: '🧱', image: '🖼️', gallery: '🎞️', spacer: '↕️', divider: '➖', html: '🧩', form: '🗒️', hero: '🦸', text: '📝', video: '🎬', stats: '📊', cta: '📣', problem: '😣', features: '✨', steps: '🪜', compare: '⚖️', testimonials: '💬', mentor: '🧑‍🏫', bonuses: '🎁', guarantee: '🛡️', faq: '❓', pricing: '💰', optin: '📧', checkout: '💳', offer: '⬆️', crosssell: '🛍️', thankyou: '🎉', hellobar: '📢', countdown: '⏳', livecount: '👀', stock: '📦', proof: '🔔', exitpopup: '🚪', stickybar: '📌', whatsapp: '💚' };

// Text that used to be fixed in the design. Kept as defaults so existing pages look the same,
// but every piece can now be edited or removed (empty string = removed).
export const COPY = {
  hero: { cardTag: 'Bestseller', showCard: true, showTrust: true },
  compare: { tag: 'Recommended' },
  mentor: { badge: '✔ Verified' },
  bonuses: { freeLabel: 'FREE', itemLabel: 'Bonus #', worthLabel: 'Worth' },
  guarantee: { showSeal: true },
  pricing: { priceNote: 'One-time payment · Lifetime value', payMethods: 'UPI · GPay · PhonePe · Paytm · Visa · RuPay · NetBanking' },
  optin: { nameLabel: 'Full name', emailLabel: 'Email', phoneLabel: 'WhatsApp number', secureText: '🔒 Your information is 100% safe. No spam, ever.' },
  checkout: { step1: 'Your details', step2: 'Payment method', secureText: '🔒 256-bit SSL secured · UPI, cards, netbanking & wallets', summaryTitle: 'Order summary', perks: [{ text: 'Instant confirmation on email & WhatsApp' }, { text: '7-day money-back guarantee' }, { text: 'Trusted by thousands across India' }] },
  offer: { tag: '⚡ One-time offer', oneClickText: '✓ One click — we’ll use the payment details you just entered' },
  crosssell: { eyebrow: 'Recommended for you' },
};
export const withCopy = (type, props = {}) => (COPY[type] ? { ...JSON.parse(JSON.stringify(COPY[type])), ...props } : props);

// ---------- helpers ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const pad = (n) => String(n).padStart(2, '0');
const money = (c, n) => `${c || '₹'}${Number(n || 0).toLocaleString('en-IN')}`;
const rich = (s = '') => String(s).split(/\*(.+?)\*/g).map((x, i) => (i % 2 ? <span className="hl" key={i}>{x}</span> : x));
const initials = (name = '') => name.replace(/^(Dr|Mr|Mrs|Ms|Ar|Pt|CA)\.?\s+/i, '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avColor = (s = '') => `hsl(${[...s].reduce((h, c) => h + c.charCodeAt(0) * 7, 0) % 360} 65% 52%)`;
const go = (ctx) => () => ctx.live && ctx.onNext();

// Inline-editable text. In the editor (ctx.editable) the text becomes contentEditable;
// on focus *highlight* markers are shown raw so they can be edited, on blur the value is saved.
// The typed text, not the displayed text: innerText would apply CSS (e.g. uppercase buttons) to what we save
const readText = (el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  c.querySelectorAll('div, p').forEach((n) => n.prepend('\n'));
  return c.textContent;
};
const caretToEnd = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
function E({ ctx, k, v, as: Tag = 'span', className, isRich, multiline, style, num, fmt, keep }) {
  const [n, setN] = useState(0);
  if ((v === '' || v == null) && !keep) return null; // removed
  const content = isRich ? rich(v) : fmt ? fmt(v) : v;
  if (!ctx?.editable) return <Tag className={className} style={style}>{content}</Tag>;
  return (
    <Tag
      key={n}
      data-k={k}
      data-keep={keep ? '1' : undefined}
      className={`${className || ''} ed-text`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={`Type ${k}…`}
      onFocus={(e) => { if (isRich || fmt) { e.currentTarget.innerText = v ?? ''; caretToEnd(e.currentTarget); } }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.currentTarget.innerText = v || ''; e.currentTarget.blur(); }
      }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
      onBlur={(e) => {
        const val = readText(e.currentTarget).replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (num) {
          // prices: keep digits only; ignore an empty or invalid entry
          const digits = val.replace(/[^\d.]/g, '');
          const nv = Number(digits);
          if (digits !== '' && Number.isFinite(nv) && nv !== Number(v)) ctx.onEdit?.(k, nv);
        } else if (val !== (v || '')) ctx.onEdit?.(k, val);
        setN((x) => x + 1); // remount so React renders the saved value cleanly
      }}
    >{content}</Tag>
  );
}


// Calls fn on a random 9–10 second cadence (the FOMO refresh interval)
function useTick(fn, active = true, minMs = 9000, maxMs = 10000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let t;
    const loop = () => { t = setTimeout(() => { ref.current(); loop(); }, rnd(minMs, maxMs)); };
    loop();
    return () => clearTimeout(t);
  }, [active, minMs, maxMs]);
}

// Where a built-in button goes: the next funnel step (default), a link, or a section on this page
const smoothTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
export function buttonLink(action, url, newTab) {
  const u = String(url || '').trim();
  if (action === 'url') { const h = safeHref(u); if (!h) return null; return h.startsWith('#') ? { scroll: cleanAnchor(h.slice(1)) } : { href: h, newTab: !!newTab }; }
  if (action === 'scroll' && u) { const id = cleanAnchor(u.replace(/^#/, '')); return id ? { scroll: id } : null; }
  return null;
}
const Btn = ({ children, big, block, onClick, type = 'button', disabled, ctx, k, link }) => {
  const cls = `btn ${big ? 'big' : ''} ${block ? 'block' : ''}`;
  if ((children === '' || children == null) && type !== 'submit') return null;
  if (children === '' || children == null) children = 'Submit';
  if (ctx?.editable && k) return <div className={cls} role="button"><E ctx={ctx} k={k} v={children} /><span className="arr">→</span></div>;
  if (link?.href) {
    return (
      <a className={cls} href={link.href} {...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        onClick={(e) => { if (ctx && !ctx.live) e.preventDefault(); else ctx?.onLinkClick?.(link.href); }}>
        <span>{children}</span><span className="arr">→</span>
      </a>
    );
  }
  if (link?.scroll) {
    return (
      <a className={cls} href={`#${link.scroll}`} onClick={(e) => { e.preventDefault(); smoothTo(link.scroll); }}>
        <span>{children}</span><span className="arr">→</span>
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} className={cls} onClick={onClick}>
      <span>{children}</span><span className="arr">→</span>
    </button>
  );
};
const Sec = ({ type, className = '', id, children, v }) => (
  <section id={id} className={`sec sec-${type} ${v ? `v-${v}` : ''} ${className}`}><div className="in">{children}</div></section>
);
const Head = ({ eyebrow, title, subtitle, left, ctx }) => (eyebrow || title ? (
  <div className={`sh ${left ? '' : 'c'}`}>
    {eyebrow && <E ctx={ctx} k="eyebrow" v={eyebrow} className="eyebrow" />}
    {title && <E ctx={ctx} k="title" v={title} as="h2" isRich />}
    {subtitle && <E ctx={ctx} k="subtitle" v={subtitle} as="p" className="sub" />}
  </div>
) : null);
const Placeholder = ({ children }) => <div className="fomo-ph">{children}</div>;
// Popups and bars float over the live page; in the editor / previews they're shown in place, as visitors see them
const FloatPreview = ({ label, hint, children }) => (
  <div className="fp"><div className="fp-h"><b>{label}</b><small>{hint}</small></div><div className="fp-body">{children}</div></div>
);
const Avatar = ({ name, size }) => <span className="av" style={{ background: avColor(name), width: size, height: size }}>{initials(name)}</span>;

// ---------- sections ----------
function Hero({ p, ctx }) {
  const link = buttonLink(p.ctaAction, p.ctaUrl, p.ctaNewTab);
  const sec = buttonLink(/^(https?:|mailto:|tel:)/i.test(p.secondaryUrl || '') ? 'url' : 'scroll', p.secondaryUrl || 'how', p.ctaNewTab);
  const v = vOf('hero', p);
  const banner = v === 'banner' && p.image;
  const solo = !((p.image && !banner) || p.showCard !== false || p.chip1 || p.chip2);
  return (
    <section className={`sec sec-hero v-${v}`} style={banner ? { '--hero-img': `url("${String(mediaUrl(p.image)).replace(/"/g, '%22')}")` } : undefined}>
      {banner && <div className="hero-photo" aria-hidden="true" />}
      <div className={`in hero-grid ${solo ? 'solo' : ''}`}>
        <div className="hero-copy">
          {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="badge" />}
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="lead" multiline />
          <div className="hero-ctas">
            {p.ctaText && <Btn big onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>}
            {p.secondaryText && <a className="link-arrow" href={ctx.editable ? undefined : sec?.href || (sec?.scroll ? `#${sec.scroll}` : undefined)} {...(sec?.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} onClick={(e) => { if (ctx.editable) return; if (!sec?.href) { e.preventDefault(); if (ctx.live && sec?.scroll) smoothTo(sec.scroll); } else if (!ctx.live) e.preventDefault(); }}><E ctx={ctx} k="secondaryText" v={p.secondaryText} /> {sec?.href ? '→' : '↓'}</a>}
          </div>
          {p.showTrust !== false && (p.socialText || p.rating) && (
            <div className="trust" data-rm="showTrust" data-rm-label="rating row">
              <div className="avs">{['Riya S', 'Arjun P', 'Meena K', 'Sahil N', 'Vikas J'].map((n) => <Avatar key={n} name={n} />)}</div>
              <div>
                <div className="stars">★★★★★ {p.rating ? <E ctx={ctx} k="rating" v={p.rating} as="b" num fmt={(v) => `${v}/5`} /> : null}{p.reviews && <span className="muted"> · <E ctx={ctx} k="reviews" v={p.reviews} /> reviews</span>}</div>
                <E ctx={ctx} k="socialText" v={p.socialText} as="div" className="muted sm" />
              </div>
            </div>
          )}
        </div>
        {((p.image && !banner) || p.showCard !== false || p.chip1 || p.chip2) && <div className="hero-visual">
          {p.image && !banner ? <Img src={p.image} alt="" className="hero-img" priority sizes="(max-width: 760px) 100vw, 600px" /> : p.showCard !== false && (
            <div className="hcard" data-rm="showCard" data-rm-label="product card">
              <div className="hc-top"><E ctx={ctx} k="cardEmoji" v={p.cardEmoji} className="hc-emoji" />{p.cardTag && <span className="hc-tag"><i className="dot" /> <E ctx={ctx} k="cardTag" v={p.cardTag} /></span>}</div>
              <E ctx={ctx} k="cardTitle" v={p.cardTitle} as="h3" />
              {p.rating ? <div className="stars sm">★★★★★ <b>{p.rating}</b></div> : null}
              {p.cardPrice && <div className="hc-price"><E ctx={ctx} k="cardPrice" v={p.cardPrice} as="b" />{p.cardMrp && <E ctx={ctx} k="cardMrp" v={p.cardMrp} as="s" />}</div>}
              <ul className="checks">{(p.cardPoints || []).map((x, i) => x.text ? <li key={i} data-item={`cardPoints.${i}`}><E ctx={ctx} k={`cardPoints.${i}.text`} v={x.text} /></li> : null)}</ul>
              <Btn block onClick={go(ctx)} ctx={ctx} k="ctaText" link={link}>{p.ctaText}</Btn>
            </div>
          )}
          {p.chip1 && <E ctx={ctx} k="chip1" v={p.chip1} as="div" className="chip c1" />}
          {p.chip2 && <E ctx={ctx} k="chip2" v={p.chip2} as="div" className="chip c2" />}
        </div>}
      </div>
    </section>
  );
}

const Stats = ({ p, ctx }) => (
  <Sec type="stats" v={vOf('stats', p)}><div className="stats-grid">{(p.items || []).map((i, k) => <div key={k} data-item={`items.${k}`}><E ctx={ctx} k={`items.${k}.value`} v={i.value} as="b" /><E ctx={ctx} k={`items.${k}.label`} v={i.label} /></div>)}</div></Sec>
);

const Problem = ({ p, ctx }) => (
  <Sec type="problem" className="alt" v={vOf('problem', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} ctx={ctx} left={vOf('problem', p) === 'split'} />
    <div className="pain-grid">{(p.items || []).map((x, i) => <div className="pc pain" key={i} data-item={`items.${i}`}><span className="x">✕</span><E ctx={ctx} k={`items.${i}.text`} v={x.text} as="p" /></div>)}</div>
    {p.closing && <E ctx={ctx} k="closing" v={p.closing} as="p" className="closing" />}
  </Sec>
);

const Features = ({ p, ctx }) => (
  <Sec type="features" v={vOf('features', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} subtitle={p.subtitle} ctx={ctx} left={vOf('features', p) === 'list'} />
    <div className="feat-grid">
      {(p.items || []).map((i, k) => (
        <div className="pc feat" key={k} data-item={`items.${k}`}>
          <span className="fnum" aria-hidden="true">{pad(k + 1)}</span>
          <E ctx={ctx} k={`items.${k}.icon`} v={i.icon || '✓'} className="ic" />
          <div><E ctx={ctx} k={`items.${k}.title`} v={i.title} as="h3" /><E ctx={ctx} k={`items.${k}.text`} v={i.text} as="p" /></div>
        </div>
      ))}
    </div>
  </Sec>
);

const Steps = ({ p, ctx }) => (
  <Sec type="steps" id="how" v={vOf('steps', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="steps" style={{ '--n': (p.items || []).length || 1 }}>
      {(p.items || []).map((s, i) => <div className="step" key={i} data-item={`items.${i}`}><span className="num">{i + 1}</span><E ctx={ctx} k={`items.${i}.title`} v={s.title} as="h3" /><E ctx={ctx} k={`items.${i}.text`} v={s.text} as="p" /></div>)}
    </div>
  </Sec>
);

const Compare = ({ p, ctx }) => (
  <Sec type="compare" className="alt" v={vOf('compare', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    {vOf('compare', p) === 'table' ? (
      <div className="pc cmp-table">
        <div className="ct-row ct-head"><span /><E ctx={ctx} k="leftTitle" v={p.leftTitle} as="b" /><span className="ct-us">{p.tag && <E ctx={ctx} k="tag" v={p.tag} className="cmp-tag" />}<E ctx={ctx} k="rightTitle" v={p.rightTitle} as="b" /></span></div>
        {(p.rows || []).map((r, i) => (
          <div className="ct-row" key={i} data-item={`rows.${i}`}><span className="ct-n">{pad(i + 1)}</span><span className="ct-bad">✕ <E ctx={ctx} k={`rows.${i}.left`} v={r.left} /></span><span className="ct-good">✓ <E ctx={ctx} k={`rows.${i}.right`} v={r.right} /></span></div>
        ))}
      </div>
    ) : <div className="cmp">
      <div className="pc cmp-col bad"><E ctx={ctx} k="leftTitle" v={p.leftTitle} as="h3" /><ul>{(p.rows || []).map((r, i) => <li key={i} data-item={`rows.${i}`}><span className="cmp-ic">✕</span><E ctx={ctx} k={`rows.${i}.left`} v={r.left} /></li>)}</ul></div>
      <div className="pc cmp-col good">{p.tag && <E ctx={ctx} k="tag" v={p.tag} className="cmp-tag" />}<E ctx={ctx} k="rightTitle" v={p.rightTitle} as="h3" /><ul>{(p.rows || []).map((r, i) => <li key={i} data-item={`rows.${i}`}><span className="cmp-ic">✓</span><E ctx={ctx} k={`rows.${i}.right`} v={r.right} /></li>)}</ul></div>
    </div>}
  </Sec>
);

const Testimonials = ({ p, ctx }) => (
  <Sec type="testimonials" v={vOf('testimonials', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="tgrid3">
      {(p.items || []).map((t, i) => (
        <figure className="pc quote" key={i} data-item={`items.${i}`}>
          <div className="stars">★★★★★</div>
          <blockquote>“<E ctx={ctx} k={`items.${i}.quote`} v={t.quote} multiline />”</blockquote>
          <figcaption><Avatar name={t.name} /><div><E ctx={ctx} k={`items.${i}.name`} v={t.name} as="b" />{t.tag && <small>✔ <E ctx={ctx} k={`items.${i}.tag`} v={t.tag} /></small>}</div></figcaption>
          <span className="wa-time" aria-hidden="true">{pad(9 + ((i * 3) % 12))}:{pad((i * 17 + 4) % 60)} ✓✓</span>
        </figure>
      ))}
    </div>
  </Sec>
);

// ---------- images: optional CDN host + phone-sized copies ----------
// Uploads optimised in the editor are saved as name.v.webp (≤1920px) with a name.v-800.webp copy for phones.
const cdnBase = () => String((typeof window !== 'undefined' ? window.__FF_CDN__ : globalThis.__FF_CDN__) || '').replace(/\/$/, '');
export const mediaUrl = (u) => (typeof u === 'string' && u.startsWith('/uploads/') && cdnBase() ? cdnBase() + u : u);
const smallCopy = (u) => (typeof u === 'string' && /^\/uploads\/[^?#]+\.v\.webp$/.test(u) ? u.replace(/\.v\.webp$/, '.v-800.webp') : null);
export function Img({ src, alt = '', priority = false, sizes = '(max-width: 760px) 100vw, 960px', ...rest }) {
  const sm = smallCopy(src);
  return (
    <img src={mediaUrl(src)} srcSet={sm ? `${mediaUrl(sm)} 800w, ${mediaUrl(src)} 1920w` : undefined} sizes={sm ? sizes : undefined}
      alt={alt} loading={priority ? 'eager' : 'lazy'} decoding="async" fetchpriority={priority ? 'high' : undefined} {...rest} />
  );
}

const Mentor = ({ p, ctx }) => (
  <Sec type="mentor" className="alt" v={vOf('mentor', p)}>
    <div className="mentor">
      <div className="m-photo">
        {p.image ? <Img src={p.image} alt={p.name} sizes="(max-width: 760px) 90vw, 420px" /> : (
          <div className="m-card">
            <span className="m-ini">{initials(p.name)}</span>
            <b>{p.name}</b>
            {p.role && <small>{p.role}</small>}
            {ctx.editable && <em className="m-add">📷 Add a photo in the section settings</em>}
          </div>
        )}
        {p.badge && <E ctx={ctx} k="badge" v={p.badge} className="m-badge" />}
      </div>
      <div>
        {p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}
        <E ctx={ctx} k="name" v={p.name} as="h2" />
        <E ctx={ctx} k="role" v={p.role} as="div" className="m-role" />
        <E ctx={ctx} k="bio" v={p.bio} as="p" className="m-bio" multiline />
        <div className="m-pts">{(p.points || []).map((x, i) => <E key={i} ctx={ctx} k={`points.${i}.text`} v={x.text} />)}</div>
      </div>
    </div>
  </Sec>
);

const Bonuses = ({ p, ctx }) => (
  <Sec type="bonuses" v={vOf('bonuses', p)}>
    <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
    <div className="bonus-grid">
      {(p.items || []).map((b, i) => (
        <div className="bonus" key={i} data-item={`items.${i}`}>
          {p.freeLabel && <span className="free">{p.freeLabel}</span>}
          <E ctx={ctx} k={`items.${i}.icon`} v={b.icon} className="bic" />
          {p.itemLabel && <small>{p.itemLabel}{/#\s*$/.test(p.itemLabel) ? i + 1 : ''}</small>}
          <E ctx={ctx} k={`items.${i}.title`} v={b.title} as="h3" />
          {b.value && <div className="worth">{p.worthLabel} <E ctx={ctx} k={`items.${i}.value`} v={b.value} as="s" /></div>}
        </div>
      ))}
    </div>
    {p.totalText && <E ctx={ctx} k="totalText" v={p.totalText} as="p" className="btotal" />}
  </Sec>
);

const Guarantee = ({ p, ctx }) => (
  <Sec type="guarantee" v={vOf('guarantee', p)}>
    <div className="pc gbox">
      {p.showSeal !== false && <div className="seal" data-rm="showSeal" data-rm-label="seal"><div>{Number(p.days) > 0 ? <><b>{p.days}</b><small>DAY</small><span>MONEY-BACK</span></> : <><b>100%</b><span>FREE · NO RISK</span></>}</div></div>}
      <div><E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="body" v={p.body} as="p" multiline /></div>
    </div>
  </Sec>
);

// Evergreen: the deadline survives reloads so urgency feels real; restarts when it lapses
function Countdown({ label, minutes, ctx }) {
  const total = (Number(minutes) || 15) * 60;
  const key = `ff_cd_${typeof location === 'undefined' ? '' : location.pathname}_${total}`;
  const read = () => {
    if (typeof window === 'undefined') return Date.now() + total * 1000; // server render
    try {
      let end = Number(localStorage.getItem(key));
      if (!end || end < Date.now()) { end = Date.now() + total * 1000; localStorage.setItem(key, end); }
      return end;
    } catch { return Date.now() + total * 1000; }
  };
  const [end, setEnd] = useState(read);
  const [left, setLeft] = useState(total);
  useEffect(() => { setEnd(read()); }, [total]);
  useEffect(() => {
    const tick = () => { const l = Math.round((end - Date.now()) / 1000); if (l <= 0) setEnd(read()); else setLeft(l); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [end]);
  const parts = [[Math.floor(left / 3600), 'Hours'], [Math.floor((left % 3600) / 60), 'Minutes'], [left % 60, 'Seconds']];
  return (
    <Sec type="countdown">
      {label && <p className="cd-label">⏳ <E ctx={ctx} k="label" v={label} /></p>}
      <div className="tiles">{parts.map(([v, l]) => <div className="tile" key={l}><b>{pad(v)}</b><small>{l}</small></div>)}</div>
    </Sec>
  );
}

function HelloBar({ p, ctx }) {
  const msgs = (p.messages || []).filter((m) => m.text);
  const [i, setI] = useState(0);
  useTick(() => setI((x) => x + 1), ctx.live && msgs.length > 1);
  if (ctx.editable) { const j = (p.messages || []).findIndex((m) => m.text); return <div className="hellobar">{j >= 0 ? <E ctx={ctx} k={`messages.${j}.text`} v={p.messages[j].text} /> : <span>Add a message in the panel</span>}{msgs.length > 1 && <small className="hb-more"> +{msgs.length - 1} more · rotates every 9–10s</small>}</div>; }
  return <div className={`hellobar ${ctx.live ? 'live' : ''}`}><span key={i}>{msgs[i % (msgs.length || 1)]?.text}</span></div>;
}

function LiveCount({ p, ctx }) {
  const min = Number(p.min) || 20, max = Number(p.max) || 60;
  const [n, setN] = useState(() => Math.round(rnd(min, max)));
  useTick(() => setN((x) => Math.min(max, Math.max(min, x + Math.round(rnd(-4, 4))))), true);
  return <div className="livecount"><span className="lc-pill"><i className="dot" /> <b>{n}</b> <E ctx={ctx} k="text" v={p.text} /></span></div>;
}

function Stock({ p, ctx }) {
  const total = Number(p.total) || 50;
  const [left, setLeft] = useState(Number(p.left) || 10);
  useEffect(() => { setLeft(Number(p.left) || 10); }, [p.left]);
  useTick(() => setLeft((x) => (x > 3 && Math.random() < 0.4 ? x - 1 : x)), true);
  const pct = Math.round(100 - (left / total) * 100);
  return (
    <Sec type="stock">
      <div className="pc stockbox">
        <div className="stock-top"><b>⚡ <E ctx={ctx} k="label" v={p.label} fmt={(v) => String(v || '').replace('{n}', left)} /></b><span className="stock-pct">{pct}% claimed</span></div>
        <div className="track"><div style={{ width: `${pct}%` }} /></div>
      </div>
    </Sec>
  );
}

function Proof({ p, ctx }) {
  const items = (p.items || []).filter((i) => i.name);
  const [toast, setToast] = useState(null);
  const sec = Math.max(9, Number(p.intervalSec) || 9);
  useEffect(() => {
    if (!ctx.live || !items.length) return;
    let t, h;
    const show = () => {
      setToast({ ...items[Math.floor(Math.random() * items.length)], ago: Math.ceil(rnd(1, 12)) });
      h = setTimeout(() => setToast(null), 5000);
      t = setTimeout(show, rnd(sec * 1000, sec * 1000 + 1000));
    };
    t = setTimeout(show, 3000);
    return () => { clearTimeout(t); clearTimeout(h); };
  }, [ctx.live, items.length, sec]);
  if (!ctx.live) {
    const one = items[0] || { name: 'Priya M.', city: 'Pune' };
    return (
      <FloatPreview label="🔔 Social proof popup" hint={`Bottom-left corner · a new buyer every ${sec}–${sec + 1}s · ${items.length} names`}>
        <div className="toast static"><Avatar name={one.name} size={42} /><div><b>{one.name}</b> from {one.city}<br /><E ctx={ctx} k="action" v={p.action} /><small>2 mins ago · <em>✔ Verified</em></small></div></div>
      </FloatPreview>
    );
  }
  return toast ? (
    <div className="toast">
      <Avatar name={toast.name} size={42} />
      <div><b>{toast.name}</b> from {toast.city}<br /><span>{p.action}</span><small>{toast.ago} min{toast.ago > 1 ? 's' : ''} ago · <em>✔ Verified</em></small></div>
    </div>
  ) : null;
}

function ExitPopup({ p, ctx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ctx.live || sessionStorage.getItem('ff_exit')) return;
    const fire = () => { if (!sessionStorage.getItem('ff_exit')) { sessionStorage.setItem('ff_exit', '1'); setOpen(true); } };
    const onLeave = (e) => { if (e.clientY <= 0) fire(); };
    document.addEventListener('mouseleave', onLeave);
    // Touch devices have no mouse to leave with, so fall back to a timer there
    const t = window.matchMedia('(pointer: coarse)').matches ? setTimeout(fire, 40000) : null;
    return () => { document.removeEventListener('mouseleave', onLeave); clearTimeout(t); };
  }, [ctx.live]);
  if (!ctx.live) {
    return (
      <FloatPreview label="🚪 Exit-intent popup" hint="Shown once when a visitor is about to leave (after 40 seconds on phones)">
        <div className="modal static">
          <div className="m-emoji">🎁</div>
          <E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="body" v={p.body} as="p" />
          <E ctx={ctx} k="code" v={p.code} as="div" className="code" />
          <Btn big block ctx={ctx} k="buttonText">{p.buttonText}</Btn>
          <span className="decline">No thanks, I’ll pay full price</span>
        </div>
      </FloatPreview>
    );
  }
  if (!open) return null;
  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="mx" onClick={() => setOpen(false)}>×</button>
        <div className="m-emoji">🎁</div>
        <h2>{p.title}</h2><p>{p.body}</p>
        <div className="code">{p.code}</div>
        <Btn big block onClick={() => { setOpen(false); ctx.onClaim?.(p.code); ctx.onNext(); }}>{p.buttonText}</Btn>
        <a className="decline" onClick={() => setOpen(false)}>No thanks, I’ll pay full price</a>
      </div>
    </div>
  );
}

function StickyBar({ p, ctx }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!ctx.live) return;
    const f = () => setShow(window.scrollY > 700);
    window.addEventListener('scroll', f);
    return () => window.removeEventListener('scroll', f);
  }, [ctx.live]);
  if (!ctx.live) {
    return (
      <FloatPreview label="📌 Sticky buy bar" hint="Slides up at the bottom once the visitor scrolls past the first screen">
        <div className="stickybar on static"><span><E ctx={ctx} k="text" v={p.text} /> <E ctx={ctx} k="price" v={p.price} as="b" /></span><Btn ctx={ctx} k="buttonText">{p.buttonText}</Btn></div>
      </FloatPreview>
    );
  }
  return <div className={`stickybar ${show ? 'on' : ''}`}><span>{p.text} <b>{p.price}</b></span><Btn onClick={ctx.onNext} ctx={ctx} link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn></div>;
}

function WhatsApp({ p, ctx }) {
  if (!ctx.live) {
    return (
      <FloatPreview label="💬 WhatsApp chat button" hint={`Bottom-right corner · opens a chat with ${!p.number || p.number === '919999999999' ? 'your Support WhatsApp from Settings (hidden if it isn’t set)' : `+${p.number}`}`}>
        <span className="wa static"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg><E ctx={ctx} k="label" v={p.label} /></span>
      </FloatPreview>
    );
  }
  return (
    <a className="wa" target="_blank" rel="noreferrer" href={`https://wa.me/${p.number}?text=${encodeURIComponent(p.message || '')}`}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.7-.1l1.900.9c.3.1.5.2.5.3.1.2.1.7-.1 1.1z" /></svg>
      <span>{p.label}</span>
    </a>
  );
}

function Pricing({ p, ctx }) {
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  const v = vOf('pricing', p);
  if (v === 'split') {
    return (
      <Sec type="pricing" id="pricing" v="split">
        <div className="psplit">
          <div className="ps-inc">
            {p.badge && <E ctx={ctx} k="badge" v={p.badge} as="div" className="eyebrow" />}
            {p.title && <E ctx={ctx} k="title" v={p.title} as="h2" />}
            <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`} className={b.text.startsWith('BONUS') ? 'bonus-li' : ''}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
          </div>
          <div className="pc ps-buy">
            <div className="pprice">
              {(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v2) => money(p.currency, v2)} />}
              <E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v2) => money(p.currency, v2)} />
            </div>
            {off > 0 && <span className="off">You save {off}%</span>}
            {p.priceNote && <E ctx={ctx} k="priceNote" v={p.priceNote} as="p" className="muted sm" />}
            <Btn big block onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
            {p.payMethods && (ctx.editable ? <E ctx={ctx} k="payMethods" v={p.payMethods} as="div" className="pay pay-ed" /> : <div className="pay">{String(p.payMethods).split(/\s*[·,|]\s*/).filter(Boolean).map((m) => <span key={m}>{m}</span>)}</div>)}
            {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="pnote" />}
          </div>
        </div>
      </Sec>
    );
  }
  return (
    <Sec type="pricing" id="pricing">
      <div className="pbox">
        {p.badge && <E ctx={ctx} k="badge" v={p.badge} as="div" className="ribbon" />}
        {p.title && <E ctx={ctx} k="title" v={p.title} as="h3" className="ptitle" />}
        <div className="pprice">
          {(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v) => money(p.currency, v)} />}
          <E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v) => money(p.currency, v)} />
          {off > 0 && <span className="off">Save {off}%</span>}
        </div>
        {p.priceNote && <E ctx={ctx} k="priceNote" v={p.priceNote} as="p" className="muted sm" />}
        <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`} className={b.text.startsWith('BONUS') ? 'bonus-li' : ''}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
        <Btn big block onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
        {p.payMethods && (ctx.editable ? <E ctx={ctx} k="payMethods" v={p.payMethods} as="div" className="pay pay-ed" /> : <div className="pay">{String(p.payMethods).split(/\s*[·,|]\s*/).filter(Boolean).map((m) => <span key={m}>{m}</span>)}</div>)}
        {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="pnote" />}
      </div>
    </Sec>
  );
}

function OptinForm({ p, ctx }) {
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pts = (p.points || []).filter((x) => x.text);
  return (
    <Sec type="optin" id="optin" className="alt">
      <div className={pts.length ? 'optin-grid' : 'optin-solo'}>
        {pts.length > 0 && (
          <div>
            {p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}
            <E ctx={ctx} k="title" v={p.title} as="h2" />
            <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />
            <ul className="checks">{(p.points || []).map((x, i) => x.text ? <li key={i} data-item={`points.${i}`}><E ctx={ctx} k={`points.${i}.text`} v={x.text} /></li> : null)}</ul>
          </div>
        )}
        <form className="pc formcard" onSubmit={async (e) => { e.preventDefault(); if (!ctx.live) return; setBusy(true); await ctx.onOptin(f); setBusy(false); }}>
          {!pts.length && <><E ctx={ctx} k="title" v={p.title} as="h2" /><E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" /></>}
          <E ctx={ctx} k="nameLabel" v={p.nameLabel} as="label" keep /><input placeholder="e.g. Priya Sharma" value={f.name} onChange={set('name')} />
          <E ctx={ctx} k="emailLabel" v={p.emailLabel} as="label" keep /><input type="email" required placeholder="you@example.com" value={f.email} onChange={set('email')} />
          {p.askPhone && <><E ctx={ctx} k="phoneLabel" v={p.phoneLabel} as="label" keep /><input type="tel" placeholder="+91 98765 43210" value={f.phone} onChange={set('phone')} /></>}
          <Btn big block type="submit" disabled={busy} ctx={ctx} k="buttonText">{busy ? 'Please wait…' : p.buttonText}</Btn>
          {p.secureText && <E ctx={ctx} k="secureText" v={p.secureText} as="p" className="secure" />}
        </form>
      </div>
    </Sec>
  );
}

function Checkout({ p, ctx }) {
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [bump, setBump] = useState(false);
  const [pm, setPm] = useState('UPI');
  const [busy, setBusy] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  const [code, setCode] = useState('');
  const [coupon, setCoupon] = useState(null);
  const [cErr, setCErr] = useState('');
  const price = Number(p.price) || 0, bp = Number(p.bumpPrice) || 0, mrp = Number(p.mrp) || 0;
  // same rule as the server: never more than the price, never negative
  const discount = coupon ? Math.max(0, Math.min(price, coupon.type === 'percent' ? Math.round((price * Math.min(100, coupon.value)) / 100) : Math.round(coupon.value))) : 0;
  const [payErr, setPayErr] = useState('');
  const total = price - discount + (bump && p.bumpEnabled ? bp : 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  // A code claimed from the exit popup is applied automatically
  useEffect(() => {
    const pending = ctx.live && ctx.getPendingCoupon?.();
    if (!pending) return;
    setCode(pending); setShowCoupon(true);
    ctx.onCoupon?.(pending).then((r) => { if (r?.valid) setCoupon(r); });
  }, [ctx.live]);
  // Capture the email as soon as it's typed so abandoned checkouts can be followed up
  const onEmailBlur = () => { if (ctx.live && /\S+@\S+\.\S+/.test(f.email)) ctx.onAbandon?.(f); };
  const apply = async () => {
    if (!ctx.live || !code) return;
    setCErr('');
    const r = await ctx.onCoupon?.(code, f.email);
    if (r?.valid) setCoupon(r); else { setCoupon(null); setCErr(r?.reason || 'That code isn’t valid'); }
  };
  return (
    <Sec type="checkout">
      <div className="co-grid">
        <form className="pc co-form" onSubmit={async (e) => { e.preventDefault(); if (!ctx.live) return; setBusy(true); setPayErr(''); const r = await ctx.onCheckout({ ...f, withBump: bump, coupon: coupon?.code }); if (r?.error) { setPayErr(r.error); if (r.error.includes('remove it')) { setCoupon(null); setCErr(r.error); } } setBusy(false); }}>
          <div className="co-step"><span className="co-n">1</span> <E ctx={ctx} k="step1" v={p.step1} keep /></div>
          <input placeholder="Full name" required value={f.name} onChange={set('name')} />
          <div className="two"><input type="email" placeholder="Email" required value={f.email} onChange={set('email')} onBlur={onEmailBlur} /><input type="tel" placeholder="WhatsApp number" value={f.phone} onChange={set('phone')} onBlur={onEmailBlur} /></div>
          <div className="co-step"><span className="co-n">2</span> <E ctx={ctx} k="step2" v={p.step2} keep /></div>
          <div className="paym">{['UPI', 'Card', 'NetBanking', 'Wallet'].map((m) => (
            <label key={m} className={`pm ${pm === m ? 'on' : ''}`}><input type="radio" name="pm" checked={pm === m} onChange={() => setPm(m)} />{m}</label>
          ))}</div>
          {p.bumpEnabled && (
            <label className={`bump ${bump ? 'on' : ''}`}>
              <input type="checkbox" checked={bump} onChange={(e) => setBump(e.target.checked)} />
              <span><b>👉 Yes! <E ctx={ctx} k="bumpTitle" v={p.bumpTitle} keep /> — just {money(p.currency, bp)}</b><br /><E ctx={ctx} k="bumpDescription" v={p.bumpDescription} /></span>
            </label>
          )}
          {payErr && <p className="c-err" role="alert">{payErr}</p>}
          {ctx.editable ? <Btn big block ctx={ctx} k="buttonText">{p.buttonText || 'Pay Securely'}</Btn> : <Btn big block type="submit" disabled={busy}>{busy ? 'Processing…' : `${p.buttonText || 'Pay Securely'} · ${money(p.currency, total)}`}</Btn>}
          {p.secureText && <E ctx={ctx} k="secureText" v={p.secureText} as="p" className="secure" />}
        </form>
        <aside className="pc co-sum">
          {p.summaryTitle && <E ctx={ctx} k="summaryTitle" v={p.summaryTitle} as="h4" />}
          <div className="line"><span><E ctx={ctx} k="productName" v={p.productName} keep /><E ctx={ctx} k="description" v={p.description} as="small" /></span><b>{money(p.currency, price)}</b></div>
          {bump && p.bumpEnabled && <div className="line"><span>{p.bumpTitle}</span><b>{money(p.currency, bp)}</b></div>}
          {coupon && <div className="line disc"><span>🎁 Coupon {coupon.code} applied</span><b>−{money(p.currency, discount)}</b></div>}
          <div className="line total"><span>Total</span><b>{money(p.currency, total)}</b></div>
          {mrp > price && <div className="save">🎉 You save {money(p.currency, mrp - price + discount)} today</div>}
          {showCoupon ? (
            <div className="coupon">
              <input placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button type="button" onClick={apply}>Apply</button>
            </div>
          ) : <a className="coupon-link" onClick={() => setShowCoupon(true)}>Have a coupon code?</a>}
          {cErr && <small className="c-err">{cErr}</small>}
          {(p.perks || []).some((x) => x.text) && <ul className="checks sm">{p.perks.map((x, i) => x.text ? <li key={i} data-item={`perks.${i}`}><E ctx={ctx} k={`perks.${i}.text`} v={x.text} /></li> : null)}</ul>}
        </aside>
      </div>
    </Sec>
  );
}

// One-click upsell / downsell page
function Offer({ p, ctx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  return (
    <Sec type="offer">
      {p.progress && (
        <div className="progress"><div className="pg-bar"><div /></div><E ctx={ctx} k="progress" v={p.progress} /></div>
      )}
      <div className="offer-grid">
        <div className="pc offer-visual">
          {p.tag && <E ctx={ctx} k="tag" v={p.tag} className="ov-tag" />}
          <E ctx={ctx} k="emoji" v={p.emoji ?? '🎁'} as="div" className="ov-emoji" />
          <E ctx={ctx} k="productName" v={p.productName} as="h3" />
          <div className="pprice">{(off > 0 || ctx.editable) && <E ctx={ctx} k="mrp" v={p.mrp} as="s" num fmt={(v) => money(p.currency, v)} />}<E ctx={ctx} k="price" v={p.price} as="b" num fmt={(v) => money(p.currency, v)} /></div>
          {off > 0 && <span className="off">Save {off}% — only on this page</span>}
        </div>
        <div className="offer-copy">
          <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
          <E ctx={ctx} k="description" v={p.description} as="p" className="lead" multiline />
          <ul className="checks">{(p.bullets || []).map((b, i) => b.text ? <li key={i} data-item={`bullets.${i}`}><E ctx={ctx} k={`bullets.${i}.text`} v={b.text} /></li> : null)}</ul>
          {p.minutes ? <OfferTimer minutes={p.minutes} /> : null}
          {err && <p className="c-err" role="alert">{err}</p>}
          <Btn big block disabled={busy} ctx={ctx} k="acceptText" onClick={async () => { if (!ctx.live) return; setBusy(true); setErr(''); const r = await ctx.onAccept(); if (r?.error) setErr(r.error); setBusy(false); }}>{busy ? 'Adding…' : p.acceptText}</Btn>
          {p.oneClickText && <E ctx={ctx} k="oneClickText" v={p.oneClickText} as="p" className="oneclick" />}
          <a className="decline" onClick={() => ctx.live && ctx.onDecline()}><E ctx={ctx} k="declineText" v={p.declineText} /></a>
        </div>
      </div>
    </Sec>
  );
}

function OfferTimer({ minutes }) {
  const [left, setLeft] = useState(minutes * 60);
  useEffect(() => { const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000); return () => clearInterval(t); }, []);
  return <div className="otimer">⏳ This offer expires in <b>{pad(Math.floor(left / 60))}:{pad(left % 60)}</b></div>;
}

function CrossSell({ p, ctx }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const add = async (i) => {
    if (!ctx.live || added[i]) return;
    setBusy(i); setErr('');
    const r = await ctx.onCrossSell?.(ctx.blockId, i);
    if (r?.error) setErr(r.error); else setAdded({ ...added, [i]: true });
    setBusy(null);
  };
  return (
    <Sec type="crosssell" className="alt">
      <div className="sh c">{p.eyebrow && <E ctx={ctx} k="eyebrow" v={p.eyebrow} className="eyebrow" />}<E ctx={ctx} k="title" v={p.title} as="h2" isRich />{p.subtitle && <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />}</div>
      {err && <p className="c-err center" role="alert">{err}</p>}
      <div className="xs-grid">
        {(p.items || []).map((it, i) => (
          <div className={`pc xs ${added[i] ? 'added' : ''}`} key={i} data-item={`items.${i}`}>
            <E ctx={ctx} k={`items.${i}.emoji`} v={it.emoji ?? '🎁'} className="xs-emoji" />
            <E ctx={ctx} k={`items.${i}.name`} v={it.name} as="h3" />
            <E ctx={ctx} k={`items.${i}.desc`} v={it.desc} as="p" />
            <div className="xs-foot">
              <E ctx={ctx} k={`items.${i}.price`} v={it.price} as="b" num fmt={(v) => money('₹', v)} />
              <button className="btn" onClick={() => add(i)} disabled={busy === i || added[i]}>{added[i] ? '✓ Added' : busy === i ? 'Adding…' : p.buttonText || 'Add'}</button>
            </div>
          </div>
        ))}
      </div>
    </Sec>
  );
}

function embed(url) {
  const m = /(?:youtu\.be\/|v=)([\w-]{11})/.exec(url || '');
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}
function VideoEmbed({ url }) {
  const v = videoSource(url);
  if (!v) return <div className="video ph">Unsupported video link</div>;
  if (v.kind === 'video') return <video className="video" src={v.src} controls playsInline preload="metadata" />;
  return <iframe className="video" src={v.src} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title="video" loading="lazy" />;
}

// ---------- media, layout helpers, custom code, forms ----------
// Turn a share link from common video hosts into something playable
export function videoSource(url = '') {
  const u = String(url).trim();
  let m;
  if ((m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(u))) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  if ((m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u))) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  if ((m = /loom\.com\/(?:share|embed)\/([\w-]+)/.exec(u))) return { kind: 'iframe', src: `https://www.loom.com/embed/${m[1]}` };
  if ((m = /drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/.exec(u))) return { kind: 'iframe', src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/^https?:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(u) || /^\/uploads\/.+\.(mp4|webm)$/i.test(u)) return { kind: 'video', src: u };
  if (/^https:\/\//.test(u)) return { kind: 'iframe', src: u };
  return null;
}

function ImageBlock({ p, ctx }) {
  if (!p.src) return ctx.editable ? <Sec type="image"><div className="el-img-ph">🖼️ <span>Add an image — select this section and upload it in the panel</span></div></Sec> : null;
  const img = <Img className={`${p.rounded ? 'rounded' : ''} ${p.shadow ? 'shadow' : ''}`} src={p.src} alt={p.alt || ''} />;
  return (
    <Sec type="image" className={`iw-${p.width || 'normal'}`}>
      <figure className="img-fig">
        {p.link && safeHref(p.link) && !ctx.editable ? <a href={safeHref(p.link)}>{img}</a> : img}
        {(p.caption || ctx.editable) && <E ctx={ctx} k="caption" v={p.caption} as="figcaption" keep />}
      </figure>
    </Sec>
  );
}

function Gallery({ p, ctx }) {
  const items = (p.items || []).filter((i) => i.src);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (open == null) return;
    const k = (e) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') setOpen((i) => (i + 1) % items.length); if (e.key === 'ArrowLeft') setOpen((i) => (i - 1 + items.length) % items.length); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, items.length]);
  return (
    <Sec type="gallery">
      <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
      {!items.length && ctx.editable ? <div className="el-img-ph">🖼️ <span>Add gallery images in the panel</span></div> : (
        <div className="gal" style={{ '--gcols': Number(p.columns) || 3 }}>
          {items.map((it, i) => (
            <figure key={i} className="gal-item" data-item={`items.${(p.items || []).indexOf(it)}`} onClick={() => ctx.live && setOpen(i)}>
              <Img src={it.src} alt={it.caption || ''} sizes="(max-width: 760px) 50vw, 320px" />
              {it.caption && <figcaption>{it.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {open != null && items[open] && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <button className="lb-x" aria-label="Close">×</button>
          {items.length > 1 && <button className="lb-nav prev" aria-label="Previous" onClick={(e) => { e.stopPropagation(); setOpen((open - 1 + items.length) % items.length); }}>‹</button>}
          <figure onClick={(e) => e.stopPropagation()}><img src={mediaUrl(items[open].src)} alt={items[open].caption || ''} />{items[open].caption && <figcaption>{items[open].caption}</figcaption>}</figure>
          {items.length > 1 && <button className="lb-nav next" aria-label="Next" onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % items.length); }}>›</button>}
        </div>
      )}
    </Sec>
  );
}

// Custom HTML runs in a sandboxed iframe WITHOUT same-origin access, so embedded code can never
// read the app's cookies, storage or logins. It reports its height so it sizes itself.
const EMBED_SIZER = '<script>(function(){function s(){parent.postMessage({ffEmbedH:Math.ceil(document.documentElement.scrollHeight)},"*")}if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s);setTimeout(s,50);setTimeout(s,1000)})()</' + 'script>';
function HtmlEmbed({ p, ctx }) {
  const ref = useRef();
  const [h, setH] = useState(Number(p.height) || 120);
  useEffect(() => {
    if (Number(p.height)) { setH(Number(p.height)); return; }
    const onMsg = (e) => { if (e.source === ref.current?.contentWindow && typeof e.data?.ffEmbedH === 'number') setH(Math.min(4000, Math.max(20, e.data.ffEmbedH))); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [p.height]);
  if (!p.code?.trim()) return ctx.editable ? <Sec type="embed"><div className="el-img-ph">🧩 <span>Paste HTML or an embed code (Calendly, Typeform, Google Maps…) in the panel</span></div></Sec> : null;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;font-family:system-ui,sans-serif}img,iframe,video{max-width:100%}</style></head><body>${p.code}${EMBED_SIZER}</body></html>`;
  return (
    <Sec type="embed" className={p.fullWidth ? 'embed-full' : ''}>
      <iframe ref={ref} className="embed-frame" title={p.title || 'Embedded content'} srcDoc={doc} style={{ height: h }} loading="lazy"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" />
    </Sec>
  );
}

export const FORM_FIELD_TYPES = [['text', 'Short text'], ['email', 'Email'], ['tel', 'Phone / WhatsApp'], ['number', 'Number'], ['textarea', 'Long answer'], ['select', 'Dropdown'], ['checkbox', 'Checkbox'], ['date', 'Date']];
function FormBlock({ p, ctx }) {
  const fields = p.fields || [];
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const set = (i, v) => setVals({ ...vals, [i]: v });
  const submit = async (e) => {
    e.preventDefault();
    if (!ctx.live) return;
    setErr(''); setBusy(true);
    const answers = {};
    let email = '', phone = '', name = '';
    fields.forEach((fd, i) => {
      const v = vals[i] ?? (fd.type === 'checkbox' ? false : '');
      answers[fd.label || `Field ${i + 1}`] = v;
      if (fd.type === 'email' && !email) email = v;
      if (fd.type === 'tel' && !phone) phone = v;
      if (!name && /name/i.test(fd.label || '') && fd.type === 'text') name = v;
    });
    try {
      await ctx.onForm?.({ email, phone, name, fields: answers });
      if (p.after === 'next') ctx.onFormNext?.(); else setDone(true);
    } catch (x) { setErr(x.message || 'Something went wrong — please try again.'); }
    setBusy(false);
  };
  return (
    <Sec type="form" id={ctx.editable ? undefined : 'form'} className="alt">
      <form className="pc formcard form-b" onSubmit={submit}>
        {p.title && <E ctx={ctx} k="title" v={p.title} as="h2" />}
        {p.subtitle && <E ctx={ctx} k="subtitle" v={p.subtitle} as="p" className="sub" />}
        {done ? <div className="form-done">✅ <E ctx={ctx} k="successMessage" v={p.successMessage || 'Thank you! We’ll be in touch shortly.'} keep /></div> : (
          <>
            {fields.map((fd, i) => {
              const id = `ff-${i}`;
              const common = { id, required: !!fd.required, value: vals[i] ?? '', onChange: (e) => set(i, e.target.value) };
              if (fd.type === 'checkbox') return <label key={i} className="fcheck"><input type="checkbox" required={!!fd.required} checked={!!vals[i]} onChange={(e) => set(i, e.target.checked)} /> <span>{fd.label}{fd.required && ' *'}</span></label>;
              return (
                <div key={i} className="ffield">
                  <label htmlFor={id}>{fd.label}{fd.required && <span className="req"> *</span>}</label>
                  {fd.type === 'textarea' ? <textarea rows={4} placeholder={fd.placeholder || ''} {...common} />
                    : fd.type === 'select' ? <select {...common}><option value="">Choose…</option>{String(fd.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
                      : <input type={fd.type || 'text'} placeholder={fd.placeholder || ''} {...common} />}
                </div>
              );
            })}
            {err && <p className="c-err">{err}</p>}
            <Btn big block type="submit" disabled={busy}>{busy ? 'Sending…' : p.buttonText || 'Submit'}</Btn>
            {p.note && <p className="secure">{p.note}</p>}
          </>
        )}
      </form>
    </Sec>
  );
}

// ---------- custom sections: columns of individual elements ----------
export const LAYOUTS = [['1', 'One column'], ['1-1', 'Two equal columns'], ['2-1', 'Wide + narrow'], ['1-2', 'Narrow + wide'], ['1-1-1', 'Three columns'], ['1-1-1-1', 'Four columns']];
const LAYOUT_COLS = { 1: ['1fr'], '1-1': ['1fr', '1fr'], '2-1': ['2fr', '1fr'], '1-2': ['1fr', '2fr'], '1-1-1': ['1fr', '1fr', '1fr'], '1-1-1-1': ['1fr', '1fr', '1fr', '1fr'] };
export const colCount = (layout) => (LAYOUT_COLS[layout] || ['1fr']).length;
const ALIGN = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const newId = () => Math.random().toString(36).slice(2, 10);

export const ELEMENT_TYPES = {
  heading: { label: 'Heading', icon: '🔤', fields: [['text', 'long', null, HL], ['level', 'select', [['h1', 'Large (H1)'], ['h2', 'Medium (H2)'], ['h3', 'Small (H3)']]], ['align', 'select', ALIGN]], defaults: { text: 'Your *headline* goes here', level: 'h2', align: 'left' } },
  text: { label: 'Text', icon: '📝', fields: [['text', 'long'], ['size', 'select', [['sm', 'Small'], ['md', 'Normal'], ['lg', 'Large']]], ['align', 'select', ALIGN]], defaults: { text: 'Write a sentence or two that makes your visitor want to keep reading.', size: 'md', align: 'left' } },
  button: { label: 'Button', icon: '🔘', fields: [['label', 'text'], ['action', 'select', [['next', 'Go to the next step'], ['url', 'Open a link'], ['scroll', 'Scroll to a section']]], ['url', 'text', null, 'https://…, #section-id, tel:… or mailto:…'], ['variant', 'select', [['primary', 'Filled'], ['outline', 'Outline']]], ['align', 'select', ALIGN], ['full', 'bool']], defaults: { label: 'Get Started', action: 'next', url: '', variant: 'primary', align: 'left', full: false } },
  image: { label: 'Image', icon: '🖼️', fields: [['src', 'text'], ['alt', 'text', null, 'Describe the image — helps SEO and screen readers'], ['link', 'text', null, 'Optional: make the image a link'], ['rounded', 'bool'], ['shadow', 'bool']], defaults: { src: '', alt: '', link: '', rounded: true, shadow: true } },
  list: { label: 'Bullet list', icon: '✅', fields: [['items', 'list', ['text']], ['icon', 'select', [['check', '✓ Checkmarks'], ['dot', '• Dots'], ['num', '1. Numbers']]]], defaults: { items: [{ text: 'First benefit' }, { text: 'Second benefit' }, { text: 'Third benefit' }], icon: 'check' } },
  price: { label: 'Price', icon: '💰', fields: [['price', 'number'], ['mrp', 'number'], ['currency', 'text'], ['note', 'text']], defaults: { price: 499, mrp: 1999, currency: '₹', note: 'One-time payment · instant access' } },
  video: { label: 'Video', icon: '🎬', fields: [['url', 'text', null, 'YouTube, Vimeo, Loom, Google Drive or an .mp4 link']], defaults: { url: '' } },
  spacer: { label: 'Spacer', icon: '↕️', fields: [['height', 'number', null, 'Height in pixels']], defaults: { height: 32 } },
  divider: { label: 'Divider', icon: '➖', fields: [['style', 'select', [['line', 'Solid line'], ['dashed', 'Dashed'], ['dots', 'Dots']]]], defaults: { style: 'line' } },
};
export const newElement = (type, over = {}) => ({ id: newId(), type, props: { ...JSON.parse(JSON.stringify(ELEMENT_TYPES[type].defaults)), ...over } });

// New ids for a copied block (sections contain nested element ids)
export function freshIds(block) {
  const b = JSON.parse(JSON.stringify(block));
  b.id = newId();
  if (b.type === 'section') b.props.columns = (b.props.columns || []).map((c) => ({ id: newId(), elements: (c.elements || []).map((e) => ({ ...e, id: newId() })) }));
  return b;
}
// Changing the layout keeps every element: extra columns are added empty, removed columns move into the last one
export function applyLayout(props, layout) {
  const n = colCount(layout);
  const cols = [...(props.columns || [])];
  while (cols.length < n) cols.push({ id: newId(), elements: [] });
  if (cols.length > n) { const extra = cols.splice(n).flatMap((c) => c.elements); cols[n - 1] = { ...cols[n - 1], elements: [...cols[n - 1].elements, ...extra] }; }
  return { ...props, layout, columns: cols };
}
export const defaultSection = () => ({
  layout: '1-1', valign: 'center', gap: 'md',
  columns: [
    { id: newId(), elements: [newElement('heading'), newElement('text'), newElement('button')] },
    { id: newId(), elements: [newElement('image')] },
  ],
});

// Only allow safe link targets (no javascript: URLs)
export const safeHref = (u = '') => (/^(https?:|mailto:|tel:|#|\/)/i.test(String(u).trim()) ? String(u).trim() : '');

function ElementContent({ el, ctx }) {
  const p = el.props || {};
  switch (el.type) {
    case 'heading': {
      const Tag = ['h1', 'h2', 'h3'].includes(p.level) ? p.level : 'h2';
      return <E ctx={ctx} k="text" v={p.text} as={Tag} isRich keep className={`el-h al-${p.align || 'left'}`} />;
    }
    case 'text':
      return <E ctx={ctx} k="text" v={p.text} as="p" multiline keep className={`el-t sz-${p.size || 'md'} al-${p.align || 'left'}`} />;
    case 'button': {
      const cls = `btn ${p.variant === 'outline' ? 'outline' : ''} ${p.full ? 'block' : ''}`;
      const label = <E ctx={ctx} k="label" v={p.label} />;
      let inner;
      if (ctx.editable) inner = <div className={cls} role="button"><span>{label}</span><span className="arr">→</span></div>;
      else if (p.action === 'url' && safeHref(p.url)) inner = <a className={cls} href={safeHref(p.url)} {...(/^https?:/.test(p.url) ? { target: '_blank', rel: 'noopener' } : {})}><span>{p.label}</span><span className="arr">→</span></a>;
      else if (p.action === 'scroll' && p.url) inner = <a className={cls} href={`#${cleanAnchor(String(p.url).replace(/^#/, ''))}`} onClick={(e) => { e.preventDefault(); smoothTo(cleanAnchor(String(p.url).replace(/^#/, ''))); }}><span>{p.label}</span><span className="arr">→</span></a>;
      else inner = <button type="button" className={cls} onClick={() => ctx.live && ctx.onNext?.()}><span>{p.label}</span><span className="arr">→</span></button>;
      return <div className={`el-btn al-${p.align || 'left'}`}>{inner}</div>;
    }
    case 'image': {
      if (!p.src) return ctx.editable ? <div className="el-img-ph">🖼️ <span>Add an image — select this and upload in the panel</span></div> : null;
      const img = <Img className={`el-img ${p.rounded ? 'rounded' : ''} ${p.shadow ? 'shadow' : ''}`} src={p.src} alt={p.alt || ''} />;
      return p.link && safeHref(p.link) && !ctx.editable ? <a href={safeHref(p.link)}>{img}</a> : img;
    }
    case 'list': {
      const Tag = p.icon === 'num' ? 'ol' : 'ul';
      return <Tag className={`el-list ic-${p.icon || 'check'}`}>{(p.items || []).map((it, i) => <li key={i} data-item={`items.${i}`}><E ctx={ctx} k={`items.${i}.text`} v={it.text} keep /></li>)}</Tag>;
    }
    case 'price': {
      const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
      return <div className="el-price">{off > 0 && <s>{money(p.currency, p.mrp)}</s>}<b>{money(p.currency, p.price)}</b>{off > 0 && <span className="off">Save {off}%</span>}{p.note && <small>{p.note}</small>}</div>;
    }
    case 'video':
      return p.url ? <VideoEmbed url={p.url} /> : ctx.editable ? <div className="video ph">🎬 Add a video link in the panel</div> : null;
    case 'spacer':
      return <div className="el-spacer" style={{ height: Math.max(4, Math.min(400, Number(p.height) || 32)) }} />;
    case 'divider':
      return <hr className={`el-hr ${p.style || 'line'}`} />;
    default:
      return null;
  }
}

function ElementView({ el, ctx, blockId, col }) {
  if (!ctx.editable) return <div className="el"><ElementContent el={el} ctx={ctx} /></div>;
  const ectx = { ...ctx, onEdit: (k, v) => ctx.onEditEl?.(blockId, el.id, k, v) };
  const sel = ctx.selEl === el.id;
  return (
    <div className={`el ${sel ? 'el-sel' : ''}`} data-el={el.id}
      onClick={(e) => { e.stopPropagation(); ctx.onSelectEl?.(blockId, el.id); }}>
      <div className="el-tools" onClick={(e) => e.stopPropagation()}>
        <span className="el-handle" title="Drag to move" onPointerDown={(e) => ctx.onDragStart?.(e, { kind: 'move-el', blockId, col, elId: el.id }, ELEMENT_TYPES[el.type]?.label)}><GripVertical size={13} /></span>
        <span className="el-name">{ELEMENT_TYPES[el.type]?.label}</span>
        <button title="Duplicate" onClick={() => ctx.onElAction?.('dup', blockId, el.id)}><CopyIcon size={12} /></button>
        <button title="Delete" onClick={() => ctx.onElAction?.('del', blockId, el.id)}><Trash2 size={12} /></button>
      </div>
      <ElementContent el={el} ctx={ectx} />
    </div>
  );
}

function CustomSection({ p, ctx, block }) {
  const tpl = LAYOUT_COLS[p.layout] || LAYOUT_COLS[1];
  const drop = ctx.dropAt;
  return (
    <Sec type="custom">
      <div className={`cgrid va-${p.valign || 'top'} gap-${p.gap || 'md'}`} style={{ '--cols': tpl.join(' ') }}>
        {tpl.map((_, ci) => {
          const col = p.columns?.[ci] || { elements: [] };
          const here = drop && drop.zone === 'col' && drop.block === block.id && drop.col === ci;
          return (
            <div className={`ccol ${here ? 'over' : ''}`} key={col.id || ci} {...(ctx.editable ? { 'data-drop': 'col', 'data-block': block.id, 'data-col': ci } : {})}>
              {col.elements.map((el, ei) => (
                <div className="el-slot" key={el.id}>
                  {here && drop.index === ei && <div className="drop-line el-line" />}
                  <ElementView el={el} ctx={ctx} blockId={block.id} col={ci} />
                </div>
              ))}
              {here && drop.index === col.elements.length && <div className="drop-line el-line" />}
              {ctx.editable && !col.elements.length && <div className="ccol-empty">Drop elements here</div>}
            </div>
          );
        })}
      </div>
    </Sec>
  );
}

// Per-section design overrides (props._style), applied around any block
export const STYLE_DEFAULTS = { bg: '', bgImage: '', overlay: 40, textColor: '', padTop: '', padBottom: '', width: '', align: '', hideMobile: false, hideDesktop: false, anchor: '' };
const cleanAnchor = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 40);
const cssUrl = (u) => `url("${String(mediaUrl(u)).replace(/["\\\n\r]/g, '')}")`;
export function Block({ block, ctx }) {
  const content = renderBlock(block, ctx);
  const st = block.props?._style;
  if (!st) return content;
  const cls = ['sx'];
  const vars = {};
  if (st.bg) { cls.push('has-bg'); vars['--sx-bg'] = st.bg; }
  if (st.bgImage) { cls.push('has-bgimg'); vars['--sx-img'] = cssUrl(st.bgImage); vars['--sx-ov'] = Math.min(0.9, Math.max(0, Number(st.overlay ?? 40) / 100)); }
  if (st.textColor) { cls.push('has-ink'); vars['--sx-ink'] = st.textColor; }
  if (st.padTop) cls.push(`pt-${st.padTop}`);
  if (st.padBottom) cls.push(`pb-${st.padBottom}`);
  if (st.width) cls.push(`w-${st.width}`);
  if (st.align) cls.push(`al-${st.align}`);
  if (st.hideMobile) cls.push('hide-m');
  if (st.hideDesktop) cls.push('hide-d');
  if (cls.length === 1 && !st.anchor) return content;
  return <div className={cls.join(' ')} style={vars} id={cleanAnchor(st.anchor) || undefined}>{content}</div>;
}

function renderBlock(block, ctx) {
  const p = withCopy(block.type, block.props || {});
  switch (block.type) {
    case 'section': return <CustomSection p={p} ctx={ctx} block={block} />;
    case 'image': return <ImageBlock p={p} ctx={ctx} />;
    case 'gallery': return <Gallery p={p} ctx={ctx} />;
    case 'spacer': return <div className="blk-spacer" style={{ height: Math.max(4, Math.min(400, Number(p.height) || 48)) }} />;
    case 'divider': return <Sec type="divider"><hr className={`el-hr ${p.style || 'line'}`} /></Sec>;
    case 'html': return <HtmlEmbed p={p} ctx={ctx} />;
    case 'form': return <FormBlock p={p} ctx={ctx} />;
    case 'hero': return <Hero p={p} ctx={ctx} />;
    case 'stats': return <Stats p={p} ctx={ctx} />;
    case 'problem': return <Problem p={p} ctx={ctx} />;
    case 'features': return <Features p={p} ctx={ctx} />;
    case 'steps': return <Steps p={p} ctx={ctx} />;
    case 'compare': return <Compare p={p} ctx={ctx} />;
    case 'testimonials': return <Testimonials p={p} ctx={ctx} />;
    case 'mentor': return <Mentor p={p} ctx={ctx} />;
    case 'bonuses': return <Bonuses p={p} ctx={ctx} />;
    case 'guarantee': return <Guarantee p={p} ctx={ctx} />;
    case 'video':
      return <Sec type="video">{p.url ? <VideoEmbed url={p.url} /> : <div className="video ph">Add a video link (YouTube, Vimeo, Loom, Google Drive or .mp4)</div>}</Sec>;
    case 'text':
      return <Sec type="text"><div className="narrow"><E ctx={ctx} k="title" v={p.title} as="h2" isRich /><E ctx={ctx} k="body" v={p.body} as="p" multiline style={{ whiteSpace: 'pre-wrap' }} /></div></Sec>;
    case 'countdown': return <Countdown label={p.label} minutes={p.minutes} ctx={ctx} />;
    case 'optin': return <OptinForm p={p} ctx={ctx} />;
    case 'checkout': return <Checkout p={p} ctx={ctx} />;
    case 'offer': return <Offer p={p} ctx={ctx} />;
    case 'crosssell': return <CrossSell p={p} ctx={{ ...ctx, blockId: block.id }} />;
    case 'faq':
      return (
        <Sec type="faq" className="alt" v={vOf('faq', p)}>
          <Head eyebrow={p.eyebrow} title={p.title} ctx={ctx} />
          <div className="faq">{(p.items || []).map((i, k) => (ctx.editable
            ? <div key={k} className="faq-ed" data-item={`items.${k}`}><E ctx={ctx} k={`items.${k}.q`} v={i.q} as="div" className="faq-q" /><E ctx={ctx} k={`items.${k}.a`} v={i.a} as="p" multiline /></div>
            : i.q ? <details key={k} open={k === 0}><summary>{i.q}</summary>{i.a && <p>{i.a}</p>}</details> : null))}</div>
        </Sec>
      );
    case 'cta':
      return (
        <Sec type="cta" v={vOf('cta', p)}>
          <E ctx={ctx} k="headline" v={p.headline} as="h2" isRich />
          {p.subheadline && <E ctx={ctx} k="subheadline" v={p.subheadline} as="p" className="sub" />}
          <Btn big onClick={go(ctx)} ctx={ctx} k="buttonText" link={buttonLink(p.buttonAction, p.buttonUrl, p.buttonNewTab)}>{p.buttonText}</Btn>
          {p.note && <E ctx={ctx} k="note" v={p.note} as="p" className="cta-note" />}
        </Sec>
      );
    case 'thankyou':
      return (
        <Sec type="thankyou">
          <div className="ty">
            <div className="tick">✓</div>
            <E ctx={ctx} k="headline" v={p.headline} as="h1" isRich />
            <E ctx={ctx} k="body" v={p.body} as="p" className="lead" multiline />
            {(p.steps || []).length > 0 && (
              <div className="ty-steps">{p.steps.map((s, i) => <div className="pc" key={i} data-item={`steps.${i}`}><span className="num">{i + 1}</span><E ctx={ctx} k={`steps.${i}.text`} v={s.text} /></div>)}</div>
            )}
          </div>
        </Sec>
      );
    case 'pricing': return <Pricing p={p} ctx={ctx} />;
    case 'hellobar': return <HelloBar p={p} ctx={ctx} />;
    case 'livecount': return <LiveCount p={p} ctx={ctx} />;
    case 'stock': return <Stock p={p} ctx={ctx} />;
    case 'proof': return <Proof p={p} ctx={ctx} />;
    case 'exitpopup': return <ExitPopup p={p} ctx={ctx} />;
    case 'stickybar': return <StickyBar p={p} ctx={ctx} />;
    case 'whatsapp': return <WhatsApp p={p} ctx={ctx} />;
    default: return <Sec type="unknown">Unknown block: {block.type}</Sec>;
  }
}

export const RADIUS = { sharp: ['2px', '2px', '2px'], soft: ['14px', '10px', '10px'], round: ['24px', '16px', '14px'], pill: ['24px', '999px', '14px'] };
export const TEXT_SIZES = { sm: '15.5px', md: '17px', lg: '18.5px' };
export function Page({ blocks, theme, ctx }) {
  const style = theme?.style || 'aurora';
  const hf = FONT_CHOICES[theme?.headingFont], bf = FONT_CHOICES[theme?.bodyFont], rad = RADIUS[theme?.radius];
  useEffect(() => { ensureFonts(theme || style); }, [style, theme?.headingFont, theme?.bodyFont]);
  const vars = { '--primary': theme?.primary || '#6366f1', '--secondary': theme?.secondary || theme?.primary || '#ec4899' };
  // site-wide overrides on top of the chosen style
  if (hf) vars['--hf'] = hf.stack;
  if (bf) vars['--bf'] = bf.stack;
  if (rad) { vars['--radius'] = rad[0]; vars['--btnr'] = rad[1]; vars['--inr'] = rad[2]; }
  if (TEXT_SIZES[theme?.textSize]) vars.fontSize = TEXT_SIZES[theme.textSize];
  return (
    <div className={`page s-${style}`} style={vars}>
      {blocks.map((b) => <Block key={b.id} block={b} ctx={ctx} />)}
    </div>
  );
}
