// Tally (TallyPrime) for sellers who have the add-on (Admin → Sellers → Tally): manufacturers, retailers, traders.
// Ported from AI Hive's Tally mini-app. TallyPrime never leaves the seller's Windows PC: the FunnelHive Tally Connector
// (tally-connector/) polls us over HTTPS, uploads a mirror of the companies open in Tally (ledgers, vouchers with
// their lines / bills / stock lines, outstanding bills, units, godowns, stock items) and runs the writes queued here
// (a ledger, a voucher, a stock transfer…) through Tally's own XML import.
//   /api/v1/agent/tally/*  the connector, with its own token (never a seller session). Same paths, bodies and replies
//                          as AI Hive, so one connector code base runs against both.
//   /api/tally/*           the seller: reads from the mirror; writes become commands the connector picks up.
// Connecting a PC: the seller copies a one-time code (Tally → Connect a PC) into the connector, which trades it for a token.
// The installer is served from DATA_DIR/downloads (copied there on deploy) unless an admin set another link.
// Synced records keep Tally's own snake_case fields; our keys (userId, companyId, active, syncedAt…) are camelCase.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { T, q, tx, uid, JOBS, dir } from './db.js';
import { platform } from './platform.js';

export const tallyOn = (u) => !!u?.addons?.tally;
const DAY = 86400000;
const clip = (v, n = 500) => (v == null ? '' : String(v).trim().slice(0, n));
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const lname = (v) => String(v ?? '').trim().toLowerCase();

// ---------- settings the connector follows (platform 'tally' overrides; heartbeat replies carry them live) ----------
const DEFAULTS = { heartbeat_timeout_seconds: 30, command_polling_seconds: 5, sync_interval_minutes: 5, live_sync_enabled: true, live_sync_probe_seconds: 5, live_sync_incremental_seconds: 5, full_reconcile_interval_minutes: 360, minimum_agent_version: '1.0.0', force_update_agent_version: false, download_url: '' };
export const tallySettings = () => ({ ...DEFAULTS, ...(platform().tally || {}) });
const intervals = (s = tallySettings()) => ({
  poll_interval_seconds: Number(s.command_polling_seconds), sync_interval_minutes: Number(s.sync_interval_minutes), live_sync_enabled: s.live_sync_enabled !== false,
  live_sync_probe_seconds: Number(s.live_sync_probe_seconds), live_sync_incremental_seconds: Number(s.live_sync_incremental_seconds), full_reconcile_interval_minutes: Number(s.full_reconcile_interval_minutes),
});
const semverLt = (a, b) => { const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };

// ---------- Tally text, dates and money (as AI Hive cleans them) ----------
// Tally writes its root group as U+0004 " Primary" (&#4; in XML); older connectors leave numeric references undecoded.
export function cleanText(v) {
  if (v == null) return null;
  return String(v).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+);/g, (m, e) => { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isInteger(c) && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : m; })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}
const addressLines = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(addressLines);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (/^[[{].*[\]}]$/s.test(s)) { try { return addressLines(JSON.parse(s)); } catch { /* not JSON */ } }
    if (/<ADDRESS(?:\s|>)/i.test(s)) return [...s.matchAll(/<ADDRESS(?:\s[^>]*)?>([\s\S]*?)<\/ADDRESS>/gi)].map((m) => String(m[1] || '').replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    return [s];
  }
  return typeof v === 'object' ? [] : [String(v)];
};
export const formatAddress = (v) => { const l = addressLines(v).map(cleanText).filter(Boolean); return l.length ? l.join(', ') : typeof v === 'string' ? cleanText(v) : null; };
// Tally dates are IST calendar days
export const istDay = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (typeof v === 'number' && Number.isFinite(v)) return istDay(new Date(v));
  return null;
};
export const overdueDays = (due, now = Date.now()) => { const d = istDay(due), t = istDay(new Date(now)); return d && t ? Math.max(0, Math.round((Date.parse(t) - Date.parse(d)) / DAY)) : 0; };
const magnitude = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.abs(Number(v)) : null);
// The window a company accepts vouchers in. financial_year_to is Tally's "end of data entered so far", not the year end:
// the upper bound is the later of it and 31 March of the year the books start in.
const fyEnd = (day) => `${Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) + 1 : Number(day.slice(0, 4))}-03-31`;
export function fyWindow(c) {
  const start = istDay(c?.financial_year_from), end = istDay(c?.financial_year_to);
  if (!start || !end) return null;
  if (end <= start) return start.slice(5) === '04-01' ? { start, end: fyEnd(start) } : null;
  return { start, end: end > fyEnd(start) ? end : fyEnd(start) };
}

// ---------- commands ----------
export const COMMANDS = ['GET_TALLY_STATUS', 'SYNC_COMPANIES', 'SYNC_LEDGERS', 'SYNC_VOUCHERS', 'SYNC_OUTSTANDINGS', 'SYNC_UNITS', 'SYNC_STOCK_ITEMS', 'SYNC_GODOWNS', 'SYNC_INVENTORY', 'SYNC_FULL',
  'CREATE_LEDGER', 'ALTER_LEDGER', 'DELETE_LEDGER', 'CREATE_VOUCHER', 'ALTER_VOUCHER', 'DELETE_VOUCHER', 'CANCEL_VOUCHER', 'CREATE_RECEIPT', 'CREATE_PAYMENT',
  'CREATE_UNIT', 'ALTER_UNIT', 'DELETE_UNIT', 'CREATE_STOCK_ITEM', 'ALTER_STOCK_ITEM', 'DELETE_STOCK_ITEM', 'CREATE_STOCK_JOURNAL', 'CREATE_GODOWN', 'ALTER_GODOWN', 'DELETE_GODOWN', 'REFRESH_LEDGER'];
const WRITE_RE = /^(CREATE_|ALTER_|DELETE_|CANCEL_|POST_)/;
const VOUCHER_CREATE = new Set(['CREATE_VOUCHER', 'CREATE_RECEIPT', 'CREATE_PAYMENT']);
const VOUCHER_REF = new Set(['ALTER_VOUCHER', 'DELETE_VOUCHER', 'CANCEL_VOUCHER']);
// voucher types that take stock out (Tally names, lower case)
const OUTWARD = new Set(['sales', 'delivery note', 'debit note', 'rejections out', 'receipt']);
export const STANDARD_GROUPS = ['Bank Accounts', 'Bank OCC A/c', 'Bank OD A/c', 'Branch / Divisions', 'Capital Account', 'Cash-in-Hand', 'Current Assets', 'Current Liabilities', 'Deposits (Asset)', 'Direct Expenses', 'Direct Incomes', 'Duties & Taxes', 'Fixed Assets', 'Indirect Expenses', 'Indirect Incomes', 'Investments', 'Loans & Advances (Asset)', 'Loans (Liability)', 'Misc. Expenses (ASSET)', 'Provisions', 'Purchase Accounts', 'Reserves & Surplus', 'Retained Earnings', 'Sales Accounts', 'Secured Loans', 'Stock-in-Hand', 'Sundry Creditors', 'Sundry Debtors', 'Suspense A/c', 'Unsecured Loans'];
export const VOUCHER_TYPES = ['Sales', 'Purchase', 'Receipt', 'Payment', 'Credit Note', 'Debit Note', 'Journal', 'Contra'];

// ---------- errors ----------
class TallyError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new TallyError(status, message); };

// ---------- the connector (agent) ----------
let SECRET = '';
const hmac = (v) => crypto.createHmac('sha256', SECRET).update(`tally:${v}`).digest('hex');
const newCode = () => `FH-${crypto.randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g).join('-')}`; // FH-XXXX-XXXX-XXXX
const CODE_MS = 30 * 60000;

// a one-time code for the seller to paste into the connector (valid 30 minutes; the raw code is shown once)
export function connectCode(userId) {
  const code = newCode();
  T.tcodes.delWhere({ userId });
  T.tcodes.insert({ userId, hash: hmac(code.toUpperCase()), expiresAt: Date.now() + CODE_MS, at: Date.now() });
  return { code, expiresAt: Date.now() + CODE_MS };
}

