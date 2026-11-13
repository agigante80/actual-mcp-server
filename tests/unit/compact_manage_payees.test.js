// tests/unit/compact_manage_payees.test.js
//
// #676: the compact manage_payees tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_payees.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-payees]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_payees');
assert.ok(spec, 'manage_payees is registered');

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

// ---- one positive per action ----

await check('create forwards name and notes', () =>
  expectCall({ action: 'create', name: 'Shop', notes: 'n' }, 'actual_payees_create', { name: 'Shop', notes: 'n' }));
await check('update wraps fields and forwards a category', () =>
  expectCall({ action: 'update', id: U1, name: 'N', category: U2 }, 'actual_payees_update', { id: U1, fields: { name: 'N', category: U2 } }));
await check('update with category null forwards null (it clears the default category)', () =>
  expectCall({ action: 'update', id: U1, category: null }, 'actual_payees_update', { id: U1, fields: { category: null } }));
await check('update forwards transfer_acct', () =>
  expectCall({ action: 'update', id: U1, transfer_acct: U2 }, 'actual_payees_update', { id: U1, fields: { transfer_acct: U2 } }));
await check('delete forwards id', () => expectCall({ action: 'delete', id: U1 }, 'actual_payees_delete', { id: U1 }));
await check('merge renames target_id and merge_ids', () =>
  expectCall({ action: 'merge', target_id: U1, merge_ids: [U2, U3] }, 'actual_payees_merge', { targetId: U1, mergeIds: [U2, U3] }));
await check('merge accepts 50 sources', () =>
  expectCall({ action: 'merge', target_id: U1, merge_ids: Array.from({ length: 50 }, () => U2) }, 'actual_payees_merge', { targetId: U1, mergeIds: Array.from({ length: 50 }, () => U2) }));
await check('set_note forwards id and note, and "" clears', async () => {
  await expectCall({ action: 'set_note', id: U1, note: 'hi' }, 'actual_notes_update', { id: U1, note: 'hi' });
  await expectCall({ action: 'set_note', id: U1, note: '' }, 'actual_notes_update', { id: U1, note: '' });
});
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ success: true, mergedIds: [U2], message: 'm' });
  assert.deepStrictEqual(await run({ action: 'merge', target_id: U1, merge_ids: [U2] }), { success: true, mergedIds: [U2], message: 'm' });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the five values', () => refused({ action: 'frobnicate' }, /action.*create.*update.*delete.*merge.*set_note/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create without name, and delete or update without id, name it', async () => {
  await refused({ action: 'create' }, /name.*required for action: create/);
  await refused({ action: 'delete' }, /id.*required for action: delete/);
  await refused({ action: 'update', name: 'x' }, /id.*required for action: update/);
});
await check('NEGATIVE: update with only id is refused with the exact message', () =>
  refused({ action: 'update', id: U1 }, /update needs at least one of: name, transfer_acct, category/));
await check('NEGATIVE: merge needs target_id and merge_ids; empty, 51 or target-listed-in-sources shapes are refused', async () => {
  await refused({ action: 'merge', merge_ids: [U2] }, /target_id.*required for action: merge/);
  await refused({ action: 'merge', target_id: U1 }, /merge_ids.*required for action: merge/);
  await refused({ action: 'merge', target_id: U1, merge_ids: [] }, /merge_ids/);
  await refused({ action: 'merge', target_id: U1, merge_ids: Array.from({ length: 51 }, () => U2) }, /merge_ids/);
  await refused({ action: 'merge', target_id: U1, merge_ids: ['nope'] }, /merge_ids/);
});
await check('NEGATIVE: a field of another action is refused with the owners', async () => {
  await refused({ action: 'delete', id: U1, name: 'x' }, /name.*not valid for action: delete/);
  await refused({ action: 'create', name: 'A', id: U1 }, /id.*not valid for action: create/);
  await refused({ action: 'create', name: 'A', merge_ids: [U1] }, /merge_ids.*not valid for action: create/);
});
await check('NEGATIVE: set_note without id or note, a month id and extra keys are refused', async () => {
  await refused({ action: 'set_note', note: 'x' }, /id.*required for action: set_note/);
  await refused({ action: 'set_note', id: U1 }, /note.*required for action: set_note/);
  await refused({ action: 'set_note', id: 'budget-2026-01', note: 'x' }, /id/);
  await refused({ action: 'set_note', id: U1, note: 'x', name: 'y' }, /name.*not valid for action: set_note/);
});
await check('NEGATIVE: malformed ids and values are refused', async () => {
  await refused({ action: 'delete', id: 'nope' }, /id/);
  await refused({ action: 'update', id: U1, category: 'nope' }, /category/);
  await refused({ action: 'update', id: U1, transfer_acct: 'nope' }, /transfer_acct/);
  await refused({ action: 'create', name: '' }, /name/);
  await refused({ action: 'create', name: 'A', notes: 'x'.repeat(1001) }, /notes/);
});
await check('NEGATIVE: null is refused everywhere except update category', async () => {
  await refused({ action: 'update', id: U1, name: null }, /name/);
  await refused({ action: 'create', name: 'A', notes: null }, /notes/);
});
await check('NEGATIVE: camelCase legacy keys are refused', async () => {
  await refused({ action: 'merge', targetId: U1, merge_ids: [U2] }, /targetId/);
  await refused({ action: 'merge', target_id: U1, mergeIds: [U2] }, /mergeIds/);
});
await check('the published category key is [string, null] without anyOf', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.deepStrictEqual(js.properties.category.type, ['string', 'null']);
});

// ---- read-only, published shape, metadata ----

await check('read-only: manage_payees is not listed, and a valid call is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_payees'));
  const legacy = manager.getTool('actual_payees_delete');
  const original = legacy.call;
  let ran = 0;
  legacy.call = async () => { ran++; return { success: true }; };
  try {
    let e;
    try { await manager.callTool('manage_payees', { action: 'delete', id: U1 }); } catch (x) { e = x; }
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
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'delete', 'merge', 'set_note']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'update:', 'delete:', 'merge:', 'set_note:', 'DESTRUCTIVE']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: destructive write tool, hints only', () => {
  assert.deepStrictEqual(annotationsFor('manage_payees'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_notes_update','actual_payees_create','actual_payees_delete','actual_payees_merge','actual_payees_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-payees] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
