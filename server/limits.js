// Fair-use limits per seller and sign-up abuse protection.
// Limits keep one account from filling the disk or the shared email sender: funnels, image storage, and (on the
// shared sender, during the free trial) broadcast emails a day. Admin → Plan & settings sets the defaults; Admin →
// a seller can raise them for that account. Sign-ups get a honeypot, a disposable-inbox check, a per-IP daily cap
// and, when TURNSTILE_SECRET_KEY is set, Cloudflare Turnstile.
import { T, hit, q } from './db.js';
import { platform } from './platform.js';
import { decrypt } from './messaging.js';
import { accessFor } from './billing.js';

export const LIMIT_DEFAULTS = { funnels: 200, funnelsTrial: 20, storageMB: 5120, storageMBTrial: 500, broadcastTrialDaily: 50 };
const MB = 1024 * 1024;

const trialing = (u) => { const a = accessFor(u); return !a.admin && (a.status === 'trialing' || a.status === 'expired' && a.planStatus === 'trialing'); };
export function limitsFor(u) {
  const p = { ...LIMIT_DEFAULTS, ...(platform().limits || {}) }, o = u?.limits || {}, trial = trialing(u);
  return {
    trial,
    funnels: o.funnels ?? (trial ? p.funnelsTrial : p.funnels),
    storageMB: o.storageMB ?? (trial ? p.storageMBTrial : p.storageMB),
    broadcastDaily: trial ? p.broadcastTrialDaily : null, // null: only the shared sender's own cap
  };
}
// pages: the funnels' content and their restore points — kept in the database, so they count like files do
export const FUNNEL_MAX_BYTES = 2 * MB; // a whole funnel; real ones are 10–50 KB
export const pagesBytes = (userId) => q('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM funnels WHERE userId = ?').get(userId).n + q('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM revisions WHERE userId = ?').get(userId).n;
const mb = (b) => Math.round((b / MB) * 10) / 10;
export function usageFor(u) {
  const pages = pagesBytes(u.id);
  return { funnels: T.funnels.count({ userId: u.id }), storageMB: mb((u.storageBytes || 0) + pages), filesMB: mb(u.storageBytes || 0), pagesMB: mb(pages) };
}
// room for this many more bytes of pages: the oldest restore points go first (never the last 5 of a funnel);
// → an error message when even that isn't enough
export function makePageRoom(u, bytes) {
  if (!u || accessFor(u).admin || bytes <= 0) return null;
  const cap = limitsFor(u).storageMB * MB;
  let over = (u.storageBytes || 0) + pagesBytes(u.id) + bytes - cap;
  if (over <= 0) return null;
  const old = q('SELECT id, LENGTH(data) AS n FROM revisions r WHERE userId = ? AND (SELECT COUNT(*) FROM revisions x WHERE x.funnelId = r.funnelId AND x.at > r.at) >= 5 ORDER BY at').all(u.id);
  const drop = [];
  for (const r of old) { if (over <= 0) break; drop.push(r.id); over -= r.n; }
  if (drop.length) q(`DELETE FROM revisions WHERE id IN (${drop.map(() => '?').join(',')})`).run(...drop);
  return over > 0 ? storageMessage(u) : null;
}
const storageMessage = (u) => {
  const { storageMB, trial } = limitsFor(u);
  return trial ? `The free trial includes ${storageMB} MB of storage (images, files and pages) — subscribe for more space` : `You’ve used your ${storageMB} MB of storage (images, files and pages) — delete what you don’t need, or contact support to raise it`;
};
// → an error message when the seller can't create another funnel (agency client accounts count on their own)
export function funnelLimitError(u) {
  if (!u || accessFor(u).admin) return null;
  const { funnels, trial } = limitsFor(u);
  if (T.funnels.count({ userId: u.id }) < funnels) return null;
  return trial ? `The free trial includes up to ${funnels} funnels — subscribe to build more, or delete ones you don’t need` : `You’ve reached ${funnels} funnels — delete ones you don’t need, or contact support to raise the limit`;
}
export function storageLimitError(u, bytes) {
  if (!u || accessFor(u).admin) return null;
  const { storageMB } = limitsFor(u);
  if ((u.storageBytes || 0) + pagesBytes(u.id) + bytes <= storageMB * MB) return null;
  return storageMessage(u);
}
export const addStorage = (userId, bytes) => T.users.update(userId, (x) => { x.storageBytes = Math.max(0, (x.storageBytes || 0) + bytes); });
export function saveLimits(b) {
  const out = {};
  for (const k of Object.keys(LIMIT_DEFAULTS)) {
    if (b?.[k] == null || b[k] === '') continue;
    const n = Math.round(Number(b[k]));
    if (!(n >= 0 && n <= 10000000)) throw new Error('Enter valid limit numbers');
    out[k] = n;
  }
  return { ...LIMIT_DEFAULTS, ...(platform().limits || {}), ...out };
}

