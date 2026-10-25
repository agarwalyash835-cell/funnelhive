// Campaign templates per industry (the CRM kits' ids): for each occasion an email, a WhatsApp template (submitted
// to Meta for approval in one click) and an AI-call script for the seller's Sarvam agent. The content lives in
// campaign-templates/*.js; this file loads, checks and serves it, and builds new ones with AI.
//
// One template:
// { id: 'education-new-enquiry', name: 'New enquiry follow-up' (≤40), goal: 'Book a free demo class' (≤70),
//   when: 'Within an hour of a new enquiry' (≤90), audience: { type: 'leads' | 'customers' | 'all', tags?: [] },
//   email: { subject (≤90), body (plain text, paragraphs split by a blank line) },
//     — may use {{first_name}} {{name}} {{business}}; details only the seller knows go in [square brackets],
//       e.g. [batch start date], [price], [link] — they must be filled in before sending
//   whatsapp: { name: 'edu_new_enquiry' (a-z0-9_ ≤50, unique), category: 'MARKETING' | 'UTILITY', body (≤700),
//     vars: [{ key: 'first_name', example: 'Riya' } | { fill: 'Batch start date', example: '5 May' }], footer? (≤60) }
//     — {{1}}, {{2}}… in order, at most 4, never at the very start or end, never two side by side; {{1}} is the
//       customer's first name; UTILITY only for something the customer booked, ordered or owes
//   call: { goal, opening, script: [lines], questions: [..], objections: [{ said, reply }], closing,
//     outcomes: ['interested', …] (what the agent saves in its `outcome` variable), variables: ['customer_name', …] } }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, 'campaign-templates');
export const EMAIL_VARS = ['first_name', 'name', 'business', 'email', 'phone'];
export const WA_FIELDS = ['first_name', 'name', 'business'];
const str = (v) => typeof v === 'string' && v.trim().length > 0;

// what's wrong with one template ('' when it's fine)
export function problemsOf(t) {
  const p = [];
  if (!/^[a-z0-9-]{3,80}$/.test(t.id || '')) p.push('id');
  if (!str(t.name) || t.name.length > 40) p.push('name ≤40');
  if (!str(t.goal) || t.goal.length > 70) p.push('goal ≤70');
  if (!str(t.when) || t.when.length > 90) p.push('when ≤90');
  if (!['leads', 'customers', 'all'].includes(t.audience?.type)) p.push('audience.type');
  const e = t.email || {};
  if (!str(e.subject) || e.subject.length > 90) p.push('email.subject ≤90');
  if (!str(e.body) || e.body.length < 200 || e.body.length > 1800) p.push(`email.body 200–1800 chars (has ${String(e.body || '').length})`);
  for (const m of `${e.subject || ''} ${e.body || ''}`.matchAll(/\{\{([^}]*)\}\}/g)) if (!EMAIL_VARS.includes(m[1].trim())) p.push(`email variable {{${m[1]}}}`);
  const w = t.whatsapp || {};
  if (!/^[a-z0-9_]{3,50}$/.test(w.name || '') || String(w.name).startsWith('fh_')) p.push('whatsapp.name');
  if (!['MARKETING', 'UTILITY'].includes(w.category)) p.push('whatsapp.category');
  const body = String(w.body || '');
  if (!body || body.length > 700) p.push('whatsapp.body ≤700');
  const nums = [...body.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim());
  if (nums.some((x) => !/^\d+$/.test(x))) p.push('whatsapp variables must be {{1}}, {{2}}…');
  const n = [...new Set(nums.map(Number))].sort((a, b) => a - b);
  if (n.some((x, i) => x !== i + 1)) p.push('whatsapp variables in order without gaps');
  if (n.length > 4) p.push('whatsapp ≤4 variables');
  if (n.length && /^\s*\{\{/.test(body)) p.push('whatsapp body can’t start with a variable');
  if (n.length && /\}\}\s*[.!?]?\s*$/.test(body)) p.push('whatsapp body can’t end with a variable');
  if (/\}\}\s*\{\{/.test(body)) p.push('whatsapp variables side by side');
  if (/\[[^\]]+\]/.test(body)) p.push('whatsapp body: no [brackets] — use a variable');
  if (!Array.isArray(w.vars) || w.vars.length !== n.length) p.push(`whatsapp.vars must list ${n.length} variable(s)`);
  else w.vars.forEach((v, i) => { if (!(WA_FIELDS.includes(v.key) || str(v.fill)) || !str(v.example)) p.push(`whatsapp.vars[${i}]`); });
  if (n.length && w.vars?.[0]?.key !== 'first_name') p.push('{{1}} is the first name');
  if (w.footer && w.footer.length > 60) p.push('whatsapp.footer ≤60');
  const c = t.call || {};
  if (!str(c.goal) || !str(c.opening) || !str(c.closing)) p.push('call goal / opening / closing');
  if (!Array.isArray(c.script) || c.script.length < 3) p.push('call.script ≥3 lines');
  if (!Array.isArray(c.questions) || c.questions.length < 2) p.push('call.questions ≥2');
  if (!Array.isArray(c.objections) || c.objections.length < 2 || c.objections.some((o) => !str(o.said) || !str(o.reply))) p.push('call.objections ≥2 {said, reply}');
  if (!Array.isArray(c.outcomes) || c.outcomes.length < 2 || c.outcomes.some((o) => !/^[a-z_]{2,30}$/.test(o))) p.push('call.outcomes snake_case ≥2');
  if (!Array.isArray(c.variables) || !c.variables.includes('customer_name')) p.push('call.variables include customer_name');
  return p.join('; ');
}

