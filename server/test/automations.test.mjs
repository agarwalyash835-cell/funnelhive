// Email (SMTP) + WhatsApp (Cloud API) channels, automations engine, custom domains.
// A tiny SMTP sink and a fake WhatsApp Graph API run locally, so nothing leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, register } from './helpers.mjs';

// domains listed in this file "stop answering" DNS (DOMAINS_FAKE_DOWN)
const downFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-dns-')), 'down.txt');

const mails = [];
// unfold headers and decode quoted-printable / encoded subjects so tests read what a person sees
const readable = (m) => Buffer.from(m.replace(/\n[ \t]+/g, ' ').replace(/=\?UTF-8\?Q\?(.+?)\?=/gi, (x, q) => q.replace(/_/g, ' ')).replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const wa = [];
let smtpDown = false;
let smtp, graph, srv, api, T, me, f;
const k = (key) => encodeURIComponent(key);
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } return fn(); };

before(async () => {
  // SMTP sink: just enough of the protocol for nodemailer
  smtp = net.createServer((sock) => {
    let buf = '', data = false, cur = '';
    sock.write('220 sink\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; mails.push(readable(cur)); cur = ''; sock.write('250 queued\r\n'); } else cur += `${line}\n`; continue; }
        const c = line.slice(0, 4).toUpperCase();
        if (c === 'EHLO' || c === 'HELO') sock.write('250-sink\r\n250 AUTH PLAIN\r\n');
        else if (c === 'AUTH') sock.write('235 ok\r\n');
        else if (c === 'DATA') { data = true; sock.write('354 go\r\n'); }
        else if (c === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else if (c === 'MAIL' && smtpDown) sock.write('451 try again later\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  }).listen(0);
  graph = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      wa.push({ path: req.url, auth: req.headers.authorization, body });
      if (body.type === 'text' && body.to.endsWith('0000')) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } })); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ messages: [{ id: `wamid.${wa.length}` }] }));
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 50));
  srv = await startServer({ WHATSAPP_GRAPH_URL: `http://127.0.0.1:${graph.address().port}`, AUTOMATION_TICK_MS: '50', AUTOMATION_TIME_SCALE: '0.001', DOMAINS_FAKE_DNS: '1', DOMAINS_FAKE_DOWN: downFile, APP_URL: 'http://app.example.test' });
  api = srv.api;
  me = await register(api);
  T = me.token;
  f = (await api('/templates/yoga/use', 'POST', {}, T)).data;
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
});
after(async () => { await srv.stop(); smtp.close(); graph.close(); });

test('channels: SMTP + WhatsApp settings are stored encrypted and never returned', async () => {
  let ch = (await api('/channels', 'GET', null, T)).data;
  assert.equal(ch.email.configured, false);
  assert.equal(ch.whatsapp.configured, false);
  assert.equal((await api('/channels/email', 'PUT', { host: 'not a host', port: 465 }, T)).status, 400);
  ch = (await api('/channels/email', 'PUT', { host: '127.0.0.1', port: smtp.address().port, secure: false, user: 'me', pass: 'p@ss-secret', fromName: 'Yoga Studio', fromEmail: 'hello@yoga.example' }, T)).data;
  assert.equal(ch.email.configured, true);
  assert.equal(ch.email.hasPassword, true);
  assert.ok(!JSON.stringify(ch).includes('p@ss-secret'), 'password never sent back');
  const t = await api('/channels/email/test', 'POST', { to: 'owner@example.com' }, T);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.match(mails.at(-1), /Subject: Test email/);
  assert.match(mails.at(-1), /From: "?Yoga Studio"? <hello@yoga\.example>/);

  assert.equal((await api('/channels/whatsapp', 'PUT', { phoneNumberId: 'abc', token: 'x' }, T)).status, 400);
  ch = (await api('/channels/whatsapp', 'PUT', { phoneNumberId: '1234567890123', token: 'EAAG-secret-token' }, T)).data;
  assert.equal(ch.whatsapp.configured, true);
  assert.ok(!JSON.stringify(ch).includes('EAAG'), 'token never sent back');
  const w = await api('/channels/whatsapp/test', 'POST', { to: '98765 43210' }, T);
  assert.equal(w.status, 200, JSON.stringify(w.data));
  const last = wa.at(-1);
  assert.equal(last.path, '/1234567890123/messages');
  assert.equal(last.auth, 'Bearer EAAG-secret-token');
  assert.equal(last.body.to, '919876543210', '10-digit Indian numbers get +91');
  assert.equal(last.body.template.name, 'hello_world');
});

