import Anthropic from '@anthropic-ai/sdk';
import { similarTemplates, allTemplates, matchTemplate, parsePrompt } from './templates.js';
import { audit, enforce, barText, blueprintOf, qualityBar, trimTemplate } from './quality.js';
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
  // the provider's details go to the server log only — sellers see FunnelHive's AI, never the vendor or model
  if (!r.ok || !text) { console.error('AI request failed:', m, d.msg || d.error?.message || `HTTP ${r.status}`); throw new Error('The AI is busy right now — please try again in a minute'); }
  return text;
}
// Hive AI: raw Responses-API call with tool definitions (kie.ai models other than Claude / Gemini)
export const hiveReady = () => !!KIE_KEY && !KIE_MODEL.startsWith('claude-') && !KIE_MODEL.startsWith('gemini-');
// A hiccup (rate limit, server error, dropped connection, timeout) is retried twice with a short, growing wait —
// one blip in the middle of a long Hive turn shouldn't throw away the whole turn. A stop from the user is never retried.
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const waitFor = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(signal.reason || new Error('Stopped'));
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason || new Error('Stopped')); }, { once: true });
});
export async function kieResponses({ instructions, input, tools, signal, retries = 2, backoffMs = 1500, timeoutMs = TIMEOUT }) {
  const url = `${KIE_BASE}/${KIE_MODEL.startsWith('gpt-') ? 'codex' : 'openai'}/v1/responses`;
  const body = JSON.stringify({ model: KIE_MODEL, instructions, input, tools, stream: false });
  for (let attempt = 0; ; attempt++) {
    let r, d, err;
    try {
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }, body, signal: sig });
      d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d.output)) return d;
      err = new Error(`AI service: ${d.msg || d.error?.message || `HTTP ${r.status}`}`);
    } catch (e) { if (signal?.aborted) throw e; err = e; }
    const again = !r || RETRY_STATUS.has(r.status);
    if (!again || attempt >= retries) throw err;
    const after = Number(r?.headers.get('retry-after')) * 1000;
    await waitFor(Math.min(after > 0 ? after : backoffMs * 2 ** attempt + Math.random() * 400, 15000), signal);
  }
}

// ---------- images (kie.ai market models: create a task, poll it, download the result) ----------
const IMAGE_MODEL = process.env.KIE_IMAGE_MODEL || 'google/nano-banana';
export const IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:5', '5:4', '3:4', '4:3', '3:2', '2:3', '21:9'];
export const imagesReady = () => !!KIE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// → { buf, type } — kie.ai keeps results for 14 days, so the caller stores the bytes itself
export async function generateImage(prompt, { aspect = '16:9', timeoutMs = 150000, pollMs = 2500 } = {}) {
  if (!KIE_KEY) throw new Error('AI images aren’t switched on yet');
  const p = String(prompt || '').trim().slice(0, 1500);
  if (p.length < 3) throw new Error('Describe the image you want');
  const auth = { Authorization: `Bearer ${KIE_KEY}` };
  const c = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model: IMAGE_MODEL, input: { prompt: p, output_format: 'png', aspect_ratio: IMAGE_ASPECTS.includes(aspect) ? aspect : '16:9' } }),
  });
  const cd = await c.json().catch(() => ({}));
  const taskId = cd?.data?.taskId;
  if (!c.ok || cd.code !== 200 || !taskId) throw new Error(`AI image service: ${cd.msg || `HTTP ${c.status}`}`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(pollMs);
    const r = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth, signal: AbortSignal.timeout(20000) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    const st = d?.data?.state;
    if (st === 'fail') throw new Error(`The image couldn’t be made: ${d.data.failMsg || 'the AI service refused it'}`);
    if (st !== 'success') continue;
    let url;
    try { url = JSON.parse(d.data.resultJson || '{}').resultUrls?.[0]; } catch {}
    if (!/^https?:\/\//.test(url || '')) throw new Error('The AI service returned no image');
    const img = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await img.arrayBuffer());
    if (!img.ok || !buf.length) throw new Error('Couldn’t download the image');
    if (buf.length > 8 * 1024 * 1024) throw new Error('The image came back too large');
    // the type from the bytes themselves, not the header
    const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!type) throw new Error('The AI service returned something that isn’t an image');
    return { buf, type };
  }
  throw new Error('The image is taking too long — please try again');
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
const keepFor = (type, props) => Object.fromEntries(Object.entries(props).filter(([k]) => !SKIP.has(k)).map(([k, v]) => [k, Array.isArray(v) ? trim(v, Math.max(4, qualityBar().mins[`${type}.${k}`] || 0), 300) : trim(v, 4, 300)]));
const exampleFunnel = (t) => JSON.stringify({ name: t.name, theme: t.theme, steps: t.steps.map((st) => ({ name: st.name, type: st.type, slug: st.slug, blocks: st.blocks.map((b) => ({ type: b.type, props: keepFor(b.type, b.props) })) })) });
const knowledge = () => `\n\nREFERENCE — one example of every block from our best-performing template library. Match this level of specificity, structure and Indian-market tone (don't copy the wording):\n${blockGallery()}`;

