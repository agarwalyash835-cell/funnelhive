// Tally ↔ CRM: customer and supplier ledgers (Sundry Debtors / Creditors) with a phone or an email become CRM contacts,
// tagged tally-customer / tally-supplier, with the ledger's balance on them — so a manufacturer's dealers or a trader's
// retailers are in the CRM, the inbox and campaigns without typing them in twice. A contact that already exists keeps
// its own name and details; the link only adds the tag, the Tally fields and a timeline note the first time.
// On by default; the seller can turn it off on the Tally page (u.tally.contacts = false).
import { T, contactKey } from './db.js';
import { ensureMeta, logActivity } from './crm.js';
import { onLedgersSynced } from './tally.js';

const PARTY = /(sundry\s+debtors|sundry\s+creditors)/i;
export const partyType = (l) => (/creditor/i.test(`${l.ledger_group || ''} ${l.parent || ''}`) ? 'supplier' : 'customer');
const isParty = (l) => PARTY.test(`${l.ledger_group || ''} ${l.parent || ''}`);
const cleanPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

export function linkLedgers(userId, company, ledgers) {
  if (T.users.get(userId)?.tally?.contacts === false) return 0;
  let linked = 0;
  for (const l of ledgers) {
    if (!isParty(l)) continue;
    const email = String(l.email || '').trim().toLowerCase(), phone = cleanPhone(l.phone);
    if (!email && !phone) continue;
    const key = contactKey(email, phone);
    const m = ensureMeta(userId, key);
    const first = !m.tally;
    const type = partyType(l);
    if (!m.name && !m.email && !m.phone) Object.assign(m, { manual: true, name: l.mailing_name || l.name, email, phone, at: m.at || Date.now() });
    m.tags = [...new Set([...(m.tags || []), `tally-${type}`])].slice(0, 20);
    m.tally = { ledgerId: l.id, ledger: l.name, company: company.name, group: l.ledger_group || l.parent || null, balance: l.closing_balance ?? null, type, syncedAt: Date.now() };
    T.crm.put(m);
    if (first) logActivity(userId, key, { type: 'note', title: `Linked to the Tally ledger ${l.name}`, text: `${company.name} · ${l.ledger_group || l.parent || ''}`, by: 'Tally' });
    linked++;
  }
  return linked;
}
onLedgersSynced((userId, company, ledgers) => { try { linkLedgers(userId, company, ledgers); } catch (e) { console.error('Tally → CRM failed', e.message); } });
