// One agency model. An agency is an account with client accounts under it (client.agencyId = the agency, one level
// deep). What the platform allows an agency is kept in one place, user.agency:
//   kind        'agency'   — runs its clients' accounts, covered by its own plan (the Agency plan, or comped)
//               'reseller' — also sells its own plans / AI-credit packs to its clients and pays the platform
//                            wholesale from a prepaid wallet (partners.js)
//   maxClients  how many client accounts (null = what its plan includes, see agency.js clientLimit)
//   addons      add-ons the agency may switch on for its clients (['tally', 'inventory']); [] = none
//   seatCap     team seats per client account (null = the platform's team limit)
//   rates       { perAccount: ₹ per active client every 30 days, creditRate: ₹ per 100 AI credits used } (resellers)
//   status      'active' | 'suspended' (the platform turned its agency tools off: no new clients, no entering them)
//   hold        when its wallet went overdrawn (resellers; see partners.js checkHold), else null
// Accounts from before this model keep their terms in user.partner{} / user.agencyMaxClients until the migration
// (scripts/migrate-agencies.mjs) moves them here; termsOf() reads either, setTerms() always writes the new shape.
import { T, q, sql, dir } from './db.js';
import fs from 'node:fs';
import path from 'node:path';

export const AGENCY_KINDS = ['agency', 'reseller'];
export const AGENCY_ADDONS = ['tally', 'inventory'];
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => Math.min(10000000, Math.max(0, r2(Number(n) || 0)));
const intOr = (v, lo, hi, d) => { if (v === null || v === '' || v === undefined) return d; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function normalize(a = {}) {
  const kind = AGENCY_KINDS.includes(a.kind) ? a.kind : 'agency';
  return {
    kind,
    maxClients: intOr(a.maxClients, 1, 10000, kind === 'reseller' ? 50 : null),
    addons: Array.isArray(a.addons) ? [...new Set(a.addons.filter((x) => AGENCY_ADDONS.includes(x)))] : [],
    seatCap: intOr(a.seatCap, 1, 1000, null),
    rates: { perAccount: money(a.rates?.perAccount), creditRate: money(a.rates?.creditRate) },
    status: a.status === 'suspended' ? 'suspended' : 'active',
    hold: a.hold || null,
    since: a.since || null,
  };
}
// the pre-unification fields, read as terms
function legacyTerms(u) {
  const p = u.partner;
  if (!p && !u.agencyMaxClients) return null;
  return normalize({
    kind: p?.enabled ? 'reseller' : 'agency',
    maxClients: u.agencyMaxClients ?? p?.maxAccounts ?? null,
    rates: { perAccount: p?.perAccount ?? 0, creditRate: p?.creditRate ?? 0 },
    hold: p?.hold || null, since: p?.since || null,
  });
}
// an account's agency terms, or null when the platform never set any
export function termsOf(u) {
  if (!u) return null;
  if (u.agency && typeof u.agency === 'object') return normalize(u.agency);
  return legacyTerms(u);
}
export const isReseller = (u) => termsOf(u)?.kind === 'reseller';
// change an account's terms (fn edits a copy); writes the new shape and drops the old fields
export function setTerms(userId, fn) {
  return T.users.update(userId, (x) => {
    const t = termsOf(x) || normalize({});
    fn(t);
    x.agency = normalize(t);
    delete x.partner; delete x.agencyMaxClients;
  });
}
// the old partner-terms shape the current screens read, plus the unified fields
export const termsView = (u) => {
  const t = termsOf(u) || normalize({});
  return { enabled: t.kind === 'reseller', perAccount: t.rates.perAccount, creditRate: t.rates.creditRate, maxAccounts: t.maxClients ?? 50, since: t.since, hold: t.hold, kind: t.kind, maxClients: t.maxClients, addons: t.addons, seatCap: t.seatCap, status: t.status };
};
// the body of an admin's "set terms" call (old field names accepted: enabled, maxAccounts, perAccount, creditRate)
export function termsPatch(t, b = {}) {
  const was = t.kind === 'reseller' && t.since;
  if ('kind' in b && AGENCY_KINDS.includes(b.kind)) t.kind = b.kind;
  else if ('enabled' in b || !('kind' in b)) t.kind = b.enabled === false ? 'agency' : 'reseller';
  if ('maxClients' in b || 'maxAccounts' in b) t.maxClients = intOr(b.maxClients ?? b.maxAccounts, 1, 10000, t.kind === 'reseller' ? 50 : null);
  if (t.kind === 'reseller' && t.maxClients == null) t.maxClients = 50;
  // a new reseller starts on the standard wholesale rates unless the platform gave others
  if ('perAccount' in b) t.rates.perAccount = money(b.perAccount); else if (t.kind === 'reseller' && !was) t.rates.perAccount ||= 499;
  if ('creditRate' in b) t.rates.creditRate = money(b.creditRate); else if (t.kind === 'reseller' && !was) t.rates.creditRate ||= 25;
  if (Array.isArray(b.addons)) t.addons = b.addons;
  if ('seatCap' in b) t.seatCap = b.seatCap;
  if (b.status === 'suspended' || b.status === 'active') t.status = b.status;
  t.since ||= Date.now();
  return t;
}

// ---------- the client accounts under an agency (indexed column) ----------
export const clientsOf = (agencyId) => (agencyId ? T.users.all({ agencyId }) : []);
// team seats in a client account: refused when its agency set a cap (the agency's own row doesn't count)
export function seatCapError(owner) {
  if (!owner?.agencyId) return null;
  const cap = termsOf(T.users.get(owner.agencyId))?.seatCap;
  if (!cap) return null;
  const used = T.members.all({ ownerId: owner.id }).filter((m) => m.role !== 'agency').length;
  return used >= cap ? `This account’s plan includes ${cap} team seat${cap > 1 ? 's' : ''} — ask your agency for more` : null;
}

// ---------- migration: partner{} / agencyMaxClients / Agency-plan accounts → user.agency ----------
const isAgencyPlanUser = (u) => /^agency_/.test(u?.billing?.interval || u?.billing?.pending?.interval || '');
const balance = (id) => r2(q("SELECT COALESCE(SUM(json_extract(data, '$.amount')), 0) AS n FROM partnerLedger WHERE partnerId = ?").get(id).n);
// Every account that is (or was) an agency: legacy terms, the Agency plan, a white-label brand, or client accounts.
// apply=false only reports. Idempotent: an account already on the new shape is left alone.
export function migrateAgencies({ apply = false } = {}) {
  const ids = new Set([
    ...q("SELECT id FROM users WHERE json_extract(data, '$.partner') IS NOT NULL OR json_extract(data, '$.agencyMaxClients') IS NOT NULL OR json_extract(data, '$.settings.whiteLabel.brand') IS NOT NULL OR json_extract(data, '$.billing.interval') LIKE 'agency_%' OR json_extract(data, '$.agency') IS NOT NULL").all().map((r) => r.id),
    ...q("SELECT DISTINCT json_extract(data, '$.agencyId') AS id FROM users WHERE json_extract(data, '$.agencyId') IS NOT NULL").all().map((r) => r.id),
  ]);
  const rows = [];
  for (const id of ids) {
    const u = T.users.get(id);
    if (!u || u.agencyId) continue; // a client account isn't an agency (one level deep)
    // clients counted both by the JSON field and the indexed column: they must agree after the startup backfill
    const before = { clients: q("SELECT COUNT(*) AS n FROM users WHERE json_extract(data, '$.agencyId') = ?").get(id).n, wallet: balance(id) };
    const done = !!(u.agency && typeof u.agency === 'object' && !u.partner && u.agencyMaxClients == null);
    const next = termsOf(u) || normalize({ kind: 'agency' });
    if (!done && apply) T.users.update(id, (x) => { x.agency = { ...next, migratedAt: Date.now() }; delete x.partner; delete x.agencyMaxClients; });
    const after = { clients: clientsOf(id).length, wallet: balance(id) };
    rows.push({ id, email: u.email, kind: next.kind, maxClients: next.maxClients, agencyPlan: isAgencyPlanUser(u), changed: !done, before, after });
  }
  return rows;
}
// a copy of the database before the migration writes anything (SQLite's VACUUM INTO: consistent while running)
export function backupBeforeMigration() {
  const d = path.join(dir, 'backups');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `before-agency-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  sql.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  return f;
}
