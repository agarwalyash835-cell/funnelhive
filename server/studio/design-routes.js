// Studio Designs' API (designs.js): a brief → the words and a free preview; a check of the words before spending; the
// background picture (the only paid step); free re-draws for every change; each slide's PNG and a zip of them all.
import { T } from '../db.js';
import { TIERS, TIER_NAMES, imageCost, modelKey } from './models.js';
import { LANGUAGES } from './voice.js';
import { newDesign, makeBackground, editDesign, zipDesign, designView, designHash, designsTick, templateMenu, formatMenu, renderDesign, GROUPS } from './designs.js';
import { assessDesign } from './preflight.js';
import { TEMPLATES } from './design-templates.js';

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

export function registerDesigns(app, { auth, rateLimit, isTest, wrap, gate, ownUpload, who }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'You’re making changes quickly — wait a minute and try again.' });
  const writer = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 40, key: (req) => req.user.id, message: 'You’ve started a lot of designs this hour — try again later.' });
  const mine = (req, res, statuses) => {
    const d = T.studio.get(req.params.id);
    if (!d || d.userId !== req.user.id || d.kind !== 'design') { res.status(404).json({ error: 'Not found' }); return null; }
    if (statuses && !statuses.includes(d.status)) { res.status(409).json({ error: d.status === 'producing' ? 'The picture is still being made' : 'It can’t be changed right now' }); return null; }
    return d;
  };
  // a picture the seller picked: their own upload, or one of their ready Studio images (by id)
  const picture = (req, v, id) => {
    if (id) { const s = T.studio.get(id); return s && s.userId === req.user.id && s.kind === 'image' && s.url ? s.url : false; }
    if (!v) return null;
    return ownUpload(req.user.id, v) ? v : false;
  };

  app.get('/api/studio/designs', auth, (req, res) => {
    const designs = T.studio.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 400 }).filter((a) => a.kind === 'design').slice(0, 60);
    res.json({ templates: templateMenu(), formats: formatMenu(), groups: GROUPS, languages: Object.entries(LANGUAGES).map(([id, name]) => ({ id, name })), tiers: TIERS.map((id) => ({ id, name: TIER_NAMES[id], credits: imageCost(id) })), designs: designs.map(designView) });
  });
  app.get('/api/studio/designs/:id', auth, (req, res) => { const d = mine(req, res); if (d) res.json(designView(d)); });

  // a brief → the words (in the language asked) and a free preview; nothing is paid for yet
  app.post('/api/studio/designs', auth, writer, wrap(async (req, res) => {
    if (!gate(req, res)) return;
    const b = req.body || {}, brief = clip(b.brief, 1500);
    const hasText = b.text && typeof b.text === 'object' && TEMPLATES[b.template];
    if (brief.length < 6 && !hasText) return res.status(400).json({ error: 'Tell us what the design is for: the occasion or product, the offer, who it’s for' });
    const photo = picture(req, b.photo, b.photoId), photo2 = picture(req, b.photo2, b.photo2Id);
    if (photo === false || photo2 === false) return res.status(400).json({ error: 'Pick one of your own pictures' });
    if (b.group && !GROUPS.includes(b.group)) return res.status(400).json({ error: 'Pick a post, a thumbnail or a carousel' });
    let d;
    try { d = await newDesign(req.user, { ...b, brief: brief || clip(Object.values(b.text || {}).join(' '), 300), photo, photo2, bg: b.bg || (photo ? 'photo' : 'ai'), by: who(req) }); } catch (e) { console.error('design start failed', e.message, e.detail || ''); return res.status(502).json({ error: e.message }); }
    res.status(201).json(designView(d));
  }));
  // the check before spending: quality and virality of the words and the picture prompt, with better words to apply
  app.post('/api/studio/designs/:id/assess', auth, writer, wrap(async (req, res) => {
    const d = mine(req, res); if (!d) return;
    const hash = designHash(d);
    if (d.assessment?.hash === hash && !req.body?.again) return res.json(designView(d));
    const a = await assessDesign({ brief: d.prompt, group: d.group, format: d.format, lang: d.lang, slides: d.slides, background: d.bgPrompt, fields: d.slides.map((s) => TEMPLATES[s.template].fields.map((f) => f.key)) });
    if (!a) return res.status(503).json({ error: 'The check isn’t available right now — you can still go ahead' });
    res.json(designView(T.studio.update(d.id, (x) => { x.assessment = { ...a, hash }; })));
  }));
  // the go-ahead: the background picture is made (credits), then every slide is drawn on it. { note, tier, imodel }
  app.post('/api/studio/designs/:id/make', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const d = mine(req, res, ['draft', 'ready', 'failed']); if (!d) return;
    const b = req.body || {};
    if (TIERS.includes(b.tier) || b.imodel) T.studio.update(d.id, (x) => { if (TIERS.includes(b.tier)) x.tier = b.tier; if (b.imodel && !x.typography) x.imodel = modelKey('image', x.tier, b.imodel); });
    const out = makeBackground(T.studio.get(d.id), { note: clip(b.note, 300) });
    if (out.error) return res.status(409).json(out);
    res.json({ ...designView(out.design), credits: imageCost(out.design.tier, out.design.imodel) });
  });
  // any change — words, template, colours, font style, size, own photo — is a free re-draw (no new picture)
  app.put('/api/studio/designs/:id', auth, limiter, wrap(async (req, res) => {
    const d = mine(req, res, ['draft', 'ready', 'failed']); if (!d) return;
    const b = { ...(req.body || {}) };
    for (const k of ['photo', 'photo2']) if (b[k] !== undefined || b[`${k}Id`]) { const p = picture(req, b[k], b[`${k}Id`]); if (p === false) return res.status(400).json({ error: 'Pick one of your own pictures' }); b[k] = p; }
    try { res.json(designView(await editDesign(d, b))); } catch (e) { console.error('design edit failed', e.message, e.detail || ''); res.status(500).json({ error: 'The design couldn’t be drawn — try again' }); }
  }));
  // draw it again as it is (e.g. after the brand's logo changed)
  app.post('/api/studio/designs/:id/redraw', auth, limiter, wrap(async (req, res) => {
    const d = mine(req, res, ['draft', 'ready']); if (!d) return;
    res.json(designView(await renderDesign(d)));
  }));
  app.get('/api/studio/designs/:id/zip', auth, wrap(async (req, res) => {
    const d = mine(req, res); if (!d) return;
    if (!d.outputs?.length) return res.status(409).json({ error: 'Nothing has been drawn yet' });
    const name = (clip(d.slides[0]?.text?.headline || d.slides[0]?.text?.heading || 'design', 40).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design');
    res.set('Content-Disposition', `attachment; filename="${name}.zip"`).type('application/zip').send(await zipDesign(d));
  }));
  if (isTest) app.post('/api/__test/designs-tick', async (req, res) => { await designsTick(); res.json({ ok: true }); });
}