test('automation: can’t be switched on while a step is incomplete', async () => {
  const a = (await api('/automations', 'POST', { name: 'Broken', trigger: { type: 'lead' }, steps: [{ type: 'email', subject: '', body: '' }] }, T)).data;
  const r = await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /subject and a message/);
  await api(`/automations/${a.id}`, 'DELETE', null, T);
});

test('automation: new lead → wait → personalised email + WhatsApp template; unsubscribe stops emails', async () => {
  const a = (await api('/automations', 'POST', {
    name: 'Welcome', trigger: { type: 'lead', funnelId: f.id },
    steps: [
      { type: 'wait', amount: 1, unit: 'hours' }, // scaled to 3.6 s → 3.6 ms in tests
      { type: 'email', subject: 'Welcome {{first_name}}!', body: 'Hi {{first_name}}, here is your link: {{funnel_link}}' },
      { type: 'whatsapp', mode: 'template', template: 'welcome_v1', language: 'en', params: '{{first_name}}, {{funnel}}' },
      { type: 'tag', tag: 'welcomed' },
    ],
  }, T)).data;
  assert.equal(a.stopOnPurchase, true, 'lead automations stop when the contact buys by default');
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
  const before = mails.length;
  await api(`/public/${f.slug}/lead`, 'POST', { stepId: f.steps[0].id, email: 'priya@example.com', name: 'Priya Sharma', phone: '9811122233' });
  const run = await until(async () => { const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return d.runs[0]?.status === 'done' && d.runs[0]; });
  assert.ok(run, 'run finished');
  const mail = mails.slice(before).find((m) => m.includes('Welcome Priya!'));
  assert.ok(mail, 'personalised subject');
  assert.match(mail, /Hi Priya, here is your link: http:\/\/app\.example\.test\/f\//);
  assert.match(mail, /List-Unsubscribe: <http:\/\/app\.example\.test\/u\//);
  const msg = wa.find((x) => x.body.template?.name === 'welcome_v1');
  assert.deepEqual(msg.body.template.components[0].parameters.map((p) => p.text), ['Priya', '21-Day Yoga Reset']);
  const c = (await api(`/contacts/${k('priya@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('welcomed'));
  assert.ok(c.timeline.some((t) => t.title === 'Email sent: Welcome Priya!'));
  assert.ok(c.timeline.some((t) => t.title === 'WhatsApp template sent: welcome_v1'));

  // unsubscribe link from the email
  const url = /Unsubscribe: (http:\/\/app\.example\.test\/u\/\S+)/.exec(mail)[1].replace('http://app.example.test', srv.base);
  assert.match(mail, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  // opening the link (a mail scanner does this) only asks; a POST unsubscribes
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Unsubscribe from our emails\?[\s\S]*<form method="post"><button[^>]*>Unsubscribe</);
  assert.equal((await api(`/contacts/${k('priya@example.com')}`, 'GET', null, T)).data.unsubscribed, false, 'a GET never unsubscribes');
  assert.equal((await fetch(url.replace(/\/[0-9a-f]{24}$/, '/000000000000000000000000'), { method: 'POST' })).status, 400, 'forged links refused');
  // RFC 8058 one-click from the email app
  const done = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /unsubscribed/);
  assert.match(await (await fetch(url)).text(), /already unsubscribed/);
  const c2 = (await api(`/contacts/${k('priya@example.com')}`, 'GET', null, T)).data;
  assert.equal(c2.unsubscribed, true);
  assert.ok(c2.timeline.some((t) => t.title === 'Unsubscribed from emails' && /email app/.test(t.text || '')));
  const a2 = (await api('/automations', 'POST', { name: 'Promo', trigger: { type: 'tag', tag: 'promo' }, steps: [{ type: 'email', subject: 'Sale', body: 'Hi' }] }, T)).data;
  await api(`/automations/${a2.id}`, 'PUT', { active: true }, T);
  const n = mails.length;
  await api(`/contacts/${k('priya@example.com')}`, 'PATCH', { tags: ['welcomed', 'promo'] }, T);
  const r2 = await until(async () => (await api(`/automations/${a2.id}`, 'GET', null, T)).data.runs[0]?.status === 'done' && (await api(`/automations/${a2.id}`, 'GET', null, T)).data.runs[0]);
  assert.equal(r2.log.at(-1).detail, 'Contact unsubscribed');
  assert.equal(mails.length, n, 'no email to an unsubscribed contact');
});

test('automation: abandoned checkout reminder stops when the person buys', async () => {
  const a = (await api('/automations', 'POST', {
    name: 'Cart reminder', trigger: { type: 'abandoned', delayMin: 5 },
    steps: [{ type: 'email', subject: 'You left something, {{first_name}}', body: 'Finish here: {{checkout_link}}' }, { type: 'wait', amount: 2, unit: 'days' }, { type: 'email', subject: 'Last chance', body: 'Final reminder' }],
  }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const co = f.steps.find((s) => s.type === 'checkout');
  const before = mails.length;
  await api(`/public/${f.slug}/abandon`, 'POST', { notice: true, stepId: co.id, email: 'rahul@example.com', name: 'Rahul Verma' });
  const first = await until(() => mails.slice(before).find((m) => m.includes('You left something, Rahul')));
  assert.ok(first, 'reminder sent after the delay');
  assert.match(first, new RegExp(`/f/${f.slug}/${co.slug}`), 'link goes straight to checkout');
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'rahul@example.com', name: 'Rahul Verma' });
  const run = await until(async () => { const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return d.runs[0]?.status === 'stopped' && d.runs[0]; }, 6000);
  assert.ok(run, 'stopped after the purchase');
  assert.ok(!mails.slice(before).some((m) => m.includes('Last chance')));
});

test('automation: a store cart left at checkout gets the reminder, with a link that puts the cart back', async () => {
  const p = (await api('/products', 'POST', { name: 'Yoga Mat Guide' }, T)).data;
  assert.equal((await api('/store', 'PUT', { handle: 'yoga-shop', name: 'Yoga Shop', enabled: true }, T)).status, 200);
  const l = (await api('/store/listings', 'POST', { kind: 'product', refId: p.id, price: 299 }, T)).data;
  const a = (await api('/automations', 'POST', { name: 'Store cart reminder', trigger: { type: 'abandoned', delayMin: 5 }, steps: [{ type: 'email', subject: 'Your cart, {{first_name}}', body: '{{product}} for {{amount}} — finish here: {{checkout_link}}' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const before = mails.length;
  await api('/s/yoga-shop/abandon', 'POST', { notice: true, cart: [{ id: l.id, qty: 1 }], email: 'meera@example.com', name: 'Meera Iyer' });
  const m = await until(() => mails.slice(before).find((x) => x.includes('Your cart, Meera')));
  assert.ok(m, 'reminder sent');
  assert.match(m, /Yoga Mat Guide for ₹299/);
  const c = m.match(/\/s\/yoga-shop\/cart\?c=([a-f0-9]+)/);
  assert.ok(c, 'link back to the store cart');
  assert.deepEqual((await api(`/s/yoga-shop/cart/${c[1]}`)).data.cart, [{ id: l.id, qty: 1 }]);
});

test('automation: purchase → stage move + WhatsApp text (24h rule reported, not hidden)', async () => {
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  const won = pipes[0].stages.find((s) => s.won), interested = pipes[0].stages[2];
  const a = (await api('/automations', 'POST', { name: 'After purchase', trigger: { type: 'purchase' }, steps: [{ type: 'stage', pipelineId: pipes[0].id, stageId: interested.id }, { type: 'whatsapp', mode: 'text', text: 'Thanks {{first_name}}! Order of {{amount}} received.' }] }, T)).data;
  assert.equal(a.stopOnPurchase, false, 'after-purchase sequences don’t stop on purchase');
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const co = f.steps.find((s) => s.type === 'checkout');
  await api(`/public/${f.slug}/order`, 'POST', { stepId: co.id, email: 'neha@example.com', name: 'Neha Gupta', phone: '9000000000' });
  const run = await until(async () => { const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return d.runs[0]?.status === 'done' && d.runs[0]; });
  assert.ok(run);
  const c = (await api(`/contacts/${k('neha@example.com')}`, 'GET', null, T)).data;
  assert.equal(c.stages[pipes[0].id], interested.id, 'moved out of the default won stage');
  assert.notEqual(won.id, interested.id);
  assert.equal(run.log.at(-1).result, 'failed', JSON.stringify(run.log));
  assert.match(run.log.at(-1).detail, /24 hours/);
  assert.ok(c.timeline.some((t) => /WhatsApp failed/.test(t.title)), 'failure visible on the timeline');
});

test('automation: stage trigger from the pipeline board; deleting stops active runs', async () => {
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  const lost = pipes[0].stages.find((s) => s.lost);
  const a = (await api('/automations', 'POST', { name: 'Win-back', trigger: { type: 'stage', pipelineId: pipes[0].id, stageId: lost.id }, steps: [{ type: 'wait', amount: 30, unit: 'days' }, { type: 'email', subject: 'We miss you', body: 'Come back' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  await api(`/contacts/${k('neha@example.com')}`, 'PATCH', { stage: { pipelineId: pipes[0].id, stageId: lost.id } }, T);
  const run = await until(async () => (await api(`/automations/${a.id}`, 'GET', null, T)).data.runs[0]);
  assert.equal(run.status, 'active', 'waiting 30 days');
  await api(`/automations/${a.id}`, 'DELETE', null, T);
  assert.equal((await api(`/automations/${a.id}`, 'GET', null, T)).status, 404);
});

const get = (host, path) => new Promise((resolve, reject) => {
  const u = new URL(srv.base);
  http.get({ host: u.hostname, port: u.port, path, headers: { host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', reject);
});

test('custom domains: verify, then the domain serves the funnel', async () => {
  assert.equal((await api('/domains', 'POST', { domain: 'not_a_domain', funnelId: f.id }, T)).status, 400);
  assert.equal((await api('/domains', 'POST', { domain: 'app.example.test', funnelId: f.id }, T)).status, 400, 'the app’s own address');
  const d = (await api('/domains', 'POST', { domain: 'https://Offer.YogaBrand.in/', funnelId: f.id }, T)).data;
  assert.equal(d.domain, 'offer.yogabrand.in');
  assert.equal(d.status, 'pending');
  assert.deepEqual(d.records.map((r) => r.type), ['TXT', 'CNAME']);
  assert.equal(d.records[1].value, 'app.example.test');
  assert.equal((await get('offer.yogabrand.in', '/')).body.includes('__FF_DOMAIN__'), false, 'nothing served before verification');
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=offer.yogabrand.in`)).status, 404);

  const v = (await api(`/domains/${d.id}/verify`, 'POST', null, T)).data;
  assert.equal(v.status, 'active');
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=offer.yogabrand.in`)).status, 200, 'Caddy may issue a certificate');
  const home = await get('offer.yogabrand.in', '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /window\.__FF_DOMAIN__="offer\.yogabrand\.in"/);
  assert.match(home.body, /<link rel="canonical" href="https:\/\/offer\.yogabrand\.in\/">/);
  assert.match(home.body, /Lose belly fat/);
  const co = f.steps.find((s) => s.type === 'checkout');
  assert.match((await get('offer.yogabrand.in', `/${co.slug}`)).body, /<link rel="canonical" href="https:\/\/offer\.yogabrand\.in\/checkout">/);
  const login = await get('offer.yogabrand.in', '/settings/billing');
  assert.equal(login.status, 302, 'app pages are not reachable on a seller domain');
  assert.equal((await get('offer.yogabrand.in', '/api/funnels')).status, 404, 'private API not on seller domains');
  const pubApi = await get('offer.yogabrand.in', `/api/public/${f.slug}`);
  assert.equal(pubApi.status, 200, 'the funnel’s own public API works there');
  // the app's address keeps working, and its canonical link points at the domain
  assert.match((await (await fetch(`${srv.base}/f/${f.slug}`)).text()), /<link rel="canonical" href="https:\/\/offer\.yogabrand\.in"/);

  const other = (await register(api)).token;
  const g = (await api('/funnels', 'POST', { name: 'Theirs' }, other)).data;
  assert.equal((await api('/domains', 'POST', { domain: 'offer.yogabrand.in', funnelId: g.id }, other)).status, 409, 'can’t take a connected domain');
  assert.equal((await api('/domains', 'POST', { domain: 'other.example.in', funnelId: f.id }, other)).status, 400, 'can’t point at someone else’s funnel');

  await api(`/funnels/${f.id}`, 'PUT', { published: false }, T);
  assert.equal((await get('offer.yogabrand.in', '/')).status, 404, 'unpublished → not shown');
  await api(`/funnels/${f.id}`, 'PUT', { published: true }, T);
  await api(`/domains/${d.id}`, 'DELETE', null, T);
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=offer.yogabrand.in`)).status, 404);
});

