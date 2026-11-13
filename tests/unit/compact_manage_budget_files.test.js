// tests/unit/compact_manage_budget_files.test.js
//
// #678: the compact manage_budget_files tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_budget_files.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-budget-files]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { titleFor } = await import('../../dist/src/lib/tool-titles.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_budget_files');
assert.ok(spec, 'manage_budget_files is registered');

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
const ACTIONS = ['switch', 'import', 'export'];
const READ_ONLY_CASES = [
  ['actual_budgets_switch', { action: 'switch', budget_name: 'Main' }],
  ['actual_budgets_import', { action: 'import', path: '/tmp/x.zip' }],
  ['actual_budgets_export', { action: 'export' }],
];

// ---- one positive per action ----

await check('switch renames budget_name', () =>
  expectCall({ action: 'switch', budget_name: 'Main Budget' }, 'actual_budgets_switch', { budgetName: 'Main Budget' }));
await check('switch accepts a unicode letter name', () =>
  expectCall({ action: 'switch', budget_name: 'Caf\u00e9 2026' }, 'actual_budgets_switch', { budgetName: 'Caf\u00e9 2026' }));
await check('import by path forwards only path (no default type injected)', () =>
  expectCall({ action: 'import', path: '/data/export.zip' }, 'actual_budgets_import', { path: '/data/export.zip' }));
await check('import by base64 forwards base64, type and filename', () =>
  expectCall({ action: 'import', base64: 'QUJD', type: 'ynab5', filename: 'b.zip' }, 'actual_budgets_import', { base64: 'QUJD', type: 'ynab5', filename: 'b.zip' }));
await check('export with no filename forwards an empty object', () =>
  expectCall({ action: 'export' }, 'actual_budgets_export', {}));
await check('export forwards a fixed filename', () =>
  expectCall({ action: 'export', filename: 'e2e-export' }, 'actual_budgets_export', { filename: 'e2e-export' }));
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ result: { success: true } });
  assert.deepStrictEqual(await run({ action: 'export' }), { result: { success: true } });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the values', () => refused({ action: 'delete' }, /action.*switch.*import.*export/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: switch without budget_name, empty or bad characters', async () => {
  await refused({ action: 'switch' }, /budget_name.*required for action: switch/);
  await refused({ action: 'switch', budget_name: '' }, /budget_name must not be empty/);
  await refused({ action: 'switch', budget_name: 'a/b' }, /budget_name must contain only letters/);
  await refused({ action: 'switch', budget_name: 'x'.repeat(121) }, /at most 120 characters/);
});
await check('NEGATIVE: import with both sources or neither', async () => {
  await refused({ action: 'import', path: '/a.zip', base64: 'QUJD' }, /Provide exactly one of "path" or "base64"/);
  await refused({ action: 'import' }, /Provide exactly one of "path" or "base64"/);
  await refused({ action: 'import', type: 'ynab4' }, /Provide exactly one of "path" or "base64"/);
});
await check('NEGATIVE: import rejects malformed base64 and an unknown type', async () => {
  await refused({ action: 'import', base64: 'not base64!' }, /base64 must be valid base64/);
  await refused({ action: 'import', path: '/a.zip', type: 'csv' }, /type/);
});
await check('NEGATIVE: export refuses an unsafe filename', async () => {
  await refused({ action: 'export', filename: '../x' }, /filename must start with a letter or digit/);
  await refused({ action: 'export', filename: 'a/b' }, /filename must start with a letter or digit|no path separators/);
  await refused({ action: 'export', filename: 'a..b' }, /filename must not contain "\.\."/);
  await refused({ action: 'export', filename: '' }, /filename must not be empty/);
});
await check('NEGATIVE: a key of another action is refused', async () => {
  await refused({ action: 'export', path: '/a.zip' }, /path.*not valid for action: export/);
  await refused({ action: 'switch', budget_name: 'Main', filename: 'x' }, /filename.*not valid for action: switch/);
  await refused({ action: 'export', budget_name: 'Main' }, /budget_name.*not valid for action: export/);
});
await check('NEGATIVE: camelCase budgetName is refused', () => refused({ action: 'switch', budgetName: 'Main' }, /budgetName/));


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
  assert.ok(!('pattern' in js.properties.budget_name), 'budget_name has no pattern (#293)');
  assert.deepStrictEqual(js.properties.type.enum, ['actual', 'ynab4', 'ynab5']);
});
await check('description: purpose, Returns, every action named, no legacy name', () => {
  assert.ok(spec.description.length > 100);
  assert.ok(spec.description.includes('Returns'));
  for (const a of ACTIONS) assert.ok(spec.description.includes(a + ':'), a);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations and title', () => {
  assert.deepStrictEqual(annotationsFor('manage_budget_files'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.strictEqual(titleFor('manage_budget_files'), 'Manage budget files');
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_budgets_export', 'actual_budgets_import', 'actual_budgets_switch']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});
await check('read-only: every action is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_budget_files'));
  for (const [legacyName, input] of READ_ONLY_CASES) {
    const legacy = manager.getTool(legacyName);
    const original = legacy.call;
    let ran = 0;
    legacy.call = async () => { ran++; return { success: true }; };
    try {
      let e;
      try { await manager.callTool('manage_budget_files', input); } catch (x) { e = x; }
      assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', `${input.action}: ${e}`);
      assert.strictEqual(ran, 0, input.action);
    } finally { legacy.call = original; }
  }
});
await check('description states the destructive and side-effect semantics', () => {
  for (const w of ['DESTRUCTIVE', 'REPLACES', 'NEW server budget file', 'LOADS', 'OVERWRITES', 'this session only']) assert.ok(spec.description.includes(w), w);
});

console.log(`\n[compact-manage-budget-files] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
