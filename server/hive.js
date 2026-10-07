// Hive AI — build funnels end to end by chatting ("Lovable for funnels").
// One tool registry powers both the in-app Hive chat (DeepSeek via kie.ai, native tool calling) and the
// MCP server at /mcp, so external AI apps (Claude Desktop, Cursor…) can drive the platform too.
// Every tool calls the platform's own REST API as the signed-in seller, so all validation, limits
// and quality gates apply exactly as if the seller clicked it themselves.
import crypto from 'node:crypto';
import { T, uid } from './db.js';
import { hashToken } from './security.js';
import { BLOCK_SPEC, aiProvider, hiveReady, kieResponses } from './ai.js';

const MAX_MODEL_CALLS = 16, RESULT_MAX = 40000; // a full 21-section page with all props is ~25k characters

// ---------- section defaults when a step is added without content ----------
const STEP_SECTIONS = {
  landing: [{ type: 'hero', props: {} }, { type: 'features', props: {} }, { type: 'testimonials', props: {} }, { type: 'cta', props: {} }],
  sales: [{ type: 'hero', props: {} }, { type: 'features', props: {} }, { type: 'pricing', props: {} }, { type: 'faq', props: {} }],
  optin: [{ type: 'hero', props: {} }, { type: 'optin', props: {} }],
  checkout: [{ type: 'countdown', props: { label: 'Your price is locked for', minutes: 15 } }, { type: 'checkout', props: {} }],
  upsell: [{ type: 'offer', props: {} }, { type: 'guarantee', props: {} }],
  downsell: [{ type: 'offer', props: { progress: 'One last chance' } }],
  thankyou: [{ type: 'thankyou', props: {} }],
};
const STEP_TYPES = Object.keys(STEP_SECTIONS);
const slugify = (s) => String(s || 'step').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
const short = (v, n = 90) => { const s = String(v ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const sectionLabel = (b) => short(b.props?.headline || b.props?.title || b.props?.productName || b.props?.label || b.props?.text || (b.props?.messages?.[0]?.text) || '', 70);
const outline = (f, origin) => ({
  id: f.id, name: f.name, published: !!f.published, liveUrl: `${origin}/f/${f.slug}`, theme: f.theme,
  steps: f.steps.map((s) => ({ id: s.id, name: s.name, type: s.type, slug: s.slug, sections: s.blocks.map((b) => ({ id: b.id, type: b.type, label: sectionLabel(b) })) })),
});
const stepOf = (f, stepId) => f.steps.find((s) => s.id === stepId || s.slug === stepId) || null;

// ---------- the tools ----------
// run(ctx, args) → result; ctx = { call(method, path, body), origin }; summary(result, args) → one line for the UI
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (description) => ({ type: 'object', description });
const arr = (description, items = { type: 'object' }) => ({ type: 'array', description, items });

async function saveFunnel(ctx, f, patch) {
  // optimistic concurrency: never overwrite edits made elsewhere; re-read and retry once
  for (let i = 0; i < 2; i++) {
    try { return await ctx.call('PUT', `/funnels/${f.id}`, { ...patch, baseVersion: f.version }); } catch (e) {
      if (e.status !== 409 || i) throw e;
      f = await ctx.call('GET', `/funnels/${f.id}`);
    }
  }
}
// load → change one step's sections → save
async function editStep(ctx, funnelId, stepId, fn) {
  const f = await ctx.call('GET', `/funnels/${funnelId}`);
  const st = stepOf(f, stepId);
  if (!st) throw new Error(`No step "${stepId}" in this funnel — call get_funnel to see the step ids`);
  const result = fn(st, f);
  const saved = await saveFunnel(ctx, f, { steps: f.steps });
  return { funnel: saved, step: stepOf(saved, st.id), ...result };
}

export const TOOLS = [
  {
    name: 'list_funnels', description: 'List the seller’s funnels (id, name, published, steps).',
    schema: S({}), run: async (ctx) => (await ctx.call('GET', '/funnels')).map((f) => ({ id: f.id, name: f.name, published: !!f.published, steps: (f.steps || []).map((s) => s.type) })),
    summary: (r) => `Looked at your ${r.length} funnel${r.length === 1 ? '' : 's'}`,
  },
  {
    name: 'get_funnel', description: 'Outline of one funnel: steps (pages) and their sections with ids. Call this before editing.',
    schema: S({ funnelId: str('Funnel id') }, ['funnelId']), touches: 'funnelId',
    run: async (ctx, a) => outline(await ctx.call('GET', `/funnels/${a.funnelId}`), ctx.origin),
    summary: (r) => `Opened “${r.name}”`,
  },
  {
    name: 'create_funnel', description: 'Build a COMPLETE funnel from a business description: sales/landing page (21 sections), checkout with order bump, upsell, downsell and thank-you page, with copy, prices, FOMO and theme. Quality-checked against the template library. Takes ~30–75 s. Use this first whenever the user wants a new funnel; then customise with the edit tools.',
    schema: S({ brief: str('The business: what they sell, to whom, price in ₹, city, anything specific the user said') }, ['brief']),
    run: async (ctx, a) => { const f = await ctx.call('POST', '/ai/generate', { prompt: a.brief }); return { ...outline(f, ctx.origin), usedAI: f.usedAI, qualityCheck: f.quality ? { passed: f.quality.finalIssues === 0 } : undefined }; },
    summary: (r) => `Built “${r.name}” — ${r.steps.length} pages, ${r.steps.reduce((n, s) => n + s.sections.length, 0)} sections`, touchesResult: true,
  },
  {
    name: 'list_templates', description: 'The 53 ready-made funnel templates (id, name, category).',
    schema: S({}), run: async (ctx) => (await ctx.call('GET', '/templates')).map((t) => ({ id: t.id, name: t.name, category: t.category })),
    summary: () => 'Browsed the template library',
  },
  {
    name: 'create_funnel_from_template', description: 'Create a funnel from a template id (exact copy of the template).',
    schema: S({ templateId: str('Template id from list_templates'), name: str('Optional new funnel name') }, ['templateId']),
    run: async (ctx, a) => { let f = await ctx.call('POST', `/templates/${a.templateId}/use`); if (a.name) f = await saveFunnel(ctx, f, { name: a.name }); return outline(f, ctx.origin); },
    summary: (r) => `Created “${r.name}” from a template`, touchesResult: true,
  },
  {
    name: 'get_page', description: 'All sections of one page (step) with their full props, so you can edit them.',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id (or slug)') }, ['funnelId', 'stepId']), touches: 'funnelId',
    run: async (ctx, a) => { const f = await ctx.call('GET', `/funnels/${a.funnelId}`); const st = stepOf(f, a.stepId); if (!st) throw new Error('Step not found'); return { step: { id: st.id, name: st.name, type: st.type }, sections: st.blocks.map((b) => ({ id: b.id, type: b.type, props: b.props })) }; },
    summary: (r) => `Read the ${r.step.name} page`,
  },
  {
    name: 'update_section', description: 'Change a section’s content or style. `props` is merged into the existing props — send only what changes (but a whole list like items/rows/bullets must be sent complete).',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), sectionId: str('Section id'), props: obj('Props to set, e.g. {"headline":"…","ctaText":"…"} or {"_style":{"bg":"#111827","textColor":"#ffffff"}}') }, ['funnelId', 'stepId', 'sectionId', 'props']), touches: 'funnelId',
    run: (ctx, a) => editStep(ctx, a.funnelId, a.stepId, (st) => { const b = st.blocks.find((x) => x.id === a.sectionId); if (!b) throw new Error('Section not found — call get_page for section ids'); b.props = { ...b.props, ...a.props }; return { updated: b.type }; }).then((r) => ({ ok: true, section: r.updated })),
    summary: (r) => `Updated the ${r.section} section`,
  },
  {
    name: 'add_section', description: `Add a section to a page. Section types and props:\n${BLOCK_SPEC}`,
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), type: str('Section type'), props: obj('Section props'), position: num('Index to insert at (0 = top). Omit to add before the final call-to-action / at the end') }, ['funnelId', 'stepId', 'type', 'props']), touches: 'funnelId',
    run: (ctx, a) => editStep(ctx, a.funnelId, a.stepId, (st) => {
      const b = { id: uid(), type: a.type, props: a.props || {} };
      let at = Number.isInteger(a.position) ? Math.max(0, Math.min(st.blocks.length, a.position)) : st.blocks.findIndex((x) => ['cta', 'proof', 'exitpopup', 'stickybar', 'whatsapp'].includes(x.type));
      if (at < 0) at = st.blocks.length;
      st.blocks.splice(at, 0, b);
      return { added: b.id, type: b.type };
    }).then((r) => ({ ok: true, sectionId: r.added, type: r.type })),
    summary: (r) => `Added a ${r.type} section`,
  },
  {
    name: 'remove_section', description: 'Delete a section from a page.',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), sectionId: str('Section id') }, ['funnelId', 'stepId', 'sectionId']), touches: 'funnelId',
    run: (ctx, a) => editStep(ctx, a.funnelId, a.stepId, (st) => { const b = st.blocks.find((x) => x.id === a.sectionId); if (!b) throw new Error('Section not found'); st.blocks = st.blocks.filter((x) => x !== b); return { removed: b.type }; }).then((r) => ({ ok: true, removed: r.removed })),
    summary: (r) => `Removed the ${r.removed} section`,
  },
  {
    name: 'move_section', description: 'Move a section to a new position on its page.',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), sectionId: str('Section id'), toIndex: num('New index (0 = top)') }, ['funnelId', 'stepId', 'sectionId', 'toIndex']), touches: 'funnelId',
    run: (ctx, a) => editStep(ctx, a.funnelId, a.stepId, (st) => { const i = st.blocks.findIndex((x) => x.id === a.sectionId); if (i < 0) throw new Error('Section not found'); const [b] = st.blocks.splice(i, 1); st.blocks.splice(Math.max(0, Math.min(st.blocks.length, a.toIndex)), 0, b); return { moved: b.type }; }).then((r) => ({ ok: true, moved: r.moved })),
    summary: (r) => `Moved the ${r.moved} section`,
  },
  {
    name: 'replace_page', description: 'Replace ALL sections of a page in one go (for complete rewrites/redesigns). Each section: {type, props}.',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), sections: arr('Complete list of sections, top to bottom') }, ['funnelId', 'stepId', 'sections']), touches: 'funnelId',
    run: (ctx, a) => editStep(ctx, a.funnelId, a.stepId, (st) => { st.blocks = (a.sections || []).filter((b) => b?.type).map((b) => ({ id: b.id || uid(), type: b.type, props: b.props || {} })); return { count: st.blocks.length }; }).then((r) => ({ ok: true, sections: r.count })),
    summary: (r) => `Rebuilt the page (${r.sections} sections)`,
  },
  {
    name: 'add_step', description: `Add a page (step) to a funnel. Types: ${STEP_TYPES.join(', ')}. Pass sections to fill it, otherwise sensible defaults are used.`,
    schema: S({ funnelId: str('Funnel id'), type: str(`One of ${STEP_TYPES.join(', ')}`), name: str('Page name'), position: num('Index in the funnel (0 = first). Omit to add before the thank-you page'), sections: arr('Optional sections [{type, props}]') }, ['funnelId', 'type', 'name']), touches: 'funnelId',
    run: async (ctx, a) => {
      if (!STEP_TYPES.includes(a.type)) throw new Error(`Step type must be one of ${STEP_TYPES.join(', ')}`);
      const f = await ctx.call('GET', `/funnels/${a.funnelId}`);
      let slug = slugify(a.name); while (f.steps.some((s) => s.slug === slug)) slug += '-2';
      const st = { id: uid(), name: a.name, type: a.type, slug, blocks: (a.sections?.length ? a.sections : STEP_SECTIONS[a.type]).map((b) => ({ id: uid(), type: b.type, props: b.props || {} })) };
      let at = Number.isInteger(a.position) ? a.position : f.steps.findIndex((s) => s.type === 'thankyou');
      if (at < 0 || at > f.steps.length) at = f.steps.length;
      f.steps.splice(at, 0, st);
      await saveFunnel(ctx, f, { steps: f.steps });
      return { ok: true, stepId: st.id, slug, position: at };
    },
    summary: (r, a) => `Added a ${a.type} page`,
  },
  {
    name: 'remove_step', description: 'Delete a page (step) from a funnel. Only when the user asked for it.',
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id') }, ['funnelId', 'stepId']), touches: 'funnelId',
    run: async (ctx, a) => { const f = await ctx.call('GET', `/funnels/${a.funnelId}`); const st = stepOf(f, a.stepId); if (!st) throw new Error('Step not found'); if (f.steps.length <= 1) throw new Error('A funnel needs at least one page'); await saveFunnel(ctx, f, { steps: f.steps.filter((s) => s !== st) }); return { ok: true, removed: st.name }; },
    summary: (r) => `Removed the ${r.removed} page`,
  },
  {
    name: 'reorder_steps', description: 'Set the order of a funnel’s pages.',
    schema: S({ funnelId: str('Funnel id'), stepIds: arr('All step ids in the new order', { type: 'string' }) }, ['funnelId', 'stepIds']), touches: 'funnelId',
    run: async (ctx, a) => { const f = await ctx.call('GET', `/funnels/${a.funnelId}`); const order = a.stepIds.map((id) => stepOf(f, id)).filter(Boolean); if (order.length !== f.steps.length) throw new Error('Pass every step id exactly once'); await saveFunnel(ctx, f, { steps: order }); return { ok: true }; },
    summary: () => 'Reordered the pages',
  },
  {
    name: 'update_funnel', description: 'Rename a funnel or change its look: theme.style (aurora|midnight|luxe|fresh|bold|clean|editorial|organic|tech|playful|royal), primary/secondary colours (#hex), headingFont/bodyFont (e.g. Poppins, Mukta, Playfair Display), radius (sharp|soft|round|pill), textSize (sm|md|lg).',
    schema: S({ funnelId: str('Funnel id'), name: str('New name'), theme: obj('Theme fields to change') }, ['funnelId']), touches: 'funnelId',
    run: async (ctx, a) => { const f = await ctx.call('GET', `/funnels/${a.funnelId}`); const patch = {}; if (a.name) patch.name = a.name; if (a.theme) patch.theme = { ...f.theme, ...a.theme }; const r = await saveFunnel(ctx, f, patch); return { ok: true, name: r.name, theme: r.theme }; },
    summary: (r) => `Updated “${r.name}” settings`,
  },
  {
    name: 'publish_funnel', description: 'Publish (make live) or unpublish a funnel. Only when the user asks to go live.',
    schema: S({ funnelId: str('Funnel id'), published: bool('true = live (default), false = take it offline') }, ['funnelId']), touches: 'funnelId',
    run: async (ctx, a) => { const on = a.published !== false; const f = await ctx.call('GET', `/funnels/${a.funnelId}`); await saveFunnel(ctx, f, { published: on }); return { ok: true, published: on, liveUrl: `${ctx.origin}/f/${f.slug}` }; },
    summary: (r) => (r.published ? `Published — live at ${r.liveUrl}` : 'Unpublished the funnel'),
  },
  {
    name: 'create_coupon', description: 'Create a discount code. type: percent (1–100) or flat (₹). Optional: expiresAt (YYYY-MM-DD), maxUses, minOrder, oncePerCustomer, funnelIds.',
    schema: S({ code: str('e.g. DIWALI20'), type: str('percent | flat'), value: num('Discount'), expiresAt: str('YYYY-MM-DD'), maxUses: num('Total uses allowed'), minOrder: num('Minimum order ₹'), oncePerCustomer: bool('One use per customer'), funnelIds: arr('Only for these funnels', { type: 'string' }) }, ['code', 'type', 'value']),
    run: async (ctx, a) => { const c = await ctx.call('POST', '/coupons', a); return { ok: true, code: c.code, type: c.type, value: c.value }; },
    summary: (r) => `Created coupon ${r.code} (${r.type === 'percent' ? `${r.value}% off` : `₹${r.value} off`})`,
  },
  {
    name: 'list_coupons', description: 'The seller’s discount codes.', schema: S({}),
    run: async (ctx) => (await ctx.call('GET', '/coupons')).map((c) => ({ code: c.code, type: c.type, value: c.value, active: c.active, uses: c.uses })),
    summary: () => 'Checked your coupons',
  },
  {
    name: 'list_automations', description: 'The seller’s automations with their triggers and whether they are on.', schema: S({}),
    run: async (ctx) => (await ctx.call('GET', '/automations')).automations.map((a) => ({ id: a.id, name: a.name, active: a.active, trigger: a.trigger, steps: a.steps.length })),
    summary: () => 'Checked your automations',
  },
  {
    name: 'create_automation', description: `Create an automation (follow-ups by email/WhatsApp etc.).
trigger: {type: lead|purchase|offer|abandoned|stage|tag|date|inbound|manual, funnelId?, delayMin? (abandoned, minutes), pipelineId+stageId (stage), tag (tag), fieldId+offsetDays+time+yearly (date)}.
steps (run top to bottom): {type:'wait', amount, unit:'minutes'|'hours'|'days'} | {type:'wait', mode:'until', time:'10:00'} | {type:'email', subject, body} | {type:'whatsapp', mode:'template', template, language, params:'{{first_name}}, {{checkout_link}}'} | {type:'whatsapp', mode:'text', text} | {type:'tag', tag, action:'add'|'remove'} | {type:'stage', pipelineId, stageId} | {type:'notify', subject, body} (email to the seller) | {type:'webhook', url} | {type:'condition', match:'all'|'any', rules:[{field, op, value, ...}], yes:[steps], no:[steps]} | {type:'split', percent, a:[steps], b:[steps]} | {type:'exit'}.
Condition rule fields: bought (op is/not, funnelId?, value=product contains), tag (is/not, value), stage (is/not, pipelineId, stageId), has (is/not, value phone|email), source (equals/not_equals/contains, value), custom (fieldId, op equals/contains/gt/lt/empty/filled, value), amount (gt/lt/equals), funnel (is/not, funnelId), unsubscribed (is/not), opened / clicked (is/not, stepId? of an email step).
Variables in messages: {{first_name}} {{name}} {{email}} {{phone}} {{product}} {{amount}} {{funnel}} {{funnel_link}} {{checkout_link}} {{business}}.
Set activate=true to switch it on (fails with a clear reason if a step is incomplete).`,
    schema: S({ name: str('Automation name'), trigger: obj('Trigger'), steps: arr('Steps'), stopOnPurchase: bool('Stop when the contact buys'), activate: bool('Turn it on now') }, ['name', 'trigger', 'steps']),
    run: async (ctx, a) => {
      const created = await ctx.call('POST', '/automations', { name: a.name, trigger: a.trigger, steps: a.steps, ...(a.stopOnPurchase != null ? { stopOnPurchase: a.stopOnPurchase } : {}) });
      let active = false, warning;
      if (a.activate) { try { await ctx.call('PUT', `/automations/${created.id}`, { active: true }); active = true; } catch (e) { warning = e.message; } }
      const full = await ctx.call('GET', `/automations/${created.id}`);
      return { ok: true, id: created.id, name: created.name, active, warning, problems: full.check?.errors, notes: full.check?.warnings };
    },
    summary: (r) => `Created automation “${r.name}”${r.active ? ' — it’s on' : ' (off)'}`,
  },
  {
    name: 'update_automation', description: 'Change an automation (same fields as create_automation) and/or turn it on/off with active.',
    schema: S({ automationId: str('Automation id'), name: str('Name'), trigger: obj('Trigger'), steps: arr('Complete new step list'), stopOnPurchase: bool('Stop when the contact buys'), active: bool('On/off') }, ['automationId']),
    run: async (ctx, a) => { const { automationId, ...rest } = a; const r = await ctx.call('PUT', `/automations/${automationId}`, rest); return { ok: true, name: r.name, active: r.active, problems: r.check?.errors }; },
    summary: (r) => `Updated automation “${r.name}”${r.active ? ' — it’s on' : ''}`,
  },
  {
    name: 'list_pipelines', description: 'Sales pipelines and their stages (ids) — needed for stage triggers/steps.', schema: S({}),
    run: async (ctx) => (await ctx.call('GET', '/pipelines')).map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })),
    summary: () => 'Checked your pipelines',
  },
  {
    name: 'create_pipeline', description: 'Create a sales pipeline with stages.',
    schema: S({ name: str('Pipeline name'), stages: arr('Stages [{name, color?}] left to right', { type: 'object' }) }, ['name', 'stages']),
    run: async (ctx, a) => { const p = await ctx.call('POST', '/pipelines', a); return { ok: true, id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) }; },
    summary: (r) => `Created the “${r.name}” pipeline`,
  },
  {
    name: 'get_analytics', description: 'Performance: visitors, leads, orders, revenue, conversion — overall (last N days) or for one funnel.',
    schema: S({ funnelId: str('Optional funnel id'), days: num('Days to look back (default 30)') }),
    run: async (ctx, a) => {
      if (a.funnelId) { const d = await ctx.call('GET', `/funnels/${a.funnelId}/analytics`); return { steps: (d.steps || []).map((s) => ({ name: s.name, views: s.views, conversions: s.conversions })), leads: d.leads?.length, orders: d.orders?.length, revenue: (d.orders || []).reduce((n, o) => n + (o.total || 0), 0) }; }
      const d = await ctx.call('GET', `/analytics/overview?days=${a.days || 30}`);
      return d.totals || d;
    },
    summary: () => 'Pulled your numbers',
  },
  {
    name: 'write_marketing_copy', description: 'Write ready-to-use marketing copy for a funnel: kind = ads | email | whatsapp | social | headlines | video | seo | abandon.',
    schema: S({ kind: str('ads | email | whatsapp | social | headlines | video | seo | abandon'), funnelId: str('Funnel id'), extra: str('Extra instructions') }, ['kind']),
    run: async (ctx, a) => ctx.call('POST', '/ai/agent', a),
    summary: (r, a) => `Wrote ${a.kind} copy`,
  },
];
const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const clip = (v) => { const s = JSON.stringify(v); return s.length > RESULT_MAX ? `${s.slice(0, RESULT_MAX)}…(truncated)` : s; };