export const BLOCK_SPEC = `Block types and their props (all strings unless noted):
- hero: headline, subheadline, ctaText, image (url or "")
- features: title, items: [{title, text}]
- testimonials: title, items: [{name, quote}]
- video: url
- text: title, body
- countdown: label, mode ("session" on webinar pages: counts down to the next live session; "fixed" + endsAt (ms timestamp) only for a real deadline the seller gave you). Never invent a deadline or a timer that restarts — no countdown on sales or checkout pages without a real date
- optin: eyebrow, title, subtitle, buttonText, askPhone (boolean), points: [{text}], productId (leave "" — the seller picks a free product to send on sign-up). On a webinar registration page add webinarId: "" — sign-ups then get a seat in the next live session, a personal joining link and reminders.
- form (applications, surveys): title, subtitle, fields: [{label, type 'text'|'email'|'tel'|'number'|'select'|'textarea'|'checkbox', required (bool), options "A, B, C" (select only), reject "A" (select only: answers that mean "not a fit")}], buttonText, after 'message'|'next', successMessage, rejectMessage (kind words for applicants who aren't a fit), note. Always include Full name, Email and WhatsApp fields, then 3–4 qualifying select questions with reject rules on budget/readiness.
- quiz (quiz funnels — use when the seller asks for a quiz/assessment, as the first block of the first page): title (use *word* for the highlight), subtitle, startText, scoring 'outcome', questions: [{q, answers: [{text, outcome (0-based index of the result it points to), tag (optional, lowercase-hyphenated, e.g. "high-budget")}]}] (4–6 questions, 3–4 answers each, every result reachable), outcomes: [{title, body (2 sentences: what it means + what you recommend), buttonText, url "", tag "quiz-…"}] (2–4 results), contact 'both', askName true, gateTitle, gateText, buttonText, note. Put the step the results lead to (booking or offer) as the next page.
- checkout: productName, description, price (number), currency ("₹" default; "$" "€" "£" for buyers abroad), bumpEnabled (boolean), bumpTitle, bumpDescription, bumpPrice (number), buttonText (words only, e.g. "Enrol now" — never a price: the live total is added automatically). Optional: billing ("monthly" | "yearly" for a membership, price is per period), planEnabled + planCount + planPrice (an EMI-style monthly plan next to pay-in-full, e.g. 3 × 10999 for a 29999 programme), shipping ("address" for physical products) + shippingFee, cod (true to offer Cash on Delivery, ₹ only) + codFee. productId / bumpProductId: leave "" (the seller attaches the digital product that's delivered after payment)
- offer: progress, headline, description, productName, emoji, price (number), mrp (number), currency, bullets: [{text}], minutes (number, 0 = no timer; a timer really ends the offer), acceptText, declineText ("No thanks" — never guilt-tripping like "No thanks, I'll pay full price")   (use on upsell/downsell steps)
- crosssell: title, subtitle, items: [{emoji, name, desc, price (number)}], buttonText   (one-click add-ons, usually on the thank-you page)
- section: a free-form section. layout ('1' | '1-1' | '2-1' | '1-2' | '1-1-1' | '1-1-1-1'), valign ('top'|'center'), gap ('sm'|'md'|'lg'), columns: [{elements: [{type, props}]}]. Element types: heading {text, level 'h1'|'h2'|'h3', align}, text {text, size 'sm'|'md'|'lg', align}, button {label, action 'next'|'url'|'scroll', url, variant 'primary'|'outline', align, full (bool)}, image {src, alt, link, rounded, shadow}, list {items: [{text}], icon 'check'|'dot'|'num'}, price {price, mrp, currency, note}, video {url}, spacer {height}, divider {style}
- Any block may include props._style: {bg '#hex', bgImage url, overlay 0-80, textColor '#hex', padTop/padBottom 'none'|'sm'|'md'|'lg'|'xl', width 'narrow'|'wide'|'full', align 'left'|'center', hideMobile, hideDesktop, anchor}
- faq: title, items: [{q, a}]
- cta: headline, buttonText
- thankyou: headline, body, steps: [{text}] (what happens next)
- booking (a booking calendar — the "book your call" step after an application): calendarId (leave ""), eyebrow, title, subtitle, buttonText, successTitle, successText, qualifiedOnly (bool)
- pricing: badge, mrp (number), price (number), currency, bullets: [{text}], buttonText, note
- hellobar: messages: [{text}]   (rotates every 9-10s; no made-up deadlines like "ends tonight" or "only 3 left")
- livecount: minShow (number)   (shows the page's real visitors in the last 30 minutes — only add when asked)
- stock: label (use {n} placeholder), left (number), total (number)   (only with a real stock count the seller gave you — otherwise leave it out)
- proof: intervalSec (number, >=9)   (popup of the funnel's real recent orders — no names to write; sales and checkout pages only)
- exitpopup: title, body, code, buttonText   (no fake urgency in the title)
Never invent urgency or social proof (India's Consumer Protection rules on dark patterns): no fake deadlines, resetting timers, stock, viewer counts or buyers, and no confirmshaming decline text.
- stickybar: text, price, buttonText
- whatsapp: number, message, label
- navbar: brand, logo (image link or ""), links [{label, to}], buttonText, buttonTo   (website header menu: "to" is another page of this funnel by its slug — "" = the first page — or #section or a full link; put it FIRST on every page of a website)
- footer: brand, text, links [{label, to}], note   (website footer, LAST on the page)
Buttons (hero ctaAction, cta / pricing buttonAction) can be "page" with the page slug in ctaUrl / buttonUrl to open another page of the same funnel.
Landing-page block types (use them for rich 12+ section pages):
- stats: items: [{value, label}]
- problem: eyebrow, title, subtitle, items: [{text}], closing
- features items may include icon (emoji)
- steps: eyebrow, title, items: [{title, text}]
- compare: eyebrow, title, leftTitle, rightTitle, rows: [{left, right}]
- mentor: eyebrow, name, role, bio, points: [{text}]
- bonuses: eyebrow, title, items: [{icon, title, value}], totalText
- guarantee: title, body, days (number)
- cta also accepts subheadline, note. hero also accepts secondaryText, socialText, rating, reviews, cardEmoji, cardTitle, cardPrice, cardMrp, cardPoints [{text}], chip1, chip2, cardTag. Wrap words in *stars* in headlines to highlight.
- hero variants video | videosplit | cinema (video sales letters) also take: videoUrl (leave ""), videoNote ("Watch the free 14-minute breakdown"), videoLength ("14:32"); cardPoints become chapters written "01:10 · Chapter title"; cardPrice "By application".
- hero variants event | stage | poster (webinars, live events) also take: eventDate ("This Sunday" — never a calendar date), eventTime ("7:00 PM IST"), eventLength ("90 min · Live on Zoom"), hostName, hostRole, cardTag ("Live masterclass"); cardTitle is the session name; cardPrice "FREE"; cardPoints are "this is for you if…" bullets.
Section layouts: most sections take props.variant to pick their design — ${variantsText()}. Mix layouts so the page has rhythm (e.g. a centred hero, a numbered zigzag of features, a WhatsApp-chat testimonial wall) and fit them to the business; follow the example's choices unless the brief suggests better.
Theme: {"style": one of ${PAGE_STYLES.join('|')}, "primary": "#hex", "secondary": "#hex"}. Styles: ${Object.entries(STYLE_HINTS).map(([k, v]) => `${k} (${v})`).join('; ')}.
Audience defaults to India: use ₹ prices, Indian names/cities, UPI/COD mentions. hero also accepts badge.
Step types: landing, optin, sales, checkout, upsell, downsell, thankyou.
Funnel shapes (follow the example's): sales funnel = sales → checkout → upsell → downsell → thankyou (with cross-sells). Video sales letter + application (high-ticket, "apply for a call") = sales (video hero, no price) → optin (form with qualifying questions, after "next") → thankyou ("call booked"). Webinar = optin (registration: event hero, FREE) → thankyou (you're registered) → sales (replay: video hero + pricing for the paid programme) → checkout → upsell → thankyou (welcome).`;

function extractJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('AI returned no JSON');
  return JSON.parse(text.slice(s, e + 1));
}

// Ask for JSON; one automatic retry when the answer isn't valid JSON
// general-purpose calls for other modules (the school: AI tutor, course and quiz writer)
export const aiText = (system, user, history = []) => complete(system, [...history, { role: 'user', content: user }], { json: false });
export const aiJson = (system, user) => ask(system, user);
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

// opts: { length: short|standard|detailed (how many sections the main pages get), style, primary (the seller's design picks) }
export async function generateFunnel(prompt, { length = 'standard', style, primary } = {}) {
  if (!aiEnabled()) return normalizeFunnel(templateFunnel(prompt));
  const closest = trimTemplate(similarTemplates(prompt, 1)[0], length);
  const blueprint = blueprintOf(closest);
  const design = [style && `theme.style must be "${style}"`, primary && `theme.primary must be "${primary}" (pick a secondary that goes with it)`].filter(Boolean).join('; ');
  const system = `You are an expert direct-response funnel strategist and copywriter for Indian businesses. Design a complete, high-converting funnel from the user's business description. Respond with ONLY valid JSON:
{"name": string, "theme": {"style": string, "primary": "#hex", "secondary": "#hex"}, "steps": [{"name": string, "type": string, "slug": string, "blocks": [{"type": string, "props": {...}}]}]}
Write persuasive, specific copy for THIS business (never generic), realistic Indian prices, Indian names and cities.
${BLOCK_SPEC}

EXAMPLE — a complete funnel from our template library for a similar business ("${closest.name}"). Match its structure, section order, depth and quality exactly, but write completely new copy, names, prices and offers for the user's business:
${exampleFunnel(closest)}

${barText(blueprint)}
Every section has its own job — never repeat a point, benefit, list or claim another section already makes; a reader should never feel they've read it before.${design ? `
The seller chose their design: ${design}.` : ''}`;
  const report = { model: aiProvider(), template: closest.id, firstDraftIssues: null, repairPasses: 0, filledFromTemplate: [], finalIssues: null };
  let best = null, bestIssues = null;
  const consider = (f) => {
    if (!f || !Array.isArray(f.steps)) return;
    const known = KNOWN_TYPES();
    f.steps.forEach((st, si) => {
      st.blocks = (st.blocks || []).filter((x) => x && known.has(x.type) && x.props && typeof x.props === 'object');
      // a shorter page means only the blueprint's sections, once each (the model likes to add more)
      const bp = blueprint[si];
      if (length !== 'detailed' && bp?.type === st.type) { const seen = new Set(); st.blocks = st.blocks.filter((x) => bp.blocks.includes(x.type) && !seen.has(x.type) && seen.add(x.type)); }
    });
    const iss = audit(f, blueprint);
    if (!best || iss.length < bestIssues.length) { best = f; bestIssues = iss; }
  };
  for (let attempt = 0; attempt < 2 && !best; attempt++) {
    try { consider(await ask(system, prompt)); } catch (e) { console.warn('AI funnel generation failed:', e.message); if (/not authorized|401|API key/i.test(e.message)) break; }
  }
  if (!best) return Object.assign(normalizeFunnel(trimTemplate(matchTemplate(prompt), length)), { fallback: true, quality: { ...report, fallback: true } });
  report.firstDraftIssues = bestIssues.length;
  for (let pass = 0; pass < MAX_REPAIRS && bestIssues.length; pass++) {
    report.repairPasses++;
    try { consider(await repair(system, best, bestIssues)); } catch (e) { console.warn('AI repair pass failed:', e.message); }
  }
  // guarantee: never below the template bar
  const f = structuredClone(best);
  if (bestIssues.length) report.filledFromTemplate = enforce(f, trimTemplate(matchTemplate(prompt), length), blueprint);
  const final = audit(f, blueprint);
  report.finalIssues = final.length;
  report.remaining = final.map((i) => `${i.type}: ${i.msg}`);
  if (final.length) console.warn('AI funnel still below the bar after top-up:', summarise(final));
  console.log(`AI funnel "${f.name}": ${report.firstDraftIssues} issue(s) in first draft → ${bestIssues.length} after ${report.repairPasses} repair pass(es) → ${final.length} after template top-up (${report.filledFromTemplate.length} field(s) filled)`);
  return Object.assign(normalizeFunnel(f), { quality: report });
}