function activate(b, meta = {}) {
  const raw = clip(b.license_key, 80).toUpperCase();
  const fp = clip(b.machine_fingerprint, 512);
  if (raw.length < 10 || fp.length < 8) fail(400, 'Paste the connect code from FunnelHive (Settings → Tally)');
  const code = T.tcodes.find({ hash: hmac(raw) });
  if (!code || code.expiresAt < Date.now()) fail(400, 'This connect code is wrong or has expired — copy a new one from FunnelHive (Settings → Tally)');
  const u = T.users.get(code.userId);
  if (!tallyOn(u)) fail(403, 'Tally isn’t switched on for this FunnelHive account');
  T.tcodes.del(code.id); // one use
  const s = tallySettings();
  const token = `fht_${crypto.randomBytes(32).toString('hex')}`;
  const updateRequired = s.force_update_agent_version && semverLt(b.app_version, s.minimum_agent_version);
  const prev = T.tagents.find({ userId: u.id, fingerprint: fp });
  const agent = T.tagents.put({
    ...(prev || {}), id: prev?.id, userId: u.id, tokenHash: hmac(token), fingerprint: fp, machine_name: clip(b.machine_name, 255), app_version: clip(b.app_version, 64),
    tally_host: clip(b.tally_host, 255) || 'localhost', tally_port: Number(b.tally_port) || 9000, status: updateRequired ? 'UPDATE_REQUIRED' : 'ONLINE',
    tally_status: prev?.tally_status || 'UNKNOWN', lastSeenAt: Date.now(), at: prev?.at || Date.now(), ip: clip(meta.ip, 64),
  });
  return { success: true, agent_id: agent.id, agent_token: token, ...intervals(s), features: ['TALLY_DASHBOARD', 'TALLY_SYNC', 'TALLY_CRUD'] };
}

// Bearer token → { agent, user }; refuses a disabled connector, an old version when updates are forced, a seller
// whose add-on is off
function agentOf(req) {
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok) fail(401, 'Missing Tally connector token');
  const agent = T.tagents.find({ tokenHash: hmac(tok) });
  if (!agent) fail(401, 'Invalid Tally connector token — connect this PC again from FunnelHive');
  if (agent.status === 'DISABLED') fail(403, 'This PC was disconnected from FunnelHive — connect it again from Settings → Tally');
  if (agent.status === 'UPDATE_REQUIRED') fail(426, 'Please update the FunnelHive Tally Connector');
  const user = T.users.get(agent.userId);
  if (!tallyOn(user)) fail(403, 'Tally isn’t switched on for this FunnelHive account');
  return { agent, user };
}

function heartbeat(agent, b) {
  if (b.agent_id && b.agent_id !== agent.id) fail(403, 'Agent token does not match agent_id');
  const s = tallySettings();
  const updateRequired = s.force_update_agent_version && semverLt(b.app_version || agent.app_version, s.minimum_agent_version);
  const STATES = ['UNKNOWN', 'ONLINE', 'OFFLINE', 'COMPANY_NOT_LOADED', 'PORT_CLOSED', 'ERROR'];
  const row = T.tagents.update(agent.id, (a) => {
    a.app_version = clip(b.app_version, 64) || a.app_version; a.tally_version = clip(b.tally_version, 64) || a.tally_version || null;
    a.tally_status = STATES.includes(b.tally_status) ? b.tally_status : 'UNKNOWN';
    a.active_company_name = clip(b.company_name) || null; a.active_company_guid = clip(b.company_guid, 200) || null;
    a.status = updateRequired ? 'UPDATE_REQUIRED' : 'ONLINE'; a.lastSeenAt = Date.now();
  });
  // the company open in TallyPrime becomes the working company when none is chosen yet
  if (row.active_company_guid) ensureSelection(agent.userId, row.active_company_guid);
  return { success: true, agent: publicAgent(row), intervals: intervals(s) };
}
export const publicAgent = (a) => ({ id: a.id, machine_name: a.machine_name, app_version: a.app_version, tally_version: a.tally_version || null, status: a.status, tally_status: a.tally_status, active_company_name: a.active_company_name || null, last_seen_at: a.lastSeenAt || null, last_sync_at: a.lastSyncAt || null, last_sync_error: a.lastSyncError || null, connected_at: a.at });
// ready to run a command: the connector is online and TallyPrime has a company open
const runnable = (a) => a && a.status === 'ONLINE' && a.tally_status === 'ONLINE' && Date.now() - (a.lastSeenAt || 0) < tallySettings().heartbeat_timeout_seconds * 1000;

// ---------- companies & the working company ----------
const companiesOf = (userId) => T.tcompanies.all({ userId }, { order: 'at' });
export const selectedCompany = (userId) => {
  const id = T.users.get(userId)?.tally?.companyId;
  const c = id && T.tcompanies.get(id);
  return c && c.userId === userId && c.active !== false ? c : null;
};
function ensureSelection(userId, guid) {
  if (selectedCompany(userId)) return;
  const c = (guid && companiesOf(userId).find((x) => x.tally_guid === guid)) || companiesOf(userId)[0];
  if (c) T.users.update(userId, (u) => { u.tally = { ...u.tally, companyId: c.id }; });
}
export function selectCompany(userId, id) {
  const c = T.tcompanies.get(id);
  if (!c || c.userId !== userId) fail(404, 'Company not found');
  T.users.update(userId, (u) => { u.tally = { ...u.tally, companyId: c.id }; });
  return c;
}
function resolveCompany(agent, guid) {
  const g = clip(guid, 500), l = lname(g);
  const c = T.tcompanies.find({ agentId: agent.id, guid: g }) || T.tcompanies.all({ agentId: agent.id }).find((x) => lname(x.name) === l);
  if (!c) fail(404, 'Tally company not found. Sync companies first.');
  return c;
}

// ---------- sync (the connector uploads the mirror in batches of ≤ 500) ----------
// reconcile: the request holds the complete export, so active rows it doesn't mention were deleted in Tally.
// Multi-batch runs: the first batch returns reconcile_before (when it started); the last batch, with that watermark,
// retires rows not written since. Empty exports never reconcile (a failed export must not wipe the mirror).
function runSync(agent, type, companyId, fn) {
  const run = T.truns.insert({ userId: agent.userId, agentId: agent.id, companyId: companyId || null, sync_type: type, status: 'STARTED', at: Date.now() });
  const c = { created: 0, updated: 0, failed: 0, reconcileBefore: null };
  try {
    tx(() => fn(c));
    const done = T.truns.update(run.id, (r) => { r.status = c.failed ? 'PARTIAL' : 'SUCCESS'; r.completedAt = Date.now(); r.records_created = c.created; r.records_updated = c.updated; r.records_failed = c.failed; });
    T.tagents.update(agent.id, (a) => { a.lastSyncAt = Date.now(); a.lastSyncError = null; });
    return { id: done.id, status: done.status, records_created: c.created, records_updated: c.updated, records_failed: c.failed, ...(c.reconcileBefore ? { reconcile_before: String(c.reconcileBefore) } : {}) };
  } catch (e) {
    T.truns.update(run.id, (r) => { r.status = 'FAILED'; r.completedAt = Date.now(); r.error_message = clip(e.message, 500); });
    T.tagents.update(agent.id, (a) => { a.lastSyncError = clip(e.message, 300) || 'Tally sync failed'; });
    throw new TallyError(e.status || 400, e.message || 'Tally sync failed');
  }
}
// retire rows of a company the export no longer lists
function reconcile(table, companyId, c, records, before, keyOf) {
  if (before) {
    const cut = Number(before);
    for (const r of T[table].all({ companyId, active: 1 })) if (!(r.syncedAt >= cut)) { T[table].put({ ...r, active: false }); c.updated++; }
    return;
  }
  if (!records.length) return;
  const seen = new Set(records.map(keyOf));
  for (const r of T[table].all({ companyId, active: 1 })) if (!seen.has(keyOf(r))) { T[table].put({ ...r, active: false }); c.updated++; }
}
const masterKey = (r) => (r.tally_guid ? `guid:${r.tally_guid}` : `name:${lname(r.name)}`);
// a master (ledger, unit, godown, stock item) by guid, then by name (rows written on create have no guid yet)
const findMaster = (table, companyId, rec) => (rec.tally_guid && T[table].find({ companyId, guid: rec.tally_guid })) || T[table].find({ companyId, lname: lname(rec.name) });

