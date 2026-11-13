// tests/unit/compact_manage_schedules.test.js
//
// #677: the compact manage_schedules tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_schedules.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-schedules]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { titleFor } = await import('../../dist/src/lib/tool-titles.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const { ISBETWEEN_NEEDS_RANGE } = await import('../../dist/src/lib/schemas/schedule-amount.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_schedules');
assert.ok(spec, 'manage_schedules is registered');

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
const RECUR = { frequency: 'monthly', start: '2026-12-01' };

// ---- one positive per action ----

await check('create forwards a one-off date and injects no default', () =>
  expectCall({ action: 'create', date: '2026-12-01' }, 'actual_schedules_create', { date: '2026-12-01' }));
await check('create renames amount_op and forwards the other keys flat', () =>
  expectCall({ action: 'create', name: 'Rent', payee: U1, account: U2, amount: -5000, amount_op: 'isapprox', date: '2026-12-01', posts_transaction: true },
    'actual_schedules_create', { name: 'Rent', payee: U1, account: U2, amount: -5000, amountOp: 'isapprox', date: '2026-12-01', posts_transaction: true }));
await check('create with an isbetween range and a recurrence object', () =>
  expectCall({ action: 'create', amount: { num1: -10000, num2: -5000 }, amount_op: 'isbetween', date: RECUR },
    'actual_schedules_create', { amount: { num1: -10000, num2: -5000 }, amountOp: 'isbetween', date: RECUR }));
await check('update renames amount_op and reset_next_date, and injects no default', () =>
  expectCall({ action: 'update', id: U3, amount: -100, amount_op: 'is', reset_next_date: true }, 'actual_schedules_update', { id: U3, amount: -100, amountOp: 'is', resetNextDate: true }));
await check('update with only a name sends only id and name (no posts_transaction default)', () =>
  expectCall({ action: 'update', id: U3, name: 'N' }, 'actual_schedules_update', { id: U3, name: 'N' }));
await check('update null clears payee and account', () =>
  expectCall({ action: 'update', id: U3, payee: null, account: null }, 'actual_schedules_update', { id: U3, payee: null, account: null }));
await check('update accepts a recurrence date', () =>
  expectCall({ action: 'update', id: U3, date: RECUR, reset_next_date: true }, 'actual_schedules_update', { id: U3, date: RECUR, resetNextDate: true }));
