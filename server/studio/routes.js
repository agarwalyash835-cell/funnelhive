// Studio's API. Sellers: make images (optionally from their own product photo) and clips (from an image), see them
// render, redo one with a note, delete. The platform admin: switch Studio on per account (it's off until pricing is
// in place, since every render costs real money), move a tier to another model, and see what each account used.
// Sellers never see vendor or model names: only tiers.
import { T, q } from '../db.js';
import { savePlatform } from '../platform.js';
import { publicUrlFor } from '../storage.js';
import { adminMiddleware, audit } from '../admin-guard.js';
import { studioReady } from './kie.js';
import { enqueue, view, tick, tierOk } from './jobs.js';
import { TIERS, TIER_NAMES, ASPECTS, DEFAULTS, studioModels } from './models.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
export const studioOn = (u) => !!u?.studio?.on;
// a picture the seller already has: only their own uploads (never an arbitrary address — we fetch it to review)
const ownUpload = (userId, url) => {
  const m = /\/uploads\/([\w-]+)\/([\w.-]+\.(png|jpe?g|webp))$/i.exec(String(url || ''));
  if (!m || m[1] !== userId) return false;
  return url === `/uploads/${userId}/${m[2]}` || url === publicUrlFor(`uploads/${userId}/${m[2]}`);
};