// all files → { industry: [templates] }, checked; duplicates of an id or WhatsApp name are an error
let cache = null;
export async function catalog({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const out = {}, ids = new Set(), names = new Set(), errors = [];
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort() : [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(DIR, f)).href)).default || {};
    for (const [ind, list] of Object.entries(mod)) {
      for (const t of list) {
        const bad = problemsOf(t);
        if (bad) errors.push(`${f} ${t.id || '?'}: ${bad}`);
        if (ids.has(t.id)) errors.push(`${f}: duplicate id ${t.id}`);
        if (names.has(t.whatsapp?.name)) errors.push(`${f}: duplicate WhatsApp name ${t.whatsapp?.name}`);
        ids.add(t.id); names.add(t.whatsapp?.name);
        (out[ind] ||= []).push({ ...t, industry: ind });
      }
    }
  }
  cache = { byIndustry: out, errors };
  return cache;
}

// ---------- using a template: a ready draft ----------
// the agent script as one block to paste into the seller's Sarvam agent
export function callScript(t) {
  const c = t.call;
  return [`Goal: ${c.goal}`, `Opening: ${c.opening}`, 'What to say:', ...c.script.map((l, i) => `${i + 1}. ${l}`), 'Ask:', ...c.questions.map((q) => `- ${q}`),
    'If they say…', ...c.objections.map((o) => `- “${o.said}” → ${o.reply}`), `Close: ${c.closing}`,
    `Save the result in the variable “outcome” as one of: ${c.outcomes.join(', ')}.`, `Variables this script uses: ${c.variables.join(', ')}.`].join('\n');
}
// the WhatsApp variables as the campaign's comma-separated values: contact fields fill themselves, the rest the seller types
export const waParams = (w) => (w.vars || []).map((v) => (v.key ? `{{${v.key}}}` : `[${v.fill}]`)).join(', ');
const VOICE_FIELD = { customer_name: 'first_name', name: 'name', first_name: 'first_name', business_name: 'business', business: 'business' };

