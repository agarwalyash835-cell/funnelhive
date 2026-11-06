// What the seller asked for in their own words, read before the AI writes: sections that must be on the page, a
// layout a section must use, a design direction, a video link and a launch date. The prompt lists these as
// must-haves and the quality gate checks each one is there (ai.js), so a request is never quietly dropped for the
// matched template's structure.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const IST = 330 * 60000;

// design words → page style (first match wins; only used when the seller didn't pick a style)
const STYLE_WORDS = [
  [/\b(dark|black)\b[^.]{0,40}\b(luxur\w*|premium|elegant|high[- ]end)\b|\b(luxur\w*|premium|elegant|high[- ]end)\b[^.]{0,40}\b(dark|black)\b/, 'noir'],
  [/\b(futuristic|neon|cyber\w*|techy)\b/, 'tech'],
  [/\bglass(morphism|y)?\b/, 'glass'],
  [/\b(magazine|editorial)\b/, 'editorial'],
  [/\b(swiss|brutalis\w*|brutalist)\b/, 'swiss'],
  [/\b(pastel|soft pink|baby pink)\b/, 'pastel'],
  [/\b(royal|regal|jewel tones?)\b/, 'royal'],
  [/\b(earthy|rustic|handmade look)\b/, 'organic'],
  [/\b(playful|fun and colou?rful|cartoon\w*)\b/, 'playful'],
  [/\b(luxur\w*|elegant|high[- ]end|upscale)\b/, 'luxe'],
  [/\b(dark (theme|mode|look|design|background)|all[- ]black)\b/, 'midnight'],
  [/\b(minimal(ist)?|clean and simple|very clean)\b/, 'clean'],
];

const VIDEO_URL = /https?:\/\/[^\s"'<>]*(youtube\.com\/(watch|shorts|embed)|youtu\.be\/|vimeo\.com\/|loom\.com\/share|\.mp4\b|\.webm\b)[^\s"'<>]*/i;

// "15 December 2026", "Dec 15", "15/12/2026", "2026-12-15", with an optional "at 7 pm" / "7:30pm" → ms (India time)
export function dateIn(text, now = Date.now()) {
  const s = String(text || '').toLowerCase();
  let y, m, d;
  let r = s.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]) - 1, Number(r[3])];
  if (!r && (r = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/))) [d, m, y] = [Number(r[1]), Number(r[2]) - 1, Number(r[3])];
  if (!r && (r = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(20\d\d))?\b/))) [d, m, y] = [Number(r[1]), MONTHS.indexOf(r[2]), r[3] && Number(r[3])];
  if (!r && (r = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/))) [m, d, y] = [MONTHS.indexOf(r[1]), Number(r[2]), r[3] && Number(r[3])];
  if (!r || m < 0 || m > 11 || d < 1 || d > 31) return null;
  let hh = 0, mm = 0;
  const t = s.slice(r.index).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (t) { hh = Number(t[1]) % 12 + (t[3] === 'pm' ? 12 : 0); mm = Number(t[2] || 0); }
  const nowIst = new Date(now + IST);
  if (!y) {
    y = nowIst.getUTCFullYear();
    if (Date.UTC(y, m, d, hh, mm) - IST < now) y += 1; // a date with no year that has passed means next year
  }
  const at = Date.UTC(y, m, d, hh, mm) - IST;
  return Number.isFinite(at) && at > now ? at : null;
}

// A mention inside a rule against it ("NO fake countdown timers", "never invent testimonials") is not a request for
// it: the words just before it, in the same sentence, say no.
const NEG = /\b(no|not|never|don'?t|do not|avoid|without|ban(ned)?|forbid\w*|fake|invented|made[- ]up|false)\b/;
function mentions(raw, re) {
  const s = String(raw || '').toLowerCase(), g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
  return [...s.matchAll(g)].map((m) => {
    const before = s.slice(0, m.index);
    const clause = before.slice(Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf('!')) + 1);
    return NEG.test(clause.slice(-60)) ? 'against' : 'for';
  });
}
const asksFor = (raw, re) => mentions(raw, re).includes('for');
const rulesOut = (raw, re) => mentions(raw, re).includes('against');
// the seller's own facts a funnel must leave for them (a brief's honesty rules): real reviews, their refund policy,
// a real end date → slots like "[PLACEHOLDER — …]" / "[DATE]" that the live page hides until they're filled
export const SLOT = /\[(?:PLACEHOLDER|Add your|DATE)\b[^\]]*\]/i;
const SLOT_TEXT = { name: '[PLACEHOLDER — customer name, city]', quote: '[PLACEHOLDER — a real customer’s words]', refund: '[PLACEHOLDER — your refund policy]' };

