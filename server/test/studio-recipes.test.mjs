// Studio edit recipes: every CRM industry has two or three one-click edit templates, every field is one the editor and
// the script writer understand (real hook and structure ids, known grades, transitions, overlays, sound effects), an
// unknown industry falls back to the general ones, and nothing the script writer reads names an AI vendor.
// Kit ids are read from crmkits.js as text, so the test doesn't open the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HOOKS, STRUCTURES } from '../studio/standard.js';
import {
  RECIPES, RECIPE_IDS, GRADES, TRANSITIONS, OVERLAY_TYPES, SFX_KINDS, CAREFUL_INDUSTRIES,
  recipesFor, recipeById, recipeView, recipePrompt, renderOptions,
} from '../studio/recipes.js';

// every kit id: KITS plus the retired ones (saas), each written as `    id: '...'` at the top of its entry
const src = fs.readFileSync(new URL('../crmkits.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('export const KITS = ['), src.indexOf('export function cleanKit'));
const KIT_IDS = [...block.matchAll(/^ {4}id: '([a-z]+)'/gm)].map((m) => m[1]);

const CAPTION_STYLES = ['pop', 'lower', 'karaoke', 'minimal', 'matte', 'punch', 'strip'];
const FROM = ['offer', 'price', 'location', 'business', 'stat', 'deadline', 'name'];
const AT = ['hook', 'middle', 'end'];
const CHANNELS = ['whatsapp', 'call', 'visit', 'dm', 'link', 'book'];
const VENDORS = /kie|deepseek|openai|elevenlabs|sarvam/i;

test('every CRM industry has 2-3 recipes, 70-100 in all, ids unique', () => {
  assert.ok(KIT_IDS.length >= 30 && KIT_IDS.includes('general') && KIT_IDS.includes('saas'), `kit ids read: ${KIT_IDS}`);
  for (const k of KIT_IDS) {
    const n = RECIPES.filter((x) => x.industry === k).length;
    assert.ok(n >= 2 && n <= 3, `${k} has ${n} recipes`);
  }
  assert.ok(RECIPES.every((x) => KIT_IDS.includes(x.industry)), 'a recipe for an industry that is not a kit');
  assert.ok(RECIPES.length >= 70 && RECIPES.length <= 100, `total ${RECIPES.length}`);
  assert.equal(new Set(RECIPE_IDS).size, RECIPES.length);
  assert.deepEqual(RECIPE_IDS, RECIPES.map((x) => x.id));
  assert.ok(Object.isFrozen(RECIPES) && Object.isFrozen(RECIPES[0]) && Object.isFrozen(RECIPES[0].pace));
});

test('every field is valid', () => {
  assert.equal(GRADES.length, 7);
  assert.equal(TRANSITIONS.length, 6);
  for (const x of RECIPES) {
    const m = `(${x.id})`;
    assert.ok(x.id.startsWith(`${x.industry}-`), m);
    for (const f of ['name', 'about', 'music', 'brief']) assert.ok(typeof x[f] === 'string' && x[f].trim().length > 3, `${f} ${m}`);
    assert.ok(x.name.length <= 32, `name too long ${m}`);
    assert.ok(HOOKS[x.hook], `hook ${x.hook} ${m}`);
    assert.ok(STRUCTURES[x.structure], `structure ${x.structure} ${m}`);
    assert.ok([15, 30, 45].includes(x.seconds), `seconds ${m}`);
    assert.ok(x.pace.cutEvery >= 1 && x.pace.cutEvery <= 5, `cutEvery ${m}`);
    assert.equal(typeof x.pace.jumpCut, 'boolean', m);
    assert.ok(['emphasis', 'time', 'off'].includes(x.pace.punch), `punch ${m}`);
    assert.ok(CAPTION_STYLES.includes(x.captions.style), `caption style ${m}`);
    assert.ok(x.captions.keywords === 'auto' || (Array.isArray(x.captions.keywords) && x.captions.keywords.every((w) => typeof w === 'string')), `keywords ${m}`);
    assert.ok(TRANSITIONS.includes(x.transitions), `transitions ${m}`);
    assert.ok(Array.isArray(x.overlays) && x.overlays.length <= 3, `overlays ${m}`);
    for (const o of x.overlays) {
      assert.ok(OVERLAY_TYPES.includes(o.type), `overlay type ${o.type} ${m}`);
      assert.ok(FROM.includes(o.from), `overlay from ${o.from} ${m}`);
      assert.ok(o.at === undefined || AT.includes(o.at), `overlay at ${m}`);
    }
    assert.ok(GRADES.includes(x.grade), `grade ${m}`);
    assert.ok(Array.isArray(x.sfx) && x.sfx.every((s) => SFX_KINDS.includes(s)) && new Set(x.sfx).size === x.sfx.length, `sfx ${m}`);
    for (const f of ['beatSync', 'speedRamp', 'broll']) assert.equal(typeof x[f], 'boolean', `${f} ${m}`);
    assert.ok([null, 'before_after', 'side_by_side'].includes(x.split), `split ${m}`);
    assert.ok(typeof x.cta?.text === 'string' && x.cta.text.length > 3 && x.cta.text.length <= 40, `cta text ${m}`);
    assert.ok(CHANNELS.includes(x.cta.channel), `cta channel ${m}`);
    // music is a mood, never a named song or artist
    assert.doesNotMatch(x.music, /\bby\b|feat\.|["“”]/i, `music names something ${m}`);
  }
});

test('the two showcase recipes', () => {
  const re = recipeById('realestate-walkthrough');
  assert.equal(re.name, 'Walkthrough tour');
  assert.equal(re.grade, 'warm_luxe');
  assert.deepEqual(re.overlays.map((o) => o.type).sort(), ['pin', 'price']);
  const j = recipeById('jewellery-sparkle');
  assert.equal(j.name, 'Macro sparkle reveal');
  assert.equal(j.speedRamp, true);
  assert.equal(j.grade, 'warm_luxe');
  assert.ok(j.overlays.some((o) => o.type === 'price' || o.type === 'counter'));
});

test('careful industries have calm calls to action', () => {
  for (const x of RECIPES.filter((r) => CAREFUL_INDUSTRIES.includes(r.industry))) {
    assert.doesNotMatch(x.cta.text, /guarantee|100%|hurry|last chance|instant|now!|cure|approved/i, x.id);
    assert.match(recipePrompt(x), /no promised results/, x.id);
  }
});

test('recipesFor, recipeById and the seller view', () => {
  assert.ok(recipesFor('realestate').every((x) => x.industry === 'realestate'));
  const general = recipesFor('general');
  assert.ok(general.length >= 2 && general.every((x) => x.industry === 'general'));
  assert.deepEqual(recipesFor('no-such-kit'), general);
  assert.deepEqual(recipesFor(''), general);
  assert.deepEqual(recipesFor(undefined), general);
  assert.equal(recipeById('nope'), null);
  assert.equal(recipeById(undefined), null);
  const v = recipeView(recipeById('realestate-walkthrough'));
  assert.deepEqual(Object.keys(v).sort(), ['about', 'captions', 'grade', 'id', 'industry', 'name', 'seconds', 'transitions']);
  assert.equal(v.captions, 'lower');
});

test('renderOptions gives the editor everything, as copies', () => {
  for (const x of RECIPES) {
    const o = renderOptions(x);
    assert.deepEqual(Object.keys(o).sort(), ['beatSync', 'broll', 'captions', 'cta', 'cutEvery', 'jumpCut', 'look', 'musicMood', 'overlays', 'punch', 'sfx', 'speedRamp', 'split', 'transitions']);
    assert.deepEqual(o.captions, { style: x.captions.style, keywords: x.captions.keywords });
    assert.deepEqual(o.look, { base: x.grade });
    assert.equal(o.cutEvery, x.pace.cutEvery);
    assert.equal(o.punch, x.pace.punch);
    assert.equal(o.musicMood, x.music);
    assert.deepEqual(o.overlays, x.overlays);
    assert.ok(!Object.isFrozen(o.sfx) && !Object.isFrozen(o.overlays));
  }
  const o = renderOptions(recipeById('general-listicle'));
  o.sfx.push('impact'); o.overlays.pop();
  assert.notDeepEqual(renderOptions(recipeById('general-listicle')).sfx, o.sfx, 'editing the copy changed the recipe');
});

test('recipePrompt: 2-4 lines with hook, structure, pace and CTA, no vendor names', () => {
  for (const x of RECIPES) {
    const p = recipePrompt(x), lines = p.split('\n');
    assert.ok(lines.length >= 2 && lines.length <= 4 && lines.every((l) => l.trim()), `${x.id}: ${lines.length} lines`);
    assert.ok(p.includes(x.hook) && p.includes(x.structure), x.id);
    assert.ok(p.includes(x.cta.text), x.id);
    assert.match(p, /Pace:/, x.id);
    assert.doesNotMatch(p, VENDORS, x.id);
  }
  // nothing a seller sees names a vendor either
  assert.doesNotMatch(JSON.stringify(RECIPES), VENDORS);
});
