// tests/unit/compact_manage_rules.test.js
//
// #677: the compact manage_rules tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_rules.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-rules]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { titleFor } = await import('../../dist/src/lib/tool-titles.js');
const { ToolUnavailableError, NotFoundRefusal } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const legacyCreate = (await import('../../dist/src/tools/rules_create.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_rules');
assert.ok(spec, 'manage_rules is registered');

const U1 = '123e4567-e89b-42d3-a456-426614174000';
const U2 = '223e4567-e89b-42d3-a456-426614174001';
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

const COND = { field: 'notes', op: 'contains', value: 'coffee' };
const ACT = { op: 'set', field: 'category', value: U1 };

// ---- one positive per action ----

await check('create renames conditions_op and injects no default', () =>
  expectCall({ action: 'create', conditions: [COND], actions: [ACT], conditions_op: 'or', stage: 'pre' }, 'actual_rules_create', { conditionsOp: 'or', stage: 'pre', conditions: [COND], actions: [ACT] }));
await check('create with only conditions and actions sends exactly those two keys', () =>
  expectCall({ action: 'create', conditions: [COND], actions: [ACT] }, 'actual_rules_create', { conditions: [COND], actions: [ACT] }));
await check('create accepts an action without op (the legacy default applies later)', () =>
  expectCall({ action: 'create', conditions: [COND], actions: [{ field: 'category', value: U1 }] }, 'actual_rules_create', { conditions: [COND], actions: [{ field: 'category', value: U1 }] }));
await check('create with stage null forwards null (the normal stage)', () =>
  expectCall({ action: 'create', conditions: [COND], actions: [ACT], stage: null }, 'actual_rules_create', { stage: null, conditions: [COND], actions: [ACT] }));
await check('create_batch forwards the rules unchanged with their camelCase keys', () => {
  const rules = [{ conditionsOp: 'or', conditions: [COND], actions: [ACT] }, { stage: 'post', conditions: [COND], actions: [ACT] }];
  return expectCall({ action: 'create_batch', rules }, 'actual_rules_create_batch', { rules });
});
await check('create_batch accepts 50 rules', () => {
  const rules = Array.from({ length: 50 }, () => ({ conditions: [COND], actions: [ACT] }));
  return expectCall({ action: 'create_batch', rules }, 'actual_rules_create_batch', { rules });
});
await check('upsert renames conditions_op', () =>
  expectCall({ action: 'upsert', conditions: [COND], actions: [ACT], conditions_op: 'and' }, 'actual_rules_create_or_update', { conditionsOp: 'and', conditions: [COND], actions: [ACT] }));
await check('update wraps everything but id under fields and injects no default (an or rule stays or)', () =>
  expectCall({ action: 'update', id: U1, stage: 'post' }, 'actual_rules_update', { id: U1, fields: { stage: 'post' } }));
await check('update renames conditions_op inside fields', () =>
  expectCall({ action: 'update', id: U1, conditions_op: 'or', actions: [ACT] }, 'actual_rules_update', { id: U1, fields: { conditionsOp: 'or', actions: [ACT] } }));
await check('update with stage null forwards null', () =>
  expectCall({ action: 'update', id: U1, stage: null }, 'actual_rules_update', { id: U1, fields: { stage: null } }));
await check('delete forwards id', () => expectCall({ action: 'delete', id: U1 }, 'actual_rules_delete', { id: U1 }));
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ id: U2, created: true });
  assert.deepStrictEqual(await run({ action: 'upsert', conditions: [COND], actions: [ACT] }), { id: U2, created: true });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the five values', () => refused({ action: 'frobnicate' }, /action.*create.*create_batch.*upsert.*update.*delete/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create and upsert without conditions or actions name the key', async () => {
  await refused({ action: 'create', actions: [ACT] }, /conditions.*required for action: create/);
  await refused({ action: 'create', conditions: [COND] }, /actions.*required for action: create/);
  await refused({ action: 'upsert', actions: [ACT] }, /conditions.*required for action: upsert/);
});
await check('NEGATIVE: update without id, and delete without id, name it', async () => {
  await refused({ action: 'update', stage: 'pre' }, /id.*required for action: update/);
  await refused({ action: 'delete' }, /id.*required for action: delete/);
});
await check('NEGATIVE: delete with conditions is refused naming the key', () =>
  refused({ action: 'delete', id: U1, conditions: [COND] }, /conditions.*not valid for action: delete/));
await check('NEGATIVE: create_batch item with conditions_op is refused by name', () =>
  refused({ action: 'create_batch', rules: [{ conditions_op: 'or', conditions: [COND], actions: [ACT] }] }, /rules.*unknown key "conditions_op"/));
