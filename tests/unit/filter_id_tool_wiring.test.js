// #388: the resolver is only worth anything if the tools actually CALL it.
//
// This is the half that is easy to skip and the half most likely to rot. `filter_id_resolution`
// proves `adapter.resolveFilterId` behaves; nothing there would notice if a tool stopped calling
// it, or if a new Category B field were added and nobody wired it up. The Category B exception
// entries in `tool_id_schema_drift` now say "resolved by adapter.resolveFilterId", so that claim
// needs something enforcing it or it becomes another entry whose stated reason is not true.
//
// Review found the twelfth field this way: `transactions_uncategorized` held the STRICT schema, so
// it answered a name with "Invalid uuid" while the other eleven resolved it. Nothing here would
// have caught that, because the field was never in the list. The lesson is that this file is only
// as complete as CASES below, so add a row whenever a filter id is added anywhere.
//
// It asserts BEHAVIOUR, not source text. A grep for the call site would pass on a call whose
// result is discarded, or one placed after the read it was supposed to precede. Invoking the tool
// with a NAME and requiring a typed refusal cannot pass in either case.
//
// Run: node tests/unit/filter_id_tool_wiring.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit388w';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#388-wiring] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const CAT = 'bbbbbbbb-0000-4000-8000-000000000002';
const PAY = 'cccccccc-0000-4000-8000-000000000003';

const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2026-01'];
api.getAccounts = async () => [{ id: ACC, name: 'Checking', offbudget: false, closed: false }];
api.getCategories = async () => [{ id: CAT, name: 'Food' }];
api.getPayees = async () => [{ id: PAY, name: 'Amazon' }];
api.getTransactions = async () => [];
api.runBankSync = async () => {};
api.runQuery = async () => ({ data: [] });

const apiState = await import('../../dist/src/lib/apiState.js');
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const load = async (name) => (await import(`../../dist/src/tools/${name}.js`)).default;

// Every Category B field, the tool that owns it, and the NAME a caller would plausibly pass.
// Adding a Category B field without adding a row here leaves the new field unguarded, which is
// the drift this file exists to catch.
const CASES = [
  ['transactions_filter', { accountId: 'Checking' }, ACC],
  ['transactions_filter', { categoryId: 'Food' }, CAT],
  ['transactions_filter', { payeeId: 'Amazon' }, PAY],
  ['transactions_get', { accountId: 'Checking' }, ACC],
  ['transactions_search_by_amount', { accountId: 'Checking', minAmount: -100000 }, ACC],
  ['transactions_search_by_category', { accountId: 'Checking', categoryName: 'Food' }, ACC],
  ['transactions_search_by_month', { accountId: 'Checking', month: '2026-01' }, ACC],
  ['transactions_search_by_payee', { accountId: 'Checking', payeeName: 'Amazon' }, ACC],
  ['transactions_summary_by_category', { accountId: 'Checking' }, ACC],
  ['transactions_summary_by_payee', { accountId: 'Checking' }, ACC],
  ['transactions_uncategorized', { accountId: 'Checking' }, ACC],
  ['bank_sync', { accountId: 'Checking' }, ACC],
];

describe('every Category B field refuses a NAME and names the id it resolves to');
for (const [toolName, args, expectedId] of CASES) {
  const tool = await load(toolName);
  const field = Object.keys(args)[0];
  let outcome;
  try {
    const result = await tool.call(args);
    // A tool that RESOLVED instead of refusing, or that returned the old empty-result-with-an-
    // error envelope, both land here. Both are the defect.
    outcome = `returned ${JSON.stringify(result).slice(0, 70)}`;
  } catch (e) {
    outcome = isPreflightRefusal(e) && String(e.message).includes(expectedId)
      ? 'REFUSED'
      : `threw the wrong thing: ${String(e.message).slice(0, 70)}`;
  }
  check(outcome === 'REFUSED', `${toolName}.${field}: a name is refused with its id (${outcome})`);
}

describe('and a well-formed id is still accepted, so the guard is not simply refusing everything');
{
  // The negative control. Without it, a resolver that threw unconditionally would make every
  // assertion above pass while breaking every one of these tools.
  const tool = await load('transactions_get');
  let ok = false;
  try { await tool.call({ accountId: ACC }); ok = true; } catch { ok = false; }
  check(ok, 'transactions_get accepts a real account id');

  const summary = await load('transactions_summary_by_payee');
  let ok2 = false;
  try { await summary.call({ accountId: ACC }); ok2 = true; } catch { ok2 = false; }
  check(ok2, 'transactions_summary_by_payee accepts a real account id');
}

log(`\n[#388-wiring] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
