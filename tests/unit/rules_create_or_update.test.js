// tests/unit/rules_create_or_update.test.js
// Regression test for #142: actual_rules_create_or_update must do exactly one
// withWriteSession invocation, branching create vs update inside the same callback.

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

  let rulesResponse = [];
  let createCalls = 0;
  let createReturns = 'new-rule-id';
  let updateCalls = 0;
  let updatedRule = null;
  apiDefault.getRules = async () => rulesResponse;
  apiDefault.createRule = async (_data) => { createCalls++; return createReturns; };
  apiDefault.updateRule = async (rule) => { updateCalls++; updatedRule = rule; };

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/rules_create_or_update.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  let withWriteSessionCalls = 0;
  const orig = adapter.withWriteSession;
  adapter.withWriteSession = async (fn) => { withWriteSessionCalls++; return await fn(); };

  const reset = () => {
    withWriteSessionCalls = 0;
    createCalls = 0; createReturns = 'new-rule-id';
    updateCalls = 0; updatedRule = null;
    rulesResponse = [];
  };

  const validInput = {
    stage: 'pre',
    conditionsOp: 'and',
    conditions: [{ field: 'imported_payee', op: 'contains', value: 'amazon' }],
    actions:    [{ op: 'set', field: 'notes', value: 'flagged', type: 'string' }],
  };

  console.log('\n[#142] rules_create_or_update: create branch (no match)');
  {
    reset();
    rulesResponse = []; // no existing rules
    const res = await tool.call(validInput);
    check(res?.id === 'new-rule-id',      'returns id of created rule');
    check(res?.created === true,          'created flag is true');
    check(withWriteSessionCalls === 1,    'withWriteSession called exactly once');
    check(createCalls === 1,              'rawCreateRule called inside callback');
    check(updateCalls === 0,              'rawUpdateRule NOT called');
  }

  console.log('\n[#142] rules_create_or_update: update branch (matched conditions)');
  {
    reset();
    rulesResponse = [{
      id: 'existing-rule-id',
      stage: 'pre',
      conditionsOp: 'and',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'amazon' }],
      actions:    [{ op: 'set', field: 'notes', value: 'old-value' }],
    }];
    const res = await tool.call(validInput);
    check(res?.id === 'existing-rule-id', 'returns id of existing rule');
    check(res?.created === false,         'created flag is false');
    check(withWriteSessionCalls === 1,    'withWriteSession called exactly once');
    check(updateCalls === 1,              'rawUpdateRule called inside callback');
    check(createCalls === 0,              'rawCreateRule NOT called');
    check(updatedRule?.id === 'existing-rule-id', 'updated rule has the right id');
    check(updatedRule?.actions?.[0]?.value === 'flagged',  'updated actions overwritten');
  }

  console.log('\n[#142] rules_create_or_update: invalid operator for field type');
  {
    reset();
    let threw = null;
    try {
      await tool.call({
        ...validInput,
        conditions: [{ field: 'amount', op: 'contains', value: 100 }],
      });
    } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws on invalid operator');
    check((threw?.message || '').includes('Invalid operator "contains" for field "amount"'), 'actionable error');
    check(withWriteSessionCalls === 0,                           'withWriteSession NOT called');
    check(createCalls === 0 && updateCalls === 0,                'no raw write attempted');
  }

  console.log('\n[#142] rules_create_or_update: non-UUID for payee field');
  {
    reset();
    let threw = null;
    try {
      await tool.call({
        ...validInput,
        conditions: [{ field: 'payee', op: 'is', value: 'plain-text' }],
      });
    } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws on non-UUID payee value');
    check((threw?.message || '').includes('expects a UUID'),     'actionable error');
    check(withWriteSessionCalls === 0,                           'withWriteSession NOT called');
  }

  console.log('\n[#142] rules_create_or_update: schema rejection (missing actions)');
  {
    reset();
    let threw = null;
    try { await tool.call({ stage: 'pre', conditionsOp: 'and', conditions: validInput.conditions }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws on missing actions');
    check(withWriteSessionCalls === 0,                           'withWriteSession NOT called on Zod fail');
  }

  adapter.withWriteSession = orig;
  console.log('');
  if (failures === 0) console.log('[#142] All rules_create_or_update tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
