// tests/unit/compact_manage_categories.test.js
//
// #676: the compact manage_categories tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_categories.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-categories]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_categories');
assert.ok(spec, 'manage_categories is registered');

const U1 = '123e4567-e89b-42d3-a456-426614174000';
const U2 = '223e4567-e89b-42d3-a456-426614174001';
const U3 = '323e4567-e89b-42d3-a456-426614174002';
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
  if (re) assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};
const expectCall = async (input, n, a) => {
  await run(input);
  assert.deepStrictEqual(seen, [{ n, a }], JSON.stringify(input));
};

// ---- one positive per action and route ----

await check('create category drops entity and forwards name, group_id and is_income', () =>
  expectCall({ action: 'create', entity: 'category', name: 'Food', group_id: U1, is_income: false }, 'actual_categories_create', { name: 'Food', group_id: U1, is_income: false }));
await check('create category_group routes to the group tool with hidden', () =>
  expectCall({ action: 'create', entity: 'category_group', name: 'Bills', hidden: true, is_income: false }, 'actual_category_groups_create', { name: 'Bills', hidden: true, is_income: false }));
await check('update category wraps fields and drops entity', () =>
  expectCall({ action: 'update', entity: 'category', id: U1, name: 'N', group_id: U2, hidden: true }, 'actual_categories_update', { id: U1, fields: { name: 'N', group_id: U2, hidden: true } }));
await check('update category_group wraps fields too', () =>
  expectCall({ action: 'update', entity: 'category_group', id: U1, name: 'G', is_income: true }, 'actual_category_groups_update', { id: U1, fields: { name: 'G', is_income: true } }));
await check('delete category and category_group route to their tools', async () => {
  await expectCall({ action: 'delete', entity: 'category', id: U1 }, 'actual_categories_delete', { id: U1 });
  await expectCall({ action: 'delete', entity: 'category_group', id: U1 }, 'actual_category_groups_delete', { id: U1 });
});
await check('set_note forwards id and note, and "" clears', async () => {
  await expectCall({ action: 'set_note', id: U1, note: 'hi' }, 'actual_notes_update', { id: U1, note: 'hi' });
  await expectCall({ action: 'set_note', id: U1, note: '' }, 'actual_notes_update', { id: U1, note: '' });
});
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ success: true, categoryId: U1, message: 'ok' });
  assert.deepStrictEqual(await run({ action: 'create', entity: 'category', name: 'A', group_id: U1 }), { success: true, categoryId: U1, message: 'ok' });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the four values', () => refused({ action: 'frobnicate' }, /action.*create.*update.*delete.*set_note/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create without entity, name, or group_id (category) names each', async () => {
  await refused({ action: 'create', name: 'A' }, /entity.*required for action: create/);
  await refused({ action: 'create', entity: 'category' }, /name.*required for action: create/);
  await refused({ action: 'create', entity: 'category', name: 'A' }, /group_id.*required for action: create/);
  await refused({ action: 'create', entity: 'category_group' }, /name.*required for action: create/);
});
await check('NEGATIVE: hidden on a category create is refused (the legacy tool has none)', () =>
  refused({ action: 'create', entity: 'category', name: 'A', group_id: U1, hidden: true }, /hidden.*cannot be used with the other fields given for action: create/));
await check('NEGATIVE: group_id on a category_group create or update is refused', async () => {
  await refused({ action: 'create', entity: 'category_group', name: 'G', group_id: U1 }, /group_id.*cannot be used with the other fields given for action: create/);
  await refused({ action: 'update', entity: 'category_group', id: U1, group_id: U2 }, /group_id.*cannot be used with the other fields given for action: update/);
});
await check('NEGATIVE: an unknown entity is refused', () => refused({ action: 'create', entity: 'account', name: 'A' }, /entity/));
await check('NEGATIVE: update without entity, id or any change is refused', async () => {
  await refused({ action: 'update', id: U1, name: 'x' }, /entity.*required for action: update/);
  await refused({ action: 'update', entity: 'category', name: 'x' }, /id.*required for action: update/);
  await refused({ action: 'update', entity: 'category', id: U1 }, /update needs at least one of: name, group_id, is_income, hidden/);
  await refused({ action: 'update', entity: 'category_group', id: U1 }, /update needs at least one of: name, is_income, hidden/);
});
await check('NEGATIVE: delete without entity or id names it', async () => {
  await refused({ action: 'delete', entity: 'category' }, /id.*required for action: delete/);
  await refused({ action: 'delete', id: U1 }, /entity.*required for action: delete/);
});
await check('NEGATIVE: entity on set_note is refused; set_note needs id and note; a month id is refused', async () => {
  await refused({ action: 'set_note', entity: 'category', id: U1, note: 'x' }, /entity.*not valid for action: set_note/);
  await refused({ action: 'set_note', note: 'x' }, /id.*required for action: set_note/);
  await refused({ action: 'set_note', id: U1 }, /note.*required for action: set_note/);
  await refused({ action: 'set_note', id: 'budget-2026-01', note: 'x' }, /id/);
});
await check('NEGATIVE: malformed ids and values are refused', async () => {
  await refused({ action: 'delete', entity: 'category', id: 'nope' }, /id/);
  await refused({ action: 'create', entity: 'category', name: 'A', group_id: 'nope' }, /group_id/);
  await refused({ action: 'create', entity: 'category', name: '', group_id: U1 }, /name/);
});
await check('NEGATIVE: null is refused (write tool, nullAsAbsent is off)', () =>
  refused({ action: 'update', entity: 'category', id: U1, name: null }, /name/));
await check('NEGATIVE: camelCase keys are refused', () => refused({ action: 'create', entity: 'category', name: 'A', groupId: U1 }, /groupId/));

await check('4b: a legacy list name in a refusal is rewritten to list_entities', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ success: false, error: 'Group X not found. Use actual_category_groups_get to verify.' }) }, phrases);
  const r = await t.call({ action: 'delete', entity: 'category_group', id: U1 });
  assert.ok(!/actual_category_groups_get/.test(r.error) && /list_entities/.test(r.error), r.error);
});

// ---- read-only, published shape, metadata ----

await check('read-only: manage_categories is not listed, and a valid call is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_categories'));
  const legacy = manager.getTool('actual_categories_delete');
  const original = legacy.call;
  let ran = 0;
  legacy.call = async () => { ran++; return { success: true }; };
  try {
    let e;
    try { await manager.callTool('manage_categories', { action: 'delete', entity: 'category', id: U1 }); } catch (x) { e = x; }
    assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', String(e));
    assert.strictEqual(ran, 0);
  } finally { legacy.call = original; }
});

await check('published schema: flat, action required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js.properties)), 'no oneOf or anyOf in any property');
  assert.deepStrictEqual(js.required, ['action']);
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'delete', 'set_note']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'update:', 'delete:', 'set_note:', 'DESTRUCTIVE', 'category_group']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: destructive write tool, hints only', () => {
  assert.deepStrictEqual(annotationsFor('manage_categories'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_categories_create','actual_categories_delete','actual_categories_update','actual_category_groups_create','actual_category_groups_delete','actual_category_groups_update','actual_notes_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-categories] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
