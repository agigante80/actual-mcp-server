// tests/unit/compact_manage_transactions.test.js
//
// #675: the compact manage_transactions tool. A stubbed callOperation records the exact legacy
// tool name and arguments every action produces, and each refusal is proven to call nothing.
// The same-account transfer case runs the REAL legacy tool with adapter.createTransfer stubbed.
//
// Run: node tests/unit/compact_manage_transactions.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-transactions]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const transfersCreate = (await import('../../dist/src/tools/transfers_create.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_transactions');
assert.ok(spec, 'manage_transactions is registered');

const A = '123e4567-e89b-42d3-a456-426614174000';
const B = '223e4567-e89b-42d3-a456-426614174001';
const T1 = '323e4567-e89b-42d3-a456-426614174002';
const T2 = '423e4567-e89b-42d3-a456-426614174003';
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

await check('create forwards exactly the given fields to actual_transactions_create and returns the legacy value', async () => {
  reply = () => ({ success: true, id: null });
  const r = await run({ action: 'create', account: A, date: '2026-11-13', amount: -1250, notes: 'x' });
  assert.deepStrictEqual(seen, [{ n: 'actual_transactions_create', a: { account: A, date: '2026-11-13', amount: -1250, notes: 'x' } }]);
  assert.deepStrictEqual(r, { success: true, id: null });
  reply = (n) => ({ from: n });
});
await check('create forwards the optional fields, including a split', () =>
  expectCall({ action: 'create', account: A, date: '2026-11-13', amount: -1000, payee_name: 'Shop', cleared: false, imported_id: 'i1', subtransactions: [{ amount: -400 }, { amount: -600 }] },
    'actual_transactions_create', { account: A, date: '2026-11-13', amount: -1000, payee_name: 'Shop', cleared: false, imported_id: 'i1', subtransactions: [{ amount: -400 }, { amount: -600 }] }));
await check('update wraps everything but id under fields', () =>
  expectCall({ action: 'update', id: T1, notes: 'y' }, 'actual_transactions_update', { id: T1, fields: { notes: 'y' } }));
await check('update with category null forwards null (it clears the field)', () =>
  expectCall({ action: 'update', id: T1, category: null }, 'actual_transactions_update', { id: T1, fields: { category: null } }));
await check('update accepts a payee name and the update-only keys', () =>
  expectCall({ action: 'update', id: T1, payee: 'Some Shop', reconciled: true, transfer_id: null, imported_payee: 'SHOP' }, 'actual_transactions_update',
    { id: T1, fields: { payee: 'Some Shop', reconciled: true, transfer_id: null, imported_payee: 'SHOP' } }));
await check('update_batch forwards the updates unchanged and returns the BatchResult unchanged', async () => {
  const batch = { succeeded: [{ id: T1 }], failed: [], total: 1, successCount: 1, failureCount: 0 };
  reply = () => batch;
  const r = await run({ action: 'update_batch', updates: [{ id: T1, fields: { cleared: true } }] });
  assert.deepStrictEqual(seen, [{ n: 'actual_transactions_update_batch', a: { updates: [{ id: T1, fields: { cleared: true } }] } }]);
  assert.deepStrictEqual(r, batch);
  reply = (n) => ({ from: n });
});
await check('delete forwards id', () => expectCall({ action: 'delete', id: T1 }, 'actual_transactions_delete', { id: T1 }));
await check('import renames account_id to accountId and keeps the loose rows', () =>
  expectCall({ action: 'import', account_id: A, txs: [{ date: '2026-11-13', amount: -500, imported_id: 'imp-1' }] },
    'actual_transactions_import', { accountId: A, txs: [{ date: '2026-11-13', amount: -500, imported_id: 'imp-1' }] }));
await check('merge forwards ids and returns the legacy value unchanged', async () => {
  const merged = { result: { success: true, keptId: T1, deletedId: T2 } };
  reply = () => merged;
  const r = await run({ action: 'merge', ids: [T1, T2] });
  assert.deepStrictEqual(seen, [{ n: 'actual_transactions_merge', a: { ids: [T1, T2] } }]);
  assert.deepStrictEqual(r, merged);
  reply = (n) => ({ from: n });
});
await check('transfer forwards exactly its four keys', () =>
  expectCall({ action: 'transfer', from_account: A, to_account: B, amount: 5000, date: '2026-11-13' }, 'actual_transfers_create',
    { from_account: A, to_account: B, amount: 5000, date: '2026-11-13' }));
await check('transfer forwards notes', () =>
  expectCall({ action: 'transfer', from_account: A, to_account: B, amount: 5000, date: '2026-11-13', notes: 'rent' }, 'actual_transfers_create',
    { from_account: A, to_account: B, amount: 5000, date: '2026-11-13', notes: 'rent' }));