// → { blocks: [types that must be on a page], variants: { type: variant }, style, videoUrl, endsAt, honest, notes: [for the prompt] }
export function briefNeeds(prompt, now = Date.now()) {
  const raw = String(prompt || '');
  const s = raw.toLowerCase();
  const out = { blocks: [], variants: {}, style: null, videoUrl: '', endsAt: null, honest: { reviews: false, refund: false, deadline: false }, notes: [] };
  const need = (type, note) => { if (!out.blocks.includes(type)) out.blocks.push(type); if (note) out.notes.push(note); };

  out.style = STYLE_WORDS.find(([re]) => re.test(s))?.[1] || null;

  const url = (raw.match(VIDEO_URL)?.[0] || '').replace(/[.,;:!?)\]]+$/, ''); // not the sentence's own punctuation
  const bgVideo = /\b(background video|video background|full[- ]?screen video|video (behind|in the background)|bg video)\b/.test(s);
  if (bgVideo) {
    out.variants.hero = 'bgvideo';
    out.notes.push(`The hero must use variant "bgvideo" (a full-screen video playing behind the headline)${url ? ` with videoUrl "${url}"` : ' — leave videoUrl "" for the seller to add'}.`);
  } else if (url) {
    out.variants.hero = 'video';
    out.notes.push(`The hero must be a video hero (variant "video", or "videosplit" / "cinema" if it suits better) with videoUrl "${url}".`);
  }
  if (url) out.videoUrl = url;

  const TIMER = /\b(count[- ]?downs?|timers?)\b/;
  if (/\b(count[- ]?down|timer|launch(es|ing)?\b|go(es)? live on|deadline|offer ends|ends on|last date|sale ends)\b/.test(s)) {
    out.endsAt = dateIn(raw, now);
    // a countdown the seller asked for, or a rule against FAKE ones (urgency is allowed when it's real): either way a
    // countdown to the real date — the seller's, or set by them in the editor (the live page hides it until then)
    if (asksFor(raw, TIMER) || rulesOut(raw, TIMER) || out.endsAt) {
      need('countdown', out.endsAt
        ? `Add a countdown section (mode "fixed", endsAt ${out.endsAt}) counting down to ${new Date(out.endsAt + IST).toISOString().slice(0, 16).replace('T', ' ')} India time — the date the seller gave.`
        : 'Add a countdown section with mode "fixed" and endsAt 0 — the seller sets the real end date in the editor (the live page hides it until then). Never a made-up deadline, and never a timer that restarts for each visitor.');
    }
  }
  // the brief's honesty rules
  out.honest.reviews = rulesOut(raw, /\b(testimonials?|reviews?|ratings?)\b/) || /\[placeholder[^\]]*\][^\n]{0,60}testimonial|testimonial[^\n]{0,60}\[?placeholder/i.test(raw);
  out.honest.refund = /\b(refund|guarantee|money[- ]back)\b[^\n]{0,80}\[?placeholder|\[?placeholder[^\n]{0,60}\b(refund|guarantee)\b/i.test(raw);
  out.honest.deadline = !out.endsAt && (rulesOut(raw, TIMER) || rulesOut(raw, /\b(only \d+ left|urgency|scarcity|deadlines?)\b/) || /\[date\]/i.test(raw));
  if (out.honest.reviews) out.notes.push(`The seller forbids invented testimonials and reviews: every testimonials item is a slot for a real one — name "${SLOT_TEXT.name}", quote "${SLOT_TEXT.quote}" (3 per section; the live page hides them until the seller fills them). No made-up names, quotes, ratings, review or buyer counts anywhere.`);
  if (out.honest.refund) out.notes.push(`The refund / guarantee terms are the seller's: every guarantee body is "${SLOT_TEXT.refund}", and no copy (titles, FAQ answers) promises a number of days, "no questions asked" or a full refund.`);
  if (out.honest.deadline) out.notes.push('The seller gave no real end date: never write a date or a deadline ("ends 5 December", "tonight", "only 3 left"). Where the launch price\'s end date would go, write "[DATE]" — the seller fills it in.');
  if (/\b(quiz|assessment|personality test|which (one|product|plan|course) (is|suits) (right|best))\b/.test(s)) need('quiz', 'Build the quiz the seller asked for (a quiz section as the first block of the first page), with its results leading on.');
  const n = s.match(/\b(\d|two|three|four|five)\s+(products?|plans?|tiers?|packages?|options|courses|programmes|programs)\b/);
  if (n) out.notes.push(`The seller has ${n[1]} ${n[2]} — reflect all of them (e.g. one quiz result or one pricing option per ${n[2].replace(/s$/, '')}, each with its own price).`);
  if (/\b(horizontal|side[- ]?scroll\w*|swipe\w*)\b[^.]{0,30}\b(timeline|steps|journey|process|roadmap)\b|\b(timeline|journey|roadmap)\b[^.]{0,30}\b(horizontal|side[- ]?scroll\w*)\b/.test(s)) {
    need('steps'); out.variants.steps = 'scroll';
    out.notes.push('Show the process as a horizontal timeline: a steps section with variant "scroll".');
  }
  if (/\b(calculator|estimator|roi calc\w*|emi calc\w*|savings calc\w*|price calc\w*|interactive (tool|widget))\b/.test(s)) {
    need('html', 'Build the calculator / interactive tool the seller asked for as an html section (see the html block: self-contained HTML, CSS and JavaScript using the page\'s colours and fonts).');
  }
  if (/\b(faq|frequently asked)\b/.test(s)) need('faq');
  if (/\b(gallery|portfolio|photos of (our|my) work|before[- ]and[- ]after)\b/.test(s)) need('gallery', 'Add a gallery section for the photos the seller mentioned (image links "" — the seller uploads them).');
  if (/\b(book a (call|consultation|slot|session|appointment)|booking calendar|schedule a (call|meeting))\b/.test(s)) need('booking');
  if (/\b(whatsapp button|chat on whatsapp|whatsapp chat)\b/.test(s)) need('whatsapp');
  if (asksFor(raw, /\b(testimonials?|reviews from|client stories)\b/) || out.honest.reviews) need('testimonials');
  return out;
}
export const honestAny = (n) => !!(n?.honest && (n.honest.reviews || n.honest.refund || n.honest.deadline));

// "5 December 2026, 00:00 IST", "Dec 5", "5th Dec" — a date in the copy the seller never gave
const DATE_WORDS = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+20\d\d)?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?(?:\s*ist)?\b|\b(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d\d)?\b/gi; // ("may 5" reads as English: not a month there)
const mapStrings = (v, fn) => (typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map((x) => mapStrings(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])) : v);
// The brief's honesty rules, made true whatever the AI wrote (models write sample reviews and deadlines out of habit):
// testimonials become slots for real reviews, the guarantee is the seller's own policy, a deadline is the seller's
// real date (a countdown waits for it), and an exit pop-up never shows a coupon code the seller didn't give → [changes]
export function applyHonesty(f, n, prompt = '') {
  const h = n?.honest || {}, done = [];
  if (!honestAny(n)) return done;
  const code = (c) => String(prompt).toUpperCase().includes(String(c).toUpperCase());
  for (const st of f?.steps || []) {
    for (const b of st.blocks || []) {
      const p = b.props || (b.props = {});
      if (h.reviews && b.type === 'testimonials' && (!(p.items || []).length || p.items.some((x) => !SLOT.test(x?.name || '') || !SLOT.test(x?.quote || '')))) {
        p.items = [0, 1, 2].map(() => ({ name: SLOT_TEXT.name, quote: SLOT_TEXT.quote, tag: '' }));
        done.push('testimonials → slots for real reviews');
      }
      if (h.refund && b.type === 'guarantee' && !SLOT.test(p.body || '')) {
        p.body = SLOT_TEXT.refund;
        if (/\d|no[- ]questions|bina sawaal|money[- ]back|full refund|poora/i.test(p.title || '')) p.title = '[PLACEHOLDER — refund policy heading]';
        p.days = 0; p.showSeal = false; // no "7-day" (or "100% free") seal the seller never promised
        done.push('guarantee → your refund policy');
      }
      if (h.refund && b.type === 'faq') for (const it of p.items || []) if (/refund|money[- ]?back|wapas|return/i.test(it?.q || '') && !SLOT.test(it?.a || '')) { it.a = SLOT_TEXT.refund; done.push('FAQ refund answer → your policy'); }
      if (h.deadline && b.type === 'countdown' && !(Number(p.endsAt) > 0 && Number(p.endsAt) === n.endsAt)) {
        b.props = { ...p, mode: 'fixed', endsAt: 0 }; delete b.props.minutes;
        done.push('countdown → waits for your real end date');
      }
      if (b.type === 'exitpopup' && p.code && !code(p.code)) { p.code = ''; done.push('exit pop-up: no made-up coupon code'); }
    }
  }
  if (h.deadline) {
    let n2 = 0;
    for (const st of f?.steps || []) for (const b of st.blocks || []) b.props = mapStrings(b.props, (x) => x.replace(DATE_WORDS, () => { n2++; return '[DATE]'; }));
    if (n2) done.push(`${n2} made-up date(s) → [DATE]`);
  }
  return done;
}