// ---------- before building: is the brief enough? ----------
// A one-liner ("free guide that grows my email list") leaves the page to guess the business — and the closest
// template wins, however unrelated. So a vague or half-done brief gets questions first — ONE at a time, each chosen
// for what is still unknown given the brief and the answers so far (at most four, fewer when it's clear sooner).
// answers: [{ q, a }] → { ready: true } or { ready: false, understood, question: { id, q, options }, asked, max }
const MAX_QUESTIONS = 4;
const CLARIFY_DEFAULTS = [
  { id: 'what', q: 'What exactly do you sell?', options: ['Online course', '1:1 coaching / consulting', 'Physical product', 'Service / local business'] },
  { id: 'who', q: 'Who is it for?', options: ['Working professionals', 'Business owners', 'Students', 'Homemakers / parents'] },
  { id: 'price', q: 'What does it cost?', options: ['Free', 'Under ₹1,000', '₹1,000 – ₹10,000', 'Above ₹10,000'] },
  { id: 'goal', q: 'What should visitors do on this page?', options: ['Buy right away', 'Book a call', 'Register for a free webinar', 'Get a free guide (join my list)'] },
];
const cleanQuestion = (x) => (x && typeof x.q === 'string' && x.q.trim() ? {
  id: String(x.id || 'q').replace(/[^\w-]/g, '').slice(0, 24) || 'q',
  q: x.q.trim().slice(0, 160),
  options: (Array.isArray(x.options) ? x.options : []).filter((o) => typeof o === 'string' && o.trim()).slice(0, 5).map((o) => o.trim().slice(0, 60)),
} : null);
const cleanAnswers = (list) => (Array.isArray(list) ? list : []).filter((x) => x && String(x.a || '').trim()).slice(0, MAX_QUESTIONS).map((x) => ({ q: String(x.q || '').slice(0, 160), a: String(x.a).trim().slice(0, 300) }));
// the brief with the answers so far, as the funnel builder gets it
export const withAnswers = (prompt, answers) => { const a = cleanAnswers(answers); return a.length ? `${prompt}\n\nMore details:\n${a.map((x) => `- ${x.q} ${x.a}`).join('\n')}` : prompt; };
export function briefLooksReady(prompt) {
  const { price, audience } = parsePrompt(prompt);
  const words = prompt.trim().split(/\s+/).length;
  return words >= 14 && (price != null || /\bfree\b/i.test(prompt)) && (audience != null || words >= 22);
}
// without AI: the next standard question the brief and the answers don't already cover
function offlineQuestion(prompt, answers) {
  const all = withAnswers(prompt, answers);
  const { price, audience } = parsePrompt(all);
  const asked = new Set(answers.map((x) => x.q));
  return CLARIFY_DEFAULTS.find((x) => !asked.has(x.q) && !(x.id === 'price' && (price != null || /\bfree\b/i.test(all))) && !(x.id === 'who' && audience)) || null;
}
export async function clarifyBrief(prompt, answersIn = []) {
  const answers = cleanAnswers(answersIn);
  const all = withAnswers(prompt, answers);
  if (answers.length >= MAX_QUESTIONS || briefLooksReady(all)) return { ready: true };
  const next = (question, understood = '') => (question ? { ready: false, understood, question, asked: answers.length, max: MAX_QUESTIONS } : { ready: true });
  if (!aiEnabled()) return next(offlineQuestion(prompt, answers));
  const system = `You help Indian small businesses build a sales page / funnel. Before building you check the seller's brief is specific enough to write a page about THEIR business. You need to know: what they sell (the actual product or service and niche), who it is for, the price (or that it's free), and what the page should get visitors to do (buy, book a call, register for a webinar, download a free guide…).
You ask ONE question at a time, like a smart human consultant: the single most useful thing still missing, phrased for THIS business (use their words, niche and what they've already told you — never a generic form question). Never ask about something the brief or the answers already cover, and stop as soon as there's enough to build a specific page — don't ask for nice-to-haves.
If there's enough, reply {"ready": true}.
Otherwise reply {"ready": false, "understood": "one short, friendly sentence of what you understood so far", "question": {"id": "short_id", "q": "the one question", "options": ["3–5 tap-to-answer options, each under 6 words, fitted to their business and the Indian market (₹ prices)"]}}.
Respond with ONLY the JSON.`;
  try {
    const out = await ask(system, `Seller's brief: ${prompt}${answers.length ? `\n\nTheir answers so far:\n${answers.map((x) => `Q: ${x.q}\nA: ${x.a}`).join('\n')}` : ''}\n\nQuestions asked so far: ${answers.length} of at most ${MAX_QUESTIONS}.`);
    if (out.ready === true) return { ready: true };
    const q = cleanQuestion(out.question || (Array.isArray(out.questions) ? out.questions[0] : null));
    if (q && !answers.some((x) => x.q === q.q)) return next(q, typeof out.understood === 'string' ? out.understood.slice(0, 200) : '');
  } catch (e) { console.warn('Brief check failed:', e.message); }
  return next(offlineQuestion(prompt, answers));
}

