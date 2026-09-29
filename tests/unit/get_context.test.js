// tests/unit/get_context.test.js
//
// #484: unit tests for actual_get_context.
//
// Outcome-oriented tool returning high-level budget structure (accounts, categories,
// payees) in a single call, under a single withActualApi lock cycle.
//
// Run: node tests/unit/get_context.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // Raw API functions stubbed before adapter import
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  let rawAccounts = [];
  let rawCategoryGroups = [];
  let rawPayees = [];
  let payeeReadCount = 0;

  apiDefault.getAccounts = async () => rawAccounts;
  apiDefault.getCategoryGroups = async () => rawCategoryGroups;
  apiDefault.getPayees = async () => {
    payeeReadCount++;
    return rawPayees;
  };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  adapterMod._setSkipApiInitForTests(true);

  const tool = (await import('../../dist/src/tools/get_context.js')).default;

  // Fixtures
  const FIXTURES = {
    accounts: [
      { id: 'a1', name: 'Checking', offbudget: false, closed: false },
      { id: 'a2', name: 'Savings', offbudget: true, closed: false },
      { id: 'a3', name: 'Old Credit Card', offbudget: false, closed: true },
    ],
    categoryGroups: [
      {
        id: 'g1',
        name: 'Everyday Expenses',
        is_income: false,
        categories: [
          { id: 'c1', name: 'Groceries', hidden: false },
          { id: 'c2', name: 'Dining Out', hidden: false },
        ],
      },
      {
        id: 'g2',
        name: 'Income',
        is_income: true,
        categories: [
          { id: 'c3', name: 'Salary', hidden: false },
        ],
      },
    ],
    payees: [
      { id: 'p1', name: 'Target', transfer_acct: null },
      { id: 'p2', name: 'Kroger', transfer_acct: null },
      { id: 'p3', name: 'Amazon', transfer_acct: null },
      { id: 'p4', name: 'Transfer: Savings', transfer_acct: 'a2' },
    ],
  };

  const reset = () => {
    rawAccounts = FIXTURES.accounts;
    rawCategoryGroups = FIXTURES.categoryGroups;
    rawPayees = FIXTURES.payees;
    payeeReadCount = 0;
    adapterMod._resetWithActualApiCallCountForTests();
  };

  console.log('\n[get_context] Scenario 1: defaults with 3 accounts (1 closed), 2 groups, 4 payees');
  {
    reset();
    const res = await tool.call({});
    const r = res?.result;

    check(r !== undefined, 'returns result wrapper');
    check(r?.accounts?.length === 2, '2 active accounts returned (1 closed excluded)', `got ${r?.accounts?.length}`);
    check(r?.accounts?.every((a) => !a.closed), 'closed account is excluded');
    check(r?.accounts?.some((a) => a.id === 'a1'), 'account a1 present');
    check(r?.category_groups?.length === 2, '2 category groups returned', `got ${r?.category_groups?.length}`);
    check(r?.category_groups[0]?.categories?.length === 2, 'group g1 has 2 nested categories');
    check(r?.payees?.length === 4, 'all 4 payees returned', `got ${r?.payees?.length}`);
    check(r?.payees_truncated === false, 'payees_truncated is false');
    check(r?.payee_total === 4, 'payee_total is 4');
    check(adapterMod._getWithActualApiCallCountForTests() === 1, 'executed in exactly ONE withActualApi cycle', `was ${adapterMod._getWithActualApiCallCountForTests()}`);
  }

  console.log('\n[get_context] Scenario 2: payee_limit: 2 with 4 payees (truncation)');
  {
    reset();
    const res = await tool.call({ payee_limit: 2 });
    const r = res?.result;

    check(r?.payees?.length === 2, 'payees list truncated to 2', `got ${r?.payees?.length}`);
    check(r?.payees_truncated === true, 'payees_truncated is true');
    check(r?.payee_total === 4, 'payee_total is 4');
    check(typeof r?.message === 'string' && r.message.includes('2 of 4'), 'message reports truncation correctly');
    check(adapterMod._getWithActualApiCallCountForTests() === 1, 'executed in exactly ONE withActualApi cycle');
  }

  console.log('\n[get_context] Scenario 3: include_payees: false');
  {
    reset();
    const res = await tool.call({ include_payees: false });
    const r = res?.result;

    check(payeeReadCount === 0, 'rawGetPayees was NOT called');
    check(r?.payees?.length === 0, 'payees is empty array');
    check(r?.payees_truncated === false, 'payees_truncated is false');
    check(r?.payee_total === 0, 'payee_total is 0');
    check(r?.accounts?.length === 2, 'accounts still returned');
    check(r?.category_groups?.length === 2, 'category_groups still returned');
  }

  console.log('\n[get_context] Scenario 4: include_closed: true includes closed accounts');
  {
    reset();
    const res = await tool.call({ include_closed: true });
    const r = res?.result;

    check(r?.accounts?.length === 3, 'all 3 accounts returned when include_closed is true', `got ${r?.accounts?.length}`);
    check(r?.accounts?.some((a) => a.id === 'a3' && a.closed === true), 'closed account a3 included');
  }

  console.log('\n[get_context] Scenario 5: negative - payee_limit: 0 throws ZodError');
  {
    reset();
    let threw = null;
    try {
      await tool.call({ payee_limit: 0 });
    } catch (err) {
      threw = err;
    }

    check(threw !== null, 'throws error for payee_limit: 0');
    const msg = threw?.message || String(threw);
    check(/payee_limit/i.test(msg), 'error message names payee_limit', `got: ${msg}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed in get_context.test.js`);
    process.exit(1);
  } else {
    console.log('\n[get_context] All tests passed.');
  }
})();
