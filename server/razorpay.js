// Razorpay: each seller connects their own account (Key ID + Key Secret, optional webhook secret).
// Flow: server creates a Razorpay order → buyer pays in Razorpay Checkout → server verifies the
// signature before the order counts as paid. The webhook (payment.captured / order.paid) covers
// buyers who pay but close the page before the browser reports back.
import crypto from 'node:crypto';
import { encrypt, decrypt } from './messaging.js';

const API = () => (process.env.RAZORPAY_API_URL || 'https://api.razorpay.com/v1').replace(/\/$/, '');
const KEY_RE = /^rzp_(test|live)_[A-Za-z0-9]{8,40}$/;

export function rzpCreds(u) {
  const r = u?.channels?.razorpay;
  if (!r?.keyId || !r?.secretEnc) return null;
  return { keyId: r.keyId, secret: decrypt(r.secretEnc), webhookSecret: decrypt(r.webhookSecretEnc), mode: r.keyId.startsWith('rzp_live_') ? 'live' : 'test' };
}
export const rzpStatus = (u) => {
  const r = u?.channels?.razorpay;
  return { keyId: r?.keyId || '', hasSecret: !!r?.secretEnc, hasWebhookSecret: !!r?.webhookSecretEnc, mode: r?.keyId?.startsWith('rzp_live_') ? 'live' : r?.keyId ? 'test' : null, configured: !!(r?.keyId && r?.secretEnc) };
};

async function call(c, method, path, body) {
  const r = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${c.keyId}:${c.secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.description || `Razorpay error ${r.status}`); e.status = r.status; throw e; }
  return data;
}
// amount in paise
export const createOrder = (c, { amount, receipt, notes }) => call(c, 'POST', '/orders', { amount, currency: 'INR', receipt: String(receipt).slice(0, 40), notes });

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const validPayment = (secret, orderId, paymentId, signature) => same(hmac(secret, `${orderId}|${paymentId}`), String(signature || ''));
export const validWebhook = (secret, rawBody, signature) => !!secret && same(hmac(secret, rawBody), String(signature || ''));

// ---------- settings ----------
export function registerRazorpaySettings(app, { auth, save, wrap }) {
  app.put('/api/channels/razorpay', auth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.clear) { delete req.user.channels?.razorpay; save(); return res.json(rzpStatus(req.user)); }
    const keyId = String(b.keyId || '').trim();
    if (!KEY_RE.test(keyId)) return res.status(400).json({ error: 'The Key ID looks like rzp_test_… or rzp_live_… (Razorpay → Account & Settings → API keys)' });
    const prev = req.user.channels?.razorpay || {};
    const secret = String(b.keySecret || '').trim() || (prev.keyId === keyId ? decrypt(prev.secretEnc) : '');
    if (!secret) return res.status(400).json({ error: 'Paste the Key Secret shown when you generated the key' });
    // prove the keys work before saving them
    try { await call({ keyId, secret }, 'GET', '/orders?count=1'); } catch (e) {
      return res.status(400).json({ error: e.status === 401 ? 'Razorpay rejected these keys — check the Key ID and Key Secret (and that both are test or both live)' : `Couldn’t reach Razorpay: ${e.message}` });
    }
    const webhookSecret = String(b.webhookSecret || '').trim();
    req.user.channels = { ...req.user.channels, razorpay: { keyId, secretEnc: encrypt(secret), webhookSecretEnc: webhookSecret ? encrypt(webhookSecret) : b.clearWebhookSecret ? '' : prev.webhookSecretEnc || '', at: Date.now() } };
    save();
    res.json(rzpStatus(req.user));
  }));
}
