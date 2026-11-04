// Hook variations and the learning loop (studio/variations.js) with every outside service faked: a finished Reel gets
// new openings in different angles (written, checked and priced for free); the picked ones are made as their own Reels
// that reuse every paid part but the new opening (no music, no other stills or clips made again); their ad results
// (inserted straight into adspend, as the Meta sync would) pick a winner only with enough data, and the winner goes
// into Studio's memory; "more like the winner" writes from it; the launch is a plan without Meta, and with Meta every
// campaign, ad set and ad is created PAUSED — nothing sent ever says ACTIVE.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { startServer, register, enable2fa } from './helpers.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'variations-test-'));
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const LINES = ['Pure desi ghee for your whole family', 'Only ₹499 for one litre jar', 'Order today on WhatsApp now'];
const SCRIPT = { title: 'Ghee Reel', lines: LINES, shots: [{ image: 'A jar of ghee on a kitchen counter', motion: 'Slow push-in', seconds: 4 }, { image: 'Ghee poured over hot rice', motion: 'Pour in slow motion', seconds: 4 }], endCard: { headline: 'Shuddh Ghee Co', offer: '₹499 / litre', cta: 'Order on WhatsApp' } };
const PLAN_CHECK = { quality: 74, virality: 66, verdict: 'Strong opening.', hook: { score: 81, problem: '', line: '', image: '' }, scenes: [], voice: { score: 80, problem: '' }, endCard: null, music: '' };
const HOOKS = { variants: [
  { angle: 'pain', hook: 'Tired of ghee that smells of nothing?', image: 'A mother frowning at a plain jar of ghee in her kitchen', motion: 'Slow push-in on her face' },
  { angle: 'offer', hook: 'One litre of farm ghee for just ₹499', image: 'A ghee jar with a price tag on a wooden table', motion: 'Camera slides past the jar' },
  { angle: 'curiosity', hook: 'Why does real ghee turn grainy?', image: 'Close-up of grainy golden ghee on a spoon', motion: 'Spoon turns in the light' },
] };
const created = [], hookAsks = [], executed = [];
let tools = 'partial', lastSpoken = ''; // what the stand-in Meta connection offers
let fake, srv, api, ADMIN, S, sid, reelId, ideas, variants = [];

