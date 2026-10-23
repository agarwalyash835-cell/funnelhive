// Hive AI — build funnels end to end by chatting ("Lovable for funnels").
// One tool registry powers both the in-app Hive chat (DeepSeek via kie.ai, native tool calling) and the
// MCP server at /mcp, so external AI apps (Claude Desktop, Cursor…) can drive the platform too.
// Every tool calls the platform's own REST API as the signed-in seller, so all validation, limits
// and quality gates apply exactly as if the seller clicked it themselves.
import crypto from 'node:crypto';
import { T, uid } from './db.js';
import { hashToken } from './security.js';
import { BLOCK_SPEC, aiProvider, hiveReady, kieResponses } from './ai.js';
import { isAdmin } from './platform.js';
import { PAGE_STYLES } from './page-styles.js';
import { TRIGGERS, VARIABLES } from './automations.js';
import { offerStep } from './actions.js';
import { EVENTS } from './api.js';
import { websiteSteps } from './website.js';

const MAX_MODEL_CALLS = 16, RESULT_MAX = 40000; // a full 21-section page with all props is ~25k characters

// ---------- section defaults when a step is added without content ----------
const STEP_SECTIONS = {
  landing: [{ type: 'hero', props: {} }, { type: 'features', props: {} }, { type: 'testimonials', props: {} }, { type: 'cta', props: {} }],
  sales: [{ type: 'hero', props: {} }, { type: 'features', props: {} }, { type: 'pricing', props: {} }, { type: 'faq', props: {} }],
  optin: [{ type: 'hero', props: {} }, { type: 'optin', props: {} }],
  checkout: [{ type: 'checkout', props: {} }], // no "price locked for 15 minutes" timer: that urgency isn't real
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
    name: 'create_funnel', description: 'Build a COMPLETE funnel from a business description — the right kind for it: a sales funnel (sales page, checkout with order bump, upsell, downsell, thank-you), a video sales letter + qualifying application (high-ticket, "apply for a call"), or a webinar funnel (free registration, confirmation, replay with the paid offer, checkout, upsell, thank-you) — with copy, prices, FOMO and theme. Quality-checked against the template library. Takes ~30–75 s. Use this first whenever the user wants a new funnel; then customise with the edit tools.',
    schema: S({ brief: str('The business: what they sell, to whom, price in ₹, city, anything specific the user said') }, ['brief']),
    run: async (ctx, a) => { const f = await ctx.call('POST', '/ai/generate', { prompt: a.brief }); return { ...outline(f, ctx.origin), usedAI: f.usedAI, qualityCheck: f.quality ? { passed: f.quality.finalIssues === 0 } : undefined }; },
    summary: (r) => `Built “${r.name}” — ${r.steps.length} pages, ${r.steps.reduce((n, s) => n + s.sections.length, 0)} sections`, touchesResult: true,
  },
  {
    name: 'list_templates', description: 'The 100+ ready-made funnel templates: sales, VSL + application and webinar funnels (id, name, category, type).',
    schema: S({}), run: async (ctx) => (await ctx.call('GET', '/templates')).map((t) => ({ id: t.id, name: t.name, category: t.category, type: t.type })),
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
      const lastOf = (types) => f.steps.reduce((idx, s, i) => (types.includes(s.type) ? i : idx), -1);
      if ((a.type === 'upsell' || a.type === 'downsell') && lastOf(['checkout']) < 0) throw new Error(`This funnel has no checkout, so a ${a.type} has nothing to follow. Add a checkout page first.`);
      if (!a.sections?.length && (a.type === 'upsell' || a.type === 'downsell')) st.blocks = offerStep(a.type, f).blocks.map((b) => ({ ...b, id: uid() }));
      let at = Number.isInteger(a.position) ? a.position
        : a.type === 'upsell' ? lastOf(['checkout', 'upsell']) + 1
        : a.type === 'downsell' ? lastOf(['checkout', 'upsell', 'downsell']) + 1
        : a.type === 'checkout' ? lastOf(['landing', 'optin', 'sales']) + 1
        : a.type === 'thankyou' ? f.steps.length
        : (() => { const co = lastOf(['checkout']); const ty = f.steps.findIndex((s, i) => s.type === 'thankyou' && i > co); return ty >= 0 ? ty : f.steps.length; })();
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
    name: 'update_funnel', description: `Rename a funnel or change its look: theme.style (${PAGE_STYLES.join('|')}), primary/secondary colours (#hex), headingFont/bodyFont (e.g. Poppins, Mukta, Playfair Display), radius (sharp|soft|round|pill), textSize (sm|md|lg).`,
    schema: S({ funnelId: str('Funnel id'), name: str('New name'), theme: obj('Theme fields to change') }, ['funnelId']), touches: 'funnelId',
    run: async (ctx, a) => { const f = await ctx.call('GET', `/funnels/${a.funnelId}`); const patch = {}; if (a.name) patch.name = a.name; if (a.theme?.style && !PAGE_STYLES.includes(a.theme.style)) throw new Error(`theme.style must be one of ${PAGE_STYLES.join(', ')}`); for (const k of ['primary', 'secondary']) if (a.theme?.[k] && !/^#[0-9a-f]{6}$/i.test(a.theme[k])) throw new Error(`theme.${k} must be a #rrggbb colour`); if (a.theme) patch.theme = { ...f.theme, ...a.theme }; const r = await saveFunnel(ctx, f, patch); return { ok: true, name: r.name, theme: r.theme }; },
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
trigger: {type: ${Object.keys(TRIGGERS).join('|')}, funnelId?, delayMin? (abandoned, minutes), pipelineId+stageId (stage), pipelineId+stageId+days (stuck), tag (tag), fieldId+value? (field), fieldId+offsetDays+time+yearly (date), productId? (student_joined|quiz_passed|course_completed)}.
steps (run top to bottom): {type:'wait', amount, unit:'minutes'|'hours'|'days'} | {type:'wait', mode:'until', time:'10:00'} | {type:'email', subject, body} | {type:'whatsapp', mode:'template', template, language, params:'{{first_name}}, {{checkout_link}}'} | {type:'whatsapp', mode:'text', text} | {type:'tag', tag, action:'add'|'remove'} | {type:'stage', pipelineId, stageId} | {type:'field', fieldId, value (dates: today / +3 days)} | {type:'note', text} | {type:'access', productId, action:'grant'|'revoke', notify} | {type:'enroll', automationId} | {type:'notify', subject, body} (email to the seller) | {type:'webhook', url} | {type:'condition', match:'all'|'any', rules:[{field, op, value, ...}], yes:[steps], no:[steps]} | {type:'split', percent, a:[steps], b:[steps]} | {type:'exit'}.
Condition rule fields: bought (op is/not, funnelId?, value=product contains), tag (is/not, value), stage (is/not, pipelineId, stageId), has (is/not, value phone|email), source (equals/not_equals/contains, value), custom (fieldId, op equals/contains/gt/lt/empty/filled, value), amount (gt/lt/equals), funnel (is/not, funnelId), unsubscribed (is/not), opened / clicked (is/not, stepId? of an email step).
Variables in messages: ${VARIABLES.map((v) => `{{${v}}}`).join(' ')} ({{access_link}} = the buyer's library of purchased products, {{invoice_link}} = their GST invoice).
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
    name: 'list_crm_fields', description: 'The CRM’s custom fields (id, label, type, options) — needed for field / date triggers, the update-field step and custom-field conditions.', schema: S({}),
    run: async (ctx) => (await ctx.call('GET', '/crm/fields')).map((f) => ({ id: f.id, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}) })),
    summary: () => 'Checked your CRM fields',
  },
  {
    name: 'create_pipeline', description: 'Create a sales pipeline with stages.',
    schema: S({ name: str('Pipeline name'), stages: arr('Stages [{name, color?}] left to right', { type: 'object' }) }, ['name', 'stages']),
    run: async (ctx, a) => { const p = await ctx.call('POST', '/pipelines', a); return { ok: true, id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) }; },
    summary: (r) => `Created the “${r.name}” pipeline`,
  },
  {
    name: 'setup_crm', description: 'Switch the CRM to fit a kind of business (its words, fields, pipeline, board). Ready-made styles: general (coach/creator), realestate, clinic, consultant, education, fitness, finance, interior, events, travel, auto, professional (CA/lawyer), recruitment, homeservices (solar/installers), hospitality, store (D2C / online store), abroad (study abroad / immigration), wellness (astrology / healing), saas, ngo. For any other business pass a description and a custom CRM is designed. Never deletes contacts or fields.',
    schema: S({ style: str('A ready-made style id, or "custom"'), description: str('For custom: the business and how it sells') }, ['style']),
    run: async (ctx, a) => {
      let body = { id: a.style };
      if (a.style === 'custom' || !a.style) body = { kit: (await ctx.call('POST', '/ai/crm-kit', { description: a.description || '' })).kit };
      const r = await ctx.call('POST', '/crm/kit', body);
      return { ok: true, name: r.current.name, icon: r.current.icon, labels: r.current.labels, fields: r.fields.filter((x) => [...r.current.columns, ...r.current.filters].includes(x.id)).map((x) => x.label), pipelineId: r.current.pipelineId };
    },
    summary: (r) => `Set up your ${r.icon} ${r.name} CRM`,
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

  // ---------- selling: checkout, products, payment plans, COD ----------
  {
    name: 'configure_checkout',
    description: 'Set how a funnel’s checkout sells: price / MRP, currency (₹ via Razorpay; $ € £ A$ C$ S$ AED via Stripe for international buyers), one-time vs membership (billing monthly|yearly), an EMI-style payment plan next to pay-in-full (installments: {count 2–36, amount per month}), the order bump, physical shipping (address + delivery fee) and Cash on Delivery (+ fee), and the product delivered after payment. Only the fields you pass change.',
    schema: S({
      funnelId: str('Funnel id'), price: num('Price (in the currency)'), mrp: num('Crossed-out MRP'), currency: str('₹ | $ | € | £ | A$ | C$ | S$ | AED'), productName: str('What is sold'),
      billing: str('one-time | monthly | yearly'), installments: obj('{ count, amount } — or { count: 0 } to remove the plan'),
      bump: obj('{ enabled, title, price, description }'), shipping: bool('Physical product: ask for the delivery address'), shippingFee: num('Delivery charge'), cod: bool('Offer Cash on Delivery'), codFee: num('Extra for COD'),
      productId: str('Product to deliver after payment (from list_products)'), bumpProductId: str('Product delivered with the bump'),
    }, ['funnelId']),
    run: async (ctx, a) => {
      const f = await ctx.call('GET', `/funnels/${a.funnelId}`);
      const st = f.steps.find((s) => s.blocks.some((b) => b.type === 'checkout'));
      if (!st) throw new Error('This funnel has no checkout step — add_step with stepType checkout first');
      const b = st.blocks.find((x) => x.type === 'checkout');
      const p = { ...b.props };
      if (a.currency != null) { if (!['₹', '$', '€', '£', 'A$', 'C$', 'S$', 'AED'].includes(a.currency)) throw new Error('currency must be ₹, $, €, £, A$, C$, S$ or AED'); p.currency = a.currency; }
      for (const k of ['price', 'mrp', 'shippingFee', 'codFee']) if (a[k] != null) { if (!(Number(a[k]) >= 0)) throw new Error(`${k} must be a number`); p[k] = Number(a[k]); }
      if (a.productName) p.productName = String(a.productName).slice(0, 120);
      if (a.billing) p.billing = a.billing === 'monthly' || a.billing === 'yearly' ? a.billing : '';
      if (a.installments) { const n = Math.round(Number(a.installments.count) || 0); if (n >= 2) Object.assign(p, { planEnabled: true, planCount: Math.min(36, n), planPrice: Math.round(Number(a.installments.amount) || Math.ceil((p.price || 0) / n * 1.05)) }); else p.planEnabled = false; }
      if (a.bump) Object.assign(p, { ...(a.bump.enabled != null ? { bumpEnabled: !!a.bump.enabled } : {}), ...(a.bump.title ? { bumpTitle: a.bump.title } : {}), ...(a.bump.price != null ? { bumpPrice: Number(a.bump.price) } : {}), ...(a.bump.description ? { bumpDescription: a.bump.description } : {}) });
      if (a.shipping != null) p.shipping = a.shipping ? 'address' : '';
      if (a.cod != null) p.cod = !!a.cod;
      if (a.productId != null) p.productId = a.productId;
      if (a.bumpProductId != null) p.bumpProductId = a.bumpProductId;
      if (p.cod && p.currency && p.currency !== '₹') throw new Error('Cash on Delivery is for ₹ checkouts');
      b.props = p;
      await saveFunnel(ctx, f, { steps: f.steps });
      return { ok: true, price: p.price, currency: p.currency || '₹', billing: p.billing || 'one-time', plan: p.planEnabled ? `${p.planCount} × ${p.planPrice}` : null, cod: !!p.cod, shipping: p.shipping === 'address', product: p.productId || null };
    },
    summary: (r) => `Updated the checkout: ${r.currency}${r.price}${r.billing !== 'one-time' ? ` per ${r.billing === 'monthly' ? 'month' : 'year'}` : ''}${r.plan ? `, plan ${r.plan}` : ''}${r.cod ? ', COD on' : ''}`,
    touches: 'funnelId',
  },
  {
    name: 'list_products', description: 'Digital products the seller delivers (courses, downloads, links): id, name, kind, buyers.', schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/products'); return (d.products || d).map((p) => ({ id: p.id, name: p.name, lessons: p.lessons?.length || 0, files: p.files?.length || 0, links: p.links?.length || 0, accessDays: p.accessDays || null })); },
    summary: () => 'Checked your products',
  },
  {
    name: 'create_product',
    description: 'Create a digital product delivered automatically after payment (or as a free lead magnet): name, description, links [{label,url}], a course outline as lessons [{title, section, body, videoUrl, dripDays}], accessDays (0 = lifetime). A BUNDLE: includes = ids of existing products (list_products) that buying this one also unlocks — e.g. three courses sold together. Files are uploaded by the seller in Products. Attach it with configure_checkout productId (or an opt-in’s productId for a lead magnet).',
    schema: S({ name: str('Product name'), description: str('One line'), links: arr('[{ label, url }]'), lessons: arr('[{ title, section, body, videoUrl, dripDays }]'), includes: arr('Product ids this bundle unlocks', { type: 'string' }), accessDays: num('0 = lifetime') }, ['name']),
    run: async (ctx, a) => {
      let p = await ctx.call('POST', '/products', { name: a.name, description: a.description || '', links: a.links || [], accessDays: a.accessDays || 0 });
      if (a.lessons?.length || a.includes?.length) p = await ctx.call('PUT', `/products/${p.id}`, { ...(a.lessons?.length ? { lessons: a.lessons } : {}), ...(a.includes?.length ? { includes: a.includes } : {}) });
      return { ok: true, id: p.id, name: p.name, lessons: p.lessons?.length || 0, includes: p.includes?.length || 0 };
    },
    summary: (r) => (r.includes ? `Created the bundle “${r.name}” — ${r.includes} products in one` : `Created the product “${r.name}”${r.lessons ? ` with ${r.lessons} lessons` : ''}`),
  },
  {
    name: 'get_sales',
    description: 'Money view for the last N days: revenue (₹, foreign sales converted), orders, refunds, ad spend and ROAS per campaign, unpaid Cash-on-Delivery, active memberships / payment plans, orders waiting to ship.',
    schema: S({ days: num('Days to look back (default 30)') }),
    run: async (ctx, a) => {
      const [ov, od] = await Promise.all([ctx.call('GET', `/analytics/overview?days=${a.days || 30}`), ctx.call('GET', '/orders')]);
      const orders = od.orders || [];
      return {
        totals: ov.totals, refunded: ov.refunded, adSpend: Math.round(ov.adSpend || 0), roas: ov.adSpend ? Math.round(((ov.totals?.revenue || 0) / ov.adSpend) * 100) / 100 : null,
        campaigns: (ov.campaigns || []).slice(0, 8).map((x) => ({ campaign: x.campaign || '(untagged)', source: x.source, leads: x.leads, orders: x.orders, revenue: Math.round(x.revenue), spend: x.spend ?? null, roas: x.roas ?? null })),
        codToCollect: orders.filter((o) => o.status === 'cod').reduce((s, o) => s + o.total, 0), toShip: orders.filter((o) => o.fulfilment?.status === 'pending' && !['cancelled', 'refunded'].includes(o.status)).length,
        plans: { active: orders.filter((o) => o.plan && ['active', 'authenticated'].includes(o.plan.status)).length, failing: orders.filter((o) => o.plan && ['pending', 'halted'].includes(o.plan.status)).length },
        abandonedCheckouts: (od.abandoned || []).length,
      };
    },
    summary: () => 'Pulled your sales numbers',
  },

  // ---------- calls & webinars ----------
  {
    name: 'configure_calendar',
    description: 'Set up the booking calendar used by “book a call” pages: name, duration (min), weekly hours {mon:[["10:00","18:00"]], …, sun:[]}, buffer, noticeHours, daysAhead, perDay cap, timezone (IANA, e.g. Asia/Kolkata, America/New_York), meetingLink, price (0 = free call) and currency (INR default; USD, EUR, GBP, AUD, CAD, SGD, AED) — paid calls are paid before they’re confirmed: ₹ via Razorpay, other currencies by card via Stripe, refundHours. calendarId optional (default calendar).',
    schema: S({ calendarId: str('Calendar id (optional)'), name: str('Call name'), duration: num('Minutes'), hours: obj('Weekly hours by day'), buffer: num('Minutes between calls'), noticeHours: num('Minimum notice'), daysAhead: num('Bookable days ahead'), perDay: num('Max calls per day (0 = no cap)'), timezone: str('IANA time zone'), meetingLink: str('https:// video link'), price: num('Price per call, 0 = free'), currency: str('INR, USD, EUR, GBP, AUD, CAD, SGD or AED'), refundHours: num('Refund if cancelled this many hours before') }),
    run: async (ctx, a) => {
      const list = await ctx.call('GET', '/calendars');
      const cal = a.calendarId ? list.find((x) => x.id === a.calendarId) : list[0];
      if (!cal) throw new Error('Calendar not found');
      const { calendarId, ...patch } = a;
      const r = await ctx.call('PUT', `/calendars/${cal.id}`, patch);
      return { ok: true, id: r.id, name: r.name, duration: r.duration, price: r.price || 0, currency: r.currency || 'INR', timezone: r.timezone || cal.timezone };
    },
    summary: (r) => `Updated the “${r.name}” calendar (${r.duration} min${r.price ? `, ${r.currency && r.currency !== 'INR' ? `${r.currency} ` : '₹'}${r.price}` : ', free'})`,
  },
  {
    name: 'list_bookings', description: 'Booked calls (upcoming by default): when, who, status, paid.',
    schema: S({ past: bool('Past / cancelled instead of upcoming') }),
    run: async (ctx, a) => { const now = Date.now(); return (await ctx.call('GET', '/bookings')).filter((b) => (a.past ? b.status !== 'confirmed' || b.end < now : b.status === 'confirmed' && b.end >= now)).slice(0, 30).map((b) => ({ start: new Date(b.start).toISOString(), timezone: b.calendar?.timezone, name: b.name, email: b.email, status: b.status, paid: b.paid || null, call: b.calendar?.name })); },
    summary: (r) => `Found ${r.length} booking${r.length === 1 ? '' : 's'}`,
  },
  {
    name: 'create_quote',
    description: 'Write a quote / proposal with a private pay link for a client (consulting, coaching, done-for-you work): client name + email, title, intro, line items [{name, detail, qty, price}], currency (INR default; USD, EUR, GBP, AUD, CAD, SGD, AED), deposit % paid first (0 = full), validDays, terms. Returns the link. It is NOT emailed unless send is true — only set send when the user explicitly asks to send it.',
    schema: S({ clientName: str('Client name'), clientEmail: str('Client email'), clientCompany: str('Company (optional)'), title: str('Proposal title'), intro: str('What you’ll do and the outcome'), items: arr('Line items [{name, detail, qty, price}]'), currency: str('INR, USD, EUR, GBP, AUD, CAD, SGD or AED'), deposit: num('Deposit % paid first, 0 = full payment'), validDays: num('Days the quote is valid (default 14)'), terms: str('Payment / delivery terms'), send: bool('Email the link to the client now') }, ['clientName', 'title', 'items']),
    run: async (ctx, a) => {
      const q = await ctx.call('POST', '/quotes', { client: { name: a.clientName, email: a.clientEmail || '', company: a.clientCompany || '' }, title: a.title, intro: a.intro || '', items: a.items, currency: a.currency || 'INR', deposit: a.deposit || 0, validDays: a.validDays || 14, terms: a.terms || '' });
      if (!q.items.length) throw new Error('Add at least one line item with a name and price');
      const sent = a.send && a.clientEmail ? await ctx.call('POST', `/quotes/${q.id}/send`, {}) : null;
      return { ok: true, id: q.id, number: q.number, total: q.total, currency: q.currency, firstPayment: q.due, link: q.link, sent: !!sent };
    },
    summary: (r) => `${r.sent ? 'Sent' : 'Created'} quote ${r.number} (${r.currency} ${r.total})`,
  },
  {
    name: 'list_quotes', description: 'Quotes / proposals with their status (draft, sent, viewed, deposit_paid, paid, declined, expired), totals and pay links.',
    schema: S({}),
    run: async (ctx) => (await ctx.call('GET', '/quotes')).slice(0, 30).map((q) => ({ number: q.number, title: q.title, client: q.client.name, total: q.total, paid: q.paid, currency: q.currency, status: q.status, link: q.link })),
    summary: (r) => `Found ${r.length} quote${r.length === 1 ? '' : 's'}`,
  },
  {
    name: 'configure_webinar',
    description: 'Schedule a webinar behind a registration funnel: schedule {type: weekly (days ["sun"], times ["19:00"]) | daily (times, show = sessions to choose from) | once (dates ["2026-11-02T19:00"])}, timezone (IANA), duration (min), joinUrl (Zoom / Meet / YouTube Live), replayUrl, replayHours, reminder emails {day, hour, live, replay}. Identify it by funnelId or webinarId.',
    schema: S({ funnelId: str('Registration funnel id'), webinarId: str('Webinar id'), name: str('Webinar name'), schedule: obj('{ type, days, times, dates, show }'), timezone: str('IANA time zone'), duration: num('Minutes'), joinUrl: str('https:// link'), replayUrl: str('https:// link'), replayHours: num('Replay available hours (0 = always)'), emails: obj('{ day, hour, live, replay } booleans') }),
    run: async (ctx, a) => {
      const list = await ctx.call('GET', '/webinars');
      const w = list.find((x) => (a.webinarId && x.id === a.webinarId) || (a.funnelId && x.funnelId === a.funnelId));
      if (!w) throw new Error('No webinar for that funnel — it needs a registration form marked as a webinar registration');
      const { funnelId, webinarId, ...patch } = a;
      await ctx.call('PUT', `/webinars/${w.id}`, patch);
      const r = (await ctx.call('GET', '/webinars')).find((x) => x.id === w.id) || w; // with its next session
      return { ok: true, name: r.name, next: r.next ? new Date(r.next).toISOString() : null, timezone: r.timezone || w.timezone, joinUrl: !!r.joinUrl };
    },
    summary: (r) => `Scheduled “${r.name}”${r.joinUrl ? '' : ' (add the joining link before the first session)'}`,
  },

  // ---------- contacts & broadcasts ----------
  {
    name: 'find_contacts', description: 'Search the CRM by text (name / email / phone), tag, type (lead | customer), pipeline stage name, or custom field values (e.g. {"BHK": "3 BHK", "Preferred location": "Baner"} — matched by field name, contains). Returns a count and up to 25 with their custom fields (by name) and stage. Use it to answer questions like "who has a site visit this week" or "total budget of 3 BHK leads".',
    schema: S({ query: str('Text to match'), tag: str('Has this tag'), type: str('lead | customer'), stage: str('Stage name in the CRM pipeline'), fields: obj('Custom field filters { "Field name": "value" }') }),
    run: async (ctx, a) => {
      const [d, defs, kits, pipes] = await Promise.all([ctx.call('GET', '/contacts'), ctx.call('GET', '/crm/fields'), ctx.call('GET', '/crm/kits'), ctx.call('GET', '/pipelines')]);
      const all = d.contacts || d;
      const pipe = pipes.find((p) => p.id === kits.current?.pipelineId) || pipes[0];
      const stageName = (x) => pipe?.stages.find((st) => st.id === x.stages?.[pipe.id])?.name || '';
      const named = (x) => Object.fromEntries(defs.filter((fd) => x.custom?.[fd.id] != null && x.custom[fd.id] !== '').map((fd) => [fd.label, x.custom[fd.id]]));
      const q = String(a.query || '').toLowerCase();
      const want = Object.entries(a.fields || {}).map(([label, v]) => [defs.find((fd) => fd.label.toLowerCase() === String(label).toLowerCase() || fd.id === label), String(v).toLowerCase()]).filter(([fd]) => fd);
      const hit = all.filter((x) => (!q || `${x.name} ${x.email} ${x.phone}`.toLowerCase().includes(q)) && (!a.tag || (x.tags || []).some((t) => t.toLowerCase() === a.tag.toLowerCase())) && (!a.type || x.type === a.type)
        && (!a.stage || stageName(x).toLowerCase() === String(a.stage).toLowerCase()) && want.every(([fd, v]) => String(x.custom?.[fd.id] ?? '').toLowerCase().includes(v)));
      return { count: hit.length, pipeline: pipe?.name, contacts: hit.slice(0, 25).map((x) => ({ key: x.key, name: x.name, email: x.email, phone: x.phone, type: x.type, stage: stageName(x), fields: named(x), tags: x.tags, orders: x.orders, ltv: x.ltv })) };
    },
    summary: (r) => `Found ${r.count} contact${r.count === 1 ? '' : 's'}`,
  },
  {
    name: 'update_contact', description: 'Update one CRM record by its key (from find_contacts): set custom fields by name (e.g. {"Site visit": "2026-10-30", "Budget (₹)": 8500000}), move it to a pipeline stage by name, and/or add a note.',
    schema: S({ key: str('Contact key'), fields: obj('{ "Field name": value }'), stage: str('Stage name to move to'), note: str('A note to add to the timeline') }, ['key']),
    run: async (ctx, a) => {
      const [defs, kits, pipes] = await Promise.all([ctx.call('GET', '/crm/fields'), ctx.call('GET', '/crm/kits'), ctx.call('GET', '/pipelines')]);
      const key = encodeURIComponent(a.key);
      const custom = {}, unknown = [];
      for (const [label, v] of Object.entries(a.fields || {})) { const fd = defs.find((x) => x.label.toLowerCase() === String(label).toLowerCase() || x.id === label); if (fd) custom[fd.id] = v; else unknown.push(label); }
      const body = {};
      if (Object.keys(custom).length) body.custom = custom;
      let moved = null;
      if (a.stage) {
        const pipe = pipes.find((p) => p.id === kits.current?.pipelineId) || pipes[0];
        const st = pipe?.stages.find((x) => x.name.toLowerCase() === String(a.stage).toLowerCase());
        if (!st) return { error: `No stage “${a.stage}” — stages: ${pipe?.stages.map((x) => x.name).join(', ')}` };
        body.stage = { pipelineId: pipe.id, stageId: st.id }; moved = st.name;
      }
      if (Object.keys(body).length) await ctx.call('PATCH', `/contacts/${key}`, body);
      if (a.note) await ctx.call('POST', `/contacts/${key}/activity`, { type: 'note', text: String(a.note).slice(0, 2000) });
      return { ok: true, key: a.key, updated: Object.keys(custom).length, moved, noted: !!a.note, ...(unknown.length ? { unknownFields: unknown } : {}) };
    },
    summary: (r) => (r.error ? r.error : `Updated ${r.key}${r.moved ? ` → ${r.moved}` : ''}`),
  },
  {
    name: 'tag_contacts', description: 'Add (or remove) a tag on contacts — by their keys (emails) from find_contacts. Adding a tag starts “tag added” automations.',
    schema: S({ keys: arr('Contact keys / emails', { type: 'string' }), tag: str('Tag'), remove: bool('Remove instead of add') }, ['keys', 'tag']),
    run: async (ctx, a) => { await ctx.call('POST', '/contacts/bulk', { keys: a.keys.slice(0, 5000), [a.remove ? 'removeTag' : 'addTag']: a.tag }); return { ok: true, n: a.keys.length, tag: a.tag, removed: !!a.remove }; },
    summary: (r) => `${r.removed ? 'Removed' : 'Added'} “${r.tag}” ${r.removed ? 'from' : 'to'} ${r.n} contact${r.n === 1 ? '' : 's'}`,
  },
  {
    name: 'draft_broadcast',
    description: 'Write a broadcast as a DRAFT (never sends): channel email (subject + body with {{first_name}}, {{name}}, {{business}}) or whatsapp (an approved template name + params). Audience segment: { type all|leads|customers, tags [], notTags [], funnelId, days (joined in last N), minSpend }. Returns how many it would reach.',
    schema: S({ channel: str('email | whatsapp'), name: str('Internal name'), subject: str('Email subject'), body: str('Email body'), template: str('WhatsApp template name'), params: str('WhatsApp template params, comma-separated'), segment: obj('Audience') }, ['channel']),
    run: async (ctx, a) => {
      const b = await ctx.call('POST', '/broadcasts', { channel: a.channel, name: a.name || 'Broadcast', subject: a.subject || '', body: a.body || '', wa: { template: a.template || '', params: a.params || '' }, segment: a.segment || {} });
      const aud = await ctx.call('POST', '/broadcasts/audience', { channel: a.channel, segment: b.segment });
      return { ok: true, id: b.id, name: b.name, reach: aud.reach, leftOut: aud.left, link: `${ctx.origin}/broadcasts` };
    },
    summary: (r) => `Drafted “${r.name}” for ${r.reach} contact${r.reach === 1 ? '' : 's'} — review it in Broadcasts`,
  },
  {
    name: 'send_broadcast', description: 'Send (or schedule with at = ISO date-time) a drafted broadcast. ONLY when the user explicitly says to send or schedule it, after they’ve seen the draft.',
    schema: S({ broadcastId: str('From draft_broadcast'), at: str('Optional ISO date-time to schedule') }, ['broadcastId']),
    run: async (ctx, a) => { const r = await ctx.call('POST', `/broadcasts/${a.broadcastId}/send`, a.at ? { at: Date.parse(a.at) } : {}); return { ok: true, status: r.status, at: r.scheduledAt ? new Date(r.scheduledAt).toISOString() : null }; },
    summary: (r) => (r.at && Date.parse(r.at) > Date.now() + 60000 ? `Scheduled the broadcast for ${r.at}` : 'Sending the broadcast now'),
  },

  // ---------- agency & account ----------
  {
    name: 'list_clients', description: 'Agency: client accounts with their 30-day numbers.', schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/agency'); return { limit: d.limit, clients: d.clients.map((c) => ({ id: c.id, business: c.business, funnels: c.funnels, visitors: c.stats.visitors, leads: c.stats.leads, revenue: c.stats.revenue })) }; },
    summary: (r) => `${r.clients.length} client account${r.clients.length === 1 ? '' : 's'}`,
  },
  {
    name: 'copy_funnel_to_client', description: 'Agency: copy a funnel (pages, paused automations, products) into a client account.',
    schema: S({ funnelId: str('Funnel id'), clientId: str('Client account id (list_clients)') }, ['funnelId', 'clientId']),
    run: async (ctx, a) => ctx.call('POST', `/funnels/${a.funnelId}/copy-to`, { accountId: a.clientId }),
    summary: () => 'Copied the funnel to the client account',
  },
  {
    name: 'update_business', description: 'Business settings: businessName, supportWhatsapp (number), timezone (IANA — booking hours, webinars, “wait until” and report days follow it), and privacy: consentBanner (cookie banner before tracking pixels), consentCheckbox (required consent tick on forms).',
    schema: S({ businessName: str('Business name'), supportWhatsapp: str('WhatsApp number'), timezone: str('IANA time zone'), consentBanner: bool('Cookie consent banner'), consentCheckbox: bool('Consent tick box on forms') }),
    run: async (ctx, a) => {
      const s = {};
      for (const k of ['businessName', 'supportWhatsapp', 'timezone']) if (a[k] != null) s[k] = a[k];
      if (Object.keys(s).length) await ctx.call('PUT', '/settings', s);
      if (a.consentBanner != null || a.consentCheckbox != null) await ctx.call('PUT', '/privacy', { ...(a.consentBanner != null ? { banner: a.consentBanner } : {}), ...(a.consentCheckbox != null ? { checkbox: a.consentCheckbox } : {}) });
      return { ok: true, ...s, ...(a.consentBanner != null ? { consentBanner: a.consentBanner } : {}), ...(a.consentCheckbox != null ? { consentCheckbox: a.consentCheckbox } : {}) };
    },
    summary: () => 'Updated your business settings',
  },
  {
    name: 'create_website',
    description: `Build a complete business WEBSITE (not a sales funnel): Home, About, Services and Contact pages with the same header menu and footer, a contact form and WhatsApp button. Use it when the user wants a website / homepage / online presence for a coach, consultant, clinic, agency, studio or local business. Write all copy yourself — specific to their business, never placeholders. Only pass stats and testimonials the user actually gave you (never invent numbers or reviews). Then customise with the edit tools (pages: home, about, services, contact).`,
    schema: S({
      brand: str('Business name'), tagline: str('One line: who they help and how'), headline: str('Home page headline; wrap 1–3 words in *stars* to highlight'), sub: str('Home subheadline'), badge: str('Small label above the headline'),
      ctaText: str('Main button, e.g. Book a free call'), services: arr('[{ icon (emoji), title, text, price (optional, e.g. ₹2,999) }] — 3 to 9'), process: arr('[{ title, text }] — how working together goes, 3 steps'),
      owner: obj('{ name, role, bio, points: [text] } — the founder / expert'), story: str('Optional longer “our story” for the About page'), faqs: arr('[{ q, a }]'),
      contact: obj('{ phone, whatsapp, email, address, hours } — only what the user gave'), stats: arr('[{ value, label }] — ONLY real numbers the user gave'), testimonials: arr('[{ name, quote, tag }] — ONLY real ones the user gave'),
      style: str(`Page style: ${PAGE_STYLES.join(' | ')}`), primary: str('Brand colour #hex'),
    }, ['brand', 'tagline', 'services']),
    touchesResult: true,
    run: async (ctx, a) => {
      const steps = websiteSteps(a).map((st) => ({ ...st, id: uid(), blocks: st.blocks.map((b) => ({ id: uid(), type: b.type, props: b.props })) }));
      const style = PAGE_STYLES.includes(a.style) ? a.style : 'clean';
      const primary = /^#[0-9a-f]{6}$/i.test(a.primary || '') ? a.primary : '#4f46e5';
      const f = await ctx.call('POST', '/funnels', { name: `${String(a.brand).slice(0, 80)} — website` });
      const saved = await saveFunnel(ctx, f, { steps, theme: { ...f.theme, style, primary } });
      return { ok: true, id: saved.id, name: saved.name, pages: saved.steps.map((x) => x.slug), previewUrl: `${ctx.origin}/f/${saved.slug}` };
    },
    summary: (r) => `Built the website “${r.name}” — ${r.pages.length} pages`,
  },
  {
    name: 'generate_image',
    description: `Make an image with AI (costs 10 AI credits) and store it in the seller's media: a hero photo, an about-page portrait style shot, a product mock-up, or an ad creative. Write a detailed visual prompt (subject, setting, light, style, Indian context when relevant); never put words or prices inside the image, never imitate a real person or brand, and never make "results" or testimonial images. aspect: 16:9 (hero / banner), 1:1 (feed ad, square), 4:5 (Instagram feed ad), 9:16 (Reels / Stories ad), 4:3 or 3:4 (sections). To place it on a page, also give funnelId, stepId and sectionId (hero / image / mentor sections; field defaults to the right one).`,
    schema: S({ prompt: str('Detailed description of the image'), aspect: str('16:9 | 1:1 | 4:5 | 9:16 | 4:3 | 3:4 | 3:2 | 2:3 | 5:4 | 21:9'), funnelId: str('Optional: place it on this funnel'), stepId: str('Optional: the page'), sectionId: str('Optional: the section'), field: str('Optional: image field (hero/mentor: image, image: src, navbar: logo)') }, ['prompt']),
    touches: 'funnelId',
    run: async (ctx, a) => {
      const img = await ctx.call('POST', '/ai/image', { prompt: a.prompt, aspect: a.aspect || '16:9' });
      if (!(a.funnelId && a.stepId && a.sectionId)) return { ok: true, url: img.url, aspect: img.aspect, placed: false };
      const r = await editStep(ctx, a.funnelId, a.stepId, (st) => {
        const b = st.blocks.find((x) => x.id === a.sectionId);
        if (!b) throw new Error('No section with that id on this page — call get_page for the ids');
        const field = a.field || { image: 'src', navbar: 'logo' }[b.type] || 'image';
        b.props = { ...b.props, [field]: img.url, ...(b.type === 'image' && !b.props?.alt ? { alt: String(a.prompt).slice(0, 120) } : {}) };
        return { field, section: b.type };
      });
      return { ok: true, url: img.url, aspect: img.aspect, placed: true, section: r.section, field: r.field };
    },
    summary: (r) => (r.placed ? `Made an image and put it in the ${r.section} section` : `Made an image (${r.aspect})`),
  },
  // ---- the school: courses, quizzes, community ----
  {
    name: 'school_overview', description: 'The seller’s school (members area): its link, students, community spaces (ids) and courses (ids, lessons, quizzes, certificate).', schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/school'); return { url: d.url, settings: { name: d.settings.name, openJoin: d.settings.openJoin, tutor: d.settings.tutor }, stats: d.stats, spaces: d.spaces.map(({ id, name, access, posts }) => ({ id, name, access, posts })), courses: d.courses }; },
    summary: (r) => `Looked at your school (${r.stats.students} students, ${r.courses.length} courses)`,
  },
  {
    name: 'create_course',
    description: 'Write a complete online course with AI — modules, full lessons with real teaching, and quizzes — and save it as a product students get in the members area (costs 5 AI credits). Then attach it to a checkout with configure_checkout productId. certificate: true gives a certificate when they finish.',
    schema: S({ topic: str('What it teaches'), audience: str('Who it’s for'), level: str('beginner | intermediate | advanced'), lessons: num('About how many lessons (3–30)'), language: str('e.g. English, Hindi, Hinglish'), notes: str('Optional: the creator’s own outline or notes to follow'), certificate: bool('Certificate on completion'), accessDays: num('0 = lifetime') }, ['topic']),
    run: async (ctx, a) => {
      const c = await ctx.call('POST', '/ai/course', { topic: a.topic, audience: a.audience, level: a.level, lessons: a.lessons, language: a.language, notes: a.notes });
      let p = await ctx.call('POST', '/products', { name: c.name, description: c.description, accessDays: a.accessDays || 0 });
      p = await ctx.call('PUT', `/products/${p.id}`, { lessons: c.lessons, ...(a.certificate ? { certificate: { enabled: true, title: `Certificate of completion — ${c.name}`.slice(0, 120) } } : {}) });
      return { ok: true, id: p.id, name: p.name, lessons: p.lessons.length, quizzes: p.lessons.filter((l) => l.quiz).length, modules: [...new Set(p.lessons.map((l) => l.section))] };
    },
    summary: (r) => `Wrote the course “${r.name}” — ${r.lessons} lessons, ${r.quizzes} quizzes`,
  },
  {
    name: 'add_quiz', description: 'Add an AI-written quiz (from the lesson’s own text) to one lesson of a course. Get ids from list_products / school_overview, lesson ids from get_course.',
    schema: S({ productId: str('Course (product) id'), lessonId: str('Lesson id'), count: num('Questions (2–10, default 4)'), pass: num('Pass mark % (default 70)') }, ['productId', 'lessonId']),
    run: async (ctx, a) => {
      const p = await ctx.call('GET', `/products/${a.productId}`);
      const l = p.lessons.find((x) => x.id === a.lessonId);
      if (!l) throw new Error('No lesson with that id in this course');
      const quiz = await ctx.call('POST', '/ai/quiz', { title: l.title, text: l.body, count: a.count });
      if (a.pass != null) quiz.pass = Math.max(0, Math.min(100, Math.round(a.pass)));
      await ctx.call('PUT', `/products/${p.id}`, { lessons: p.lessons.map((x) => (x.id === l.id ? { ...x, quiz } : x)) });
      return { ok: true, lesson: l.title, questions: quiz.questions.length };
    },
    summary: (r) => `Added a ${r.questions}-question quiz to “${r.lesson}”`,
  },
  {
    name: 'get_course', description: 'One course’s lessons (ids, titles, modules, which have quizzes) and certificate setting.', schema: S({ productId: str('Course (product) id') }, ['productId']),
    run: async (ctx, a) => { const p = await ctx.call('GET', `/products/${a.productId}`); return { id: p.id, name: p.name, certificate: !!p.certificate?.enabled, lessons: p.lessons.map((l) => ({ id: l.id, title: l.title, section: l.section, quiz: !!l.quiz, words: String(l.body || '').split(/\s+/).filter(Boolean).length })) }; },
    summary: (r) => `Opened the course “${r.name}”`,
  },
  {
    name: 'create_space',
    description: 'Add a community space (a channel) to the school. access: open (anyone who joins the school), buyers (anyone who bought something), products (only buyers of productIds — e.g. a paid inner circle). postBy: members (anyone can post) or admins (announcements).',
    schema: S({ name: str('e.g. General, Wins, Q&A, Announcements'), emoji: str('One emoji'), description: str('One line'), access: str('open | buyers | products'), productIds: arr('For access "products"', { type: 'string' }), postBy: str('members | admins') }, ['name']),
    run: async (ctx, a) => { const x = await ctx.call('POST', '/school/spaces', a); return { ok: true, id: x.id, name: x.name, access: x.access }; },
    summary: (r) => `Created the space “${r.name}” (${r.access})`,
  },
  {
    name: 'post_to_community', description: 'Post in a community space as the school (an announcement, a welcome, a weekly challenge). pinned keeps it on top.',
    schema: S({ spaceId: str('From school_overview'), title: str('Title'), body: str('The post'), pinned: bool('Pin it') }, ['spaceId', 'body']),
    run: async (ctx, a) => { const p = await ctx.call('POST', `/school/spaces/${a.spaceId}/posts`, { title: a.title || '', body: a.body, pinned: !!a.pinned }); return { ok: true, id: p.id, title: p.title }; },
    summary: (r) => `Posted “${r.title || 'a post'}” in your community`,
  },
  // ---- split tests, tracking, domains, team, webhooks, copies ----
  {
    name: 'split_test',
    description: `A/B test one page (step): half the visitors (or "split" %) see variant B. action:
- "start": copy the page as variant B, then apply changes [{ sectionId (from get_funnel / get_page — the original page's ids), props }] to B only. E.g. test two headlines.
- "edit": change variant B again with the same changes list.
- "results": views, conversions and the verdict per variant (only call after it has had traffic).
- "pick": keep winner "A" or "B" — B's sections become the page and the test ends.
- "stop": end the test and keep the original page.`,
    schema: S({ funnelId: str('Funnel id'), stepId: str('Step id'), action: str('start | edit | results | pick | stop'), changes: arr('[{ sectionId, props }] for variant B'), split: num('% of visitors who see B (10–90, default 50)'), winner: str('A or B (for pick)') }, ['funnelId', 'stepId', 'action']),
    touches: 'funnelId',
    run: async (ctx, a) => {
      if (a.action === 'results') {
        const d = await ctx.call('GET', `/funnels/${a.funnelId}/analytics?days=90`);
        const s = d.steps.find((x) => x.id === a.stepId);
        if (!s) throw new Error('Step not found');
        if (!s.ab) return { running: false };
        return { running: true, A: s.ab.A, B: s.ab.B, verdict: s.ab.result };
      }
      const r = await editStep(ctx, a.funnelId, a.stepId, (st) => {
        if (a.action === 'start' || a.action === 'edit') {
          if (a.action === 'start' || !st.ab?.blocks) {
            // B starts as a copy; its sections keep the original ids' order so changes can name the original ids
            st.ab = { enabled: true, split: 50, blocks: st.blocks.map((b) => ({ ...b, id: uid(), from: b.id, props: JSON.parse(JSON.stringify(b.props || {})) })) };
          }
          if (a.split != null) st.ab.split = Math.min(90, Math.max(10, Math.round(Number(a.split) / 5) * 5));
          st.ab.enabled = true;
          let changed = 0;
          for (const c of a.changes || []) {
            const b = st.ab.blocks.find((x) => x.from === c.sectionId || x.id === c.sectionId);
            if (!b || !c.props || typeof c.props !== 'object') continue;
            b.props = { ...b.props, ...c.props };
            changed++;
          }
          if ((a.changes || []).length && !changed) throw new Error('None of those section ids are on this page — call get_page for the ids');
          return { started: true, split: st.ab.split, changed };
        }
        if (a.action === 'pick') {
          if (!st.ab?.blocks) throw new Error('This page has no split test');
          const w = String(a.winner || '').toUpperCase();
          if (w !== 'A' && w !== 'B') throw new Error('winner must be A or B');
          if (w === 'B') st.blocks = st.ab.blocks.map(({ from, ...b }) => b);
          st.ab = { ...st.ab, enabled: false };
          return { picked: w };
        }
        if (a.action === 'stop') { if (st.ab) st.ab = { ...st.ab, enabled: false }; return { stopped: true }; }
        throw new Error('action must be start, edit, results, pick or stop');
      });
      const { funnel, step, ...out } = r;
      return { ok: true, ...out };
    },
    summary: (r, a) => (a.action === 'results' ? (r.running ? 'Checked the split test results' : 'No split test is running on that page')
      : a.action === 'pick' ? `Kept variant ${r.picked} — the test is over` : a.action === 'stop' ? 'Stopped the split test (the original page stays)'
        : `Split test ${a.action === 'start' ? 'started' : 'updated'} — ${r.split}% of visitors see variant B`),
  },
  {
    name: 'set_tracking',
    description: 'Install tracking: Meta (Facebook) Pixel ID (digits), Google Analytics 4 ID (G-…), Google Ads conversion ID (AW-…) with optional conversion labels purchaseLabel / leadLabel / bookingLabel. funnelId = only for that funnel (overrides the account-wide ids); leave it out for every funnel. Pass "" to remove one. The Meta Conversions API token is a secret: the seller adds it in Settings → Tracking, never in chat.',
    schema: S({ funnelId: str('Optional: just this funnel'), fbPixel: str('Meta Pixel ID'), ga4: str('GA4 measurement ID, G-…'), googleAdsId: str('AW-…'), purchaseLabel: str('Google Ads purchase label'), leadLabel: str('Google Ads lead label'), bookingLabel: str('Google Ads booking label') }),
    run: async (ctx, a) => {
      const ads = ['googleAdsId', 'purchaseLabel', 'leadLabel', 'bookingLabel'].some((k) => a[k] != null)
        ? { conversionId: a.googleAdsId ?? '', purchaseLabel: a.purchaseLabel ?? '', leadLabel: a.leadLabel ?? '', bookingLabel: a.bookingLabel ?? '' } : null;
      const t = { ...(a.fbPixel != null ? { fbPixel: a.fbPixel } : {}), ...(a.ga4 != null ? { ga4: a.ga4 } : {}), ...(ads ? { googleAds: ads } : {}) };
      if (a.funnelId) {
        const cur = (await ctx.call('GET', `/funnels/${a.funnelId}/tracking`)).tracking || {};
        const r = await ctx.call('PUT', `/funnels/${a.funnelId}/tracking`, { fbPixel: cur.fbPixel || '', ga4: cur.ga4 || '', googleAds: cur.googleAds || {}, ...t });
        return { ok: true, scope: 'funnel', tracking: { fbPixel: r.tracking?.fbPixel || '', ga4: r.tracking?.ga4 || '', googleAds: r.tracking?.googleAds?.conversionId || '' } };
      }
      const s = await ctx.call('PUT', '/settings', { tracking: t });
      return { ok: true, scope: 'account', tracking: { fbPixel: s.tracking?.fbPixel || '', ga4: s.tracking?.ga4 || '', googleAds: s.tracking?.googleAds?.conversionId || '' } };
    },
    summary: (r) => `Tracking ${r.scope === 'funnel' ? 'for this funnel' : 'for all funnels'}: ${[r.tracking.fbPixel && 'Meta Pixel', r.tracking.ga4 && 'GA4', r.tracking.googleAds && 'Google Ads'].filter(Boolean).join(', ') || 'none'}`,
  },
  {
    name: 'connect_domain',
    description: 'Put a funnel on the seller’s own domain (e.g. offer.brand.in or brand.in). Returns the DNS records the seller adds at their domain provider (GoDaddy, Hostinger…) — show them clearly as a table. Then check_domain verifies once they’ve added them (DNS can take minutes to hours).',
    schema: S({ domain: str('e.g. offer.brand.in'), funnelId: str('Funnel to show there') }, ['domain', 'funnelId']),
    touches: 'funnelId',
    run: async (ctx, a) => {
      const d = await ctx.call('POST', '/domains', { domain: a.domain, funnelId: a.funnelId });
      return { ok: true, domainId: d.id, domain: d.domain, status: d.status, records: (d.records || []).map(({ type, name, value, optional }) => ({ type, name, value, ...(optional ? { optional } : {}) })) };
    },
    summary: (r) => `Added ${r.domain} — waiting for its DNS records`,
  },
  {
    name: 'check_domain',
    description: 'Check whether a connected domain’s DNS records are in place yet, and switch it on when they are. Without domainId: list the seller’s domains and their status.',
    schema: S({ domainId: str('From connect_domain or the list') }),
    run: async (ctx, a) => {
      if (!a.domainId) return (await ctx.call('GET', '/domains')).domains.map((d) => ({ domainId: d.id, domain: d.domain, status: d.status, error: d.error || null }));
      const d = await ctx.call('POST', `/domains/${a.domainId}/verify`);
      return { domain: d.domain, status: d.status, error: d.error || null, live: d.status === 'active' ? `https://${d.domain}` : null };
    },
    summary: (r) => (Array.isArray(r) ? `Looked at your ${r.length} domain${r.length === 1 ? '' : 's'}` : r.status === 'active' ? `${r.domain} is live` : `${r.domain}: ${r.error || 'not ready yet'}`),
  },
  {
    name: 'list_team', description: 'The seller’s team: members, their roles and status, and the roles available.', schema: S({}),
    run: async (ctx) => { const d = await ctx.call('GET', '/team/members'); return { members: d.members.map((m) => ({ email: m.email, role: m.role, status: m.status, funnelIds: m.funnelIds || 'all' })), roles: d.roles }; },
    summary: (r) => `Looked at your team (${r.members.length})`,
  },
  {
    name: 'invite_team_member',
    description: 'Invite someone (a VA, designer, salesperson) to work in this account. role: admin (everything except billing), marketer (funnels, AI, automations, broadcasts, contacts, products), sales (contacts, orders, shipping, bookings), viewer (read-only reports). Pick the smallest role that does the job. funnelIds: only when they should work on just some funnels ("access to this project only", e.g. a designer for one funnel) — they then see only those funnels and nothing account-wide (contacts, orders page, automations, settings); leave it out for the whole account.',
    schema: S({ email: str('Their email'), role: str('admin | marketer | sales | viewer'), funnelIds: arr('Optional: the only funnels they may work on (from list_funnels)', { type: 'string' }) }, ['email', 'role']),
    run: async (ctx, a) => { const m = await ctx.call('POST', '/team/invite', { email: a.email, role: a.role, ...(a.funnelIds?.length ? { funnelIds: a.funnelIds } : {}) }); return { ok: true, email: a.email, role: a.role, funnels: m.funnelIds?.length || 'all' }; },
    summary: (r) => `Invited ${r.email} as ${r.role}${r.funnels === 'all' ? '' : ` (${r.funnels} funnel${r.funnels > 1 ? 's' : ''} only)`}`,
  },
  {
    name: 'connect_webhook',
    description: `Send events to another tool (a CRM, Zapier, Pabbly, Make, Google Sheets via a webhook URL): every new lead, order, booking etc. is POSTed there, signed. url = the https address the other tool gives. Pass url "" to disconnect. Events sent: ${EVENTS.join(', ')}.`,
    schema: S({ url: str('https webhook address, or "" to disconnect') }),
    run: async (ctx, a) => { if (a.url == null) throw new Error('Give the webhook address (or "" to disconnect)'); const s = await ctx.call('PUT', '/settings', { webhookUrl: String(a.url).trim() }); return { ok: true, url: s.webhookUrl || '' }; },
    summary: (r) => (r.url ? `New leads, orders and bookings now go to ${new URL(r.url).hostname}` : 'Webhook disconnected'),
  },
  {
    name: 'duplicate_funnel', description: 'Copy one of the seller’s funnels (all pages and settings) as a new draft — e.g. to reuse it for another offer; then edit the copy.',
    schema: S({ funnelId: str('Funnel to copy') }, ['funnelId']), touchesResult: true,
    run: async (ctx, a) => { const f = await ctx.call('POST', `/funnels/${a.funnelId}/duplicate`); return { ok: true, id: f.id, name: f.name }; },
    summary: (r) => `Made a copy: “${r.name}”`,
  },
];
const PENDING_TTL = 24 * 3600000;
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