// the must-haves written out for the model ('' when the brief asks for nothing specific)
export function needsText(n) {
  const lines = [...n.notes];
  for (const t of n.blocks) if (!lines.some((l) => l.includes(t))) lines.push(`Include a ${t} section.`);
  if (n.style) lines.push(`The seller described the look: use theme.style "${n.style}" unless their own pick says otherwise.`);
  return lines.length ? `WHAT THE SELLER ASKED FOR — every item below must be in the funnel (the quality check looks for each one):\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
}

// the asks a funnel can be given without writing copy — a layout, the seller's video link, their launch date — put
// in place when the AI still missed them (sections that need words, like a quiz, are left to the AI) → [what was set]
export function applyNeeds(f, n, uid = () => Math.random().toString(36).slice(2, 10)) {
  const done = [];
  const blocks = (f?.steps || []).flatMap((s) => s.blocks || []);
  const hero = blocks.find((b) => b.type === 'hero');
  if (hero) {
    hero.props = hero.props || {};
    const want = n.variants.hero;
    const ok = want === 'video' ? ['video', 'videosplit', 'cinema'].includes(hero.props.variant) : hero.props.variant === want;
    if (want && !ok) { hero.props.variant = want; done.push(`hero.variant ${want}`); }
    if (n.videoUrl && hero.props.videoUrl !== n.videoUrl) { hero.props.videoUrl = n.videoUrl; done.push('hero.videoUrl'); }
  }
  for (const [t, v] of Object.entries(n.variants)) if (t !== 'hero') for (const b of blocks) if (b.type === t && b.props && b.props.variant !== v) { b.props.variant = v; done.push(`${t}.variant ${v}`); }
  if (n.endsAt && !blocks.some((b) => b.type === 'countdown' && Number(b.props?.endsAt) === n.endsAt)) {
    const cd = blocks.find((b) => b.type === 'countdown');
    if (cd) { cd.props = { ...cd.props, mode: 'fixed', endsAt: n.endsAt }; done.push('countdown.endsAt'); }
    else if (f.steps?.[0]) {
      const list = f.steps[0].blocks || (f.steps[0].blocks = []);
      const h = list.findIndex((b) => b.type === 'hero');
      list.splice(h + 1, 0, { id: uid(), type: 'countdown', props: { label: 'Launching in', mode: 'fixed', endsAt: n.endsAt, endedText: 'We’re live — the wait is over' } });
      done.push('countdown section');
    }
  }
  return done;
}

// requests still missing from a funnel → quality-gate issues (structure-level, so a repair rewrites the funnel)
export function unmet(f, n) {
  const all = (f?.steps || []).flatMap((s) => s.blocks || []);
  const issues = [];
  for (const t of n.blocks) if (!all.some((b) => b.type === t)) issues.push({ s: null, b: null, type: t, msg: `the seller asked for a ${t} section — add it` });
  for (const [t, v] of Object.entries(n.variants)) if (!all.some((b) => b.type === t && (b.props?.variant === v || (t === 'hero' && v === 'video' && ['video', 'videosplit', 'cinema'].includes(b.props?.variant))))) issues.push({ s: null, b: null, type: t, msg: `the ${t} must use the "${v}" layout the seller asked for` });
  if (n.videoUrl && !all.some((b) => b.type === 'hero' && b.props?.videoUrl === n.videoUrl)) issues.push({ s: null, b: null, type: 'hero', msg: `the hero must play the seller's video: videoUrl "${n.videoUrl}"` });
  if (n.endsAt && !all.some((b) => b.type === 'countdown' && Number(b.props?.endsAt) === n.endsAt)) issues.push({ s: null, b: null, type: 'countdown', msg: `the countdown must count to the seller's date: mode "fixed", endsAt ${n.endsAt}` });
  return issues;
}
