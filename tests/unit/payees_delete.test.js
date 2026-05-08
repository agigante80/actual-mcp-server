// tests/unit/payees_delete.test.js
// Regression test for #142: actual_payees_delete must invoke withWriteSession
// exactly once per call (replacing the prior queueWriteOperation entry inside
// adapter.deletePayee with a tool-layer wrapper for consistency).

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let deleteCalls = 0;
  let deleteThrows = null;
  apiDefault.deletePayee = async (_id) => {
    deleteCalls++;
    if (deleteThrows) throw deleteThrows;
  };

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/payees_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  let withWriteSessionCalls = 0;
  const orig = adapter.withWriteSession;
  adapter.withWriteSession = async (fn) => { withWriteSessionCalls++; return await fn(); };

  const reset = () => { withWriteSessionCalls = 0; deleteCalls = 0; deleteThrows = null; };

  console.log('\n[#142] payees_delete: positive happy path');
  {
    reset();
    const res = await tool.call({ id: 'p-1' });
    check(res?.success === true,         'returns success: true');
    check(withWriteSessionCalls === 1,   'withWriteSession called exactly once');
    check(deleteCalls === 1,             'rawDeletePayee called inside callback');
  }

  console.log('\n[#142] payees_delete: write-side error propagation');
  {
    reset();
    deleteThrows = new Error('Payee not found');
    let threw = null;
    try { await tool.call({ id: 'p-missing' }); } catch (e) { threw = e; }
    check(threw?.message === 'Payee not found',     'underlying error propagates');
    check(withWriteSessionCalls === 1,              'still exactly one withWriteSession call');
    check(deleteCalls === 1,                        'rawDeletePayee was attempted');
  }

  console.log('\n[#142] payees_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error,        'throws on missing id');
    check(withWriteSessionCalls === 0,   'withWriteSession NOT called on Zod fail');
    check(deleteCalls === 0,             'rawDeletePayee NOT called');
  }

  adapter.withWriteSession = orig;
  console.log('');
  if (failures === 0) console.log('[#142] All payees_delete tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