function syncCompanies(agent, records) {
  const r = runSync(agent, 'COMPANIES', null, (c) => {
    for (const rec of records) {
      const name = clip(rec.name);
      if (!name) continue;
      const guid = clip(rec.tally_guid, 500) || null;
      const prev = (guid && T.tcompanies.find({ agentId: agent.id, guid })) || T.tcompanies.all({ agentId: agent.id }).find((x) => lname(x.name) === lname(name));
      T.tcompanies.put({ ...(prev || {}), id: prev?.id, userId: agent.userId, agentId: agent.id, tally_guid: guid, name, financial_year_from: istDay(rec.financial_year_from), financial_year_to: istDay(rec.financial_year_to), active: prev?.active !== false, syncedAt: Date.now(), at: prev?.at || Date.now() });
      prev ? c.updated++ : c.created++;
    }
  });
  ensureSelection(agent.userId, agent.active_company_guid);
  return r;
}

function syncLedgers(agent, guid, records, rec0, before) {
  const company = resolveCompany(agent, guid);
  const touched = [];
  const r = runSync(agent, 'LEDGERS', company.id, (c) => {
    c.reconcileBefore = Date.now();
    if (company.active === false) return;
    for (const rec of records) {
      const name = clip(rec.name);
      if (!name) continue;
      const prev = findMaster('tledgers', company.id, rec);
      const email = clip(rec.email, 200);
      const row = T.tledgers.put({
        ...(prev || {}), id: prev?.id, userId: agent.userId, companyId: company.id, tally_guid: clip(rec.tally_guid, 500) || null, master_id: clip(rec.master_id, 100) || null, name,
        parent: cleanText(rec.parent), ledger_group: cleanText(rec.ledger_group) || cleanText(rec.parent), opening_balance: num(rec.opening_balance), closing_balance: num(rec.closing_balance),
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, phone: clip(rec.phone, 80) || null, credit_period_days: num(rec.credit_period_days), mailing_name: clip(rec.mailing_name) || null,
        address: formatAddress(rec.address), state: clip(rec.state, 200) || null, pincode: clip(rec.pincode, 20) || null, country: clip(rec.country, 200) || null,
        active: true, syncedAt: Date.now(), at: prev?.at || Date.now(),
      });
      prev ? c.updated++ : c.created++;
      touched.push(row);
    }
    if (rec0) reconcile('tledgers', company.id, c, records, before, masterKey);
  });
  if (touched.length) ledgerContactsHook?.(agent.userId, company, touched);
  return r;
}
let ledgerContactsHook = null; // tally-crm.js: ledgers ↔ CRM contacts
export const onLedgersSynced = (fn) => { ledgerContactsHook = fn; };

// website-created vouchers carry our import REMOTEID; a later export is matched back to that skeleton by reference, or
// by amount (magnitude: receipts sync signed) and party
const refKey = (r) => lname(r.reference_number ?? r.bill_number ?? r.voucher_number ?? '');
// an invoice-style create carries items, not an amount
const itemsTotal = (items) => { const t = (Array.isArray(items) ? items : []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0); return t > 0 ? Math.round(t * 100) / 100 : null; };
const skeletonMatches = (s, rec) => {
  const a = refKey(s), b = refKey(rec);
  if (a && b && a === b) return true;
  // the bill we raised (bill_number) comes back as the export's bill allocation, not its reference
  if (s.bill_number && (rec.bill_allocations || []).some((x) => lname(x.bill_name) === lname(s.bill_number)) && (!lname(s.party_name) || lname(s.party_name) === lname(rec.party_name))) return true;
  const sa = num(s.amount ?? s.total_credit ?? s.total_debit), ra = num(rec.amount ?? rec.total_credit ?? rec.total_debit);
  return sa != null && ra != null && Math.abs(Math.abs(sa) - Math.abs(ra)) < 0.05 && !!lname(s.party_name) && lname(s.party_name) === lname(rec.party_name);
};
const EXPORT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}$/i;
const websiteRemoteId = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s && !EXPORT_GUID.test(s) ? s : null; };
const voucherKey = (r) => (r.tally_guid ? `guid:${r.tally_guid}` : `v:${r.voucher_number ?? ''}||${r.voucher_type ?? ''}||${istDay(r.voucher_date) ?? ''}`);
const outstandingStatus = (rec) => {
  const pending = Number(rec.pending_amount ?? rec.amount ?? 0), overdue = overdueDays(rec.due_date) > 0;
  if (rec.status === 'PENDING' || rec.status === 'OVERDUE') return overdue ? 'OVERDUE' : 'PENDING';
  if (rec.status) return rec.status;
  if (pending <= 0) return 'PAID';
  if (Math.abs(pending) < Math.abs(Number(rec.amount ?? pending))) return 'PARTIAL';
  return overdue ? 'OVERDUE' : 'PENDING';
};
const billRow = (bill) => {
  const name = clip(bill.bill_name);
  if (!name || (name === 'Bill' && bill.amount == null && bill.pending_amount == null)) return null;
  const pending = bill.pending_amount ?? bill.amount ?? null;
  return { bill_name: name, bill_type: clip(bill.bill_type, 40) || null, bill_date: istDay(bill.bill_date), due_date: istDay(bill.due_date), credit_period: clip(bill.credit_period, 100) || null, amount: num(bill.amount), pending_amount: num(pending), ledger_name: clip(bill.ledger_name) || null, status: bill.status || outstandingStatus({ ...bill, pending_amount: magnitude(pending) }) };
};

function syncVouchers(agent, guid, records, rec0, before) {
  const company = resolveCompany(agent, guid);
  return runSync(agent, 'VOUCHERS', company.id, (c) => {
    c.reconcileBefore = Date.now();
    if (company.active === false) return;
    for (const rec of records) {
      const tguid = clip(rec.tally_guid, 500) || null, vtype = clip(rec.voucher_type, 120) || null, vdate = istDay(rec.voucher_date);
      let prev = tguid ? T.tvouchers.find({ companyId: company.id, guid: tguid })
        : T.tvouchers.all({ companyId: company.id, vtype, vnum: clip(rec.voucher_number, 200) || null }).find((v) => v.voucher_date === vdate) || null;
      const rid = websiteRemoteId(rec.remote_id);
      if (!prev && rid) prev = T.tvouchers.find({ companyId: company.id, remoteId: rid });
      // our own create, waiting for Tally's export (a "skeleton": remote id, no guid yet)
      const skeletons = vtype ? T.tvouchers.all({ companyId: company.id, vtype, guid: null }).filter((s) => s.remoteId) : [];
      if (!prev) prev = skeletons.find((s) => skeletonMatches(s, rec)) || null;
      else if (!prev.remoteId && prev.tally_guid) {
        const sk = skeletons.find((s) => s.id !== prev.id && skeletonMatches(s, rec));
        if (sk) { prev = { ...prev, remoteId: sk.remoteId, source: sk.source }; T.tvouchers.del(sk.id); T.tbills.delWhere({ voucherId: sk.id }); }
      }
      const lines = (Array.isArray(rec.ledger_entries) ? rec.ledger_entries : []).filter((l) => clip(l.ledger_name) && clip(l.ledger_name) !== 'Unknown Ledger').map((l, i) => {
        const amt = Number(l.amount ?? 0);
        return { line_index: l.line_index ?? i, ledger_name: clip(l.ledger_name), amount: num(l.amount), debit_amount: l.debit_amount != null ? num(l.debit_amount) : amt < 0 ? Math.abs(amt) : null, credit_amount: l.credit_amount != null ? num(l.credit_amount) : amt > 0 ? amt : null, is_party_ledger: !!l.is_party_ledger, bills: (l.bill_allocations || []).map(billRow).filter(Boolean) };
      });
      const items = (Array.isArray(rec.inventory_entries) ? rec.inventory_entries : []).filter((x) => clip(x.stock_item_name) && clip(x.stock_item_name) !== 'Unknown Stock Item').map((x, i) => ({ line_index: x.line_index ?? i, stock_item_name: clip(x.stock_item_name), actual_qty: num(x.actual_qty), billed_qty: num(x.billed_qty), rate: num(x.rate), amount: num(x.amount), godown_name: clip(x.godown_name) || null, batch_name: clip(x.batch_name) || null }));
      const bills = (Array.isArray(rec.bill_allocations) ? rec.bill_allocations : []).map(billRow).filter(Boolean);
      const row = T.tvouchers.put({
        ...(prev || {}), id: prev?.id, userId: agent.userId, companyId: company.id, tally_guid: tguid, master_id: clip(rec.master_id, 100) || null, alter_id: clip(rec.alter_id, 100) || null,
        voucher_number: clip(rec.voucher_number, 200) || null, voucher_type: vtype, voucher_date: vdate, effective_date: istDay(rec.effective_date) || vdate,
        party_name: clip(rec.party_name) || null, amount: magnitude(rec.amount ?? rec.total_credit ?? rec.total_debit), reference_number: clip(rec.reference_number) || null,
        due_date: istDay(rec.due_date) || prev?.due_date || null, payment_terms: clip(rec.payment_terms, 200) || null,
        status: rec.status || (rec.is_cancelled ? 'CANCELLED' : rec.is_optional ? 'OPTIONAL' : prev?.status === 'DUE' ? 'DUE' : 'POSTED'),
        is_cancelled: !!rec.is_cancelled, is_optional: !!rec.is_optional, total_debit: num(rec.total_debit), total_credit: num(rec.total_credit), narration: clip(rec.narration, 2000) || null,
        remoteId: prev?.remoteId || rid || null, source: prev?.source || 'TALLY', lines, items, bills, active: true, pending: undefined, syncedAt: Date.now(), at: prev?.at || Date.now(),
      });
      prev ? c.updated++ : c.created++;
      // bill allocations, for linking outstanding bills to the voucher that raised them
      T.tbills.delWhere({ voucherId: row.id });
      for (const l of lines) for (const bl of l.bills) T.tbills.insert({ companyId: company.id, voucherId: row.id, bname: lname(bl.bill_name), btype: bl.bill_type, ledger: lname(l.ledger_name) });
      for (const bl of bills) T.tbills.insert({ companyId: company.id, voucherId: row.id, bname: lname(bl.bill_name), btype: bl.bill_type, ledger: lname(bl.ledger_name || rec.party_name) });
    }
    if (rec0) reconcile('tvouchers', company.id, c, records, before, voucherKey);
  });
}

