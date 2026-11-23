// #764: upstream's api/category-group-create drops is_income, and nothing kept a category's
// is_income consistent with its group. The logic lives in the adapter, inside the queued write.
// This test drives the REAL adapter with stubbed raw api functions (destructured at adapter
// load, so stubs are installed BEFORE the import).
//
// Run: node tests/unit/adapter_category_is_income.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';

import assert from 'node:assert';

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[#764] adapter category is_income consistency');

const INC = 'aaaaaaaa-0000-4000-8000-000000000001';
const EXP = 'aaaaaaaa-0000-4000-8000-000000000002';
const NEW_GROUP = 'aaaaaaaa-0000-4000-8000-000000000009';
const CAT_EXP = 'cccccccc-0000-4000-8000-000000000001';
const CAT_BAD = 'cccccccc-0000-4000-8000-000000000002';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let groups, createCalls, updateCalls, groupCreates, groupUpdates, groupDeletes, groupListCalls;
let updateGroupBehaviour, deleteGroupBehaviour;
api.sync = async () => {};
api.updateNote = async () => {};
api.getAccounts = async () => [];
api.getPayees = async () => [];
api.getCategories = async () => [
  { id: CAT_EXP, name: 'Food', group_id: EXP, is_income: false },
  { id: CAT_BAD, name: 'Odd', group_id: INC, is_income: false },
];
api.getCategoryGroups = async () => { groupListCalls++; return groups.map((g) => ({ ...g })); };
api.createCategory = async (c) => { createCalls.push(c); return 'new-category-id'; };
api.updateCategory = async (id, f) => { updateCalls.push({ id, f }); };
api.createCategoryGroup = async (g) => {
  groupCreates.push(g);
  // Upstream drops is_income: only name and hidden are stored.
  groups.push({ id: NEW_GROUP, name: g.name, is_income: false });
  return NEW_GROUP;
};
api.updateCategoryGroup = async (id, f) => {
  groupUpdates.push({ id, f });
  if (updateGroupBehaviour === 'throw') throw new Error('boom');
  if (updateGroupBehaviour === 'noop') return;
  const row = groups.find((g) => g.id === id);
  Object.assign(row, f);
};
api.deleteCategoryGroup = async (id) => {
  groupDeletes.push(id);
  if (deleteGroupBehaviour === 'throw') throw new Error('nope');
  groups = groups.filter((g) => g.id !== id);
};

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;

function reset() {
  groups = [{ id: INC, name: 'Income', is_income: true }, { id: EXP, name: 'Usual' }];
  createCalls = []; updateCalls = []; groupCreates = []; groupUpdates = []; groupDeletes = []; groupListCalls = 0;
  updateGroupBehaviour = 'apply'; deleteGroupBehaviour = 'apply';
}
const caught = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

const dropIncomeGroup = () => { groups = groups.filter((g) => g.id !== INC); };
await check('NEGATIVE: group create with is_income true is refused when an income group exists, nothing created', async () => {
  reset();
  const e = await caught(() => adapter.createCategoryGroup({ name: 'Inc2', is_income: true }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, `Cannot create an income category group: this budget already has one ("Income", ${INC}), and Actual counts only the first income group toward the budget. Add income categories to that group instead.`);
  assert.strictEqual(groupCreates.length, 0);
  assert.strictEqual(groupUpdates.length, 0);
});
await check('group create with is_income false or absent is never refused by an existing income group', async () => {
  for (const g of [{ name: 'A' }, { name: 'A', is_income: false }, { name: 'A', is_income: null }]) {
    reset();
    await adapter.createCategoryGroup(g);
    assert.strictEqual(groupCreates.length, 1);
  }
});
await check('group create with is_income true sets the flag with one update and no delete', async () => {
  reset(); dropIncomeGroup();
  const id = await adapter.createCategoryGroup({ name: 'Inc2', is_income: true });
  assert.strictEqual(id, NEW_GROUP);
  assert.strictEqual(groupCreates.length, 1);
  assert.deepStrictEqual(groupUpdates, [{ id: NEW_GROUP, f: { is_income: true } }]);
  assert.strictEqual(groupDeletes.length, 0);
  assert.strictEqual(groups.find((g) => g.id === NEW_GROUP).is_income, true);
});
await check('NEGATIVE: a flag that does not read back is deleted and refused with the exact text', async () => {
  reset(); dropIncomeGroup();
  updateGroupBehaviour = 'noop';
  const e = await caught(() => adapter.createCategoryGroup({ name: 'Inc2', is_income: true }));
  assert.ok(e, 'expected a throw');
  assert.strictEqual(e.message, 'Category group "Inc2" was not created as an income group (is_income could not be set). Nothing was kept.');
  assert.deepStrictEqual(groupDeletes, [NEW_GROUP]);
});
await check('NEGATIVE: update and delete both throw, the error names the group id and the delete tool', async () => {
  reset(); dropIncomeGroup();
  updateGroupBehaviour = 'throw'; deleteGroupBehaviour = 'throw';
  const e = await caught(() => adapter.createCategoryGroup({ name: 'Inc2', is_income: true }));
  assert.ok(e, 'expected a throw');
  assert.strictEqual(e.message, `Category group "Inc2" was not created as an income group (is_income could not be set). The group "${NEW_GROUP}" EXISTS: delete it with actual_category_groups_delete.`);
  assert.ok(!/timed out|timeout|ECONN/i.test(e.message));
});
await check('group create without is_income true does no update and no read back', async () => {
  for (const g of [{ name: 'A' }, { name: 'A', is_income: false }, { name: 'A', is_income: null }]) {
    reset();
    await adapter.createCategoryGroup(g);
    assert.strictEqual(groupUpdates.length, 0);
    assert.strictEqual(groupListCalls, 0);
  }
});
await check('category create without is_income takes the group flag (income true, expense false)', async () => {
  reset();
  await adapter.createCategory({ name: 'X', group_id: INC });
  await adapter.createCategory({ name: 'Y', group_id: EXP });
  await adapter.createCategory({ name: 'Z', group_id: INC, is_income: null });
  assert.strictEqual(createCalls[0].is_income, true);
  assert.strictEqual(createCalls[1].is_income, false);
  assert.strictEqual(createCalls[2].is_income, true);
});
await check('NEGATIVE: create with a contradicting is_income is a ConflictRefusal with the exact text, nothing written', async () => {
  reset();
  const e = await caught(() => adapter.createCategory({ name: 'X', group_id: EXP, is_income: true }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, 'Category is_income (true) contradicts its group "Usual" (is_income false). Nothing was written.');
  const e2 = await caught(() => adapter.createCategory({ name: 'X', group_id: INC, is_income: false }));
  assert.ok(e2 && isPreflightRefusal(e2), String(e2));
  assert.strictEqual(createCalls.length, 0);
});
await check('create with a matching explicit is_income is accepted', async () => {
  reset();
  await adapter.createCategory({ name: 'X', group_id: INC, is_income: true });
  assert.strictEqual(createCalls.length, 1);
});
await check('NEGATIVE: moving an expense category to an income group without is_income is refused', async () => {
  reset();
  const e = await caught(() => adapter.updateCategory(CAT_EXP, { group_id: INC }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, 'Moving the category to group "Income" (is_income true) would contradict its is_income (false). Pass is_income true together with group_id to change both. Nothing was written.');
  assert.strictEqual(updateCalls.length, 0);
});
await check('a move with a matching is_income succeeds', async () => {
  reset();
  await adapter.updateCategory(CAT_EXP, { group_id: INC, is_income: true });
  assert.strictEqual(updateCalls.length, 1);
});
await check('NEGATIVE: an explicit is_income that contradicts the group is refused on update', async () => {
  reset();
  const e = await caught(() => adapter.updateCategory(CAT_EXP, { group_id: EXP, is_income: true }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, 'Category is_income (true) contradicts its group "Usual" (is_income false). Nothing was written.');
  assert.strictEqual(updateCalls.length, 0);
});
await check('a rename reads no group listing', async () => {
  reset();
  await adapter.updateCategory(CAT_EXP, { name: 'Renamed' });
  assert.strictEqual(groupListCalls, 0);
  assert.strictEqual(updateCalls.length, 1);
});
await check('repair: an already inconsistent category accepts is_income equal to its group flag', async () => {
  reset();
  await adapter.updateCategory(CAT_BAD, { is_income: true });
  assert.strictEqual(updateCalls.length, 1);
});
await check('a move to the same group does no implicit check', async () => {
  reset();
  await adapter.updateCategory(CAT_BAD, { group_id: INC });
  assert.strictEqual(updateCalls.length, 1);
});
await check('one drain: a group create then a category create into it reads the new flag', async () => {
  reset(); dropIncomeGroup();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  const w = adapter.updateNote(EXP, 'x'); // warms the group listing
  const g = adapter.createCategoryGroup({ name: 'Fresh', is_income: true });
  const c = adapter.createCategory({ name: 'X', group_id: NEW_GROUP });
  await Promise.all([w, g, c]);
  assert.strictEqual(adapterMod._getWriteQueueBatchCountForTests() - before, 1, 'same drain');
  assert.strictEqual(createCalls[0].is_income, true);
});

console.log(`\n[#764] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
