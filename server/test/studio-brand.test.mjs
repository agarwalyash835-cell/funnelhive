// Brand kits (studio/brand.js): one per brand or agency client, with locked elements. The default kit is made from what
// memory.js held; a kit's locked call to action, colours and font hold in every Reel and design made with it; the
// director (chat), a team member or an edit can't change or unlock them — only the owner (or their agency) can.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, register, enable2fa } from './helpers.mjs';

const SCRIPT = { title: 'Ghee Reel', lines: ['Pure desi ghee for your family', 'Only ₹499 a litre'], shots: [{ image: 'A jar of ghee on a kitchen counter', motion: 'Slow push-in', seconds: 4 }, { image: 'Ghee poured over hot rice', motion: 'Pour', seconds: 4 }], endCard: { headline: 'Shuddh Ghee', offer: '₹499', cta: 'Buy now' } };
let fake, srv, api, S, sid;
const HIVE = { 'x-hive': '1' };

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/openai/v1/responses')) return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(SCRIPT) }] }] });
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, ADMIN_EMAILS: 'boss@brand.test', APP_URL: 'https://app.brand.test' });
  api = srv.api;
  let ADMIN = (await register(api, 'boss@brand.test')).token;
  const link = srv.log().match(/To: boss@brand\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@brand.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); });

test('the default kit is the brand Studio remembered; memory and the kit stay one', async () => {
  await api('/studio/memory', 'PUT', { brand: { name: 'Shuddh Ghee Co', colours: ['#6B6B47', '#C9A13B'] } }, S);
  const d = (await api('/studio/kits', 'GET', null, S)).data;
  assert.equal(d.kits.length, 1);
  const k = d.kits[0];
  assert.equal(k.isDefault, true);
  assert.equal(k.name, 'Shuddh Ghee Co');
  assert.deepEqual(k.colours, ['#6b6b47', '#c9a13b']);
  assert.equal(d.canLock, true, 'the owner can lock');
  // the old brand endpoint (and the director's tool) is the default kit
  const b = (await api('/studio/brand', 'PUT', { tone: 'warm, no hype', cta: 'Order on WhatsApp' }, S)).data;
  assert.equal(b.tone, 'warm, no hype');
  assert.equal((await api('/studio/memory', 'GET', null, S)).data.brand.name, 'Shuddh Ghee Co');
});

test('locks: the owner locks; the chat and edits can’t change or unlock; a locked call to action holds in a Reel', async () => {
  const k = (await api('/studio/kits', 'GET', null, S)).data.kits[0];
  // nothing to lock yet → refused
  assert.equal((await api(`/studio/kits/${k.id}`, 'PUT', { locks: { legal: true } }, S)).status, 400);
  const locked = await api(`/studio/kits/${k.id}`, 'PUT', { legal: 'T&C apply', locks: { cta: true, colours: true, font: true, legal: true } }, S);
  assert.equal(locked.status, 200, JSON.stringify(locked.data));
  assert.deepEqual(locked.data.kit.locks, { logo: null, colours: 'owner', font: 'owner', cta: 'owner', legal: 'owner' });
  // the director (chat) can't change a locked element, nor unlock it
  const viaChat = await api('/studio/brand', 'PUT', { colours: ['#ff0000'] }, S, HIVE);
  assert.equal(viaChat.status, 409);
  assert.match(viaChat.data.error, /locked/);
  assert.equal((await api(`/studio/kits/${k.id}`, 'PUT', { locks: { cta: false } }, S, HIVE)).status, 400);
  // an unlocked element still changes from the chat
  assert.equal((await api('/studio/brand', 'PUT', { tone: 'calm and homely' }, S, HIVE)).status, 200);
  // the owner can change a locked value in the kit itself
  assert.equal((await api(`/studio/kits/${k.id}`, 'PUT', { cta: 'Order today' }, S)).data.kit.cta, 'Order today');

  // a Reel made with the kit ends on the kit's call to action, whatever was written or saved
  const r = await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', seconds: 15 }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.script.endCard.cta, 'Order today');
  assert.equal(r.data.kit.locks.cta, 'owner');
  const saved = await api(`/studio/reels/${r.data.id}/script`, 'PUT', { script: { ...r.data.script, endCard: { ...r.data.script.endCard, cta: 'Something else' } } }, S);
  assert.equal(saved.data.script.endCard.cta, 'Order today', 'kept as the kit has it');
  // an edit (the canvas or the chat) that breaks a lock is refused with the reason
  const font = await api('/studio/edit', 'POST', { id: r.data.id, target: 'reel', change: { captions: { font: 'Noto Serif' } } }, S);
  assert.equal(font.status, 400);
  assert.match(font.data.error, /brand kit locks/);
  assert.equal((await api('/studio/edit', 'POST', { id: r.data.id, target: 'reel', change: { cardColour: '#ff0000' }, dryRun: true }, S)).status, 400);
  assert.equal((await api('/studio/edit', 'POST', { id: r.data.id, target: 'reel', change: { cardColour: '#6b6b47' }, dryRun: true }, S)).status, 200, 'a brand colour is fine');
});