export async function editBlocks(step, theme, instruction) {
  if (!aiEnabled()) throw new Error('The AI editor isn’t switched on yet');
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
          { type: 'hero', props: { headline: `Finally: ${name}, made simple`, subheadline: 'A clear, step-by-step way to get started.', ctaText: 'Get Instant Access', image: '' } },
          { type: 'features', props: { title: 'What you get', items: [{ title: 'Step-by-step system', text: 'A clear path from start to result.' }, { title: 'Done-for-you templates', text: 'Copy, paste and launch.' }, { title: 'Bonus community', text: 'Support when you need it.' }] } },
          { type: 'testimonials', props: { title: 'Real results', items: [{ name: 'Priya S.', quote: 'This changed how I work.' }, { name: 'Marcus T.', quote: 'Paid for itself in a week.' }] } },
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
      `🔥 ${headline}\n\n${product} — just ${p}.\n👉 Tap "Learn More" to see what’s inside.`,
      `Tired of trying everything and getting nowhere?\n${product} gives you a proven, step-by-step system.\n✅ Instant access ✅ UPI accepted ✅ Step-by-step support\nOnly ${p} today.`,
      `[Add a real customer review here]\n${product} is ${p}. See what’s inside 👇`,
    ],
    email: [
      `Email 1 · Subject: Welcome! Here's what happens next\nHi {name}, thanks for joining. Over the next few days I'll show you exactly how ${product} helps ${audience}…`,
      `Email 2 · Subject: The #1 mistake most people make\nMost people try to figure it out alone. Here's why that fails — and what to do instead…`,
      `Email 3 · Subject: What a real customer told us\n[Share a real customer’s story here — with their permission]…`,
      `Email 4 · Subject: Your questions, answered\nIs it right for me? Do you accept UPI? Is there a refund? Yes, yes and yes…`,
      `Email 5 · Subject: Still thinking it over?\n${product} is ${p}, with instant access. Reply with any question — happy to help.`,
    ],
    whatsapp: [
      `Hi {name} 👋 Quick update — ${product} is ${p}. Reply YES and I'll send you the link.`,
      `Any questions about ${product}? Here’s the link with everything inside: {link}`,
      `Just checking in — anything I can help with before you decide? Reply here 🙂`,
    ],
    social: [
      `${headline} 💯\n\nSave this post & share it with someone who needs it 👇\n#India #${tag} #growth #learning`,
      `POV: you finally found something that actually works 🙌\n${product} — link in bio.\n#trending #indiansuccess #motivation`,
    ],
    headlines: [
      headline,
      'The simplest way to get results — even if you have failed before',
      `How ${product} helps ${audience}`,
      'Stop wasting time. Start getting results in 21 days.',
      'What nobody tells you about getting results fast',
      `${product}: the shortcut the experts don't talk about`,
      'From stuck to unstoppable — in just a few weeks',
      `Why ${audience} across India are switching to ${product}`,
      'Get results in days, not months — guaranteed',
      'Finally, a proven plan that fits your busy life',
    ],
    video: [`HOOK (0–3s): "If you're still struggling with this, stop scrolling."\nPROBLEM (3–15s): Most people try random tips and give up.\nSOLUTION (15–40s): ${product} gives you a step-by-step plan — live support, UPI payments, 7-day guarantee.\nPROOF (40–50s): [a real customer result, with their permission]\nCTA (50–60s): "Link in bio — just ${p} today."`],
    seo: [
      `Meta title: ${product} | Pay by UPI, instant access`,
      `Meta description: ${product} — just ${p} with UPI and instant access.`,
      `Keywords: ${product.toLowerCase()}, best ${product.toLowerCase()} in india, ${product.toLowerCase()} online, ${product.toLowerCase()} price`,
    ],
    abandon: [
      `After 1 hour (WhatsApp): Hi {name}, you left ${product} in your cart 🛒 Your ${p} price is still reserved — complete here: {link}`,
      `After 24 hours (Email) · Subject: Did something go wrong?\nNo worries! If you had a payment issue, you can pay with any UPI app. Here's your link…`,
      `After 48 hours (Email) · Subject: Here's 10% OFF to help you decide\nUse code INDIA10 at checkout.`,
    ],
  };
  return T[kind] || [];
}

export async function runAgent(kind, ctx) {
  if (!aiEnabled()) return { outputs: agentFallback(kind, ctx), usedAI: false };
  const a = AGENTS[kind];
  const out = await ask(
    `You are an expert Indian direct-response marketer acting as the "${a.name}" (${a.desc}). Write in natural Indian English (Hinglish words are fine where natural). Respond with ONLY JSON: {"outputs": [string, ...]} — each string is one complete, ready-to-use piece.`,
    `Product: ${ctx.product}\nPrice: ${typeof ctx.price === 'number' ? `₹${ctx.price.toLocaleString('en-IN')}` : ctx.price}\nMain promise: ${ctx.headline}\nAudience: ${ctx.audience}\nExtra instructions: ${ctx.extra || 'none'}`
  );
  return { outputs: out.outputs || [], usedAI: true };
}
