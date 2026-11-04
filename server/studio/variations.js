// Variations and the learning loop: performance agencies test 5-10 hooks per concept as ads, then double down on the
// one that wins. From a finished Reel:
//   ideas      the AI writes new openings, each in an angle (pain, benefit, social proof, offer first, curiosity) — only
//              the first scene's line and picture change (optionally the first two scenes); the check before spending
//              (preflight.js) scores each one, and each shows what it costs: only the new scene's still, clip and line
//   make       each picked idea becomes its own Reel row (parentId → the original, variant: { angle, hook }) that reuses
//              every other paid part — the other scenes' stills and clips, the other lines' voice, the music — and goes
//              through the usual pipeline (reels.js produce → edit): only the new opening is rendered
//   launch     optional, through the seller's Meta connection: one PAUSED campaign and ad set with one ad per variant,
//              each ad named FH-<reelId> with the tracking URL parameters, so its results come back here. When the
//              connection can't do a step (no video upload action, no Page), the plan is returned to set up by hand
//   results    each variant's ad rows (adtrack.js, by ad name FH-<reelId> or the ad id made at launch): hook rate, CTR,
//              cost per lead, ROAS. With enough data (minimum spend and impressions on at least two) a clear winner is
//              marked and remembered (memory.js: a win and a like; clear losers go to avoid), and "more like the
//              winner" writes new openings in the winning angle
// Nothing here is ever set ACTIVE: turning ads on stays the seller's own step in Ads Manager.
import crypto from 'node:crypto';
import { T, q } from '../db.js';
import { askAI } from '../ai.js';
import { enqueue } from './jobs.js';
import { imageCost, clipCost, PRICES } from './models.js';
import { memoryOf, memoryPrompt, remember, withCharacters } from './memory.js';
import { assessReel } from './preflight.js';
import { LANGUAGES, langBase } from './voice.js';
import { publicUrl } from './media.js';
import { norm } from '../adspend.js';
import { composioReady, toolsOf, runAs, safeArgs } from '../composio.js';

