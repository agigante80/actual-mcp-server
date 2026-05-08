// tests/unit/rules_delete.test.js
// Regression test for #142: actual_rules_delete must do exactly one
// withWriteSession invocation and preserve the existing notFoundMsg UX.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let rulesResponse = [];
  let deleteCalls = 0;
  apiDefault.getRules = async () => rulesResponse;
  apiDefault.deleteRule = async (_id) => { deleteCalls++; };

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/rules_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  let withWriteSessionCalls = 0;
  const orig = adapter.withWriteSession;
  adapter.withWriteSession = async (fn) => { withWriteSessionCalls++; return await fn(); };

  const reset = () => { withWriteSessionCalls = 0; deleteCalls = 0; rulesResponse = []; };

  console.log('\n[#142] rules_delete: positive happy path');
  {
    reset();
    rulesResponse = [{ id: 'rule-1' }];
    const res = await tool.call({ id: 'rule-1' });
    check(res?.success === true,         'returns success: true');
    check(withWriteSessionCalls === 1,   'withWriteSession called exactly once');
    check(deleteCalls === 1,             'rawDeleteRule called inside callback');
  }

  console.log('\n[#142] rules_delete: read-side not-found');
  {
    reset();
    rulesResponse = [];
    const res = await tool.call({ id: 'rule-missing' });
    check(res?.success === false,                       'returns success: false');
    check(res?.error?.includes('Rule'),                 'error mentions Rule');
    check(res?.error?.includes('rule-missing'),         'error mentions the id');
    check(res?.error?.includes('actual_rules_get'),     'error mentions list tool');
    check(withWriteSessionCalls === 1,                  'exactly one withWriteSession call');
    check(deleteCalls === 0,                            'rawDeleteRule NOT called');
  }

  console.log('\n[#142] rules_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error,        'throws on missing id');
    check(withWriteSessionCalls === 0,   'withWriteSession NOT called on Zod fail');
    check(deleteCalls === 0,             'rawDeleteRule NOT called');
  }

  adapter.withWriteSession = orig;
  console.log('');
  if (failures === 0) console.log('[#142] All rules_delete tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