export async function runTool(ctx, name, args) {
  const t = byName[name];
  if (!t) throw new Error(`Unknown tool ${name}`);
  args = args && typeof args === 'object' ? args : {};
  const missing = (t.schema?.required || []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length) throw new Error(`Missing ${missing.join(', ')} — required by ${name}`);
  return t.run(ctx, args);
}

// ---------- the in-app agent ----------
const SYSTEM = `You are Hive AI, the builder inside FunnelHive — like Lovable, but for sales funnels. Sellers chat with you and you BUILD: funnels end to end (landing/sales pages, checkout, upsells, downsells, thank-you pages), page sections, design, coupons, pipelines and automations, using your tools. Act, don't just describe.

How to work:
- New business / new funnel → call create_funnel with a rich brief (what they sell, audience, ₹ price, city, offer). It already builds a complete, quality-checked 5-page funnel. Then apply anything specific the user asked for.
- Editing → get_funnel (ids) → get_page (current props) → update_section / add_section / remove_section / move_section / replace_page. Never invent ids.
- Automations → list_pipelines if you need stage ids, then create_automation with activate=true when the user wants it live. Use WhatsApp templates (not plain text) for automated WhatsApp.
- Several independent changes → make all the tool calls, then reply once.
- Publish only when the user asks to go live. Remove pages or sections only when asked.
- Copy: specific, persuasive, Indian context (₹, UPI, Indian names and cities), no placeholders.

Reply style: short, warm and professional (no slang or nicknames for the user, e.g. no "anna", "bro", "dear"). Say what you built or changed (bullets for several things), then ONE smart next suggestion. Don't paste JSON or ids.`;