await check('50 batch items are accepted', () =>
  expectCall({ action: 'update_batch', updates: Array.from({ length: 50 }, () => ({ id: T1, fields: { notes: 'n' } })) }, 'actual_transactions_update_batch',
    { updates: Array.from({ length: 50 }, () => ({ id: T1, fields: { notes: 'n' } })) }));

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action names action and lists the seven values', async () => {
  await refused({ action: 'frobnicate' }, /action.*create.*update.*update_batch.*delete.*import.*merge.*transfer/);
});
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: delete without id names id', () => refused({ action: 'delete' }, /id.*required for action: delete/));
await check('NEGATIVE: update without id names id', () => refused({ action: 'update', notes: 'x' }, /id/));
await check('NEGATIVE: create without account, date or amount names each', async () => {
  await refused({ action: 'create' }, /account.*required for action: create/);
  await refused({ action: 'create', account: A, amount: 1 }, /date.*required for action: create/);
  await refused({ action: 'create', account: A, date: '2026-11-13' }, /amount.*required for action: create/);
});
await check('NEGATIVE: a field of another action is refused with the owners (account on delete)', () =>
  refused({ action: 'delete', id: T1, account: A }, /account.*not valid for action: delete; valid only for action: create, update/));
await check('NEGATIVE: txs on create and ids on delete are refused', async () => {
  await refused({ action: 'create', account: A, date: '2026-11-13', amount: 1, txs: [] }, /txs/);
  await refused({ action: 'delete', id: T1, ids: [T1, T2] }, /ids/);
});
await check('NEGATIVE: update with only id is refused with the exact message', () =>
  refused({ action: 'update', id: T1 }, /update needs at least one field to change besides id/));
await check('NEGATIVE: the update refinement survives planCall strict() (via the row schema directly)', () => {
  const row = spec.actions.get('update');
  assert.strictEqual(row.fields.strict().safeParse({ id: T1 }).success, false);
  assert.strictEqual(row.fields.strict().safeParse({ id: T1, notes: null }).success, true);
});
await check('NEGATIVE: update with an unknown field is refused', () => refused({ action: 'update', id: T1, bogus: 1 }, /bogus/));
await check('NEGATIVE: update_batch with 51 items names updates', () =>
  refused({ action: 'update_batch', updates: Array.from({ length: 51 }, () => ({ id: T1, fields: { notes: 'n' } })) }, /updates/));
await check('NEGATIVE: update_batch with no items, a bad id or an unknown item field is refused', async () => {
  await refused({ action: 'update_batch', updates: [] }, /updates/);
  await refused({ action: 'update_batch', updates: [{ id: 'nope', fields: {} }] }, /updates/);
  await refused({ action: 'update_batch', updates: [{ id: T1, fields: { bogus: 1 } }] }, /updates/);
});
await check('NEGATIVE: fractional cents on create name amount', () =>
  refused({ action: 'create', account: A, date: '2026-11-13', amount: 12.5 }, /amount/));
await check('NEGATIVE: fractional or non-positive transfer amount names amount', async () => {
  await refused({ action: 'transfer', from_account: A, to_account: B, amount: 12.5, date: '2026-11-13' }, /amount/);
  await refused({ action: 'transfer', from_account: A, to_account: B, amount: -5, date: '2026-11-13' }, /amount.*positive/);
  await refused({ action: 'transfer', from_account: A, to_account: B, amount: 0, date: '2026-11-13' }, /amount.*positive/);
});
await check('NEGATIVE: transfer without amount or date names them', async () => {
  await refused({ action: 'transfer', from_account: A, to_account: B, date: '2026-11-13' }, /amount.*required for action: transfer/);
  await refused({ action: 'transfer', from_account: A, to_account: B, amount: 5 }, /date.*required for action: transfer/);
  await refused({ action: 'transfer', to_account: B, amount: 5, date: '2026-11-13' }, /from_account/);
});
await check('NEGATIVE: null is refused on create and transfer (only update clears)', async () => {
  await refused({ action: 'create', account: A, date: '2026-11-13', amount: 1, category: null }, /category.*only valid for action: update/);
  await refused({ action: 'transfer', from_account: A, to_account: B, amount: 5, date: '2026-11-13', notes: null }, /notes.*only valid for action: update/);
});
await check('NEGATIVE: a malformed date or id is refused', async () => {
  await refused({ action: 'create', account: A, date: '2026/11/13', amount: 1 }, /date/);
  await refused({ action: 'delete', id: 'not-a-uuid' }, /id/);
  await refused({ action: 'create', account: 'x', date: '2026-11-13', amount: 1 }, /account/);
  await refused({ action: 'create', account: A, date: '2026-11-13', amount: 1, payee: 'not-a-uuid' }, /payee/);
});
await check('NEGATIVE: import with no rows, a row without amount, or a bad account is refused', async () => {
  await refused({ action: 'import', account_id: A, txs: [] }, /txs/);
  await refused({ action: 'import', account_id: A, txs: [{ date: '2026-11-13' }] }, /txs/);
  await refused({ action: 'import', account_id: 'x', txs: [{ date: '2026-11-13', amount: 1 }] }, /account_id/);
  await refused({ action: 'import', txs: [{ date: '2026-11-13', amount: 1 }] }, /account_id.*required for action: import/);
  await refused({ action: 'import', accountId: A, txs: [{ date: '2026-11-13', amount: 1 }] }, /accountId/);
});
await check('NEGATIVE: merge with one id, three ids, or the same id twice names ids', async () => {
  await refused({ action: 'merge', ids: [T1] }, /ids/);
  await refused({ action: 'merge', ids: [T1, T2, T1] }, /ids/);
  await refused({ action: 'merge', ids: [T1, T1] }, /ids.*ids must be two DIFFERENT transaction ids/);
  await refused({ action: 'merge' }, /ids.*required for action: merge/);
});
await check('NEGATIVE: notes over 1000 characters are refused', () =>
  refused({ action: 'create', account: A, date: '2026-11-13', amount: 1, notes: 'x'.repeat(1001) }, /notes[^]*1000/));