const timed = (text) => { const ws = text.split(' '); return { transcript: text, language_code: 'en-IN', timestamps: { words: ws, start_time_seconds: ws.map((_, i) => i * 0.4), end_time_seconds: ws.map((_, i) => i * 0.4 + 0.35) } }; };
const TOOLS = {
  partial: ['METAADS_CREATE_CAMPAIGN', 'METAADS_CREATE_AD_SET', 'METAADS_CREATE_AD', 'METAADS_GET_INSIGHTS'],
  full: ['METAADS_CREATE_CAMPAIGN', 'METAADS_CREATE_AD_SET', 'METAADS_CREATE_AD_VIDEO', 'METAADS_CREATE_AD', 'METAADS_LIST_PROMOTABLE_PAGES', 'METAADS_GET_INSIGHTS'],
};
before(async () => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=768x1344', '-frames:v', '1', path.join(tmp, 'image.png'));
  for (let n = 4; n <= 10; n++) ff('-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24', '-t', String(n), '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p', path.join(tmp, `clip${n}.mp4`));
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2.8', '-ar', '44100', path.join(tmp, 'line.wav'));
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      // Composio (Meta Ads)
      if (url.pathname.startsWith('/api/v3.1/')) {
        const p = url.pathname.slice(9), body = b ? JSON.parse(b) : null;
        if (p === '/connected_accounts') return send({ items: [{ id: 'ca_1', status: 'ACTIVE', toolkit: { slug: 'metaads' }, user_id: url.searchParams.get('user_ids'), created_at: 'now' }] });
        if (p === '/tools') return send({ items: TOOLS[tools].map((slug) => ({ slug, name: slug, description: slug, input_parameters: {} })) });
        const slug = p.split('/').pop();
        if (slug === 'METAADS_GET_AD_ACCOUNTS') return send({ successful: true, data: { data: [{ account_id: '1111111', name: 'Ghee Ads' }] } });
        if (slug === 'METAADS_LIST_AD_ACCOUNT_PIXELS') return send({ successful: true, data: { pixels: [{ id: '2222222', name: 'Pixel' }] } });
        if (slug === 'METAADS_GET_INSIGHTS') return send({ successful: true, data: { data: [] } });
        if (slug === 'METAADS_LIST_PROMOTABLE_PAGES') return send({ successful: true, data: { promotable_pages: [{ id: '3333', name: 'Shuddh Ghee Co' }], has_more: false } });
        executed.push({ slug, args: body.arguments });
        return send({ successful: true, data: { id: `${slug.toLowerCase()}_${executed.length}` } });
      }
      if (url.pathname.startsWith('/files/')) return res.end(fs.readFileSync(path.join(tmp, url.pathname.slice(7))));
      // each line is heard as it was spoken; the whole voiceover (for the captions) as the script
      if (url.pathname === '/speech-to-text') { const t = lastSpoken || LINES.join(' '); lastSpoken = ''; return send(timed(t)); }
      if (url.pathname === '/text-to-speech') { lastSpoken = JSON.parse(b).text; return send({ audios: [fs.readFileSync(path.join(tmp, 'line.wav')).toString('base64')] }); }
      if (url.pathname === '/openai/v1/responses') {
        const j = JSON.parse(b || '{}');
        if (/hook variations/.test(j.instructions || '')) { hookAsks.push(j.input?.at(-1)?.content || ''); return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(HOOKS) }] }] }); }
        if (/creative director/.test(j.instructions || '')) return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(PLAN_CHECK) }] }] });
        return send({ output: [{ type: 'message', content: [{ text: JSON.stringify(SCRIPT) }] }] });
      }
      if (url.pathname === '/gemini-3-8-flash-openai/v1/chat/completions') {
        if (/senior video ad editor/.test(JSON.parse(b).messages[0].content[0].text)) return send({ choices: [{ message: { content: JSON.stringify({ score: 80, summary: 'Fine.', suggestions: [] }) } }] });
        return send({ choices: [{ message: { content: JSON.stringify({ product_match: 9, text_ok: 9, anatomy_ok: 10, matches_brief: 9, consistency: 9, safe: true, issues: [], fix: '' }) } }] });
      }
      if (url.pathname === '/api/v1/jobs/createTask') { created.push(JSON.parse(b)); return send({ code: 200, data: { taskId: `t${created.length - 1}` } }); }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        const t = created[Number(url.searchParams.get('taskId').slice(1))];
        if (/elevenlabs/.test(t.model)) return send({ code: 200, data: { state: 'fail', failCode: '500', failMsg: 'Internal Error' } });
        if (/ai-music-api/.test(t.model)) return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ data: [{ audio_url: `http://127.0.0.1:${fake.address().port}/files/line.wav`, duration: 30 }] }) } });
        const file = /seedance|kling/.test(t.model) ? `clip${Math.min(10, Math.max(4, t.input.duration || 5))}.mp4` : 'image.png';
        return send({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${fake.address().port}/files/${file}`] }) } });
      }
      res.writeHead(404); res.end('{}');
    });
  }).listen(0);
  await new Promise((r) => setTimeout(r, 30));
  const base = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ KIE_API_KEY: 'kie-test', KIE_BASE_URL: base, SARVAM_API_KEY: 'sarvam-test', SARVAM_BASE_URL: base, COMPOSIO_API_KEY: 'cmp_test', COMPOSIO_BASE_URL: base, ADMIN_EMAILS: 'boss@var.test', APP_URL: 'https://app.var.test' });
  api = srv.api;
  ADMIN = (await register(api, 'boss@var.test')).token;
  const link = srv.log().match(/To: boss@var\.test[\s\S]*?\/verify\?token=([a-f0-9.]+)/);
  await api('/auth/verify', 'POST', { token: link[1] });
  ADMIN = (await enable2fa(api, ADMIN)).token;
  S = (await register(api, 'maker@var.test')).token;
  sid = (await api('/me', 'GET', null, S)).data.id;
  await api('/settings', 'PUT', { businessName: 'Shuddh Ghee Co' }, S);
  await api(`/admin/studio/accounts/${sid}`, 'PUT', { on: true }, ADMIN);
});
after(async () => { await srv?.stop(); fake?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = async (id) => (await api(`/studio/assets/${id}`, 'GET', null, S)).data;
async function until(ids, max = 120) {
  for (let i = 0; i < max; i++) {
    await api('/__test/studio-tick', 'POST', { times: 1 });
    const rs = await Promise.all(ids.map(get));
    if (rs.every((r) => ['ready', 'needs_review', 'failed'].includes(r.status))) return rs;
  }
  throw new Error(`stuck at ${(await Promise.all(ids.map(get))).map((r) => r.status)}`);
}
const kinds = () => ({ images: created.filter((t) => !/seedance|kling|elevenlabs|music/.test(t.model)).length, clips: created.filter((t) => /seedance|kling/.test(t.model)).length, music: created.filter((t) => /music/.test(t.model)).length });
const dbRun = (sql, ...args) => { const db = new DatabaseSync(path.join(srv.dataDir, 'funnelhive.db')); try { db.exec('PRAGMA busy_timeout = 10000'); return db.prepare(sql).run(...args); } finally { db.close(); } };
const ymd = (t) => new Date(t + 330 * 60000).toISOString().slice(0, 10);
const spendRow = (id, adName, m) => { const date = ymd(Date.now() - 2 * 86400000); dbRun('INSERT INTO adspend (id, userId, at, data) VALUES (?, ?, ?, ?)', id, sid, Date.parse(`${date}T00:00:00+05:30`), JSON.stringify({ id, userId: sid, platform: 'meta', date, campaign: 'FH test', key: 'fhtest', spend: m.spend, currency: 'INR', at: Date.parse(`${date}T00:00:00+05:30`), ad: adName, adKey: adName.toLowerCase().replace(/[^a-z0-9]+/g, ''), adId: '', adset: 'Hooks', impressions: m.impressions, reach: m.impressions, clicks: m.linkClicks, linkClicks: m.linkClicks, lpv: 0, metaLeads: 0, metaPurchases: 0, metaValue: 0, chats: 0, video3s: m.video3s, thruplay: Math.round(m.video3s / 3) })); };

test('a finished Reel gets new openings, each checked and priced at only its new scene', async () => {
  const r = await api('/studio/reels', 'POST', { brief: 'Desi ghee from our farm, ₹499 a litre, for families in Pune', lang: 'en', seconds: 15, tier: 'standard', captions: 'pop' }, S);
  reelId = r.data.id;
  // not before it's made
  assert.equal((await api(`/studio/reels/${reelId}/variations/ideas`, 'POST', {}, S)).status, 409);
  await api(`/studio/reels/${reelId}/approve`, 'POST', {}, S);
  const [done] = await until([reelId]);
  assert.equal(done.status, 'ready', JSON.stringify({ status: done.status, error: done.error, issues: done.issues, lines: done.lines }));
  const full = done.cost.credits;
  const x = await api(`/studio/reels/${reelId}/variations/ideas`, 'POST', { angles: ['pain', 'offer', 'curiosity'], count: 3 }, S);
  assert.equal(x.status, 200, JSON.stringify(x.data));
  ideas = x.data.ideas.items;
  assert.deepEqual(ideas.map((i) => i.angle), ['pain', 'offer', 'curiosity']);
  assert.ok(ideas.every((i) => i.check?.hook === 81 && i.check.quality === 74), 'each is scored by the check before spending');
  // one still + one clip + one line, the same for each — a fraction of the whole Reel
  const per = x.data.cost.perVariant[1];
  assert.ok(ideas.every((i) => i.credits === per) && per > 0 && per < full / 2, `${per} vs ${full}`);
  assert.ok(x.data.cost.perVariant[2] > per);
  assert.match(hookAsks[0], /pain, offer, curiosity/);
  assert.match(hookAsks[0], /Pure desi ghee/, 'the AI sees the ad as it is');
});

test('made variants reuse every paid part: only the new opening scene is rendered, the music is the same file', async () => {
  const before = kinds(), parent = await get(reelId);
  const m = await api(`/studio/reels/${reelId}/variations`, 'POST', { keys: [ideas[0].key, ideas[2].key] }, S);
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.equal(m.data.credits, ideas[0].credits * 2);
  variants = m.data.variants;
  assert.deepEqual(variants.map((v) => [v.parentId, v.variant.angle]), [[reelId, 'pain'], [reelId, 'curiosity']]);
  const rs = await until(variants.map((v) => v.id));
  assert.ok(rs.every((v) => v.status === 'ready'), JSON.stringify(rs.map((v) => [v.status, v.error])));
  const after = kinds();
  assert.deepEqual([after.images - before.images, after.clips - before.clips, after.music - before.music], [2, 2, 0], 'one still and one clip per variant, no new music');
  for (const v of rs) {
    assert.equal(v.script.lines[0], v.variant.hook);
    assert.deepEqual(v.script.lines.slice(1), LINES.slice(1));
    assert.equal(v.shots[1].clip.id, parent.shots[1].clip.id, 'the second scene’s clip is the original’s');
    assert.notEqual(v.shots[0].clip.id, parent.shots[0].clip.id);
    assert.equal(v.lines[1].url, parent.lines[1].url, 'the other lines keep their recorded voice');
  }
  const fam = (await api(`/studio/reels/${reelId}/variations`, 'GET', null, S)).data;
  assert.equal(fam.variants.length, 3);
  // unknown keys make nothing
  assert.equal((await api(`/studio/reels/${reelId}/variations`, 'POST', { keys: ['nope'] }, S)).status, 400);
});

test('results per variant: no winner without enough data; a clear winner is marked and remembered, losers avoided', async () => {
  const [a, b] = variants.map((v) => v.id);
  spendRow('sp1', `FH-${reelId}`, { spend: 300, impressions: 4000, linkClicks: 40, video3s: 1000 });
  spendRow('sp2', `FH-${a}`, { spend: 300, impressions: 4000, linkClicks: 100, video3s: 1600 });
  let r = (await api(`/studio/reels/${a}/results`, 'GET', null, S)).data;
  assert.equal(r.decided, false);
  assert.match(r.reason, /₹500/);
  assert.equal(r.variants.find((v) => v.id === a).metrics.spend, 300);
  // more data: the pain hook doubles the original's CTR; curiosity barely gets clicks
  spendRow('sp3', `FH-${reelId}`, { spend: 800, impressions: 8000, linkClicks: 80, video3s: 2000 });
  spendRow('sp4', `FH-${a}`, { spend: 800, impressions: 8000, linkClicks: 200, video3s: 3200 });
  spendRow('sp5', `FH-${b}`, { spend: 1100, impressions: 12000, linkClicks: 30, video3s: 1500 });
  r = (await api(`/studio/reels/${reelId}/results`, 'GET', null, S)).data;
  assert.equal(r.decided, true, r.reason);
  assert.equal(r.metric, 'ctr');
  assert.equal(r.winner, a);
  const w = r.variants.find((v) => v.id === a);
  assert.deepEqual([w.metrics.ctr, w.metrics.hookRate, w.verdict, w.adName], [2.5, 40, 'winner', `FH-${a}`]);
  assert.equal(r.variants.find((v) => v.id === b).verdict, 'loser');
  const mem = (await api('/studio/memory', 'GET', null, S)).data;
  assert.equal(mem.wins[0].hook, HOOKS.variants[0].hook);
  assert.match(mem.wins[0].title, /Won in ads · Pain/);
  assert.ok(mem.likes.some((l) => /Pain hooks/.test(l) && /CTR/.test(l)));
  assert.ok(mem.avoid.some((x) => x.includes(HOOKS.variants[2].hook.slice(0, 30))), JSON.stringify(mem.avoid));
  // asking again doesn't remember it twice
  await api(`/studio/reels/${reelId}/results`, 'GET', null, S);
  assert.equal((await api('/studio/memory', 'GET', null, S)).data.wins.filter((x) => /Won in ads/.test(x.title)).length, 1);
});

test('"more like the winner" writes from the winning variant, in its angle, steering clear of the loser', async () => {
  const x = await api(`/studio/reels/${reelId}/variations/ideas`, 'POST', { fromWinner: true, count: 3 }, S);
  assert.equal(x.status, 200, JSON.stringify(x.data));
  assert.equal(x.data.from, variants[0].id);
  assert.equal(x.data.ideas.seed.angle, 'pain');
  const ask = hookAsks.at(-1);
  assert.match(ask, /WON in real ads: “Tired of ghee/);
  assert.match(ask, /lost in real ads[^\n]*grainy/);
  assert.match(ask, /in this order of angles: pain, pain, pain/);
});

test('launch: a plan without Meta; with a connection that can’t upload video, nothing is created', async () => {
  let l = (await api(`/studio/reels/${reelId}/launch`, 'POST', { link: 'https://ghee.example.in', dailyBudget: 600 }, S)).data;
  assert.equal(l.launched, false);
  assert.match(l.reason, /Connect Meta Ads/);
  assert.deepEqual(l.plan.ads.map((a) => a.name).sort(), [reelId, ...variants.map((v) => v.id)].map((id) => `FH-${id}`).sort());
  assert.match(l.plan.urlParams, /utm_content=\{\{ad\.name\}\}/);
  assert.equal(l.plan.adset.dailyBudget, 600);
  assert.ok([l.plan.campaign, l.plan.adset, ...l.plan.ads].every((x) => x.status === 'PAUSED'));
  const pick = await api('/integrations/meta', 'PUT', { account: '1111111' }, S);
  assert.equal(pick.status, 200, JSON.stringify(pick.data));
  l = (await api(`/studio/reels/${reelId}/launch`, 'POST', { link: 'https://ghee.example.in' }, S)).data;
  assert.equal(l.launched, false);
  assert.ok(l.missing.includes('video'));
  assert.match(l.reason, /can’t upload a video/);
  assert.equal(executed.length, 0, 'nothing created half-way');
});

test('launch with every action: a paused campaign, ad set and one paused ad per version, named for tracking', async () => {
  tools = 'full';
  await api('/admin/settings', 'PUT', { composio: { apps: ['metaads'] } }, ADMIN); // the action list is read again
  const l = (await api(`/studio/reels/${reelId}/launch`, 'POST', { link: 'https://ghee.example.in', dailyBudget: 700 }, S)).data;
  assert.equal(l.launched, true, l.reason);
  assert.equal(l.created.ads.length, 3);
  assert.ok(executed.every((e) => !JSON.stringify(e.args).includes('ACTIVE')), 'nothing is ever switched on');
  for (const e of executed.filter((x) => /^METAADS_CREATE_(CAMPAIGN|AD_SET|AD)$/.test(x.slug))) assert.equal(e.args.status, 'PAUSED', e.slug);
  // shaped as Composio's actions take them: budget in whole rupees, act_ account ids, targeting.locations
  const adset = executed.find((e) => e.slug === 'METAADS_CREATE_AD_SET').args;
  assert.equal(adset.daily_budget, 700, 'rupees, not paise');
  assert.equal(adset.ad_account_id, 'act_1111111');
  assert.deepEqual(adset.targeting.locations, ['IN']);
  assert.equal(executed.find((e) => e.slug === 'METAADS_CREATE_CAMPAIGN').args.ad_account_id, 'act_1111111');
  const ads = executed.filter((e) => e.slug === 'METAADS_CREATE_AD');
  assert.deepEqual(ads.map((e) => e.args.name).sort(), l.plan.ads.map((a) => a.name).sort());
  for (const { args } of ads) {
    assert.equal(args.ad_account_id, 'act_1111111');
    assert.equal(args.creative.type, 'VIDEO');
    assert.equal(args.creative.page_id, '3333');
    assert.ok(args.creative.video_id && args.creative.image_url, 'video plus thumbnail');
    assert.match(args.creative.website_url, /^https:\/\/ghee\.example\.in\?utm_source=facebook&.*ad_id=\{\{ad\.id\}\}/, 'the tracking parameters ride on the link');
  }
  assert.ok(!executed.some((e) => e.slug === 'METAADS_CREATE_AD_CREATIVE'), 'no separate creative step');
  assert.match(executed.find((e) => e.slug === 'METAADS_CREATE_AD_VIDEO').args.file_url, /^https:\/\/app\.var\.test\/uploads\//);
  const v = (await api(`/studio/reels/${variants[0].id}/results`, 'GET', null, S)).data;
  assert.equal(v.launch.status, 'PAUSED');
  assert.ok(v.variants.every((x) => x.ad?.status === 'PAUSED' && x.ad.adId));
});
