// The seller's own asks are read from the brief and checked on the funnel the AI writes (brief.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefNeeds, needsText, unmet, dateIn, applyNeeds } from '../brief.js';

const NOW = Date.UTC(2026, 10, 4, 6, 0); // 4 Nov 2026, 11:30 India time

test('dates in the brief become an India-time deadline (never one in the past)', () => {
  assert.equal(dateIn('launching on 15 December 2026', NOW), Date.UTC(2026, 11, 15) - 330 * 60000);
  assert.equal(dateIn('goes live Dec 15 at 7 pm', NOW), Date.UTC(2026, 11, 15, 19) - 330 * 60000);
  assert.equal(dateIn('sale ends 10/01/2027', NOW), Date.UTC(2027, 0, 10) - 330 * 60000);
  assert.equal(dateIn('opens 3 Feb', NOW), Date.UTC(2027, 1, 3) - 330 * 60000, 'no year and already past this year → next year');
  assert.equal(dateIn('ended 2025-01-01', NOW), null);
  assert.equal(dateIn('no date here', NOW), null);
});

test('a dark luxury launch with a background video and a countdown: every ask is a must-have', () => {
  const n = briefNeeds('A dark luxury page for my perfume brand with a full-screen video background https://youtu.be/abcdefghijk and a countdown to our launch on 15 December', NOW);
  assert.equal(n.style, 'noir');
  assert.deepEqual(n.variants, { hero: 'bgvideo' });
  assert.equal(n.videoUrl, 'https://youtu.be/abcdefghijk');
  assert.ok(n.blocks.includes('countdown'));
  assert.equal(n.endsAt, Date.UTC(2026, 11, 15) - 330 * 60000);
  const text = needsText(n);
  assert.match(text, /WHAT THE SELLER ASKED FOR/);
  assert.match(text, /bgvideo/);
  assert.match(text, /endsAt \d+/);
});

test('quiz with three products, horizontal timeline, calculator', () => {
  const n = briefNeeds('A quiz that recommends one of our 3 products, a horizontal timeline of how it works and an EMI calculator', NOW);
  assert.deepEqual(n.blocks.sort(), ['html', 'quiz', 'steps']);
  assert.equal(n.variants.steps, 'scroll');
  assert.match(needsText(n), /3 products/);
});

test('a plain brief asks for nothing extra', () => {
  const n = briefNeeds('Home bakery in Pune selling custom birthday cakes', NOW);
  assert.deepEqual([n.blocks, n.variants, n.style, n.videoUrl, n.endsAt], [[], {}, null, '', null]);
  assert.equal(needsText(n), '');
  assert.equal(unmet({ steps: [] }, n).length, 0);
});

test('requests missing from a funnel are reported until they are there', () => {
  const n = briefNeeds('a countdown to 15 December and a background video https://example.com/a.mp4', NOW);
  const f = { steps: [{ type: 'sales', blocks: [{ type: 'hero', props: { variant: 'split' } }] }] };
  const before = unmet(f, n).map((i) => i.type).sort();
  assert.deepEqual(before, ['countdown', 'countdown', 'hero', 'hero']);
  f.steps[0].blocks = [{ type: 'hero', props: { variant: 'bgvideo', videoUrl: 'https://example.com/a.mp4' } }, { type: 'countdown', props: { mode: 'fixed', endsAt: n.endsAt } }];
  assert.deepEqual(unmet(f, n), []);
});

test('the layout, video and date the AI missed are put in place without touching the copy', () => {
  const n = briefNeeds('dark luxury launch with a background video https://youtu.be/abcdefghijk, countdown to 15 December, horizontal timeline of the process', NOW);
  const f = { steps: [{ type: 'sales', blocks: [{ id: 'h', type: 'hero', props: { variant: 'split', headline: 'Keep me' } }, { id: 's', type: 'steps', props: { variant: 'columns' } }] }] };
  const done = applyNeeds(f, n, () => 'new');
  assert.ok(done.includes('countdown section'));
  const [hero, cd, steps] = f.steps[0].blocks;
  assert.deepEqual([hero.props.variant, hero.props.videoUrl, hero.props.headline], ['bgvideo', 'https://youtu.be/abcdefghijk', 'Keep me']);
  assert.deepEqual([cd.type, cd.props.mode, cd.props.endsAt], ['countdown', 'fixed', n.endsAt]);
  assert.equal(steps.props.variant, 'scroll');
  assert.deepEqual(unmet(f, n), []);
  assert.deepEqual(applyNeeds(f, n), [], 'nothing left to do the second time');
});
