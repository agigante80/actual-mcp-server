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
  ] = await Promise.all([
    import('../../dist/src/tools/rules_create.js').then(m => m.default),
    import('../../dist/src/tools/budget_updates_batch.js').then(m => m.default),
    import('../../dist/src/tools/budgets_transfer.js').then(m => m.default),
    import('../../dist/src/tools/budgets_setAmount.js').then(m => m.default),
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

  // ─── summary ─────────────────────────────────────────────────────────────
  console.log('');
  if (failures > 0) {
    console.error(`${failures} schema validation test(s) FAILED`);
    process.exit(2);
  }
  console.log('All schema validation tests passed');
  process.exit(0);
})();
