import Anthropic from '@anthropic-ai/sdk';
import { similarTemplates, allTemplates, matchTemplate } from './templates.js';
import { audit, enforce, barText, blueprintOf } from './quality.js';
import { uid } from './db.js';
import { PAGE_STYLES, STYLE_HINTS, variantsText } from './page-styles.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
// kie.ai: one key for many models (DeepSeek, Claude, GPT, Gemini, Kimi…). Takes priority when set.
const KIE_KEY = process.env.KIE_API_KEY || '';
const KIE_MODEL = process.env.KIE_MODEL || 'deepseek-v4-1-flash';
const KIE_BASE = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const TIMEOUT = Number(process.env.AI_TIMEOUT_MS || 240000);
export const aiEnabled = () => !!(KIE_KEY || client);
export const aiProvider = () => (KIE_KEY ? `kie.ai · ${KIE_MODEL}` : client ? `Anthropic · ${MODEL}` : null);

// One call to whichever model is configured → the model's text
async function kie(system, messages, json) {
  const m = KIE_MODEL;
  let url, body, pick;
  if (m.startsWith('claude-')) {
    url = `${KIE_BASE}/claude/v1/messages`;
    body = { model: m, system, messages, max_tokens: 16000, stream: false };
    pick = (d) => (d.content || []).map((c) => c.text || '').join('');
  } else if (m.startsWith('gemini-')) {
    url = `${KIE_BASE}/gemini/v1/models/${m}:streamGenerateContent`;
    body = { stream: false, contents: messages.map((x, i) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: i === 0 ? `${system}\n\n${x.content}` : x.content }] })) };
    pick = (d) => (Array.isArray(d) ? d : [d]).flatMap((c) => c.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  } else {
    url = `${KIE_BASE}/${m.startsWith('gpt-') ? 'codex' : 'openai'}/v1/responses`;
    body = { model: m, instructions: system, input: messages.map((x) => ({ role: x.role, content: x.content })), stream: false, ...(json ? { text: { format: { type: 'json_object' } } } : {}) };
    pick = (d) => (d.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).map((c) => c.text || '').join('');
  }
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const d = await r.json().catch(() => ({}));
  const text = pick(d);
  // kie.ai reports some errors with HTTP 200 and { code, msg }
  if (!r.ok || !text) throw new Error(`AI service: ${d.msg || d.error?.message || `HTTP ${r.status}`}${/not authorized/i.test(d.msg || '') ? ` — enable ${m} for this key on kie.ai or set KIE_MODEL` : ''}`);
  return text;
}
// Hive AI: raw Responses-API call with tool definitions (kie.ai models other than Claude / Gemini)
export const hiveReady = () => !!KIE_KEY && !KIE_MODEL.startsWith('claude-') && !KIE_MODEL.startsWith('gemini-');
export async function kieResponses({ instructions, input, tools, signal }) {
  const url = `${KIE_BASE}/${KIE_MODEL.startsWith('gpt-') ? 'codex' : 'openai'}/v1/responses`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: KIE_MODEL, instructions, input, tools, stream: false }), signal: signal || AbortSignal.timeout(TIMEOUT) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(d.output)) throw new Error(`AI service: ${d.msg || d.error?.message || `HTTP ${r.status}`}`);
  return d;
}

async function complete(system, messages, { json = true } = {}) {
  if (KIE_KEY) return kie(system, messages, json);
  const res = await client.messages.create({ model: MODEL, max_tokens: 8000, system, messages });
  return res.content.map((c) => c.text || '').join('');
}

// ---------- what the AI "knows": our template library ----------
const SKIP = new Set(['id']);
// trimmed copy of a value: long lists cut to n items, long strings shortened — keeps prompts small
const trim = (v, n = 4, len = 400) => (Array.isArray(v) ? v.slice(0, n).map((x) => trim(x, n, len)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !SKIP.has(k)).map(([k, x]) => [k, trim(x, n, len)])) : typeof v === 'string' && v.length > len ? `${v.slice(0, len)}…` : v);
// One excellent example of every block type, taken from the templates (built once)
let GALLERY = null;
function blockGallery() {
  if (GALLERY) return GALLERY;
  const seen = {};
  for (const t of allTemplates()) for (const st of t.steps) for (const b of st.blocks) if (!seen[b.type]) seen[b.type] = trim(b.props, 3, 240);
  GALLERY = JSON.stringify(Object.entries(seen).map(([type, props]) => ({ type, props })));
  return GALLERY;
}
const KNOWN_TYPES = () => new Set([...allTemplates().flatMap((t) => t.steps.flatMap((st) => st.blocks.map((b) => b.type))), 'section', 'image', 'gallery', 'spacer', 'divider', 'html', 'form', 'text', 'video']);
const exampleFunnel = (t) => JSON.stringify({ name: t.name, theme: t.theme, steps: t.steps.map((st) => ({ name: st.name, type: st.type, slug: st.slug, blocks: st.blocks.map((b) => ({ type: b.type, props: trim(b.props, 4, 300) })) })) });
const knowledge = () => `\n\nREFERENCE — one example of every block from our best-performing template library. Match this level of specificity, structure and Indian-market tone (don't copy the wording):\n${blockGallery()}`;

