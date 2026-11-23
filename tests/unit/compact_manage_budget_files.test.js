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
await check('description states the side-effect semantics', () => {
  for (const w of ['ADDS a budget', 'replaces nothing', 'NEW server budget file', 'OVERWRITES', 'remembered per caller', 'other open sessions', 'legacy bearer token']) assert.ok(spec.description.includes(w), w);
  assert.ok(!spec.description.includes('this session only'), 'no bare this session only (#787)');
});
// #687: the import overwrites nothing and loads nothing for the session; the old wording said
// both, and a model that believed it wrote into the configured budget by mistake.
const FALSE_IMPORT_CLAIM = /REPLACES|import is DESTRUCTIVE|LOADS the imported/;
await check('NEGATIVE #687: the description claims no replacement and no load', () => {
  assert.ok(!FALSE_IMPORT_CLAIM.test(spec.description), spec.description);
});
await check('NEGATIVE #687: the pre-#687 import line is caught by that check', () => {
  assert.ok(FALSE_IMPORT_CLAIM.test("import is DESTRUCTIVE: importing an export REPLACES that budget's local copy"));
});

// ---- #684: behaviour facts the annotations cannot carry ----
//
// One entry per shipped fact, each verified in the code (see docs/audit/tdqs-baseline.md,
// "Behaviour disclosure for manage_budget_files (#684)"). Pure: returns the names whose
// expression does not match, so a fixture proves each entry can fail.
const BEHAVIOUR_FACTS = [
  ['import reversibility', /nothing removes the uploaded server file/i],
  ['switch and export reversibility', /undo it by switching back[\s\S]*only deleting the file on the server host removes it/i],
  ['switch load', /loads the target budget[^\n]*load failure can surface on the next call/i],
  ['export contents', /whole active budget \(every account and transaction\)/i],
  ['limits', /path[^\n]*max 4096 characters[\s\S]*base64[^\n]*max 67108864 characters[\s\S]*long import can time out/i],
  // Unconditional on purpose: the re-selection happens after a successful import too (review of
  // #684), so a conditional wording would tell a model that later calls reach the imported budget.
  ['after import', /success or failure, the next call from every session[^\n]*reloads that session's own configured budget[^\n]*do not reach the imported budget/i],
];
function missingBehaviourFacts(description) {
  return BEHAVIOUR_FACTS.filter(([, re]) => !re.test(description)).map(([name]) => name);
}
// The Decision's must-not-publish list: the import timeout value, the export directory variable
// and any wording that advertises the scope of `path` (a file-existence probe, see #684).
const LEAK = /600000|ACTUAL_IMPORT_TIMEOUT_MS|ACTUAL_EXPORT_DIR|not restricted|unrestricted|anywhere|absolute path|any file|any (server )?path/i;
const LEAK_MESSAGE = 'manage_budget_files description reveals a configured value or path scope';

await check('#684: every shipped behaviour fact appears in the published description', () => {
  const missing = missingBehaviourFacts(spec.description);
  assert.deepStrictEqual(missing, [], `manage_budget_files description missing fact: ${missing.join(', ')}`);
});
await check('NEGATIVE #684: a description missing a fact is reported by name', () => {
  const copy = spec.description.replace(/nothing removes the uploaded server file/i, '');
  const missing = missingBehaviourFacts(copy);
  assert.deepStrictEqual(missing, ['import reversibility'], `manage_budget_files description missing fact: ${missing.join(', ')}`);
});
await check('NEGATIVE #684: every fact entry can fail on its own', () => {
  for (const [name, re] of BEHAVIOUR_FACTS) {
    assert.ok(!re.test('Switch, import or export a budget file. Returns nothing.'), `${name} matched an unrelated text`);
  }
  assert.deepStrictEqual(missingBehaviourFacts(''), BEHAVIOUR_FACTS.map(([name]) => name));
});
await check('#684: the switch line keeps "unconfigured or not permitted" as one refused case (#570)', () => {
  const line = spec.description.split('\n').find((l) => l.startsWith('switch:'));
  assert.ok(line, 'a line starts with switch:');
  assert.ok(line.includes('an unconfigured or not permitted name is refused'), line);
});
await check('#684: the description reveals no configured value or path scope', () => {
  assert.ok(!LEAK.test(spec.description), LEAK_MESSAGE);
});
await check('NEGATIVE #684: a path-scope sentence is caught by the no-leak check', () => {
  const copy = `${spec.description} path may be any server path.`;
  let e;
  try { assert.ok(!LEAK.test(copy), LEAK_MESSAGE); } catch (x) { e = x; }
  assert.ok(e && e.message === LEAK_MESSAGE, `expected "${LEAK_MESSAGE}", got ${e && e.message}`);
});

console.log(`\n[compact-manage-budget-files] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
