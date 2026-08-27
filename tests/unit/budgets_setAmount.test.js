// tests/unit/budgets_setAmount.test.js
// Regression test for #89: nil-UUID categoryId should return { success: false, error }, not {}
//
// Run via: npm run test:unit-js
// Or: node tests/unit/budgets_setAmount.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' — ' + d : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // #361: these raw stubs MUST be installed before the adapter import. actual-adapter.ts
  // destructures the api functions at module load, so a stub applied afterwards is never
  // seen and the real function runs.
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  let rawSetCalls = 0;
  let budgetMonths = ['2026-01', '2026-02', '2026-03'];
  apiDefault.sync = async () => {};
  apiDefault.getCategories = async () => [{ id: '10000000-0000-4000-8000-000000000001', name: 'Food' }];
  apiDefault.getBudgetMonths = async () => budgetMonths;
  apiDefault.setBudgetAmount = async () => { rawSetCalls++; };

  const [toolMod, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/budgets_setAmount.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  const tool    = toolMod;
  const adapter = adapterMod.default;

  // #89 negative paths, driven through the REAL adapter guard.
  //
  // These two cases used to stub adapter.setBudgetAmount and throw the refusal themselves.
  // That is the trap this whole area is about: the test CHOSE the type the tool was
  // looking for, so it proved nothing about what the adapter actually throws. It let a
  // real regression ship, where #377 converted the month guard to a typed refusal and
  // left the sibling CATEGORY guard as a bare Error, silently undoing #89's structured
  // response. The cases below run the real guard, so they cannot pass that way again.

  // #361: the MONTH, which was entirely unvalidated.
  //
  // Everything from here down runs against the REAL adapter (raw stubs installed before the
  // adapter import, session disarmed), because the guards live there.
  {
    adapterMod._setSkipApiInitForTests(true);
    const realAdapter = adapterMod.default;
    realAdapter.setBudgetAmount = adapterMod.setBudgetAmount;

    console.log('\n[#361] month must be one this budget actually has');
    {
      rawSetCalls = 0;
      let threw = null;
      try { await realAdapter.setBudgetAmount('2019-01', '10000000-0000-4000-8000-000000000001', 1000); } catch (e) { threw = e; }
      // #377: the refusal is identified by TYPE. The message is still asserted for the
      // CONTENT a caller needs to act (the range and the listing tool), but no assertion
      // depends on a particular phrasing, so the wording can be reworded freely. It was
      // reworded in this very change, from "is not in this budget" to "is outside this
      // budget's range", and nothing here or in the tool had to move.
      check(isPreflightRefusal(threw),                                   'an out-of-range month is refused');
      check(threw?.refusalKind === 'out-of-range',                       'and the refusal is typed as out-of-range');
      check(!!threw && threw.message.includes('2026-01'),                'message names the first month available');
      check(!!threw && threw.message.includes('2026-03'),                'message names the last month available');
      check(!!threw && threw.message.includes('actual_budgets_getMonths'), 'message names the listing tool');
      check(rawSetCalls === 0,                                          'no write attempted for an out-of-range month');
    }

    console.log('\n[#361] the TOOL reports a month refusal in the same shape as a category refusal');
    {
      // Both are "you asked for something that does not exist"; a caller should not have to
      // parse two forms. Driven through the tool, not the adapter, because the shape is the
      // tool's contract.
      // #377: this is THE end-to-end case. The refusal is raised by the real
      // adapter.setBudgetAmount guard, travels through the real tool, and the tool's
      // decision to return { success: false } is made by type. Neither side reproduces
      // the other's string, so a reword cannot break the contract silently.
      const res = await tool.call({ month: '2019-01', categoryId: '10000000-0000-4000-8000-000000000001', amount: 1000 });
      check(res?.success === false,                              'month refusal returns success:false, not a throw');
      check(typeof res?.error === 'string' && res.error.length > 0, 'and carries an actionable message');
      check(/actual_budgets_getMonths/.test(res?.error ?? ''),    'that names the tool to call next');
    }

    console.log('\n[#89] an unknown category returns the structured refusal, not a throw');
    {
      // THE REGRESSION CASE. `budgets_setAmount` is one of only two tools whose published
      // contract is the SHAPE rather than the error channel, so an unknown category must
      // come back as { success: false, error } and must NOT throw.
      const nilUuid = '00000000-0000-0000-0000-000000000000';
      rawSetCalls = 0;
      let threw = null;
      let res = null;
      try { res = await tool.call({ month: '2026-02', categoryId: nilUuid, amount: 50000 }); }
      catch (e) { threw = e; }
      check(threw === null,                                 'an unknown category does not throw');
      check(res?.success === false,                         'success is false');
      check(typeof res?.error === 'string',                 'error field is a string');
      check((res?.error ?? '').includes(nilUuid),           'error names the id');
      check(/actual_categories_get/.test(res?.error ?? ''), 'error names the listing tool');
      check(rawSetCalls === 0,                              'no write attempted for an unknown category');
    }

    console.log('\n[#89] the adapter raises that refusal as a TYPED one');
    {
      // Asserted against the adapter directly, so the tool's behaviour above is explained
      // rather than coincidental.
      let threw = null;
      try { await realAdapter.setBudgetAmount('2026-02', '19999999-0000-4000-8000-000000000009', 1000); }
      catch (e) { threw = e; }
      check(isPreflightRefusal(threw),          'the category guard throws a pre-flight refusal');
      check(threw?.refusalKind === 'not-found', 'typed as not-found');
      check(threw?.entity === 'Category',       'carrying the entity');
      // Anchored on the TAIL. `/categories/` alone also matches inside
      // "actual_categories_get", so it stayed green with the old bare-"s" pluraliser and
      // could not fail for the reason its label names.
      check(/list available categories\.$/.test(threw?.message ?? ''),
        'and the message pluralises correctly rather than saying "categorys"');
    }

    console.log('\n[#377] a genuine failure is NOT swallowed into the refusal shape');
    {
      // The other half of the contract, and the one a type check makes possible: only a
      // PreflightRefusal becomes { success: false }. Anything else must keep propagating,
      // or a transport or upstream failure would be reported to the model as a tidy
      // "category not found" it could never fix.
      const saved = realAdapter.setBudgetAmount;
      realAdapter.setBudgetAmount = async () => { throw new Error('ECONNRESET'); };
      let threw = null;
      try { await tool.call({ month: '2026-02', categoryId: '10000000-0000-4000-8000-000000000001', amount: 1000 }); }
      catch (e) { threw = e; }
      check(threw instanceof Error,                              'a non-refusal still throws');
      check(!isPreflightRefusal(threw),                          'and is not reported as a refusal');
      check(/ECONNRESET/.test(threw?.message ?? ''),             'and the cause survives in the message');
      realAdapter.setBudgetAmount = saved;
    }

    console.log('\n[#377] a bare Error carrying refusal-shaped PROSE is not a refusal');
    {
      // The regression this ticket exists to prevent. Before the typed refusal, ANY error
      // whose text happened to contain "not found" and "category" was converted into a
      // structured success:false. That is the failure mode in reverse: prose deciding
      // control flow means unrelated text can trigger it.
      const saved = realAdapter.setBudgetAmount;
      realAdapter.setBudgetAmount = async () => {
        throw new Error('upstream error: category index not found in the search catalogue');
      };
      let threw = null;
      try { await tool.call({ month: '2026-02', categoryId: '10000000-0000-4000-8000-000000000001', amount: 1000 }); }
      catch (e) { threw = e; }
      check(threw instanceof Error, 'prose alone no longer produces a structured refusal');
      realAdapter.setBudgetAmount = saved;
    }

  console.log('\n[#361] a month inside the budget still writes');
    {
      rawSetCalls = 0;
      let threw = null;
      try { await realAdapter.setBudgetAmount('2026-02', '10000000-0000-4000-8000-000000000001', 1000); } catch (e) { threw = e; }
      check(threw === null,       'an in-range month is accepted');
      check(rawSetCalls === 1,    'the write happened exactly once');
    }

    console.log('\n[#361] amount 0 is a legitimate budget value, not a falsy skip');
    {
      rawSetCalls = 0;
      await realAdapter.setBudgetAmount('2026-02', '10000000-0000-4000-8000-000000000001', 0);
      check(rawSetCalls === 1, 'setting a category back to zero reaches the write');
    }

    console.log('\n[#361] an empty months list does not block the write');
    {
      // Defensive: if upstream ever returns nothing, refusing every write would be worse
      // than the bug being fixed.
      budgetMonths = [];
      rawSetCalls = 0;
      await realAdapter.setBudgetAmount('2026-02', '10000000-0000-4000-8000-000000000001', 500);
      check(rawSetCalls === 1, 'an empty months list is treated as unknown, not as a refusal');
      budgetMonths = ['2026-01', '2026-02', '2026-03'];
    }
  }

  // Positive path: a valid categoryId returns { result }.
  //
  // This one legitimately stubs the adapter: the claim is about the TOOL's envelope, not
  // about the guard, and the guard has its own real-adapter cases above.
  console.log('\n[#89] Positive path: a valid categoryId returns { result }');
  {
    adapter.setBudgetAmount = async () => ({ budgeted: 50000 });
    const res = await tool.call({ month: '2026-04', categoryId: '10000000-0000-4000-8000-000000000001', amount: 50000 });
    check(res && 'result' in res,   'response has result key');
    check(res?.success !== false,   'success is not false on happy path');
  }

  console.log('');
  if (failures === 0) {
    console.log('[#89] All budgets_setAmount tests passed ✓');
  } else {
    console.error(`[#89] ${failures} test(s) FAILED`);
    process.exit(2);
  }
})();
