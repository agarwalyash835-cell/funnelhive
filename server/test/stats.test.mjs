import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abResult } from '../stats.js';

test('too little data → collecting, no winner', () => {
  const r = abResult({ views: 50, conversions: 5 }, { views: 50, conversions: 15 });
  assert.equal(r.status, 'collecting');
  assert.equal(r.winner, null);
});

test('clear difference → significant winner B', () => {
  const r = abResult({ views: 2000, conversions: 100 }, { views: 2000, conversions: 160 }); // 5% vs 8%
  assert.equal(r.status, 'significant');
  assert.equal(r.winner, 'B');
  assert.ok(r.confidence > 99);
  assert.equal(r.uplift, 60);
});

test('small noisy difference → not significant', () => {
  const r = abResult({ views: 500, conversions: 50 }, { views: 500, conversions: 55 }); // 10% vs 11%
  assert.equal(r.status, 'not-significant');
  assert.equal(r.winner, null);
  assert.ok(r.confidence < 95);
});

test('matches a known z-test value', () => {
  // 200/1000 vs 240/1000 → z ≈ 2.155, two-sided p ≈ 0.0312
  const r = abResult({ views: 1000, conversions: 200 }, { views: 1000, conversions: 240 });
  assert.ok(Math.abs(r.pValue - 0.0312) < 0.001, `p=${r.pValue}`);
  assert.equal(r.winner, 'B');
});
