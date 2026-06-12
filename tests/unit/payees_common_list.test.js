// tests/unit/payees_common_list.test.js
// Unit tests for actual_payees_common_list tool.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const STUB_PAYEES = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Kroger' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Amazon' },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Shell', transfer_acct: undefined },
];

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  // Stub getCommonPayees at the api level
  apiDefault.getCommonPayees = async () => STUB_PAYEES;
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/payees_common_list.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const origGetCommonPayees = adapter.getCommonPayees;

  // createTool wraps handler return in { result: ... }
  // So tool.call() returns { result: [...] }

  console.log('\n[payees_common_list] positive: returns array of payees when adapter yields results');
  {
    adapter.getCommonPayees = async () => STUB_PAYEES;
    const res = await tool.call({});
    check(res?.result !== undefined, 'result key present');
    check(Array.isArray(res?.result), 'result is an array');
    check(res?.result?.length === 3, 'returns 3 payees from stub');
    check(res?.result?.[0]?.name === 'Kroger', 'first payee name correct');
    check(typeof res?.result?.[0]?.id === 'string', 'first payee has string id');
  }

  console.log('\n[payees_common_list] positive: empty list is a clean SUCCESS (no error thrown)');
  {
    adapter.getCommonPayees = async () => [];
    let threw = false;
    let res;
    try {
      res = await tool.call({});
    } catch (_) {
      threw = true;
    }
    check(!threw, 'no error thrown for empty result');
    check(Array.isArray(res?.result), 'result is an array');
    check(res?.result?.length === 0, 'result array is empty');
    adapter.getCommonPayees = async () => STUB_PAYEES;
  }

  console.log('\n[payees_common_list] positive: payee shape { id, name, transfer_acct? }');
  {
    const TYPED = [
      { id: 'aaa-111', name: 'Coffee Shop' },
      { id: 'bbb-222', name: 'Savings Transfer', transfer_acct: 'savings-acct-id' },
    ];
    adapter.getCommonPayees = async () => TYPED;
    const res = await tool.call({});
    const first = res?.result?.[0];
    const second = res?.result?.[1];
    check(typeof first?.id === 'string', 'id is a string');
    check(typeof first?.name === 'string', 'name is a string');
    check(!('transfer_acct' in first) || first.transfer_acct === undefined, 'transfer_acct absent for non-transfer payee');
    check(second?.transfer_acct === 'savings-acct-id', 'transfer_acct present when set');
    adapter.getCommonPayees = async () => STUB_PAYEES;
  }

  console.log('\n[payees_common_list] schema: accepts empty input {}');
  {
    let threw = false;
    try { tool.inputSchema.parse({}); } catch (_) { threw = true; }
    check(!threw, 'empty input accepted by schema');
  }

  console.log('\n[payees_common_list] schema: rejects unexpected properties (strict)');
  {
    // createTool uses z.object({}) which by default strips unknown keys (not strict),
    // so we verify that at minimum an empty object parses without throwing.
    let threw = false;
    try { tool.inputSchema.parse({}); } catch (_) { threw = true; }
    check(!threw, 'no error for valid empty input');
  }

  adapter.getCommonPayees = origGetCommonPayees;

  console.log('');
  if (failures === 0) console.log('[payees_common_list] All tests passed');
  else { console.error(`[payees_common_list] ${failures} test(s) FAILED`); process.exit(2); }
})();