test('custom domains: apex domains (co.in too) get an A record + www; www redirects; deep links keep their query; one failed check keeps a live domain', async () => {
  const d = (await api('/domains', 'POST', { domain: 'brand.co.in', funnelId: f.id }, T)).data;
  assert.deepEqual(d.records.map((r) => r.type), ['TXT', 'A', 'CNAME'], 'brand.co.in is a whole domain: A record, plus www');
  assert.match(d.records[1].value, /SERVER_IP/, 'says the server IP isn’t configured');
  assert.equal(d.records[2].name, 'www.brand.co.in');
  assert.deepEqual((await api('/domains', 'POST', { domain: 'go.brand.co.in', funnelId: f.id }, T)).data.records.map((r) => r.type), ['TXT', 'CNAME'], 'a subdomain still uses a CNAME');
  assert.equal((await api(`/domains/${d.id}/verify`, 'POST', null, T)).data.status, 'active');

  const deep = await get('brand.co.in', '/no/such/page?utm_source=fb&fbclid=abc');
  assert.equal(deep.status, 302);
  assert.equal(deep.headers.location, '/?utm_source=fb&fbclid=abc', 'UTM / fbclid kept');
  const www = await get('www.brand.co.in', '/checkout?utm_source=ig');
  assert.equal(www.status, 301);
  assert.equal(www.headers.location, 'https://brand.co.in/checkout?utm_source=ig');
  assert.equal((await fetch(`${srv.base}/api/domains/tls-check?domain=www.brand.co.in`)).status, 200, 'www gets a certificate too');
  assert.notEqual((await get('brand.co.in', '/meet/someone')).status, 302, 'booking pages are not bounced to the funnel');

  // DNS stops answering once: the site stays up
  fs.writeFileSync(downFile, 'brand.co.in');
  const v = (await api(`/domains/${d.id}/verify`, 'POST', null, T)).data;
  assert.equal(v.status, 'active', 'one failed lookup never takes a live site down');
  assert.equal(v.failures, 1);
  assert.match(v.error, /stopped pointing/);
  assert.equal((await get('brand.co.in', '/')).status, 200);
  fs.writeFileSync(downFile, '');
  const ok = (await api(`/domains/${d.id}/verify`, 'POST', null, T)).data;
  assert.deepEqual([ok.status, ok.failures, ok.error], ['active', 0, null], 'recovers on the next good check');
  await api(`/domains/${d.id}`, 'DELETE', null, T);
});

