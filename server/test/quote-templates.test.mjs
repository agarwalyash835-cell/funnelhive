// Quote templates per CRM style: every industry has at least six ready-made quotes with real line items, prices,
// an advance %, validity, a GST line and terms; the seller's own industry comes first. A quote keeps its design and
// GST line, and the client's page gets both.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, register } from './helpers.mjs';
import { KITS } from '../crmkits.js';

let srv, api, T;
before(async () => {
  srv = await startServer();
  api = srv.api;
  T = (await register(api)).token;
});
after(() => srv?.stop());

test('every CRM style has at least six complete, India-priced quote templates; yours first', async () => {
  const d = (await api('/quote-templates', 'GET', null, T)).data;
  assert.equal(d.current, 'general');
  assert.equal(d.industries[0].id, 'general', 'the seller’s own industry first');
  const ids = new Set();
  for (const k of KITS) {
    const ind = d.industries.find((x) => x.id === k.id);
    assert.ok(ind, `${k.id} has templates`);
    assert.ok(ind.templates.length >= 6, `${k.id}: ${ind.templates.length} templates`);
    for (const t of ind.templates) {
      assert.ok(!ids.has(t.id), `unique id ${t.id}`); ids.add(t.id);
      assert.ok(t.name && t.title && t.intro && t.terms, `${t.id} has its words`);
      assert.ok(t.items.length >= 2 && t.items.every((i) => i.name && Number.isInteger(i.price) && i.qty >= 1), `${t.id} items`);
      assert.ok(t.total > 0, `${t.id} total`);
      assert.ok(t.deposit >= 0 && t.deposit <= 100 && t.validDays >= 0, `${t.id} advance and validity`);
      assert.ok(t.taxNote, `${t.id} says how GST applies`);
    }
  }
  // switching the CRM style puts that industry first
  assert.equal((await api('/crm/kit', 'POST', { id: 'interior' }, T)).status, 200);
  const d2 = (await api('/quote-templates', 'GET', null, T)).data;
  assert.equal(d2.current, 'interior');
  assert.equal(d2.industries[0].id, 'interior');
});

test('a quote from a template keeps its design and GST line; the client sees both', async () => {
  const t = (await api('/quote-templates', 'GET', null, T)).data.industries[0].templates[0];
  const q = (await api('/quotes', 'POST', { client: { name: 'Asha', email: 'asha@client.in' }, title: t.title, intro: t.intro, items: t.items, deposit: t.deposit, validDays: t.validDays, terms: t.terms, taxNote: t.taxNote, design: 'elegant' }, T)).data;
  assert.equal(q.design, 'elegant');
  assert.equal(q.taxNote, t.taxNote);
  assert.equal(q.total, t.total);
  const pub = (await api(`/q/${q.id}?t=${new URL(q.link).searchParams.get('t')}&preview=1`)).data;
  assert.deepEqual([pub.design, pub.taxNote], ['elegant', t.taxNote]);
  assert.equal((await api(`/quotes/${q.id}`, 'PUT', { design: 'nope' }, T)).data.design, 'elegant', 'an unknown design keeps the current one');
  const dup = (await api(`/quotes/${q.id}/duplicate`, 'POST', {}, T)).data;
  assert.deepEqual([dup.design, dup.taxNote], ['elegant', t.taxNote]);
});
