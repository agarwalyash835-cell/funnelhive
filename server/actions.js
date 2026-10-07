// Funnel-editing actions shared by the Claude chat and the offline command parser.
import { uid } from './db.js';
import { shiftHue } from './template-kit.js';

const STYLES = ['aurora', 'midnight', 'luxe', 'fresh', 'bold', 'clean'];
const COLORS = { red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', green: '#16a34a', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', blue: '#2563eb', indigo: '#6366f1', violet: '#7c3aed', purple: '#9333ea', pink: '#ec4899', rose: '#e11d48', maroon: '#9f1239', gold: '#a16207', brown: '#78350f', black: '#111827', saffron: '#ff9933' };
const STYLE_ALIASES = { dark: 'midnight', premium: 'luxe', luxury: 'luxe', elegant: 'luxe', minimal: 'clean', simple: 'clean', playful: 'fresh', friendly: 'fresh', loud: 'bold', brutal: 'bold', light: 'aurora', gradient: 'aurora' };

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
const blk = (type, props) => ({ id: uid(), type, props });
const mainPrice = (f) => {
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'checkout' && b.props.price) return Number(b.props.price);
  for (const s of f.steps) for (const b of s.blocks) if (b.type === 'pricing' && b.props.price) return Number(b.props.price);
  return 999;
};
const round9 = (n) => Math.max(99, Math.round(n / 100) * 100 - 1);

export const DEFAULT_BLOCKS = {
  faq: { eyebrow: 'FAQ', title: 'Questions? We have answers.', items: [{ q: 'How do I get access?', a: 'Instantly after payment, on email and WhatsApp.' }, { q: 'Is there a refund?', a: 'Yes — 7-day money-back guarantee.' }] },
  testimonials: { eyebrow: 'Success stories', title: 'Real people. Real results.', items: [{ name: 'Priya M., Delhi', quote: 'Worth every rupee. Highly recommended!', tag: 'Verified' }, { name: 'Rahul S., Pune', quote: 'Exceeded my expectations.', tag: 'Verified' }, { name: 'Anjali K., Mumbai', quote: 'Simple, clear and effective.', tag: 'Verified' }] },
  countdown: { label: 'Offer ends in', minutes: 30 },
  guarantee: { title: '7-Day Money-Back Guarantee', body: 'Try it risk-free. Not happy? Get a full refund — no questions asked.', days: 7 },
  bonuses: { eyebrow: 'Exclusive bonuses', title: 'Order today and get these FREE', items: [{ icon: '📘', title: 'Quick-start guide', value: '₹999' }, { icon: '🎥', title: 'Bonus video training', value: '₹1,499' }], totalText: 'Total value ₹2,498 — free today' },
  stock: { label: 'Only {n} spots left at this price!', total: 50, left: 9 },
  livecount: { text: 'people are viewing this page right now', min: 24, max: 68 },
  proof: { action: 'just purchased', intervalSec: 9, items: [{ name: 'Rahul S.', city: 'Pune' }, { name: 'Priya M.', city: 'Delhi' }, { name: 'Ankit P.', city: 'Mumbai' }, { name: 'Sneha R.', city: 'Bengaluru' }] },
  hellobar: { messages: [{ text: '🔥 Limited-time offer — today only' }, { text: '⏰ Prices go up at midnight' }] },
  exitpopup: { title: 'Wait — don’t miss this!', body: 'Get an extra 10% OFF if you complete your order now.', code: 'INDIA10', buttonText: 'Claim my discount' },
  stickybar: { text: 'Offer ends soon', price: '₹499', buttonText: 'Buy Now' },
  whatsapp: { number: '919999999999', message: 'Hi! I have a question.', label: 'Chat with us' },
  video: { url: '' },
  stats: { items: [{ value: '10,000+', label: 'happy customers' }, { value: '4.9★', label: 'rating' }, { value: '200+', label: 'cities' }, { value: '95%', label: 'satisfaction' }] },
  steps: { eyebrow: 'How it works', title: 'Get started in 3 simple steps', items: [{ title: 'Sign up', text: 'Takes 2 minutes' }, { title: 'Get access', text: 'Instantly on email & WhatsApp' }, { title: 'See results', text: 'Follow the simple plan' }] },
  cta: { headline: 'Ready to get started?', subheadline: 'Join thousands of happy customers.', buttonText: 'Get Started', note: '🔒 Secure payment · 7-day guarantee' },
  text: { title: 'Heading', body: 'Your copy here.' },
};

