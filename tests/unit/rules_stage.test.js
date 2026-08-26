// tests/unit/rules_stage.test.js
//
// #342: rule stage must be 'pre' | 'post' | null, and an unspecified stage must
// mean NULL (Actual's normal stage), not 'pre'.
//
// WHY THIS ASSERTS ON THE OUTGOING PAYLOAD, NOT THE RETURN VALUE.
//
// The bug was invisible from the outside: creating a rule succeeded either way.
// The damage was that the rule silently landed in the 'pre' stage, which Actual
// runs BEFORE the default stage, so every MCP-created rule out-ranked every rule
// the user made in the UI. Nothing errored. The only place that is observable is
// the value handed to the API, so that is what these tests capture.
//
// Two facts verified against a live server (see the ticket), both of which these
// tests encode so they cannot be re-broken:
//   1. Actual REJECTS the literal "default" with `Invalid rule stage: default`,
//      despite its published API reference listing it (upstream: actualbudget/actual#8682).
//   2. Actual REJECTS an absent stage on create with `Invalid rule stage: undefined`.
//      So the tool cannot simply omit the key; it must SEND null.
//
// Run: node tests/unit/rules_stage.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

const CAT = '11111111-1111-1111-1111-111111111111';
const baseInput = (extra = {}) => ({
  conditions: [{ field: 'imported_payee', op: 'contains', value: 'X' }],
  actions: [{ op: 'set', field: 'category', type: 'id', value: CAT }],
  ...extra,
});