await check('NEGATIVE: create_batch with 51 rules or none is refused', async () => {
  await refused({ action: 'create_batch', rules: Array.from({ length: 51 }, () => ({ conditions: [COND], actions: [ACT] })) }, /rules/);
  await refused({ action: 'create_batch', rules: [] }, /rules/);
  await refused({ action: 'create_batch' }, /rules.*required for action: create_batch/);
});
await check('NEGATIVE: create_batch item with a bad condition is refused with its path', () =>
  refused({ action: 'create_batch', rules: [{ conditions: [{ field: 'notes', op: 'contains' }], actions: [ACT] }] }, /rules.*0\.conditions\.0\.value/));
await check('NEGATIVE: update action without op is refused (the legacy update requires it)', () =>
  refused({ action: 'update', id: U1, actions: [{ field: 'category', value: U1 }] }, /actions.*0\.op/));
await check('NEGATIVE: bad stage and "default" are refused', async () => {
  await refused({ action: 'create', conditions: [COND], actions: [ACT], stage: 'default' }, /stage/);
  await refused({ action: 'update', id: U1, stage: 'middle' }, /stage/);
});
await check('NEGATIVE: bad conditions_op and malformed ids are refused', async () => {
  await refused({ action: 'create', conditions: [COND], actions: [ACT], conditions_op: 'xor' }, /conditions_op/);
  await refused({ action: 'delete', id: 'nope' }, /id/);
  await refused({ action: 'update', id: 'nope', stage: 'pre' }, /id/);
});
await check('NEGATIVE: a condition without a value is refused', () =>
  refused({ action: 'create', conditions: [{ field: 'notes', op: 'contains' }], actions: [ACT] }, /conditions.*0\.value/));
await check('NEGATIVE: camelCase conditionsOp at the top level is refused', () =>
  refused({ action: 'create', conditions: [COND], actions: [ACT], conditionsOp: 'or' }, /conditionsOp/));
await check('NEGATIVE: unknown key is refused', () => refused({ action: 'create', conditions: [COND], actions: [ACT], bogus: 1 }, /bogus/));

// ---- legacy rules still apply, and the 4b rewrite ----

await check('a legacy validateRuleInput error passes through from the real actual_rules_create handler', async () => {
  const t = buildCompactTool(spec, { callOperation: async (_n, a) => legacyCreate.call(a) }, phrases);
  let e;
  try { await t.call({ action: 'create', conditions: [COND], actions: [{ op: 'set', value: 'x' }] }); } catch (x) { e = x; }
  assert.ok(e && /requires a "field"/.test(e.message), String(e && e.message));
});
await check('4b: a NotFoundRefusal for a rule does not name actual_rules_get', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => { throw new NotFoundRefusal('Rule', U1, 'actual_rules_get'); } }, phrases);
  let e;
  try { await t.call({ action: 'delete', id: U1 }); } catch (x) { e = x; }
  assert.ok(e instanceof NotFoundRefusal, String(e));
  assert.ok(!/actual_rules_get/.test(e.message) && /list_entities/.test(e.message), e.message);
});

// ---- read-only, published shape, metadata ----

await check('read-only: all five actions are refused with MCP_READ_ONLY and run nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_rules'));
  const calls = {
    create: { action: 'create', conditions: [COND], actions: [ACT] },
    create_batch: { action: 'create_batch', rules: [{ conditions: [COND], actions: [ACT] }] },
    upsert: { action: 'upsert', conditions: [COND], actions: [ACT] },
    update: { action: 'update', id: U1, stage: 'pre' },
    delete: { action: 'delete', id: U1 },
  };
  const legacyOf = { create: 'actual_rules_create', create_batch: 'actual_rules_create_batch', upsert: 'actual_rules_create_or_update', update: 'actual_rules_update', delete: 'actual_rules_delete' };
  for (const [a, input] of Object.entries(calls)) {
    const legacy = manager.getTool(legacyOf[a]);
    const original = legacy.call;
    let ran = 0;
    legacy.call = async () => { ran++; return { success: true }; };
    try {
      let e;
      try { await manager.callTool('manage_rules', input); } catch (x) { e = x; }
      assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', `${a}: ${e}`);
      assert.strictEqual(ran, 0, a);
    } finally { legacy.call = original; }
  }
});

await check('published schema: flat, action required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js)), 'no oneOf or anyOf at any depth');
  assert.deepStrictEqual(js.required, ['action']);
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'create_batch', 'upsert', 'update', 'delete']);
  assert.deepStrictEqual(js.properties.stage.type, ['string', 'null']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, batch non-atomic, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'create_batch:', 'upsert:', 'update:', 'delete:', 'DESTRUCTIVE', 'NOT atomic']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations and title', () => {
  assert.deepStrictEqual(annotationsFor('manage_rules'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.strictEqual(titleFor('manage_rules'), 'Manage rules');
});
await check('compactLegacyNames covers the five targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_rules_create', 'actual_rules_create_batch', 'actual_rules_create_or_update', 'actual_rules_delete', 'actual_rules_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});
await check('NEGATIVE: update with only id is refused and calls nothing', () =>
  refused({ action: 'update', id: U1 }, /update needs at least one of: stage, conditions_op, conditions, actions/));

console.log(`\n[compact-manage-rules] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