test('if / else: branches on tag + purchase, merges back, End step stops; per-step stats', async () => {
  const a = (await api('/automations', 'POST', {
    name: 'Branchy', trigger: { type: 'tag', tag: 'branch-test' },
    steps: [
      { type: 'condition', match: 'all', rules: [{ field: 'bought', op: 'is' }, { field: 'tag', op: 'is', value: 'vip' }], yes: [{ type: 'email', subject: 'VIP buyer {{first_name}}', body: 'yes path' }], no: [
        { type: 'condition', match: 'any', rules: [{ field: 'has', op: 'is', value: 'phone' }], yes: [{ type: 'tag', tag: 'has-phone' }], no: [{ type: 'tag', tag: 'no-phone' }, { type: 'exit' }] },
      ] },
      { type: 'tag', tag: 'after-branch' },
    ],
  }, T)).data;
  assert.equal(a.steps[0].no[0].type, 'condition', 'nested condition kept');
  assert.equal((await api(`/automations/${a.id}`, 'PUT', { active: true }, T)).status, 200);
  const run = async (key, tags) => {
    await api(`/contacts/${k(key)}`, 'PATCH', { tags }, T);
    return until(async () => { const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return d.runs.find((r) => r.key === key && r.status !== 'active'); });
  };
  // neha bought earlier + vip → Yes branch, then continues after the If/else
  const before = mails.length;
  const r1 = await run('neha@example.com', ['vip', 'branch-test']);
  assert.equal(r1.status, 'done');
  assert.ok(mails.slice(before).some((m) => m.includes('VIP buyer Neha')));
  let c = (await api(`/contacts/${k('neha@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('after-branch'), 'branch merged back into the main flow');
  // rahul (bought, not vip, no phone) → No → No → End: never reaches "after-branch"
  const r2 = await run('rahul@example.com', ['branch-test']);
  assert.match(r2.log.at(-1).detail, /End automation/);
  c = (await api(`/contacts/${k('rahul@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('no-phone'));
  assert.ok(!c.tags.includes('after-branch'));
  const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data;
  assert.deepEqual(d.stepStats[d.steps[0].id], { yes: 1, no: 1 });
  // invalid rules block switching on
  const bad = (await api('/automations', 'POST', { name: 'Bad', trigger: { type: 'lead' }, steps: [{ type: 'condition', rules: [], yes: [{ type: 'tag', tag: 'x' }], no: [] }] }, T)).data;
  const r = await api(`/automations/${bad.id}`, 'PUT', { active: true }, T);
  assert.match(r.data.error, /Step 1: add at least one rule/);
});

test('webhook trigger + manual enrolment + test sends', async () => {
  const a = (await api('/automations', 'POST', { name: 'From Zapier', trigger: { type: 'inbound' }, steps: [{ type: 'wait', mode: 'until', time: '10:00' }, { type: 'email', subject: 'Hi {{first_name}}', body: 'Thanks' }] }, T)).data;
  const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data;
  assert.match(d.hookUrl, /\/api\/hooks\/automation\/[0-9a-f]{32}$/);
  const hook = d.hookUrl.replace(/^https?:\/\/[^/]+/, srv.base);
  const post = (body) => fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ email: 'zap@example.com' })).status, 409, 'off → refused');
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  assert.equal((await post({ name: 'x' })).status, 400);
  const ok = await (await post({ email: 'Zap@Example.com', first_name: 'Zara', last_name: 'Khan', phone: '9123456780', tags: ['zapier'] })).json();
  assert.equal(ok.started, true);
  const run = await until(async () => (await api(`/automations/${a.id}`, 'GET', null, T)).data.runs[0]);
  assert.equal(run.status, 'active');
  assert.match(run.log[0].detail, /until 10:00/);
  const wait = run.nextAt - Date.now();
  assert.ok(wait > 0 && wait <= 86400000, 'waits until the next 10:00');
  assert.equal(new Date(run.nextAt + 330 * 60000).toISOString().slice(11, 16), '10:00', '10:00 India time');
  const c = (await api(`/contacts/${k('zap@example.com')}`, 'GET', null, T)).data;
  assert.equal(c.name, 'Zara Khan');
  assert.ok(c.tags.includes('zapier'));
  assert.equal((await fetch(`${srv.base}/api/hooks/automation/${'0'.repeat(32)}`, { method: 'POST' })).status, 404);

  // manual-only automation + enrol from the contact screen
  const m = (await api('/automations', 'POST', { name: 'Manual', trigger: { type: 'manual' }, steps: [{ type: 'tag', tag: 'enrolled' }] }, T)).data;
  await api(`/automations/${m.id}`, 'PUT', { active: true }, T);
  assert.equal((await api(`/automations/${m.id}/enroll`, 'POST', { key: 'zap@example.com' }, T)).status, 200);
  assert.equal((await api(`/automations/${m.id}/enroll`, 'POST', { key: 'zap@example.com' }, T)).status, 409, 'not twice');
  await until(async () => (await api(`/contacts/${k('zap@example.com')}`, 'GET', null, T)).data.tags.includes('enrolled'));

  // "send a test" for an unsaved email step
  const n = mails.length;
  const t = await api(`/automations/${a.id}/test`, 'POST', { step: { type: 'email', subject: 'Preview for {{first_name}}', body: 'Link: {{funnel_link}}' } }, T);
  assert.equal(t.status, 200, JSON.stringify(t.data));
  assert.ok(mails.slice(n).some((x) => x.includes('[Test] Preview for')));
  assert.equal((await api(`/automations/${a.id}/test`, 'POST', { step: { type: 'tag', tag: 'x' } }, T)).status, 400);
});

