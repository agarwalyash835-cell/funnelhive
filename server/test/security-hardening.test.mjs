// Security hardening: Content Security Policy, sessions (list, revoke, refresh), password rules, per-account
// lockout, 2-step code replay, admin 2-step requirement, admin reset links and support access, encrypted
// off-site backups and secret-free account exports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { startServer, register, enable2fa, totpCode } from './helpers.mjs';

const ADMIN = 'boss@harden.test';
let srv, api;
before(async () => { srv = await startServer({ ADMIN_EMAILS: ADMIN }); api = srv.api; });
after(() => srv.stop());

const verify = async (s, email) => {
  await new Promise((r) => setTimeout(r, 150));
  const link = s.log().match(new RegExp(`To: ${email.replace(/[.]/g, '\\.')}[\\s\\S]*?/verify\\?token=([a-f0-9.]+)`));
  await s.api('/auth/verify', 'POST', { token: link[1] });
};
const login = (email, password = 'secret123', extra = {}) => api('/auth/login', 'POST', { email, password, ...extra });
const directive = (policy, name) => (policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '').split(' ').slice(1);

test('CSP: strict on the app, a per-request nonce on funnel pages, embeddable booking pages', async () => {
  const app = await fetch(`${srv.base}/login`);
  const policy = app.headers.get('content-security-policy');
  assert.ok(policy, 'the dashboard has a policy');
  assert.ok(!directive(policy, 'script-src').includes("'unsafe-inline'"));
  assert.ok(directive(policy, 'script-src').includes('https://checkout.razorpay.com'));
  assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
  assert.deepEqual(directive(policy, 'frame-ancestors'), ["'self'"]);
  assert.equal(app.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.equal(app.headers.get('x-frame-options'), 'SAMEORIGIN');
  const meet = await fetch(`${srv.base}/meet/someone`);
  assert.deepEqual(directive(meet.headers.get('content-security-policy'), 'frame-ancestors'), ['*']);
  assert.equal(meet.headers.get('x-frame-options'), null);

  const { token } = await register(api);
  const f = (await api('/templates/yoga/use', 'POST', {}, token)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, token);
  const nonces = [];
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${srv.base}/f/${f.slug}`);
    const html = await r.text();
    const p = r.headers.get('content-security-policy');
    const n = (/'nonce-([^']+)'/.exec(p) || [])[1];
    assert.ok(n, 'the funnel page has a nonce');
    assert.ok(html.includes(`<script nonce="${n}">window.__FUNNEL__=`), 'the inline data script carries it');
    assert.ok(!/<script>/.test(html), 'no inline script without it');
    assert.ok(directive(p, 'script-src').includes('https://connect.facebook.net') && directive(p, 'script-src').includes('https://www.googletagmanager.com'), 'pixels can load');
    nonces.push(n);
  }
  assert.notEqual(nonces[0], nonces[1], 'a new nonce per request');

  // a custom-HTML block (sandboxed srcdoc frame, which inherits the page's policy): its own scripts may run
  const full = (await api(`/funnels/${f.id}`, 'GET', null, token)).data;
  full.steps[0].blocks.push({ id: 'emb1', type: 'html', props: { code: '<script>document.write("hi")</script>' } });
  assert.equal((await api(`/funnels/${f.id}`, 'PUT', { steps: full.steps }, token)).status, 200);
  const e = await fetch(`${srv.base}/f/${f.slug}`);
  assert.ok(directive(e.headers.get('content-security-policy'), 'script-src').includes("'unsafe-inline'"));
});

test('sessions: listed per device, revoked one by one or everywhere else, ended by logout', async () => {
  const { email } = await register(api);
  const a = (await login(email)).data.token, b = (await login(email)).data.token;
  const list = (await api('/auth/sessions', 'GET', null, a)).data.sessions;
  assert.ok(list.length >= 3, 'sign-up + two log-ins');
  assert.equal(list.filter((s) => s.current).length, 1);
  assert.ok(list.every((s) => s.device && !('userId' in s)));
  const bSid = jwt.decode(b).sid;
  assert.equal((await api(`/auth/sessions/${bSid}/revoke`, 'POST', {}, a)).status, 200);
  assert.equal((await api('/me', 'GET', null, b)).status, 401, 'that device is signed out');
  assert.equal((await api('/me', 'GET', null, a)).status, 200, 'this one is not');

  const c = (await login(email)).data.token;
  const r = await api('/auth/sessions/revoke-others', 'POST', {}, a);
  assert.equal(r.status, 200);
  assert.equal((await api('/me', 'GET', null, c)).status, 401);
  assert.equal((await api('/me', 'GET', null, r.data.token)).status, 200);
  assert.equal((await api('/auth/sessions', 'GET', null, a)).data.sessions.length, 1);

  assert.equal((await api('/auth/logout', 'POST', {}, a)).status, 200);
  assert.equal((await api('/me', 'GET', null, a)).status, 401, 'logout ends the session on the server');
  // someone else's session can't be touched
  const other = (await register(api)).token;
  const d = (await login(email)).data.token;
  assert.equal((await api(`/auth/sessions/${jwt.decode(d).sid}/revoke`, 'POST', {}, other)).status, 404);
  assert.equal((await api('/me', 'GET', null, d)).status, 200);
});

test('refresh: a fresh 14-day token for the same session; tokens from before sessions get one', async () => {
  const { token, email } = await register(api);
  const p = jwt.decode(token);
  assert.ok(p.sid);
  assert.ok(p.exp - p.iat <= 14 * 86400, 'tokens last 14 days');
  await new Promise((r) => setTimeout(r, 1100));
  const r = await api('/auth/refresh', 'POST', {}, token);
  assert.equal(r.status, 200);
  assert.equal(jwt.decode(r.data.token).sid, p.sid);
  assert.ok(jwt.decode(r.data.token).iat > p.iat);
  assert.equal((await api('/me', 'GET', null, r.data.token)).status, 200);

  // an old token (no session id): still accepted, refreshed into a session, and ended by "sign out everywhere else"
  const id = (await api('/me', 'GET', null, token)).data.id;
  const legacy = jwt.sign({ id, pv: 0 }, 'test-secret', { expiresIn: '30d' });
  assert.equal((await api('/me', 'GET', null, legacy)).status, 200);
  const upgraded = (await api('/auth/refresh', 'POST', {}, legacy)).data.token;
  assert.ok(jwt.decode(upgraded).sid);
  await new Promise((r) => setTimeout(r, 1100));
  await api('/auth/sessions/revoke-others', 'POST', {}, (await login(email)).data.token);
  assert.equal((await api('/me', 'GET', null, legacy)).status, 401);
  assert.equal((await api('/me', 'GET', null, upgraded)).status, 401);
});

test('passwords: 8+ characters and not a common one (new passwords only)', async () => {
  for (const password of ['short1', 'password', '12345678', 'qwerty123', 'Password1'])
    assert.equal((await api('/auth/register', 'POST', { email: `w${Math.random()}@test.dev`.replace('0.', ''), password }, null)).status, 400, password);
  const { token } = await register(api);
  assert.equal((await api('/auth/change-password', 'POST', { current: 'secret123', password: 'iloveyou' }, token)).status, 400);
  const ok = await api('/auth/change-password', 'POST', { current: 'secret123', password: 'Mango-Lassi-42' }, token);
  assert.equal(ok.status, 200);
  assert.equal((await api('/me', 'GET', null, ok.data.token)).status, 200);
  assert.equal((await api('/me', 'GET', null, token)).status, 401, 'the old token is signed out');
});

test('lockout: 10 wrong passwords for one email lock that account for 15 minutes', async () => {
  const { email } = await register(api);
  const { email: other } = await register(api);
  for (let i = 0; i < 10; i++) assert.equal((await login(email, 'wrong-password')).status, 401);
  const locked = await login(email);
  assert.equal(locked.status, 429, 'even the right password waits');
  assert.match(locked.data.error, /locked for 1[45] more minutes/);
  assert.equal((await login(email.toUpperCase())).status, 429, 'whatever the case');
  assert.equal((await login(other)).status, 200, 'other accounts are fine');
});

test('2-step codes: each one works once; 10 wrong codes lock the account', async () => {
  const { token, email } = await register(api);
  const { secret } = await enable2fa(api, token);
  assert.equal((await login(email, 'secret123', { code: totpCode(secret, -1) })).status, 401, 'the code used to turn it on is spent');
  const code = totpCode(secret);
  assert.equal((await login(email, 'secret123', { code })).status, 200);
  const replay = await login(email, 'secret123', { code });
  assert.equal(replay.status, 401, 'replayed');
  assert.match(replay.data.error, /already used/);
  for (let i = 0; i < 9; i++) await login(email, 'secret123', { code: '000000' }); // + the replay above = 10 (a good code resets the count)
  const locked = await login(email, 'secret123', { code: totpCode(secret, 1) });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.twoFactorRequired, true);
});

let adminTok, adminSecret;
test('admins need 2-step login for the admin panel (and only there)', async () => {
  const t = (await register(api, ADMIN)).token;
  await verify(srv, ADMIN);
  const r = await api('/admin/overview', 'GET', null, t);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'ADMIN_2FA_REQUIRED');
  assert.equal((await api('/me', 'GET', null, t)).data.admin, true, 'the rest of the app works');
  assert.equal((await api('/funnels', 'GET', null, t)).status, 200);
  ({ token: adminTok, secret: adminSecret } = await enable2fa(api, t));
  assert.equal((await api('/admin/overview', 'GET', null, adminTok)).status, 200);
});

test('admin reset link: admins only, one-time, audited; support access needs a reason and tells the seller', async () => {
  const { token, email } = await register(api);
  const id = (await api('/me', 'GET', null, token)).data.id;
  assert.equal((await api(`/admin/users/${id}/reset-link`, 'POST', {}, token)).status, 403);
  const r = await api(`/admin/users/${id}/reset-link`, 'POST', {}, adminTok);
  assert.equal(r.status, 200);
  const t = new URL(r.data.link).searchParams.get('token');
  assert.ok(r.data.expiresAt - Date.now() <= 3600000);
  assert.equal((await api('/auth/reset', 'POST', { token: t, password: 'Fresh-Start-77' })).status, 200);
  assert.equal((await api('/auth/reset', 'POST', { token: t, password: 'Fresh-Start-78' })).status, 400, 'works once');
  assert.equal((await login(email, 'Fresh-Start-77')).status, 200);
  const detail = (await api(`/admin/users/${id}`, 'GET', null, adminTok)).data;
  assert.ok(detail.audit.some((a) => a.action === 'reset_link'));

  const act = (extra) => api(`/admin/users/${id}/action`, 'POST', { action: 'impersonate', ...extra }, adminTok);
  assert.equal((await act({})).status, 400);
  const imp = (await act({ reason: 'Checking a failed payment' })).data.token;
  assert.equal(jwt.decode(imp).exp - jwt.decode(imp).iat, 7200);
  assert.equal((await api('/me', 'GET', null, imp)).data.impersonating, true);
  assert.equal((await api('/auth/change-password', 'POST', { current: 'x', password: 'Whatever-123' }, imp)).status, 403, 'support can’t change sign-in settings');
  const seller = (await login(email, 'Fresh-Start-77')).data.token;
  const bell = (await api('/notifications', 'GET', null, seller)).data.items;
  assert.ok(bell.some((n) => n.kind === 'support' && /Checking a failed payment/.test(n.body)));
  assert.ok((await api('/auth/sessions', 'GET', null, seller)).data.sessions.some((s) => s.support), 'the seller sees support’s session');
  assert.ok((await api(`/admin/users/${id}`, 'GET', null, adminTok)).data.audit.some((a) => a.action === 'impersonate' && a.detail === 'Checking a failed payment'));
});

test('account export holds no secrets', async () => {
  const { token } = await register(api);
  await enable2fa(api, token);
  await api('/settings/webhook-secret', 'POST', {}, token).catch(() => {});
  await api('/keys', 'POST', { name: 'Zapier' }, token);
  const r = await fetch(`${srv.base}/api/account/export`, { headers: { authorization: `Bearer ${token}` } });
  const text = await r.text();
  const data = JSON.parse(text);
  assert.ok(data.account.email);
  for (const bad of [/"hash"/, /"totpSecret"/, /"webhookSecret"/, /Enc"/, /Hash"/, /\$2[aby]\$/, /"tokenHash"/]) assert.ok(!bad.test(text), String(bad));
});

test('off-site backups are encrypted and the admin restore decrypts them', async () => {
  const objects = new Map();
  const s3 = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), key = decodeURIComponent(u.pathname.replace(/^\/bucket\/?/, ''));
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); return res.end(); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && u.searchParams.get('list-type')) return res.end(`<ListBucketResult>${[...objects.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix'))).map((k) => `<Key>${k}</Key>`).join('')}</ListBucketResult>`);
      if (req.method === 'GET' && objects.has(key)) return res.end(objects.get(key));
      res.writeHead(404); res.end();
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const env = { ADMIN_EMAILS: 'boss@bk.test', ENCRYPTION_KEY: 'backup-key-for-tests', S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, S3_BUCKET: 'bucket', S3_ACCESS_KEY: 'AK', S3_SECRET_KEY: 'SK', S3_REGION: 'auto' };
  let s = await startServer(env);
  const dataDir = s.dataDir;
  try {
    const t = (await register(s.api, 'boss@bk.test')).token;
    await verify(s, 'boss@bk.test');
    const { token: A, secret } = await enable2fa(s.api, t);
    await s.api('/funnels', 'POST', { name: 'Before the backup' }, A);
    assert.equal((await s.api('/admin/backup', 'POST', {}, A)).data.ok, true);
    const key = [...objects.keys()].find((k) => /^backups\/funnelhive-\d{4}-\d{2}-\d{2}\.db\.enc$/.test(k));
    assert.ok(key, 'named .db.enc');
    assert.equal(objects.get(key).subarray(0, 4).toString(), 'FHB1');
    assert.ok(!objects.get(key).includes(Buffer.from('SQLite format 3')));
    const listed = (await s.api('/admin/backups', 'GET', null, A)).data;
    assert.deepEqual(listed.bucket, [key.slice(8)]);
    await s.api('/funnels', 'POST', { name: 'After the backup' }, A);
    // a tampered copy is refused
    objects.set('backups/funnelhive-2001-01-01.db.enc', Buffer.concat([objects.get(key).subarray(0, 40), Buffer.from('x'), objects.get(key).subarray(41)]));
    const bad = await s.api('/admin/restore', 'POST', { name: 'funnelhive-2001-01-01.db.enc', from: 'bucket', confirm: 'RESTORE' }, A);
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /decrypted/);
    const r = await s.api('/admin/restore', 'POST', { name: key.slice(8), from: 'bucket', confirm: 'RESTORE' }, A);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    await s.stop({ keep: true });
    s = await startServer(env, { dataDir });
    const back = (await s.api('/auth/login', 'POST', { email: 'boss@bk.test', password: 'secret123', code: totpCode(secret) })).data.token;
    const names = (await s.api('/funnels', 'GET', null, back)).data.map((f) => f.name);
    assert.ok(names.includes('Before the backup'));
    assert.ok(!names.includes('After the backup'));
  } finally { await s.stop(); s3.close(); }
});

test('custom-HTML preview frame: an opaque-origin sandbox with the embed policy, never the dashboard origin', async () => {
  const r = await fetch(srv.base + '/api/embed-frame');
  assert.equal(r.status, 200);
  const policy = r.headers.get('content-security-policy');
  assert.match(policy, /^sandbox allow-scripts allow-popups allow-forms/);
  assert.doesNotMatch(policy, /allow-same-origin/);
  assert.match(policy, /script-src 'self' 'unsafe-inline'/, 'the block\'s own scripts run, as on live pages');
  assert.match(await r.text(), /ffEmbedDoc/);
});