// Actions that reach customers, take pages live/offline, delete work or change account settings never run on the
// model's word alone in the in-app chat: they wait for the seller to press Confirm (text on a page or in a contact's
// name could otherwise talk the model into them). MCP clients ask their user before every tool call themselves.
const webhookIn = (steps) => /"type":\s*"webhook"/.test(JSON.stringify(steps || []));
const NEEDS_OK = {
  send_broadcast: (a) => (a.at ? `Schedule this broadcast for ${a.at}` : 'Send this broadcast now'),
  publish_funnel: (a) => (a.published === false ? 'Take this funnel offline' : 'Publish this funnel (make it live)'),
  remove_step: () => 'Delete a page from this funnel',
  post_to_community: (a) => `Post in your community${a.pinned ? ' (pinned)' : ''}: “${String(a.title || a.body || '').slice(0, 60)}”`,
  invite_team_member: (a) => `Give ${a.email} ${a.role} access to ${a.funnelIds?.length ? `${a.funnelIds.length} of your funnels only` : 'your account'}`,
  connect_webhook: (a) => (a.url ? `Send every new lead, order and booking (with contact details) to ${String(a.url).slice(0, 80)}` : null),
  set_tracking: (a) => `Install tracking on ${a.funnelId ? 'this funnel' : 'all your funnels'}: ${[a.fbPixel && `Meta Pixel ${a.fbPixel}`, a.ga4 && `GA4 ${a.ga4}`, a.googleAdsId && `Google Ads ${a.googleAdsId}`].filter(Boolean).join(', ') || 'remove ids'}`,
  update_business: (a) => `Change business settings (${Object.keys(a).join(', ') || 'none'})`,
  create_automation: (a) => (webhookIn(a.steps) ? `Create automation “${a.name}” — it sends contact data to a webhook` : a.activate ? `Create automation “${a.name}” and switch it on` : null),
  update_automation: (a) => (webhookIn(a.steps) ? 'Update the automation — it sends contact data to a webhook' : a.active === true ? 'Switch this automation on' : null),
};
export const needsOk = (name, args) => NEEDS_OK[name]?.(args || {}) || null;

