// A seller's own data: export everything (JSON) and delete the account with all its data.
// Invoices are kept (GST law requires keeping them) but are detached from the deleted account.
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { T, q, tx, dir as DATA_DIR } from './db.js';

const OWNED = ['funnels', 'revisions', 'leads', 'orders', 'abandoned', 'coupons', 'webhooks', 'saved', 'crm', 'pipelines', 'automations', 'runs', 'domains', 'msgs', 'payments', 'hive', 'mcptokens'];
const strip = ({ hash, totpSecret, totpPending, verifyHash, resetHash, ...u }) => u;

export function exportAccount(userId) {
  const u = T.users.get(userId);
  const out = { exportedAt: new Date().toISOString(), account: strip(u) };
  for (const t of OWNED) out[t] = T[t].all({ userId }).map(({ hash, ...r }) => r);
  out.events = q('SELECT funnelId, stepId, type, variant, source, visitor, at FROM events WHERE userId = ? ORDER BY at').all(userId);
  out.invoices = T.invoices.all({ userId });
  return out;
}

export function deleteAccount(userId) {
  tx(() => {
    for (const a of T.automations.all({ userId })) T.autoversions.delWhere({ automationId: a.id });
    for (const t of OWNED) T[t].delWhere({ userId });
    q('DELETE FROM events WHERE userId = ?').run(userId);
    q('DELETE FROM usage WHERE userId = ?').run(userId);
    for (const i of T.invoices.all({ userId })) { i.userDeleted = true; T.invoices.put(i); }
    T.users.del(userId);
  });
  fs.rmSync(path.join(DATA_DIR, 'uploads', userId), { recursive: true, force: true });
}

export function registerAccount(app, { auth, rateLimit, isTest }) {
  const limiter = rateLimit({ windowMs: 3600000, max: isTest ? 1000 : 10, key: (req) => req.user.id, message: 'Please try again later.' });
  app.get('/api/account/export', auth, limiter, (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="account-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportAccount(req.user.id));
  });
  app.post('/api/account/delete', auth, limiter, (req, res) => {
    if (!bcrypt.compareSync(String(req.body.password || ''), req.user.hash)) return res.status(401).json({ error: 'Your password is incorrect' });
    if (req.body.confirm !== 'DELETE') return res.status(400).json({ error: 'Type DELETE to confirm' });
    if (req.user.billing?.subscriptionId && ['active', 'past_due'].includes(req.user.billing.status) && !req.user.billing.cancelAtPeriodEnd) return res.status(400).json({ error: 'Cancel your subscription first (Billing), then delete the account.' });
    deleteAccount(req.user.id);
    res.json({ ok: true });
  });
}
