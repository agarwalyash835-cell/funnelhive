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
      case 10: if (b?.type === 'testimonials' && Array.isArray(b.props.items)) b.props.items = b.props.items.map((x) => ({ ...x, name: 'Happy Customer' })); break;
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

test('stress: 1,030 randomly damaged funnels always come back to zero issues', () => {
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

test('the AI may go beyond the template: extra pages and sections are kept, and pass', () => {
  const t = M.allTemplates().find((x) => x.id === 'sweets');
  const bp = Q.blueprintOf(t);
  const f = M.getTemplate('sweets'); f.theme = { ...t.theme, headingFont: 'Playfair Display', radius: 'sharp' };
  const quiz = { id: 'q1', type: 'landing', name: 'Find your cake', slug: 'quiz', blocks: [{ id: 'x', type: 'html', props: { code: '<div>Cake finder</div>' } }] };
  f.steps.splice(1, 0, quiz);
  f.steps[0].blocks.splice(2, 0, { id: 'y', type: 'html', props: { code: '<div>Flavour slider</div>' } });
  assert.deepEqual(Q.alignSteps(f.steps, bp).includes(-1), false);
  assert.deepEqual(Q.audit(f, bp), [], 'an extra page and a custom section are not problems');
  f.steps[0].blocks = f.steps[0].blocks.filter((b) => b.type !== 'faq');
  Q.enforce(f, M.matchTemplate('Home bakery in Pune, ₹899'), bp);
  assert.ok(f.steps.some((s) => s.slug === 'quiz'), 'the extra page survives the top-up');
  assert.ok(f.steps[0].blocks.some((b) => b.id === 'y'), 'the custom section survives the top-up');
  assert.deepEqual([f.theme.headingFont, f.theme.radius], ['Playfair Display', 'sharp'], 'the AI’s fonts survive the top-up');
  assert.deepEqual(Q.audit(f, bp), []);
});

test('no made-up "was" prices: a missing or lower mrp is left blank, never invented', () => {
  const t = M.allTemplates().find((x) => x.id === 'sweets');
  const bp = Q.blueprintOf(t);
  const f = M.getTemplate('sweets'); f.theme = t.theme;
  const withMrp = f.steps.flatMap((s) => s.blocks).filter((b) => 'mrp' in b.props);
  assert.ok(withMrp.length);
  for (const b of withMrp) b.props.mrp = '';
  assert.deepEqual(Q.audit(f, bp), [], 'no "was" price is fine');
  withMrp[0].props.mrp = 1;
  Q.enforce(f, M.matchTemplate('Home bakery in Pune, ₹899'), bp);
  const after = f.steps.flatMap((s) => s.blocks).filter((b) => 'mrp' in b.props).map((b) => b.props.mrp);
  assert.deepEqual(after, after.map(() => ''), 'the bad one is cleared and none is made up');
  assert.deepEqual(Q.audit(f, bp), []);
});

test('templates are genuinely different: own page plan, layouts and style', async () => {
  const L = M.allTemplates();
  const plan = (t) => t.steps[0].blocks.map((b) => `${b.type}:${b.props.variant || ''}`).join(',');
  assert.equal(new Set(L.map(plan)).size, L.length, 'no two landing pages share the same sections, order and layouts');
  assert.ok(new Set(L.map((t) => t.style)).size >= 10, 'at least 10 visual styles in use');
  const { VARIANTS, PAGE_STYLES } = await import('../page-styles.js');
  // the full-screen video hero needs the seller's own footage, so no template starts with it
  assert.equal(new Set(L.map((t) => t.hero.props.variant)).size, VARIANTS.hero.filter((v) => v !== 'bgvideo').length, 'every hero design in use');
  assert.equal(new Set(L.map((t) => t.style)).size, PAGE_STYLES.length, 'every page style in use');
  const looks = L.map((t) => `${t.style}/${t.hero.props.variant}`);
  assert.deepEqual(looks.filter((x, i) => looks.indexOf(x) !== i), [], 'no two templates share a style + hero design');
  const headings = new Set(L.map((t) => t.steps[0].blocks.find((b) => b.type === 'features')?.props.title));
  assert.ok(headings.size >= 12, `section headings are written per kind of business (${headings.size} different)`);
});

test('gallery order: neighbouring cards never share a style or hero design, and funnel types stay mixed', () => {
  const G = M.templateList();
  assert.equal(G.length, M.allTemplates().length);
  for (let i = 1; i < G.length; i++) {
    for (const k of [1, 2, 3]) {
      const a = G[i], b = G[i - k];
      if (!b) continue;
      assert.ok(a.style !== b.style || a.hero.props.variant !== b.hero.props.variant, `${b.id} and ${a.id} look alike`);
      if (k === 1) assert.notEqual(a.style, b.style, `${b.id} and ${a.id} sit side by side with the same style`);
    }
  }
  // every block of 12 cards (three rows) shows at least two kinds of funnel
  for (let i = 0; i + 12 <= G.length; i += 12) assert.ok(new Set(G.slice(i, i + 12).map((t) => t.type)).size >= 2, `cards ${i}–${i + 11}`);
});
