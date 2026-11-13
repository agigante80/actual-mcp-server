// tests/unit/compact_list_budget_months.test.js
//
// #674: the compact list_budget_months tool. It has no selector: the presence of `month`
// picks the legacy tool. A stubbed callOperation records the exact legacy tool and arguments,
// and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_list_budget_months.test.js   (needs `npm run build` first)

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
console.log('\n[compact-list-budget-months]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'list_budget_months');
assert.ok(spec, 'list_budget_months is registered');

const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return { from: n }; } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const run = async (input) => { seen.length = 0; return tool.call(input); };
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  const text = [e.message, ...(e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`)].join(' | ');
  if (re) assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};

// ---- routing ----

await check('month present calls actual_budgets_get_month with exactly { month }, result unchanged', async () => {
  const r = await run({ month: '2026-11' });
  assert.deepStrictEqual(seen, [{ n: 'actual_budgets_get_month', a: { month: '2026-11' } }]);
  assert.deepStrictEqual(r, { from: 'actual_budgets_get_month' });
});
await check('month absent calls actual_budgets_get_months once with {} and never get_month', async () => {
  const r = await run({});
  assert.deepStrictEqual(seen, [{ n: 'actual_budgets_get_months', a: {} }]);
  assert.deepStrictEqual(r, { from: 'actual_budgets_get_months' });
});
await check('no arguments at all behaves like {}', async () => {
  await run(undefined);
  assert.deepStrictEqual(seen, [{ n: 'actual_budgets_get_months', a: {} }]);
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: an unknown property is refused naming it', () => refused({ action: 'x' }, /action/));
await check('NEGATIVE: an unknown property beside a valid month is refused', () => refused({ month: '2026-11', year: 2026 }, /year/));
await check('NEGATIVE: month "2026-1" is refused naming month', () => refused({ month: '2026-1' }, /month/));
await check('NEGATIVE: month "November" is refused naming month', () => refused({ month: 'November' }, /month/));
await check('NEGATIVE: month null is refused naming month', () => refused({ month: null }, /month/));
await check('NEGATIVE: month as a number is refused naming month', () => refused({ month: 202611 }, /month/));
await check('NEGATIVE: the strict flat schema refuses what the dispatcher refuses (no legacy call)', () => {
  seen.length = 0;
  assert.strictEqual(tool.inputSchema.safeParse({ month: '2026-1' }).success, false);
  assert.strictEqual(tool.inputSchema.safeParse({ action: 'x' }).success, false);
  assert.strictEqual(tool.inputSchema.safeParse({ month: '2026-11' }).success, true);
  assert.strictEqual(tool.inputSchema.safeParse({}).success, true);
});

// ---- published shape and metadata ----

await check('published schema: flat, strict, month the only property, nothing required, no selector', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js)));
  assert.deepStrictEqual(Object.keys(js.properties), ['month']);
  assert.ok(!js.required || js.required.length === 0);
  assert.strictEqual(js.additionalProperties, false);
  assert.strictEqual(js.properties.month.type, 'string');
  assert.ok(js.properties.month.description);
  assert.strictEqual(tool.outputSchema, undefined);
});
await check('description: read-only, Returns, month, siblings, no legacy name', () => {
  for (const w of ['Read-only', 'Returns', 'month', 'YYYY-MM', 'manage_budget_months', 'summarize_transactions', 'list_entities', 'search_transactions']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: read-only, closed world, no target is write-capable', () => {
  const a = annotationsFor('list_budget_months');
  assert.strictEqual(a.readOnlyHint, true);
  assert.strictEqual(a.destructiveHint, false);
  assert.strictEqual(a.openWorldHint, false);
  assert.deepStrictEqual(compactLegacyNames(spec).sort(), ['actual_budgets_get_month', 'actual_budgets_get_months']);
  for (const n of compactLegacyNames(spec)) assert.ok(!WRITE_CAPABLE.has(n), n);
});

// ---- 4b ----

await check('4b: legacy names in an error are rewritten to this tool', async () => {
  const boom = new Error('failed in actual_budgets_get_month, try actual_budgets_get_months');
  const t = buildCompactTool(spec, { callOperation: async () => { throw boom; } }, phrases);
  const e = await t.call({ month: '2026-11' }).catch((x) => x);
  assert.strictEqual(e, boom);
  assert.ok(!/actual_/.test(e.message), e.message);
  assert.ok(/list_budget_months with month/.test(e.message) && /try list_budget_months(?! with)/.test(e.message), e.message);
});

console.log(`\n[compact-list-budget-months] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
