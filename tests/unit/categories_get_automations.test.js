import assert from 'node:assert/strict';
import api from '@actual-app/api';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

const categoryId = '10000000-0000-4000-8000-000000000001';
const poolId = '20000000-0000-4000-8000-000000000001';
let category;
let note;
let noteReads = 0;
api.runQuery = async (query) => {
  const { table, filterExpressions } = query.serialize();
  if (table === 'categories') {
    const [{ id }] = filterExpressions;
    return { data: category && id === categoryId ? [category] : [] };
  }
  assert.equal(table, 'cleanup_groups');
  assert.deepEqual(filterExpressions, [{ id: { $oneof: [poolId] } }]);
  return { data: [{ id: poolId, name: 'Trips' }] };
};
api.getNote = async (id) => {
  assert.equal(id, categoryId);
  noteReads++;
  return note;
};

const { _setSkipApiInitForTests, _setInternalSendForTests } = await import('../../dist/src/lib/actual-adapter.js');
_setSkipApiInitForTests(true);
_setInternalSendForTests(async (name) => assert.fail(`Read tool unexpectedly called ${name}`));
const { default: tool } = await import('../../dist/src/tools/categories_get_automations.js');
const read = async () => (await tool.call({ categoryId })).result;

category = { template_settings: { source: 'ui' } };
assert.deepEqual(await read(), { categoryId, source: 'ui', automations: [], cleanup: [] });

category.goal_def = JSON.stringify([
  { type: 'periodic', amount: 25.55, period: { period: 'week', amount: 2 }, limit: { amount: 123.45 } },
  { type: 'average', adjustment: -1.25, adjustmentType: 'fixed' },
  { type: 'average', adjustment: 20, adjustmentType: 'percent' },
  { type: 'simple', monthly: 10 },
]);
category.cleanup_def = JSON.stringify([
  { role: 'source', groupId: null },
  { role: 'sink', groupId: poolId, weight: 2 },
]);
assert.deepEqual(await read(), {
  categoryId, source: 'ui',
  automations: [
    { type: 'periodic', amount: 2555, period: { period: 'week', amount: 2 }, limit: { amount: 12345 } },
    { type: 'average', adjustment: -125, adjustmentType: 'fixed' },
    { type: 'average', adjustment: 20, adjustmentType: 'percent' },
    { type: 'simple', monthly: 1000 },
  ],
  cleanup: [{ role: 'source', groupId: null }, { role: 'sink', groupId: poolId, weight: 2, pool: 'Trips' }],
});
assert.equal(noteReads, 0, 'saved UI automations take precedence over the note');

category.template_settings = null;
note = { id: categoryId, note: 'Private prose\nbudget #template-2 32\n#goal 120\n #CLEANUP Trips sink 2 \n#cleanup\n#other' };
assert.deepEqual(await read(), {
  categoryId, source: 'notes', noteDirectives: ['#template-2 32', '#goal 120', '#CLEANUP Trips sink 2'],
}, 'notes use their current directives even when cached editor fields exist');

note = null;
assert.deepEqual(await read(), { categoryId, source: 'notes', noteDirectives: [] });
await assert.rejects(() => tool.call({ categoryId: '00000000-0000-0000-0000-000000000000' }), /Category.*not found.*actual_categories_get/);
await assert.rejects(() => tool.call({ categoryId: 'Groceries' }), /Invalid category ID/i);
console.log('Category automation read tests passed');
