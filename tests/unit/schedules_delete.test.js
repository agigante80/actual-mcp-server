// tests/unit/schedules_delete.test.js
// Regression test for #142: actual_schedules_delete must do exactly one
// withWriteSession invocation, preserve notFoundMsg UX, AND preserve the
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
  await import('../../dist/src/lib/node-polyfills.js');
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

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/schedules_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  let withWriteSessionCalls = 0;
  const orig = adapter.withWriteSession;
  adapter.withWriteSession = async (fn) => { withWriteSessionCalls++; return await fn(); };

  const reset = () => { withWriteSessionCalls = 0; deleteCalls = 0; deleteThrows = null; schedulesResponse = []; };

  console.log('\n[#142] schedules_delete: positive happy path');
  {
    reset();
    schedulesResponse = [{ id: VALID_UUID }];
    const res = await tool.call({ id: VALID_UUID });
    check(res?.success === true,         'returns success: true');
    check(withWriteSessionCalls === 1,   'withWriteSession called exactly once');
    check(deleteCalls === 1,             'rawDeleteSchedule called inside callback');
  }

  console.log('\n[#142] schedules_delete: read-side not-found');
  {
    reset();
    schedulesResponse = [];
    const res = await tool.call({ id: VALID_UUID });
    check(res?.success === false,                       'returns success: false');
    check(res?.error?.includes('Schedule'),             'error mentions Schedule');
    check(withWriteSessionCalls === 1,                  'exactly one withWriteSession call');
    check(deleteCalls === 0,                            'rawDeleteSchedule NOT called');
  }

  console.log('\n[#142] schedules_delete: constraint-error translation');
  {
    reset();
    schedulesResponse = [{ id: VALID_UUID }];
    deleteThrows = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed: messages_crdt.dataset');
    const res = await tool.call({ id: VALID_UUID });
    check(res?.success === false,                       'returns success: false on constraint error');
    check(typeof res?.error === 'string',               'error is structured string');
    check(!res?.error?.includes('SQLITE_CONSTRAINT'),   'raw SQLite error not surfaced');
    check(withWriteSessionCalls === 1,                  'still exactly one withWriteSession call');
    check(deleteCalls === 1,                            'rawDeleteSchedule was attempted');
  }

  console.log('\n[#142] schedules_delete: Zod rejection on bad UUID');
  {
    reset();
    let threw = null;
    try { await tool.call({ id: 'not-a-uuid' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                       'throws on bad UUID');
    check((threw?.message || '').includes('Invalid UUID format'), 'actionable error');
    check(withWriteSessionCalls === 0,                  'withWriteSession NOT called on Zod fail');
    check(deleteCalls === 0,                            'rawDeleteSchedule NOT called');
  }

  adapter.withWriteSession = orig;
  console.log('');
  if (failures === 0) console.log('[#142] All schedules_delete tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
