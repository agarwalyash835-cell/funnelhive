// The members area's words in every language: each dictionary has one line per English phrase, with the same
// {placeholders}; every phrase the pages pass to t() is in the list; the helpers fall back to English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KEYS, DICTS, LEARN_LANGS, learnT, learnFonts, learnLocale } from '../src/i18n-learn.js';

const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every language has every phrase, with the same placeholders', () => {
  assert.equal(new Set(KEYS).size, KEYS.length, 'no phrase twice');
  assert.deepEqual(Object.keys(DICTS).sort(), LEARN_LANGS.map(([k]) => k).filter((k) => k !== 'en').sort());
  for (const [lang, list] of Object.entries(DICTS)) {
    assert.equal(list.length, KEYS.length, `${lang}: ${list.length} lines for ${KEYS.length} phrases`);
    KEYS.forEach((k, i) => assert.equal(holes(list[i]), holes(k), `${lang} line ${i + 1}: “${list[i]}” for “${k}”`));
  }
});

test('every phrase the members area shows is translated', () => {
  const src = ['../src/pages/Learn.jsx', '../src/pages/LearnMedia.jsx'].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const used = [...src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((k) => !KEYS.includes(k));
  assert.deepEqual(missing, []);
});

test('t(): the language, placeholders filled, English when unknown', () => {
  assert.equal(learnT('hi')('Sign in'), 'साइन इन करें');
  assert.equal(learnT('ta')('Resend in {n}s', { n: 30 }), '30 வினாடிகளில் மீண்டும் அனுப்பு');
  assert.equal(learnT('hinglish')('Speed'), 'Speed');
  assert.equal(learnT('en')('Resend in {n}s', { n: 5 }), 'Resend in 5s');
  assert.equal(learnT('xx')('Not a phrase'), 'Not a phrase');
  assert.deepEqual(learnFonts('bn'), { heading: 'Hind Siliguri', body: 'Noto Sans Bengali' });
  assert.equal(learnFonts('hinglish'), null);
  assert.deepEqual([learnLocale('mr'), learnLocale('hinglish')], ['mr-IN', 'en-IN']);
});