const toolDefs = () => TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema }));

export async function hiveTurn({ ctx, history, message, focusFunnelId, emit, signal }) {
  let context = '';
  if (focusFunnelId) { try { context = `\n\n[The user is looking at funnel ${focusFunnelId}: ${clip(outline(await ctx.call('GET', `/funnels/${focusFunnelId}`), ctx.origin)).slice(0, 3000)}]`; } catch {} }
  const input = [...history.slice(-12).map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: message + context }];
  const tools = toolDefs();
  const done = [];
  let text = '', focus = focusFunnelId || null;
  for (let i = 0; i < MAX_MODEL_CALLS; i++) {
    if (signal?.aborted) break;
    const d = await kieResponses({ instructions: SYSTEM, input, tools, signal });
    const say = d.output.filter((o) => o.type === 'message').flatMap((o) => o.content || []).map((c) => c.text || '').join('').trim();
    const calls = d.output.filter((o) => o.type === 'function_call');
    if (say) { text = say; if (calls.length) emit({ type: 'thinking', text: say }); }
    if (!calls.length) break;
    input.push(...calls);
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.arguments || '{}'); } catch {}
      const t = byName[c.name];
      emit({ type: 'tool', status: 'running', id: c.call_id, name: c.name, label: t?.description.split(/[.:\n]/)[0] || c.name });
      let out, ok = true, summary;
      try {
        out = await runTool(ctx, c.name, args);
        summary = t.summary ? t.summary(out, args) : `Ran ${c.name}`;
        const fid = t.touchesResult ? out?.id : t.touches ? args[t.touches] : null;
        if (fid) focus = fid;
      } catch (e) { ok = false; out = { error: e.message }; summary = `${c.name.replace(/_/g, ' ')} failed: ${e.message}`; }
      done.push({ name: c.name, ok, summary });
      emit({ type: 'tool', status: ok ? 'done' : 'error', id: c.call_id, name: c.name, summary, funnelId: focus });
      input.push({ type: 'function_call_output', call_id: c.call_id, output: clip(out) });
    }
  }
  if (!text) text = done.length ? 'Done.' : 'Sorry — I couldn’t work that out. Could you say it another way?';
  return { text, tools: done, funnelId: focus };
}