const outKey = (party, bill, type) => `${lname(party)}|${lname(bill)}|${type === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE'}`;
function syncOutstandings(agent, guid, records, rec0, before) {
  const company = resolveCompany(agent, guid);
  return runSync(agent, 'OUTSTANDINGS', company.id, (c) => {
    c.reconcileBefore = Date.now();
    if (company.active === false) return;
    for (const rec of records) {
      const party = clip(rec.party_name), bill = clip(rec.bill_number, 200) || null;
      if (!party || (party === 'Unknown Party' && !bill)) continue;
      const type = rec.bill_type === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE', okey = outKey(party, bill, type);
      const ledger = T.tledgers.find({ companyId: company.id, lname: lname(party) });
      // the voucher that raised the bill (its New Ref allocation); voucher numbers repeat per type, so a bare number
      // match must be the same party
      let voucherId = null;
      if (bill) {
        const alloc = T.tbills.all({ companyId: company.id, bname: lname(bill), btype: 'New Ref' }).find((a) => !ledger || a.ledger === lname(party));
        voucherId = alloc?.voucherId || T.tvouchers.all({ companyId: company.id, vnum: bill }).find((v) => lname(v.party_name) === lname(party))?.id || null;
      }
      const prev = T.touts.find({ companyId: company.id, okey });
      const due = istDay(rec.due_date), amount = magnitude(rec.amount), pending = magnitude(rec.pending_amount);
      T.touts.put({
        ...(prev || {}), id: prev?.id, userId: agent.userId, companyId: company.id, okey, party_name: party, party_email: clip(rec.party_email, 200) || ledger?.email || null, party_phone: clip(rec.party_phone, 80) || ledger?.phone || null,
        bill_number: bill, bill_date: istDay(rec.bill_date), due_date: due, amount, pending_amount: pending, status: outstandingStatus({ ...rec, due_date: due, pending_amount: pending }),
        bill_type: type, ledgerId: ledger?.id || null, voucherId, reference_number: clip(rec.reference_number) || null, payment_terms: clip(rec.payment_terms, 200) || null,
        days_overdue: overdueDays(due), active: true, syncedAt: Date.now(), at: prev?.at || Date.now(),
      });
      prev ? c.updated++ : c.created++;
    }
    if (rec0) reconcile('touts', company.id, c, records, before, (r) => r.okey || outKey(r.party_name, r.bill_number, r.bill_type));
    refreshVoucherDue(company.id);
  });
}
// a voucher is DUE while one of its own bills is unpaid and overdue; it fills a missing due date from them too
function refreshVoucherDue(companyId) {
  const byVoucher = new Map();
  for (const o of T.touts.all({ companyId, active: 1 })) if (o.voucherId) (byVoucher.get(o.voucherId) || byVoucher.set(o.voucherId, []).get(o.voucherId)).push(o);
  const ids = new Set([...byVoucher.keys(), ...T.tvouchers.ids({ companyId, status: 'DUE' })]);
  for (const id of ids) {
    const v = T.tvouchers.get(id);
    if (!v) continue;
    const bills = byVoucher.get(id) || [];
    const overdue = bills.some((o) => o.status === 'OVERDUE');
    const next = v.status === 'POSTED' && overdue ? 'DUE' : v.status === 'DUE' && !overdue ? 'POSTED' : v.status;
    const due = v.due_date || bills.filter((o) => o.status !== 'PAID' && o.due_date).map((o) => o.due_date).sort()[0] || null;
    if (next !== v.status || due !== v.due_date) T.tvouchers.put({ ...v, status: next, due_date: due });
  }
}

function syncMasters(table, type, fields) {
  return (agent, guid, records, rec0, before) => {
    const company = resolveCompany(agent, guid);
    return runSync(agent, type, company.id, (c) => {
      c.reconcileBefore = Date.now();
      if (company.active === false) return;
      for (const rec of records) {
        const name = clip(rec.name);
        if (!name) continue;
        const prev = findMaster(table, company.id, rec);
        T[table].put({ ...(prev || {}), id: prev?.id, userId: agent.userId, companyId: company.id, tally_guid: clip(rec.tally_guid, 500) || null, name, ...fields(rec, prev || {}), active: true, syncedAt: Date.now(), at: prev?.at || Date.now() });
        prev ? c.updated++ : c.created++;
      }
      if (rec0) reconcile(table, company.id, c, records, before, masterKey);
    });
  };
}
// unit exports often omit these: keep what a create already stored
const syncUnits = syncMasters('tunits', 'UNITS', (r, p) => ({ formal_name: cleanText(r.formal_name) || p.formal_name || null, symbol: cleanText(r.symbol) || p.symbol || null, decimal_places: r.decimal_places ?? p.decimal_places ?? null, is_simple: r.is_simple ?? p.is_simple ?? null, uqc: r.uqc ?? p.uqc ?? null }));
const syncGodowns = syncMasters('tgodowns', 'GODOWNS', (r) => ({ parent: cleanText(r.parent), address: formatAddress(r.address) || '' }));
const syncStockItems = syncMasters('tstock', 'STOCK_ITEMS', (r) => ({ parent: cleanText(r.parent), category: cleanText(r.category), base_units: clip(r.base_units, 120) || null, opening_balance: num(r.opening_balance), opening_value: num(r.opening_value), closing_balance: num(r.closing_balance), closing_value: num(r.closing_value), last_sale_rate: num(r.last_sale_rate), last_purchase_rate: num(r.last_purchase_rate) }));