export function offerStep(kind, f) {
  const p = mainPrice(f);
  const up = kind === 'upsell';
  const name = up ? 'VIP Upgrade' : 'Lite Upgrade';
  return {
    id: uid(), name: up ? 'Upsell' : 'Downsell', type: kind, slug: kind,
    blocks: [
      blk('offer', {
        progress: up ? 'Step 2 of 3 · Customise your order' : 'Step 2 of 3 · One last chance',
        headline: up ? 'Wait! Upgrade to the *VIP pack* — one-click, no re-entering details' : 'No problem — how about the *Lite version* at a fraction of the price?',
        description: up ? 'Get personal 1-on-1 support, advanced resources and priority access. Only available on this page.' : 'Get the essential resources at a special one-time price. This offer disappears when you leave.',
        productName: name, emoji: up ? '👑' : '🎁', price: round9(up ? p * 0.8 : p * 0.35), mrp: round9(up ? p * 2 : p), currency: '₹',
        bullets: up ? [{ text: 'Personal 1-on-1 sessions' }, { text: 'Advanced resources & templates' }, { text: 'Priority WhatsApp support' }] : [{ text: 'Core resources pack' }, { text: 'Lifetime access' }],
        minutes: 10, acceptText: up ? 'Yes! Add VIP to my order' : 'Yes, add the Lite version', declineText: up ? 'No thanks, I don’t want the upgrade' : 'No thanks, skip this offer',
      }),
    ],
  };
}

export const crossSellBlock = (f) => {
  const p = mainPrice(f);
  return blk('crosssell', {
    title: 'Customers also bought', subtitle: 'Add these to your order with one click — no checkout needed.',
    items: [
      { emoji: '📚', name: 'Advanced Masterclass', desc: 'Go deeper with expert-led sessions.', price: round9(p * 0.5) },
      { emoji: '🧾', name: 'Templates & Checklists Pack', desc: 'Ready-to-use resources to save hours.', price: round9(p * 0.25) },
      { emoji: '💬', name: '30-Day Priority Support', desc: 'Get answers on WhatsApp within an hour.', price: round9(p * 0.3) },
    ],
    buttonText: 'Add to my order',
  });
};

// ---------- applier ----------
const findStep = (f, ref) => f.steps.find((s) => s.id === ref || s.slug === ref || s.type === ref) || null;
const insertAfterType = (f, step, types) => {
  let idx = -1;
  f.steps.forEach((s, i) => { if (types.includes(s.type)) idx = i; });
  const thankIdx = f.steps.findIndex((s) => s.type === 'thankyou');
  const at = idx >= 0 ? idx + 1 : thankIdx >= 0 ? thankIdx : f.steps.length;
  f.steps.splice(at, 0, step);
};
const uniqueSlug = (f, slug) => { let s = slug; while (f.steps.some((x) => x.slug === s)) s += '-2'; return s; };
const normBlocks = (blocks = []) => blocks.map((b) => ({ id: b.id || uid(), type: b.type, props: b.props || {} }));

