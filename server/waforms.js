// WhatsApp forms (Meta WhatsApp Flows) for the chatbot's "form" node: the seller builds a short form in the node;
// it is turned into Flow JSON and published on the seller's WhatsApp Business account through Meta's Graph API
// (the Meta details saved in Settings → Channels); the chatbot sends it as an in-chat form, and the answers come
// back as an interactive nfm_reply. Navigate-only flows: one screen, no data endpoint.
// Without a published form (no Meta details, not published yet, or the send fails) the same node asks the
// questions one by one in the chat, so the chatbot always works.
import crypto from 'node:crypto';
import { decrypt } from './messaging.js';

export const FLOW_JSON_VERSION = '7.3';
const GRAPH = () => String(process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0').replace(/\/+$/, '');
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const arr = (v) => (Array.isArray(v) ? v : []);

// ---------- the node's data ----------
export const FIELD_TYPES = ['text', 'long', 'email', 'phone', 'number', 'date', 'dropdown', 'radio', 'checkbox'];
export const CHOICE = ['dropdown', 'radio', 'checkbox'];
export const MAX_FIELDS = 8, MAX_OPTIONS = 10;
const SAVE = /^(name|email|phone|custom:[\w-]{1,40})$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;
const VAR = /^[a-z][a-z0-9_]{0,30}$/;
const OPT = /^[\w-]{1,30}$/;
// Meta's label limits: 30 characters for radio buttons and checkboxes, 20 for the rest
export const LABEL = (type) => (type === 'radio' || type === 'checkbox' ? 30 : 20);
function unique(list, ok, prefix) {
  const seen = new Set();
  return list.map((x, i) => { let id = ok.test(x?.id || '') && !seen.has(x.id) ? x.id : `${prefix}${i + 1}`; while (seen.has(id)) id += 'x'; seen.add(id); return id; });
}
export function cleanForm(d = {}) {
  const fields = arr(d.fields).slice(0, MAX_FIELDS);
  const ids = unique(fields, NAME, 'f');
  const out = {
    text: clip(d.text, 1024), cta: clip(d.cta, 20) || 'Fill the form', title: clip(d.title, 30) || 'Your details', submit: clip(d.submit, 30) || 'Submit',
    fields: fields.map((x, i) => {
      const type = FIELD_TYPES.includes(x?.type) ? x.type : 'text';
      const f = { id: ids[i], type, label: clip(x?.label, LABEL(type)), required: !!x?.required, var: VAR.test(x?.var || '') ? x.var : ids[i].toLowerCase(), save: SAVE.test(x?.save || '') ? x.save : '' };
      if (CHOICE.includes(type)) { const opts = arr(x?.options).slice(0, MAX_OPTIONS); const oids = unique(opts, OPT, 'o'); f.options = opts.map((o, j) => ({ id: oids[j], title: clip(o?.title, 30) })); }
      return f;
    }),
  };
  // the published copy on Meta (kept while the form is unchanged)
  if (/^\d{1,30}$/.test(d.flowId || '')) Object.assign(out, { flowId: d.flowId, flowHash: /^[a-f0-9]{8,64}$/.test(d.flowHash || '') ? d.flowHash : '', flowAt: Number(d.flowAt) || 0 });
  return out;
}
export function formProblems(d) {
  if (!d.fields.length) return 'Add at least one question to the form';
  if (d.fields.some((f) => !f.label)) return 'Give every form question a label';
  if (d.fields.some((f) => CHOICE.includes(f.type) && (!f.options.length || f.options.some((o) => !o.title)))) return 'Give every choice question its options';
  return '';
}
// what Meta holds: a changed form needs publishing again
export const formHash = (d) => crypto.createHash('sha256').update(JSON.stringify({ t: d.title, s: d.submit, f: d.fields.map(({ id, type, label, required, options }) => ({ id, type, label, required, options })) })).digest('hex').slice(0, 16);
export const formLive = (d) => !!(d.flowId && d.flowHash === formHash(d));

// ---------- Flow JSON ----------
const INPUT = { text: 'text', email: 'email', phone: 'phone', number: 'number' };
export function flowJson(d) {
  const children = d.fields.map((f) => {
    const base = { name: f.id, label: f.label, required: f.required };
    if (INPUT[f.type]) return { type: 'TextInput', ...base, 'input-type': INPUT[f.type] };
    if (f.type === 'long') return { type: 'TextArea', ...base };
    if (f.type === 'date') return { type: 'DatePicker', ...base };
    const src = f.options.map((o) => ({ id: o.id, title: o.title }));
    return { type: { dropdown: 'Dropdown', radio: 'RadioButtonsGroup', checkbox: 'CheckboxGroup' }[f.type], ...base, 'data-source': src };
  });
  children.push({ type: 'Footer', label: d.submit, 'on-click-action': { name: 'complete', payload: Object.fromEntries(d.fields.map((f) => [f.id, `\${form.${f.id}}`])) } });
  return { version: FLOW_JSON_VERSION, screens: [{ id: 'FORM', title: d.title, terminal: true, success: true, layout: { type: 'SingleColumnLayout', children } }] };
}

// ---------- publishing on Meta ----------
// the seller's direct Meta connection: the WhatsApp Business account id and a permanent token
export const metaOf = (u) => { const w = u?.channels?.whatsapp; return w?.businessId && w?.tokenEnc ? { waba: w.businessId, token: decrypt(w.tokenEnc) } : null; };
export const NEED_META = 'WhatsApp forms need a direct Meta connection — add your WhatsApp Business account ID and token in Settings → Channels. Until then the chatbot asks these questions one by one.';
async function graph(token, method, path, body) {
  let r;
  try { r = await fetch(`${GRAPH()}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); } catch { throw new Error('Couldn’t reach Meta — please try again in a minute'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta: ${clip(data?.error?.error_user_msg || data?.error?.message || `HTTP ${r.status}`, 200)}`);
  return data;
}
const problemsOf = (data) => arr(data?.validation_errors).map((e) => clip(e.message || e.error, 160)).filter(Boolean);
// creates the flow on Meta (a published one can't change: an edited form becomes a new flow), uploads its JSON
// and publishes it → { flowId, flowHash, flowAt }
export async function publishForm(u, d, name) {
  const m = metaOf(u);
  if (!m) throw new Error(NEED_META);
  const p = formProblems(d);
  if (p) throw new Error(p);
  const hash = formHash(d);
  const created = await graph(m.token, 'POST', `/${encodeURIComponent(m.waba)}/flows`, { name: clip(`${name} · ${d.title} · ${hash.slice(0, 6)}`, 120), categories: ['LEAD_GENERATION'] });
  if (!created.id) throw new Error('Meta didn’t create the form — please try again');
  const form = new FormData();
  form.append('file', new Blob([JSON.stringify(flowJson(d))], { type: 'application/json' }), 'flow.json');
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  const up = await graph(m.token, 'POST', `/${encodeURIComponent(created.id)}/assets`, form);
  const bad = problemsOf(up);
  if (bad.length) throw new Error(`Meta found a problem in the form: ${bad[0]}`);
  await graph(m.token, 'POST', `/${encodeURIComponent(created.id)}/publish`);
  return { flowId: String(created.id), flowHash: hash, flowAt: Date.now() };
}

// ---------- sending ----------
// flow_token: which conversation, chatbot and node the answers belong to, signed with the seller's own key
const sig = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url').slice(0, 22);
export const formToken = (key, convId, flowId, nodeId) => `fh1.${convId}.${flowId}.${nodeId}.${sig(key, `${convId}.${flowId}.${nodeId}`)}`;
export function readToken(key, token) {
  const [v, convId, flowId, nodeId, s] = String(token || '').split('.');
  if (v !== 'fh1' || !convId || !flowId || !nodeId || !key) return null;
  const want = sig(key, `${convId}.${flowId}.${nodeId}`);
  return s && s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)) ? { convId, flowId, nodeId } : null;
}
// Meta Cloud API JSON for the interactive flow message
export const flowPayload = (o) => ({
  type: 'interactive',
  interactive: { type: 'flow', body: { text: clip(o.text, 1024) || 'Please fill in this short form 👇' }, action: { name: 'flow', parameters: { flow_message_version: '3', flow_token: o.flow.token, flow_id: o.flow.id, flow_cta: clip(o.flow.cta, 20) || 'Fill the form', flow_action: 'navigate', flow_action_payload: { screen: 'FORM' } } } },
});