// ---------- the in-app agent ----------
const SYSTEM = `You are Hive AI, the builder inside FunnelHive — like Lovable, but for sales funnels. Sellers chat with you and you BUILD: funnels end to end (sales pages, video sales letters with qualifying applications, webinar registration + replay funnels, checkout, upsells, downsells, thank-you pages), page sections, design, coupons, pipelines and automations, using your tools. Act, don't just describe.

How to work:
- New business / new funnel → call create_funnel with a rich brief (what they sell, audience, ₹ price, city, offer). It already builds a complete, quality-checked funnel of the right kind (sales, VSL + application, or webinar). Then apply anything specific the user asked for.
- Editing → get_funnel (ids) → get_page (current props) → update_section / add_section / remove_section / move_section / replace_page. Never invent ids.
- Automations → list_pipelines if you need stage ids, then create_automation with activate=true when the user wants it live. Use WhatsApp templates (not plain text) for automated WhatsApp.
- Several independent changes → make all the tool calls, then reply once.
- Publish only when the user asks to go live. Remove pages or sections only when asked.
- Selling → configure_checkout: price & currency (₹ = Razorpay/UPI; $ € £ etc. = Stripe for buyers abroad), memberships (billing monthly/yearly), EMI-style payment plans (installments), order bump, shipping + Cash on Delivery for physical products, and the product delivered after payment (create_product / list_products first).
- Calls → configure_calendar (hours, duration, time zone, meeting link, price and currency for paid calls, refund window); list_bookings. Webinars → configure_webinar (schedule, time zone, joining link, replay, reminders).
- Numbers → get_sales (revenue, refunds, ROAS by campaign, COD to collect, orders to ship, failing payment plans) or get_analytics (traffic and conversion).
- Custom work for one client (consulting, coaching packages, agency retainers) → create_quote: a proposal with line items, an optional deposit and a private pay link; send it only when asked. list_quotes shows who has paid.
- Contacts → find_contacts / tag_contacts. Broadcasts → draft_broadcast ALWAYS first and tell the user who it reaches; call send_broadcast only when the user explicitly says to send or schedule that draft.
- Agencies → list_clients, copy_funnel_to_client. Account → update_business (time zone, WhatsApp, consent banner / tick box).
- Website (home / about / services / contact for a business, not a sales funnel) → create_website with copy you write; then edit pages like any funnel. A funnel’s buttons and menu can open another page with buttonAction / ctaAction "page" and the page name in the link field.
- Courses & community (the school / members area) → create_course writes a full course with quizzes (5 credits; say so), add_quiz, get_course; create_space and post_to_community for the community; school_overview for the link to share. Attach a course to a checkout with configure_checkout productId.
- Images → generate_image (hero photos, section images, ad creatives in 1:1 / 4:5 / 9:16) — tell the user it uses 10 AI credits; ad copy and hooks → write_marketing_copy.
- Testing → split_test (start with the changes for B, results once it has traffic, pick the winner). Tracking → set_tracking (pixel / GA4 / Google Ads ids; never ask for the Conversions API token in chat — that goes in Settings). Own domain → connect_domain, show the DNS records as a table, then check_domain. Team → list_team / invite_team_member with the smallest role that fits. Other tools / CRM → connect_webhook. Reuse a funnel → duplicate_funnel.
- Payment gateway keys, passwords and tokens are never typed into chat: send the seller to Settings → Payments (or the screen named) for those.
- Sellers can be anywhere: use the user's currency and time zone when they mention them (e.g. a US coach → $ and America/New_York); default to India (₹, IST) otherwise.
- Never invent prices, dates or links the user didn't give — ask in one short question if something essential is missing.
- Copy: specific, persuasive and local to the seller's market (Indian context — ₹, UPI, Indian names and cities — unless the business is elsewhere), no placeholders.

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
      const ask = ctx.pending && needsOk(c.name, args);
      if (ask) {
        const p = { id: uid(), name: c.name, args, label: ask, at: Date.now() };
        ctx.pending.push(p);
        out = { waitingForUser: true, note: 'NOT done yet: the seller must press Confirm under your reply. Tell them in one line what will happen and ask them to confirm. Do not call this tool again for it.' };
        summary = `Needs your OK: ${ask}`;
        done.push({ name: c.name, ok, summary, pending: p.id });
        emit({ type: 'tool', status: 'confirm', id: c.call_id, name: c.name, summary, pending: p.id });
        input.push({ type: 'function_call_output', call_id: c.call_id, output: clip(out) });
        continue;
      }
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
  // a team member's Hive acts with their own role in the workspace (never with the owner's full rights)
  const ctxFor = (user, origin, actor = null) => ({
    origin,
    call: async (method, path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { Authorization: `Bearer ${actor ? sign(actor, user.id) : sign(user)}`, 'Content-Type': 'application/json', 'X-Hive': '1' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(300000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || `HTTP ${r.status}`); e.status = r.status; throw e; }
      return data;
    },
  });
  const threadView = ({ userId, ...t }) => t;

  app.get('/api/hive/status', auth, (req, res) => res.json({ ready: hiveReady(), ...(!req.actor && isAdmin(req.user) ? { provider: aiProvider() } : {}) })); // the AI vendor: the platform owner only
  const ownThread = (req, id) => { const t = id && T.hive.get(id); return t && t.userId === req.user.id ? t : null; };
  app.get('/api/hive/threads', auth, (req, res) => res.json(T.hive.all({ userId: req.user.id }, { order: 'updatedAt', desc: true, limit: 100 }).map((t) => ({ id: t.id, title: t.title, funnelId: t.funnelId, updatedAt: t.updatedAt }))));
  app.get('/api/hive/threads/:tid', auth, (req, res) => { const t = ownThread(req, req.params.tid); t ? res.json(threadView(t)) : res.status(404).json({ error: 'Chat not found' }); });
  app.delete('/api/hive/threads/:tid', auth, (req, res) => { T.hive.delWhere({ id: req.params.tid, userId: req.user.id }); res.json({ ok: true }); });

  // Streams progress as Server-Sent Events: thinking / tool (running|done|error) / reply / error
  app.post('/api/hive/chat', auth, limiter, credits, async (req, res) => {
    const message = String(req.body.message || '').trim().slice(0, 6000);
    if (!message) return res.status(400).json({ error: 'Type a message' });
    if (!hiveReady()) { console.error('Hive AI is off: KIE_API_KEY with a tool-capable KIE_MODEL (deepseek / gpt / kimi) is needed'); return res.status(503).json({ error: 'Hive AI isn’t switched on yet — please try again later' }); }
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
      const ctx = { ...ctxFor(req.user, appUrl(req), req.actor), pending: [] };
      const out = await hiveTurn({ ctx, history, message, focusFunnelId: req.body.funnelId || t.funnelId, emit, signal: ac.signal });
      t.messages.push({ role: 'assistant', text: out.text, tools: out.tools, at: Date.now() });
      if (out.funnelId) t.funnelId = out.funnelId;
      if (ctx.pending.length) t.pending = [...(t.pending || []).filter((p) => Date.now() - p.at < PENDING_TTL), ...ctx.pending].slice(-20);
      emit({ type: 'reply', text: out.text, tools: out.tools, funnelId: t.funnelId });
    } catch (e) {
      const msg = ac.signal.aborted ? 'Stopped.' : `Something went wrong: ${e.message}`;
      if (!ac.signal.aborted) res.locals.aiFailed = true; // the AI call failed: no credits taken
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

  // the seller pressed Confirm (or Cancel) on an action Hive proposed
  app.post('/api/hive/threads/:tid/confirm', auth, limiter, async (req, res) => {
    const t0 = ownThread(req, req.params.tid);
    if (!t0) return res.status(404).json({ error: 'Chat not found' });
    const pid = String(req.body.pendingId || ''), cancel = req.body.ok === false;
    let p = null;
    T.hive.update(t0.id, (t) => { const i = (t.pending || []).findIndex((x) => x.id === pid); if (i >= 0) [p] = t.pending.splice(i, 1); }); // claimed once, even on a double click
    if (!p || Date.now() - p.at > PENDING_TTL) return res.status(404).json({ error: 'This action was already handled or has expired — ask Hive again' });
    let ok = true, summary, funnelId = null;
    if (cancel) summary = `Cancelled: ${p.label}`;
    else {
      const tool = byName[p.name];
      try {
        const out = await runTool(ctxFor(req.user, appUrl(req), req.actor), p.name, p.args);
        summary = tool.summary ? tool.summary(out, p.args) : `Done: ${p.label}`;
        funnelId = tool.touchesResult ? out?.id : tool.touches ? p.args[tool.touches] : null;
      } catch (e) { ok = false; summary = `${p.label} failed: ${e.message}`; }
    }
    T.hive.update(t0.id, (t) => {
      for (const m of t.messages) for (const x of m.tools || []) if (x.pending === pid) { x.resolved = cancel ? 'cancelled' : ok ? 'done' : 'error'; x.summary = summary; x.ok = ok; }
      t.messages.push({ role: 'assistant', text: summary, ...(ok ? {} : { error: true }), at: Date.now() }); // so Hive knows in the next turn
      t.updatedAt = Date.now();
    });
    res.json({ ok, cancelled: cancel, summary, funnelId });
  });

  // ---- personal access tokens for MCP clients ----
  const tokenView = ({ hash, userId, ...t }) => t;
  app.get('/api/hive/tokens', auth, (req, res) => res.json(T.mcptokens.all({ userId: req.user.id }).sort((a, b) => a.at - b.at).map(tokenView)));
  app.post('/api/hive/tokens', auth, (req, res) => {
    if (T.mcptokens.count({ userId: req.user.id }) >= 10) return res.status(400).json({ error: 'You can have up to 10 tokens — revoke one first' });
    const token = `ffmcp_${crypto.randomBytes(24).toString('hex')}`;
    const t = T.mcptokens.insert({ id: uid(), userId: req.user.id, ...(req.actor ? { by: req.actor.id } : {}), name: String(req.body.name || 'MCP client').slice(0, 60), hash: hashToken(token), prefix: token.slice(0, 12), at: Date.now(), lastUsedAt: null });
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
