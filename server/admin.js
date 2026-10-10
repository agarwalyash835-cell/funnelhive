// Admin panel API (platform owners only): business metrics, sellers, plan & price settings,
// invoices, audit log, backups. Every change an admin makes is written to the audit log.
import os from 'node:os';
import { T, q, uid, dbBytes, backupFiles, backupNow, offsiteStatus } from './db.js';
import { platform, savePlatform, platformRzp, isAdmin, encrypt, STATES, GSTIN_RE, DEFAULTS } from './platform.js';
import { decrypt } from './messaging.js';
import { s3Enabled, storageFromEnv, testStorage } from './storage.js';
import { accessFor, newBilling, usageSummary, chargeFor, pricing } from './billing.js';
import { call as rzpCall } from './razorpay.js';
import { deleteAccount } from './account.js';
import { saveIntlSettings, intlSettingsView, platformStripe } from './billing-intl.js';
import { fxRate } from './fx.js';
import { limitsFor, usageFor, saveLimits, LIMIT_DEFAULTS } from './limits.js';
import { clientLimit } from './agency.js';
import { DAY, localDate } from './time.js';

const startedAt = Date.now();
const audit = (req, userId, action, detail = '') => T.audit.insert({ id: uid(), actorId: req.impersonator || req.user.id, actor: req.user.email, userId, action, detail: String(detail).slice(0, 500), at: Date.now() });