export function applyActions(f, actions = [], currentStepId) {
  const done = [];
  for (const a of actions) {
    try {
      const step = findStep(f, a.stepId || currentStepId) || f.steps[0];
      switch (a.type) {
        case 'set_theme':
          f.theme = { ...f.theme, ...(a.style && STYLES.includes(a.style) ? { style: a.style } : {}), ...(a.primary ? { primary: a.primary, secondary: a.secondary || shiftHue(a.primary, 38) } : {}), ...(a.secondary ? { secondary: a.secondary } : {}) };
          done.push('Updated the look'); break;
        case 'rename': f.name = a.name; done.push(`Renamed funnel to “${a.name}”`); break;
        case 'add_step': {
          let s;
          if ((a.stepType === 'upsell' || a.stepType === 'downsell') && !a.blocks) s = offerStep(a.stepType, f);
          else s = { id: uid(), name: a.name || a.stepType, type: a.stepType || 'landing', slug: slugify(a.slug || a.name || a.stepType), blocks: normBlocks(a.blocks) };
          s.slug = uniqueSlug(f, s.slug);
          if (a.stepType === 'upsell') insertAfterType(f, s, ['checkout', 'upsell']);
          else if (a.stepType === 'downsell') insertAfterType(f, s, ['upsell', 'downsell', 'checkout']);
          else if (a.stepType === 'checkout') insertAfterType(f, s, ['landing', 'optin', 'sales']);
          else if (a.stepType === 'thankyou') f.steps.push(s);
          else insertAfterType(f, s, ['landing', 'optin', 'sales', 'checkout', 'upsell', 'downsell'].filter((t) => t !== 'thankyou'));
          done.push(`Added ${/^[aeiou]/.test(s.type) ? 'an' : 'a'} ${s.type} step`); break;
        }
        case 'remove_step': {
          const s = findStep(f, a.stepId);
          if (s && f.steps.length > 1) { f.steps = f.steps.filter((x) => x !== s); done.push(`Removed the “${s.name}” step`); }
          break;
        }
        case 'set_blocks': step.blocks = normBlocks(a.blocks); done.push(`Rebuilt the “${step.name}” page`); break;
        case 'add_block': {
          const b = blk(a.blockType, a.props || DEFAULT_BLOCKS[a.blockType] || {});
          const floating = ['proof', 'exitpopup', 'stickybar', 'whatsapp'];
          let at = typeof a.index === 'number' ? a.index : step.blocks.findIndex((x) => floating.includes(x.type) || x.type === 'cta');
          if (at < 0) at = step.blocks.length;
          step.blocks.splice(at, 0, b);
          done.push(`Added ${a.blockType} to “${step.name}”`); break;
        }
        case 'remove_block': {
          const before = step.blocks.length;
          step.blocks = step.blocks.filter((b) => b.id !== a.blockId && b.type !== a.blockType);
          if (step.blocks.length < before) done.push(`Removed ${a.blockType || 'block'} from “${step.name}”`);
          break;
        }
        case 'update_block': {
          const b = step.blocks.find((x) => x.id === a.blockId) || step.blocks.find((x) => x.type === a.blockType);
          if (b) { b.props = { ...b.props, ...a.props }; done.push(`Updated the ${b.type} section`); }
          break;
        }
        case 'update_all': {
          let n = 0;
          for (const s of f.steps) for (const b of s.blocks) if (b.type === a.blockType) { b.props = { ...b.props, ...a.props }; n++; }
          if (n) done.push(`Updated ${n} ${a.blockType} block${n > 1 ? 's' : ''}`);
          break;
        }
      }
    } catch (e) { console.error('action failed', a, e.message); }
  }
  return done;
}

// ---------- offline command parser (works without an API key) ----------
const HELP = `Here's what I can do right now — just ask in plain English:
• "Add an upsell" / "add a downsell" / "add cross-sells to the thank-you page"
• "Add an order bump" · "add FAQ / testimonials / countdown / guarantee / bonuses"
• "Make it dark" · "switch to luxe style" · "change colour to green"
• "Change the headline to …" · "set price to 999" · "rename funnel to …"
• "Remove the countdown" · "add a checkout page"
Add an ANTHROPIC_API_KEY on the server and I can also rewrite copy and redesign whole pages.`;

const BLOCK_WORDS = { faq: 'faq', faqs: 'faq', testimonial: 'testimonials', testimonials: 'testimonials', reviews: 'testimonials', countdown: 'countdown', timer: 'countdown', guarantee: 'guarantee', bonus: 'bonuses', bonuses: 'bonuses', stock: 'stock', scarcity: 'stock', 'live viewers': 'livecount', 'social proof': 'proof', popup: 'exitpopup', 'exit popup': 'exitpopup', 'sticky bar': 'stickybar', whatsapp: 'whatsapp', video: 'video', stats: 'stats', 'how it works': 'steps', 'hello bar': 'hellobar', cta: 'cta', 'call to action': 'cta', text: 'text' };

const checkoutStep = (f) => ({ type: 'add_step', stepType: 'checkout', name: 'Checkout', blocks: [{ type: 'checkout', props: { productName: f.name, description: 'Instant access', price: mainPrice(f), mrp: mainPrice(f) * 3, currency: '₹', bumpEnabled: true, bumpTitle: 'Add the bonus pack', bumpDescription: 'One-time offer — not available later.', bumpPrice: 99, buttonText: 'Pay Securely' } }] });