// ---------- receiving ----------
// the answers in an inbound message (Meta's interactive.nfm_reply, or the same passed through flat) → { token, values } | null
export function formReplyOf(d = {}) {
  const n = d.interactive?.nfm_reply || d.nfm_reply || (d.interactive?.type === 'nfm_reply' ? d.interactive : null) || (d.response_json ? d : null);
  if (!n) return null;
  let j = n.response_json;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return null; } }
  if (!j || typeof j !== 'object') return null;
  const { flow_token: token, ...values } = j;
  return { token: clip(token, 300), values };
}
const pretty = (f, v) => {
  if (Array.isArray(v)) return v.map((x) => pretty(f, x)).filter(Boolean).join(', ');
  const s = clip(v, 500);
  return f && CHOICE.includes(f.type) ? f.options.find((o) => o.id === s)?.title || s : s;
};
// the node's fields with what was answered → { answers: [{ label, value }], vars, saves: [{ field, value }] }
export function formResult(d, values = {}) {
  const answers = [], vars = {}, saves = [];
  for (const f of d.fields) {
    const v = pretty(f, values[f.id]);
    if (!v) continue;
    answers.push({ label: f.label, value: v });
    vars[f.var] = v;
    if (f.save) saves.push({ field: f.save, value: v });
  }
  return { answers, vars, saves };
}
// answers from a form we can't match to a node (an old or unknown token): shown as they came
export const rawAnswers = (values = {}) => Object.entries(values).slice(0, 20).map(([k, v]) => ({ label: clip(k, 40), value: pretty(null, v) })).filter((a) => a.value);
export const formText = (title, answers) => [`📋 ${title || 'Form'}`, ...answers.map((a) => `${a.label}: ${a.value}`)].join('\n');

