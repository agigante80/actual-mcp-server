// tests/unit/tool_aliases.test.js
//
// #652: the six camelCase budget tools were renamed to snake_case. Their old names stay
// callable as deprecated aliases until the first minor release after 2027-02-01. The alias
// resolves at the top of callToolChecked, so the result is the new tool's result, the first
// use per process warns once, a typo stays "Tool not found", and an alias is never listed.
//
// Run: node tests/unit/tool_aliases.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[#652] deprecated tool aliases');

const { DEPRECATED_TOOL_ALIASES, resolveToolAlias } = await import('../../dist/src/lib/tool-aliases.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const logger = (await import('../../dist/src/logger.js')).default;

await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
const published = manager.getPublishedToolNames();

async function withStubs(stubs, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(stubs)) { originals[k] = adapter[k]; adapter[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(originals)) adapter[k] = v; }
}
async function captureWarns(fn) {
  const records = [];
  const o = logger.warn;
  logger.warn = (msg, meta) => { records.push({ msg: String(msg), meta }); };
  try { await fn(); } finally { logger.warn = o; }
  return records.filter((r) => r.meta?.alias);
}

const EXPECTED = {
  actual_budgets_getMonth: 'actual_budgets_get_month',
  actual_budgets_getMonths: 'actual_budgets_get_months',
  actual_budgets_setAmount: 'actual_budgets_set_amount',
  actual_budgets_setCarryover: 'actual_budgets_set_carryover',
  actual_budgets_holdForNextMonth: 'actual_budgets_hold_for_next_month',
  actual_budgets_resetHold: 'actual_budgets_reset_hold',
};

await check('the alias map is exactly the six renamed tools', () => {
  assert.deepStrictEqual(Object.fromEntries(DEPRECATED_TOOL_ALIASES), EXPECTED);
});

await check('every alias target is registered and published under the default config', () => {
  const missing = [...DEPRECATED_TOOL_ALIASES.values()].filter((t) => !manager.getTool(t) || !published.includes(t));
  assert.deepStrictEqual(missing, []);
});

await check('no alias is registered or listed (aliases never appear in tools/list)', () => {
  const leaked = [...DEPRECATED_TOOL_ALIASES.keys()].filter((a) => manager.getTool(a) || published.includes(a) || manager.getToolNames().includes(a));
  assert.deepStrictEqual(leaked, []);
});

const MONTHS = ['2026-01', '2026-02'];
await check('an old name returns the same result as the new name', async () => {
  await withStubs({ getBudgetMonths: async () => MONTHS }, async () => {
    const viaNew = await manager.callTool('actual_budgets_get_months', {});
    const viaOld = await manager.callTool('actual_budgets_getMonths', {});
    assert.deepStrictEqual(viaOld, viaNew);
  });
});

await check('the first use of an alias warns once with tool, alias and removal date; the new name never warns', async () => {
  const warns = await captureWarns(() => withStubs({ getBudgetMonth: async () => ({ month: '2026-01' }) }, async () => {
    await manager.callTool('actual_budgets_get_month', { month: '2026-01' });
    await manager.callTool('actual_budgets_getMonth', { month: '2026-01' });
    await manager.callTool('actual_budgets_getMonth', { month: '2026-01' });
  }));
  assert.strictEqual(warns.length, 1, JSON.stringify(warns));
  assert.deepStrictEqual(warns[0].meta, { module: 'TOOL_ALIAS', tool: 'actual_budgets_get_month', alias: 'actual_budgets_getMonth', removal: '2027-02-01' });
});

await check('NEGATIVE: a typo of an old name is "Tool not found", not resolved', async () => {
  await assert.rejects(() => manager.callTool('actual_budgets_getMonthz', {}), /^Error: Tool not found: actual_budgets_getMonthz$|Tool not found: actual_budgets_getMonthz$/);
});

await check('NEGATIVE: an inherited property name is not an alias', async () => {
  assert.strictEqual(resolveToolAlias('constructor'), 'constructor');
  await assert.rejects(() => manager.callTool('constructor', {}), (e) => e.message === 'Tool not found: constructor');
});

await check('NEGATIVE: getTool does not resolve aliases', () => {
  assert.strictEqual(manager.getTool('actual_budgets_getMonths'), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
