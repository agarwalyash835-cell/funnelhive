// AI voice calling campaigns, on each seller's own Sarvam AI account (Voice Agents): the seller builds the agent and
// connects their numbers in Sarvam, then FunnelHive picks who to call from the CRM, launches the campaign through
// their API key, and writes every call back to the contact — outcome, duration, transcript, the answers the agent
// collected (as tags) — and tells the seller about interested leads.
//
// India: automated calls are A2P calls under TRAI's rules — the seller's numbers must be registered for it (140 /
// 1600 series via their telephony provider and DLT). We only call contacts who agreed to marketing, never
// unsubscribed or "DND"-tagged ones, and only between 9 am and 9 pm IST.
import crypto from 'node:crypto';
import { T, uid } from './db.js';
import { logActivity, metaFor } from './crm.js';
import { audience, cleanSegment } from './broadcasts.js';
import { notify } from './notify.js';
import { encrypt, decrypt } from './messaging.js';
import { accessFor } from './billing.js';

const BASE = () => (process.env.SARVAM_API_BASE || 'https://apps.sarvam.ai/api').replace(/\/$/, '');
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// contact fields an agent variable can be filled from
export const FIELDS = { name: 'Full name', first_name: 'First name', email: 'Email', phone: 'Phone', city: 'City', business: 'Your business name' };
const e164 = (p) => { const d = String(p || '').replace(/\D/g, ''); if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`; if (d.length === 11 && d.startsWith('0')) return `+91${d.slice(1)}`; if (d.length === 12 && d.startsWith('91')) return `+${d}`; return d.length >= 10 && d.length <= 15 ? `+${d}` : ''; };

// ---------- Sarvam ----------
async function sv(cfg, method, path, body) {
  const r = await fetch(`${BASE()}${path}`, { method, headers: { 'X-API-Key': decrypt(cfg.apiKey) || cfg.rawKey, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || (Array.isArray(d?.detail) ? d.detail.map((x) => `${(x.loc || []).slice(1).join('.')} ${x.msg}`).join('; ') : d?.detail) || d?.message || `HTTP ${r.status}`;
    throw Object.assign(new Error(`Sarvam: ${msg}`), { status: r.status });
  }
  return d;
}
const ws = (c) => `/v1/orgs/${encodeURIComponent(c.orgId)}/workspaces/${encodeURIComponent(c.workspaceId)}`;
async function agentsOf(cfg) {
  const d = await sv(cfg, 'GET', `/app-authoring${ws(cfg)}/deployments?limit=100`);
  return (d.items || []).filter((x) => x.channel_direction !== 'inbound').map((x) => ({ id: x.deployment_id, appId: x.app_id, appVersion: x.app_version, name: x.name || x.app_id, status: x.status, numbers: x.phone_numbers || [] }));
}

// ---------- launching ----------
const varsFor = (c, vars, u) => Object.fromEntries((vars || []).map((v) => {
  const f = v.field;
  const val = f === 'first_name' ? String(c.name || '').split(/\s+/)[0] : f === 'business' ? u.settings?.businessName : f === 'city' ? c.custom?.city || c.city : c[f];
  return [v.agent, str(val, 200)];
}).filter(([, val]) => val !== ''));
export function callAudience(userId, segment) {
  const a = audience(userId, segment, 'whatsapp'); // agreed to marketing, has a phone, not unsubscribed
  const dnd = (c) => (c.tags || []).some((t) => /^(dnd|do not call|don't call)$/i.test(String(t).trim()));
  const reach = a.reach.filter((c) => !dnd(c) && e164(c.phone));
  return { matched: a.matched, reach, left: { ...a.left, dnd: a.reach.length - reach.length } };
}
async function launch(u, c) {
  const cfg = u.voice;
  const { reach } = callAudience(u.id, c.segment);
  if (!reach.length) throw new Error('Nobody in this audience can be called — they need a phone number and to have agreed to marketing');
  const s = c.schedule, start = Math.max(s.startAt || Date.now(), Date.now() + 60000);
  const body = {
    name: str(c.name, 80), description: 'From FunnelHive',
    app_config: {
      app_id: c.appId, app_version: c.appVersion, app_type: 'agent', attempts_per_second: c.cps,
      connection_configs: [{ connection_id: cfg.connectionId, agent_phone_number: cfg.agentNumber, phone_numbers: [cfg.agentNumber], weight: 1 }],
      retry_config: { max_retries: c.retries.max, retry_interval_minutes: c.retries.interval, retry_on: { busy: { enabled: true }, no_answer: { enabled: true }, failed: { enabled: true } } },
    },
    start_timestamp: new Date(start).toISOString(), end_timestamp: new Date(Math.max(s.endAt || 0, start + 3600000)).toISOString(),
    allowed_schedule: { allowed_start_time: s.from, allowed_end_time: s.to, allowed_days: s.days, timezone: 'Asia/Kolkata' },
    webhook_config: { url: `${process.env.APP_URL || 'http://localhost:4000'}/api/voice/hook/${cfg.hookToken}`, metadata: { campaign: c.id } },
  };
  const made = await sv(cfg, 'POST', `/scheduling${ws(cfg)}/campaigns`, body);
  const sid = made.campaign_id;
  try {
    let uploaded = 0, rejected = 0;
    for (let i = 0; i < reach.length; i += 1000) {
      const users = reach.slice(i, i + 1000).map((x) => ({ user_phone_number: e164(x.phone), user_identifier: x.key, app_variables: varsFor(x, c.vars, u) }));
      const r = await sv(cfg, 'POST', `/scheduling${ws(cfg)}/campaigns/${encodeURIComponent(sid)}/cohorts/stream`, { name: `fh-${c.id.slice(0, 8)}-${i / 1000 + 1}`, users });
      uploaded += r.result?.valid_records ?? users.length; rejected += r.result?.rejected_records || 0;
    }
    return { sid, total: reach.length, uploaded, rejected, startAt: start };
  } catch (e) {
    await sv(cfg, 'PUT', `/scheduling${ws(cfg)}/campaigns/${encodeURIComponent(sid)}/status`, { action: 'cancel' }).catch(() => {}); // nothing half-launched keeps dialling
    throw e;
  }
}

// ---------- one call's result (Sarvam's webhook, after every attempt) ----------
const OUTCOME_KEYS = ['outcome', 'disposition', 'interest', 'interested', 'call_outcome', 'lead_status', 'status', 'result'];
const HOT = /^(interested|yes|hot|callback|call ?back|book(ed)?|appointment|visit|demo|warm)$/i;
export function recordCall(userId, c, p) {
  const id = str(p.attempt_id, 120) || uid();
  if (T.vcalls.get(id)) return { duplicate: true };
  const key = str(p.user_identifier, 300), outputs = p.output_agent_variables && typeof p.output_agent_variables === 'object' ? p.output_agent_variables : {};
  const connected = p.connectivity_status === 'connected';
  const transcript = (Array.isArray(p.interaction_transcript) ? p.interaction_transcript : []).map((t) => `${t.role === 'agent' ? 'Agent' : 'Customer'}: ${t.en_text || t.text || ''}`).join('\n').slice(0, 8000);
  T.vcalls.insert({ id, userId, campaignId: c.id, key, phone: str(p.user_phone_number, 20), at: Date.now(), connectivity: p.connectivity_status || null, completion: p.completion_status || null, next: p.next_action_status || null, duration: Number(p.duration) || 0, interactionId: p.interaction_id || null, outputs, transcript, retry: Number(p.retry_attempt) || 0 });
  const k = connected ? 'connected' : p.connectivity_status === 'busy' ? 'busy' : p.connectivity_status === 'no_answer' ? 'noAnswer' : 'failed';
  T.vcampaigns.update(c.id, (x) => { x.stats = { ...x.stats, attempts: (x.stats?.attempts || 0) + 1, [k]: (x.stats?.[k] || 0) + 1 }; });
  if (!key || !metaFor(userId, key) && !T.leads.exists({ userId, ckey: key }) && !T.orders.exists({ userId, ckey: key })) return { ok: true };
  const outcome = OUTCOME_KEYS.map((x) => outputs[x]).find((v) => v != null && v !== '');
  const answers = Object.entries(outputs).filter(([, v]) => v != null && v !== '').map(([a, v]) => `${a.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  logActivity(userId, key, { type: 'call', title: connected ? `AI call — talked ${Math.round(p.duration || 0)}s${outcome ? ` · ${outcome}` : ''}` : `AI call — ${String(p.connectivity_status || 'not connected').replace(/_/g, ' ')}${p.next_action_status ? ' (will retry)' : ''}`, text: [answers.join('\n'), transcript].filter(Boolean).join('\n\n').slice(0, 6000), by: 'voice', campaign: c.name, status: k });
  if (connected && outcome) {
    const tag = `AI call: ${str(outcome, 30)}`;
    T.crm.update(metaFor(userId, key).id, (m) => { m.tags = [...new Set([...(m.tags || []), tag])].slice(0, 30); });
    if (HOT.test(String(outcome).trim())) notify(userId, { kind: 'lead', title: `Interested on an AI call · ${metaFor(userId, key)?.name || p.user_phone_number}`, body: `${c.name}: ${outcome}`, link: `/contacts/${encodeURIComponent(key)}`, ckey: key });
  }
  return { ok: true };
}

// ---------- routes ----------
const VIEW = ({ userId, ...c }) => c;
export function registerVoice(app, { auth, wrap, rateLimit, isTest }) {
  const cfgOf = (u) => (u.voice?.apiKey ? u.voice : null);
  const ownerOnly = (req, res) => { if (req.actor && !['admin', 'agency'].includes(req.role)) { res.status(403).json({ error: 'Only the account owner or an admin can connect Sarvam' }); return false; } return true; };
  const own = (req, res) => { const c = T.vcampaigns.get(req.params.cid); if (!c || c.userId !== req.user.id) { res.status(404).json({ error: 'Campaign not found' }); return null; } return c; };

  app.get('/api/voice', auth, wrap(async (req, res) => {
    const cfg = cfgOf(req.user);
    let agents = [], agentsError = null;
    if (cfg) { try { agents = await agentsOf(cfg); } catch (e) { agentsError = e.message; } }
    res.json({
      connected: !!cfg, keyHint: cfg?.keyHint || null, orgId: cfg?.orgId || '', workspaceId: cfg?.workspaceId || '', connectionId: cfg?.connectionId || '', agentNumber: cfg?.agentNumber || '',
      agents, agentsError, fields: FIELDS, days: DAYS,
      campaigns: T.vcampaigns.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 200 }).map(VIEW),
    });
  }));
  // connect: checked by listing the account's agents first; the key is stored encrypted and never shown again
  app.put('/api/voice/connect', auth, wrap(async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const b = req.body || {}, cur = req.user.voice || {};
    const next = { orgId: str(b.orgId, 120), workspaceId: str(b.workspaceId, 120), connectionId: str(b.connectionId, 120), agentNumber: e164(b.agentNumber) };
    if (!next.orgId || !next.workspaceId) return res.status(400).json({ error: 'Add your Sarvam org ID and workspace ID (from your Sarvam dashboard URL, or Settings)' });
    if (!next.connectionId || !next.agentNumber) return res.status(400).json({ error: 'Add the telephony connection ID and the number calls go out from (Sarvam → Deploy → Telephony)' });
    const key = str(b.apiKey, 300);
    if (!key && !cur.apiKey) return res.status(400).json({ error: 'Paste your Sarvam API key' });
    let agents;
    try { agents = await agentsOf({ ...next, apiKey: key ? '' : cur.apiKey, rawKey: key }); } catch (e) { return res.status(400).json({ error: e.status === 401 || e.status === 403 ? 'Sarvam didn’t accept that API key' : e.message }); }
    T.users.update(req.user.id, (x) => { x.voice = { ...next, provider: 'sarvam', apiKey: key ? encrypt(key) : cur.apiKey, keyHint: key ? `…${key.slice(-4)}` : cur.keyHint, hookToken: cur.hookToken || crypto.randomBytes(18).toString('hex'), at: Date.now() }; });
    T.leadTokens.put({ id: `voice-${T.users.get(req.user.id).voice.hookToken}`, userId: req.user.id, kind: 'voice' });
    res.json({ ok: true, agents });
  }));
  app.delete('/api/voice/connect', auth, (req, res) => {
    if (!ownerOnly(req, res)) return;
    const t = req.user.voice?.hookToken;
    T.users.update(req.user.id, (x) => { delete x.voice; });
    if (t) T.leadTokens.del(`voice-${t}`);
    res.json({ ok: true });
  });

  // ---------- campaigns ----------
  const clean = (b = {}, cur = {}, userId) => {
    const s = b.schedule ?? cur.schedule ?? {};
    const vars = (Array.isArray(b.vars ?? cur.vars) ? (b.vars ?? cur.vars) : []).map((v) => ({ agent: str(v.agent, 60).replace(/[^\w]/g, ''), field: FIELDS[v.field] ? v.field : 'name' })).filter((v) => v.agent).slice(0, 20);
    return {
      name: str(b.name ?? cur.name, 80) || 'AI calling campaign',
      deploymentId: str(b.deploymentId ?? cur.deploymentId, 120), appId: str(b.appId ?? cur.appId, 120), appVersion: Number(b.appVersion ?? cur.appVersion) || null, agentName: str(b.agentName ?? cur.agentName, 120),
      segment: cleanSegment(b.segment ?? cur.segment, userId), vars,
      schedule: { startAt: Number(s.startAt) || null, endAt: Number(s.endAt) || null, from: HHMM.test(s.from) ? s.from : '10:00', to: HHMM.test(s.to) ? s.to : '19:00', days: (Array.isArray(s.days) ? s.days : DAYS.slice(0, 6)).filter((d) => DAYS.includes(d)) },
      retries: { max: Math.min(5, Math.max(0, Math.round(Number((b.retries ?? cur.retries)?.max ?? 2)))), interval: Math.min(1440, Math.max(5, Math.round(Number((b.retries ?? cur.retries)?.interval ?? 60)))) },
      cps: Math.min(5, Math.max(0.1, Number(b.cps ?? cur.cps ?? 1))),
      consent: !!(b.consent ?? cur.consent),
    };
  };
  const problems = (c) => {
    if (!c.appId || !c.appVersion) return 'Pick the Sarvam agent that makes the calls';
    // TRAI: commercial calls only between 9 am and 9 pm
    if (c.schedule.from < '09:00' || c.schedule.to > '21:00' || c.schedule.from >= c.schedule.to) return 'Calls can only go out between 9:00 am and 9:00 pm — pick hours inside that';
    if (!c.schedule.days.length) return 'Pick at least one day to call on';
    if (!c.consent) return 'Confirm these contacts agreed to be called and your numbers are registered for automated calls';
    return null;
  };
  app.post('/api/voice/campaigns', auth, (req, res) => {
    if (T.vcampaigns.count({ userId: req.user.id }) >= 300) return res.status(400).json({ error: 'You have 300 calling campaigns — delete old ones first' });
    res.json(VIEW(T.vcampaigns.insert({ id: uid(), userId: req.user.id, ...clean(req.body, {}, req.user.id), status: 'draft', stats: {}, at: Date.now() })));
  });
  app.get('/api/voice/campaigns/:cid', auth, wrap(async (req, res) => {
    let c = own(req, res); if (!c) return;
    // Sarvam decides when it ends: mirror its status
    const cfg = cfgOf(req.user);
    if (cfg && c.sarvamId && ['scheduled', 'active', 'paused'].includes(c.status)) {
      try { const r = await sv(cfg, 'GET', `/scheduling${ws(cfg)}/campaigns/${encodeURIComponent(c.sarvamId)}`); if (r.status && r.status !== c.status) c = T.vcampaigns.update(c.id, (x) => { x.status = r.status; if (['ended', 'cancelled'].includes(r.status)) x.doneAt = Date.now(); }); } catch { /* shown as it was */ }
    }
    const calls = T.vcalls.all({ campaignId: c.id }, { order: 'at', desc: true, limit: 100 }).map(({ userId, transcript, ...x }) => ({ ...x, name: metaFor(req.user.id, x.key)?.name || '', transcript: transcript?.slice(0, 1500) }));
    const a = c.status === 'draft' ? callAudience(req.user.id, c.segment) : null;
    res.json({ ...VIEW(c), calls, audience: a && { matched: a.matched, reach: a.reach.length, left: a.left } });
  }));
  app.post('/api/voice/audience', auth, (req, res) => {
    const a = callAudience(req.user.id, cleanSegment(req.body?.segment, req.user.id));
    res.json({ matched: a.matched, reach: a.reach.length, left: a.left });
  });
  app.put('/api/voice/campaigns/:cid', auth, (req, res) => {
    const c = own(req, res); if (!c) return;
    if (c.status !== 'draft') return res.status(400).json({ error: 'It has launched — duplicate it to change it' });
    res.json(VIEW(T.vcampaigns.update(c.id, (x) => Object.assign(x, clean(req.body, x, req.user.id)))));
  });
  app.post('/api/voice/campaigns/:cid/duplicate', auth, (req, res) => {
    const c = own(req, res); if (!c) return;
    res.json(VIEW(T.vcampaigns.insert({ id: uid(), userId: req.user.id, ...clean({}, c, req.user.id), name: `${c.name} (copy)`.slice(0, 80), consent: false, status: 'draft', stats: {}, at: Date.now() })));
  });
  app.delete('/api/voice/campaigns/:cid', auth, (req, res) => {
    const c = own(req, res); if (!c) return;
    if (['scheduled', 'active', 'paused'].includes(c.status)) return res.status(400).json({ error: 'Cancel it first' });
    T.vcalls.delWhere({ campaignId: c.id }); T.vcampaigns.del(c.id);
    res.json({ ok: true });
  });
  const launchLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 6, key: (req) => req.user.id });
  app.post('/api/voice/campaigns/:cid/launch', auth, launchLimiter, wrap(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const cfg = cfgOf(req.user);
    if (!cfg) return res.status(400).json({ error: 'Connect your Sarvam account first (AI calls → Connect Sarvam)' });
    if (c.status !== 'draft') return res.status(400).json({ error: 'It has already launched' });
    if (!accessFor(req.user).ok) return res.status(402).json({ error: 'Your subscription is inactive — renew to run campaigns' });
    const p = problems(c); if (p) return res.status(400).json({ error: p });
    // claimed once (a double click can't launch it twice)
    let claimed = false;
    T.vcampaigns.update(c.id, (x) => { if (x.status === 'draft') { x.status = 'launching'; claimed = true; } });
    if (!claimed) return res.status(409).json({ error: 'It’s launching already' });
    try {
      const r = await launch(T.users.get(req.user.id), c);
      res.json(VIEW(T.vcampaigns.update(c.id, (x) => { Object.assign(x, { status: 'scheduled', sarvamId: r.sid, launchedAt: Date.now(), schedule: { ...x.schedule, startAt: r.startAt } }); x.stats = { total: r.total, uploaded: r.uploaded, rejected: r.rejected, attempts: 0 }; delete x.error; })));
    } catch (e) {
      T.vcampaigns.update(c.id, (x) => { x.status = 'draft'; x.error = e.message; });
      res.status(400).json({ error: e.message });
    }
  }));
  app.post('/api/voice/campaigns/:cid/status', auth, wrap(async (req, res) => {
    const c = own(req, res); if (!c) return;
    const action = req.body?.action, cfg = cfgOf(req.user);
    if (!['pause', 'resume', 'cancel'].includes(action)) return res.status(400).json({ error: 'action must be pause, resume or cancel' });
    if (!cfg || !c.sarvamId) return res.status(400).json({ error: 'This campaign isn’t running' });
    try {
      const r = await sv(cfg, 'PUT', `/scheduling${ws(cfg)}/campaigns/${encodeURIComponent(c.sarvamId)}/status`, { action });
      res.json(VIEW(T.vcampaigns.update(c.id, (x) => { x.status = r.status || { pause: 'paused', resume: 'active', cancel: 'cancelled' }[action]; if (action === 'cancel') x.doneAt = Date.now(); })));
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  // a single test call to the seller's own phone, with the agent the campaign uses
  const testLimiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 3, key: (req) => req.user.id, message: 'Too many test calls — wait a minute.' });
  app.post('/api/voice/test-call', auth, testLimiter, wrap(async (req, res) => {
    const cfg = cfgOf(req.user);
    if (!cfg) return res.status(400).json({ error: 'Connect your Sarvam account first' });
    const phone = e164(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter the phone number to call' });
    const appId = str(req.body?.appId, 120), appVersion = Number(req.body?.appVersion);
    if (!appId || !appVersion) return res.status(400).json({ error: 'Pick the agent' });
    try {
      const r = await sv(cfg, 'POST', `/outbounds${ws(cfg)}/outbounds`, { app_config: { app_id: appId, app_version: appVersion, app_type: 'agent', connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.agentNumber }, agent_variables: { name: req.user.name || '', first_name: String(req.user.name || '').split(/\s+/)[0], business: req.user.settings?.businessName || '' } }, user_config: { user_phone_number: phone } });
      res.json({ ok: true, attemptId: r.attempt_id });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));

  // ---------- Sarvam's call results (no login: the token in the address is the key) ----------
  const hookLimiter = rateLimit({ windowMs: 60000, max: isTest ? 10000 : 1200, key: (req) => req.params.token });
  app.post('/api/voice/hook/:token', hookLimiter, (req, res) => {
    const t = T.leadTokens.get(`voice-${String(req.params.token)}`);
    if (!t || t.kind !== 'voice') return res.status(404).json({ error: 'Unknown address' });
    const p = req.body || {};
    const cid = p.metadata?.campaign || p.webhook_metadata?.campaign;
    const c = (cid && T.vcampaigns.get(cid)) || (p.campaign_id && T.vcampaigns.find({ sarvamId: String(p.campaign_id) }));
    if (!c || c.userId !== t.userId) return res.json({ ok: true, ignored: 'unknown campaign' }); // a test dial or another campaign: nothing to record
    res.json(recordCall(t.userId, c, p));
  });
}
