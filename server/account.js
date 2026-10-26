// A seller's own data: export everything (JSON) and delete the account with all its data.
// Invoices are kept (GST law requires keeping them) but are detached from the deleted account.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { newBilling } from './billing.js';
import { s3Enabled, deletePrefix } from './storage.js';
import { dropRollups } from './rollup.js';
import { T, q, tx, dir as DATA_DIR } from './db.js';
import { removeVaultFiles } from './vault.js';
import { dropAccountKnowledge } from './waknow.js';

const OWNED = ['funnels', 'revisions', 'leads', 'orders', 'abandoned', 'coupons', 'webhooks', 'saved', 'crm', 'pipelines', 'automations', 'runs', 'domains', 'msgs', 'payments', 'hive', 'mcptokens', 'products', 'access', 'portals', 'downloads', 'conversions', 'calendars', 'bookings', 'webinars', 'registrations', 'broadcasts', 'bsends', 'apikeys', 'hooksubs', 'stripecust', 'rzplans', 'activity', 'adspend', 'quotes', 'notifications', 'vaultFolders', 'vaultFiles', 'vaultLinks', 'vaultShares', 'vaultSecrets', 'roles', 'waconvs', 'wachat', 'waflows', 'kdocs', 'kchunks', 'kprods'];
// never in an export: passwords, 2-step and webhook secrets, stored keys and tokens (…Enc, …Hash, …Token, …Secret)
const SECRET_KEY = /^(hash|pass|verifyExp|resetExp|legacyBefore)$|^totp|enc$|hash$|token$|secret|apikey|password/i;
const scrub = (v) => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEY.test(k)).map(([k, x]) => [k, scrub(x)])) : v);
const strip = (u) => scrub(u);

export function exportAccount(userId) {
  const u = T.users.get(userId);
  const out = { exportedAt: new Date().toISOString(), account: strip(u) };
  for (const t of OWNED) out[t] = T[t].all({ userId }).map(scrub);
  out.events = q('SELECT funnelId, stepId, type, variant, source, visitor, at FROM events WHERE userId = ? ORDER BY at').all(userId);
  out.pageViewsByDay = q('SELECT funnelId, stepId, type, variant, source, day, n FROM pv_days WHERE userId = ? ORDER BY day').all(userId); // older page views, as daily totals
  out.invoices = T.invoices.all({ userId });
  out.salesInvoices = T.sinvoices.all({ userId });
  return out;
}

export function deleteAccount(userId) {
  // an agency leaving: client accounts someone can log in to become independent; the rest go with it
  for (const row of q("SELECT data FROM users WHERE json_extract(data, '$.agencyId') = ?").all(userId)) {
    const c = JSON.parse(row.data);
    if (c.passwordSet) T.users.update(c.id, (x) => { delete x.agencyId; x.billing = newBilling(); });
    else deleteAccount(c.id);
  }
  tx(() => {
    for (const a of T.automations.all({ userId })) T.autoversions.delWhere({ automationId: a.id });
    for (const t of OWNED) T[t].delWhere({ userId });
    q('DELETE FROM events WHERE userId = ?').run(userId);
    dropAccountKnowledge(userId); // the AI agent's search indexes
    dropRollups.user(userId);
    T.members.delWhere({ ownerId: userId }); // their team
    T.members.delWhere({ userId }); // teams they were on
    q('DELETE FROM usage WHERE userId = ?').run(userId);
    T.sessions.delWhere({ userId });
    for (const i of T.invoices.all({ userId })) { i.userDeleted = true; T.invoices.put(i); }
    for (const i of T.sinvoices.all({ userId })) { i.userDeleted = true; T.sinvoices.put(i); } // invoices issued to buyers are kept too
    T.users.del(userId);
  });
  fs.rmSync(path.join(DATA_DIR, 'uploads', userId), { recursive: true, force: true });
  if (s3Enabled()) for (const p of [`uploads/${userId}/`, `products/${userId}/`, `vault/${userId}/`]) deletePrefix(p).catch((e) => console.error('storage cleanup failed', e.message));
  fs.rmSync(path.join(DATA_DIR, 'products', userId), { recursive: true, force: true });
  removeVaultFiles(userId);
}

export function registerAccount(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Please try again later.' });
  app.get('/api/account/export', auth, limiter, (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="account-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportAccount(req.user.id));
  });
  app.post('/api/account/delete', auth, limiter, (req, res) => {
    if (req.user.passwordSet !== false && !bcrypt.compareSync(String(req.body.password || ''), req.user.hash)) return res.status(403).json({ error: 'Your password is incorrect' });
    if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
    if (req.user.billing?.subscriptionId && ['active', 'past_due'].includes(req.user.billing.status) && !req.user.billing.cancelAtPeriodEnd) return res.status(400).json({ error: 'Cancel your subscription first (Billing), then delete the account.' });
    deleteAccount(req.user.id);
    res.json({ ok: true });
  });
}
