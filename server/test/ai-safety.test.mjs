// What the AI writes is checked before it reaches a page: only real section types, only real pages, valid colours,
// and a section removed by id removes just that one. Ads actions through Composio always start paused, in the way
// each Google Ads action spells it.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let A, C;
before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-ai-safety-'));
  process.env.NODE_ENV = 'test';
  await import('../sales.js'); // the app's import order (composio → billing → … → sales has a cycle when entered elsewhere)
  A = await import('../actions.js');
  C = await import('../composio.js');
});

const funnel = () => ({
  name: 'Test', theme: { style: 'aurora', primary: '#112233', secondary: '#445566' },
  steps: [
    { id: 's1', name: 'Landing', type: 'landing', slug: 'start', blocks: [{ id: 'h1', type: 'hero', props: {} }, { id: 'f1', type: 'faq', props: { items: [] } }, { id: 'f2', type: 'faq', props: { items: [] } }] },
    { id: 's2', name: 'Thanks', type: 'thankyou', slug: 'thanks', blocks: [{ id: 't1', type: 'thankyou', props: {} }] },
  ],
});

test('made-up section types never reach a page', () => {
  const f = funnel();
  const done = A.applyActions(f, [{ type: 'add_block', blockType: 'carousel3d', props: {} }, { type: 'set_blocks', blocks: [{ type: 'hero', props: {} }, { type: 'spinner', props: {} }] }], 's1');
  assert.deepEqual(f.steps[0].blocks.map((b) => b.type), ['hero']);
  assert.match(done[0], /not a section type/);
});

test('a page id that isn’t in the funnel skips the change instead of editing the first page', () => {
  const f = funnel();
  const before = JSON.stringify(f.steps[0]);
  const done = A.applyActions(f, [{ type: 'set_blocks', stepId: 'nope', blocks: [{ type: 'cta', props: {} }] }], 's2');
  assert.equal(JSON.stringify(f.steps[0]), before);
  assert.match(done[0], /isn’t in this funnel/);
});

test('removing a section by id removes only that section', () => {
  const f = funnel();
  A.applyActions(f, [{ type: 'remove_block', blockId: 'f1', blockType: 'faq' }], 's1');
  assert.deepEqual(f.steps[0].blocks.map((b) => b.id), ['h1', 'f2']);
});

test('theme colours must be real hex colours', () => {
  const f = funnel();
  A.applyActions(f, [{ type: 'set_theme', primary: 'red; background:url(x)', secondary: 'nope' }], 's1');
  assert.equal(f.theme.primary, '#112233');
  A.applyActions(f, [{ type: 'set_theme', primary: '#AA0000' }], 's1');
  assert.equal(f.theme.primary, '#AA0000');
});

test('Google Ads creations are always paused, spelled the way each action takes it', () => {
  const camp = C.safeArgs('GOOGLEADS_MUTATE_CAMPAIGNS', { operations: [{ operation_type: 'create', create: { name: 'X', status: 'enabled' } }, { operation_type: 'update', update: { status: 'enabled' } }] });
  assert.equal(camp.operations[0].create.status, 'paused');
  assert.equal(camp.operations[1].update.status, 'enabled', 'updates are left to the seller’s OK');
  assert.equal(C.safeArgs('GOOGLEADS_MUTATE_AD_GROUPS', { operations: [{ create: { name: 'G', campaign: 'c', status: 'ENABLED' } }] }).operations[0].create.status, 'PAUSED');
  const batch = C.safeArgs('GOOGLEADS_BATCH_MUTATE', { mutate_operations: [
    { campaign_operation: { create: { name: 'C', status: 'ENABLED' } } },
    { ad_group_ad_operation: { create: { status: 'ENABLED' } } },
    { campaign_budget_operation: { create: { amount_micros: 500000000 } } },
  ] });
  assert.equal(batch.mutate_operations[0].campaign_operation.create.status, 'PAUSED');
  assert.equal(batch.mutate_operations[1].ad_group_ad_operation.create.status, 'PAUSED');
  assert.equal(batch.mutate_operations[2].campaign_budget_operation.create.status, undefined, 'budgets have no status');
  assert.equal(C.safeArgs('METAADS_CREATE_CAMPAIGN', { status: 'ACTIVE' }).status, 'PAUSED');
});