test('automated email: a mail-server hiccup is retried later, not lost; withdrawn consent stops it', async () => {
  const m = (await api('/automations', 'POST', { name: 'Retry me', trigger: { type: 'manual' }, steps: [{ type: 'email', subject: 'Hello again', body: 'Hi' }] }, T)).data;
  await api(`/automations/${m.id}`, 'PUT', { active: true }, T);
  smtpDown = true;
  try {
    assert.equal((await api(`/automations/${m.id}/enroll`, 'POST', { key: 'zap@example.com' }, T)).status, 200);
    const run = await until(async () => { const r = (await api(`/automations/${m.id}`, 'GET', null, T)).data.runs[0]; return r?.log.some((l) => l.result === 'retrying') && r; });
    assert.equal(run.status, 'active', 'still waiting to send');
    assert.ok(run.nextAt - Date.now() > 8 * 60000, 'tries again in about 10 minutes');
  } finally { smtpDown = false; }
  // a contact who withdrew marketing consent gets no automated email
  await api(`/contacts/${k('zap@example.com')}`, 'PATCH', { optIn: false }, T);
  const n = (await api('/automations', 'POST', { name: 'No consent', trigger: { type: 'manual' }, steps: [{ type: 'email', subject: 'Nope', body: 'Hi' }] }, T)).data;
  await api(`/automations/${n.id}`, 'PUT', { active: true }, T);
  await api(`/automations/${n.id}/enroll`, 'POST', { key: 'zap@example.com' }, T);
  const r2 = await until(async () => { const r = (await api(`/automations/${n.id}`, 'GET', null, T)).data.runs[0]; return r?.status === 'done' && r; });
  assert.match(r2.log.at(-1).detail, /withdrew marketing consent/);
});