(async () => {
  // rules_create_or_update destructures raw @actual-app/api functions at MODULE
  // LOAD (it is one of the five sanctioned direct importers, see CLAUDE.md), so
  // these stubs MUST be installed before it is imported or the captured
  // references point at the real API. Same ordering rule as generated_tools.smoke.
  const apiMod = await import('@actual-app/api');
  const apiDefault = apiMod.default || apiMod;
  let created = null;
  let updated = null;
  let existingRules = [];
  apiDefault.createRule = async (rule) => { created = rule; return 'new-rule-id'; };
  apiDefault.updateRule = async (rule) => { updated = rule; return rule; };
  apiDefault.getRules = async () => existingRules;
  apiDefault.sync = async () => {};
  // The real adapter.updateRule (exercised in the last block) goes through the
  // write queue, which opens an Actual session. Stub the whole lifecycle so it
  // runs offline; without these it tries a real login and dies on invalid-password.
  apiDefault.init = async () => {};
  apiDefault.downloadBudget = async () => {};
  apiDefault.shutdown = async () => {};

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;

  // Capture what actually reaches the API layer.
  let sent = null;
  adapter.createRule = async (rule) => { sent = rule; return 'rule-id-1'; };
  adapter.updateRule = async (id, fields) => { sent = { id, ...fields }; return null; };
  // #376 removed the tool-layer session from rules_create_or_update, so this stub is inert
  // for the upsert cases below: they drive the REAL adapter.upsertRule through the write
  // queue. Kept ONLY for the other cases in this file that still call it; do not copy it
  // into a new test as a way to reach a guard, because it removes the guard.
  adapter.withWriteSession = async (fn) => fn();
  adapter.getRules = async () => ([]);

  const create = (await import('../../dist/src/tools/rules_create.js')).default;
  const update = (await import('../../dist/src/tools/rules_update.js')).default;
  const upsert = (await import('../../dist/src/tools/rules_create_or_update.js')).default;

  // -------------------------------------------------------------------------
  console.log('\n[rules-stage] rules_create: an unspecified stage means NULL, not "pre"');
  // -------------------------------------------------------------------------
  {
    sent = null;
    await create.call(baseInput());
    check(sent !== null, 'the adapter was called');
    check('stage' in sent, 'the stage key IS present (Actual rejects undefined on create)');
    check(sent.stage === null, `stage is null, not "pre" (got ${JSON.stringify(sent.stage)})`);
  }

  console.log('\n[rules-stage] rules_create: explicit values pass through unchanged');
  {
    for (const v of [null, 'pre', 'post']) {
      sent = null;
      await create.call(baseInput({ stage: v }));
      check(sent.stage === v, `stage ${JSON.stringify(v)} passes through`);
    }
  }

  console.log('\n[rules-stage] rules_create: invalid stages are rejected BEFORE reaching Actual');
  {
    for (const [v, why] of [
      ['default', 'the value the upstream docs wrongly advertise'],
      ['middle', 'an unknown stage'],
      ['', 'an empty string'],
      ['PRE', 'wrong case'],
      [0, 'a number'],
    ]) {
      sent = null;
      let rejected = false;
      try { await create.call(baseInput({ stage: v })); } catch { rejected = true; }
      check(rejected, `rejects ${JSON.stringify(v)}: ${why}`);
      check(sent === null, `  and never calls the adapter for ${JSON.stringify(v)}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n[rules-stage] rules_update: omitting stage must NOT force a value');
  // -------------------------------------------------------------------------
  {
    // A partial update that silently set stage would move an existing rule
    // between stages behind the user's back.
    sent = null;
    await update.call({ id: '22222222-2222-2222-2222-222222222222', fields: { conditionsOp: 'or' } });
    check(sent !== null, 'the adapter was called');
    check(sent.stage === undefined, 'stage is absent when the caller did not supply it');

    sent = null;
    await update.call({ id: '22222222-2222-2222-2222-222222222222', fields: { stage: null } });
    check(sent.stage === null, 'an explicit null IS forwarded (moves a rule back to the normal stage)');

    sent = null;
    await update.call({ id: '22222222-2222-2222-2222-222222222222', fields: { stage: 'post' } });
    check(sent.stage === 'post', 'an explicit "post" is forwarded');

    let rejected = false;
    try { await update.call({ id: '22222222-2222-2222-2222-222222222222', fields: { stage: 'default' } }); }
    catch { rejected = true; }
    check(rejected, 'rejects "default" on update too');
  }

  // -------------------------------------------------------------------------
  console.log('\n[rules-stage] rules_create_or_update: the upsert paths');
  // -------------------------------------------------------------------------
  {
    // CREATE path: no existing match, stage omitted -> must SEND null.
    created = null;
    await upsert.call(baseInput());
    check(created !== null, 'create path reached the API');
    check('stage' in created, 'create path sends the stage key');
    check(created.stage === null, `create path sends null (got ${JSON.stringify(created?.stage)})`);

    // UPDATE path: an existing rule with the SAME conditions is matched.
    const existing = {
      id: 'existing-rule',
      stage: 'post',
      conditionsOp: 'and',
      conditions: [{ field: 'imported_payee', op: 'contains', value: 'X' }],
      actions: [{ op: 'set', field: 'category', value: 'old-cat' }],
    };
    existingRules = [existing];

    // Omitted stage on update must LEAVE THE EXISTING STAGE ALONE.
    updated = null;
    await upsert.call(baseInput());
    check(updated !== null, 'update path reached the API');
    check(updated.stage === 'post', `omitted stage keeps the existing stage (got ${JSON.stringify(updated?.stage)})`);

    // THE `??` TRAP. An EXPLICIT null must win over the existing stage. With
    // `ruleData.stage ?? existing.stage` this silently kept 'post', making it
    // impossible to move a rule back to the normal stage.
    updated = null;
    await upsert.call(baseInput({ stage: null }));
    check(updated.stage === null, `an explicit null overrides the existing stage (got ${JSON.stringify(updated?.stage)})`);

    updated = null;
    await upsert.call(baseInput({ stage: 'pre' }));
    check(updated.stage === 'pre', 'an explicit "pre" overrides the existing stage');

    let rejected = false;
    try { await upsert.call(baseInput({ stage: 'default' })); } catch { rejected = true; }
    check(rejected, 'rejects "default" on upsert too');
  }

  // -------------------------------------------------------------------------
  console.log('\n[rules-stage] adapter.updateRule: the REAL merge, not a stub of it');
  // -------------------------------------------------------------------------
  {
    // WHY THIS EXISTS. The rules_update block above stubs adapter.updateRule, so it
    // only proves the TOOL forwards null to the adapter boundary. It passed happily
    // while adapter.updateRule itself still did `fieldsObj.stage ?? existingRule.stage`
    // and silently dropped the null. A test that stubs the layer containing the bug
    // is worse than no test: it reports confidence it has not earned.
    //
    // So this exercises the real adapter function against a stubbed raw API.
    const realUpdateRule = adapterMod.updateRule;
    // Set the VARIABLE the captured closure reads, not the property: the adapter
    // destructured getRules at module load, so reassigning apiDefault.getRules now
    // would have no effect on it.
    existingRules = [
      { id: 'r1', stage: 'post', conditionsOp: 'and', conditions: [{ field: 'notes', op: 'is', value: 'x' }], actions: [] },
    ];
    // The adapter captured `updateRule` at module load too, and that stub writes to
    // `updated`. Reassigning the property here would be ignored, so read `updated`.

    updated = null;
    await realUpdateRule('r1', JSON.parse(JSON.stringify({ stage: null })));
    check(updated?.stage === null, `explicit null REACHES the API (got ${JSON.stringify(updated?.stage)})`);

    updated = null;
    await realUpdateRule('r1', JSON.parse(JSON.stringify({ conditionsOp: 'or' })));
    check(updated?.stage === 'post', 'an omitted stage still preserves the existing stage');

    updated = null;
    await realUpdateRule('r1', JSON.parse(JSON.stringify({ stage: 'pre' })));
    check(updated?.stage === 'pre', 'an explicit "pre" reaches the API');

    // The sibling fields must KEEP `??` semantics: null is not meaningful for them.
    updated = null;
    await realUpdateRule('r1', JSON.parse(JSON.stringify({ actions: [{ op: 'set', field: 'notes', value: 'y' }] })));
    check(updated?.conditionsOp === 'and', 'unrelated fields still fall back to the existing rule');

    existingRules = [];
  }

  console.log('');
  if (failures === 0) console.log('[rules-stage] All tests passed');
  else { console.error(`[rules-stage] ${failures} test(s) FAILED`); process.exit(2); }
})();
