// Measures the page-view rollup on a seeded database (scripts/seed-load.mjs): rows before / after, time taken,
// whether a seller's reports stay identical, and how fast a 365-day report runs.
//   DATA_DIR=/tmp/ff-load node scripts/rollup-bench.mjs [keepDays=30]
process.env.EVENTS_FLUSH_MS = '0';
const KEEP = Number(process.argv[2] || 30);
const { q, T } = await import('../db.js');
const A = await import('../analytics.js');
const { rollupEvents } = await import('../rollup.js');
const { reportRange } = await import('../time.js');

const OFF = 330 * 60000, now = Date.now();
const sellers = q('SELECT id FROM users LIMIT 1000').all().map((r) => r.id);
const sample = sellers.filter((_, i) => i % 50 === 0); // 20 sellers
const report = () => sample.map((id) => {
  const { from, to } = reportRange(365, now, OFF);
  const f = T.funnels.all({ userId: id })[0];
  const s = A.stepCounts(f.id, from);
  return { t: A.totals({ userId: id }, from, to).views, d: A.series({ userId: id }, from, 365, OFF).reduce((n, x) => n + x.views, 0), src: A.sources({ userId: id }, from).map((x) => `${x.source}:${x.views}`).sort().join(','), step: s(f.steps[0].id, 'view') + s(f.steps[0].id, 'convert') };
});
const time = (fn) => { const t0 = performance.now(); const r = fn(); return [r, performance.now() - t0]; };

const raw0 = q('SELECT COUNT(*) AS n FROM events').get().n;
const [before, tBefore] = time(report);
const t0 = performance.now(); await rollupEvents(now, KEEP); const tRoll = performance.now() - t0;
const raw1 = q('SELECT COUNT(*) AS n FROM events').get().n, days = q('SELECT COUNT(*) AS n FROM pv_days').get().n, vis = q('SELECT COUNT(*) AS n FROM pv_visitors').get().n;
const [after, tAfter] = time(report);
const same = JSON.stringify(before.map((x) => [x.t, x.d, x.src, x.step])) === JSON.stringify(after.map((x) => [x.t, x.d, x.src, x.step]));
console.log(`raw page views: ${raw0.toLocaleString()} → ${raw1.toLocaleString()} (kept the last ${KEEP} days)`);
console.log(`daily-total rows: ${days.toLocaleString()} + ${vis.toLocaleString()} visitor rows (replacing ${(raw0 - raw1).toLocaleString()} raw rows)`);
console.log(`rollup took ${(tRoll / 1000).toFixed(1)} s`);
console.log(`365-day reports for 20 sellers: ${tBefore.toFixed(0)} ms before, ${tAfter.toFixed(0)} ms after`);
console.log(`views, daily chart, sources and step counts identical: ${same ? 'YES' : 'NO'}`);
if (!same) for (let i = 0; i < before.length; i++) if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) { console.log('first difference', before[i], after[i]); break; }