// ---------- asking in the chat instead (no published form) ----------
// one question as a chatbot message: up to 3 choices as buttons, up to 10 as a list
export function askField(f, i, total) {
  const head = `${total > 1 ? `(${i + 1}/${total}) ` : ''}${f.label}${f.required ? '' : ' — or reply *skip*'}`;
  if ((f.type === 'radio' || f.type === 'dropdown') && f.options.length <= 3) return { kind: 'buttons', text: head, buttons: f.options.map((o) => ({ id: o.id, title: clip(o.title, 20) })) };
  if (f.type === 'radio' || f.type === 'dropdown') return { kind: 'list', text: head, button: 'Choose', rows: f.options.map((o) => ({ id: o.id, title: clip(o.title, 24) })) };
  if (f.type === 'checkbox') return { kind: 'text', text: `${head}\n${f.options.map((o, j) => `${j + 1}. ${o.title}`).join('\n')}\nReply with the numbers, e.g. 1, 3` };
  return { kind: 'text', text: head + (f.type === 'date' ? ' (e.g. 12 March)' : '') };
}
export const CHECK = { text: 'text', long: 'text', email: 'email', phone: 'phone', number: 'number', date: 'date' };
// a typed answer to a choice question → option id(s), or null
export function choiceOf(f, input) {
  const t = String(input.text || '').trim().toLowerCase();
  if (f.type !== 'checkbox') return (f.options.find((o) => o.id === input.id) || f.options.find((o) => o.title.toLowerCase() === t) || (/^\d{1,2}$/.test(t) ? f.options[Number(t) - 1] : null))?.id || null;
  const ids = t.split(/[\s,;/&]+|\band\b/).map((x) => x.trim()).filter(Boolean).map((x) => (/^\d{1,2}$/.test(x) ? f.options[Number(x) - 1] : f.options.find((o) => o.title.toLowerCase() === x))?.id).filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}
