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
  ] = await Promise.all([
    import('../../dist/src/tools/rules_create.js').then(m => m.default),
    import('../../dist/src/tools/budget_updates_batch.js').then(m => m.default),
    import('../../dist/src/tools/budgets_transfer.js').then(m => m.default),
    import('../../dist/src/tools/budgets_setAmount.js').then(m => m.default),
    import('../../dist/src/tools/schedules_create.js').then(m => m.default),
    import('../../dist/src/tools/schedules_update.js').then(m => m.default),
    import('../../dist/src/tools/schedules_delete.js').then(m => m.default),
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

  // ─── summary ─────────────────────────────────────────────────────────────
  console.log('');
  if (failures > 0) {
    console.error(`${failures} schema validation test(s) FAILED`);
    process.exit(2);
  }
  console.log('All schema validation tests passed');
  process.exit(0);
})();
