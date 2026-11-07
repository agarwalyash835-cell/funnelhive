// The vector cache stays under its size budget however many sellers there are: the least recently used seller
// goes first, a seller just read stays, and one bigger than the whole budget isn't kept at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteCache, vecBytes } from '../byte-cache.js';

test('stays under the budget, dropping the least recently used first', () => {
  const c = byteCache(1000);
  c.set('a', 'A', 400); c.set('b', 'B', 400);
  assert.equal(c.get('a'), 'A'); // a was just used: b is now the oldest
  c.set('c', 'C', 400);
  assert.deepEqual([c.get('a'), c.get('b'), c.get('c')], ['A', undefined, 'C']);
  assert.ok(c.bytes <= 1000);
  // 10,000 sellers through a small cache: RAM stays flat
  for (let i = 0; i < 10000; i++) c.set(`u${i}`, i, 300);
  assert.ok(c.bytes <= 1000 && c.size <= 3);
});

test('replacing an entry counts its new size; too big is not kept; delete frees the space', () => {
  const c = byteCache(1000);
  c.set('a', 1, 600); c.set('a', 2, 300);
  assert.deepEqual([c.get('a'), c.bytes], [2, 300]);
  c.set('huge', 'x', 5000);
  assert.equal(c.get('huge'), undefined);
  assert.equal(c.get('a'), 2, 'a too-big entry doesn’t push others out');
  c.delete('a');
  assert.deepEqual([c.size, c.bytes], [0, 0]);
});

test('a seller’s vectors are sized by their bytes', () => {
  assert.equal(vecBytes([new Int8Array(1024), new Int8Array(1024)]), 2 * (1024 + 96));
  assert.equal(vecBytes(new Map([['m1', new Int8Array(1024)]]).values()), 1024 + 96);
});
