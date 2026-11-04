// The seller's cast and brand kit (studio/cast.js): cast once, like an agency. A character's reference sheet is paid,
// so it's only made with its price confirmed; the front portrait comes first and the other two are made from it. Then a
// Reel that names them (or is cast with them) gets their pictures as image references in every still they appear in —
// after the product photo, never more than the image model takes — and the script writer is told who they are.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, register, enable2fa } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-test-'));
const PASS = { product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' };
const SCRIPT = { title: 'Ghee with Asha', lines: ['Asha makes rotis for her family every morning', 'Only ₹499 a litre'], shots: [{ image: 'Asha spreading ghee on a hot roti in a sunny kitchen', motion: 'Slow push-in', seconds: 4 }, { image: 'A jar of ghee on a wooden table, close up', motion: 'Orbit', seconds: 4 }], endCard: { headline: 'Shuddh Ghee', offer: '₹499', cta: 'Order now' } };
const created = [], prompts = [];
let next = SCRIPT, fake, srv, api, ADMIN, S, S2, png;

before(async () => {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=512x640', '-frames:v', '1', path.join(tmp, 'image.png')]);
  png = `data:image/png;base64,${fs.readFileSync(path.join(tmp, 'image.png')).toString('base64')}`;
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      if (url.pathname === '/openai/v1/responses') { prompts.push(JSON.stringify(JSON.parse(b))); return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(next) }] }] }); }
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') return send({ choices: [{ message: { content: JSON.stringify(PASS) } }] });
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/image.png`] }) } });
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: `http://127.0.0.1:${fake.address().port}`, ADMIN_EMAILS: 'boss@cast.test', APP_URL: 'https://app.cast.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@cast.test')).token;
  const link = srv.log().match(/To: boss@cast\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@cast.test')).token;
  S2 = (await register(api, 'other@cast.test')).token;
  for (const t of [S, S2]) await api(`/admin/studio/accounts/${(await api('/me', 'GET', null, t)).data.id}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const upload = async (t = S) => { const r = await api('/uploads', 'POST', { type: 'image/png', data: png }, t); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.url; };
const tick = (times = 1) => api('/__test/studio-tick', 'POST', { times });
const cast = async (t = S) => (await api('/studio/cast', 'GET', null, t)).data;
const tail = (u) => String(u).replace(/^https?:\/\/[^/]+/, '');
const stillsSince = (n) => created.slice(n).filter((c) => /nano-banana|gpt-image|seedream/.test(c.model));
let asha;

test('the cast: add from a description or from photos, change, keep it to the seller, delete', async () => {
  assert.equal((await api('/studio/cast', 'POST', { name: 'A', look: 'x' }, S)).status, 400, 'a name and a look (or photos) are needed');
  const theirs = await upload(S2);
  assert.equal((await api('/studio/cast', 'POST', { name: 'Ravi', photos: [theirs] }, S)).status, 400, 'only their own photos');
  const r = await api('/studio/cast', 'POST', { name: 'Asha', look: 'Woman in her early 30s, round face, wavy shoulder-length black hair', outfit: 'a mustard cotton kurta' }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  asha = r.data;
  assert.equal(asha.sheet.status, 'none');
  assert.deepEqual(asha.refs, []);
  assert.equal((await api('/studio/cast', 'POST', { name: 'asha', look: 'someone else entirely' }, S)).status, 400, 'names are unique');
  const ravi = (await api('/studio/cast', 'POST', { name: 'Ravi', photos: [await upload(), await upload()] }, S)).data;
  assert.equal(ravi.refs.length, 2, 'their own photos are their reference pictures');
  assert.equal((await api(`/studio/cast/${ravi.id}`, 'PUT', { outfit: 'white shirt' }, S)).data.outfit, 'white shirt');
  assert.equal((await api(`/studio/cast/${ravi.id}`, 'GET', null, S2)).status, 404);
  assert.equal((await cast(S2)).characters.length, 0);
  assert.deepEqual((await cast()).characters.map((c) => c.name), ['Asha', 'Ravi']);
  assert.equal((await api(`/studio/cast/${ravi.id}`, 'DELETE', null, S2)).status, 404);
  assert.equal((await api(`/studio/cast/${ravi.id}`, 'DELETE', null, S)).status, 200);
  assert.deepEqual((await cast()).characters.map((c) => c.name), ['Asha']);
});

test('the reference sheet costs credits: shown first, made only with that price confirmed; the front portrait first, the others from it', async () => {
  const e = (await api(`/studio/cast/${asha.id}/sheet-estimate`, 'POST', { tier: 'standard' }, S)).data;
  const perImage = (await api('/studio/estimate', 'POST', { kind: 'image', tier: 'standard' }, S)).data.credits;
  assert.deepEqual([e.images, e.perImage, e.credits], [3, perImage, 3 * perImage]);
  assert.equal((await cast()).sheet.credits.standard, e.credits);
  const n = created.length;
  let r = await api(`/studio/cast/${asha.id}/sheet`, 'POST', { tier: 'standard' }, S);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'CONFIRM');
  assert.equal(r.data.credits, e.credits);
  assert.equal((await api(`/studio/cast/${asha.id}/sheet`, 'POST', { tier: 'standard', confirm: e.credits - 1 }, S)).status, 409, 'a different price is no confirmation');
  await tick(2);
  assert.equal(created.length, n, 'nothing made without the confirmation');
  r = await api(`/studio/cast/${asha.id}/sheet`, 'POST', { tier: 'standard', confirm: e.credits }, S);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.sheet.status, 'making');
  assert.equal((await api(`/studio/cast/${asha.id}/sheet`, 'POST', { tier: 'standard', confirm: e.credits }, S)).status, 409, 'not twice at once');
  for (let k = 0; k < 30 && (await cast()).characters[0].sheet.status !== 'ready'; k++) await tick();
  const c = (await cast()).characters[0];
  assert.equal(c.sheet.status, 'ready', JSON.stringify(c.sheet));
  assert.equal(c.refs.length, 3);
  const made = stillsSince(n);
  assert.equal(made.length, 3, 'three pictures');
  assert.match(made[0].input.prompt, /Asha[\s\S]*mustard cotton kurta[\s\S]*Front-facing/);
  assert.ok(!made[0].input.image_input, 'the front portrait from the words alone');
  const front = c.sheet.parts.find((p) => p.part === 'front').url;
  for (const m of made.slice(1)) assert.deepEqual(m.input.image_input.map(tail), [tail(front)], 'the three-quarter and full body are made from the front portrait');
  assert.equal(made[2].input.aspect_ratio, '9:16');
  // a cast's pictures aren't in the gallery
  const gallery = (await api('/studio', 'GET', null, S)).data.assets;
  assert.ok(!gallery.some((a) => c.sheet.parts.some((p) => p.id === a.id)));
});

test('the brand kit: colours and logo in memory, a font from the bundled ones, tone and product photos', async () => {
  assert.equal((await api('/studio/brand', 'PUT', { font: 'comic-sans' }, S)).status, 400);
  assert.equal((await api('/studio/brand', 'PUT', { products: [await upload(S2)] }, S)).status, 400);
  const product = await upload();
  const r = await api('/studio/brand', 'PUT', { name: 'Shuddh Ghee Co', colours: ['#C2410C', 'nope'], font: 'noto-sans-devanagari', tone: 'Warm, homely, no hype', products: [product] }, S);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.font, 'noto-sans-devanagari');
  assert.ok(r.data.fonts.some((f) => f.id === 'noto-sans-devanagari' && f.devanagari));
  assert.deepEqual(r.data.products, [product]);
  const m = (await api('/studio/memory', 'GET', null, S)).data;
  assert.deepEqual(m.brand.colours, ['#c2410c']);
  assert.equal(m.brand.name, 'Shuddh Ghee Co');
  assert.equal((await api('/studio/brand', 'GET', null, S2)).data.tone, '');
});

test('a Reel cast with Asha: the script writer knows her, and every still she is in gets her pictures after the product photo', async () => {
  const product = (await api('/studio/brand', 'GET', null, S)).data.products[0];
  const r = await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families', lang: 'en', seconds: 15, tier: 'standard', characters: ['Asha'] }, S);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.cast, [asha.id]);
  const asked = prompts.at(-1);
  assert.match(asked, /Their cast[^"]*Asha — Woman in her early 30s/);
  assert.match(asked, /Cast this ad with: Asha/);
  assert.match(asked, /tone of voice: Warm, homely/);
  assert.equal((await api(`/studio/reels/${r.data.id}/cast`, 'PUT', { characters: ['Nobody'] }, S)).status, 400);
  assert.deepEqual((await api(`/studio/reels/${r.data.id}/cast`, 'PUT', { characters: [asha.id] }, S)).data.cast, [asha.id]);
  const n = created.length;
  assert.equal((await api(`/studio/reels/${r.data.id}/approve`, 'POST', { motion: 'photo' }, S)).status, 200);
  await tick(1);
  const [withAsha, productOnly] = stillsSince(n);
  const sheet = (await cast()).characters[0].refs.map(tail);
  // no product photo on the Reel: the brand kit's first one goes first, then her three pictures
  assert.deepEqual(withAsha.input.image_input.map(tail), [tail(product), ...sheet]);
  assert.match(withAsha.input.prompt, /Reference pictures: picture 1 is the product; pictures 2, 3, 4 are Asha/);
  assert.match(withAsha.input.prompt, /mustard cotton kurta/);
  assert.match(withAsha.input.prompt, /Keep every person exactly as in their reference pictures/);
  assert.deepEqual(productOnly.input.image_input.map(tail), [tail(product)], 'a scene without her: the product only');
  assert.equal((await api(`/studio/reels/${r.data.id}/cast`, 'PUT', { characters: [] }, S)).status, 409, 'not once it’s being made');
});

test('limits: many people in one scene never go past what the image model takes, and every person gets their best picture first', async () => {
  const names = ['Meera', 'Kabir', 'Tara', 'Dev'];
  for (const name of names) assert.equal((await api('/studio/cast', 'POST', { name, photos: [await upload(), await upload(), await upload()] }, S)).status, 201);
  next = { ...SCRIPT, lines: ['The whole family loves it'], shots: [{ image: 'Asha, Meera, Kabir, Tara and Dev laughing at the dinner table', motion: 'Pan', seconds: 4 }] };
  const ids = Object.fromEntries((await cast()).characters.map((c) => [c.name, c.refs.map(tail)]));
  for (const [tier, imodel, limit] of [['standard', undefined, 10], ['cinematic', 'nano-banana-pro', 8], ['quick', 'ideogram-3', 10]]) {
    const r = (await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families', lang: 'en', seconds: 15, tier, imodel }, S)).data;
    const n = created.length;
    await api(`/studio/reels/${r.id}/approve`, 'POST', { motion: 'photo' }, S);
    await tick(1);
    const [still] = stillsSince(n);
    assert.ok(still, `${tier}: a still was made`);
    if (imodel === 'ideogram-3') assert.equal(still.model, 'nano-banana-2-1', 'a model that takes no references hands the still to one that does');
    const refs = (still.input.image_input || still.input.input_urls).map(tail);
    assert.equal(refs.length, limit, `${tier}: ${refs.length} references`);
    // the product, then each person's best picture before anyone's second
    for (const name of ['Asha', ...names]) assert.ok(refs.slice(1, 6).includes(ids[name][0]), `${name}’s first picture is in`);
  }
  next = SCRIPT;
});

test('a clip from words alone, cast with Asha, gets her pictures as references; one from a still keeps its first frame only', async () => {
  let n = created.length;
  const a = await api('/studio/clips', 'POST', { prompt: 'Asha smiles and holds up the jar', tier: 'standard', characters: ['Asha'], seconds: 5 }, S);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  await tick(1);
  const [c] = created.slice(n);
  assert.match(c.model, /seedance/);
  assert.equal(c.input.reference_image_urls.length, 3);
  assert.ok(!c.input.first_frame_url);
  n = created.length;
  const img = (await api('/studio', 'GET', null, S)).data.assets.find((x) => x.kind === 'image' && x.url);
  const b = await api('/studio/clips', 'POST', { prompt: 'Slow push-in', tier: 'standard', characters: ['Asha'], sourceId: img?.id, seconds: 5 }, S);
  if (img) {
    assert.equal(b.status, 201);
    await tick(1);
    const [d] = created.slice(n);
    assert.ok(d.input.first_frame_url && !d.input.reference_image_urls, 'frames and references are never combined');
  }
});

test('Hive: the cast, a new person, the brand kit; the sheet waits for an OK that states its credits', async () => {
  const tok = (await api('/hive/tokens', 'POST', { name: 'test' }, S)).data.token;
  const mcp = async (name, args) => {
    const r = await (await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
    const text = r.result?.content?.[0]?.text || '';
    return r.result?.isError ? { error: text } : JSON.parse(text);
  };
  const list = await mcp('studio_cast', {});
  assert.ok(list.cast.some((c) => c.name === 'Asha' && c.sheet === 'ready'), JSON.stringify(list));
  assert.ok(!JSON.stringify(list).match(/kie|nano-banana|seedance/i), 'no vendor or model');
  const added = await mcp('studio_cast_add', { name: 'Nisha', look: 'Teenage girl, two braids, school uniform' });
  assert.equal(added.person.name, 'Nisha', JSON.stringify(added));
  const kit = await mcp('studio_brand_kit', { tone: 'Cheerful and simple' });
  assert.equal(kit.brand.tone, 'Cheerful and simple');
  const n = created.length;
  const sheet = await mcp('studio_cast_sheet', { id: 'Nisha', tier: 'quick' });
  if (sheet.error) assert.match(sheet.error, /credits/, 'MCP asks for an OK that names the price');
  else assert.ok(sheet.credits > 0);
  await tick(1);
  assert.ok(created.length >= n);
});
