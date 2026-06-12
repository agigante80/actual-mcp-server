// tests/unit/payees_delete.test.js
// Regression test: actual_payees_delete must route through the guarded
// adapter.deletePayee (pre-flight existence check), NOT the raw api.deletePayee,
// which throws a cryptic "Cannot destructure property 'transfer_acct' of null" on a
// non-existent id. adapter.deletePayee owns the single write-cycle (#142) and turns a
// missing id into an actionable "Payee not found" error.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  const tool = (await import('../../dist/src/tools/payees_delete.js')).default;

  // Stub the guarded adapter method the tool now calls (property access at call time,
  // so reassignment is observed by the tool).
  let deleteCalls = 0;
  let lastId = null;
  let deleteThrows = null;
  const origDeletePayee = adapter.deletePayee;
  adapter.deletePayee = async (id) => { deleteCalls++; lastId = id; if (deleteThrows) throw deleteThrows; };

  const reset = () => { deleteCalls = 0; lastId = null; deleteThrows = null; };

  console.log('\npayees_delete: positive happy path');
  {
    reset();
    const res = await tool.call({ id: 'p-1' });
    check(res?.success === true,    'returns success: true');
    check(deleteCalls === 1,        'adapter.deletePayee called exactly once');
    check(lastId === 'p-1',         'called with the supplied id');
  }

  console.log('\npayees_delete: not-found / write-side error propagates as a throw');
  {
    reset();
    deleteThrows = new Error('Payee "p-missing" not found. Use actual_payees_get to list available payees.');
    let threw = null;
    try { await tool.call({ id: 'p-missing' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                'throws (does not swallow into success:false)');
    check(threw?.message?.includes('not found'), 'actionable not-found message');
    check(deleteCalls === 1,                     'adapter.deletePayee was attempted');
  }

  console.log('\npayees_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error,   'throws on missing id');
    check(deleteCalls === 0,        'adapter.deletePayee NOT called on Zod fail');
  }

  adapter.deletePayee = origDeletePayee;
  console.log('');
  if (failures === 0) console.log('All payees_delete tests passed ✓');
  else { console.error(`${failures} test(s) FAILED`); process.exit(2); }
})();
