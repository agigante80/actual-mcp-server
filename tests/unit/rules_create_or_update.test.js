// tests/unit/rules_create_or_update.test.js
// Regression test for #142: actual_rules_create_or_update must do exactly one
// write-queue cycle, branching create vs update inside the same cycle.
//
// #376: the read-match-write cycle MOVED from the tool into adapter.upsertRule (identity
// rules in src/lib/rule-matching.ts). This test moved with it: stubbing
// adapter.withWriteSession with a pass-through counter would now stub away the thing under
// test, so api init is disarmed and the RAW api functions are stubbed instead.

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
  // #376: the witness samples the drain counter from INSIDE the raw stubs, which is what
  // distinguishes a read inside the drain from one before it. See helpers/write-cycle.mjs.
  let witness;
  apiDefault.getRules = async () => { witness?.noteRead(); return rulesResponse; };
  apiDefault.createRule = async (_data) => { witness?.noteWrite(); createCalls++; return createReturns; };
  apiDefault.updateRule = async (rule) => { witness?.noteWrite(); updateCalls++; updatedRule = rule; };

  const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/rules_create_or_update.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  apiDefault.sync = async () => {};
  adapterMod._setSkipApiInitForTests(true);
  witness = makeCycleWitness(adapterMod);

  const cycles = () => witness.cycles();
  const reset = () => {
    createCalls = 0; createReturns = 'new-rule-id';
    updateCalls = 0; updatedRule = null;
    rulesResponse = [];
    witness.reset();
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
    check(witness.sharedOneCycle(),
      'the read and the write ran in the SAME drain (#376)', witness.describe());
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
    check(witness.sharedOneCycle(),
      'the read and the update ran in the SAME drain (#376)', witness.describe());
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
    check(cycles() === 0,                                        'the write queue is never reached');
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
    check(cycles() === 0,                                        'the write queue is never reached');
  }

  console.log('\n[#142] rules_create_or_update: schema rejection (missing actions)');
  {
    reset();
    let threw = null;
    try { await tool.call({ stage: 'pre', conditionsOp: 'and', conditions: validInput.conditions }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws on missing actions');
    check(cycles() === 0,                                        'a Zod failure never reaches the write queue');
  }

  console.log('');
  if (failures === 0) console.log('[#142] All rules_create_or_update tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