await check('NEGATIVE: camelCase legacy keys are refused', () => refused({ action: 'import', accountId: A, txs: [{ date: '2026-11-13', amount: 1 }] }, /accountId/));

// ---- real legacy transfer tool behind callOperation ----

await check('same-account transfer RESOLVES with the legacy refusal value, unchanged', async () => {
  const original = adapter.createTransfer;
  adapter.createTransfer = async (p) => (p.from_account === p.to_account
    ? { success: false, error: 'from_account and to_account must be different accounts.' }
    : { success: true, from_id: null, to_id: null });
  try {
    const t = buildCompactTool(spec, { callOperation: async (n, a) => { assert.strictEqual(n, 'actual_transfers_create'); return transfersCreate.call(a); } }, phrases);
    const r = await t.call({ action: 'transfer', from_account: A, to_account: A, amount: 5000, date: '2026-11-13' });
    assert.deepStrictEqual(r, { result: { success: false, error: 'from_account and to_account must be different accounts.' } });
  } finally { adapter.createTransfer = original; }
});

// ---- 4b rewrite, including result.error ----

await check('4b: an unknown account on create returns an error naming list_entities, never actual_accounts_list', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ success: false, error: 'Account X not found. Use actual_accounts_list to verify.', id: null }) }, phrases);
  const r = await t.call({ action: 'create', account: A, date: '2026-11-13', amount: 1 });
  assert.ok(r.error.includes('list_entities with type account') && !/actual_accounts_list/.test(r.error), r.error);
});
await check('4b: an unknown account on transfer is rewritten at result.error', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ result: { success: false, error: `Account 'X' not found. Use actual_accounts_list to find valid accounts.` } }) }, phrases);
  const r = await t.call({ action: 'transfer', from_account: A, to_account: B, amount: 5, date: '2026-11-13' });
  assert.ok(r.result.error.includes('list_entities with type account') && !/actual_accounts_list/.test(r.result.error), r.result.error);
  assert.strictEqual(r.result.success, false);
});
await check('4b: without the whole-registry table the name stays (proves the table is what rewrites)', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ error: 'Use actual_accounts_list' }) });
  const r = await t.call({ action: 'delete', id: T1 });
  assert.ok(/actual_accounts_list/.test(r.error));
});

// ---- read-only ----

await check('read-only: manage_transactions is not listed, and a valid delete is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_transactions'));
  assert.ok(manager.getPublishedToolNames().includes('search_transactions'));
  const legacy = manager.getTool('actual_transactions_delete');
  const original = legacy.call;
  let ran = 0;
  legacy.call = async () => { ran++; return { success: true }; };
  try {
    let e;
    try { await manager.callTool('manage_transactions', { action: 'delete', id: T1 }); } catch (x) { e = x; }
    assert.ok(e instanceof ToolUnavailableError && e.setting === 'MCP_READ_ONLY', String(e));
    assert.strictEqual(ran, 0);
  } finally { legacy.call = original; }
});

// ---- published shape and metadata ----

await check('published schema: flat, action required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js.properties)), 'no oneOf or anyOf in any property (a nullable key publishes type [T, null])');
  assert.deepStrictEqual(js.required, ['action']);
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'update_batch', 'delete', 'import', 'merge', 'transfer']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, destructive actions, siblings, no legacy name', () => {
  for (const w of ['Returns', 'search_transactions', 'list_entities', 'create:', 'update:', 'update_batch:', 'delete:', 'import:', 'merge:', 'transfer:', 'NOT atomic', 'DESTRUCTIVE', '50']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: destructive write tool, hints only', () => {
  assert.deepStrictEqual(annotationsFor('manage_transactions'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
});
await check('compactLegacyNames covers the seven targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), [
    'actual_transactions_create', 'actual_transactions_delete', 'actual_transactions_import', 'actual_transactions_merge',
    'actual_transactions_update', 'actual_transactions_update_batch', 'actual_transfers_create',
  ]);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-transactions] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
