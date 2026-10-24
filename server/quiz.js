// Quiz funnels: a quiz block asks a few questions, then the contact form, then shows a result (outcome) with its own
// offer. The outcome is worked out here from the block as saved — never trusted from the browser — and the answers,
// outcome and tags land on the lead and the CRM contact, so automations, pipelines and “Send to Meta” can use them.
import { q } from './db.js';
import { rawFrom } from './rollup.js';

export const QUIZ_MAX = { questions: 20, answers: 8, outcomes: 8 };
const tagOf = (v) => String(v || '').trim().slice(0, 30);

// picks: one entry per question, each a list of answer indexes ([1] or, for “pick all that apply”, [0, 2])
export function scoreQuiz(block, picks) {
  const p = block?.props || {};
  const qs = (p.questions || []).slice(0, QUIZ_MAX.questions);
  const outcomes = (p.outcomes || []).slice(0, QUIZ_MAX.outcomes);
  if (!qs.length || !outcomes.length || !Array.isArray(picks)) return null;
  const votes = outcomes.map(() => 0);
  const answers = [], tags = new Set();
  let score = 0;
  qs.forEach((qq, i) => {
    const list = (qq.answers || []).slice(0, QUIZ_MAX.answers);
    const raw = Array.isArray(picks[i]) ? picks[i] : [picks[i]];
    const idx = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < list.length))].slice(0, qq.multi ? list.length : 1);
    const chosen = idx.map((n) => list[n]);
    for (const a of chosen) {
      score += Number(a.points) || 0;
      const o = Number(a.outcome);
      if (Number.isInteger(o) && o >= 0 && o < votes.length) votes[o] += 1;
      if (tagOf(a.tag)) tags.add(tagOf(a.tag));
    }
    answers.push({ q: String(qq.q || `Question ${i + 1}`).slice(0, 200), a: chosen.map((a) => String(a.text || '').slice(0, 200)).join(', ') });
  });
  let win = 0;
  if (p.scoring === 'points') {
    // the outcome with the highest “from” score that this score reaches (the lowest one if none)
    const order = outcomes.map((o, i) => [Number(o.min) || 0, i]).sort((x, y) => x[0] - y[0]);
    win = order[0][1];
    for (const [min, i] of order) if (score >= min) win = i;
  } else {
    // most answers pointing at it; a tie goes to the one listed first
    votes.forEach((v, i) => { if (v > votes[win]) win = i; });
  }
  const o = outcomes[win];
  if (tagOf(o.tag)) tags.add(tagOf(o.tag));
  return { index: win, outcome: String(o.title || `Result ${win + 1}`).slice(0, 120), score, answers, tags: [...tags].slice(0, 20) };
}

// what the visitor sees after the form: their outcome's result card (nothing else of the block leaves the server)
export const resultView = (block, r) => {
  const o = block.props.outcomes[r.index] || {};
  return { index: r.index, title: o.title || '', body: o.body || '', image: o.image || '', buttonText: o.buttonText || '', url: o.url || '', score: block.props.showScore ? r.score : undefined };
};

// started / reached question n / finished, per quiz block (the block id and step are in the event's variant)
export function quizCounts(funnelId, from) {
  const m = {};
  for (const r of q("SELECT type, variant, COUNT(DISTINCT COALESCE(visitor, at)) AS v FROM events WHERE funnelId = ? AND type IN ('quiz_start', 'quiz_answer', 'quiz_done') AND at >= ? GROUP BY type, variant").all(funnelId, rawFrom(from))) m[`${r.type}|${r.variant}`] = r.v;
  return (block) => {
    const id = block.id, p = block.props || {};
    const started = m[`quiz_start|${id}`] || 0;
    const questions = (p.questions || []).map((qq, i) => ({ q: qq.q || `Question ${i + 1}`, answered: m[`quiz_answer|${id}:${i}`] || 0 }));
    const outcomes = (p.outcomes || []).map((o, i) => ({ title: o.title || `Result ${i + 1}`, n: m[`quiz_done|${id}:${i}`] || 0 }));
    const finished = outcomes.reduce((n, o) => n + o.n, 0);
    return { id, title: p.title || 'Quiz', started, finished, rate: started ? Math.round((finished / started) * 1000) / 10 : 0, questions, outcomes };
  };
}