export function registerStudio(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 20, key: (req) => req.user.id, message: 'You’re making things quickly — wait a minute and try again.' });
  const gate = (req, res) => {
    if (!studioReady()) { res.status(503).json({ error: 'Studio isn’t switched on for this server yet' }); return false; }
    if (!studioOn(req.user)) { res.status(403).json({ error: 'Studio isn’t switched on for your account yet', code: 'STUDIO_OFF' }); return false; }
    return true;
  };
  const who = (req) => req.actor?.email || null;

  app.get('/api/studio', auth, (req, res) => {
    const rows = T.studio.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 200 });
    res.json({ on: studioOn(req.user) && studioReady(), tiers: TIERS.map((id) => ({ id, name: TIER_NAMES[id] })), aspects: ASPECTS, assets: rows.map(view) });
  });
  // images: 1–4 at a time, from words, optionally keeping the seller's real product (their photo as the reference)
  app.post('/api/studio/images', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const b = req.body || {}, prompt = clip(b.prompt, 1500);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe the image you want' });
    if (b.ref && !ownUpload(req.user.id, b.ref)) return res.status(400).json({ error: 'Pick one of your own photos' });
    const n = Math.min(4, Math.max(1, Math.round(Number(b.count) || 1)));
    const made = Array.from({ length: n }, () => enqueue(req.user.id, { kind: 'image', tier: tierOk(b.tier) ? b.tier : 'standard', prompt, aspect: ASPECTS.includes(b.aspect) ? b.aspect : '1:1', ref: b.ref || null, by: who(req), notifyDone: true }));
    res.status(201).json({ assets: made.map(view) });
  });
  // clips: from one of the seller's Studio images (or own photo) as the first frame, or from words alone
  app.post('/api/studio/clips', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const b = req.body || {}, prompt = clip(b.prompt, 1500);
    if (prompt.length < 3) return res.status(400).json({ error: 'Describe what should happen in the clip' });
    let ref = null, sourceId = null;
    if (b.sourceId) {
      const s = T.studio.get(b.sourceId);
      if (!s || s.userId !== req.user.id || s.kind !== 'image' || !s.url) return res.status(404).json({ error: 'That image isn’t ready' });
      ref = s.url; sourceId = s.id;
    } else if (b.ref) {
      if (!ownUpload(req.user.id, b.ref)) return res.status(400).json({ error: 'Pick one of your own photos' });
      ref = b.ref;
    }
    const seconds = Math.min(15, Math.max(4, Math.round(Number(b.seconds) || 5)));
    const a = enqueue(req.user.id, { kind: 'clip', tier: tierOk(b.tier) ? b.tier : 'standard', prompt, aspect: ASPECTS.includes(b.aspect) ? b.aspect : '9:16', seconds, ref, sourceId, enhance: b.enhance !== false, by: who(req), notifyDone: true });
    res.status(201).json({ asset: view(a) });
  });
  const mine = (req, res) => { const a = T.studio.get(req.params.id); if (!a || a.userId !== req.user.id) { res.status(404).json({ error: 'Not found' }); return null; } return a; };
  app.get('/api/studio/assets/:id', auth, (req, res) => { const a = mine(req, res); if (a) res.json(view(a)); });
  // make it again, with what to change (the note joins the request); a fresh set of attempts
  app.post('/api/studio/assets/:id/redo', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const a = mine(req, res); if (!a) return;
    if (['queued', 'rendering', 'checking'].includes(a.status)) return res.status(409).json({ error: 'It’s still being made' });
    const note = clip(req.body?.note, 300);
    const x = T.studio.update(a.id, (y) => { y.status = 'queued'; y.attempts = 0; y.notes = note ? [note] : []; y.error = ''; delete y.qa; delete y.doneAt; delete y.taskId; if (note) y.prompt = `${y.prompt}\n${note}`.slice(0, 1500); });
    res.json(view(x));
  });
  app.delete('/api/studio/assets/:id', auth, (req, res) => {
    const a = mine(req, res); if (!a) return;
    if (a.status === 'rendering') return res.status(409).json({ error: 'Wait for it to finish, then delete it' });
    T.studio.del(a.id);
    res.json({ ok: true });
  });

  // ---------- the platform admin ----------
  const A = [auth, adminMiddleware];
  app.get('/api/admin/studio', ...A, (req, res) => {
    const usage = q(`SELECT json_extract(data, '$.userId') AS userId, COUNT(*) AS items, SUM(json_extract(data, '$.attempts')) AS renders FROM studio GROUP BY userId ORDER BY renders DESC LIMIT 200`).all()
      .map((r) => { const u = T.users.get(r.userId); return { userId: r.userId, email: u?.email || '(deleted)', on: studioOn(u), items: r.items, renders: r.renders || 0 }; });
    // render seconds by model and resolution: the basis for pricing
    const byModel = {};
    for (const row of q('SELECT data FROM studio').all()) for (const u of JSON.parse(row.data).usage || []) { const k = `${u.model} · ${u.resolution || '-'}`; byModel[k] ||= { renders: 0, seconds: 0 }; byModel[k].renders++; byModel[k].seconds += u.seconds || 0; }
    res.json({ ready: studioReady(), models: studioModels(), defaults: DEFAULTS, usage, byModel });
  });
  // a tier on another model: { models: { image|clip: { quick|standard|cinematic: { model, resolution } }, review: { model } } }
  app.put('/api/admin/studio', ...A, (req, res) => {
    const m = req.body?.models || {}, out = {};
    const okModel = (v) => typeof v === 'string' && /^[\w.\-/]{2,80}$/.test(v);
    for (const kind of ['image', 'clip']) for (const t of TIERS) {
      const v = m[kind]?.[t]; if (!v) continue;
      if (v.model && !okModel(v.model)) return res.status(400).json({ error: `${kind} ${t}: that isn’t a model id` });
      if (v.resolution && !/^(480p|720p|1080p|4k|1K|2K|4K)$/.test(v.resolution)) return res.status(400).json({ error: `${kind} ${t}: pick a resolution like 720p or 2K` });
      out[kind] ||= {}; out[kind][t] = { ...(v.model ? { model: v.model } : {}), ...(v.resolution ? { resolution: v.resolution } : {}) };
    }
    for (const k of ['review', 'upscale']) if (m[k]?.model) { if (!okModel(m[k].model)) return res.status(400).json({ error: `${k}: that isn’t a model id` }); out[k] = { model: m[k].model }; }
    savePlatform((s) => { s.studio = { ...(s.studio || {}), models: out }; });
    audit(req, null, 'studio_models', JSON.stringify(out).slice(0, 300));
    res.json({ models: studioModels() });
  });
  app.put('/api/admin/studio/accounts/:uid', ...A, (req, res) => {
    const u = T.users.get(req.params.uid);
    if (!u) return res.status(404).json({ error: 'Account not found' });
    const on = !!req.body?.on;
    T.users.update(u.id, (x) => { x.studio = { ...(x.studio || {}), on, ...(on ? { since: x.studio?.since || Date.now() } : {}) }; });
    audit(req, u.id, on ? 'studio_on' : 'studio_off');
    res.json({ on });
  });
  if (isTest) app.post('/api/__test/studio-tick', async (req, res) => { const n = Number(req.body?.times) || 1; for (let i = 0; i < n; i++) await tick(); res.json({ ok: true }); });
}
