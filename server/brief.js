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

// → { blocks: [types that must be on a page], variants: { type: variant }, style, videoUrl, endsAt, notes: [for the prompt] }
export function briefNeeds(prompt, now = Date.now()) {
  const raw = String(prompt || '');
  const s = raw.toLowerCase();
  const out = { blocks: [], variants: {}, style: null, videoUrl: '', endsAt: null, notes: [] };
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

  if (/\b(count[- ]?down|timer|launch(es|ing)?\b|go(es)? live on|deadline|offer ends|ends on|last date|sale ends)\b/.test(s)) {
    out.endsAt = dateIn(raw, now);
    if (/\b(count[- ]?down|timer)\b/.test(s) || out.endsAt) {
      need('countdown', out.endsAt
        ? `Add a countdown section (mode "fixed", endsAt ${out.endsAt}) counting down to ${new Date(out.endsAt + IST).toISOString().slice(0, 16).replace('T', ' ')} India time — the date the seller gave.`
        : 'The seller asked for a countdown but gave no date: add a countdown section with mode "fixed" and endsAt 0 (the seller sets the date) — never a made-up deadline or a timer that restarts.');
    }
  }
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
  if (/\b(testimonials?|reviews from|client stories)\b/.test(s)) need('testimonials');
  return out;
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
