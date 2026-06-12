// tests/unit/notes_update.test.js
// Unit tests for actual_notes_update tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const KNOWN_ACCOUNT_ID = '00000000-0000-0000-0000-000000000001';
const BUDGET_MONTH_ID  = 'budget-2026-01';
const ORPHAN_ID        = 'not-a-real-entity';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  apiDefault.updateNote = async () => {};
  apiDefault.getNote    = async (id) => ({ id, note: '' });
  apiDefault.sync       = async () => {};
  // Stub entity list methods on the api so the adapter can load them.
  apiDefault.getAccounts       = async () => [{ id: KNOWN_ACCOUNT_ID, name: 'Checking' }];
  apiDefault.getCategories     = async () => [];
  apiDefault.getCategoryGroups = async () => [];
  apiDefault.getPayees         = async () => [];

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/notes_update.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origUpdateNote    = adapter.updateNote;
  const origGetAccounts   = adapter.getAccounts;
  const origGetCategories = adapter.getCategories;
  const origGetCategoryGroups = adapter.getCategoryGroups;
  const origGetPayees     = adapter.getPayees;

  let updateNoteCalls = 0;

  // Helper: reset call counters and stubs to a state where the entity is known.
  const setupKnownEntity = () => {
    updateNoteCalls = 0;
    adapter.updateNote       = async () => { updateNoteCalls++; };
    adapter.getAccounts      = async () => [{ id: KNOWN_ACCOUNT_ID, name: 'Checking' }];
    adapter.getCategories    = async () => [];
    adapter.getCategoryGroups = async () => [];
    adapter.getPayees        = async () => [];
  };

  const setupEmptyLists = () => {
    updateNoteCalls = 0;
    adapter.updateNote       = async () => { updateNoteCalls++; };
    adapter.getAccounts      = async () => [];
    adapter.getCategories    = async () => [];
    adapter.getCategoryGroups = async () => [];
    adapter.getPayees        = async () => [];
  };

  // createTool wraps handler return in { result: ... }
  // So tool.call() returns { result: { success, id, note, cleared } }
  // or { result: { error: '...' } } for the orphan guard path.

  console.log('\n[notes_update] positive: valid update on a known account id calls adapter');
  {
    setupKnownEntity();
    const res = await tool.call({ id: KNOWN_ACCOUNT_ID, note: 'Reconcile monthly' });
    const r = res?.result;
    check(r?.success === true, 'returns success=true');
    check(r?.id === KNOWN_ACCOUNT_ID, 'id echoed back');
    check(r?.note === 'Reconcile monthly', 'note echoed back');
    check(r?.cleared === false, 'cleared is false for non-empty note');
    check(updateNoteCalls === 1, 'adapter.updateNote called once');
  }

  console.log('\n[notes_update] positive: empty string note (clear) accepted');
  {
    setupKnownEntity();
    const res = await tool.call({ id: KNOWN_ACCOUNT_ID, note: '' });
    const r = res?.result;
    check(r?.success === true, 'returns success=true for clear');
    check(r?.cleared === true, 'cleared is true for empty string');
    check(updateNoteCalls === 1, 'adapter.updateNote called once for clear');
  }

  console.log('\n[notes_update] positive: budget-YYYY-MM id bypasses entity lookup');
  {
    setupEmptyLists();
    const res = await tool.call({ id: BUDGET_MONTH_ID, note: '#template 250' });
    const r = res?.result;
    check(r?.success === true, 'returns success=true for budget month id');
    check(r?.id === BUDGET_MONTH_ID, 'id echoed back');
    check(updateNoteCalls === 1, 'adapter.updateNote called once');
  }

  console.log('\n[notes_update] negative: orphan id (not in any entity list, not budget-YYYY-MM) returns error');
  {
    setupEmptyLists();
    const res = await tool.call({ id: ORPHAN_ID, note: 'x' });
    const r = res?.result;
    check(r?.error !== undefined, 'returns error field');
    check(typeof r?.error === 'string', 'error is a string');
    check(r?.error?.includes(ORPHAN_ID), 'error contains the bad id');
    check(updateNoteCalls === 0, 'adapter.updateNote NOT called for orphan id');
  }

  console.log('\n[notes_update] schema: rejects missing id');
  {
    let threw = false;
    try { tool.inputSchema.parse({ note: 'x' }); } catch (_) { threw = true; }
    check(threw, 'missing id rejected by schema');
  }

  console.log('\n[notes_update] schema: rejects empty id');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: '', note: 'x' }); } catch (_) { threw = true; }
    check(threw, 'empty id rejected by schema');
  }

  console.log('\n[notes_update] schema: rejects missing note');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: KNOWN_ACCOUNT_ID }); } catch (_) { threw = true; }
    check(threw, 'missing note rejected by schema');
  }

  console.log('\n[notes_update] schema: accepts empty string note (clear operation)');
  {
    let threw = false;
    try { tool.inputSchema.parse({ id: KNOWN_ACCOUNT_ID, note: '' }); } catch (_) { threw = true; }
    check(!threw, 'empty string note accepted by schema');
  }

  // Restore original adapter methods.
  adapter.updateNote        = origUpdateNote;
  adapter.getAccounts       = origGetAccounts;
  adapter.getCategories     = origGetCategories;
  adapter.getCategoryGroups = origGetCategoryGroups;
  adapter.getPayees         = origGetPayees;

  console.log('');
  if (failures === 0) console.log('[notes_update] All tests passed');
  else { console.error(`[notes_update] ${failures} test(s) FAILED`); process.exit(2); }
})();