export function registerAdmin(app, { auth, wrap, signAs }) {
  const admin = (req, res, next) => (isAdmin(req.user) && !req.impersonator ? next() : res.status(403).json({ error: 'Admins only' }));
  const A = [auth, admin];

  // ---------- overview ----------
  app.get('/api/admin/overview', ...A, (req, res) => {
    const now = Date.now();
    const users = q('SELECT data FROM users').all().map((r) => JSON.parse(r.data));
    const by = { trialing: 0, active: 0, past_due: 0, cancelled: 0, expired: 0, comped: 0, suspended: 0, admin: 0 };
    let mrr = 0, monthly = 0, yearly = 0;
    for (const u of users) {
      const a = accessFor(u, now);
      by[a.status] = (by[a.status] || 0) + 1;
      if (a.ok && u.billing?.subscriptionId && ['active', 'past_due'].includes(u.billing.status) && !u.billing.cancelAtPeriodEnd && (u.billing.currentPeriodEnd || 0) > (u.billing.trialEndsAt || 0)) {
        const amt = (u.billing.amount || chargeFor(u.billing.interval || 'monthly')) * (u.billing.currency ? fxRate(u.billing.currency) : 1); // foreign plans in ₹
        if (String(u.billing.interval).endsWith('yearly')) { yearly++; mrr += amt / 12; } else { monthly++; mrr += amt; }
      }
    }
    const since = (d) => now - d * DAY;
    const signups = Array.from({ length: 30 }, (_, i) => ({ date: localDate(since(29 - i)), n: 0 }));
    for (const u of users) { const i = 29 - Math.floor((now - (u.createdAt || 0)) / DAY); if (signups[i]) signups[i].n++; }
    const revenueMonths = q("SELECT strftime('%Y-%m', at / 1000, 'unixepoch', '+330 minutes') AS m, SUM(json_extract(data, '$.total')) AS total, COUNT(*) AS n FROM invoices WHERE at >= ? GROUP BY m ORDER BY m").all(since(365));
    const sum = (sqlText, ...a) => q(sqlText).get(...a);
    res.json({
      sellers: users.length, by, mrr: Math.round(mrr), arr: Math.round(mrr * 12), paying: { monthly, yearly },
      signups7: users.filter((u) => u.createdAt > since(7)).length, signups30: users.filter((u) => u.createdAt > since(30)).length, signups,
      revenue30: sum('SELECT COALESCE(SUM(json_extract(data, \'$.total\')), 0) AS v FROM invoices WHERE at >= ?', since(30)).v, revenueMonths,
      trialConversion: (() => { const ended = users.filter((u) => u.billing?.trialEndsAt && u.billing.trialEndsAt < now); return ended.length ? Math.round((ended.filter((u) => u.billing.subscriptionId).length / ended.length) * 100) : null; })(),
      platform: {
        funnels: T.funnels.count(), live: sum("SELECT COUNT(*) AS v FROM funnels WHERE json_extract(data, '$.published') = 1").v,
        views30: sum("SELECT COUNT(*) AS v FROM events WHERE at >= ? AND type = 'view'", since(30)).v,
        leads30: sum('SELECT COUNT(*) AS v FROM leads WHERE at >= ?', since(30)).v,
        orders30: sum('SELECT COUNT(*) AS v, COALESCE(SUM(total), 0) AS gmv FROM orders WHERE at >= ?', since(30)),
        aiCredits: sum('SELECT COALESCE(SUM(ai), 0) AS v FROM usage WHERE month = ?', usageSummary({ id: '' }).month).v,
        automations: sum('SELECT COUNT(*) AS v FROM automations WHERE active = 1').v,
      },
      system: {
        uptimeSec: Math.round((now - startedAt) / 1000), processes: Number(process.env.WEB_CONCURRENCY) || 1, dbBytes: dbBytes(), backups: backupFiles().slice(0, 7),
        memoryMb: Math.round(process.memoryUsage().rss / 1e6), loadavg: os.loadavg().map((x) => +x.toFixed(2)), node: process.version,
        paymentsReady: !!(platformRzp() || platformStripe()), paymentsMode: platformRzp()?.mode || platformStripe()?.mode || null,
        payments: [platformRzp() && `Razorpay (${platformRzp().mode})`, platformStripe() && `Stripe (${platformStripe().mode})`].filter(Boolean), emailReady: !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY),
      },
    });
  });

  // ---------- sellers ----------
  const row = (u) => {
    const a = accessFor(u);
    return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt || null, status: a.status, planStatus: u.billing?.status, interval: u.billing?.interval || null, trialEndsAt: u.billing?.trialEndsAt || null, currentPeriodEnd: u.billing?.currentPeriodEnd || null, admin: isAdmin(u), emailVerified: u.emailVerified !== false, business: u.settings?.businessName || '' };
  };
  app.get('/api/admin/users', ...A, (req, res) => {
    const term = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '');
    const page = Math.max(0, Number(req.query.page) || 0), size = 50;
    const where = [], args = [];
    if (term) { where.push("(email LIKE ? OR lower(json_extract(data, '$.name')) LIKE ? OR lower(json_extract(data, '$.settings.businessName')) LIKE ? OR id = ?)"); args.push(`%${term}%`, `%${term}%`, `%${term}%`, term); }
    let list = q(`SELECT data FROM users${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY createdAt DESC`).all(...args).map((r) => row(JSON.parse(r.data)));
    if (status) list = list.filter((u) => u.status === status);
    const counts = Object.fromEntries(q('SELECT userId, COUNT(*) AS n FROM funnels GROUP BY userId').all().map((r) => [r.userId, r.n]));
    res.json({ total: list.length, page, size, users: list.slice(page * size, page * size + size).map((u) => ({ ...u, funnels: counts[u.id] || 0 })) });
  });
  const target = (req, res) => { const u = T.users.get(req.params.uid); if (!u) res.status(404).json({ error: 'Seller not found' }); return u; };
  app.get('/api/admin/users/:uid', ...A, (req, res) => {
    const u = target(req, res);
    if (!u) return;
    const since = Date.now() - 30 * DAY;
    res.json({
      ...row(u), billing: u.billing || null, access: accessFor(u), credits: usageSummary(u), creditLimit: u.creditLimit ?? null, limits: { ...limitsFor(u), agencyClients: clientLimit(u) }, limitOverrides: { ...(u.limits || {}), ...(u.agencyMaxClients ? { agencyClients: u.agencyMaxClients } : {}) }, usage: usageFor(u), twoFactor: !!u.totpEnabled, settings: { businessName: u.settings?.businessName, supportWhatsapp: u.settings?.supportWhatsapp },
      counts: {
        funnels: T.funnels.count({ userId: u.id }), published: q("SELECT COUNT(*) AS n FROM funnels WHERE userId = ? AND json_extract(data, '$.published') = 1").get(u.id).n,
        contacts: T.crm.count({ userId: u.id }), leads: T.leads.count({ userId: u.id }), automations: T.automations.count({ userId: u.id }), domains: T.domains.count({ userId: u.id }),
        orders30: q('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS gmv FROM orders WHERE userId = ? AND at >= ?').get(u.id, since),
        views30: q("SELECT COUNT(*) AS n FROM events WHERE userId = ? AND type = 'view' AND at >= ?").get(u.id, since).n,
      },
      funnels: T.funnels.all({ userId: u.id }, { order: 'updatedAt', desc: true, limit: 20 }).map((f) => ({ id: f.id, name: f.name, slug: f.slug, published: f.published, updatedAt: f.updatedAt })),
      invoices: T.invoices.all({ userId: u.id }, { order: 'at', desc: true }),
      audit: T.audit.all({ userId: u.id }, { order: 'at', desc: true, limit: 30 }),
    });
  });

  app.post('/api/admin/users/:uid/action', ...A, (req, res) => {
    const u = target(req, res);
    if (!u) return;
    const { action } = req.body || {};
    const days = Math.min(365, Math.max(1, Math.round(Number(req.body.days) || 7)));
    const set = (fn) => T.users.update(u.id, (x) => { x.billing ||= newBilling(); fn(x); });
    let detail = '';
    switch (action) {
      case 'extend_trial': set((x) => { const b = x.billing; b.trialEndsAt = Math.max(Date.now(), b.trialEndsAt || 0) + days * DAY; if (!['active', 'past_due', 'comped'].includes(b.status)) b.status = 'trialing'; }); detail = `+${days} days`; break;
      case 'comp': set((x) => { x.billing.prevStatus = x.billing.status; x.billing.status = 'comped'; x.billing.compNote = String(req.body.note || '').slice(0, 200); }); detail = req.body.note || ''; break;
      case 'uncomp': set((x) => { x.billing.status = x.billing.prevStatus && x.billing.prevStatus !== 'comped' ? x.billing.prevStatus : 'trialing'; }); break;
      case 'suspend': if (isAdmin(u)) return res.status(400).json({ error: 'Remove admin access first' }); set((x) => { x.billing.prevStatus = x.billing.status; x.billing.status = 'suspended'; x.billing.suspendReason = String(req.body.note || '').slice(0, 200); x.pv = (x.pv || 0) + 1; }); detail = req.body.note || ''; break;
      case 'unsuspend': set((x) => { x.billing.status = x.billing.prevStatus && x.billing.prevStatus !== 'suspended' ? x.billing.prevStatus : 'trialing'; delete x.billing.suspendReason; }); break;
      case 'set_credits': { const v = req.body.limit === '' || req.body.limit == null ? null : Math.max(0, Math.round(Number(req.body.limit))); if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: 'Enter a number' }); T.users.update(u.id, (x) => { if (v === null) delete x.creditLimit; else x.creditLimit = v; }); detail = v === null ? 'plan default' : String(v); break; }
      case 'set_limits': {
        // per-seller override of the plan's funnel / image-storage limits; empty = plan default
        const o = {};
        for (const k of ['funnels', 'storageMB']) { const v = req.body[k]; if (v === '' || v == null) continue; const n = Math.round(Number(v)); if (!(n >= 0 && n <= 10000000)) return res.status(400).json({ error: 'Enter valid numbers' }); o[k] = n; }
        // an agency's client accounts (empty = what its plan includes)
        const mc = req.body.agencyClients === '' || req.body.agencyClients == null ? null : Math.round(Number(req.body.agencyClients));
        if (mc !== null && !(mc >= 1 && mc <= 10000)) return res.status(400).json({ error: 'Enter a number of client accounts between 1 and 10,000' });
        T.users.update(u.id, (x) => { if (Object.keys(o).length) x.limits = o; else delete x.limits; if (mc) x.agencyMaxClients = mc; else delete x.agencyMaxClients; });
        if (mc) o.agencyClients = mc;
        detail = Object.keys(o).length ? JSON.stringify(o) : 'plan default'; break;
      }
      case 'make_admin': T.users.update(u.id, (x) => { x.role = 'admin'; }); break;
      case 'remove_admin': if (u.id === req.user.id) return res.status(400).json({ error: 'You can’t remove your own admin access' }); T.users.update(u.id, (x) => { delete x.role; }); break;
      case 'verify_email': T.users.update(u.id, (x) => { x.emailVerified = true; }); break;
      case 'reset_2fa': T.users.update(u.id, (x) => { x.totpEnabled = false; delete x.totpSecret; }); break;
      case 'sign_out': T.users.update(u.id, (x) => { x.pv = (x.pv || 0) + 1; }); break;
      case 'impersonate': {
        audit(req, u.id, 'impersonate');
        return res.json({ token: signAs(T.users.get(u.id), req.user.id) });
      }
      case 'delete': {
        if (req.body.confirm !== u.email) return res.status(400).json({ error: 'Type the seller’s email to confirm' });
        if (isAdmin(u)) return res.status(400).json({ error: 'Remove admin access first' });
        audit(req, u.id, 'delete', u.email);
        deleteAccount(u.id);
        return res.json({ ok: true, deleted: true });
      }
      default: return res.status(400).json({ error: 'Unknown action' });
    }
    audit(req, u.id, action, detail);
    res.json({ ok: true });
  });

  // ---------- platform settings ----------
  const settingsView = () => {
    const p = platform(), r = platformRzp();
    const { razorpay, ...rest } = p;
    const st = p.storage;
    return { ...rest, storage: { endpoint: st.endpoint, region: st.region, bucket: st.bucket, key: st.key, publicUrl: st.publicUrl, hasSecret: !!st.secretEnc, fromEnv: storageFromEnv(), ready: s3Enabled(), offsite: offsiteStatus() }, limits: { ...LIMIT_DEFAULTS, ...(p.limits || {}) }, ...intlSettingsView(), prices: pricing(), states: Object.keys(STATES), razorpay: { keyId: razorpay.keyId || (process.env.PLATFORM_RAZORPAY_KEY_ID ? `${process.env.PLATFORM_RAZORPAY_KEY_ID} (from server env)` : ''), hasSecret: !!(razorpay.secretEnc || process.env.PLATFORM_RAZORPAY_KEY_SECRET), hasWebhookSecret: !!(razorpay.webhookSecretEnc || process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET), ready: !!r, mode: r?.mode || null, webhookPath: '/api/billing/webhook' } };
  };
  app.get('/api/admin/settings', ...A, (req, res) => res.json(settingsView()));
  app.put('/api/admin/settings', ...A, wrap(async (req, res) => {
    const b = req.body || {}, changes = [];
    const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null; };
    const patch = {};
    if (b.brand != null) { const v = String(b.brand).trim().slice(0, 40); if (!v) return res.status(400).json({ error: 'Enter a brand name' }); patch.brand = v; }
    for (const k of ['monthly', 'yearly', 'agency_monthly', 'agency_yearly']) if (b.plans?.[k]?.amount != null) { const v = num(b.plans[k].amount, 1, 10000000); if (v == null) return res.status(400).json({ error: `Enter a valid ${k} price` }); (patch.plans ||= { ...platform().plans })[k] = { amount: v }; }
    if (b.agency && typeof b.agency === 'object') { const mc = num(b.agency.maxClients, 1, 10000), tc = num(b.agency.trialClients, 0, 100); if (mc == null || tc == null) return res.status(400).json({ error: 'Enter how many client accounts the Agency plan includes' }); patch.agency = { maxClients: mc, trialClients: tc }; }
    for (const [k, min, max] of [['trialDays', 0, 365], ['gstRate', 0, 28], ['graceDays', 0, 60], ['pagesOfflineAfterDays', 0, 365]]) if (b[k] != null) { const v = num(b[k], min, max); if (v == null) return res.status(400).json({ error: `${k}: enter ${min}–${max}` }); patch[k] = v; }
    if (b.aiCredits) for (const k of ['trial', 'paid']) if (b.aiCredits[k] != null) { const v = num(b.aiCredits[k], 0, 10000000); if (v == null) return res.status(400).json({ error: 'Enter valid AI credit numbers' }); (patch.aiCredits ||= { ...platform().aiCredits })[k] = v; }
    if (b.pricesIncludeGst != null) patch.pricesIncludeGst = !!b.pricesIncludeGst;
    if (b.signupsOpen != null) patch.signupsOpen = !!b.signupsOpen;
    if (b.announcement != null) patch.announcement = String(b.announcement).trim().slice(0, 300);
    if (b.googleClientId != null) { const v = String(b.googleClientId).trim(); if (v && !/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) return res.status(400).json({ error: 'The Google client ID ends with .apps.googleusercontent.com' }); patch.googleClientId = v; }
    if (b.company) {
      const c = { ...platform().company };
      for (const k of ['name', 'address', 'email', 'invoicePrefix']) if (b.company[k] != null) c[k] = String(b.company[k]).trim().slice(0, k === 'address' ? 300 : 120);
      if (b.company.state != null) { if (b.company.state && !STATES[b.company.state]) return res.status(400).json({ error: 'Choose a state' }); c.state = b.company.state; }
      if (b.company.gstin != null) { const g = String(b.company.gstin).trim().toUpperCase(); if (g && !GSTIN_RE.test(g)) return res.status(400).json({ error: 'That GSTIN doesn’t look right' }); c.gstin = g; }
      if (c.gstin && !c.state) return res.status(400).json({ error: 'Choose your company’s state (needed for GST)' });
      c.invoicePrefix = (c.invoicePrefix || 'FH').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10) || 'FH';
      patch.company = c;
    }
    if (b.razorpay) {
      const r = b.razorpay, cur = platform().razorpay;
      const keyId = r.keyId != null ? String(r.keyId).trim() : cur.keyId;
      if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]{8,40}$/.test(keyId)) return res.status(400).json({ error: 'The Key ID looks like rzp_test_… or rzp_live_…' });
      const next = { ...cur, keyId };
      if (r.keySecret) {
        try { await rzpCall({ keyId, secret: String(r.keySecret).trim() }, 'GET', '/plans?count=1'); } catch (e) { return res.status(400).json({ error: e.status === 401 ? 'Razorpay rejected these keys' : `Couldn’t reach Razorpay: ${e.message}` }); }
        next.secretEnc = encrypt(String(r.keySecret).trim());
      } else if (keyId !== cur.keyId) return res.status(400).json({ error: 'Paste the Key Secret for this key' });
      if (r.webhookSecret != null) next.webhookSecretEnc = r.webhookSecret ? encrypt(String(r.webhookSecret).trim()) : '';
      if (r.clear) { next.keyId = ''; next.secretEnc = ''; next.webhookSecretEnc = ''; }
      patch.razorpay = next;
      changes.push('razorpay keys');
    }
    // file storage (Wasabi, S3, R2…): checked with a real write before it's saved
    if (b.storage) {
      const s = b.storage, cur = platform().storage;
      if (s.clear) patch.storage = { ...DEFAULTS.storage };
      else {
        const next = { ...cur };
        for (const k of ['endpoint', 'region', 'bucket', 'key', 'publicUrl']) if (s[k] != null) next[k] = String(s[k]).trim().slice(0, 300);
        next.endpoint = next.endpoint.replace(/\/+$/, ''); next.publicUrl = next.publicUrl.replace(/\/+$/, '');
        if (!/^https:\/\/[\w.-]+(:\d+)?$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(next.endpoint)) return res.status(400).json({ error: 'The endpoint looks like https://s3.ap-southeast-1.wasabisys.com' });
        if (next.publicUrl && !/^https:\/\/\S+$/.test(next.publicUrl)) return res.status(400).json({ error: 'The public URL starts with https://' });
        if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(next.bucket)) return res.status(400).json({ error: 'Enter the bucket name (lowercase letters, numbers, dots and dashes)' });
        if (!next.key) return res.status(400).json({ error: 'Enter the access key' });
        if (!next.region) next.region = (/s3\.([a-z0-9-]+)\.wasabisys\.com/.exec(next.endpoint) || [])[1] || 'auto';
        const secret = s.secret ? String(s.secret).trim() : decrypt(cur.secretEnc);
        if (!secret) return res.status(400).json({ error: 'Enter the secret key' });
        try { await testStorage({ ...next, secret }); } catch (e) { return res.status(400).json({ error: `Couldn’t write to the bucket: ${e.message}` }); }
        if (s.secret) next.secretEnc = encrypt(secret);
        patch.storage = next;
      }
      changes.push('file storage');
    }
    if (b.limits) { try { patch.limits = saveLimits(b.limits); changes.push('limits'); } catch (e) { return res.status(400).json({ error: e.message }); } }
    if (b.stripe || b.intl) { try { await saveIntlSettings(b); changes.push('international billing'); } catch (e) { return res.status(400).json({ error: e.message }); } }
    savePlatform((s) => Object.assign(s, patch));
    audit(req, null, 'settings', [...Object.keys(patch).filter((k) => k !== 'razorpay' && k !== 'storage'), ...changes].join(', '));
    if (patch.storage?.endpoint) backupNow(); // the first off-site copy right away
    res.json(settingsView());
  }));

  // ---------- invoices, audit, backups ----------
  app.get('/api/admin/invoices', ...A, (req, res) => res.json(T.invoices.all({}, { order: 'at', desc: true, limit: 2000 })));
  app.get('/api/admin/invoices/:iid', ...A, (req, res) => { const i = T.invoices.get(req.params.iid); i ? res.json(i) : res.status(404).json({ error: 'Not found' }); });
  app.get('/api/admin/audit', ...A, (req, res) => res.json(T.audit.all({}, { order: 'at', desc: true, limit: 300 })));
  app.post('/api/admin/backup', ...A, wrap(async (req, res) => { const f = await backupNow(); audit(req, null, 'backup'); res.json({ ok: !!f, backups: backupFiles() }); }));
}
