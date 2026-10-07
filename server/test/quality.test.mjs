// The quality gate's promise: whatever the AI returns, the seller gets a funnel at template level.
// Stress test: damage every template in random ways and check the top-up always reaches zero issues.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let Q, M;
before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-quality-'));
  process.env.NODE_ENV = 'test';
  M = await import('../templates.js');
  Q = await import('../quality.js');
});

// deterministic pseudo-random numbers so a failure can be reproduced
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

function damage(f) {
  const n = 3 + Math.floor(rnd() * 10);
  for (let i = 0; i < n; i++) {
    const st = pick(f.steps);
    const b = st.blocks.length ? pick(st.blocks) : null;
    switch (Math.floor(rnd() * 11)) {
      case 0: if (b) st.blocks.splice(st.blocks.indexOf(b), 1); break; // section missing
      case 1: if (f.steps.length > 1) f.steps.splice(f.steps.indexOf(st), 1); break; // page missing
      case 2: if (b) { const k = pick(Object.keys(b.props)); b.props[k] = ''; } break; // field emptied
      case 3: if (b) { const k = Object.keys(b.props).find((x) => Array.isArray(b.props[x])); if (k) b.props[k] = b.props[k].slice(0, 1); } break; // short list
      case 4: if (b) { const k = Object.keys(b.props).find((x) => typeof b.props[x] === 'string'); if (k) b.props[k] = 'Your Product — Benefit one [link]'; } break; // placeholder
      case 5: if (b && 'price' in b.props) b.props.price = Math.round(rnd() * 5000) + 1; break; // price drift
      case 6: if (b && 'mrp' in b.props) b.props.mrp = 1; break; // mrp below price
      case 7: f.theme = { style: 'neon', primary: 'red', secondary: '' }; break; // bad theme
      case 8: st.blocks.reverse(); break; // out of order
      case 9: if (b?.type === 'hero') b.props.headline = 'Hi'; break; // weak headline
      case 10: if (b?.type === 'testimonials') b.props.items = b.props.items.map((x) => ({ ...x, name: 'Happy Customer' })); break;
      default: break;
    }
  }
  return f;
}

test('every template passes the bar it defines', () => {
  for (const t of M.allTemplates()) {
    const f = M.getTemplate(t.id); f.theme = t.theme;
    assert.deepEqual(Q.audit(f, Q.blueprintOf(t)), [], t.id);
  }
});

test('stress: 530 randomly damaged funnels always come back to zero issues', () => {
  let damagedIssues = 0;
  for (let round = 0; round < 10; round++) {
    for (const t of M.allTemplates()) {
      const prompt = `${t.name} for customers in Pune, ₹${999 + round * 500}`;
      const bp = Q.blueprintOf(t);
      const draft = damage(M.getTemplate(t.id));
      draft.theme = round % 2 ? t.theme : draft.theme;
      damagedIssues += Q.audit(draft, bp).length;
      const fixed = structuredClone(draft);
      Q.enforce(fixed, M.matchTemplate(prompt), bp);
      const left = Q.audit(fixed, bp);
      assert.deepEqual(left.map((i) => `${i.type}: ${i.msg}`), [], `${t.id} round ${round}`);
    }
  }
  assert.ok(damagedIssues > 1000, `the damage was real (${damagedIssues} issues injected)`);
});

test('content the AI got right is kept, not overwritten by the template', () => {
  const t = M.allTemplates().find((x) => x.id === 'sweets');
  const f = M.getTemplate('sweets'); f.theme = t.theme;
  const hero = f.steps[0].blocks.find((b) => b.type === 'hero');
  hero.props.headline = 'Custom birthday cakes baked fresh in Pune — *delivered in 3 hours*';
  f.steps[0].blocks = f.steps[0].blocks.filter((b) => b.type !== 'faq'); // one section missing
  const filled = Q.enforce(f, M.matchTemplate('Home bakery in Pune, ₹899'), Q.blueprintOf(t));
  assert.deepEqual(filled, ['sales: faq section']);
  assert.equal(f.steps[0].blocks.find((b) => b.type === 'hero').props.headline, 'Custom birthday cakes baked fresh in Pune — *delivered in 3 hours*');
});

test('templates are genuinely different: own page plan, layouts and style', () => {
  const L = M.allTemplates();
  const plan = (t) => t.steps[0].blocks.map((b) => `${b.type}:${b.props.variant || ''}`).join(',');
  assert.equal(new Set(L.map(plan)).size, L.length, 'no two landing pages share the same sections, order and layouts');
  assert.ok(new Set(L.map((t) => t.style)).size >= 10, 'at least 10 visual styles in use');
  assert.equal(new Set(L.map((t) => t.hero.props.variant)).size, 4, 'all four hero designs in use');
  const headings = new Set(L.map((t) => t.steps[0].blocks.find((b) => b.type === 'features')?.props.title));
  assert.ok(headings.size >= 12, `section headings are written per kind of business (${headings.size} different)`);
});