export const BLOCK_SPEC = `Block types and their props (all strings unless noted):
- hero: headline, subheadline, ctaText, image (url or "")
- features: title, items: [{title, text}]
- testimonials: title, items: [{name, quote}]
- video: url
- text: title, body
- countdown: label, minutes (number)
- optin: title, subtitle, buttonText, askPhone (boolean)
- checkout: productName, description, price (number), currency, bumpEnabled (boolean), bumpTitle, bumpDescription, bumpPrice (number), buttonText
- offer: progress, headline, description, productName, emoji, price (number), mrp (number), currency, bullets: [{text}], minutes (number), acceptText, declineText   (use on upsell/downsell steps)
- crosssell: title, subtitle, items: [{emoji, name, desc, price (number)}], buttonText   (one-click add-ons, usually on the thank-you page)
- section: a free-form section. layout ('1' | '1-1' | '2-1' | '1-2' | '1-1-1' | '1-1-1-1'), valign ('top'|'center'), gap ('sm'|'md'|'lg'), columns: [{elements: [{type, props}]}]. Element types: heading {text, level 'h1'|'h2'|'h3', align}, text {text, size 'sm'|'md'|'lg', align}, button {label, action 'next'|'url'|'scroll', url, variant 'primary'|'outline', align, full (bool)}, image {src, alt, link, rounded, shadow}, list {items: [{text}], icon 'check'|'dot'|'num'}, price {price, mrp, currency, note}, video {url}, spacer {height}, divider {style}
- Any block may include props._style: {bg '#hex', bgImage url, overlay 0-80, textColor '#hex', padTop/padBottom 'none'|'sm'|'md'|'lg'|'xl', width 'narrow'|'wide'|'full', align 'left'|'center', hideMobile, hideDesktop, anchor}
- faq: title, items: [{q, a}]
- cta: headline, buttonText
- thankyou: headline, body
- pricing: badge, mrp (number), price (number), currency, bullets: [{text}], buttonText, note
- hellobar: messages: [{text}]   (FOMO, rotates every 9-10s)
- livecount: text, min (number), max (number)   (FOMO live viewers)
- stock: label (use {n} placeholder), total (number), left (number)
- proof: action, intervalSec (number, >=9), items: [{name, city}]   (FOMO popup; use Indian names/cities)
- exitpopup: title, body, code, buttonText
- stickybar: text, price, buttonText
- whatsapp: number, message, label
Landing-page block types (use them for rich 12+ section pages):
- stats: items: [{value, label}]
- problem: eyebrow, title, subtitle, items: [{text}], closing
- features items may include icon (emoji)
- steps: eyebrow, title, items: [{title, text}]
- compare: eyebrow, title, leftTitle, rightTitle, rows: [{left, right}]
- mentor: eyebrow, name, role, bio, points: [{text}]
- bonuses: eyebrow, title, items: [{icon, title, value}], totalText
- guarantee: title, body, days (number)
- cta also accepts subheadline, note. hero also accepts secondaryText, socialText, rating, reviews, cardEmoji, cardTitle, cardPrice, cardMrp, cardPoints [{text}], chip1, chip2. Wrap words in *stars* in headlines to highlight.
Section layouts: most sections take props.variant to pick their design — ${variantsText()}. Mix layouts so the page has rhythm (e.g. a centred hero, a numbered zigzag of features, a WhatsApp-chat testimonial wall) and fit them to the business; follow the example's choices unless the brief suggests better.
Theme: {"style": one of ${PAGE_STYLES.join('|')}, "primary": "#hex", "secondary": "#hex"}. Styles: ${Object.entries(STYLE_HINTS).map(([k, v]) => `${k} (${v})`).join('; ')}.
Audience defaults to India: use ₹ prices, Indian names/cities, UPI/COD mentions. hero also accepts badge.
Step types: landing, optin, sales, checkout, upsell, downsell, thankyou.`;

function extractJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('AI returned no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

// Ask for JSON; one automatic retry when the answer isn't valid JSON
async function ask(system, user, history = []) {
  const messages = [...history, { role: 'user', content: user }];
  const text = await complete(system, messages);
  try { return extractJson(text); } catch {
    const again = await complete(system, [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the complete, valid JSON object.' }]);
    return extractJson(again);
  }
}

const withIds = (blocks = []) => blocks.map((b) => ({ id: uid(), type: b.type, props: b.props || {} }));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';

function normalizeFunnel(f) {
  const used = new Set();
  return {
    name: f.name || 'New funnel',
    theme: { style: 'aurora', primary: '#6366f1', secondary: '#ec4899', ...(f.theme || {}) },
    steps: (f.steps || []).map((s, i) => {
      let slug = slugify(s.slug || s.name || `step-${i + 1}`);
      while (used.has(slug)) slug += '-2';
      used.add(slug);
      return { id: uid(), name: s.name || `Step ${i + 1}`, type: s.type || 'landing', slug, blocks: withIds(s.blocks) };
    }),
  };
}

// ---------- generation with a quality gate ----------
// 1. first draft from the model, given the closest template as a worked example + the exact quality bar
// 2. audit against the bar measured from our templates (quality.js)
// 3. up to two targeted repair passes by the model, fed the exact problems
// 4. anything still below the bar is topped up from the closest template (already personalised)
const MAX_REPAIRS = Number(process.env.AI_REPAIR_PASSES ?? 2);
const summarise = (issues) => issues.map((i) => `- ${i.s == null ? 'funnel' : `step ${i.s + 1}${i.b == null ? '' : ` block ${i.b + 1}`}`} (${i.type}): ${i.msg}`).join('\n');

async function repair(system, f, issues) {
  // structure problems (missing pages / sections / wrong order): the model rewrites the funnel
  if (issues.some((i) => i.b == null)) {
    return ask(system, `Here is a funnel you generated:\n${JSON.stringify(f)}\n\nIt fails the quality bar:\n${summarise(issues)}\n\nReturn the COMPLETE corrected funnel JSON (same format), fixing every problem and keeping everything that was already good.`);
  }
  // content problems: only the failing blocks go back, the rest is untouched
  const targets = [...new Map(issues.map((i) => [`${i.s}.${i.b}`, i])).values()].map((i) => ({ step: i.s, index: i.b, type: f.steps[i.s].blocks[i.b].type, props: f.steps[i.s].blocks[i.b].props, problems: issues.filter((x) => x.s === i.s && x.b === i.b).map((x) => x.msg) }));
  const out = await ask(system, `These blocks of the funnel "${f.name}" fail the quality bar. The checkout price is ${JSON.stringify(f.steps.flatMap((st) => st.blocks).find((x) => x.type === 'checkout')?.props?.price ?? null)}.\n${JSON.stringify(targets)}\n\nReturn ONLY JSON {"fixes":[{"step":number,"index":number,"props":{...complete corrected props...}}]} with one entry per block above, fixing every listed problem.`);
  const next = structuredClone(f);
  for (const fx of out.fixes || []) {
    const blk = next.steps[fx.step]?.blocks?.[fx.index];
    if (blk && fx.props && typeof fx.props === 'object') blk.props = { ...blk.props, ...fx.props };
  }
  return next;
}

export async function generateFunnel(prompt) {
  if (!aiEnabled()) return normalizeFunnel(templateFunnel(prompt));
  const [closest] = similarTemplates(prompt, 1);
  const blueprint = blueprintOf(closest);
  const system = `You are an expert direct-response funnel strategist and copywriter for Indian businesses. Design a complete, high-converting funnel from the user's business description. Respond with ONLY valid JSON:
{"name": string, "theme": {"style": string, "primary": "#hex", "secondary": "#hex"}, "steps": [{"name": string, "type": string, "slug": string, "blocks": [{"type": string, "props": {...}}]}]}
Write persuasive, specific copy for THIS business (never generic), realistic Indian prices, Indian names and cities.
${BLOCK_SPEC}

EXAMPLE — a complete funnel from our template library for a similar business ("${closest.name}"). Match its structure, section order, depth and quality exactly, but write completely new copy, names, prices and offers for the user's business:
${exampleFunnel(closest)}

${barText(blueprint)}`;
  const report = { model: aiProvider(), template: closest.id, firstDraftIssues: null, repairPasses: 0, filledFromTemplate: [], finalIssues: null };
  let best = null, bestIssues = null;
  const consider = (f) => {
    if (!f || !Array.isArray(f.steps)) return;
    const known = KNOWN_TYPES();
    for (const st of f.steps) st.blocks = (st.blocks || []).filter((x) => x && known.has(x.type) && x.props && typeof x.props === 'object');
    const iss = audit(f, blueprint);
    if (!best || iss.length < bestIssues.length) { best = f; bestIssues = iss; }
  };
  for (let attempt = 0; attempt < 2 && !best; attempt++) {
    try { consider(await ask(system, prompt)); } catch (e) { console.warn('AI funnel generation failed:', e.message); if (/not authorized|401|API key/i.test(e.message)) break; }
  }
  if (!best) return Object.assign(normalizeFunnel(matchTemplate(prompt)), { fallback: true, quality: { ...report, fallback: true } });
  report.firstDraftIssues = bestIssues.length;
  for (let pass = 0; pass < MAX_REPAIRS && bestIssues.length; pass++) {
    report.repairPasses++;
    try { consider(await repair(system, best, bestIssues)); } catch (e) { console.warn('AI repair pass failed:', e.message); }
  }
  // guarantee: never below the template bar
  const f = structuredClone(best);
  if (bestIssues.length) report.filledFromTemplate = enforce(f, matchTemplate(prompt), blueprint);
  const final = audit(f, blueprint);
  report.finalIssues = final.length;
  report.remaining = final.map((i) => `${i.type}: ${i.msg}`);
  if (final.length) console.warn('AI funnel still below the bar after top-up:', summarise(final));
  console.log(`AI funnel "${f.name}": ${report.firstDraftIssues} issue(s) in first draft → ${bestIssues.length} after ${report.repairPasses} repair pass(es) → ${final.length} after template top-up (${report.filledFromTemplate.length} field(s) filled)`);
  return Object.assign(normalizeFunnel(f), { quality: report });
}

export async function editBlocks(step, theme, instruction) {
  if (!aiEnabled()) throw new Error('Set KIE_API_KEY (or ANTHROPIC_API_KEY) on the server to use the AI editor.');
  const system = `You edit funnel pages. You get the current page JSON and an instruction. Return ONLY JSON: {"blocks":[{"type":string,"props":{...}}]} containing the full updated block list (keep unchanged blocks as-is, preserve their "id" if present). Keep copy high-converting.
${BLOCK_SPEC}${knowledge()}`;
  const out = await ask(system, `Page "${step.name}" (${step.type}) blocks:\n${JSON.stringify(step.blocks)}\n\nInstruction: ${instruction}`);
  return (out.blocks || []).map((b) => ({ id: b.id || uid(), type: b.type, props: b.props || {} }));
}

// Offline fallback so the app works without an API key.
function templateFunnel(prompt) {
  const topic = prompt.trim().slice(0, 60) || 'Your Offer';
  const name = topic.charAt(0).toUpperCase() + topic.slice(1);
  return {
    name: `${name} funnel`,
    steps: [
      {
        name: 'Landing page', type: 'landing', slug: 'start',
        blocks: [
          { type: 'hero', props: { headline: `Finally: ${name}, made simple`, subheadline: 'Join thousands who got results in days, not months.', ctaText: 'Get Instant Access', image: '' } },
          { type: 'features', props: { title: 'What you get', items: [{ title: 'Step-by-step system', text: 'A clear path from start to result.' }, { title: 'Done-for-you templates', text: 'Copy, paste and launch.' }, { title: 'Bonus community', text: 'Support when you need it.' }] } },
          { type: 'testimonials', props: { title: 'Real results', items: [{ name: 'Priya S.', quote: 'This changed how I work.' }, { name: 'Marcus T.', quote: 'Paid for itself in a week.' }] } },
          { type: 'countdown', props: { label: 'Launch pricing ends in', minutes: 30 } },
          { type: 'cta', props: { headline: 'Ready to start?', buttonText: 'Yes, I want in' } },
        ],
      },
      {
        name: 'Checkout', type: 'checkout', slug: 'checkout',
        blocks: [{ type: 'checkout', props: { productName: name, description: 'Instant digital access', price: 499, currency: '₹', bumpEnabled: true, bumpTitle: 'Add the quick-start checklist', bumpDescription: 'One-page checklist to get results faster.', bumpPrice: 99, buttonText: 'Complete Order' } }],
      },
      {
        name: 'Upsell', type: 'upsell', slug: 'upsell',
        blocks: [{ type: 'offer', props: { headline: 'Wait! Add the Pro Toolkit', description: 'Fast-track results with advanced templates and live support.', price: 999, acceptText: 'Yes, add to my order', declineText: 'No thanks' } }],
      },
      {
        name: 'Downsell', type: 'downsell', slug: 'downsell',
        blocks: [{ type: 'offer', props: { headline: 'How about the Lite Toolkit?', description: 'A smaller bundle at a lower price.', price: 399, acceptText: 'Add Lite version', declineText: 'No thanks' } }],
      },
      {
        name: 'Thank you', type: 'thankyou', slug: 'thank-you',
        blocks: [{ type: 'thankyou', props: { headline: 'You are in!', body: 'Check your email for access details.' } }],
      },
    ],
  };
}

// ---------- conversational builder ----------
const ACTION_SPEC = `Actions you can return (applied in order):
- {"type":"set_theme","style"?,"primary"?,"secondary"?}
- {"type":"rename","name"}
- {"type":"add_step","stepType":"landing|optin|sales|checkout|upsell|downsell|thankyou","name"?,"blocks"?:[{type,props}]}  (omit blocks for upsell/downsell to use a ready-made offer page)
- {"type":"remove_step","stepId"}
- {"type":"set_blocks","stepId","blocks":[{type,props}]}   (replace a whole page)
- {"type":"add_block","stepId","blockType","props"?,"index"?}
- {"type":"remove_block","stepId","blockId"}
- {"type":"update_block","stepId","blockId","props"}   (merge props)
- {"type":"update_all","blockType","props"}   (merge props into every block of that type)`;

export async function chatAI(funnel, stepId, message, history = []) {
  const slim = { name: funnel.name, theme: funnel.theme, steps: funnel.steps.map((s) => ({ id: s.id, name: s.name, type: s.type, slug: s.slug, blocks: s.id === stepId ? s.blocks : s.blocks.map((b) => ({ id: b.id, type: b.type })) })) };
  const system = `You are FunnelHive's AI funnel strategist. The user edits a sales funnel by chatting with you. Decide what to change and reply with ONLY JSON: {"reply": "short friendly message (1-3 sentences) explaining what you did and one smart next suggestion", "actions": [...]}.
If the user just asks a question, return an empty actions list and answer in reply. Keep copy persuasive, specific and India-focused (₹, UPI, Indian names).
${ACTION_SPEC}
${BLOCK_SPEC}${knowledge()}`;
  const msgs = [
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: `Current funnel (full blocks shown only for the step being viewed, id ${stepId}):\n${JSON.stringify(slim)}\n\nUser: ${message}` },
  ];
  const last = msgs.pop();
  return ask(system, last.content, msgs);
}

// ---------- AI marketing agents ----------
export const AGENTS = {
  ads: { name: 'Ad Copywriter', icon: '📣', desc: 'Facebook & Instagram ad variations' },
  email: { name: 'Email Sequence Writer', icon: '✉️', desc: '5-email launch & nurture sequence' },
  whatsapp: { name: 'WhatsApp Broadcasts', icon: '💬', desc: 'Short broadcast messages that convert' },
  social: { name: 'Social Captions', icon: '📸', desc: 'Instagram & LinkedIn captions with hashtags' },
  headlines: { name: 'Headline Generator', icon: '🎯', desc: '10 scroll-stopping headline options' },
  video: { name: 'Reels Script Writer', icon: '🎬', desc: '60-second Reels / Shorts script' },
  seo: { name: 'SEO Optimiser', icon: '🔎', desc: 'Meta title, description & keywords' },
  abandon: { name: 'Cart Recovery Writer', icon: '🛒', desc: 'Abandoned-cart email & WhatsApp follow-ups' },
};

function agentFallback(kind, { product, price, headline, audience }) {
  const p = `₹${Number(price || 0).toLocaleString('en-IN')}`;
  const tag = product.replace(/[^a-z0-9]/gi, '');
  const T = {
    ads: [
      `🔥 ${headline}\n\n${product} — now just ${p}. Thousands across India have already joined.\n👉 Tap "Learn More" before the offer ends.`,
      `Tired of trying everything and getting nowhere?\n${product} gives you a proven, step-by-step system.\n✅ Instant access ✅ UPI accepted ✅ 7-day money-back\nOnly ${p} today.`,
      `"Best decision I made this year" — Priya, Delhi ⭐⭐⭐⭐⭐\n${product} is ${p} for a limited time. Grab your spot 👇`,
    ],
    email: [
      `Email 1 · Subject: Welcome! Here's what happens next\nHi {name}, thanks for joining. Over the next few days I'll show you exactly how ${product} helps ${audience}…`,
      `Email 2 · Subject: The #1 mistake most people make\nMost people try to figure it out alone. Here's why that fails — and what to do instead…`,
      `Email 3 · Subject: How Rahul from Pune got results in 21 days\nA quick story you'll relate to…`,
      `Email 4 · Subject: Your questions, answered\nIs it right for me? Do you accept UPI? Is there a refund? Yes, yes and yes…`,
      `Email 5 · Subject: ⏰ Last chance — price goes up tonight\n${product} is ${p} only until midnight. After that it goes back to full price.`,
    ],
    whatsapp: [
      `Hi {name} 👋 Quick update — ${product} is just ${p} today (limited seats). Reply YES and I'll send you the link.`,
      `🔥 Only a few spots left for ${product}! 1,000+ people joined this month. Grab yours: {link}`,
      `⏰ Final reminder: the ${p} offer ends at midnight. Any questions? Just reply here 🙂`,
    ],
    social: [
      `${headline} 💯\n\nSave this post & share it with someone who needs it 👇\n#India #${tag} #growth #learning`,
      `POV: you finally found something that actually works 🙌\n${product} — link in bio.\n#trending #indiansuccess #motivation`,
    ],
    headlines: [
      headline,
      'The simplest way to get results — even if you have failed before',
      `How thousands of Indians are winning with ${product}`,
      'Stop wasting time. Start getting results in 21 days.',
      'What nobody tells you about getting results fast',
      `${product}: the shortcut the experts don't talk about`,
      'From stuck to unstoppable — in just a few weeks',
      `Why ${audience} across India are switching to ${product}`,
      'Get results in days, not months — guaranteed',
      'Finally, a proven plan that fits your busy life',
    ],
    video: [`HOOK (0–3s): "If you're still struggling with this, stop scrolling."\nPROBLEM (3–15s): Most people try random tips and give up.\nSOLUTION (15–40s): ${product} gives you a step-by-step plan — live support, UPI payments, 7-day guarantee.\nPROOF (40–50s): "Priya from Delhi got results in 3 weeks."\nCTA (50–60s): "Link in bio — just ${p} today."`],
    seo: [
      `Meta title: ${product} | Trusted by thousands across India`,
      `Meta description: ${product} — just ${p} with UPI, instant access and a 7-day money-back guarantee. Join thousands of happy customers.`,
      `Keywords: ${product.toLowerCase()}, best ${product.toLowerCase()} in india, ${product.toLowerCase()} online, ${product.toLowerCase()} price`,
    ],
    abandon: [
      `After 1 hour (WhatsApp): Hi {name}, you left ${product} in your cart 🛒 Your ${p} price is still reserved — complete here: {link}`,
      `After 24 hours (Email) · Subject: Did something go wrong?\nNo worries! If you had a payment issue, you can pay with any UPI app. Here's your link…`,
      `After 48 hours (Email) · Subject: Here's 10% OFF to help you decide\nUse code INDIA10 at checkout — valid for 24 hours only.`,
    ],
  };
  return T[kind] || [];
}

export async function runAgent(kind, ctx) {
  if (!aiEnabled()) return { outputs: agentFallback(kind, ctx), usedAI: false };
  const a = AGENTS[kind];
  const out = await ask(
    `You are an expert Indian direct-response marketer acting as the "${a.name}" (${a.desc}). Write in natural Indian English (Hinglish words are fine where natural). Respond with ONLY JSON: {"outputs": [string, ...]} — each string is one complete, ready-to-use piece.`,
    `Product: ${ctx.product}\nPrice: ₹${ctx.price}\nMain promise: ${ctx.headline}\nAudience: ${ctx.audience}\nExtra instructions: ${ctx.extra || 'none'}`
  );
  return { outputs: out.outputs || [], usedAI: true };
}