// ---------- the command queue ----------
function pendingFor(agent, limit = 10) {
  expireOld();
  const rows = T.tcommands.all({ agentId: agent.id, status: ['PENDING', 'SENT'] }, { order: 'priority, at', limit: Math.min(Number(limit) || 10, 50) }).filter((r) => !r.expiresAt || r.expiresAt > Date.now());
  for (const r of rows) if (r.status === 'PENDING') T.tcommands.update(r.id, (x) => { x.status = 'SENT'; x.sentAt = Date.now(); });
  return rows.map((r) => ({ command_id: r.id, command_type: r.command_type, payload: r.payload || {} }));
}
function submitResult(agent, id, b) {
  const cmd = T.tcommands.get(id);
  if (!cmd || cmd.agentId !== agent.id) fail(404, 'Tally command not found');
  if (!['PENDING', 'SENT'].includes(cmd.status)) fail(409, `Cannot submit result for ${cmd.status} Tally command`);
  const ok = b.status === 'SUCCESS';
  const row = T.tcommands.update(id, (x) => { x.status = ok ? 'SUCCESS' : 'FAILED'; x.result = b.result && typeof b.result === 'object' ? b.result : {}; x.error_message = ok ? null : clip(b.error_message, 2000) || 'Tally refused the change'; x.completedAt = Date.now(); });
  if (ok) {
    // never let mirror cleanup turn a Tally-confirmed success into an error (the connector would retry into a 409)
    try { applyLocal(row); } catch (e) { console.error('Tally mirror update failed', e.message); }
    try { followUpSync(row); } catch {}
  }
  commandHook?.(row);
  return { id: row.id, status: row.status };
}
let commandHook = null; // notifications / automations when a command finishes
export const onCommandDone = (fn) => { commandHook = fn; };
function expireOld() {
  for (const r of T.tcommands.all({ status: ['PENDING', 'SENT'], expiresAt: { lte: Date.now() } })) T.tcommands.update(r.id, (x) => { x.status = 'EXPIRED'; x.error_message = 'The Tally PC didn’t pick this up in time — check TallyPrime before trying again, it may have been applied'; });
}
// a write changes Tally: queue a targeted re-sync (reusing a pending one) so the mirror catches up on the next poll
function followUpSync(cmd) {
  const t = cmd.command_type;
  if (!WRITE_RE.test(t)) return;
  const type = t.includes('LEDGER') ? 'SYNC_LEDGERS' : t.includes('STOCK') ? 'SYNC_STOCK_ITEMS' : t.includes('GODOWN') ? 'SYNC_GODOWNS' : t.includes('UNIT') ? 'SYNC_UNITS' : 'SYNC_VOUCHERS';
  if (!runnable(T.tagents.get(cmd.agentId)) || T.tcommands.exists({ agentId: cmd.agentId, command_type: type, status: 'PENDING' })) return;
  T.tcommands.insert({ userId: cmd.userId, agentId: cmd.agentId, command_type: type, payload: {}, status: 'PENDING', priority: 5, at: Date.now(), expiresAt: Date.now() + 15 * 60000, by: 'system' });
}
// keep the mirror right the moment Tally confirms (a sync only upserts; it never deletes)
function applyLocal(cmd) {
  const p = cmd.payload || {}, t = cmd.command_type;
  const company = (T.tagents.get(cmd.agentId)?.active_company_guid && T.tcompanies.find({ userId: cmd.userId, guid: T.tagents.get(cmd.agentId).active_company_guid })) || selectedCompany(cmd.userId);
  // our create, held as a skeleton (remote id, no guid) so it can be altered / cancelled before the next export
  if (VOUCHER_CREATE.has(t) && p.remote_id && !T.tvouchers.exists({ remoteId: p.remote_id }) && company) {
    T.tvouchers.insert({ userId: cmd.userId, companyId: company.id, tally_guid: null, remoteId: p.remote_id, voucher_number: p.voucher_number || null, voucher_type: p.voucher_type || (t === 'CREATE_PAYMENT' ? 'Payment' : t === 'CREATE_RECEIPT' ? 'Receipt' : 'Sales'), voucher_date: p.date || istDay(new Date()), party_name: p.party_name || p.debit_ledger || p.credit_ledger || null, amount: num(p.amount) ?? itemsTotal(p.items), status: 'POSTED', reference_number: p.reference_number || p.bill_number || null, bill_number: p.bill_number || null, source: p.voucher_source || 'CRM', lines: [], items: [], bills: [], active: false, pending: true, syncedAt: Date.now(), at: Date.now() });
    return;
  }
  const masterTable = { CREATE_LEDGER: 'tledgers', CREATE_STOCK_ITEM: 'tstock', CREATE_GODOWN: 'tgodowns', CREATE_UNIT: 'tunits' }[t];
  if (masterTable && p.name && company) {
    const prev = T[masterTable].find({ companyId: company.id, lname: lname(p.name) });
    const extra = t === 'CREATE_LEDGER' ? { parent: p.parent || 'Sundry Debtors', ledger_group: p.parent || 'Sundry Debtors', email: p.email || null, phone: p.phone || p.mobile || null, address: formatAddress(p.address), state: p.state || null, pincode: p.pincode || null, closing_balance: prev?.closing_balance ?? 0 }
      : t === 'CREATE_STOCK_ITEM' ? { parent: p.parent || null, category: p.category || null, base_units: p.base_units || 'Nos', closing_balance: prev?.closing_balance ?? num(p.opening_balance), closing_value: prev?.closing_value ?? num(p.opening_value), last_sale_rate: num(p.standard_price), last_purchase_rate: num(p.standard_cost) }
        : t === 'CREATE_GODOWN' ? { parent: p.parent || null, address: formatAddress(p.address) || '' } : { formal_name: p.formal_name || null, symbol: p.symbol || p.name, decimal_places: p.decimal_places ?? null, is_simple: p.simple !== false };
    T[masterTable].put({ ...(prev || {}), id: prev?.id, userId: cmd.userId, companyId: company.id, tally_guid: prev?.tally_guid || null, name: p.name, ...extra, active: true, syncedAt: prev?.syncedAt || 0, at: prev?.at || Date.now() });
    return;
  }
  const rec = (table) => (p.record_id && T[table].get(p.record_id)?.userId === cmd.userId ? T[table].get(p.record_id) : null);
  const voucherRows = () => { const v = rec('tvouchers'); return [v, p.tally_guid && T.tvouchers.find({ userId: cmd.userId, guid: p.tally_guid }), p.remote_id && T.tvouchers.find({ userId: cmd.userId, remoteId: p.remote_id })].filter(Boolean); };
  if (t === 'DELETE_VOUCHER') for (const v of voucherRows()) { T.tvouchers.del(v.id); T.tbills.delWhere({ voucherId: v.id }); }
  else if (t === 'CANCEL_VOUCHER') for (const v of voucherRows()) T.tvouchers.put({ ...v, status: 'CANCELLED', is_cancelled: true });
  else if (t === 'ALTER_VOUCHER') for (const v of voucherRows().slice(0, 1)) {
    const next = { ...v };
    if (p.new_date) next.voucher_date = next.effective_date = istDay(p.new_date);
    if (p.narration !== undefined) next.narration = p.narration || null;
    if (p.reference_number !== undefined) next.reference_number = p.reference_number || null;
    if (num(p.amount)) next.amount = Math.abs(num(p.amount));
    if (p.due_date !== undefined) next.due_date = p.due_date ? istDay(p.due_date) : null;
    T.tvouchers.put(next);
  } else if (/^DELETE_(LEDGER|STOCK_ITEM|UNIT|GODOWN)$/.test(t)) {
    const table = { DELETE_LEDGER: 'tledgers', DELETE_STOCK_ITEM: 'tstock', DELETE_UNIT: 'tunits', DELETE_GODOWN: 'tgodowns' }[t];
    const r = rec(table) || (company && p.name && T[table].find({ companyId: company.id, lname: lname(p.name) }));
    if (r) T[table].del(r.id);
  } else if (/^ALTER_(LEDGER|STOCK_ITEM|UNIT|GODOWN)$/.test(t)) {
    const table = { ALTER_LEDGER: 'tledgers', ALTER_STOCK_ITEM: 'tstock', ALTER_UNIT: 'tunits', ALTER_GODOWN: 'tgodowns' }[t];
    const r = rec(table);
    if (!r) return;
    const keep = ['parent', 'email', 'phone', 'mailing_name', 'credit_period_days', 'state', 'pincode', 'country', 'category', 'base_units', 'formal_name'];
    const next = { ...r };
    for (const k of keep) if (p[k] !== undefined) next[k] = p[k] || null;
    if (p.address !== undefined) next.address = formatAddress(p.address);
    if (t === 'ALTER_LEDGER' && p.parent !== undefined) next.ledger_group = p.parent;
    if (p.new_name) next.name = p.new_name;
    T[table].put(next);
  }
}