const DAY = 86400000;
// the Ads report, loaded when first needed (adtrack.js's own imports reach back into Studio when it's loaded first)
const adtrack = () => import('../adtrack.js');
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = (t) => { try { return JSON.parse(String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { return null; } };
export const ANGLES = {
  pain: { name: 'Pain', what: 'open on the problem the viewer feels right now' },
  benefit: { name: 'Benefit', what: 'open on the result they get' },
  proof: { name: 'Social proof', what: 'open on other customers — reviews, numbers, a testimonial (only what the brief supports)' },
  offer: { name: 'Offer first', what: 'open on the price or the deal' },
  curiosity: { name: 'Curiosity', what: 'open on a question or a surprising fact that makes them stay' },
};
export const ANGLE_IDS = Object.keys(ANGLES);
// what's enough data to call a winner, and how clear the win must be
export const RULES = { minSpend: 500, minImpressions: 1000, margin: 0.15, loser: 0.5, days: 30 };
export const adName = (r) => `FH-${r.id}`;
const finished = (r) => r?.kind === 'reel' && ['ready', 'needs_review'].includes(r.status) && r.url;
const done = (a) => a && ['ready', 'needs_review'].includes(a.status) && a.url;

// ---------- the family: the original and every variant made from it ----------
export function familyOf(r) {
  const root = r.parentId ? T.studio.get(r.parentId) || r : r;
  const kids = q("SELECT data FROM studio WHERE userId = ? AND json_extract(data, '$.parentId') = ? ORDER BY at").all(root.userId, root.id).map((x) => JSON.parse(x.data)).filter((x) => x.kind === 'reel');
  return { root, members: [root, ...kids] };
}
const angleOf = (r) => r.variant?.angle || 'original';
const hookOf = (r) => r.variant?.hook || r.script?.lines?.[0] || '';

// ---------- what a variant costs: only the new opening (a still — two in a storyline —, a clip and a line) ----------
export function variantCost(r, scenes = 1) {
  const k = Math.min(Math.max(1, scenes), r.shots?.length || 1);
  let c = 0;
  for (let i = 0; i < k; i++) {
    c += imageCost(r.tier, r.imodel) * (r.motion === 'story' ? 2 : 1);
    if (r.motion !== 'photo') c += clipCost(r.tier, r.shots?.[i]?.seconds || r.script?.shots?.[i]?.seconds || 5, r.res, r.vmodel);
    c += PRICES.voiceLine;
  }
  return Math.ceil(c);
}
// a variant can be made from a Reel whose parts are all there (so they're reused, not made again)
export function canVary(r) {
  if (!finished(r)) return 'Make variations from a finished Reel';
  if (!(r.shots || []).every((s) => done(T.studio.get(s.clipId)))) return 'Some of this Reel’s scenes aren’t there any more — make it again first';
  if (!(r.lines || []).every((l) => l.url)) return 'Some of this Reel’s voiceover is missing — make it again first';
  return null;
}

// ---------- ideas: new openings in different angles, each checked and priced ----------
const HOOKS_SYSTEM = `You write hook variations for a short video ad that already exists, the way a performance-marketing agency tests 5-10 openings per concept before putting money behind the winner.
Only the opening changes: the first voiceover line and the first scene's picture (and, when asked, the second scene's line and picture too). Everything after stays exactly as it is, so each new opening must lead naturally into the rest of the ad.
Answer only JSON: {"variants": [{"angle": one of the angle ids given, "hook": the new first voiceover line, "image": a detailed photo prompt for the new first picture (subject, setting, light, camera; the SAME main person, look and clothes as the existing scenes; the real product where it fits; no text, logos or captions in the picture), "motion": what moves in that first shot (camera move, action), "line2": the new second line or empty, "image2": the new second picture prompt or empty}]}
Rules: each hook stops the scroll in under 2 seconds; it is a single short spoken sentence, no longer than the original first line by more than a few words; same language and script as the original lines; never invent prices, offers, numbers, reviews or claims the brief and the script don't give; every variant clearly different from the original and from each other. Never mention AI.`;

const scriptWith = (base, v, k) => {
  const lines = [...base.lines], shots = base.shots.map((s) => ({ ...s }));
  lines[0] = v.hook; shots[0] = { ...shots[0], image: v.image || shots[0].image, end: '', motion: v.motion || shots[0].motion };
  if (k > 1 && shots[1]) { if (v.line2 && lines[1] !== undefined) lines[1] = v.line2; if (v.image2) shots[1] = { ...shots[1], image: v.image2, end: '' }; }
  return { ...base, lines, shots };
};

// → { items: [{ key, angle, hook, image, motion, line2, image2, check, credits }], scenes } kept on the Reel the ideas
// were written from. angles: the ones to try (one idea each, in order, repeated to fill count); seed: a winner to
// write more like
export async function writeIdeas(r, { angles, count, scenes = 1, seed = null, business = '' } = {}) {
  const k = Math.min(2, Math.max(1, Math.round(Number(scenes) || 1)), r.shots.length);
  const want = (Array.isArray(angles) && angles.length ? angles : seed ? [seed.angle] : ANGLE_IDS).filter((a) => ANGLES[a]);
  const n = Math.min(6, Math.max(1, Math.round(Number(count) || Math.max(3, want.length))));
  const plan = Array.from({ length: n }, (_, i) => want[i % want.length] || ANGLE_IDS[i % ANGLE_IDS.length]);
  const fam = familyOf(r).members;
  const losers = fam.filter((m) => m.adVerdict === 'loser').map(hookOf).filter(Boolean);
  const user = `Brief: ${clip(r.prompt, 1500)}
Business: ${business || 'the seller'}
Voiceover language: ${LANGUAGES[langBase(r.lang)] || 'English'}
The ad now: ${JSON.stringify({ title: r.script.title, scenes: r.script.shots.map((s, i) => ({ scene: i + 1, line: r.script.lines[i] || '', image: s.image, motion: s.motion })), endCard: r.script.endCard })}
Change: ${k === 2 ? 'the first TWO scenes (line and picture of each)' : 'the first scene only (its line and picture); leave line2 and image2 empty'}
Write ${n} variants, in this order of angles: ${plan.join(', ')}
Angles: ${plan.filter((a, i) => plan.indexOf(a) === i).map((a) => `${a} — ${ANGLES[a].what}`).join('; ')}
Openings already made (don't repeat them): ${fam.map(hookOf).filter(Boolean).map((h) => `“${h}”`).join('; ')}${seed ? `\nThe opening that WON in real ads: “${seed.hook}” (${ANGLES[seed.angle]?.name || 'its own'} angle${seed.why ? `, ${seed.why}` : ''}). Write new openings in the same angle and spirit — fresh words, not copies.` : ''}${losers.length ? `\nOpenings that lost in real ads (don't write like these): ${losers.map((h) => `“${h}”`).join('; ')}` : ''}${memoryPrompt(memoryOf(r.userId), business)}`;
  const v = parse(await askAI(HOOKS_SYSTEM, user, { json: true, timeoutMs: 90000 }));
  const list = (Array.isArray(v?.variants) ? v.variants : []).slice(0, n).map((x, i) => ({
    key: crypto.randomBytes(4).toString('hex'), angle: ANGLES[x?.angle] ? x.angle : plan[i] || 'benefit',
    hook: clip(x?.hook, 220), image: clip(x?.image, 600), motion: clip(x?.motion, 300),
    line2: k > 1 ? clip(x?.line2, 220) : '', image2: k > 1 ? clip(x?.image2, 600) : '',
  })).filter((x) => x.hook.length >= 3 && x.image.length >= 3);
  if (!list.length) throw new Error('The hooks didn’t come back — please try again');
  // each one checked as the whole ad it would make (free: a text model reads the plan)
  const credits = variantCost(r, k);
  const items = await Promise.all(list.map(async (x) => {
    const a = await assessReel({ brief: r.prompt, script: scriptWith(r.script, x, k), seconds: r.seconds, aspect: r.aspect, motion: r.motion, lang: r.lang });
    return { ...x, check: a ? { quality: a.quality, virality: a.virality, hook: a.hook?.score ?? null, problem: a.hook?.problem || '', verdict: a.verdict } : null, credits };
  }));
  const ideas = { at: Date.now(), scenes: k, seed: seed ? { id: seed.id, angle: seed.angle, hook: seed.hook } : null, items };
  T.studio.update(r.id, (x) => { x.variantIdeas = ideas; });
  return ideas;
}

// ---------- make: each picked idea → its own Reel, reusing every part but the new opening ----------
export function makeVariants(r, keys) {
  const ideas = r.variantIdeas;
  const picks = (ideas?.items || []).filter((x) => (keys || []).includes(x.key));
  if (!picks.length) return { error: 'Pick at least one of the new openings' };
  const why = canVary(r);
  if (why) return { error: why };
  const k = ideas.scenes || 1, root = r.parentId || r.id;
  const made = picks.map((v) => {
    const script = scriptWith(r.script, v, k);
    const title = clip(`${r.script.title} · ${ANGLES[v.angle]?.name || 'Variant'}`, 80);
    const x = enqueue(r.userId, {
      kind: 'reel', status: 'producing', tier: r.tier, vmodel: r.vmodel, imodel: r.imodel, res: r.res, prompt: r.prompt, aspect: r.aspect, seconds: r.seconds, lang: r.lang, voice: r.voice,
      captions: r.captions, sizes: r.sizes, ref: r.ref || null, logo: r.logo || null, brands: r.brands || [], motion: r.motion, dict: r.dict, music: r.music, musicUrl: r.musicUrl || null,
      script: { ...script, title }, approvedAt: Date.now(), parentId: root, madeFrom: r.id, variant: { angle: v.angle, hook: v.hook, key: v.key, scenes: k, check: v.check || null }, credits: v.credits, by: r.by || null,
    });
    // the new opening: a new still (made from the product photo like any shot), its clip and its line; every other
    // scene keeps its still and clip, every other line its recorded voice, and the music is the same file
    const shots = r.shots.map((s, i) => (i < k && (i === 0 || v.image2)
      ? { image: script.shots[i].image, end: '', motion: script.shots[i].motion, seconds: s.seconds, imageId: enqueue(r.userId, { kind: 'image', tier: r.tier, imodel: r.imodel, prompt: withCharacters(r.userId, script.shots[i].image), aspect: r.aspect, ref: r.ref, reelId: x.id, by: r.by }).id, clipId: null }
      : { ...s }));
    const lines = r.lines.map((l, i) => (script.lines[i] !== l.text ? { text: script.lines[i], url: null, tries: 0, check: null } : { ...l }));
    return T.studio.update(x.id, (y) => { y.shots = shots; y.lines = lines; });
  });
  T.studio.update(r.id, (x) => { if (x.variantIdeas) x.variantIdeas.items = x.variantIdeas.items.map((i) => (keys.includes(i.key) ? { ...i, made: made.find((m) => m.variant.key === i.key)?.id } : i)); });
  return { made, credits: made.reduce((t, m) => t + (m.credits || 0), 0) };
}

// ---------- results: each variant's ads, and the winner ----------
const r2 = (n) => Math.round(n * 100) / 100;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
function metricsOf(m, rows) {
  const name = norm(adName(m)), ids = new Set([m.ad?.adId].filter(Boolean));
  const mine = rows.filter((x) => norm(x.ad) === name || (x.adId && ids.has(x.adId)));
  const s = (k) => mine.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const spend = s('spend'), impressions = s('impressions'), clicks = s('linkClicks'), v3 = s('video3s');
  const leads = Math.max(s('leads'), s('metaLeads')), sales = Math.max(s('sales'), s('metaPurchases')), revenue = s('revenue') || s('metaValue');
  return { ads: mine.length, spend, impressions, linkClicks: clicks, leads, sales, revenue, ctr: pct(clicks, impressions), hookRate: pct(v3, impressions), holdRate: pct(s('thruplay'), v3), cpl: leads && spend ? Math.round(spend / leads) : null, roas: spend ? r2(revenue / spend) : null };
}
// the metric that decides: ROAS once there are sales, else cost per lead once there are a few leads, else CTR
export function judge(list, rules = RULES) {
  const live = list.filter((v) => v.m.spend >= rules.minSpend && v.m.impressions >= rules.minImpressions);
  if (live.length < 2) return { decided: false, metric: null, reason: `Each ad needs at least ₹${rules.minSpend} spent and ${rules.minImpressions.toLocaleString('en-IN')} impressions — ${live.length} of ${list.length} ${live.length === 1 ? 'has' : 'have'} that so far` };
  const sales = live.some((v) => v.m.revenue > 0), leads = live.reduce((t, v) => t + v.m.leads, 0);
  const metric = sales ? 'roas' : leads >= 3 ? 'cpl' : 'ctr', lower = metric === 'cpl';
  const val = (v) => (metric === 'cpl' ? (v.m.leads ? v.m.spend / v.m.leads : Infinity) : metric === 'roas' ? v.m.roas || 0 : v.m.ctr || 0);
  const sorted = [...live].sort((a, b) => (lower ? val(a) - val(b) : val(b) - val(a)));
  const [best, next] = sorted, bv = val(best), nv = val(next);
  const clear = lower ? bv < Infinity && bv * (1 + rules.margin) <= nv : bv > 0 && bv >= nv * (1 + rules.margin);
  const label = { roas: 'ROAS', cpl: 'cost per lead', ctr: 'CTR' }[metric];
  const fmt = (x) => (metric === 'cpl' ? (x === Infinity ? 'no leads' : `₹${Math.round(x)}`) : metric === 'roas' ? `${r2(x)}×` : `${x}%`);
  if (!clear) return { decided: false, metric, reason: `Too close to call on ${label} (${fmt(bv)} vs ${fmt(nv)}) — let them run longer` };
  const losers = sorted.slice(1).filter((v) => (lower ? val(v) >= bv * (1 / rules.loser) : val(v) <= bv * rules.loser)).map((v) => v.id);
  return { decided: true, metric, winner: best.id, losers, why: `${label} ${fmt(bv)} vs ${fmt(nv)} for the next best` };
}
// → the per-Reel performance view; a clear winner is marked and remembered once
export async function variantResults(r, { days = RULES.days } = {}) {
  const { root, members } = familyOf(r);
  const rows = (await adtrack()).adReport(root.userId, { from: Date.now() - days * DAY }).rows;
  const list = members.map((m) => ({ id: m.id, m: metricsOf(m, rows) }));
  const verdict = judge(list);
  if (verdict.decided && root.adTest?.winner !== verdict.winner) {
    const w = members.find((m) => m.id === verdict.winner);
    for (const m of members) T.studio.update(m.id, (x) => { x.adVerdict = m.id === verdict.winner ? 'winner' : verdict.losers.includes(m.id) ? 'loser' : null; });
    T.studio.update(root.id, (x) => { x.adTest = { ...(x.adTest || {}), winner: w.id, why: verdict.why, decidedAt: Date.now() }; });
    const name = ANGLES[angleOf(w)]?.name || 'Original';
    remember(root.userId, {
      wins: [{ title: `Won in ads · ${name}`, hook: hookOf(w) }],
      likes: [`${name} hooks like “${clip(hookOf(w), 50)}” (won: ${verdict.why})`],
      ...(verdict.losers.length ? { avoid: verdict.losers.map((id) => `Hooks like “${clip(hookOf(members.find((m) => m.id === id)), 70)}” (lost in ads)`) } : {}),
    });
  }
  const fresh = members.map((m) => T.studio.get(m.id) || m), byId = new Map(list.map((x) => [x.id, x.m]));
  return {
    rootId: root.id, rules: RULES, days, decided: verdict.decided, metric: verdict.metric, reason: verdict.reason || verdict.why, winner: verdict.decided ? verdict.winner : root.adTest?.winner || null,
    launch: root.adTest?.campaignId ? { campaignId: root.adTest.campaignId, adsetId: root.adTest.adsetId, at: root.adTest.launchedAt, status: 'PAUSED' } : null,
    variants: fresh.map((m) => ({ id: m.id, title: m.script?.title || 'Reel', status: m.status, poster: m.poster || null, url: m.url || null, angle: angleOf(m), hook: hookOf(m), adName: adName(m), ad: m.ad || null, original: m.id === root.id, verdict: m.adVerdict || null, metrics: byId.get(m.id), credits: m.credits || null })),
  };
}

// "more like the winner": new openings in the winning angle, written from the winning Reel (its parts are reused)
export function winnerOf(r) {
  const { root, members } = familyOf(r);
  const w = members.find((m) => m.id === root.adTest?.winner);
  return w ? { reel: T.studio.get(w.id) || w, seed: { id: w.id, angle: ANGLES[angleOf(w)] ? angleOf(w) : 'benefit', hook: hookOf(w), why: root.adTest.why } } : null;
}

// ---------- launch: a paused test campaign, one ad per variant ----------
// the plan, with every name and parameter the ads need for their results to come back here
export async function launchPlan(root, members, { link = '', dailyBudget = 500, country = 'IN', text = '' } = {}) {
  const budget = Math.min(100000, Math.max(100, Math.round(Number(dailyBudget) || 500)));
  const card = root.script?.endCard || {};
  return {
    campaign: { name: clip(`FH test · ${root.script?.title || 'Reel'}`, 100), objective: 'OUTCOME_TRAFFIC', status: 'PAUSED' },
    adset: { name: clip(`FH hooks · ${members.length} variants`, 100), dailyBudget: budget, country: /^[A-Z]{2}$/.test(country) ? country : 'IN', optimization: 'LINK_CLICKS', status: 'PAUSED' },
    ads: members.map((m) => ({ reelId: m.id, name: adName(m), angle: angleOf(m), hook: hookOf(m), video: publicUrl(m.outputs?.['9:16'] || m.outputs?.['4:5'] || m.url), thumbnail: m.poster ? publicUrl(m.poster) : null, primaryText: clip(text || [card.headline, card.offer].filter(Boolean).join(' — ') || hookOf(m), 500), headline: clip(card.headline || m.script?.title, 40), cta: 'LEARN_MORE', link, status: 'PAUSED' })),
    urlParams: (await adtrack()).META_URL_PARAMS,
    steps: [
      'Ads Manager → Create → Traffic (or Leads) campaign; keep it OFF while you set it up',
      `One ad set: ₹${budget} a day, your audience — every variant in the same ad set so they compete fairly`,
      'One ad per variant: upload its video, and name the ad exactly as shown (FH-…) — that name is how the results come back to each Reel',
      'In each ad: Tracking → URL parameters → paste the line shown',
      'Switch it on in Ads Manager when you’re ready; check the results here after a few days',
    ],
  };
}
// Meta's actions that the launch needs, found among the connection's tools by name
const PICK = {
  campaign: (s) => s === 'METAADS_CREATE_CAMPAIGN',
  adset: (s) => s === 'METAADS_CREATE_AD_SET',
  video: (s) => /^METAADS_.*VIDEO/.test(s) && /(UPLOAD|CREATE|ADD)/.test(s),
  creative: (s) => /^METAADS_CREATE_AD_?CREATIVE$/.test(s),
  ad: (s) => s === 'METAADS_CREATE_AD',
  pages: (s) => /^METAADS_(GET|LIST)_.*PAGES?$/.test(s),
};
// the argument names an action takes (when it says): each value goes in under the first name it knows
const ALIAS = { ad_account_id: ['account_id', 'act_id', 'ad_account'], campaign_id: ['campaign'], adset_id: ['ad_set_id', 'adset'], file_url: ['video_url', 'url', 'source_url'], creative: ['creative_id'], page_id: ['pageId'] };
function fit(tool, args) {
  const p = Object.keys(tool.input?.properties || {});
  if (!p.length) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) { const name = [k, ...(ALIAS[k] || [])].find((a) => p.includes(a)); if (name) out[name] = v; }
  return out;
}
// the last guard: nothing sent to Meta ever switches anything on
export const neverActive = (args) => { if (/"(ACTIVE|active)"/.test(JSON.stringify(args))) throw new Error('Refusing to switch anything on'); return args; };
const idOf = (d, ...keys) => { for (const k of ['id', ...keys]) { const v = d?.[k] ?? d?.data?.[k]; if (v) return String(v); } return ''; };

// → { launched, plan, created, missing?, reason? } — launched only when every ad was made (all paused)
export async function launchAds(user, root, members, opts = {}) {
  const plan = await launchPlan(root, members, opts);
  const acc = user.channels?.metaApp?.account;
  if (!composioReady() || !acc) return { launched: false, plan, reason: 'Connect Meta Ads (Settings → Apps & ads) and pick an ad account to create the paused campaign from here — or set it up in Ads Manager with this plan' };
  if (!/^https?:\/\//.test(plan.ads[0]?.link || '')) return { launched: false, plan, reason: 'Give the page the ads should send people to (a link starting with https://)' };
  let tools;
  try { tools = await toolsOf('metaads'); } catch (e) { return { launched: false, plan, reason: `Meta couldn’t be reached: ${e.message}` }; }
  const t = Object.fromEntries(Object.entries(PICK).map(([k, f]) => [k, tools.find((x) => f(x.slug))]));
  const missing = ['campaign', 'adset', 'video', 'creative', 'ad'].filter((k) => !t[k]);
  if (missing.length) return { launched: false, plan, missing, reason: `Your Meta connection can’t ${missing.includes('video') ? 'upload a video' : `create the ${missing.join(', ')}`} from here, so nothing was created. Set the test up in Ads Manager with this plan — name each ad exactly as shown and paste the URL parameters, and the results come back to each Reel.` };
  const run = async (tool, args) => runAs(user.id, tool.slug, neverActive(safeArgs(tool.slug, fit(tool, args))));
  // the Facebook Page the ads run from: the one given, else the only one the connection has
  let page = clip(opts.pageId, 40);
  if (!page && t.pages) { try { const d = await run(t.pages, { ad_account_id: acc, fields: 'id,name' }); const list = d.data || d.pages || []; if (list.length === 1) page = String(list[0].id); } catch { /* asked below */ } }
  if (!page) return { launched: false, plan, missing: ['page'], reason: 'Pick the Facebook Page the ads run from (its id), then launch again' };
  const created = { ads: [] };
  try {
    created.campaignId = idOf(await run(t.campaign, { ad_account_id: acc, name: plan.campaign.name, objective: plan.campaign.objective, status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION' }), 'campaign_id');
    if (!created.campaignId) throw new Error('Meta didn’t return the campaign');
    created.adsetId = idOf(await run(t.adset, { ad_account_id: acc, campaign_id: created.campaignId, name: plan.adset.name, daily_budget: plan.adset.dailyBudget * 100, billing_event: 'IMPRESSIONS', optimization_goal: plan.adset.optimization, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: { geo_locations: { countries: [plan.adset.country] }, age_min: 18, age_max: 65 }, status: 'PAUSED' }), 'adset_id');
    if (!created.adsetId) throw new Error('Meta didn’t return the ad set');
    for (const a of plan.ads) {
      const videoId = idOf(await run(t.video, { ad_account_id: acc, file_url: a.video, name: a.name, title: a.name }), 'video_id');
      if (!videoId) throw new Error(`Meta didn’t take the video for ${a.name}`);
      const creativeId = idOf(await run(t.creative, { ad_account_id: acc, name: a.name, object_story_spec: { page_id: page, video_data: { video_id: videoId, ...(a.thumbnail ? { image_url: a.thumbnail } : {}), message: a.primaryText, title: a.headline, call_to_action: { type: a.cta, value: { link: a.link } } } }, url_tags: plan.urlParams }), 'creative_id');
      if (!creativeId) throw new Error(`Meta didn’t make the creative for ${a.name}`);
      const adId = idOf(await run(t.ad, { ad_account_id: acc, adset_id: created.adsetId, name: a.name, creative: { creative_id: creativeId }, status: 'PAUSED' }), 'ad_id');
      created.ads.push({ reelId: a.reelId, name: a.name, adId, videoId, creativeId });
      T.studio.update(a.reelId, (x) => { x.ad = { name: a.name, adId, campaignId: created.campaignId, adsetId: created.adsetId, status: 'PAUSED', at: Date.now() }; });
    }
  } catch (e) {
    return { launched: false, plan, created, reason: `Stopped part-way: ${e.message}. What was made is paused — finish it in Ads Manager with this plan.` };
  } finally {
    if (created.campaignId) T.studio.update(root.id, (x) => { x.adTest = { ...(x.adTest || {}), campaignId: created.campaignId, adsetId: created.adsetId || null, launchedAt: Date.now(), ids: created.ads.map((a) => a.reelId) }; });
  }
  return { launched: true, plan, created, note: 'Everything is PAUSED. Switch the campaign on in Ads Manager when you’re ready.' };
}

// ---------- the API ----------
export function registerVariations(app, { auth, wrap, limiter, scriptLimiter, gate, myReel, reelView }) {
  const ideasView = (r) => ({ ideas: r.variantIdeas || null, angles: ANGLE_IDS.map((id) => ({ id, ...ANGLES[id] })), cost: { perVariant: { 1: variantCost(r, 1), 2: variantCost(r, 2) } }, canVary: canVary(r) });
  // the family with each variant's state, and the ideas waiting to be picked
  app.get('/api/studio/reels/:id/variations', auth, (req, res) => {
    const r = myReel(req, res); if (!r) return;
    res.json({ ...ideasView(r), variants: familyOf(r).members.map(reelView) });
  });
  // new openings (free — only words are written and checked): { angles, count, scenes: 1|2, fromWinner }
  app.post('/api/studio/reels/:id/variations/ideas', auth, scriptLimiter, wrap(async (req, res) => {
    if (!gate(req, res)) return;
    let r = myReel(req, res); if (!r) return;
    const b = req.body || {};
    let seed = null;
    if (b.fromWinner) {
      const w = winnerOf(r);
      if (!w) return res.status(409).json({ error: 'There’s no winner yet — launch the variants as ads and check back once they’ve run' });
      r = w.reel; seed = w.seed;
    }
    const why = canVary(r);
    if (why) return res.status(409).json({ error: why });
    try { await writeIdeas(r, { angles: b.angles, count: b.count, scenes: b.scenes, seed, business: req.user.settings?.businessName || req.user.name }); } catch (e) { return res.status(502).json({ error: e.message }); }
    res.json({ from: r.id, ...ideasView(T.studio.get(r.id)) });
  }));
  // make the picked ones: { keys: [idea keys] } → new Reels (only their new opening costs credits)
  app.post('/api/studio/reels/:id/variations', auth, limiter, (req, res) => {
    if (!gate(req, res)) return;
    const r = myReel(req, res); if (!r) return;
    const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String).slice(0, 6) : [];
    const out = makeVariants(r, keys);
    if (out.error) return res.status(400).json(out);
    res.status(201).json({ variants: out.made.map(reelView), credits: out.credits });
  });
  // the test as ads: { ids?, link, dailyBudget, pageId, country, text, planOnly } — always paused
  app.post('/api/studio/reels/:id/launch', auth, limiter, wrap(async (req, res) => {
    const r = myReel(req, res); if (!r) return;
    const b = req.body || {}, { root, members } = familyOf(r);
    const pick = members.filter((m) => finished(m) && (!Array.isArray(b.ids) || !b.ids.length || b.ids.includes(m.id)));
    if (pick.length < 2) return res.status(400).json({ error: 'A test needs at least two finished versions — make some variations first' });
    const opts = { link: clip(b.link, 500), dailyBudget: b.dailyBudget, pageId: b.pageId, country: b.country, text: b.text };
    if (b.planOnly) return res.json({ launched: false, plan: await launchPlan(root, pick, opts) });
    res.json(await launchAds(req.user, root, pick, opts));
  }));
  // how each version did as an ad; a clear winner is marked and remembered
  app.get('/api/studio/reels/:id/results', auth, wrap(async (req, res) => {
    const r = myReel(req, res); if (!r) return;
    res.json(await variantResults(r, { days: Math.min(90, Math.max(1, Number(req.query.days) || RULES.days)) }));
  }));
}