// ---------- sign-ups ----------
// common throwaway-inbox domains (spam sign-ups use them; they can't receive invoices or password resets for long)
const DISPOSABLE = new Set(('mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com 10minutemail.net tempmail.com temp-mail.org temp-mail.io tempmail.net tempmailo.com '
  + 'throwawaymail.com yopmail.com yopmail.net yopmail.fr getnada.com nada.email dispostable.com maildrop.cc mailnesia.com trashmail.com trashmail.de trashmail.net mintemail.com mohmal.com '
  + 'fakeinbox.com emailondeck.com mailcatch.com spamgourmet.com getairmail.com tempinbox.com burnermail.io inboxkitten.com mail.tm mailpoof.com moakt.com tmail.ws tmpmail.org tmpmail.net '
  + 'emailfake.com fakemail.net discard.email mytemp.email tempr.email 33mail.com spambox.us mailsac.com harakirimail.com anonaddy.me 1secmail.com 1secmail.net 1secmail.org').split(/\s+/));
export const isDisposable = (email) => DISPOSABLE.has(String(email || '').split('@')[1]?.toLowerCase() || '');
const PER_IP = Number(process.env.SIGNUPS_PER_IP_DAY || (process.env.NODE_ENV === 'test' ? 100000 : 5));
const VERIFY_URL = process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Turnstile keys: the server's env, else Admin → Bot protection
const captchaKeys = () => {
  if (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY) return { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY };
  const c = platform().captcha || {};
  const secret = c.siteKey && c.secretEnc ? decrypt(c.secretEnc) : '';
  return secret ? { site: c.siteKey, secret } : null;
};
export const turnstileSiteKey = () => captchaKeys()?.site || null;
// checks a Turnstile secret: Cloudflare answers a dummy token with 'invalid-input-response' for a good secret
export async function checkTurnstileSecret(secret) {
  const r = await fetch(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret, response: 'check' }), signal: AbortSignal.timeout(8000) });
  const codes = (await r.json())['error-codes'] || [];
  return !codes.includes('invalid-input-secret') && !codes.includes('missing-input-secret');
}

// → { status, error } when a new account should not be created
export async function signupGuard(req, email, { google = false } = {}) {
  if (!google && String(req.body?.website || '').trim()) return { status: 400, error: 'Sign-up failed — please try again' }; // the hidden field only bots fill
  if (isDisposable(email)) return { status: 400, error: 'Please use your real email address — temporary inboxes can’t receive your invoices and login links' };
  const keys = google ? null : captchaKeys();
  if (keys) {
    const token = String(req.body?.turnstile || '');
    let ok = false;
    if (token) {
      try {
        const r = await fetch(VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ secret: keys.secret, response: token, remoteip: req.ip || '' }), signal: AbortSignal.timeout(8000) });
        ok = !!(await r.json()).success;
      } catch (e) { console.error('Turnstile check failed', e.message); ok = true; } // Cloudflare unreachable: don't lock everyone out
    }
    if (!ok) return { status: 400, error: 'Please complete the “I’m human” check and try again' };
  }
  if (hit(`signup:${req.ip}`, 86400000).n > PER_IP) return { status: 429, error: 'Too many new accounts from this network today — please try again tomorrow or contact support' };
  return null;
}