// ---------- queuing a write from the seller (or Hive AI / an automation) ----------
// payload checks mirror AI Hive's schemas; anything Tally itself must judge is left to Tally (the connector reports it)
function checkPayload(type, p) {
  const need = (cond, msg) => { if (!cond) fail(400, msg); };
  const str = (k) => clip(p[k]);
  if (['CREATE_LEDGER', 'ALTER_LEDGER', 'DELETE_LEDGER', 'CREATE_STOCK_ITEM', 'ALTER_STOCK_ITEM', 'DELETE_STOCK_ITEM', 'CREATE_GODOWN', 'ALTER_GODOWN', 'DELETE_GODOWN', 'CREATE_UNIT', 'ALTER_UNIT', 'DELETE_UNIT'].includes(type)) need(str('name'), 'Enter the name');
  if (type === 'CREATE_LEDGER') { p.parent = str('parent') || 'Sundry Debtors'; if (p.email) need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str('email')), 'Check the email address'); }
  if (['CREATE_UNIT', 'ALTER_UNIT'].includes(type)) need(/^[A-Za-z_]+$/.test(str('name')), 'A unit symbol is letters only, no spaces or digits (e.g. Nos, Kgs, Pcs)');
  if (type === 'CREATE_STOCK_ITEM') p.base_units = str('base_units') || 'Nos';
  if (VOUCHER_CREATE.has(type)) {
    need(str('party_name') || (str('debit_ledger') && str('credit_ledger')), 'Choose the party — or, for a Journal / Contra, both the debit and the credit ledger');
    const items = Array.isArray(p.items) ? p.items.filter((i) => clip(i?.stock_item_name)) : [];
    need((num(p.amount) || 0) > 0 || items.length, 'Enter an amount, or add at least one item with quantity and rate');
    for (const i of items) need(num(i.quantity) > 0 && num(i.rate) >= 0, `Check the quantity and rate of ${clip(i.stock_item_name)}`);
    p.items = items.length ? items : undefined;
    if (p.date) need(/^\d{4}-\d{2}-\d{2}$/.test(String(p.date)), 'The date looks like 2026-10-31');
    if (p.voucher_type) p.voucher_type = clip(p.voucher_type, 120);
  }
  if (type === 'CREATE_STOCK_JOURNAL') {
    need(str('stock_item_name') && num(p.quantity) > 0, 'Choose the item and a quantity');
    need(str('unit'), 'Choose the unit');
    need(str('source_godown') && str('dest_godown') && lname(p.source_godown) !== lname(p.dest_godown), 'Choose two different godowns: from and to');
  }
  if (VOUCHER_REF.has(type)) need(p.record_id || p.tally_guid || p.remote_id, 'Choose the voucher');
  if ('raw_xml' in p) fail(400, 'Raw XML isn’t accepted');
  return p;
}
// voucher dates inside the books, and no sale that would take stock below zero (fail open whenever we can't judge —
// Tally stays the final word)
function precheck(userId, company, type, p) {
  if (!company) return;
  if (['CREATE_VOUCHER', 'CREATE_RECEIPT', 'CREATE_PAYMENT', 'CREATE_STOCK_JOURNAL'].includes(type) && p.date) {
    const w = fyWindow(company), day = String(p.date).slice(0, 10);
    if (w && (day < w.start || day > w.end)) fail(400, `${day} is outside ${company.name}’s books in Tally (${w.start} to ${w.end}) — pick a date inside them`);
  }
  const needs = [];
  if (type === 'CREATE_STOCK_JOURNAL') needs.push({ name: p.stock_item_name, qty: num(p.quantity), where: ` in ${p.source_godown}` });
  else if (VOUCHER_CREATE.has(type)) {
    const vt = lname(p.voucher_type) || (type === 'CREATE_RECEIPT' ? 'receipt' : type === 'CREATE_PAYMENT' ? 'payment' : 'sales');
    if (OUTWARD.has(vt)) for (const i of p.items || (p.stock_item_name ? [p] : [])) needs.push({ name: i.stock_item_name, qty: num(i.quantity), unit: i.unit });
  }
  const byItem = new Map();
  for (const n of needs) { if (!n.name || !(n.qty > 0)) continue; const k = lname(n.name), cur = byItem.get(k); cur ? (cur.qty += n.qty) : byItem.set(k, { ...n }); }
  for (const [k, n] of byItem) {
    const item = T.tstock.find({ companyId: company.id, lname: k });
    if (!item || item.closing_balance == null) continue;
    if (Number(item.closing_balance) < n.qty) fail(409, `Not enough stock of ${item.name}: this needs ${n.qty}${n.unit ? ` ${n.unit}` : ''}${n.where || ''}, but only ${item.closing_balance} is on hand. Lower the quantity, or sync the latest stock from Tally and try again.`);
  }
}
// → the command row; refuses (409) when the Tally PC can't run it now
export function queueCommand(userId, type, payload = {}, { by = 'user', byId = null, priority = 5 } = {}) {
  if (!COMMANDS.includes(type)) fail(400, 'That isn’t a Tally action FunnelHive can run');
  const p = checkPayload(type, { ...(payload && typeof payload === 'object' ? payload : {}) });
  const agents = T.tagents.all({ userId }).filter((a) => a.status !== 'DISABLED');
  if (!agents.length) fail(409, 'No Tally PC is connected yet — install the FunnelHive Tally Connector on the PC with TallyPrime (Settings → Tally)');
  const company = (p.company_guid && T.tcompanies.find({ userId, guid: p.company_guid })) || selectedCompany(userId);
  // the PC to run it: one that's online with this company open in TallyPrime (any online one for syncs)
  const isSync = /^(SYNC_|GET_|REFRESH_)/.test(type);
  const ready = agents.filter(runnable);
  const agent = isSync ? ready[0] : ready.find((a) => !company?.tally_guid || a.active_company_guid === company.tally_guid);
  if (!agent) {
    if (!ready.length) fail(409, 'Your Tally PC is offline — open TallyPrime and the FunnelHive Tally Connector on it, then try again');
    fail(409, `Open ${company?.name || 'this company'} in TallyPrime on your PC, then try again`);
  }
  if (WRITE_RE.test(type)) {
    precheck(userId, company, type, p);
    if (company && !p.company_guid) Object.assign(p, { company_guid: company.tally_guid, company_name: company.name });
  }
  if (VOUCHER_CREATE.has(type)) { p.remote_id ||= crypto.randomUUID(); p.voucher_source ||= 'CRM'; }
  if (VOUCHER_REF.has(type)) {
    const v = (p.record_id && T.tvouchers.get(p.record_id)) || (p.tally_guid && T.tvouchers.find({ userId, guid: p.tally_guid })) || null;
    if (v && v.userId !== userId) fail(404, 'Voucher not found');
    if (v) {
      const rid = websiteRemoteId(v.remoteId);
      if (rid && !p.remote_id) p.remote_id = rid;
      for (const [k, val] of [['tally_guid', v.tally_guid], ['voucher_type', v.voucher_type], ['voucher_number', v.voucher_number], ['date', v.voucher_date]]) if (!p[k] && val) p[k] = val;
    }
    if (!p.voucher_type || !p.date) fail(400, 'That voucher isn’t in the synced data yet — sync and try again');
  }
  return T.tcommands.insert({ userId, agentId: agent.id, command_type: type, payload: p, status: 'PENDING', priority, at: Date.now(), expiresAt: Date.now() + 15 * 60000, by, byId });
}
export const publicCommand = (c) => ({ id: c.id, command_type: c.command_type, status: c.status, payload: c.payload, result: c.result || null, error_message: c.error_message || null, at: c.at, completed_at: c.completedAt || null, by: c.by });

