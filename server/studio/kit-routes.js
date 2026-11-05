// The brand kits API (brand.js). Every kit of the account, with what it locks; adding one (for a client or another
// brand), changing it, making it the default, removing it; and moving a Reel or design to another kit. Who may lock is
// decided in brand.js from who is asking (the owner, their agency, a team member, the director in the chat).
import { T } from '../db.js';
import { kitsOf, kitOf, kitView, ownKit, patchKit, addKit, setDefaultKit, dropKit, whoOf, locked, BRAND_FONTS, LETTERING, LOCKABLE, MAX_KITS } from './brand.js';
import { renderDesign } from './designs.js';
import { snapshot, busyOf } from './versions.js';

export function registerKits(app, { auth, limiter, gate, who, anyView }) {
  const fonts = Object.entries(BRAND_FONTS).map(([id, f]) => ({ id, ...f }));
  const meta = (req) => ({ fonts, lettering: LETTERING, lockable: LOCKABLE, max: MAX_KITS, you: whoOf(req), canLock: ['owner', 'agency'].includes(whoOf(req)) });
  const reply = (res, out, status = 200) => (out.error ? res.status(out.locked ? 409 : 400).json(out) : res.status(status).json(out));

  app.get('/api/studio/kits', auth, (req, res) => res.json({ kits: kitsOf(req.user.id).map(kitView), ...meta(req) }));
  // { label, from: a kit to copy, …the kit's fields }
  app.post('/api/studio/kits', auth, limiter, (req, res) => { if (!gate(req, res)) return; reply(res, addKit(req.user.id, req.body || {}, whoOf(req)), 201); });
  // { label, name, logo, colours, font, lettering, look, tone, products, cta, legal, locks: { logo|colours|font|cta|legal: true|false } }
  app.put('/api/studio/kits/:id', auth, (req, res) => {
    if (!gate(req, res)) return;
    if (!ownKit(req.user.id, req.params.id)) return res.status(404).json({ error: 'Not found' });
    reply(res, patchKit(req.user.id, req.params.id, req.body || {}, whoOf(req)));
  });
  app.post('/api/studio/kits/:id/default', auth, (req, res) => reply(res, setDefaultKit(req.user.id, req.params.id, whoOf(req))));
  app.delete('/api/studio/kits/:id', auth, (req, res) => reply(res, dropKit(req.user.id, req.params.id, whoOf(req))));

  // a Reel or design made with another kit: { kitId }. A Reel takes the kit's logo and is edited again when it's made
  // (free — nothing is rendered); a design is drawn again with the kit's name, logo, colours and lettering.
  app.put('/api/studio/assets/:id/kit', auth, limiter, async (req, res) => {
    if (!gate(req, res)) return;
    const a = T.studio.get(req.params.id);
    if (!a || a.userId !== req.user.id || !['reel', 'design'].includes(a.kind)) return res.status(404).json({ error: 'Not found' });
    if (!ownKit(req.user.id, req.body?.kitId)) return res.status(400).json({ error: 'Pick one of your brand kits' });
    if (busyOf(a) && !['script_ready', 'storyboard_ready', 'draft'].includes(a.status)) return res.status(409).json({ error: 'It’s still being made — change the kit once it’s finished' });
    const was = kitOf(a.userId, a.kitId), k = kitOf(a.userId, req.body.kitId);
    if (was.id === k.id) return res.json(anyView(a));
    snapshot(a.id, `Before: made with the “${was.label || was.name || 'brand'}” kit`, who(req));
    if (a.kind === 'reel') {
      T.studio.update(a.id, (x) => {
        x.kitId = k.id;
        // the old kit's logo (or none) becomes the new kit's; a logo the seller picked for this Reel stays unless locked
        if (k.logo && (locked(k, 'logo') || !x.logo || x.logo === was.logo)) x.logo = k.logo;
        if (['ready', 'needs_review'].includes(x.status)) { x.status = 'editing'; x.editTries = 0; delete x.doneAt; }
      });
      return res.json(anyView(T.studio.get(a.id)));
    }
    const d = T.studio.update(a.id, (x) => {
      x.kitId = k.id;
      x.brand = { ...(x.brand || {}), name: k.name || x.brand?.name || '', logo: k.logo || '' };
      if (k.colours?.length) x.colours = k.colours.slice(0, 2);
      if (k.lettering) x.family = k.lettering;
    });
    try { await renderDesign(d); } catch (e) { return res.status(500).json({ error: 'The design couldn’t be drawn — try again' }); }
    res.json(anyView(T.studio.get(a.id)));
  });
}
