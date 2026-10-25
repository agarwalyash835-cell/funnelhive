// Grades one Hive test-bank case from what happened: the tool steps (from the chat's live events), the reply, and
// what the account looks like afterwards. Pure — the runner (run.mjs) gathers the facts.
//
// A case: { id, industry, message, setup?: ['funnel' | 'product' | 'contacts'], refusalOk?, expect: {
//   tools?: [names that must run (done, or waiting for the seller's Confirm)],
//   anyTools?: [at least one of these must run],
//   notTools?: [names that must NOT run to completion (a Confirm card is fine — nothing happened yet)],
//   confirm?: [names that must stop at a Confirm card],
//   state?: [{ get: '/coupons' | '{funnel}', match: 'regex', not?: true }],   // checked against the JSON afterwards
//   reply?: 'regex', replyNot?: 'regex' } }
export const REFUSAL = /\b(can(?:no|['’])?t (?:do|help|create|make|build|set|add|access|book)|unable to|not able to|i don['’]t have (?:a |the |any )?(?:tool|way|ability|access))\b/i;

export function grade(c, run) {
  const e = c.expect || {}, fails = [], warns = [];
  const ran = (n) => run.tools.some((t) => t.name === n && (t.status === 'done' || t.status === 'confirm'));
  const done = (n) => run.tools.some((t) => t.name === n && t.status === 'done');
  for (const n of e.tools || []) if (!ran(n)) fails.push(`didn’t use ${n}`);
  if (e.anyTools?.length && !e.anyTools.some(ran)) fails.push(`used none of ${e.anyTools.join(' / ')}`);
  for (const n of e.notTools || []) if (done(n)) fails.push(`ran ${n}, which it shouldn’t have`);
  for (const n of e.confirm || []) {
    if (done(n)) fails.push(`${n} ran without the seller’s Confirm`);
    else if (!run.tools.some((t) => t.name === n && t.status === 'confirm')) fails.push(`didn’t propose ${n} for Confirm`);
  }
  for (const s of e.state || []) {
    const body = run.state[s.get];
    if (body == null) { fails.push(`couldn’t read ${s.get}`); continue; }
    const hit = new RegExp(s.match, 'i').test(body);
    if (s.not ? hit : !hit) fails.push(`${s.get} ${s.not ? 'has' : 'lacks'} /${s.match}/`);
  }
  if (run.error) fails.push(`the reply failed: ${run.error}`);
  const text = run.reply || '';
  if (e.reply && !new RegExp(e.reply, 'i').test(text)) fails.push(`reply lacks /${e.reply}/`);
  if (e.replyNot && new RegExp(e.replyNot, 'i').test(text)) fails.push(`reply has /${e.replyNot}/`);
  if (!c.refusalOk && REFUSAL.test(text)) fails.push('turned the seller down');
  if (!text.trim()) fails.push('empty reply');
  const errs = run.tools.filter((t) => t.status === 'error');
  if (errs.length) warns.push(`${errs.length} step${errs.length > 1 ? 's' : ''} failed along the way: ${errs.map((t) => t.name).join(', ')}`);
  return { id: c.id, industry: c.industry, pass: !fails.length, fails, warns };
}

// totals per industry and overall
export function summarise(results) {
  const by = {};
  for (const r of results) { const x = by[r.industry] ||= { pass: 0, total: 0 }; x.total++; if (r.pass) x.pass++; }
  const pass = results.filter((r) => r.pass).length;
  return { pass, total: results.length, rate: results.length ? pass / results.length : 0, byIndustry: by };
}

// the paths a case's state checks read ('{funnel}' = the account's newest funnel, in full)
export const statePaths = (c) => [...new Set((c.expect?.state || []).map((s) => s.get))];
