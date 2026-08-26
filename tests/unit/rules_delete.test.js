// tests/unit/rules_delete.test.js
// #142: actual_rules_delete must do exactly ONE write-queue cycle and preserve the
// actionable notFoundMsg UX. #355: it must not report success when upstream refuses to
// delete a schedule-owned rule.
//
// #376: both guards MOVED from the tool into adapter.deleteRule, and this test moved with
// them. It used to stub adapter.withWriteSession with a pass-through counter, which stubs
// away the thing under test once the guard is no longer in the tool. It now disarms api
// init and stubs the RAW api functions, so the real adapter guard runs.

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
  let deleteCalls = 0;
  apiDefault.getRules = async () => rulesResponse;
  // #355: the stub must return what upstream actually returns. It used to return
  // `undefined`, which encoded the same wrong assumption the tool did: that
  // `deleteRule` has no verdict. It returns `true` when it deleted the rule and
  // `false` when a schedule owns it.
  let deleteResult = true;
  apiDefault.deleteRule = async (_id) => { deleteCalls++; return deleteResult; };

  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/rules_delete.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  apiDefault.sync = async () => {};
  adapterMod._setSkipApiInitForTests(true);

  let batchesBefore = 0;
  const cycles = () => adapterMod._getWriteQueueBatchCountForTests() - batchesBefore;
  const reset = () => {
    deleteCalls = 0; rulesResponse = []; deleteResult = true;
    batchesBefore = adapterMod._getWriteQueueBatchCountForTests();
  };

  console.log('\n[#142] rules_delete: positive happy path');
  {
    reset();
    rulesResponse = [{ id: 'rule-1' }];
    const res = await tool.call({ id: 'rule-1' });
    check(res?.success === true, 'returns success: true');
    check(deleteCalls === 1,     'rawDeleteRule called');
    // The #142 property, asserted against the real queue rather than a stubbed wrapper.
    check(cycles() === 1,        'exactly one write-queue cycle for the read and the write');
  }

  console.log('\n[#142] rules_delete: read-side not-found');
  {
    reset();
    rulesResponse = [];
    let threw = null;
    try { await tool.call({ id: 'rule-missing' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                       'throws on not-found');
    check(isPreflightRefusal(threw),                    'and it is a typed pre-flight refusal (#377)');
    check(threw?.message?.includes('Rule'),             'error mentions Rule');
    check(threw?.message?.includes('rule-missing'),     'error mentions the id');
    check(threw?.message?.includes('actual_rules_get'), 'error mentions list tool');
    check(deleteCalls === 0,                            'rawDeleteRule NOT called');
    check(cycles() === 1,                               'exactly one write-queue cycle');
  }

  console.log('\n[#355] rules_delete: rule is owned by a schedule, upstream refuses');
  {
    reset();
    rulesResponse = [{ id: 'rule-sched' }];
    deleteResult = false;                 // what upstream returns for a schedule's rule
    let threw = null;
    try { await tool.call({ id: 'rule-sched' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                             'throws instead of reporting success');
    check(!!threw && /schedule/i.test(threw.message),          'error says the rule belongs to a schedule');
    check(!!threw && threw.message.includes('actual_schedules_delete'),
                                                              'error names actual_schedules_delete');
    check(!!threw && threw.message.includes('rule-sched'),     'error names the rule id');
    check(deleteCalls === 1,                                   'the delete was still attempted exactly once');
    // NOT a pre-flight refusal: the write WAS attempted and upstream declined it. A
    // PreflightRefusal means nothing was tried, which would be the wrong claim here.
    check(!isPreflightRefusal(threw),                          'and it is not classed as a pre-flight refusal');
    check(cycles() === 1,                                      'exactly one write-queue cycle (#142)');
  }

  console.log('\n[#355] rules_delete: back-compat, upstream returned no verdict');
  {
    // Only an EXPLICIT false is a refusal. A build that returns undefined must still
    // succeed, so this stays correct against older and future @actual-app/api versions.
    reset();
    rulesResponse = [{ id: 'rule-1' }];
    deleteResult = undefined;
    const res = await tool.call({ id: 'rule-1' });
    check(res?.success === true, 'undefined return is treated as success, not refusal');
  }

  console.log('\n[#142] rules_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on missing id');
    check(deleteCalls === 0,      'rawDeleteRule NOT called');
    check(cycles() === 0,         'a Zod failure never reaches the write queue at all');
  }

  console.log('');
  if (failures === 0) console.log('[#142] All rules_delete tests passed ✓');
  else { console.error(`[#142] ${failures} test(s) FAILED`); process.exit(2); }
})();
