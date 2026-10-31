// One agency model: moves each agency's terms from the old fields (user.partner{}, user.agencyMaxClients, the Agency
// plan) into user.agency (see agency-terms.js). Safe to run more than once: accounts already moved are skipped.
//   node scripts/migrate-agencies.mjs            dry run: prints each agency, its client count and wallet balance
//                                                before → after; writes nothing
//   node scripts/migrate-agencies.mjs --apply    backs the database up first (backups/before-agency-migration-*.db),
//                                                then writes, then prints the same table
// Uses DATA_DIR like the server. Client counts and wallet balances must be the same before and after; the script
// exits with code 1 if any differ.
process.env.FF_JOBS = '0'; // no background jobs in this process
const apply = process.argv.includes('--apply');
const { migrateAgencies, backupBeforeMigration } = await import('../agency-terms.js');

if (apply) console.log(`Backup: ${backupBeforeMigration()}`);
const rows = migrateAgencies({ apply });
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${apply ? 'APPLIED' : 'DRY RUN'} — ${rows.length} agenc${rows.length === 1 ? 'y' : 'ies'}, ${rows.filter((r) => r.changed).length} to move`);
console.log(`${pad('account', 34)} ${pad('kind', 9)} ${pad('max', 5)} ${pad('clients before→after', 21)} ${pad('wallet ₹ before→after', 26)} change`);
let bad = 0;
for (const r of rows) {
  const same = r.before.clients === r.after.clients && r.before.wallet === r.after.wallet;
  if (!same) bad++;
  console.log(`${pad(r.email, 34)} ${pad(r.kind, 9)} ${pad(r.maxClients ?? 'plan', 5)} ${pad(`${r.before.clients} → ${r.after.clients}`, 21)} ${pad(`${r.before.wallet} → ${r.after.wallet}`, 26)} ${r.changed ? (apply ? 'moved' : 'will move') : 'already done'}${same ? '' : '  ← MISMATCH'}`);
}
if (bad) { console.error(`${bad} agenc${bad === 1 ? 'y has' : 'ies have'} different client counts or balances — check before going on`); process.exit(1); }
if (!apply && rows.some((r) => r.changed)) console.log('\nNothing was written. Run again with --apply to move them (a backup is taken first).');