export async function registerCampaignTemplates(app, { auth, wrap, credits }) {
  const [{ T, uid }, { KITS }, { cleanSegment }, { aiEnabled, aiJson }] = await Promise.all([import('./db.js'), import('./crmkits.js'), import('./broadcasts.js'), import('./ai.js')]);
  const kitName = (id) => KITS.find((k) => k.id === id)?.name || id;
  const summary = (t) => ({ id: t.id, industry: t.industry, name: t.name, goal: t.goal, when: t.when, wa: t.whatsapp.category });
  const findT = async (id) => Object.values((await catalog()).byIndustry).flat().find((t) => t.id === id) || null;
  // the template's audience, keeping only tags this account actually has
  const segmentFor = (userId, a = {}) => {
    const have = new Set(T.crm.all({ userId }).flatMap((m) => m.tags || []).map((x) => x.toLowerCase()));
    return cleanSegment({ type: a.type || 'all', tags: (a.tags || []).filter((x) => have.has(String(x).toLowerCase())) }, userId);
  };

  app.get('/api/campaign-templates', auth, wrap(async (req, res) => {
    const { byIndustry } = await catalog();
    const mine = req.user.settings?.crmKit?.id;
    const industries = Object.keys(byIndustry).sort((a, b) => (a === mine ? -1 : b === mine ? 1 : kitName(a).localeCompare(kitName(b)))).map((id) => ({ id, name: kitName(id), count: byIndustry[id].length }));
    res.json({ industry: byIndustry[mine] ? mine : industries[0]?.id || null, industries, templates: Object.values(byIndustry).flat().map(summary), ai: aiEnabled() });
  }));
  // a template (from the library, or one AI just wrote) → a draft campaign on that channel
  app.post('/api/campaign-templates/use', auth, wrap(async (req, res) => {
    const channel = req.body?.channel;
    if (!['email', 'whatsapp', 'call'].includes(channel)) return res.status(400).json({ error: 'channel must be email, whatsapp or call' });
    const t = req.body?.id ? await findT(String(req.body.id)) : req.body?.template;
    if (!t) return res.status(404).json({ error: 'Template not found' });
    if (!req.body?.id) { const bad = problemsOf({ ...t, id: 'ai-template' }); if (bad) return res.status(400).json({ error: `That template isn’t complete: ${bad}` }); }
    const segment = segmentFor(req.user.id, t.audience);
    if (channel === 'call') {
      if (T.vcampaigns.count({ userId: req.user.id }) >= 300) return res.status(400).json({ error: 'You have 300 calling campaigns — delete old ones first' });
      const vars = t.call.variables.filter((v) => VOICE_FIELD[v]).map((v) => ({ agent: v, field: VOICE_FIELD[v] }));
      const c = T.vcampaigns.insert({ id: uid(), userId: req.user.id, name: String(t.name).slice(0, 80), deploymentId: '', appId: '', appVersion: null, agentName: '', segment, vars, schedule: { startAt: null, endAt: null, from: '10:00', to: '19:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }, retries: { max: 2, interval: 60 }, cps: 1, consent: false, script: callScript(t), templateId: req.body?.id || null, status: 'draft', stats: {}, at: Date.now() });
      return res.json({ channel, id: c.id, script: c.script });
    }
    if (T.broadcasts.count({ userId: req.user.id }) >= 500) return res.status(400).json({ error: 'You have 500 campaigns — delete old ones first' });
    const w = t.whatsapp;
    const b = T.broadcasts.insert({
      id: uid(), userId: req.user.id, name: String(t.name).slice(0, 100), channel,
      subject: channel === 'email' ? t.email.subject : '', body: channel === 'email' ? t.email.body : '',
      wa: channel === 'whatsapp' ? { template: w.name, language: 'en', params: waParams(w) } : { template: '', language: 'en', params: '' },
      segment, templateId: req.body?.id || null, status: 'draft', stats: {}, at: Date.now(),
    });
    // WhatsApp: what to submit to Meta for approval (the page sends it through the seller's WhatsApp connection)
    res.json({ channel, id: b.id, ...(channel === 'whatsapp' ? { submit: { name: w.name, category: w.category, language: 'en', body: w.body, samples: w.vars.map((v) => v.example), ...(w.footer ? { footer: w.footer } : {}) } } : {}) });
  }));
  app.get('/api/campaign-templates/:id', auth, wrap(async (req, res) => {
    const t = await findT(req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json({ ...t, callScript: callScript(t), waParams: waParams(t.whatsapp) });
  }));

  // ---------- Build with AI: a new template in the same format, checked by the same rules ----------
  app.post('/api/campaign-templates/ai', auth, credits('edit'), wrap(async (req, res) => {
    if (!aiEnabled()) { res.locals.aiFailed = true; return res.status(503).json({ error: 'AI isn’t switched on yet' }); }
    const brief = String(req.body?.brief || '').trim().slice(0, 600);
    if (brief.length < 8) return res.status(400).json({ error: 'Describe the campaign in a sentence — who it’s for and what you want them to do' });
    const ind = String(req.body?.industry || req.user.settings?.crmKit?.id || 'general');
    const biz = req.user.settings?.businessName || req.user.name || 'the business';
    const all = (await catalog()).byIndustry;
    const sample = all[ind]?.[0] || Object.values(all).flat()[0];
    const system = `You write marketing campaigns for Indian small businesses: an email, a WhatsApp template and an AI phone-call script for one occasion. Reply with ONE JSON object only, in exactly this shape and within these limits:
{"name":"≤40 chars","goal":"≤70","when":"≤90 — when to send it","audience":{"type":"leads|customers|all"},
 "email":{"subject":"≤90, may use {{first_name}}","body":"120–220 words, plain text, paragraphs split by a blank line, may use {{first_name}} and {{business}}; details only the seller knows in [square brackets] (at most 4)"},
 "whatsapp":{"name":"snake_case ≤50","category":"MARKETING, or UTILITY only for something the customer booked, ordered or owes","body":"≤700 chars; variables {{1}}, {{2}}… in order, at most 4, {{1}} is the customer's first name; never start or end with a variable; never two variables side by side; no [brackets]","vars":[{"key":"first_name","example":"Riya"},{"fill":"what the seller types","example":"…"}],"footer":"Reply STOP to opt out (marketing only)"},
 "call":{"goal":"","opening":"uses {{customer_name}} and {{business_name}}","script":["3–6 lines"],"questions":["2–4"],"objections":[{"said":"","reply":""}],"closing":"","outcomes":["snake_case"],"variables":["customer_name","business_name"]}}
Write like a top Indian direct-response copywriter: ₹, Indian context and festivals where relevant, warm and clear, one call to action, no fake urgency, no invented facts or numbers, no guaranteed results (health, money, visas, admissions).
An example of the quality and shape expected:
${JSON.stringify({ name: sample?.name, goal: sample?.goal, when: sample?.when, audience: sample?.audience, email: sample?.email, whatsapp: sample?.whatsapp, call: sample?.call })}`;
    const ask = `Business: ${biz}. Industry: ${kitName(ind)}.\nThe campaign: ${brief}`;
    let t = null, bad = 'no answer';
    for (let i = 0; i < 2 && bad; i++) {
      try {
        const j = await aiJson(system, i ? `${ask}\n\nYour last answer had these problems — fix them: ${bad}` : ask);
        t = { ...j, id: 'ai-template', whatsapp: { ...j.whatsapp, name: String(j.whatsapp?.name || 'ai_campaign').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^fh_/, '').slice(0, 50) } };
        bad = problemsOf(t);
      } catch (e) { bad = e.message; }
    }
    if (bad) { res.locals.aiFailed = true; return res.status(502).json({ error: 'The AI couldn’t write a complete campaign this time — try describing it a little differently' }); }
    res.json({ ...t, industry: ind, callScript: callScript(t), waParams: waParams(t.whatsapp) });
  }));
}
