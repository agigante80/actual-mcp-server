/**
 * Negative-path schema validation tests for the 5 tools with the most
 * complex Zod schemas / runtime guards. Each test asserts that invalid
 * inputs are rejected (Zod parse error OR runtime Error), and that valid
 * minimal inputs are accepted.
 *
 * Run via: npm run test:unit-js   (included in the chain)
 */

// Stub required env vars so the adapter module can be imported without a .env
process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

console.log('Running schema validation (negative-path) tests');

// ─── helpers ───────────────────────────────────────────────────────────────

function expectParseError(tool, input, label) {
  try {
    tool.inputSchema.parse(input);
    console.error(`  FAIL (expected Zod error) [${label}]`);
    return false;
  } catch (_e) {
    console.log(`  ✓ correctly rejected [${label}]`);
    return true;
  }
}

function expectParseOk(tool, input, label) {
  try {
    tool.inputSchema.parse(input);
    console.log(`  ✓ correctly accepted [${label}]`);
    return true;
  } catch (e) {
    console.error(`  FAIL (unexpected Zod error) [${label}]: ${e.message}`);
    return false;
  }
}

async function expectCallError(tool, input, label) {
  try {
    await tool.call(input);
    console.error(`  FAIL (expected runtime error) [${label}]`);
    return false;
  } catch (_e) {
    console.log(`  ✓ correctly rejected at runtime [${label}]`);
    return true;
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

(async () => {
  // Import tools from compiled dist (requires `npm run build` first)
  const [
    rules_create,
    batch,
    transfer,
    setAmount,
    schedules_create_tool,
    schedules_update_tool,
    schedules_delete_tool,
    budgets_switch_tool,
    payees_update_tool,
    // Tasks A2, A3, B3(skipped), C2, CG2, P2, P3, Q1, R2, T1
    accounts_create_tool,
    accounts_get_balance_tool,
    categories_create_tool,
    category_groups_create_tool,
    payees_create_tool,
    payees_merge_tool,
    get_id_by_name_tool,
    rules_update_tool,
    transactions_create_tool,
  ] = await Promise.all([
    import('../../dist/src/tools/rules_create.js').then(m => m.default),
    import('../../dist/src/tools/budget_updates_batch.js').then(m => m.default),
    import('../../dist/src/tools/budgets_transfer.js').then(m => m.default),
    import('../../dist/src/tools/budgets_setAmount.js').then(m => m.default),
    import('../../dist/src/tools/schedules_create.js').then(m => m.default),
    import('../../dist/src/tools/schedules_update.js').then(m => m.default),
    import('../../dist/src/tools/schedules_delete.js').then(m => m.default),
    import('../../dist/src/tools/budgets_switch.js').then(m => m.default),
    import('../../dist/src/tools/payees_update.js').then(m => m.default),
    // New additions
    import('../../dist/src/tools/accounts_create.js').then(m => m.default),
    import('../../dist/src/tools/accounts_get_balance.js').then(m => m.default),
    import('../../dist/src/tools/categories_create.js').then(m => m.default),
    import('../../dist/src/tools/category_groups_create.js').then(m => m.default),
    import('../../dist/src/tools/payees_create.js').then(m => m.default),
    import('../../dist/src/tools/payees_merge.js').then(m => m.default),
    import('../../dist/src/tools/get_id_by_name.js').then(m => m.default),
    import('../../dist/src/tools/rules_update.js').then(m => m.default),
    import('../../dist/src/tools/transactions_create.js').then(m => m.default),
  ]);

  let failures = 0;
  const fail = () => failures++;

  // ── actual_rules_create ─────────────────────────────────────────────────
  console.log('\n[actual_rules_create]');

  if (!expectParseError(rules_create, {}, 'empty input — missing conditions & actions')) fail();
  if (!expectParseError(rules_create, { conditions: 'not-array', actions: [] },
    'conditions must be an array')) fail();
  if (!expectParseError(rules_create, { conditions: [], actions: 'not-array' },
    'actions must be an array')) fail();
  if (!expectParseError(rules_create, { conditions: [{ field: 'notes', op: 'contains' }], actions: [] },
    'condition missing required value')) fail();
  // Valid minimal input
  if (!expectParseOk(rules_create, {
    conditions: [{ field: 'notes', op: 'contains', value: 'test' }],
    actions:    [{ op: 'set', field: 'category', value: '00000000-0000-0000-0000-000000000001' }],
  }, 'valid minimal rule')) fail();

  // ── actual_budget_updates_batch ─────────────────────────────────────────
  console.log('\n[actual_budget_updates_batch]');

  if (!expectParseError(batch, {}, 'empty input — missing operations')) fail();
  if (!expectParseError(batch, { operations: 'not-array' }, 'operations must be an array')) fail();
  if (!expectParseError(batch, { operations: [{ categoryId: 'cat_1', amount: 100 }] },
    'operation missing required month')) fail();
  if (!expectParseError(batch, { operations: [{ month: '2025-13', categoryId: 'cat_1' }] },
    'invalid month format (month 13)')) fail();
  if (!expectParseError(batch, { operations: [{ month: '25-01', categoryId: 'cat_1' }] },
    'invalid month format (2-digit year)')) fail();
  // Valid minimal input
  if (!expectParseOk(batch, {
    operations: [{ month: '2026-03', categoryId: 'cat_1', amount: 10000 }],
  }, 'valid batch operation')) fail();

  // ── actual_budgets_transfer ─────────────────────────────────────────────
  console.log('\n[actual_budgets_transfer]');

  if (!expectParseError(transfer, {}, 'empty input — all fields required')) fail();
  if (!expectParseError(transfer,
    { month: '2026-03', fromCategoryId: 'cat_1', toCategoryId: 'cat_2' },
    'missing amount')) fail();
  if (!expectParseError(transfer,
    { month: '2026-03', fromCategoryId: 'cat_1', toCategoryId: 'cat_2', amount: 'fifty' },
    'amount must be number')) fail();
  // Runtime guard: amount must be positive
  if (!await expectCallError(transfer,
    { month: '2026-03', fromCategoryId: 'cat_1', toCategoryId: 'cat_2', amount: 0 },
    'amount=0 must be rejected at runtime')) fail();
  if (!await expectCallError(transfer,
    { month: '2026-03', fromCategoryId: 'cat_1', toCategoryId: 'cat_2', amount: -100 },
    'negative amount must be rejected at runtime')) fail();
  // Runtime guard: fromCategoryId !== toCategoryId
  if (!await expectCallError(transfer,
    { month: '2026-03', fromCategoryId: 'same_id', toCategoryId: 'same_id', amount: 100 },
    'same from/to category must be rejected at runtime')) fail();

  // ── actual_budgets_setAmount ────────────────────────────────────────────
  console.log('\n[actual_budgets_setAmount]');

  if (!expectParseError(setAmount, {}, 'empty input — all fields required')) fail();
  if (!expectParseError(setAmount,
    { month: '', categoryId: 'cat_1', amount: 100 },
    'empty month string rejected (min length 1)')) fail();
  if (!expectParseError(setAmount,
    { month: '2026-03', categoryId: '', amount: 100 },
    'empty categoryId rejected (min length 1)')) fail();
  if (!expectParseError(setAmount,
    { month: '2026-03', categoryId: 'cat_1', amount: 'not-a-number' },
    'string amount rejected (must be number)')) fail();
  // Valid minimal input
  if (!expectParseOk(setAmount,
    { month: '2026-03', categoryId: 'cat_1', amount: 50000 },
    'valid setAmount')) fail();

  // ── actual_schedules_create ─────────────────────────────────────────────
  console.log('\n[actual_schedules_create]');

  if (!expectParseError(schedules_create_tool, {}, 'empty input — date is required')) fail();
  if (!expectParseError(schedules_create_tool,
    { date: '2026-1-1' },
    'invalid date format (single-digit month/day)')) fail();
  if (!expectParseError(schedules_create_tool,
    { date: { frequency: 'hourly', start: '2026-01-01', endMode: 'never' } },
    'invalid RecurConfig frequency (hourly not in enum)')) fail();
  if (!expectParseError(schedules_create_tool,
    { date: { frequency: 'monthly', start: '2026-01-01', endMode: 'every_time' } },
    'invalid RecurConfig endMode (every_time not in enum)')) fail();
  if (!expectParseError(schedules_create_tool,
    { date: { start: '2026-01-01', endMode: 'never' } },
    'RecurConfig missing required frequency')) fail();
  if (!expectParseError(schedules_create_tool,
    { date: '2026-04-01', amountOp: 'invalid' },
    'invalid amountOp value')) fail();
  // Valid one-off
  if (!expectParseOk(schedules_create_tool,
    { date: '2026-04-01' },
    'valid one-off schedule (date string only)')) fail();
  // Valid recurring
  if (!expectParseOk(schedules_create_tool,
    { date: { frequency: 'monthly', start: '2026-01-01', endMode: 'never' } },
    'valid recurring schedule (monthly, never ends)')) fail();
  // Valid recurring with endDate
  if (!expectParseOk(schedules_create_tool,
    { date: { frequency: 'weekly', start: '2026-01-01', endMode: 'on_date', endDate: '2026-12-31' }, amount: -5000, amountOp: 'is' },
    'valid recurring with endDate')) fail();

  // ── actual_schedules_update ─────────────────────────────────────────────
  console.log('\n[actual_schedules_update]');

  if (!expectParseError(schedules_update_tool, {}, 'empty input — id is required')) fail();
  if (!expectParseError(schedules_update_tool,
    { id: 'not-a-uuid' },
    'invalid UUID for id')) fail();
  if (!expectParseError(schedules_update_tool,
    { id: '00000000-0000-0000-0000-000000000001', amountOp: 'wrong' },
    'invalid amountOp on update')) fail();
  // Valid — id only (no other fields required on update)
  if (!expectParseOk(schedules_update_tool,
    { id: '00000000-0000-0000-0000-000000000001' },
    'valid update with id only')) fail();
  if (!expectParseOk(schedules_update_tool,
    { id: '00000000-0000-0000-0000-000000000001', name: 'Rent', resetNextDate: true },
    'valid update with name + resetNextDate')) fail();

  // ── actual_schedules_delete ─────────────────────────────────────────────
  console.log('\n[actual_schedules_delete]');

  if (!expectParseError(schedules_delete_tool, {}, 'empty input — id is required')) fail();
  if (!expectParseError(schedules_delete_tool,
    { id: 'not-a-uuid' },
    'invalid UUID for id')) fail();
  if (!expectParseOk(schedules_delete_tool,
    { id: '00000000-0000-0000-0000-000000000001' },
    'valid delete with correct UUID')) fail();

  // ── actual_budgets_switch ───────────────────────────────────────────────
  console.log('\n[actual_budgets_switch]');

  if (!expectParseError(budgets_switch_tool, {}, 'empty input — budgetName is required')) fail();
  if (!expectParseError(budgets_switch_tool,
    { budgetName: '' },
    'empty string rejected for budgetName')) fail();
  // Non-empty strings are now valid (name-based, not UUID-based)
  if (!expectParseOk(budgets_switch_tool,
    { budgetName: 'Shared Family Account' },
    'plain name string accepted')) fail();
  if (!expectParseOk(budgets_switch_tool,
    { budgetName: 'office' },
    'lowercase partial name accepted')) fail();

  // ── actual_payees_update — category field (regression: must not be rejected by schema) ──
  console.log('\n[actual_payees_update — category field]');

  const VALID_PAYEE_ID = '00000000-0000-0000-0000-000000000001';
  const VALID_CAT_ID   = '00000000-0000-0000-0000-000000000002';

  if (!expectParseOk(payees_update_tool,
    { id: VALID_PAYEE_ID, fields: { category: VALID_CAT_ID } },
    'category UUID accepted')) fail();

  if (!expectParseOk(payees_update_tool,
    { id: VALID_PAYEE_ID, fields: { category: null } },
    'category null accepted (clearing default category)')) fail();

  if (!expectParseOk(payees_update_tool,
    { id: VALID_PAYEE_ID, fields: { name: 'Groceries', category: VALID_CAT_ID } },
    'name + category accepted together')) fail();

  if (!expectParseError(payees_update_tool,
    { id: VALID_PAYEE_ID, fields: { unknownField: 'bad' } },
    'unknown field rejected by strict schema')) fail();

  if (!expectParseError(payees_update_tool,
    { id: VALID_PAYEE_ID, fields: { category: 'not-a-uuid' } },
    'non-UUID category rejected')) fail();

  // ── actual_accounts_create (A2) ───────────────────────────────────────────
  console.log('\n[actual_accounts_create — required name, optional balance must be integer]');
  if (!expectParseError(accounts_create_tool,
    {},
    'missing name rejected')) fail();
  if (!expectParseError(accounts_create_tool,
    { name: '' },
    'empty name rejected (min 1)')) fail();
  if (!expectParseError(accounts_create_tool,
    { name: 'Checking', balance: 50.5 },
    'non-integer balance rejected')) fail();
  if (!expectParseOk(accounts_create_tool,
    { name: 'Checking' },
    'valid name-only accepted')) fail();
  if (!expectParseOk(accounts_create_tool,
    { name: 'Savings', balance: 10000 },
    'valid name + integer balance accepted')) fail();

  // ── actual_accounts_get_balance (A3) ──────────────────────────────────────
  // Schema uses z.string().min(1) for id and .strict() — UUID not enforced
  console.log('\n[actual_accounts_get_balance — required non-empty id, strict schema]');
  if (!expectParseError(accounts_get_balance_tool,
    {},
    'missing id rejected')) fail();
  if (!expectParseError(accounts_get_balance_tool,
    { id: '' },
    'empty id rejected (min 1)')) fail();
  if (!expectParseError(accounts_get_balance_tool,
    { id: 'acc-1', unknownField: 'bad' },
    'unknown field rejected by strict schema')) fail();
  if (!expectParseOk(accounts_get_balance_tool,
    { id: 'any-non-empty-string' },
    'valid non-empty id accepted')) fail();

  // ── actual_categories_create (C2) ─────────────────────────────────────────
  console.log('\n[actual_categories_create — required name + UUID group_id]');
  const VALID_GROUP_ID = '00000000-0000-0000-0000-000000000001';
  if (!expectParseError(categories_create_tool,
    { group_id: VALID_GROUP_ID },
    'missing name rejected')) fail();
  if (!expectParseError(categories_create_tool,
    { name: 'Food' },
    'missing group_id rejected')) fail();
  if (!expectParseError(categories_create_tool,
    { name: 'Food', group_id: 'not-a-uuid' },
    'non-UUID group_id rejected')) fail();
  if (!expectParseOk(categories_create_tool,
    { name: 'Food', group_id: VALID_GROUP_ID },
    'valid name + UUID group_id accepted')) fail();

  // ── actual_category_groups_create (CG2) ───────────────────────────────────
  console.log('\n[actual_category_groups_create — required non-empty name]');
  if (!expectParseError(category_groups_create_tool,
    {},
    'missing name rejected')) fail();
  if (!expectParseError(category_groups_create_tool,
    { name: '' },
    'empty name rejected (min 1)')) fail();
  if (!expectParseOk(category_groups_create_tool,
    { name: 'Expenses' },
    'valid name accepted')) fail();

  // ── actual_payees_create (P2) ─────────────────────────────────────────────
  console.log('\n[actual_payees_create — required non-empty name]');
  if (!expectParseError(payees_create_tool,
    {},
    'missing name rejected')) fail();
  if (!expectParseError(payees_create_tool,
    { name: '' },
    'empty name rejected (min 1)')) fail();
  if (!expectParseOk(payees_create_tool,
    { name: 'Amazon' },
    'valid name accepted')) fail();

  // ── actual_payees_merge (P3) ──────────────────────────────────────────────
  // Schema uses z.string() for targetId (no UUID enforcement) and z.array(z.string()) for mergeIds
  console.log('\n[actual_payees_merge — required targetId + mergeIds array]');
  if (!expectParseError(payees_merge_tool,
    {},
    'missing both fields rejected')) fail();
  if (!expectParseError(payees_merge_tool,
    { mergeIds: ['p2'] },
    'missing targetId rejected')) fail();
  if (!expectParseError(payees_merge_tool,
    { targetId: 'p1' },
    'missing mergeIds rejected')) fail();
  if (!expectParseError(payees_merge_tool,
    { targetId: 'p1', mergeIds: 'not-an-array' },
    'string instead of array for mergeIds rejected')) fail();
  if (!expectParseOk(payees_merge_tool,
    { targetId: 'p1', mergeIds: ['p2', 'p3'] },
    'valid targetId + mergeIds array accepted')) fail();

  // ── actual_get_id_by_name (Q1) ────────────────────────────────────────────
  console.log('\n[actual_get_id_by_name — required type enum + non-empty name]');
  if (!expectParseError(get_id_by_name_tool,
    {},
    'missing both fields rejected')) fail();
  if (!expectParseError(get_id_by_name_tool,
    { type: 'invoices', name: 'Cash' },
    'invalid type enum rejected')) fail();
  if (!expectParseError(get_id_by_name_tool,
    { name: 'Cash' },
    'missing type rejected')) fail();
  if (!expectParseError(get_id_by_name_tool,
    { type: 'accounts' },
    'missing name rejected')) fail();
  if (!expectParseError(get_id_by_name_tool,
    { type: 'accounts', name: '' },
    'empty name rejected (min 1)')) fail();
  if (!expectParseOk(get_id_by_name_tool,
    { type: 'accounts', name: 'Cash' },
    'valid accounts + name accepted')) fail();
  if (!expectParseOk(get_id_by_name_tool,
    { type: 'payees', name: 'Amazon' },
    'valid payees + name accepted')) fail();

  // ── actual_rules_update (R2) ──────────────────────────────────────────────
  // Schema: id: z.string() (required, no UUID check), fields: z.object({...}) (required)
  console.log('\n[actual_rules_update — required id string + fields object]');
  if (!expectParseError(rules_update_tool,
    {},
    'missing both id and fields rejected')) fail();
  if (!expectParseError(rules_update_tool,
    { id: 'rule_1' },
    'missing fields rejected')) fail();
  if (!expectParseError(rules_update_tool,
    { fields: {} },
    'missing id rejected')) fail();
  if (!expectParseError(rules_update_tool,
    { id: 'rule_1', fields: { stage: 'invalid-stage' } },
    'invalid stage enum in fields rejected')) fail();
  if (!expectParseOk(rules_update_tool,
    { id: 'rule_1', fields: {} },
    'valid id + empty fields object accepted')) fail();
  if (!expectParseOk(rules_update_tool,
    { id: 'rule_1', fields: { stage: 'pre' } },
    'valid id + stage=pre accepted')) fail();

  // ── actual_transactions_create (T1) ───────────────────────────────────────
  console.log('\n[actual_transactions_create — required UUID account + YYYY-MM-DD date + integer amount]');
  const VALID_ACCT_ID = '00000000-0000-0000-0000-000000000001';
  if (!expectParseError(transactions_create_tool,
    {},
    'missing all required fields rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { date: '2026-01-01', amount: -1000 },
    'missing account rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { account: VALID_ACCT_ID, amount: -1000 },
    'missing date rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { account: VALID_ACCT_ID, date: '2026-01-01' },
    'missing amount rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { account: VALID_ACCT_ID, date: '2026/01/01', amount: -1000 },
    'wrong date format (slash-separated) rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { account: 'not-a-uuid', date: '2026-01-01', amount: -1000 },
    'non-UUID account rejected')) fail();
  if (!expectParseError(transactions_create_tool,
    { account: VALID_ACCT_ID, date: '2026-01-01', amount: 50.5 },
    'non-integer (decimal) amount rejected')) fail();
  if (!expectParseOk(transactions_create_tool,
    { account: VALID_ACCT_ID, date: '2026-01-01', amount: -1000 },
    'valid expense transaction accepted')) fail();
  if (!expectParseOk(transactions_create_tool,
    { account: VALID_ACCT_ID, date: '2026-01-01', amount: 5000 },
    'valid income transaction accepted')) fail();

  // ─── summary ─────────────────────────────────────────────────────────────
  console.log('');
  if (failures > 0) {
    console.error(`${failures} schema validation test(s) FAILED`);
    process.exit(2);
  }
  console.log('All schema validation tests passed');
  process.exit(0);
})();
