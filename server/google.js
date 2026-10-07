// "Continue with Google": the browser gets an ID token from Google Identity Services and sends it here.
// We check Google's signature (keys from Google's JWKS), the audience (our client ID), issuer, expiry
// and that Google verified the email — then sign the person in, creating the account on first use.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { platform } from './platform.js';

export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID || platform().googleClientId || '').trim();
const JWKS_URL = () => process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let keys = null, keysAt = 0;
async function keyFor(kid) {
  if (!keys || Date.now() - keysAt > 3600000 || !keys[kid]) {
    const r = await fetch(JWKS_URL(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('Couldn’t reach Google — please try again');
    const { keys: list = [] } = await r.json();
    keys = Object.fromEntries(list.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
    keysAt = Date.now();
  }
  return keys[kid];
}

// Returns { email, name, sub } or throws a friendly error
export async function verifyGoogleToken(credential) {
  const clientId = googleClientId();
  if (!clientId) throw new Error('Google sign-in isn’t set up on this server');
  const head = jwt.decode(String(credential || ''), { complete: true })?.header;
  if (!head?.kid) throw new Error('Google sign-in failed — please try again');
  const key = await keyFor(head.kid);
  if (!key) throw new Error('Google sign-in failed — please try again');
  let p;
  try { p = jwt.verify(credential, key, { algorithms: ['RS256'], audience: clientId, issuer: ISSUERS }); } catch { throw new Error('Google sign-in failed or expired — please try again'); }
  if (!p.email || p.email_verified !== true) throw new Error('Your Google account’s email isn’t verified');
  return { email: String(p.email).toLowerCase(), name: String(p.name || p.given_name || p.email.split('@')[0]).slice(0, 80), sub: String(p.sub) };
}