// Parses one clause ("add an upsell", "make it dark") into actions
function parseClause(m, raw, f, step, state) {
  const actions = [];
  const adding = /\b(add|create|need|want|include|insert|put|set ?up|with)\b/.test(m);
  const removing = /\b(remove|delete|hide|drop|get rid)\b/.test(m);
  if (adding && /(checkout|payment page)/.test(m) || /order bump|bump offer|\bbump\b/.test(m)) {
    if (!state.hasCheckout) { actions.push(checkoutStep(f)); state.hasCheckout = true; }
    else if (/bump/.test(m)) actions.push({ type: 'update_all', blockType: 'checkout', props: { bumpEnabled: true } });
  }
  if (adding && /up-?sell/.test(m)) actions.push({ type: 'add_step', stepType: 'upsell' });
  if (adding && /down-?sell/.test(m)) actions.push({ type: 'add_step', stepType: 'downsell' });
  if (/cross-?sell|also bought/.test(m)) {
    const ty = f.steps.find((s) => s.type === 'thankyou');
    if (ty) actions.push({ type: 'add_block', stepId: ty.id, blockType: 'crosssell', props: crossSellBlock(f).props, index: 1 });
    else actions.push({ type: 'add_step', stepType: 'thankyou', name: 'Thank you', blocks: [{ type: 'thankyou', props: { headline: 'Order confirmed! 🎉', body: 'Details are on your email & WhatsApp.', steps: [] } }, crossSellBlock(f)] });
  }
  if (adding && /thank ?you/.test(m) && !/cross/.test(m) && !f.steps.some((s) => s.type === 'thankyou')) actions.push({ type: 'add_step', stepType: 'thankyou', name: 'Thank you', blocks: [{ type: 'thankyou', props: { headline: 'Thank you! 🎉', body: 'Details are on your email & WhatsApp.', steps: [] } }] });
  for (const [w, type] of Object.entries(BLOCK_WORDS)) {
    if (!new RegExp(`\\b${w}\\b`).test(m)) continue;
    if (removing) actions.push({ type: 'remove_block', blockType: type, stepId: step.id });
    else if (adding) actions.push({ type: 'add_block', blockType: type, stepId: step.id });
  }
  const theme = {};
  const isCopyEdit = /headline|rename|call it|name it/.test(m); // quoted copy may contain words like "fresh" or "gold"
  const styleWord = isCopyEdit ? null : Object.keys(STYLE_ALIASES).find((w) => new RegExp(`\\b${w}\\b`).test(m)) || STYLES.find((x) => m.includes(x));
  if (styleWord && /(make|switch|style|theme|look|use|change|go|more)/.test(m)) theme.style = STYLE_ALIASES[styleWord] || styleWord;
  const hex = m.match(/#[0-9a-f]{6}\b/);
  const colorWord = isCopyEdit ? null : Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(m));
  if ((hex || colorWord) && /(colou?r|brand|primary|accent|make|theme)/.test(m)) theme.primary = hex ? hex[0] : COLORS[colorWord];
  if (Object.keys(theme).length) actions.push({ type: 'set_theme', ...theme });
  const quoted = raw.match(/(?:\bto\b|:)\s*["“']?(.+?)["”']?\s*$/i);
  if (/headline/.test(m) && quoted) actions.push({ type: 'update_block', stepId: step.id, blockType: 'hero', props: { headline: quoted[1] } });
  if (/(rename|call it|name it)/.test(m) && quoted) actions.push({ type: 'rename', name: quoted[1] });
  const price = m.match(/price.*?(?:₹|rs\.?|inr)?\s*(\d[\d,]*)/);
  if (price && /(set|change|make|update)/.test(m)) {
    const n = Number(price[1].replace(/,/g, ''));
    actions.push({ type: 'update_all', blockType: 'pricing', props: { price: n } }, { type: 'update_all', blockType: 'checkout', props: { price: n } });
  }
  return actions;
}

export function parseCommand(msg, f, stepId) {
  const step = findStep(f, stepId) || f.steps[0];
  const state = { hasCheckout: f.steps.some((s) => s.blocks.some((b) => b.type === 'checkout')) };
  // Quoted text (headlines, names) must not be split into clauses
  const clauses = /headline|rename|call it|name it/i.test(msg) ? [msg] : msg.split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|\balso\b)\s*/i).filter(Boolean);
  // "add an upsell and a downsell": a clause without its own verb inherits the previous one
  let verb = '';
  const actions = clauses.flatMap((c) => {
    let m = c.toLowerCase().trim();
    const own = m.match(/^(add|remove|delete|include|make|change|switch|set|create|put|insert|drop)\b/) || m.match(/\b(add|remove|delete|make|change|switch|set|create)\b/);
    if (own) verb = own[1];
    else if (verb) m = `${verb} ${m}`;
    return parseClause(m, c.trim(), f, step, state);
  });
  // Checkout must exist before upsells/downsells are positioned after it
  const order = { checkout: 0, upsell: 1, downsell: 2 };
  return actions.sort((a, b) => (a.type === 'add_step' && b.type === 'add_step' ? (order[a.stepType] ?? 3) - (order[b.stepType] ?? 3) : 0));
}

export function offlineChat(msg, f, stepId) {
  const actions = parseCommand(msg, f, stepId);
  if (!actions.length) return { reply: HELP, actions: [] };
  return { reply: null, actions };
}
