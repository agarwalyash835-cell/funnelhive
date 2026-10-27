// "Build with AI" for the modules that didn't have it: one sentence → a draft the seller checks and saves.
// - a quote: title, intro, line items with ₹ prices, the details clients in that industry expect, GST line, deposit,
//   validity and terms — written like the industry's own templates (quote-templates/)
// - a webinar's set-up: name, length, schedule (weekly / every day / dates), reminders and replay
// - the inbox's automatic rules: working hours and the away reply, reply-time alerts, auto-close, keyword labels
// Nothing is saved here: each draft goes through the module's own checks, and the seller presses Save.
import { aiJson, aiEnabled } from './ai.js';
import { cleanQuote } from './quotes.js';
import { cleanWebinar, upcoming } from './webinars.js';
import { cleanRules, rulesOf } from './wainbox.js';
import { loadQuoteTemplates } from './quotetpl.js';
import { currentKit } from './crmkits.js';
import { sellerTz, localYmd } from './tz.js';
import { T } from './db.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const biz = (u) => u.settings?.businessName || u.name || 'the business';
const need = (res) => { if (aiEnabled()) return true; res.status(503).json({ error: 'AI isn’t switched on for this account yet' }); return false; };
const sentence = (req, res) => { const p = clip(req.body?.prompt, 1500); if (p.length < 8) { res.status(400).json({ error: 'Describe it in a sentence' }); return null; } return p; };
const fail = (res, e) => res.status(502).json({ error: /JSON/.test(e.message) ? 'The AI couldn’t draft this one — try describing it differently' : e.message });