// ---------- reads for the seller (the working company's mirror) ----------
const LISTS = {
  ledgers: { table: 'tledgers', search: ['name', 'parent', 'email', 'phone'], order: "lower(json_extract(data, '$.name'))", filters: ['ledger_group', 'parent'] },
  vouchers: { table: 'tvouchers', search: ['party_name', 'voucher_number', 'narration', 'reference_number'], order: "json_extract(data, '$.voucher_date') DESC, at DESC", filters: ['voucher_type', 'status', 'source'], date: 'voucher_date' },
  outstandings: { table: 'touts', search: ['party_name', 'bill_number'], order: "json_extract(data, '$.due_date')", filters: ['bill_type', 'status'], date: 'due_date' },
  units: { table: 'tunits', search: ['name', 'formal_name'], order: "lower(json_extract(data, '$.name'))", filters: [] },
  godowns: { table: 'tgodowns', search: ['name', 'parent'], order: "lower(json_extract(data, '$.name'))", filters: [] },
  stock: { table: 'tstock', search: ['name', 'parent', 'category'], order: "lower(json_extract(data, '$.name'))", filters: ['parent', 'category'] },
};
export function list(userId, kind, query = {}) {
  const L = LISTS[kind];
  if (!L) fail(404, 'Not found');
  const company = selectedCompany(userId);
  if (!company) return { items: [], total: 0, company: null };
  const where = ['companyId = ?', 'active = 1'], args = [company.id];
  const s = clip(query.search, 120).toLowerCase();
  if (s) { where.push(`(${L.search.map((f) => `lower(json_extract(data, '$.${f}')) LIKE ?`).join(' OR ')})`); args.push(...L.search.map(() => `%${s.replace(/[%_]/g, '')}%`)); }
  for (const f of L.filters) if (query[f]) { where.push(`json_extract(data, '$.${f}') = ?`); args.push(clip(query[f], 200)); }
  if (L.date && /^\d{4}-\d{2}-\d{2}$/.test(query.from || '')) { where.push(`json_extract(data, '$.${L.date}') >= ?`); args.push(query.from); }
  if (L.date && /^\d{4}-\d{2}-\d{2}$/.test(query.to || '')) { where.push(`json_extract(data, '$.${L.date}') <= ?`); args.push(query.to); }
  if (kind === 'outstandings' && query.open === '1') where.push("json_extract(data, '$.status') IN ('PENDING', 'PARTIAL', 'OVERDUE')");
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200), offset = Math.max(Number(query.offset) || 0, 0);
  const sqlWhere = where.join(' AND ');
  const total = q(`SELECT COUNT(*) AS n FROM ${L.table} WHERE ${sqlWhere}`).get(...args).n;
  const items = q(`SELECT data FROM ${L.table} WHERE ${sqlWhere} ORDER BY ${L.order} LIMIT ${limit} OFFSET ${offset}`).all(...args).map((r) => JSON.parse(r.data));
  return { items: items.map((x) => (kind === 'vouchers' ? { ...x, lines: undefined, items: undefined, bills: undefined, line_count: (x.lines || []).length, item_count: (x.items || []).length } : x)), total, company: { id: company.id, name: company.name } };
}
export function detail(userId, kind, id) {
  const L = LISTS[kind];
  const row = L && T[L.table].get(id);
  if (!row || row.userId !== userId) fail(404, 'Not found');
  if (kind === 'ledgers') {
    const vouchers = q("SELECT data FROM tvouchers WHERE companyId = ? AND active = 1 AND lower(json_extract(data, '$.party_name')) = ? ORDER BY json_extract(data, '$.voucher_date') DESC LIMIT 50").all(row.companyId, lname(row.name)).map((r) => JSON.parse(r.data)).map((v) => ({ ...v, lines: undefined, items: undefined, bills: undefined }));
    return { ...row, vouchers, outstandings: T.touts.all({ companyId: row.companyId, active: 1 }).filter((o) => lname(o.party_name) === lname(row.name) && o.status !== 'PAID') };
  }
  if (kind === 'vouchers') return { ...row, outstandings: T.touts.all({ voucherId: row.id, active: 1 }) };
  if (kind === 'stock') return { ...row, movements: q("SELECT data FROM tvouchers WHERE companyId = ? AND active = 1 AND EXISTS (SELECT 1 FROM json_each(json_extract(data, '$.items')) WHERE lower(json_extract(value, '$.stock_item_name')) = ?) ORDER BY json_extract(data, '$.voucher_date') DESC LIMIT 50").all(row.companyId, lname(row.name)).map((r) => JSON.parse(r.data)).map((v) => ({ id: v.id, voucher_type: v.voucher_type, voucher_number: v.voucher_number, voucher_date: v.voucher_date, party_name: v.party_name, lines: (v.items || []).filter((i) => lname(i.stock_item_name) === lname(row.name)) })) };
  return row;
}
// the dashboard: money owed both ways, this month's activity, stock value, who owes most, recent vouchers
export function summary(userId) {
  const company = selectedCompany(userId);
  const agents = T.tagents.all({ userId }).filter((a) => a.status !== 'DISABLED').map(publicAgent);
  const base = { company: company && { id: company.id, name: company.name, financial_year_from: company.financial_year_from, financial_year_to: company.financial_year_to, last_synced_at: company.syncedAt }, companies: companiesOf(userId).filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name })), agents };
  if (!company) return base;
  const outs = T.touts.all({ companyId: company.id, active: 1 }).filter((o) => o.status !== 'PAID' && o.status !== 'CANCELLED');
  const sum = (arr, f = (x) => x.pending_amount) => Math.round(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0) * 100) / 100;
  const rec = outs.filter((o) => o.bill_type !== 'PAYABLE'), pay = outs.filter((o) => o.bill_type === 'PAYABLE');
  const month = istDay(new Date()).slice(0, 8);
  const monthRows = q("SELECT json_extract(data, '$.voucher_type') AS t, COUNT(*) AS n, SUM(json_extract(data, '$.amount')) AS v FROM tvouchers WHERE companyId = ? AND active = 1 AND json_extract(data, '$.is_cancelled') = 0 AND json_extract(data, '$.voucher_date') >= ? GROUP BY t").all(company.id, `${month}01`);
  const byType = Object.fromEntries(monthRows.map((r) => [r.t || 'Other', { count: r.n, amount: Math.round((r.v || 0) * 100) / 100 }]));
  const debtors = new Map();
  for (const o of rec) debtors.set(o.party_name, (debtors.get(o.party_name) || 0) + (Number(o.pending_amount) || 0));
  return {
    ...base,
    receivable: { total: sum(rec), overdue: sum(rec.filter((o) => o.status === 'OVERDUE')), bills: rec.length, overdueBills: rec.filter((o) => o.status === 'OVERDUE').length },
    payable: { total: sum(pay), overdue: sum(pay.filter((o) => o.status === 'OVERDUE')), bills: pay.length },
    month: byType,
    stock: { items: T.tstock.count({ companyId: company.id, active: 1 }), value: sum(T.tstock.all({ companyId: company.id, active: 1 }), (s) => s.closing_value), low: T.tstock.all({ companyId: company.id, active: 1 }).filter((s) => s.closing_balance != null && Number(s.closing_balance) <= 0).length },
    counts: { ledgers: T.tledgers.count({ companyId: company.id, active: 1 }), vouchers: T.tvouchers.count({ companyId: company.id, active: 1 }) },
    topDebtors: [...debtors].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 })),
    recent: list(userId, 'vouchers', { limit: 8 }).items,
  };
}
// the connector installer: an admin-set link, else the one published on this server
export const INSTALLER = 'funnelhive-tally-connector-setup.exe';
const installerFile = () => path.join(dir, 'downloads', INSTALLER);
export const downloadUrl = (origin) => tallySettings().download_url || (fs.existsSync(installerFile()) ? `${origin}/downloads/${INSTALLER}` : null);