await check('delete forwards id', () => expectCall({ action: 'delete', id: U3 }, 'actual_schedules_delete', { id: U3 }));
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ id: U3 });
  assert.deepStrictEqual(await run({ action: 'create', date: '2026-12-01' }), { id: U3 });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the three values', () => refused({ action: 'frobnicate' }, /action.*create.*update.*delete/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create without date, update or delete without id, name the key', async () => {
  await refused({ action: 'create', name: 'x' }, /date.*required for action: create/);
  await refused({ action: 'update', name: 'x' }, /id.*required for action: update/);
  await refused({ action: 'delete' }, /id.*required for action: delete/);
});
await check('NEGATIVE: bad date 13/11/2026 is refused naming the accepted shapes', async () => {
  await refused({ action: 'create', date: '13/11/2026' }, /date must be "YYYY-MM-DD" or a recurrence object/);
  await refused({ action: 'update', id: U3, date: '13/11/2026' }, /date must be "YYYY-MM-DD"/);
  await refused({ action: 'create', date: 5 }, /date must be/);
  await refused({ action: 'create', date: [] }, /date must be/);
});
await check('NEGATIVE: a bad recurrence object is refused with the nested path', async () => {
  await refused({ action: 'create', date: { frequency: 'hourly', start: '2026-12-01' } }, /date.*frequency/);
  await refused({ action: 'create', date: { frequency: 'daily', start: '2026-12-01', bogus: 1 } }, /date/);
});
await check('NEGATIVE: isbetween without a range gives the translated ISBETWEEN_NEEDS_RANGE text', async () => {
  const translated = ISBETWEEN_NEEDS_RANGE.replaceAll('amountOp', 'amount_op');
  await refused({ action: 'create', date: '2026-12-01', amount: -5000, amount_op: 'isbetween' }, new RegExp(translated.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await refused({ action: 'create', date: '2026-12-01', amount_op: 'isbetween' }, /amount_op 'isbetween' needs amount/);
  await refused({ action: 'update', id: U3, amount: 100, amount_op: 'isbetween' }, /amount_op 'isbetween' needs amount/);
});
await check('NEGATIVE: a range without isbetween is refused', async () => {
  await refused({ action: 'create', date: '2026-12-01', amount: { num1: 1, num2: 2 } }, /amount/);
  await refused({ action: 'update', id: U3, amount: { num1: 1, num2: 2 }, amount_op: 'is' }, /amount/);
});
await check('NEGATIVE: a non-integer or malformed amount is refused', async () => {
  await refused({ action: 'create', date: '2026-12-01', amount: 1.5 }, /amount/);
  await refused({ action: 'create', date: '2026-12-01', amount: 'abc' }, /amount/);
  await refused({ action: 'create', date: '2026-12-01', amount: { num1: 1 }, amount_op: 'isbetween' }, /amount/);
});
await check('NEGATIVE: delete with reset_next_date or any other field is refused', async () => {
  await refused({ action: 'delete', id: U3, reset_next_date: true }, /reset_next_date.*not valid for action: delete/);
  await refused({ action: 'delete', id: U3, name: 'x' }, /name.*not valid for action: delete/);
});
await check('NEGATIVE: create refuses id and reset_next_date', async () => {
  await refused({ action: 'create', date: '2026-12-01', id: U3 }, /id.*not valid for action: create/);
  await refused({ action: 'create', date: '2026-12-01', reset_next_date: true }, /reset_next_date.*not valid for action: create/);
});
await check('NEGATIVE: null is refused on create, and on update except payee and account', async () => {
  await refused({ action: 'create', date: '2026-12-01', payee: null }, /payee/);
  await refused({ action: 'create', date: '2026-12-01', name: null }, /name/);
  await refused({ action: 'update', id: U3, name: null }, /name/);
  await refused({ action: 'update', id: U3, amount: null }, /amount/);
});
await check('NEGATIVE: malformed ids and bad amount_op are refused', async () => {
  await refused({ action: 'delete', id: 'nope' }, /id/);
  await refused({ action: 'update', id: 'nope', name: 'x' }, /id/);
  await refused({ action: 'create', date: '2026-12-01', payee: 'nope' }, /payee/);
  await refused({ action: 'create', date: '2026-12-01', account: 'nope' }, /account/);
  await refused({ action: 'create', date: '2026-12-01', amount_op: 'gte' }, /amount_op/);
});
await check('NEGATIVE: camelCase legacy keys are refused', async () => {
  await refused({ action: 'create', date: '2026-12-01', amountOp: 'is' }, /amountOp/);
  await refused({ action: 'update', id: U3, resetNextDate: true }, /resetNextDate/);
});

// ---- read-only, published shape, metadata ----

await check('read-only: all three actions are refused with MCP_READ_ONLY and run nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_schedules'));
  const calls = [
    ['create', 'actual_schedules_create', { action: 'create', date: '2026-12-01' }],
    ['update', 'actual_schedules_update', { action: 'update', id: U3, name: 'x' }],
    ['delete', 'actual_schedules_delete', { action: 'delete', id: U3 }],
  ];
  for (const [a, legacyName, input] of calls) {
    const legacy = manager.getTool(legacyName);
    const original = legacy.call;
    let ran = 0;
    legacy.call = async () => { ran++; return { success: true }; };
    try {
      let e;
      try { await manager.callTool('manage_schedules', input); } catch (x) { e = x; }
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
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'delete']);
  assert.deepStrictEqual(js.properties.payee.type, ['string', 'null']);
  assert.deepStrictEqual(js.properties.amount.type, ['number', 'object']);
  assert.deepStrictEqual(js.properties.date.type, ['string', 'object']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'update:', 'delete:', 'DESTRUCTIVE']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations and title', () => {
  assert.deepStrictEqual(annotationsFor('manage_schedules'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.strictEqual(titleFor('manage_schedules'), 'Manage schedules');
});
await check('compactLegacyNames covers the three targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_schedules_create', 'actual_schedules_delete', 'actual_schedules_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-schedules] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
