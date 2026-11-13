// tests/unit/compact_manage_budget_months.test.js
//
// #678: the compact manage_budget_months tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_budget_months.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[compact-manage-budget-months]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { titleFor } = await import('../../dist/src/lib/tool-titles.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_budget_months');
assert.ok(spec, 'manage_budget_months is registered');

const seen = [];
let reply = (n) => ({ from: n });
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return reply(n); } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const run = async (input) => { seen.length = 0; return tool.call(input); };
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  const text = [e.message, ...(e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`)].join(' | ');
  assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};
const expectCall = async (input, n, a) => {
  await run(input);
  assert.deepStrictEqual(seen, [{ n, a }], JSON.stringify(input));
};
const C1 = '123e4567-e89b-42d3-a456-426614174000';
const C2 = '223e4567-e89b-42d3-a456-426614174001';
const M = '2026-11';
const ACTIONS = ['set_amount', 'set_amount_batch', 'set_carryover', 'hold', 'reset_hold', 'transfer', 'set_note'];
const READ_ONLY_CASES = [
  ['actual_budgets_set_amount', { action: 'set_amount', month: M, category_id: C1, amount: 100 }],
  ['actual_budget_updates_batch', { action: 'set_amount_batch', operations: [{ month: M, categoryId: C1, amount: 1 }] }],
  ['actual_budgets_set_carryover', { action: 'set_carryover', month: M, category_id: C1, flag: true }],
  ['actual_budgets_hold_for_next_month', { action: 'hold', month: M, amount: 100 }],
  ['actual_budgets_reset_hold', { action: 'reset_hold', month: M }],
  ['actual_budgets_transfer', { action: 'transfer', month: M, from_category_id: C1, to_category_id: C2, amount: 100 }],
  ['actual_notes_update', { action: 'set_note', month: M, note: 'x' }],
];

// ---- one positive per action, exact forwarded arguments ----

await check('set_amount renames category_id', () =>
  expectCall({ action: 'set_amount', month: M, category_id: C1, amount: 5000 }, 'actual_budgets_set_amount', { month: M, categoryId: C1, amount: 5000 }));
await check('set_amount accepts 0 and a negative amount', async () => {
  await expectCall({ action: 'set_amount', month: M, category_id: C1, amount: 0 }, 'actual_budgets_set_amount', { month: M, categoryId: C1, amount: 0 });
  await expectCall({ action: 'set_amount', month: M, category_id: C1, amount: -5 }, 'actual_budgets_set_amount', { month: M, categoryId: C1, amount: -5 });
});
await check('set_amount_batch forwards the operations unchanged', () => {
  const operations = [{ month: M, categoryId: C1, amount: 100 }, { month: M, categoryId: C2, carryover: true }];
  return expectCall({ action: 'set_amount_batch', operations }, 'actual_budget_updates_batch', { operations });
});
await check('set_carryover renames category_id and keeps false', () =>
  expectCall({ action: 'set_carryover', month: M, category_id: C1, flag: false }, 'actual_budgets_set_carryover', { month: M, categoryId: C1, flag: false }));
await check('hold forwards month and amount', () =>
  expectCall({ action: 'hold', month: M, amount: 2500 }, 'actual_budgets_hold_for_next_month', { month: M, amount: 2500 }));
await check('reset_hold forwards the month', () =>
  expectCall({ action: 'reset_hold', month: M }, 'actual_budgets_reset_hold', { month: M }));
await check('transfer renames both category ids', () =>
  expectCall({ action: 'transfer', month: M, from_category_id: C1, to_category_id: C2, amount: 300 }, 'actual_budgets_transfer', { month: M, fromCategoryId: C1, toCategoryId: C2, amount: 300 }));
await check('set_note builds the budget-<month> id', () =>
  expectCall({ action: 'set_note', month: '2026-11', note: '#template 250' }, 'actual_notes_update', { id: 'budget-2026-11', note: '#template 250' }));
await check('set_note "" clears (forwarded as an empty string)', () =>
  expectCall({ action: 'set_note', month: M, note: '' }, 'actual_notes_update', { id: 'budget-2026-11', note: '' }));
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ success: true });
  assert.deepStrictEqual(await run({ action: 'reset_hold', month: M }), { success: true });
  reply = (n) => ({ from: n });
});
await check('a legacy name in an error is rewritten to the compact action', async () => {
  reply = () => { throw new Error('Nothing to hold. Use actual_budgets_get_month to see to-budget.'); };
  let e;
  try { await tool.call({ action: 'hold', month: M, amount: 1 }); } catch (x) { e = x; }
  reply = (n) => ({ from: n });
  assert.ok(e, 'expected an error');
  assert.ok(!/actual_budgets_get_month/.test(e.message), e.message);
  assert.ok(/list_budget_months/.test(e.message), e.message);
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the values', () => refused({ action: 'frobnicate' }, /action.*set_amount.*set_note/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: missing required keys name the key and the action', async () => {
  await refused({ action: 'set_amount', month: M, category_id: C1 }, /amount.*required for action: set_amount/);
  await refused({ action: 'set_amount', category_id: C1, amount: 1 }, /month.*required for action: set_amount/);
  await refused({ action: 'set_carryover', month: M, category_id: C1 }, /flag.*required for action: set_carryover/);
  await refused({ action: 'hold', month: M }, /amount.*required for action: hold/);
  await refused({ action: 'reset_hold' }, /month.*required for action: reset_hold/);
  await refused({ action: 'transfer', month: M, from_category_id: C1, amount: 1 }, /to_category_id.*required for action: transfer/);
  await refused({ action: 'set_note', month: M }, /note.*required for action: set_note/);
  await refused({ action: 'set_amount_batch' }, /operations.*required for action: set_amount_batch/);
});
await check('NEGATIVE: a key of another action is refused', async () => {
  await refused({ action: 'reset_hold', month: M, amount: 5 }, /amount.*not valid for action: reset_hold/);
  await refused({ action: 'hold', month: M, amount: 5, category_id: C1 }, /category_id.*not valid for action: hold/);
  await refused({ action: 'set_note', month: M, note: 'x', flag: true }, /flag.*not valid for action: set_note/);
});
await check('NEGATIVE: a decimal amount is refused', async () => {
  await refused({ action: 'set_amount', month: M, category_id: C1, amount: 10.5 }, /amount/);
  await refused({ action: 'transfer', month: M, from_category_id: C1, to_category_id: C2, amount: 1.5 }, /amount/);
});
await check('NEGATIVE: hold and transfer amount must be greater than 0', async () => {
  await refused({ action: 'hold', month: M, amount: 0 }, /amount must be greater than 0/);
  await refused({ action: 'hold', month: M, amount: -5 }, /amount must be greater than 0/);
  await refused({ action: 'transfer', month: M, from_category_id: C1, to_category_id: C2, amount: 0 }, /amount must be greater than 0/);
});
await check('NEGATIVE: a bad month is refused for every month action, set_note month 2026-13 included', async () => {
  await refused({ action: 'set_note', month: '2026-13', note: 'x' }, /month must be in YYYY-MM format/);
  await refused({ action: 'set_amount', month: '2026-00', category_id: C1, amount: 1 }, /month must be in YYYY-MM format/);
  await refused({ action: 'hold', month: '11/2026', amount: 1 }, /month must be in YYYY-MM format/);
  await refused({ action: 'reset_hold', month: '2026-1' }, /month must be in YYYY-MM format/);
});
await check('NEGATIVE: a malformed category id is refused', async () => {
  await refused({ action: 'set_amount', month: M, category_id: 'nope', amount: 1 }, /category_id/);
  await refused({ action: 'transfer', month: M, from_category_id: 'nope', to_category_id: C2, amount: 1 }, /from_category_id/);
});
await check('NEGATIVE: transfer to the same category is refused', () =>
  refused({ action: 'transfer', month: M, from_category_id: C1, to_category_id: C1, amount: 1 }, /to_category_id.*must differ from from_category_id/));
await check('NEGATIVE: batch item rules (empty, over 100, no amount or carryover, bad month, extra key)', async () => {
  await refused({ action: 'set_amount_batch', operations: [] }, /operations/);
  await refused({ action: 'set_amount_batch', operations: Array.from({ length: 101 }, () => ({ month: M, categoryId: C1, amount: 1 })) }, /operations/);
  await refused({ action: 'set_amount_batch', operations: [{ month: M, categoryId: C1 }] }, /at least one of amount or carryover/);
  await refused({ action: 'set_amount_batch', operations: [{ month: '2026-13', categoryId: C1, amount: 1 }] }, /month must be in YYYY-MM format/);
  await refused({ action: 'set_amount_batch', operations: [{ month: M, categoryId: C1, amount: 1.5 }] }, /operations/);
  await refused({ action: 'set_amount_batch', operations: [{ month: M, categoryId: C1, amount: 1, bogus: 1 }] }, /operations/);
});
await check('NEGATIVE: snake_case or unknown keys are refused', async () => {
  await refused({ action: 'set_amount', month: M, categoryId: C1, amount: 1 }, /categoryId/);
  await refused({ action: 'set_note', month: M, note: 'x', id: 'budget-2026-11' }, /unrecognized_keys[\s\S]*"id"/);
});
await check('NEGATIVE: the build hook is not reached on a refusal (set_note month 2026-13 calls nothing)', () =>
  refused({ action: 'set_note', month: '2026-13', note: 'x' }, /YYYY-MM/));


await check('published schema: flat, action required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js)), 'no oneOf or anyOf at any depth');
  assert.deepStrictEqual(js.required, ['action']);
  assert.deepStrictEqual(js.properties.action.enum, ACTIONS);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
  assert.strictEqual(js.properties.amount.type, 'integer');
  assert.strictEqual(js.properties.operations.type, 'array');
  assert.ok(js.properties.operations.items.properties.categoryId, 'batch items are typed');
  assert.ok(!js.properties.operations.items.additionalProperties || js.properties.operations.items.additionalProperties === false);
});
await check('description: purpose, Returns, every action named, no legacy name', () => {
  assert.ok(spec.description.length > 100);
  assert.ok(spec.description.includes('Returns'));
  for (const a of ACTIONS) assert.ok(spec.description.includes(a + ':'), a);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations and title', () => {
  assert.deepStrictEqual(annotationsFor('manage_budget_months'), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  assert.strictEqual(titleFor('manage_budget_months'), 'Manage budget months');
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_budget_updates_batch', 'actual_budgets_hold_for_next_month', 'actual_budgets_reset_hold', 'actual_budgets_set_amount', 'actual_budgets_set_carryover', 'actual_budgets_transfer', 'actual_notes_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});
await check('read-only: every action is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_budget_months'));
  for (const [legacyName, input] of READ_ONLY_CASES) {
    const legacy = manager.getTool(legacyName);
    const original = legacy.call;
    let ran = 0;
    legacy.call = async () => { ran++; return { success: true }; };
    try {
      let e;
      try { await manager.callTool('manage_budget_months', input); } catch (x) { e = x; }
      assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', `${input.action}: ${e}`);
      assert.strictEqual(ran, 0, input.action);
    } finally { legacy.call = original; }
  }
});

console.log(`\n[compact-manage-budget-months] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
