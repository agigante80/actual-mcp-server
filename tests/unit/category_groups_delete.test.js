// tests/unit/category_groups_delete.test.js
// #142: actual_category_groups_delete must do exactly ONE write-queue cycle (down from 2),
// and preserve the actionable not-found error UX.
//
// #376: the existence guard MOVED from the tool into adapter.deleteCategoryGroup. This test
// moved with it. It used to stub adapter.withWriteSession with a pass-through counter,
// which stubbed away the very thing under test once the guard was no longer in the tool.
// It now disarms api init and stubs the RAW api functions, so the real adapter guard runs.
//
// Run via: npm run test:unit-js
// Or:      node tests/unit/category_groups_delete.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // These raw stubs MUST be installed before the adapter module is imported: it
  // destructures the api functions at module load, so a stub applied afterwards is
  // captured by nobody and the real function runs.
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let groupsResponse = [];
  let deleteCalls = 0;
  let deleteThrows = null;
  apiDefault.sync = async () => {};
  apiDefault.getCategoryGroups = async () => groupsResponse;
  apiDefault.deleteCategoryGroup = async (_id) => {
    deleteCalls++;
    if (deleteThrows) throw deleteThrows;
  };

  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/category_groups_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  adapterMod._setSkipApiInitForTests(true);

  const reset = () => { deleteCalls = 0; deleteThrows = null; groupsResponse = []; };

  console.log('\n[#142] category_groups_delete: positive happy path');
  {
    reset();
    groupsResponse = [{ id: 'cg-1' }];
    const before = adapterMod._getWriteQueueBatchCountForTests();
    const res = await tool.call({ id: 'cg-1' });
    check(res?.success === true, 'returns { success: true }');
    check(deleteCalls === 1,     'rawDeleteCategoryGroup called');
    // The #142 property, asserted against the real queue rather than a stubbed wrapper:
    // the read, the decision and the write share ONE api lock cycle.
    check(adapterMod._getWriteQueueBatchCountForTests() - before === 1,
      'exactly one write-queue cycle for the read and the write');
  }

  console.log('\n[#142] category_groups_delete: read-side not-found throws');
  {
    reset();
    groupsResponse = [];
    const before = adapterMod._getWriteQueueBatchCountForTests();
    let threw = null;
    try { await tool.call({ id: 'cg-missing' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                 'throws on not-found');
    // #377: the refusal is typed, so the tool layer never has to read the message to know
    // what happened. The message content is still asserted because a caller acts on it.
    check(isPreflightRefusal(threw),                              'and it is a typed pre-flight refusal');
    check(threw?.message?.includes('Category group'),             'error mentions Category group');
    check(threw?.message?.includes('cg-missing'),                 'error mentions the id');
    check(threw?.message?.includes('actual_category_groups_get'), 'error mentions list tool');
    check(deleteCalls === 0,                                      'rawDeleteCategoryGroup NOT called');
    check(adapterMod._getWriteQueueBatchCountForTests() - before === 1,
      'the refusal still costs exactly one cycle, not a second lookup');
  }

  console.log('\n[#142] category_groups_delete: schema rejection');
  {
    reset();
    const before = adapterMod._getWriteQueueBatchCountForTests();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on missing id');
    check(deleteCalls === 0,      'rawDeleteCategoryGroup NOT called');
    check(adapterMod._getWriteQueueBatchCountForTests() - before === 0,
      'a Zod failure never reaches the write queue at all');
  }

  console.log('');
  if (failures === 0) {
    console.log('[#142] All category_groups_delete tests passed ✓');
  } else {
    console.error(`[#142] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
