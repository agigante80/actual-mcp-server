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
  // #710: the adapter's reference guard (#485) lists payees for an id condition. The adapter
  // binds the raw call at import, so the stub has to exist before the import below.
  const PAYEES = ['10000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000b'];
  apiDefault.getPayees = async () => { witness?.noteRead(); return PAYEES.map((id) => ({ id, name: id })); };

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

  console.log('\n[#711] rules_create_or_update: text on an id field is refused with the exact message');
  for (const field of ['account', 'category', 'category_group', 'payee']) {
    reset();
    let threw = null;
    try {
      await tool.call({ ...validInput, conditions: [{ field, op: 'is', value: 'Groceries' }] });
    } catch (e) { threw = e; }
    const expected = field === 'payee'
      ? 'Field "payee" expects a UUID, but got "Groceries". Use "imported_payee" for text matching instead.'
      : `Field "${field}" expects a UUID, but got text "Groceries".`;
    check(threw?.message === expected,                           `NEGATIVE: text on ${field} is refused with the exact message`);
    check(cycles() === 0 && createCalls === 0 && updateCalls === 0, '  and no write cycle runs');
  }

  console.log('\n[#142] rules_create_or_update: schema rejection (missing actions)');
  {
    reset();
    let threw = null;
    try { await tool.call({ stage: 'pre', conditionsOp: 'and', conditions: validInput.conditions }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                'throws on missing actions');
    check(cycles() === 0,                                        'a Zod failure never reaches the write queue');
  }

  console.log('\n[#486] rules_create_or_update: stage keeps NO default after the schema prose trim (#342)');
  {
    const noStage = { conditions: validInput.conditions, actions: validInput.actions };
    const r = tool.inputSchema.safeParse(noStage);
    check(r.success && !('stage' in r.data),                     'omitting stage parses with no stage key', JSON.stringify(r.data));
    check(r.success && r.data.conditionsOp === 'and',            'conditionsOp still defaults to and');
    const nulled = tool.inputSchema.safeParse({ ...noStage, stage: null });
    check(nulled.success && nulled.data.stage === null,          'an explicit null stage is kept');
    const bad = tool.inputSchema.safeParse({ ...noStage, stage: 'default' });
    check(!bad.success && bad.error.issues[0].code === 'invalid_value' && bad.error.issues[0].path.join('.') === 'stage', 'stage "default" is a Zod invalid_value at stage');
  }

  console.log('\n[#703] rules_create_or_update: tag operators on notes');
  {
    reset();
    const out = await tool.call({ ...validInput, conditions: [{ field: 'notes', op: 'hasTags', value: '#trip' }] });
    check(out?.created === true && createCalls === 1, 'notes hasTags "#trip" is accepted on the upsert path');

    reset();
    let threw = null;
    try { await tool.call({ ...validInput, conditions: [{ field: 'notes', op: 'hasTags', value: '' }] }); } catch (e) { threw = e; }
    check(threw?.message === 'Operator "hasTags" needs at least one tag in its value, for example "#trip" (field: notes). Nothing was written.', 'NEGATIVE: an empty tag value is refused with the exact message', threw?.message);
    check(cycles() === 0 && createCalls === 0 && updateCalls === 0, '  and nothing is written');

    reset();
    threw = null;
    try { await tool.call({ ...validInput, conditions: [{ field: 'imported_payee', op: 'hasTags', value: '#trip' }] }); } catch (e) { threw = e; }
    check(threw?.message === 'Invalid operator "hasTags" for field "imported_payee". Field "imported_payee" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf.',
      'NEGATIVE: imported_payee hasTags is refused with the shared message (#711)', threw?.message);
    check(cycles() === 0 && createCalls === 0 && updateCalls === 0, '  and nothing is written');
  }

  console.log('\n[#710] rules_create_or_update: array and boolean condition values');
  {
    const [A, B] = PAYEES;
    reset();
    let out = await tool.call({ ...validInput, conditions: [{ field: 'payee', op: 'oneOf', value: [A, B] }] });
    check(out?.created === true && createCalls === 1, 'payee oneOf [a, b] with no match is created');

    reset();
    rulesResponse = [{ id: 'existing-rule-id', stage: 'pre', conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'oneOf', value: [A, B] }], actions: [{ op: 'set', field: 'notes', value: 'old' }] }];
    const reordered = [B, A];
    out = await tool.call({ ...validInput, conditions: [{ field: 'payee', op: 'oneOf', value: reordered }] });
    check(out?.created === false && out?.id === 'existing-rule-id' && updateCalls === 1 && createCalls === 0,
      'the same ids in another order match the existing rule (update, no duplicate)', JSON.stringify(out));
    check(reordered.join() === `${B},${A}` && updatedRule?.conditions?.[0]?.value?.join() === `${B},${A}`, '  and the caller\'s array is written in the order given, not sorted');

    reset();
    rulesResponse = [{ id: 'existing-rule-id', stage: 'pre', conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'oneOf', value: [A] }], actions: [{ op: 'set', field: 'notes', value: 'old' }] }];
    out = await tool.call({ ...validInput, conditions: [{ field: 'payee', op: 'oneOf', value: [A, B] }] });
    check(out?.created === true && createCalls === 1 && updateCalls === 0, 'NEGATIVE: a different id list does not match (a new rule is created)');

    reset();
    out = await tool.call({ ...validInput, conditions: [{ field: 'cleared', op: 'is', value: true }] });
    check(out?.created === true && createCalls === 1, 'cleared is true is accepted on the upsert path');

    for (const [label, conditions, part] of [
      ['oneOf []', [{ field: 'payee', op: 'oneOf', value: [] }], 'requires a non-empty array'],
      ['an array on is', [{ field: 'payee', op: 'is', value: [A] }], 'does not accept an array'],
      ['cleared is "true"', [{ field: 'cleared', op: 'is', value: 'true' }], 'must be true or false'],
      ['a boolean on notes', [{ field: 'notes', op: 'is', value: true }], 'does not accept a boolean'],
      ['a non-UUID element', [{ field: 'payee', op: 'oneOf', value: ['Amazon'] }], 'expects IDs (UUIDs)'],
      ['cleared isNot', [{ field: 'cleared', op: 'isNot', value: true }], 'Invalid operator "isNot" for field "cleared"'],
    ]) {
      reset();
      let threw = null;
      try { await tool.call({ ...validInput, conditions }); } catch (e) { threw = e; }
      check(threw?.message?.includes(part), `NEGATIVE: ${label} is refused`, threw?.message);
      check(cycles() === 0 && createCalls === 0 && updateCalls === 0, '  and nothing is written');
    }
  }

  console.log('\n[#711] rules_create_or_update: the shared operator map, same messages as actual_rules_create');
  {
    const VALID = 'imported_payee, payee, payee_name, account, category, category_group, notes, amount, date, cleared, reconciled';
    for (const [label, c] of [
      ['account onBudget ""', { field: 'account', op: 'onBudget', value: '' }],
      ['amount isbetween {1000, 5000}', { field: 'amount', op: 'isbetween', value: { num1: 1000, num2: 5000 } }],
      ['date isapprox', { field: 'date', op: 'isapprox', value: '2026-11-01' }],
      ['payee_name oneOf an array of text', { field: 'payee_name', op: 'oneOf', value: ['Amazon', 'AMZN'] }],
    ]) {
      reset();
      let out = null;
      let threw = null;
      try { out = await tool.call({ ...validInput, conditions: [c] }); } catch (e) { threw = e; }
      check(out?.created === true && createCalls === 1, `${label} is accepted on the upsert path`, threw?.message);
    }
    for (const [label, c, message] of [
      ['payee_name gte', { field: 'payee_name', op: 'gte', value: 'x' },
        'Invalid operator "gte" for field "payee_name". Field "payee_name" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf, hasTags, hasAnyTag.'],
      ['payee contains', { field: 'payee', op: 'contains', value: 'amazon' },
        'Invalid operator "contains" for field "payee". Field "payee" is a id field and only supports: is, isNot, oneOf, notOneOf. To match by name use "payee_name" or "imported_payee".'],
      ['description', { field: 'description', op: 'contains', value: 'x' }, `Unknown condition field "description". Valid fields: ${VALID}.`],
      ['saved', { field: 'saved', op: 'is', value: 'x' }, `Unknown condition field "saved". Valid fields: ${VALID}.`],
      ['amount isbetween 5000', { field: 'amount', op: 'isbetween', value: 5000 },
        'Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: amount).'],
      ['amount gte {num1, num2}', { field: 'amount', op: 'gte', value: { num1: 1, num2: 2 } }, 'Only "isbetween" takes a {num1, num2} value (field: amount, op: gte).'],
    ]) {
      reset();
      let threw = null;
      try { await tool.call({ ...validInput, conditions: [c] }); } catch (e) { threw = e; }
      check(threw?.message === message, `NEGATIVE: ${label} is refused with the exact message`, threw?.message);
      check(cycles() === 0 && createCalls === 0 && updateCalls === 0, '  and nothing is written');
    }
  }

  console.log('\n[#711] rules_create_or_update: reversed isbetween bounds are the same rule');
  {
    const { canonicalize } = await import('../../dist/src/lib/rule-matching.js');
    const key = (v) => canonicalize({ field: 'amount', op: 'isbetween', value: v });
    check(key({ num1: 1000, num2: 5000 }) === key({ num1: 5000, num2: 1000 }), 'canonicalize treats {1000, 5000} and {5000, 1000} as one range');
    check(key({ num2: 5000, num1: 1000 }) === key({ num1: 1000, num2: 5000 }), '  and does not depend on the key order');
    check(key({ num1: 1000, num2: 5000 }) !== key({ num1: 1000, num2: 6000 }), 'NEGATIVE: a different range stays a different key');

    const budget = (op, value) => canonicalize({ field: 'account', op, value });
    check(budget('onBudget', '') === budget('onBudget', 'x') && budget('offBudget', '') === budget('offBudget', 7), 'canonicalize ignores the value of onBudget and offBudget (upstream does too)');
    check(budget('onBudget', '') !== budget('offBudget', ''), 'NEGATIVE: onBudget and offBudget stay different keys');
    check(canonicalize({ field: 'account', op: 'is', value: 'a' }) !== canonicalize({ field: 'account', op: 'is', value: 'b' }), 'NEGATIVE: the value of any other operator still counts');

    const amountCond = (num1, num2) => ({ field: 'amount', op: 'isbetween', value: { num1, num2 } });
    const existing = () => [{ id: 'existing-rule-id', stage: 'pre', conditionsOp: 'and',
      conditions: [amountCond(1000, 5000)], actions: [{ op: 'set', field: 'notes', value: 'old' }] }];
    reset();
    rulesResponse = existing();
    const countBefore = rulesResponse.length;
    const out = await tool.call({ ...validInput, conditions: [amountCond(5000, 1000)] });
    check(out?.id === 'existing-rule-id' && out?.created === false, 'reversed bounds return the existing id with created false', JSON.stringify(out));
    check(updateCalls === 1 && createCalls === 0 && rulesResponse.length === countBefore, '  one update, no create: the rule count is unchanged');
    check(JSON.stringify(updatedRule?.conditions?.[0]?.value) === JSON.stringify({ num1: 5000, num2: 1000 }), '  and the rule is written with the bounds as last sent, not reordered', JSON.stringify(updatedRule?.conditions));

    reset();
    rulesResponse = existing();
    const other = await tool.call({ ...validInput, conditions: [amountCond(1000, 6000)] });
    check(other?.created === true && createCalls === 1 && updateCalls === 0, 'NEGATIVE: a different range creates a new rule');
  }

  console.log('\n[#761] rules_create_or_update: options are part of the identity');
  {
    const PLAIN = { field: 'amount', op: 'is', value: 5002 };
    const stored = (cond) => [{ id: 'existing-rule-id', stage: 'pre', conditionsOp: 'and', conditions: [cond], actions: [{ op: 'set', field: 'notes', value: 'old' }] }];
    const call = (cond) => tool.call({ ...validInput, conditions: [cond] });
    reset(); rulesResponse = stored(PLAIN);
    let out = await call({ ...PLAIN, options: { outflow: true } });
    check(out.created === true && createCalls === 1 && updateCalls === 0, 'outflow true against no options creates a second rule', JSON.stringify(out));
    reset(); rulesResponse = stored(PLAIN);
    out = await call({ ...PLAIN, options: { outflow: false } });
    check(out.created === false && out.id === 'existing-rule-id', 'outflow false against no options matches the same rule', JSON.stringify(out));
    reset(); rulesResponse = stored({ ...PLAIN, options: {} });
    out = await call(PLAIN);
    check(out.created === false, 'an empty stored options equals an absent one', JSON.stringify(out));
    reset(); rulesResponse = stored({ ...PLAIN, options: { outflow: true, inflow: false } });
    out = await call({ ...PLAIN, options: { outflow: true } });
    check(out.created === false, 'a false flag does not matter', JSON.stringify(out));
    reset(); rulesResponse = stored({ field: 'payee', op: 'is', value: PAYEES[0], options: { outflow: true } });
    let threw = null;
    try { out = await call({ field: 'payee', op: 'is', value: PAYEES[1] }); } catch (e) { threw = e; }
    check(!threw && out.created === true, 'a stored payee condition carrying options does not throw in the match', String(threw && threw.message));

    for (const [label, conditions, expected] of [
      ['options on payee', [{ field: 'payee', op: 'is', value: PAYEES[0], options: { outflow: true } }], 'options is only valid on an amount condition'],
      ['both flags', [{ ...PLAIN, options: { outflow: true, inflow: true } }], 'options cannot set both outflow and inflow'],
      ['negative value with a flag', [{ ...PLAIN, value: -5002, options: { outflow: true } }], 'an amount condition with outflow or inflow takes a positive value; the direction comes from the option'],
    ]) {
      reset(); threw = null;
      try { await tool.call({ ...validInput, conditions }); } catch (e) { threw = e; }
      check(threw?.message === expected && cycles() === 0, `NEGATIVE: ${label} is refused with the exact message`, threw?.message);
    }
    reset(); threw = null;
    try { await tool.call({ ...validInput, actions: [{ op: 'set', field: 'notes', value: 'x', bogus: true }] }); } catch (e) { threw = e; }
    check(/bogus/.test(threw?.message || '') && cycles() === 0, 'NEGATIVE: an unknown action key is refused naming it');
    reset(); threw = null;
    try { await tool.call({ ...validInput, conditions: [{ ...validInput.conditions[0], zzz: 1 }] }); } catch (e) { threw = e; }
    check(/zzz/.test(threw?.message || '') && cycles() === 0, 'NEGATIVE: an unknown condition key is refused naming it');
  }

  console.log('');
  if (failures === 0) console.log('[#142] All rules_create_or_update tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
