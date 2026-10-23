// Apps through Composio (Meta Ads first; Google Ads when switched on): the platform owner adds one Composio project
// key in Admin; each seller connects their own accounts through Composio's hosted connect page (Google login, or the
// Meta access token typed on Composio's page — it never passes through FunnelHive), and Hive AI runs that seller's
// tools by their own Composio user id. Reading is free to run; anything that changes or spends needs the seller's
// OK in Hive (hive.js → NEEDS_OK) and new campaigns, ad sets and ads are always created paused.
import { platform, savePlatform } from './platform.js';
import { encrypt, decrypt, setChannel } from './messaging.js';
import { T } from './db.js';

const BASE = () => (process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev').replace(/\/$/, '') + '/api/v3.1';
export const APPS = {
  metaads: { name: 'Meta Ads', what: 'Facebook & Instagram ads: campaigns, audiences, results' },
  googleads: { name: 'Google Ads', what: 'Search campaigns, keywords and results' },
};
const keyOf = () => process.env.COMPOSIO_API_KEY || decrypt(platform().composio?.keyEnc || '') || '';
export const composioReady = () => !!keyOf();
export const enabledApps = () => (platform().composio?.apps || ['metaads']).filter((a) => APPS[a]);
const uidOf = (u) => `fh_${u.id}`; // the seller's Composio user id

async function call(method, path, body, key = keyOf()) {
  const r = await fetch(`${BASE()}${path}`, { method, headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d?.error?.message || d?.message || `Composio error ${r.status}`); e.status = r.status; throw e; }
  return d;
}
// checks a project key before it's saved
export async function checkComposioKey(key) {
  try { await call('GET', '/auth_configs?limit=1', null, key); return true; } catch (e) { if (e.status === 401 || e.status === 403) return false; throw e; }
}

// the project's auth config for an app: an enabled one made in the Composio dashboard, else Composio-managed login
// where Composio offers it (Google Ads); Meta Ads has none, so it's made once in the dashboard (API key type)
const configCache = new Map();
async function authConfig(app) {
  const hit = configCache.get(app);
  if (hit && Date.now() - hit.at < 600000) return hit.id;
  const list = (await call('GET', `/auth_configs?toolkit_slug=${app}&limit=50`)).items || [];
  let cfg = list.find((c) => c.status !== 'DISABLED');
  if (!cfg) {
    try { cfg = (await call('POST', '/auth_configs', { toolkit: { slug: app }, auth_config: { type: 'use_composio_managed_auth' } })).auth_config; } catch (e) {
      throw new Error(`${APPS[app].name} isn’t set up in Composio yet — in the Composio dashboard, add an auth config for ${APPS[app].name}${app === 'metaads' ? ' (API key / access token)' : ''}`);
    }
  }
  configCache.set(app, { id: cfg.id, at: Date.now() });
  return cfg.id;
}
export async function connections(u) {
  const items = (await call('GET', `/connected_accounts?user_ids=${encodeURIComponent(uidOf(u))}&limit=50`)).items || [];
  return items.filter((c) => APPS[c.toolkit?.slug]).map((c) => ({ id: c.id, app: c.toolkit.slug, name: APPS[c.toolkit.slug].name, status: c.status, at: c.created_at }));
}
const activeApps = async (u) => new Set((await connections(u)).filter((c) => c.status === 'ACTIVE').map((c) => c.app));

// tools of the seller's connected apps (cached per app for an hour): what Hive can see and run
const toolCache = new Map();
async function toolsOf(app) {
  const hit = toolCache.get(app);
  if (hit && Date.now() - hit.at < 3600000) return hit.list;
  const list = ((await call('GET', `/tools?toolkit_slug=${app}&limit=300`)).items || []).filter((t) => !t.is_deprecated)
    .map((t) => ({ slug: t.slug, name: t.name, description: String(t.description || '').slice(0, 300), input: t.input_parameters || {}, app }));
  toolCache.set(app, { list, at: Date.now() });
  return list;
}
// reading never changes anything; everything else waits for the seller's OK in Hive
export const readOnlyAction = (slug) => /_(GET|LIST|SEARCH|READ|FETCH|FIND)(_|$)/.test(String(slug));
const appOf = (slug) => Object.keys(APPS).find((a) => String(slug).toUpperCase().startsWith(`${a.toUpperCase()}_`));
// new campaigns, ad sets and ads always start paused — turning them on is a separate, confirmed step
function safeArgs(slug, args) {
  const a = { ...(args || {}) };
  if (/^METAADS_CREATE_(CAMPAIGN|AD_SET|AD)$/.test(slug)) a.status = 'PAUSED';
  if (/^GOOGLEADS_MUTATE_(CAMPAIGNS|AD_GROUPS|AD_GROUP_ADS)$/.test(slug)) {
    const ops = Array.isArray(a.operations) ? a.operations : [];
    for (const op of ops) if (op?.create && typeof op.create === 'object') op.create.status = 'PAUSED';
  }
  return a;
}

export function registerComposio(app, { auth, wrap, rateLimit, isTest, appUrl }) {
  const limiter = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 60, key: (req) => req.user.id });
  const ready = (res) => { if (composioReady()) return true; res.status(503).json({ error: 'App connections aren’t switched on yet' }); return false; };
  app.get('/api/integrations', auth, wrap(async (req, res) => {
    const base = { ready: composioReady(), apps: enabledApps().map((a) => ({ app: a, ...APPS[a] })) };
    if (!base.ready) return res.json({ ...base, connections: [] });
    try { res.json({ ...base, connections: await connections(req.user) }); } catch (e) { res.json({ ...base, connections: [], error: e.message }); }
  }));
  // Composio's hosted connect page for one app; the seller comes back to Settings
  app.post('/api/integrations/:app/connect', auth, limiter, wrap(async (req, res) => {
    if (!ready(res)) return;
    const a = req.params.app;
    if (!enabledApps().includes(a)) return res.status(400).json({ error: 'That app isn’t available' });
    try {
      const link = await call('POST', '/connected_accounts/link', { auth_config_id: await authConfig(a), user_id: uidOf(req.user), callback_url: `${process.env.APP_URL || appUrl(req)}/settings?connected=${a}#apps` });
      res.json({ url: link.redirect_url });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  app.delete('/api/integrations/connections/:id', auth, wrap(async (req, res) => {
    if (!ready(res)) return;
    if (!(await connections(req.user)).some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Connection not found' });
    const gone = (await connections(req.user)).find((c) => c.id === req.params.id);
    if (gone?.app === 'metaads') setChannel(req.user.id, 'metaApp', undefined); // no more pixel / spend through it
    await call('DELETE', `/connected_accounts/${encodeURIComponent(req.params.id)}?revoke_on_delete=true`).catch(() => call('DELETE', `/connected_accounts/${encodeURIComponent(req.params.id)}`));
    res.json({ ok: true });
  }));
  // Meta setup: the seller's ad accounts, the pixels of one, and what's picked
  app.get('/api/integrations/meta', auth, limiter, wrap(async (req, res) => {
    if (!ready(res)) return;
    if (!(await activeApps(req.user)).has('metaads')) return res.json({ connected: false, selected: null, accounts: [], pixels: [] });
    const out = { connected: true, selected: metaView(req.user), accounts: [], pixels: [] };
    try {
      out.accounts = await metaAccounts(req.user);
      const acc = String(req.query.account || out.selected?.account || (out.accounts.length === 1 ? out.accounts[0].id : '')).replace(/^act_/, '');
      if (/^\d{5,25}$/.test(acc)) { out.account = acc; out.pixels = await metaPixels(req.user, acc); }
    } catch (e) { out.error = e.message; }
    res.json(out);
  }));
  app.put('/api/integrations/meta', auth, limiter, wrap(async (req, res) => {
    if (!ready(res)) return;
    if (req.body?.clear) { setChannel(req.user.id, 'metaApp', undefined); return res.json({ selected: null }); }
    const account = String(req.body?.account || '').replace(/^act_/, '').trim(), pixel = String(req.body?.pixel || '').trim();
    if (!/^\d{5,25}$/.test(account)) return res.status(400).json({ error: 'Pick an ad account' });
    if (!(await activeApps(req.user)).has('metaads')) return res.status(400).json({ error: 'Connect Meta Ads first' });
    let accounts, pixels;
    try { [accounts, pixels] = await Promise.all([metaAccounts(req.user), metaPixels(req.user, account)]); } catch (e) { return res.status(400).json({ error: e.message }); }
    const a = accounts.find((x) => x.id === account);
    if (!a) return res.status(400).json({ error: 'That ad account isn’t in your Meta connection' });
    const p = pixel ? pixels.find((x) => x.id === pixel) : null;
    if (pixel && !p) return res.status(400).json({ error: 'That pixel isn’t on this ad account' });
    let u = setChannel(req.user.id, 'metaApp', { account, accountName: a.name, pixel: p?.id || '', pixelName: p?.name || '', at: Date.now() });
    // the pixel goes on the pages too, unless another one is already set up there with its own token
    const tr = u.settings?.tracking || {};
    if (p && tr.fbPixel !== p.id && (!tr.fbPixel || !u.channels?.capi?.metaTokenEnc)) u = T.users.update(u.id, (x) => { x.settings = { ...x.settings, tracking: { ...(x.settings?.tracking || {}), fbPixel: p.id } }; });
    import('./adspend.js').then((m) => m.syncMeta(u)).catch(() => {}); // first spend pull in the background
    res.json({ selected: metaView(u), pixelOnPages: u.settings?.tracking?.fbPixel === p?.id });
  }));
  // Hive: the tools of the seller's connected apps, best matches for what it's looking for first
  app.get('/api/integrations/tools', auth, limiter, wrap(async (req, res) => {
    if (!ready(res)) return;
    const on = [...(await activeApps(req.user))].filter((a) => enabledApps().includes(a));
    if (!on.length) return res.json({ connected: [], tools: [] });
    const words = String(req.query.q || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const all = (await Promise.all(on.map(toolsOf))).flat();
    const score = (t) => words.reduce((n, w) => n + (`${t.slug} ${t.name} ${t.description}`.toLowerCase().includes(w) ? 1 : 0), 0);
    const pick = words.length ? all.map((t) => [score(t), t]).filter(([s]) => s > 0).sort((x, y) => y[0] - x[0]).map(([, t]) => t) : all;
    res.json({ connected: on.map((a) => APPS[a].name), tools: pick.slice(0, Number(req.query.limit) || 12).map((t) => ({ slug: t.slug, description: t.description, readOnly: readOnlyAction(t.slug), ...(req.query.schemas === '1' ? { input: t.input } : {}) })) });
  }));
  app.post('/api/integrations/run', auth, limiter, wrap(async (req, res) => {
    if (!ready(res)) return;
    const slug = String(req.body?.slug || '').toUpperCase().slice(0, 80);
    const a = appOf(slug);
    if (!a || !enabledApps().includes(a)) return res.status(400).json({ error: 'That action isn’t available' });
    if (!(await activeApps(req.user)).has(a)) return res.status(400).json({ error: `Connect ${APPS[a].name} first — Settings → Apps & ads` });
    if (!(await toolsOf(a)).some((t) => t.slug === slug)) return res.status(400).json({ error: `Unknown action ${slug}` });
    try {
      const r = await call('POST', `/tools/execute/${slug}`, { user_id: uidOf(req.user), arguments: safeArgs(slug, req.body?.arguments) });
      res.json({ ok: !!r.successful, data: r.data ?? null, error: r.successful ? null : (typeof r.error === 'string' ? r.error : r.error?.message || 'The app returned an error') });
    } catch (e) { res.status(e.status === 429 ? 429 : 400).json({ error: e.message }); }
  }));
}
// ---------- Meta, set up once ----------
// After connecting Meta Ads the seller picks an ad account and a pixel (u.channels.metaApp). That one connection then
// puts the pixel on their pages, sends server-side conversions (tracking.js) and pulls ad spend (adspend.js) — no
// separate Conversions API or Marketing API tokens.
// Runs one action as this seller for a server-side feature; throws when Composio or Meta says no.
export async function runAs(userId, slug, args) {
  const r = await call('POST', `/tools/execute/${slug}`, { user_id: `fh_${userId}`, arguments: args });
  if (!r.successful) throw Object.assign(new Error(String(typeof r.error === 'string' ? r.error : r.error?.message || 'Meta returned an error').slice(0, 300)), { tool: true });
  return r.data || {};
}
export const metaLink = (u) => (composioReady() && u?.channels?.metaApp?.pixel ? u.channels.metaApp : null);
async function metaAccounts(u) {
  const d = await runAs(u.id, 'METAADS_GET_AD_ACCOUNTS', { limit: 100, fields: 'id,account_id,name,currency' });
  return (d.data || []).map((a) => ({ id: String(a.account_id || a.id).replace(/^act_/, ''), name: a.name || '', currency: a.currency || '' }));
}
async function metaPixels(u, account) {
  const d = await runAs(u.id, 'METAADS_LIST_AD_ACCOUNT_PIXELS', { ad_account_id: account, limit: 100, sort_by: 'LAST_FIRED_TIME' });
  return (d.pixels || []).filter((p) => !p.is_unavailable).map((p) => ({ id: String(p.id), name: p.name || '', lastFired: p.last_fired_time || null }));
}
const metaView = (u) => { const m = u.channels?.metaApp; return m ? { account: m.account, accountName: m.accountName || '', pixel: m.pixel || '', pixelName: m.pixelName || '', syncedAt: m.syncedAt || null, error: m.error || '' } : null; };

// Admin → Integrations: the project key (checked, stored encrypted) and which apps sellers may connect
export async function saveComposio(b) {
  const cur = platform().composio || {};
  if (b.clear) { savePlatform((s) => { s.composio = { apps: cur.apps || ['metaads'] }; }); return; }
  const next = { ...cur };
  if (b.key) {
    const key = String(b.key).trim();
    let ok;
    try { ok = await checkComposioKey(key); } catch (e) { throw new Error(`Couldn’t reach Composio: ${e.message}`); }
    if (!ok) throw new Error('Composio didn’t accept that API key');
    next.keyEnc = encrypt(key);
  }
  if (Array.isArray(b.apps)) next.apps = b.apps.filter((a) => APPS[a]);
  savePlatform((s) => { s.composio = next; });
  configCache.clear(); toolCache.clear();
}
export const composioView = () => ({ ready: composioReady(), fromEnv: !!process.env.COMPOSIO_API_KEY, hasKey: !!platform().composio?.keyEnc, apps: enabledApps(), all: Object.entries(APPS).map(([app, v]) => ({ app, ...v })) });
