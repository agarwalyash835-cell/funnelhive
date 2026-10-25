// Checks the campaign templates (server/campaign-templates/*.js): node scripts/check-campaign-templates.mjs [file-part]
import { catalog } from '../campaigntpl.js';
const only = process.argv[2] || '';
const { byIndustry, errors } = await catalog({ fresh: true });
const mine = errors.filter((e) => !only || e.includes(only));
for (const [ind, list] of Object.entries(byIndustry)) console.log(`${ind.padEnd(14)} ${list.length} templates`);
if (mine.length) { console.log(`\n${mine.length} problem(s):\n${mine.join('\n')}`); process.exit(1); }
console.log('\nAll good.');
