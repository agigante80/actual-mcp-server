// tests/unit/notes_update.test.js
// Unit tests for actual_notes_update.
//
// #376: the orphan-id guard MOVED from the tool into adapter.updateNote, which now does the
// four entity reads and the write in ONE write-queue cycle (it was FIVE api lock cycles).
// This test moved with it: it used to stub adapter.updateNote wholesale, which from now on
// would stub away the guard itself, and stub the four adapter.get* methods the tool no
// longer calls. It disarms api init and stubs the RAW api functions instead, so the real
// guard runs.

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

  // These MUST be installed before the adapter import: actual-adapter.ts destructures the
  // api functions at module load, so a stub applied afterwards is captured by nobody and
  // the real function runs. They read mutable closure state rather than being reassigned
  // per case, for the same reason.
  let updateNoteCalls = 0;
  let entityRows = [];
  apiDefault.updateNote = async () => { updateNoteCalls++; };
  apiDefault.getNote    = async (id) => ({ id, note: '' });
  apiDefault.sync       = async () => {};
  apiDefault.getAccounts       = async () => entityRows;
  apiDefault.getCategories     = async () => [];
  apiDefault.getCategoryGroups = async () => [];
  apiDefault.getPayees         = async () => [];

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/notes_update.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);

  let batchesBefore = 0;
  const cycles = () => adapterMod._getWriteQueueBatchCountForTests() - batchesBefore;

  // The entity IS known: the account list contains it.
  const setupKnownEntity = () => {
    updateNoteCalls = 0;
    entityRows = [{ id: KNOWN_ACCOUNT_ID, name: 'Checking' }];
    batchesBefore = adapterMod._getWriteQueueBatchCountForTests();
  };

  // Nothing exists anywhere, so any non-budget id is an orphan.
  const setupEmptyLists = () => {
    updateNoteCalls = 0;
    entityRows = [];
    batchesBefore = adapterMod._getWriteQueueBatchCountForTests();
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
    check(updateNoteCalls === 1, 'the raw note write happened once');
    // #376: the four entity reads and the write share ONE api lock cycle. Before the move
    // this cost five: four adapter.get* calls plus the write.
    check(cycles() === 1, 'exactly one write-queue cycle for the reads and the write');
  }

  console.log('\n[notes_update] positive: empty string note (clear) accepted');
  {
    setupKnownEntity();
    const res = await tool.call({ id: KNOWN_ACCOUNT_ID, note: '' });
    const r = res?.result;
    check(r?.success === true, 'returns success=true for clear');
    check(r?.cleared === true, 'cleared is true for empty string');
    check(updateNoteCalls === 1, 'the raw note write happened once for clear');
  }

  console.log('\n[notes_update] positive: budget-YYYY-MM id bypasses entity lookup');
  {
    setupEmptyLists();
    const res = await tool.call({ id: BUDGET_MONTH_ID, note: '#template 250' });
    const r = res?.result;
    check(r?.success === true, 'returns success=true for budget month id');
    check(r?.id === BUDGET_MONTH_ID, 'id echoed back');
    check(updateNoteCalls === 1, 'the raw note write happened once');
  }

  console.log('\n[notes_update] negative: orphan id (not in any entity list, not budget-YYYY-MM) returns error');
  {
    setupEmptyLists();
    const res = await tool.call({ id: ORPHAN_ID, note: 'x' });
    const r = res?.result;
    check(r?.error !== undefined, 'returns error field');
    check(typeof r?.error === 'string', 'error is a string');
    check(r?.error?.includes(ORPHAN_ID), 'error contains the bad id');
    check(updateNoteCalls === 0,
      'the raw note write NOT reached: this is what prevents an unreadable orphan note');
    check(cycles() === 1, 'the refusal still costs exactly one cycle');
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

  console.log('');
  if (failures === 0) console.log('[notes_update] All tests passed');
  else { console.error(`[notes_update] ${failures} test(s) FAILED`); process.exit(2); }
})();
