// tests/unit/schedules_delete.test.js
// Regression test for #142: actual_schedules_delete must do exactly one
// write-queue cycle, preserve notFoundMsg UX, AND preserve the
// constraintErrorMsg translation for SQLite NOT NULL constraint errors.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const VALID_UUID = '00000000-0000-0000-0000-000000000099';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let schedulesResponse = [];
  let deleteCalls = 0;
  let deleteThrows = null;
  apiDefault.getSchedules = async () => schedulesResponse;
  apiDefault.deleteSchedule = async (_id) => {
    deleteCalls++;
    if (deleteThrows) throw deleteThrows;
  };

  // #376: the existence guard and the constraint translation MOVED from the tool into
  // adapter.deleteSchedule. This test moved with them: stubbing adapter.withWriteSession
  // with a pass-through counter would now stub away the thing under test, so api init is
  // disarmed and the RAW api functions are stubbed instead, exercising the real guard.
  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/schedules_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  apiDefault.sync = async () => {};
  adapterMod._setSkipApiInitForTests(true);

  let batchesBefore = 0;
  const cycles = () => adapterMod._getWriteQueueBatchCountForTests() - batchesBefore;
  const reset = () => {
    deleteCalls = 0; deleteThrows = null; schedulesResponse = [];
    batchesBefore = adapterMod._getWriteQueueBatchCountForTests();
  };

  console.log('\n[#142] schedules_delete: positive happy path');
  {
    reset();
    schedulesResponse = [{ id: VALID_UUID }];
    const res = await tool.call({ id: VALID_UUID });
    check(res?.success === true, 'returns success: true');
    check(deleteCalls === 1,     'rawDeleteSchedule called');
    // The #142 property, asserted against the real queue rather than a stubbed wrapper.
    check(cycles() === 1,        'exactly one write-queue cycle for the read and the write');
  }

  console.log('\n[#142] schedules_delete: read-side not-found throws');
  {
    reset();
    schedulesResponse = [];
    let threw = null;
    try { await tool.call({ id: VALID_UUID }); } catch (e) { threw = e; }
    check(threw instanceof Error,                       'throws on not-found');
    check(threw?.message?.includes('Schedule'),         'error mentions Schedule');
    check(isPreflightRefusal(threw),                    'and it is a typed pre-flight refusal (#377)');
    check(cycles() === 1,                               'exactly one write-queue cycle');
    check(deleteCalls === 0,                            'rawDeleteSchedule NOT called');
  }

  console.log('\n[#142] schedules_delete: constraint-error translation throws');
  {
    reset();
    schedulesResponse = [{ id: VALID_UUID }];
    deleteThrows = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: messages_crdt.dataset');
    let threw = null;
    try { await tool.call({ id: VALID_UUID }); } catch (e) { threw = e; }
    check(threw instanceof Error,                       'throws on constraint error');
    check(typeof threw?.message === 'string',           'error is structured string');
    check(!threw?.message?.includes('SQLITE_CONSTRAINT'),'raw SQLite error not surfaced');
    check(cycles() === 1,                               'still exactly one write-queue cycle');
    check(deleteCalls === 1,                            'rawDeleteSchedule was attempted');
  }

  console.log('\n[#142] schedules_delete: Zod rejection on bad UUID');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: 'not-a-uuid' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                       'throws on bad UUID');
    check((threw?.message || '').includes('Invalid UUID format'), 'actionable error');
    check(cycles() === 0,                               'a Zod failure never reaches the write queue at all');
    check(deleteCalls === 0,                            'rawDeleteSchedule NOT called');
  }

  console.log('');
  if (failures === 0) console.log('[#142] All schedules_delete tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
