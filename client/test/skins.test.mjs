// The dashboard skins: the client's list (src/skins.js) and the server's (server/skins.js) must name the same skins,
// and every skin has what the picker draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, SKIN_LIST } from '../src/skins.js';
import { SKIN_IDS, cleanSkin } from '../../server/skins.js';

test('client and server know the same skins', () => {
  assert.deepEqual(Object.keys(SKINS).sort(), [...SKIN_IDS].sort());
  assert.ok(SKINS.classic, 'Classic is the default');
});
test('every skin has a name, a blurb, a layout and four swatch colours', () => {
  for (const s of SKIN_LIST) {
    assert.ok(s.name && s.blurb, s.id);
    assert.ok(['side', 'top', 'rail'].includes(s.layout), `${s.id}: ${s.layout}`);
    assert.equal(s.sw.length, 4, s.id);
  }
});
test('the server keeps only known skins', () => {
  assert.equal(cleanSkin('midnight'), 'midnight');
  assert.equal(cleanSkin('<script>'), '');
  assert.equal(cleanSkin(''), '');
});
