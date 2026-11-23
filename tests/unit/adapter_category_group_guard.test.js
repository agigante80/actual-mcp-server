// #763: creating or moving a category into an unknown (or deleted) category group wrote a
// category with a null group, which no tool can list, update, delete or annotate afterwards.
// The guard lives in the adapter, inside the same queued write as the raw call, and reads the
// per-drain category-group listing. This test drives the REAL adapter with stubbed raw api
// functions (they are destructured at adapter load, so stubs are installed BEFORE the import).
//
// Run: node tests/unit/adapter_category_group_guard.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '00000000-0000-0000-0000-000000000000';

import assert from 'node:assert';

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[#763] adapter category group guard');

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const G1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const G2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const HIDDEN = 'aaaaaaaa-0000-4000-8000-000000000003';
const CAT = 'cccccccc-0000-4000-8000-000000000001';
const NEW_GROUP = 'aaaaaaaa-0000-4000-8000-000000000009';
const LEGACY_TEXT = `Category group "${UNKNOWN}" not found. Use actual_category_groups_get to list available category groups.`;

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;

let groups, createCalls, updateCalls, groupListCalls;
api.sync = async () => {};
api.updateNote = async () => {};
api.getAccounts = async () => [];
api.getPayees = async () => [];
api.getCategories = async () => [{ id: CAT, name: 'Food', group_id: G1 }];
api.getCategoryGroups = async () => { groupListCalls++; return groups.map((g) => ({ ...g })); };
api.createCategory = async (c) => { createCalls.push(c); return 'new-category-id'; };
api.updateCategory = async (id, f) => { updateCalls.push({ id, f }); };
api.createCategoryGroup = async (g) => { groups.push({ id: NEW_GROUP, ...g }); return NEW_GROUP; };

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
adapterMod._setSkipApiInitForTests(true);
const adapter = adapterMod.default;

function reset() {
  groups = [{ id: G1, name: 'Usual' }, { id: G2, name: 'Other' }, { id: HIDDEN, name: 'Old', hidden: true }];
  createCalls = []; updateCalls = []; groupListCalls = 0;
}
const caught = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

await check('NEGATIVE: create with an unknown group_id is refused with the exact text and writes nothing', async () => {
  reset();
  const e = await caught(() => adapter.createCategory({ name: 'X', group_id: UNKNOWN }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, LEGACY_TEXT);
  assert.strictEqual(createCalls.length, 0);
});
await check('NEGATIVE: update with an unknown group_id is refused with the exact text and writes nothing', async () => {
  reset();
  const e = await caught(() => adapter.updateCategory(CAT, { group_id: UNKNOWN }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, LEGACY_TEXT);
  assert.strictEqual(updateCalls.length, 0);
});
await check('create and update with an existing group run the raw call once', async () => {
  reset();
  await adapter.createCategory({ name: 'X', group_id: G1 });
  await adapter.updateCategory(CAT, { group_id: G2 });
  assert.strictEqual(createCalls.length, 1);
  assert.strictEqual(updateCalls.length, 1);
});
await check('a hidden group is accepted', async () => {
  reset();
  await adapter.createCategory({ name: 'X', group_id: HIDDEN });
  assert.strictEqual(createCalls.length, 1);
});
await check('NEGATIVE: a deleted group (absent from the listing) is refused', async () => {
  reset();
  groups = groups.filter((g) => g.id !== G2);
  const e = await caught(() => adapter.createCategory({ name: 'X', group_id: G2 }));
  assert.ok(e && isPreflightRefusal(e), String(e));
  assert.strictEqual(e.message, `Category group "${G2}" not found. Use actual_category_groups_get to list available category groups.`);
  assert.strictEqual(createCalls.length, 0);
});
await check('update without group_id does not read the group listing', async () => {
  reset();
  await adapter.updateCategory(CAT, { name: 'Renamed' });
  assert.strictEqual(groupListCalls, 0);
  assert.strictEqual(updateCalls.length, 1);
});
await check('NEGATIVE: an unknown category id is refused for the category, before the group check', async () => {
  reset();
  const e = await caught(() => adapter.updateCategory('cccccccc-0000-4000-8000-0000000000ff', { group_id: UNKNOWN }));
  assert.ok(e && isPreflightRefusal(e) && /^Category "/.test(e.message), String(e && e.message));
});
await check('one drain: a group create then a category create into that new group is accepted', async () => {
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  // updateNote reads every entity listing and preserves them, so the group listing is WARM
  // when the group create runs. Only the create's invalidation then makes the next guard
  // re-read it; without the warm-up the case could not tell a stale cache from a fresh one.
  const w = adapter.updateNote(G1, 'x');
  const g = adapter.createCategoryGroup({ name: 'Fresh' });
  const c = adapter.createCategory({ name: 'X', group_id: NEW_GROUP });
  await Promise.all([w, g, c]);
  assert.strictEqual(adapterMod._getWriteQueueBatchCountForTests() - before, 1, 'same drain');
  assert.strictEqual(createCalls.length, 1);
});
await check('the guard uses the drain cache: a warm group listing is not read again by the create guard', async () => {
  reset();
  const before = adapterMod._getWriteQueueBatchCountForTests();
  // updateNote reads the group listing once and preserves it; createCategory (which declares
  // nothing, so it invalidates AFTER it runs) must then be served from the cache.
  await Promise.all([
    adapter.updateNote(G1, 'x'),
    adapter.createCategory({ name: 'A', group_id: G1 }),
  ]);
  assert.strictEqual(adapterMod._getWriteQueueBatchCountForTests() - before, 1, 'same drain');
  assert.strictEqual(createCalls.length, 1);
  assert.strictEqual(groupListCalls, 1);
});

console.log(`\n[#763] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