// ---------- admin ----------
// one seller: the switch, their PCs, companies, the last change and sync
export function adminSeller(u) {
  return {
    on: tallyOn(u), agents: T.tagents.all({ userId: u.id }).map(publicAgent), companies: companiesOf(u.id).map((c) => ({ id: c.id, name: c.name, last_synced_at: c.syncedAt })),
    lastCommand: (() => { const c = T.tcommands.find({ userId: u.id }, { order: 'at', desc: true }); return c ? publicCommand(c) : null; })(),
  };
}
// every connected PC on the platform, newest first, with its seller
export function adminOverview() {
  const agents = T.tagents.all({}, { order: 'lastSeenAt', desc: true, limit: 300 }).filter((a) => a.status !== 'DISABLED');
  const users = new Map();
  return {
    settings: tallySettings(),
    sellers: q("SELECT COUNT(*) AS n FROM users WHERE json_extract(data, '$.addons.tally') = 1").get().n,
    agents: agents.map((a) => { const u = users.get(a.userId) || T.users.get(a.userId); users.set(a.userId, u); return { ...publicAgent(a), seller: u ? { id: u.id, email: u.email, business: u.settings?.businessName || u.name } : null }; }),
    failed24h: T.tcommands.count({ status: 'FAILED', at: { gte: Date.now() - DAY } }),
  };
}
// what an admin may change (Admin → Plan & settings → Tally); the rest keeps its defaults
export function cleanTallySettings(b, cur = {}) {
  const out = { ...cur };
  if (b.download_url != null) {
    const v = clip(b.download_url, 500);
    if (v && !/^https:\/\/\S+$/.test(v)) fail(400, 'The download link must start with https://');
    out.download_url = v;
  }
  if (b.minimum_agent_version != null) { const v = clip(b.minimum_agent_version, 20); if (v && !/^\d+\.\d+\.\d+$/.test(v)) fail(400, 'Version looks like 1.1.0'); out.minimum_agent_version = v || DEFAULTS.minimum_agent_version; }
  if (b.force_update_agent_version != null) out.force_update_agent_version = !!b.force_update_agent_version;
  return out;
}

// ---------- jobs: connectors that stopped calling in are offline; old commands expire ----------
export function tallyJob(now = Date.now()) {
  const timeout = tallySettings().heartbeat_timeout_seconds * 1000;
  for (const a of T.tagents.all({ status: 'ONLINE', lastSeenAt: { lt: now - timeout } })) T.tagents.update(a.id, (x) => { x.status = 'OFFLINE'; });
  expireOld();
  T.tcodes.delWhere({ expiresAt: { lt: now } });
  // sync history: the last 30 days
  T.truns.delWhere({ at: { lt: now - 30 * DAY } });
}

// ---------- routes ----------
export function registerTally(app, { auth, wrap, rateLimit, isTest, secret, appUrl }) {
  SECRET = secret;
  const send = (fn) => wrap(async (req, res) => {
    try { res.json(await fn(req, res)); } catch (e) { if (e instanceof TallyError) return res.status(e.status).json({ error: e.message, message: e.message }); throw e; }
  });
  // ---- the connector ----
  const A = '/api/v1/agent/tally';
  const activateLimit = rateLimit({ windowMs: 15 * 60000, max: isTest ? 1000 : 10, message: 'Too many attempts — please wait 15 minutes.' });
  const agentLimit = rateLimit({ windowMs: 60000, max: isTest ? 100000 : 600, key: (req) => String(req.headers.authorization || req.ip).slice(-24) });
  const asAgent = (fn) => send((req) => { const { agent } = agentOf(req); return fn(agent, req.body || {}, req); });
  app.post(`${A}/activate`, activateLimit, send((req) => activate(req.body || {}, { ip: req.ip })));
  app.post(`${A}/heartbeat`, agentLimit, asAgent((agent, b) => heartbeat(agent, b)));
  app.get(`${A}/commands/pending`, agentLimit, asAgent((agent, b, req) => pendingFor(agent, req.query.limit)));
  app.post(`${A}/commands/:id/result`, agentLimit, asAgent((agent, b, req) => submitResult(agent, req.params.id, b)));
  const records = (b, max) => { if (!Array.isArray(b.records) || b.records.length > max) fail(400, `records: up to ${max} at a time`); return b.records; };
  app.post(`${A}/sync/companies`, agentLimit, asAgent((agent, b) => syncCompanies(agent, records(b, 500))));
  for (const [path, fn, max] of [['ledgers', syncLedgers, 500], ['vouchers', syncVouchers, 5000], ['outstandings', syncOutstandings, 5000], ['units', syncUnits, 500], ['godowns', syncGodowns, 500], ['stock-items', syncStockItems, 500]]) {
    app.post(`${A}/sync/${path}`, agentLimit, asAgent((agent, b) => fn(agent, clip(b.company_guid, 500) || fail(400, 'company_guid is required'), records(b, max), b.reconcile === true, b.reconcile_before || null)));
  }

  // the installer (public: it holds nothing account-specific; connecting needs a code from a signed-in seller)
  app.get(`/downloads/${INSTALLER}`, (req, res) => {
    if (!fs.existsSync(installerFile())) return res.status(404).type('text').send('The Tally connector isn’t published on this server yet.');
    res.download(installerFile(), INSTALLER);
  });

  // ---- the seller (/api/tally is the 'tally' team area in team.js) ----
  const S = '/api/tally';
  const on = (req, res, next) => (tallyOn(req.user) ? next() : res.status(403).json({ error: 'Tally isn’t switched on for your account — ask us to turn it on', code: 'TALLY_OFF' }));
  const origin = (req) => String(process.env.APP_URL || appUrl(req)).replace(/\/+$/, '');
  app.get(S, auth, send((req) => ({
    on: tallyOn(req.user), download: downloadUrl(origin(req)), groups: STANDARD_GROUPS, voucherTypes: VOUCHER_TYPES,
    ...(tallyOn(req.user) ? { agents: T.tagents.all({ userId: req.user.id }).filter((a) => a.status !== 'DISABLED').map(publicAgent), companies: companiesOf(req.user.id).filter((c) => c.active !== false).map((c) => ({ id: c.id, name: c.name, tally_guid: c.tally_guid, financial_year_from: c.financial_year_from, financial_year_to: c.financial_year_to, last_synced_at: c.syncedAt })), companyId: selectedCompany(req.user.id)?.id || null } : {}),
  })));
  const codeLimit = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 10, key: (req) => req.user.id });
  app.post(`${S}/connect-code`, auth, on, codeLimit, send((req) => connectCode(req.user.id)));
  app.post(`${S}/agents/:id/disconnect`, auth, on, send((req) => {
    const a = T.tagents.get(req.params.id);
    if (!a || a.userId !== req.user.id) fail(404, 'PC not found');
    T.tagents.update(a.id, (x) => { x.status = 'DISABLED'; x.tokenHash = `off-${uid()}`; });
    return { ok: true };
  }));
  app.post(`${S}/companies/:id/select`, auth, on, send((req) => ({ ok: true, companyId: selectCompany(req.user.id, req.params.id).id })));
  app.get(`${S}/summary`, auth, on, send((req) => summary(req.user.id)));
  for (const kind of Object.keys(LISTS)) {
    app.get(`${S}/${kind}`, auth, on, send((req) => list(req.user.id, kind, req.query)));
    app.get(`${S}/${kind}/:id`, auth, on, send((req) => detail(req.user.id, kind, req.params.id)));
  }
  app.get(`${S}/sync-runs`, auth, on, send((req) => T.truns.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 50 }).map(({ userId, ...r }) => r)));
  const writeLimit = rateLimit({ windowMs: 60000, max: isTest ? 1000 : 30, key: (req) => req.user.id, message: 'Too many Tally changes at once — wait a minute.' });
  app.post(`${S}/commands`, auth, on, writeLimit, send((req) => publicCommand(queueCommand(req.user.id, clip(req.body?.type, 40), req.body?.payload, { by: req.actor ? 'member' : 'user', byId: (req.actor || req.user).id }))));
  app.post(`${S}/sync`, auth, on, writeLimit, send((req) => {
    const type = ['SYNC_FULL', 'SYNC_LEDGERS', 'SYNC_VOUCHERS', 'SYNC_OUTSTANDINGS', 'SYNC_INVENTORY'].includes(req.body?.type) ? req.body.type : 'SYNC_FULL';
    return publicCommand(queueCommand(req.user.id, type, {}, { by: 'user', priority: 3 }));
  }));
  app.get(`${S}/commands`, auth, on, send((req) => T.tcommands.all({ userId: req.user.id }, { order: 'at', desc: true, limit: 50 }).filter((c) => c.by !== 'system').map(publicCommand)));
  app.get(`${S}/commands/:id`, auth, on, send((req) => { const c = T.tcommands.get(req.params.id); if (!c || c.userId !== req.user.id) fail(404, 'Not found'); return publicCommand(c); }));

  if (JOBS && !isTest) setInterval(() => { try { tallyJob(); } catch (e) { console.error('Tally job failed', e.message); } }, 15000).unref();
}
export { TallyError, hmac as _hmac };
