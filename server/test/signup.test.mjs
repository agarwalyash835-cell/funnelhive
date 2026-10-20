// Sign-up must work in production mode (several app processes, no JWT_SECRET, a brand-new database),
// and "Continue with Google" signs people in with a Google-signed ID token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { startServer } from './helpers.mjs';

const CLIENT = '1234567890-test.apps.googleusercontent.com';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const idToken = (claims = {}, key = privateKey) => jwt.sign({ email: 'priya@gmail.com', email_verified: true, name: 'Priya Sharma', sub: 'g-123', ...claims }, key, { algorithm: 'RS256', keyid: 'k1', audience: CLIENT, issuer: 'https://accounts.google.com', ...(claims.exp ? {} : { expiresIn: '1h' }) });
let jwks, srv, api;

before(async () => {
  jwks = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  // production-like: 3 processes, no JWT_SECRET, fresh data folder
  srv = await startServer({ JWT_SECRET: '', WEB_CONCURRENCY: '3', GOOGLE_CLIENT_ID: CLIENT, GOOGLE_JWKS_URL: `http://127.0.0.1:${jwks.address().port}` }, { entry: 'start.js' });
  api = srv.api;
  for (let i = 0; i < 50 && (await api('/health').catch(() => ({}))).status !== 200; i++) await new Promise((r) => setTimeout(r, 100));
});
after(async () => { await srv.stop(); jwks.close(); });

test('sign up, then stay signed in on every app process', async () => {
  const r = await api('/auth/register', 'POST', { email: 'new.seller@test.dev', password: 'secret123', name: 'New Seller' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const results = await Promise.all(Array.from({ length: 24 }, () => api('/me', 'GET', null, r.data.token).then((x) => x.status)));
  assert.ok(results.every((s) => s === 200), `every process accepts the session: ${results.join(',')}`);
  assert.ok(!/database is locked|exited/.test(srv.log()), 'no process crashed while starting');
});

test('Continue with Google: creates the account, signs in again, links existing accounts', async () => {
  assert.equal((await api('/site')).data.googleClientId, CLIENT);
  const first = await api('/auth/google', 'POST', { credential: idToken() });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const me = (await api('/me', 'GET', null, first.data.token)).data;
  assert.equal(me.email, 'priya@gmail.com');
  assert.equal(me.name, 'Priya Sharma');
  assert.equal(me.emailVerified, true);
  assert.equal(me.billing.status, 'trialing');
  const again = await api('/auth/google', 'POST', { credential: idToken() });
  assert.equal(again.data.user.id, first.data.user.id, 'same account next time');
  // someone who signed up with email + password can use Google with the same address
  const pw = await api('/auth/register', 'POST', { email: 'both@test.dev', password: 'secret123' });
  const g = await api('/auth/google', 'POST', { credential: idToken({ email: 'both@test.dev', sub: 'g-9' }) });
  assert.equal(g.data.user.id, pw.data.user.id);
  // that email was never verified, so whoever registered it might not own it: once Google proves the real owner,
  // the earlier password and sessions stop working
  assert.equal((await api('/me', 'GET', null, pw.data.token)).status, 401, 'the earlier session is signed out');
  assert.equal((await api('/auth/login', 'POST', { email: 'both@test.dev', password: 'secret123' })).status, 401, 'the earlier password no longer works');
  assert.equal((await api('/me', 'GET', null, g.data.token)).status, 200, 'the Google sign-in works');
});

test('Google tokens that are forged, for another app, expired or unverified are refused', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal((await api('/auth/google', 'POST', { credential: idToken({}, other) })).status, 401, 'wrong signature');
  assert.equal((await api('/auth/google', 'POST', { credential: jwt.sign({ email: 'x@gmail.com', email_verified: true, sub: '1' }, privateKey, { algorithm: 'RS256', keyid: 'k1', audience: 'someone-else.apps.googleusercontent.com', issuer: 'https://accounts.google.com' }) })).status, 401, 'other audience');
  assert.equal((await api('/auth/google', 'POST', { credential: idToken({ exp: Math.floor(Date.now() / 1000) - 60 }) })).status, 401, 'expired');
  assert.equal((await api('/auth/google', 'POST', { credential: idToken({ email: 'u@gmail.com', email_verified: false }) })).status, 401, 'unverified email');
  assert.equal((await api('/auth/google', 'POST', { credential: 'garbage' })).status, 401);
});
