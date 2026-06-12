// tests/unit/category_groups_delete.test.js
// Regression test for #142: actual_category_groups_delete must do exactly one
// withWriteSession invocation (down from 2 separate cycles), and preserve the
// existing error UX from notFoundMsg().
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
  // Stub the raw @actual-app/api functions BEFORE the tool module captures them.
  // The tool destructures const { getCategoryGroups, deleteCategoryGroup } = api at module init;
  // we install proxy functions that delegate to mutable refs so we can swap behaviour per case.
  const apiMod = await import('@actual-app/api');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiDefault = (apiMod.default || apiMod);

  let groupsResponse = [];
  let deleteCalls = 0;
  let deleteThrows = null;
  apiDefault.getCategoryGroups = async () => groupsResponse;
  apiDefault.deleteCategoryGroup = async (_id) => {
    deleteCalls++;
    if (deleteThrows) throw deleteThrows;
  };

  const [toolMod, adapterMod] = await Promise.all([
    import('../../dist/src/tools/category_groups_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const tool    = toolMod;
  const adapter = adapterMod.default;

  // Replace withWriteSession with a counter that runs the callback synchronously.
  let withWriteSessionCalls = 0;
  const origWithWriteSession = adapter.withWriteSession;
  adapter.withWriteSession = async (fn) => { withWriteSessionCalls++; return await fn(); };

  const reset = () => {
    withWriteSessionCalls = 0;
    deleteCalls = 0;
    deleteThrows = null;
    groupsResponse = [];
  };

  // Positive: one lock cycle, returns success
  console.log('\n[#142] category_groups_delete: positive happy path');
  {
    reset();
    groupsResponse = [{ id: 'cg-1' }];
    const res = await tool.call({ id: 'cg-1' });
    check(res?.success === true,         'returns { success: true }');
    check(withWriteSessionCalls === 1,   'withWriteSession called exactly once', `was ${withWriteSessionCalls}`);
    check(deleteCalls === 1,             'rawDeleteCategoryGroup called inside callback');
  }

  // Negative: read-side not-found now THROWS an actionable error (consistent with the
  // other delete tools) instead of returning { success: false }.
  console.log('\n[#142] category_groups_delete: read-side not-found throws');
  {
    reset();
    groupsResponse = [];
    let threw = null;
    try { await tool.call({ id: 'cg-missing' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                      'throws on not-found');
    check(threw?.message?.includes('Category group'),                  'error mentions Category group');
    check(threw?.message?.includes('cg-missing'),                      'error mentions the id');
    check(threw?.message?.includes('actual_category_groups_get'),      'error mentions list tool');
    check(withWriteSessionCalls === 1,                                 'still exactly one withWriteSession call', `was ${withWriteSessionCalls}`);
    check(deleteCalls === 0,                                           'rawDeleteCategoryGroup NOT called');
  }

  // Negative: schema rejection (missing id)
  console.log('\n[#142] category_groups_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error,           'throws on missing id');
    check(withWriteSessionCalls === 0,      'withWriteSession NOT called on Zod fail', `was ${withWriteSessionCalls}`);
    check(deleteCalls === 0,                'rawDeleteCategoryGroup NOT called');
  }

  adapter.withWriteSession = origWithWriteSession;

  console.log('');
  if (failures === 0) {
    console.log('[#142] All category_groups_delete tests passed ✓');
  } else {
    console.error(`[#142] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