export function registerAiBuild(app, { auth, rateLimit, isTest, credits }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user?.id || req.ip, message: 'Too many AI drafts — please wait a minute.' });

  // a quote from "3BHK interiors for Mr Shah in Baner, modular kitchen and wardrobes, 40% advance"
  app.post('/api/quotes/ai', auth, limiter, credits('edit'), async (req, res) => {
    const prompt = sentence(req, res); if (!prompt || !need(res)) return;
    const kit = currentKit(req.user), all = await loadQuoteTemplates();
    const example = (all[kit.id] || all.general || [])[0];
    const system = `You write professional quotes / proposals for Indian small businesses. From the seller's sentence, write a complete, ready-to-send quote for THEIR client, in the style of their industry (${kit.name || 'general'}). Use realistic Indian market ₹ prices (whole rupees, excluding GST) unless they gave prices — then use theirs exactly. Never invent the client's email or phone; leave unknown client details "".
Return ONLY JSON: {"client":{"name","company"},"title","intro" (2–3 warm, specific sentences),"items":[{"name","detail","qty","price"}] (2–8 lines),"addons":[{"name","detail","qty","price"}] (0–3 optional extras the client can tick on),"details":[{"label","value"}] (0–6 facts this industry's clients expect up top — property, event date, travellers…),"taxNote" (the GST line that applies, e.g. "Exclusive of GST @18%"),"deposit" (advance % 0–100),"validDays","terms" (short numbered terms)}.
${example ? `Example of a good quote in this industry:\n${JSON.stringify({ title: example.title, intro: example.intro, items: example.items, details: example.details, taxNote: example.taxNote, deposit: example.deposit, validDays: example.validDays, terms: example.terms }).slice(0, 3500)}` : ''}`;
    try {
      const r = await aiJson(system, `Business: ${biz(req.user)}\nThe quote: ${prompt}`);
      const items = [...(Array.isArray(r?.items) ? r.items : []), ...(Array.isArray(r?.addons) ? r.addons.map((x) => ({ ...x, optional: true })) : [])];
      const q = cleanQuote({ client: { name: r?.client?.name, company: r?.client?.company }, title: r?.title, intro: r?.intro, items, details: r?.details, taxNote: r?.taxNote, terms: r?.terms, deposit: r?.deposit, validDays: Number(r?.validDays) || 14, currency: 'INR' });
      if (q.error || !q.items?.some((i) => i.price > 0)) return res.status(502).json({ error: 'The AI couldn’t price this one — add a little more detail' });
      res.json({ draft: { ...q, validDays: Number(r?.validDays) > 0 ? Math.min(365, Math.round(Number(r.validDays))) : 14 } });
    } catch (e) { fail(res, e); }
  });

  // a webinar's set-up from "free masterclass every Sunday 11 am and Wednesday 7 pm, 75 minutes, replay for 2 days"
  app.post('/api/webinars/:wid/ai', auth, limiter, credits('edit'), async (req, res) => {
    const w = T.webinars.get(req.params.wid);
    if (!w || w.userId !== req.user.id) return res.status(404).json({ error: 'Webinar not found' });
    const prompt = sentence(req, res); if (!prompt || !need(res)) return;
    const tz = w.timezone || sellerTz(req.user);
    const system = `You set up a webinar's schedule for an Indian business from a sentence. Today is ${localYmd(tz, Date.now())} (${new Date().toLocaleDateString('en-IN', { weekday: 'long', timeZone: tz })}) in ${tz}; all times are in that zone, 24-hour HH:MM.
Return ONLY JSON: {"name","duration" (minutes, 15–480),"schedule":{"type":"weekly"|"daily"|"once","days":["mon".."sun"] (weekly),"times":["HH:MM"] (weekly / daily, up to 6),"dates":["YYYY-MM-DDTHH:MM"] (once — future only),"show" (daily: how many upcoming sessions a visitor picks from, 1–6)},"emails":{"day":true,"hour":true,"live":true,"replay":true},"replayHours" (0 = always; 24, 48, 72, 168)}.
Keep what the sentence doesn't mention as it is now: ${JSON.stringify({ name: w.name, duration: w.duration, schedule: w.schedule, replayHours: w.replayHours })}.`;
    try {
      const r = await aiJson(system, prompt);
      const next = cleanWebinar({ name: r?.name, duration: r?.duration, schedule: r?.schedule, emails: r?.emails, replayHours: r?.replayHours }, w);
      if (!upcoming(next).length) return res.status(502).json({ error: 'That schedule has no upcoming sessions — say a day and time, e.g. “every Sunday 11 am”' });
      res.json({ draft: { name: next.name, duration: next.duration, schedule: next.schedule, emails: next.emails, replayHours: next.replayHours }, next: upcoming(next, Date.now(), 3) });
    } catch (e) { fail(res, e); }
  });

  // the inbox's automatic rules from "we're open 10 to 7 Monday to Saturday, ping me if a chat waits 20 minutes,
  // tag 'price' messages as Pricing"
  app.post('/api/inbox/rules/ai', auth, limiter, credits('edit'), async (req, res) => {
    const prompt = sentence(req, res); if (!prompt || !need(res)) return;
    const cur = rulesOf(req.user);
    const system = `You set up a WhatsApp inbox's automatic rules for an Indian business from a sentence. Change only what the sentence asks for; keep the rest as it is now: ${JSON.stringify({ hours: cur.hours, sla: cur.sla, resolve: cur.resolve, labels: cur.labels })}.
Return ONLY JSON: {"hours":{"on":bool,"days":["mon".."sun"],"from":"HH:MM","to":"HH:MM","away":"the away reply, warm and short, in the language they used"},"sla":{"on":bool,"minutes":2–1440,"action":"notify"|"ai"},"resolve":{"on":bool,"hours":1–720},"labels":[{"word":"a word in customers' messages","label":"the label to add"}] (up to 30)}.
"sla" = when a chat waits that long for a reply: notify the team, or let the AI agent answer. "resolve" = close quiet chats after that many hours.`;
    try {
      const r = await aiJson(system, `Business: ${biz(req.user)}\nRules: ${prompt}`);
      const d = cleanRules({ hours: { ...cur.hours, ...(r?.hours || {}) }, sla: { ...cur.sla, ...(r?.sla || {}) }, resolve: { ...cur.resolve, ...(r?.resolve || {}) }, labels: Array.isArray(r?.labels) ? r.labels : cur.labels }, req.user.waRules || {}, req.user.id);
      res.json({ draft: { hours: d.hours, sla: d.sla, resolve: d.resolve, labels: d.labels } });
    } catch (e) { fail(res, e); }
  });
}