// ---------- routes: chat, threads, MCP, access tokens ----------
export function registerHive(app, { auth, sign, port, rateLimit, isTest, appUrl, credits = (req, res, next) => next() }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 12, key: (req) => req.user.id, message: 'Hive AI is busy with your earlier messages — wait a moment.' });
  // a tool context that calls our own API as this user
  const ctxFor = (user, origin) => ({
    origin,
    call: async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { Authorization: `Bearer ${sign(user)}`, 'Content-Type': 'application/json', 'X-Hive': '1' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(300000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
      return data;
    },
  });
  const threadView = ({ userId, ...t }) => t;

  app.get('/api/hive/status', auth, (req, res) => res.json({ ready: hiveReady(), provider: aiProvider() }));
  const ownThread = (req, id) => { const t = id && T.hive.get(id); return t && t.userId === req.user.id ? t : null; };
  app.get('/api/hive/threads', auth, (req, res) => res.json(T.hive.all({ userId: req.user.id }, { order: 'updatedAt', desc: true, limit: 100 }).map((t) => ({ id: t.id, title: t.title, funnelId: t.funnelId, updatedAt: t.updatedAt }))));
  app.get('/api/hive/threads/:tid', auth, (req, res) => { const t = ownThread(req, req.params.tid); t ? res.json(threadView(t)) : res.status(404).json({ error: 'Chat not found' }); });
  app.delete('/api/hive/threads/:tid', auth, (req, res) => { T.hive.delWhere({ id: req.params.tid, userId: req.user.id }); res.json({ ok: true }); });

  // Streams progress as Server-Sent Events: thinking / tool (running|done|error) / reply / error
  app.post('/api/hive/chat', auth, limiter, credits, async (req, res) => {
    const message = String(req.body.message || '').trim().slice(0, 6000);
    if (!message) return res.status(400).json({ error: 'Type a message' });
    if (!hiveReady()) return res.status(503).json({ error: 'Hive AI needs an AI model with tool support — set KIE_API_KEY (with KIE_MODEL deepseek-v4-1-flash, gpt-…, or kimi-…) on the server.' });
    let t = ownThread(req, req.body.threadId);
    if (!t) t = T.hive.insert({ id: uid(), userId: req.user.id, title: message.slice(0, 60), funnelId: req.body.funnelId || null, messages: [], at: Date.now(), updatedAt: Date.now() });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const emit = (ev) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    emit({ type: 'thread', threadId: t.id });
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const ping = setInterval(() => emit({ type: 'ping' }), 15000);
    const history = t.messages.map((m) => ({ role: m.role, text: m.text }));
    t.messages.push({ role: 'user', text: message, at: Date.now() });
    T.hive.put(t);
    try {
      const out = await hiveTurn({ ctx: ctxFor(req.user, appUrl(req)), history, message, focusFunnelId: req.body.funnelId || t.funnelId, emit, signal: ac.signal });
      t.messages.push({ role: 'assistant', text: out.text, tools: out.tools, at: Date.now() });
      if (out.funnelId) t.funnelId = out.funnelId;
      emit({ type: 'reply', text: out.text, tools: out.tools, funnelId: t.funnelId });
    } catch (e) {
      const msg = ac.signal.aborted ? 'Stopped.' : `Something went wrong: ${e.message}`;
      t.messages.push({ role: 'assistant', text: msg, error: true, at: Date.now() });
      emit({ type: 'error', error: msg });
    } finally {
      clearInterval(ping);
      t.updatedAt = Date.now();
      if (t.messages.length > 200) t.messages.splice(0, t.messages.length - 200);
      if (T.hive.get(t.id)) T.hive.put(t); // unless the chat was deleted meanwhile
      res.end();
    }
  });

  // ---- personal access tokens for MCP clients ----
  const tokenView = ({ hash, userId, ...t }) => t;
  app.get('/api/hive/tokens', auth, (req, res) => res.json(T.mcptokens.all({ userId: req.user.id }).sort((a, b) => a.at - b.at).map(tokenView)));
  app.post('/api/hive/tokens', auth, (req, res) => {
    if (T.mcptokens.count({ userId: req.user.id }) >= 10) return res.status(400).json({ error: 'You can have up to 10 tokens — revoke one first' });
    const token = `ffmcp_${crypto.randomBytes(24).toString('hex')}`;
    const t = T.mcptokens.insert({ id: uid(), userId: req.user.id, name: String(req.body.name || 'MCP client').slice(0, 60), hash: hashToken(token), prefix: token.slice(0, 12), at: Date.now(), lastUsedAt: null });
    res.json({ ...tokenView(t), token }); // shown once
  });
  app.delete('/api/hive/tokens/:id', auth, (req, res) => { T.mcptokens.delWhere({ id: req.params.id, userId: req.user.id }); res.json({ ok: true }); });

  // ---- MCP server (Streamable HTTP, stateless JSON-RPC) ----
  const mcpUser = (req) => {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!tok.startsWith('ffmcp_')) return null;
    const t = T.mcptokens.find({ hash: hashToken(tok) });
    const u = t && T.users.get(t.userId);
    if (!u) return null;
    if (Date.now() - (t.lastUsedAt || 0) > 60000) { t.lastUsedAt = Date.now(); T.mcptokens.put(t); }
    return u;
  };
  const mcpLimiter = rateLimit({ windowMs: 60000, max: isTest ? 5000 : 120, key: (req) => String(req.headers.authorization || req.ip).slice(-24) });
  app.get('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST (MCP Streamable HTTP)' }));
  app.post('/mcp', mcpLimiter, async (req, res) => {
    const user = mcpUser(req);
    if (!user) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'Unauthorized — create a token in FunnelHive → Settings → Hive AI · MCP access' } });
    const handle = async (m) => {
      const reply = (result) => ({ jsonrpc: '2.0', id: m.id, result });
      const fail = (code, message) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
      if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(-32600, 'Invalid request');
      if (m.id === undefined) return null; // notification (e.g. notifications/initialized)
      switch (m.method) {
        case 'initialize': return reply({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'funnelhive-hive', title: 'FunnelHive · Hive AI', version: '1.0.0' }, instructions: 'Build and edit sales funnels, pages, coupons, pipelines and automations in the user’s FunnelHive account. Start with list_funnels or create_funnel.' });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
        case 'tools/call': {
          const t = byName[m.params?.name];
          if (!t) return fail(-32602, `Unknown tool: ${m.params?.name}`);
          try {
            const out = await runTool(ctxFor(user, appUrl(req)), t.name, m.params?.arguments || {});
            return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out });
          } catch (e) { return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
        }
        default: return fail(-32601, `Method not found: ${m.method}`);
      }
    };
    const body = req.body;
    if (Array.isArray(body)) { const out = (await Promise.all(body.map(handle))).filter(Boolean); return out.length ? res.json(out) : res.status(202).end(); }
    const out = await handle(body);
    return out ? res.json(out) : res.status(202).end();
  });
}
