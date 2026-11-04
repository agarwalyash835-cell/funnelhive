// The cast and brand kit API (cast.js). Making a character's reference sheet costs credits: the seller is shown the
// price (sheet-estimate) and the request must carry it back as `confirm`, or nothing is made.
import { T } from '../db.js';
import { TIERS, imageCost } from './models.js';
import { castOf, castMember, resolveCast, cleanMember, addMember, dropMember, memberView, sheetCost, startSheet, sheetBusy, advanceSheets, brandKit, setBrandKit, BRAND_FONTS, SHEET } from './cast.js';

export function registerCast(app, { auth, limiter, gate, ownUpload, who, reelView }) {
  const isOwn = (userId) => (u) => ownUpload(userId, u);
  const fonts = Object.entries(BRAND_FONTS).map(([id, f]) => ({ id, ...f }));
  const tierOf = (t) => (TIERS.includes(t) ? t : 'standard');
  const mineMember = (req, res) => { const c = castMember(req.user.id, req.params.id); if (!c) res.status(404).json({ error: 'Not found' }); return c; };

  // the cast (each with their reference pictures) and the brand kit, with what a reference sheet costs on each tier
  app.get('/api/studio/cast', auth, (req, res) => {
    advanceSheets(req.user.id);
    res.json({ characters: castOf(req.user.id).map(memberView), brand: brandKit(req.user.id), fonts, sheet: { images: SHEET.length, credits: Object.fromEntries(TIERS.map((t) => [t, sheetCost(t)])) } });
  });
  app.get('/api/studio/cast/:id', auth, (req, res) => { advanceSheets(req.user.id); const c = mineMember(req, res); if (c) res.json(memberView(c)); });
  // { name, look, outfit, photos: [their own uploads] }
  app.post('/api/studio/cast', auth, (req, res) => {
    const m = cleanMember(req.body || {}, isOwn(req.user.id));
    if (m.error) return res.status(400).json(m);
    const out = addMember(req.user.id, m.member);
    if (out.error) return res.status(400).json(out);
    res.status(201).json(memberView(out.member));
  });
  app.put('/api/studio/cast/:id', auth, (req, res) => {
    const c = mineMember(req, res); if (!c) return;
    const m = cleanMember(req.body || {}, isOwn(req.user.id), c);
    if (m.error) return res.status(400).json(m);
    if (castOf(req.user.id).some((x) => x.id !== c.id && x.name.toLowerCase() === m.member.name.toLowerCase())) return res.status(400).json({ error: `There’s already someone called ${m.member.name}` });
    res.json(memberView(T.studiocast.update(c.id, (x) => { Object.assign(x, m.member); })));
  });
  app.delete('/api/studio/cast/:id', auth, (req, res) => { const c = mineMember(req, res); if (!c) return; dropMember(c); res.json({ ok: true }); });

  // the reference sheet: what it costs (free), then made only with that price confirmed
  app.post('/api/studio/cast/:id/sheet-estimate', auth, (req, res) => {
    const c = mineMember(req, res); if (!c) return;
    const tier = tierOf(req.body?.tier);
    res.json({ tier, images: SHEET.length, perImage: imageCost(tier), credits: sheetCost(tier) });
  });
  app.post('/api/studio/cast/:id/sheet', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const c = mineMember(req, res); if (!c) return;
    if (sheetBusy(c)) return res.status(409).json({ error: 'Their reference pictures are still being made' });
    const tier = tierOf(req.body?.tier), credits = sheetCost(tier);
    if (Number(req.body?.confirm) !== credits) return res.status(409).json({ error: `Making ${c.name}’s reference pictures costs ${credits} credits — confirm to go ahead`, code: 'CONFIRM', credits, tier });
    res.status(202).json(memberView(startSheet(c, tier, who(req))));
  });

  // the brand kit: { name, logo, colours, font, tone, products }
  app.get('/api/studio/brand', auth, (req, res) => res.json({ ...brandKit(req.user.id), fonts }));
  app.put('/api/studio/brand', auth, (req, res) => {
    const out = setBrandKit(req.user.id, req.body || {}, isOwn(req.user.id));
    if (out.error) return res.status(400).json(out);
    res.json({ ...out.kit, fonts });
  });

  // who is in a Reel (ids or names), before it's approved: their pictures go into every still they appear in
  app.put('/api/studio/reels/:id/cast', auth, (req, res) => {
    const r = T.studio.get(req.params.id);
    if (!r || r.userId !== req.user.id || r.kind !== 'reel') return res.status(404).json({ error: 'Not found' });
    if (r.status !== 'script_ready') return res.status(409).json({ error: 'Pick the cast before the Reel is made' });
    const list = Array.isArray(req.body?.characters) ? req.body.characters : [];
    const cast = resolveCast(req.user.id, list);
    if (cast.length < list.length) return res.status(400).json({ error: 'Pick people from your cast' });
    res.json(reelView(T.studio.update(r.id, (x) => { x.cast = cast.map((c) => c.id); })));
  });
}