test('a design made with a kit keeps its locked colours and call to action', async () => {
  const d = await api('/studio/designs', 'POST', { template: 'offer-banner', text: { headline: 'Pure Desi Ghee', price: '₹499', cta: 'Shop' }, bg: 'none', group: 'post' }, S);
  assert.equal(d.status, 201, JSON.stringify(d.data));
  assert.deepEqual(d.data.colours, ['#6b6b47', '#c9a13b'], 'the kit’s colours');
  assert.equal(d.data.slides[0].text.cta, 'Order today', 'the locked call to action');
  assert.equal(d.data.kit.locks.colours, 'owner');
  const other = await api(`/studio/designs/${d.data.id}`, 'PUT', { colours: ['#ff0000', '#00ff00'] }, S);
  assert.equal(other.status, 409);
  // the form sent back as it is (the kit's own colours) is not a change
  const same = await api(`/studio/designs/${d.data.id}`, 'PUT', { colours: ['#6b6b47', '#c9a13b'], slides: [{ i: 0, text: { headline: 'Pure Desi Cow Ghee' } }] }, S);
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.slides[0].text.headline, 'Pure Desi Cow Ghee');
});

test('more kits: one per client, a Reel moved to another kit, the default, removing one', async () => {
  const c = await api('/studio/kits', 'POST', { label: 'Client: Asha Sarees', name: 'Asha Sarees', colours: ['#6e4b5e'], cta: 'Visit the store' }, S);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const kits = (await api('/studio/kits', 'GET', null, S)).data.kits;
  assert.equal(kits.length, 2);
  // the chat can't add kits or change the default
  assert.equal((await api('/studio/kits', 'POST', { label: 'x' }, S, HIVE)).status, 400);
  assert.equal((await api(`/studio/kits/${c.data.kit.id}/default`, 'POST', {}, S, HIVE)).status, 400);
  // a Reel for the client: their brand in the script prompt, their kit on the Reel
  const r = await api('/studio/reels', 'POST', { brief: 'Silk sarees for the wedding season, free delivery', seconds: 15, kitId: c.data.kit.id }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.kit.id, c.data.kit.id);
  assert.equal((await api('/studio/reels', 'POST', { brief: 'Silk sarees for the wedding season, free delivery', kitId: 'kit-nope' }, S)).status, 400);
  // moved back to the default kit: the locked call to action follows
  const moved = await api(`/studio/assets/${r.data.id}/kit`, 'PUT', { kitId: kits[0].id }, S);
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.kit.id, kits[0].id);
  // the default can't be removed; another kit can, once it isn't the default
  assert.equal((await api(`/studio/kits/${kits[0].id}`, 'DELETE', null, S)).status, 400);
  assert.equal((await api(`/studio/kits/${c.data.kit.id}/default`, 'POST', {}, S)).status, 200);
  assert.equal((await api(`/studio/kits/${kits[0].id}`, 'DELETE', null, S)).status, 200);
  const left = (await api('/studio/kits', 'GET', null, S)).data.kits;
  assert.deepEqual(left.map((k) => [k.id, k.isDefault]), [[c.data.kit.id, true]]);
  // another seller never sees them
  const other = (await register(api)).token;
  assert.equal((await api(`/studio/kits/${c.data.kit.id}`, 'PUT', { name: 'x' }, other)).status, 403 /* studio off */);
});