test('email tracking: opens & clicks recorded, signed links, If/else on "opened"', async () => {
  const a = (await api('/automations', 'POST', {
    name: 'Tracked', trigger: { type: 'tag', tag: 'track-me' },
    steps: [
      { type: 'email', subject: 'Read me {{first_name}}', body: 'Visit https://example.com/offer?a=1&b=2 now' },
      { type: 'wait', amount: 1, unit: 'hours' }, // 3.6 s in tests
      { type: 'condition', match: 'all', rules: [{ field: 'opened', op: 'is' }], yes: [{ type: 'tag', tag: 'opened-yes' }], no: [{ type: 'tag', tag: 'opened-no' }] },
    ],
  }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const n = mails.length;
  await api(`/contacts/${k('neha@example.com')}`, 'PATCH', { tags: ['track-me'] }, T);
  const mail = await until(() => mails.slice(n).find((m) => m.includes('Read me Neha')));
  const pixel = /\/t\/o\/([a-z0-9]+)\.gif/.exec(mail);
  const click = /href="http:\/\/app\.example\.test(\/t\/c\/[a-z0-9]+\?u=[^"]+)"/.exec(mail);
  assert.ok(pixel && click, 'pixel + tracked link in the HTML');
  assert.match(mail, /Visit https:\/\/example\.com\/offer\?a=1&b=2 now/, 'plain-text part keeps the real link');
  assert.ok(!/\/t\/c\/[^"]+%2Fu%2F/.test(mail), 'unsubscribe link is not tracked');
  const img = await fetch(`${srv.base}/t/o/${pixel[1]}.gif`);
  assert.equal(img.headers.get('content-type'), 'image/gif');
  const path = click[1].replace(/&amp;/g, '&');
  assert.equal((await fetch(`${srv.base}${path.replace(/s=[0-9a-f]+/, 's=0000000000000000')}`, { redirect: 'manual' })).status, 400, 'tampered link refused (no open redirect)');
  const go = await fetch(`${srv.base}${path}`, { redirect: 'manual' });
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://example.com/offer?a=1&b=2');
  const done = await until(async () => { const d = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return d.runs[0]?.status === 'done' && d; }, 8000);
  assert.ok(done, 'run finished');
  const c = (await api(`/contacts/${k('neha@example.com')}`, 'GET', null, T)).data;
  assert.ok(c.tags.includes('opened-yes'), 'If/else saw the open');
  assert.ok(c.timeline.some((t) => t.title === 'Opened email: Read me Neha'));
  assert.ok(c.timeline.some((t) => t.title === 'Clicked a link in: Read me Neha'));
  assert.deepEqual(done.emailResults[done.steps[0].id], { sent: 1, opened: 1, clicked: 1 });
});

test('A/B split, bulk enrolment, bulk tag + stage from the contacts list', async () => {
  const keys = [];
  for (let i = 0; i < 24; i++) keys.push((await api('/contacts', 'POST', { name: `Bulk ${i}`, email: `bulk${i}@example.com` }, T)).data.key);
  const a = (await api('/automations', 'POST', { name: 'Split test', trigger: { type: 'manual' }, steps: [{ type: 'split', percent: 50, a: [{ type: 'tag', tag: 'path-a' }], b: [{ type: 'tag', tag: 'path-b' }] }] }, T)).data;
  assert.equal((await api(`/automations/${a.id}/enroll-bulk`, 'POST', { keys }, T)).status, 400, 'off → refused');
  await api(`/automations/${a.id}`, 'PUT', { active: true }, T);
  const r = (await api(`/automations/${a.id}/enroll-bulk`, 'POST', { keys: [...keys, 'nobody@nowhere.dev'] }, T)).data;
  assert.deepEqual(r, { added: 24, skipped: 1 });
  const d = await until(async () => { const x = (await api(`/automations/${a.id}`, 'GET', null, T)).data; return x.runs.filter((z) => z.status === 'done').length === 24 && x; });
  const res = d.splitResults[d.steps[0].id];
  assert.equal(res.a.n + res.b.n, 24);
  assert.ok(res.a.n > 0 && res.b.n > 0, `both paths used (${res.a.n}/${res.b.n})`);
  const list = (await api('/contacts', 'GET', null, T)).data.filter((c) => keys.includes(c.key));
  assert.ok(list.every((c) => c.tags.includes('path-a') !== c.tags.includes('path-b')), 'each contact took exactly one path');

  // bulk tag → fires a tag-triggered automation; bulk stage move
  const t = (await api('/automations', 'POST', { name: 'On bulk tag', trigger: { type: 'tag', tag: 'webinar' }, steps: [{ type: 'tag', tag: 'got-webinar-flow' }] }, T)).data;
  await api(`/automations/${t.id}`, 'PUT', { active: true }, T);
  const pipes = (await api('/pipelines', 'GET', null, T)).data;
  const stage = pipes[0].stages[1];
  const b = (await api('/contacts/bulk', 'POST', { keys: keys.slice(0, 5), addTag: 'webinar', stage: { pipelineId: pipes[0].id, stageId: stage.id } }, T)).data;
  assert.equal(b.updated, 5);
  await until(async () => (await api(`/contacts/${k(keys[4])}`, 'GET', null, T)).data.tags.includes('got-webinar-flow'));
  const c4 = (await api(`/contacts/${k(keys[4])}`, 'GET', null, T)).data;
  assert.equal(c4.stages[pipes[0].id], stage.id);
  assert.equal((await api('/contacts/bulk', 'POST', { keys: [], addTag: 'x' }, T)).status, 400);
  await api('/contacts/bulk', 'POST', { keys: keys.slice(0, 5), removeTag: 'webinar' }, T);
  assert.ok(!(await api(`/contacts/${k(keys[0])}`, 'GET', null, T)).data.tags.includes('webinar'));
});

test('date trigger: birthday (yearly) and "1 day before" a date', async () => {
  const fields = (await api('/crm/fields', 'PUT', { fields: [{ id: 'bday', label: 'Birthday', type: 'date' }, { id: 'renew', label: 'Renewal', type: 'date' }, { id: 'city', label: 'City', type: 'text' }] }, T)).data;
  assert.equal(fields.length, 3);
  const ist = (d) => new Date(Date.now() + 330 * 60000 + d * 86400000).toISOString().slice(0, 10);
  const today = ist(0), tomorrow = ist(1);
  const bad = (await api('/automations', 'POST', { name: 'x', trigger: { type: 'date', fieldId: 'city' }, steps: [{ type: 'tag', tag: 'x' }] }, T)).data;
  assert.match((await api(`/automations/${bad.id}`, 'PUT', { active: true }, T)).data.error, /isn’t a date field/);
  const bd = (await api('/automations', 'POST', { name: 'Birthday wishes', trigger: { type: 'date', fieldId: 'bday', yearly: true, offsetDays: 0, time: '00:00' }, steps: [{ type: 'tag', tag: 'birthday-wished' }] }, T)).data;
  const rn = (await api('/automations', 'POST', { name: 'Renewal reminder', trigger: { type: 'date', fieldId: 'renew', offsetDays: -1, time: '00:00' }, steps: [{ type: 'tag', tag: 'renewal-reminded' }] }, T)).data;
  await api(`/contacts/${k('bulk1@example.com')}`, 'PATCH', { custom: { bday: `1990-${today.slice(5)}` } }, T);
  await api(`/contacts/${k('bulk2@example.com')}`, 'PATCH', { custom: { bday: `1990-${tomorrow.slice(5)}`, renew: tomorrow } }, T);
  await api(`/automations/${bd.id}`, 'PUT', { active: true }, T);
  await api(`/automations/${rn.id}`, 'PUT', { active: true }, T);
  await until(async () => (await api(`/contacts/${k('bulk1@example.com')}`, 'GET', null, T)).data.tags.includes('birthday-wished'));
  await until(async () => (await api(`/contacts/${k('bulk2@example.com')}`, 'GET', null, T)).data.tags.includes('renewal-reminded'));
  await new Promise((r) => setTimeout(r, 300));
  const c2 = (await api(`/contacts/${k('bulk2@example.com')}`, 'GET', null, T)).data;
  assert.ok(c2.tags.includes('renewal-reminded'), 'renewal tomorrow → reminded today');
  assert.ok(!c2.tags.includes('birthday-wished'), 'birthday tomorrow → not today');
  assert.equal((await api(`/automations/${bd.id}`, 'GET', null, T)).data.runs.length, 1, 'fires once, not every tick');
});

test('automation version history: snapshot per burst of edits, restore', async () => {
  const a = (await api('/automations', 'POST', { name: 'Versioned', trigger: { type: 'lead' }, steps: [{ type: 'tag', tag: 'v1' }] }, T)).data;
  await api(`/automations/${a.id}`, 'PUT', { steps: [{ type: 'tag', tag: 'v2' }] }, T);
  await api(`/automations/${a.id}`, 'PUT', { steps: [{ type: 'tag', tag: 'v3' }] }, T); // same burst → no extra version
  let v = (await api(`/automations/${a.id}/versions`, 'GET', null, T)).data;
  assert.equal(v.length, 1);
  const r = (await api(`/automations/${a.id}/versions/${v[0].id}/restore`, 'POST', null, T)).data;
  assert.equal(r.steps[0].tag, 'v1');
  v = (await api(`/automations/${a.id}/versions`, 'GET', null, T)).data;
  assert.equal(v[0].note, 'Before restoring an earlier version', 'the version you replaced is kept too');
  assert.equal((await api(`/automations/${a.id}/versions/nope/restore`, 'POST', null, T)).status, 404);
});
