// tests/unit/compact_manage_accounts.test.js
//
// #676: the compact manage_accounts tool. A stubbed callOperation records the exact legacy tool
// name and arguments every action produces, and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_manage_accounts.test.js   (needs `npm run build` first)

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
console.log('\n[compact-manage-accounts]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const spec = COMPACT_TOOLS.find((t) => t.name === 'manage_accounts');
assert.ok(spec, 'manage_accounts is registered');

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

await check('create account drops entity and forwards name and balance', () =>
  expectCall({ action: 'create', entity: 'account', name: 'Checking', balance: 10000 }, 'actual_accounts_create', { name: 'Checking', balance: 10000 }));
await check('create account_group routes to the group tool with sort_order', () =>
  expectCall({ action: 'create', entity: 'account_group', name: 'Savings', sort_order: 2 }, 'actual_account_groups_create', { name: 'Savings', sort_order: 2 }));
await check('update account wraps everything but id under fields and drops entity', () =>
  expectCall({ action: 'update', entity: 'account', id: U1, name: 'N', offbudget: true }, 'actual_accounts_update', { id: U1, fields: { name: 'N', offbudget: true } }));
await check('update account_group is flat', () =>
  expectCall({ action: 'update', entity: 'account_group', id: U1, name: 'G', sort_order: 1 }, 'actual_account_groups_update', { id: U1, name: 'G', sort_order: 1 }));
await check('close with entity omitted renames the transfer keys', () =>
  expectCall({ action: 'close', id: U1, transfer_account_id: U2, transfer_category_id: U3 }, 'actual_accounts_close', { id: U1, transferAccountId: U2, transferCategoryId: U3 }));
await check('close with entity account is accepted and entity is not forwarded', () =>
  expectCall({ action: 'close', entity: 'account', id: U1 }, 'actual_accounts_close', { id: U1 }));
await check('reopen forwards id', () => expectCall({ action: 'reopen', id: U1 }, 'actual_accounts_reopen', { id: U1 }));
await check('delete account and account_group route to their tools', async () => {
  await expectCall({ action: 'delete', entity: 'account', id: U1 }, 'actual_accounts_delete', { id: U1 });
  await expectCall({ action: 'delete', entity: 'account_group', id: U1 }, 'actual_account_groups_delete', { id: U1 });
});
await check('bank_sync renames account_id, and with no account_id forwards nothing', async () => {
  await expectCall({ action: 'bank_sync', account_id: U1 }, 'actual_bank_sync', { accountId: U1 });
  await expectCall({ action: 'bank_sync' }, 'actual_bank_sync', {});
});
await check('set_note forwards id and note, and "" is a valid clear', async () => {
  await expectCall({ action: 'set_note', id: U1, note: 'hello' }, 'actual_notes_update', { id: U1, note: 'hello' });
  await expectCall({ action: 'set_note', id: U1, note: '' }, 'actual_notes_update', { id: U1, note: '' });
});
await check('the legacy return value comes back unchanged', async () => {
  reply = () => ({ result: 'new-id' });
  assert.deepStrictEqual(await run({ action: 'create', entity: 'account', name: 'A' }), { result: 'new-id' });
  reply = (n) => ({ from: n });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: unknown action lists the seven values', () =>
  refused({ action: 'frobnicate' }, /action.*create.*update.*close.*reopen.*delete.*bank_sync.*set_note/));
await check('NEGATIVE: a missing selector is refused naming action', () => refused({}, /action/));
await check('NEGATIVE: create without entity or name names each', async () => {
  await refused({ action: 'create', name: 'A' }, /entity.*required for action: create/);
  await refused({ action: 'create', entity: 'account' }, /name.*required for action: create/);
  await refused({ action: 'create', entity: 'account_group' }, /name.*required for action: create/);
});
await check('NEGATIVE: balance with entity account_group is refused', () =>
  refused({ action: 'create', entity: 'account_group', name: 'G', balance: 5 }, /balance.*cannot be used with the other fields given for action: create/));
await check('NEGATIVE: sort_order with entity account is refused', () =>
  refused({ action: 'create', entity: 'account', name: 'A', sort_order: 1 }, /sort_order.*cannot be used with the other fields given for action: create/));
await check('NEGATIVE: an unknown entity is refused', () => refused({ action: 'create', entity: 'payee', name: 'A' }, /entity/));
await check('NEGATIVE: close with entity account_group names the rule', () =>
  refused({ action: 'close', entity: 'account_group', id: U1 }, /entity.*close accepts only account/));
await check('NEGATIVE: entity on reopen, bank_sync and set_note is refused', async () => {
  await refused({ action: 'reopen', entity: 'account', id: U1 }, /entity.*not valid for action: reopen/);
  await refused({ action: 'bank_sync', entity: 'account' }, /entity.*not valid for action: bank_sync/);
  await refused({ action: 'set_note', entity: 'account', id: U1, note: 'x' }, /entity.*not valid for action: set_note/);
});
await check('NEGATIVE: balance on close is refused', () =>
  refused({ action: 'close', id: U1, balance: 5 }, /balance.*not valid for action: close/));
await check('NEGATIVE: update without entity, id, or any change is refused', async () => {
  await refused({ action: 'update', id: U1, name: 'x' }, /entity.*required for action: update/);
  await refused({ action: 'update', entity: 'account', name: 'x' }, /id.*required for action: update/);
  await refused({ action: 'update', entity: 'account', id: U1 }, /update needs at least one of: name, offbudget, closed/);
  await refused({ action: 'update', entity: 'account_group', id: U1 }, /update needs at least one of: name, sort_order/);
});
await check('NEGATIVE: offbudget on an account_group update is refused', () =>
  refused({ action: 'update', entity: 'account_group', id: U1, offbudget: true }, /offbudget.*cannot be used with the other fields given for action: update/));
await check('NEGATIVE: close, reopen and delete without id name id', async () => {
  await refused({ action: 'close' }, /id.*required for action: close/);
  await refused({ action: 'reopen' }, /id.*required for action: reopen/);
  await refused({ action: 'delete', entity: 'account' }, /id.*required for action: delete/);
  await refused({ action: 'delete', id: U1 }, /entity.*required for action: delete/);
});
await check('NEGATIVE: set_note without id or note, and a budget month id, are refused', async () => {
  await refused({ action: 'set_note', note: 'x' }, /id.*required for action: set_note/);
  await refused({ action: 'set_note', id: U1 }, /note.*required for action: set_note/);
  await refused({ action: 'set_note', id: 'budget-2026-01', note: 'x' }, /id/);
});
await check('NEGATIVE: transfer_account_id equal to id is refused', () =>
  refused({ action: 'close', id: U1, transfer_account_id: U1 }, /transfer_account_id.*must be a different account than id/));
await check('NEGATIVE: malformed ids and values are refused', async () => {
  await refused({ action: 'reopen', id: 'nope' }, /id/);
  await refused({ action: 'close', id: U1, transfer_account_id: 'nope' }, /transfer_account_id/);
  await refused({ action: 'create', entity: 'account', name: 'A', balance: 1.5 }, /balance/);
  await refused({ action: 'create', entity: 'account', name: '' }, /name/);
  await refused({ action: 'bank_sync', account_id: 'nope' }, /account_id/);
});
await check('NEGATIVE: null is refused (write tool, nullAsAbsent is off)', () =>
  refused({ action: 'update', entity: 'account', id: U1, name: null }, /name/));
await check('NEGATIVE: camelCase legacy keys are refused', async () => {
  await refused({ action: 'bank_sync', accountId: U1 }, /accountId/);
  await refused({ action: 'close', id: U1, transferAccountId: U2 }, /transferAccountId/);
});

// ---- 4b rewrite ----

await check('4b: a legacy list name in a refusal is rewritten to list_entities', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ success: false, error: 'Account X not found. Use actual_accounts_list to verify.' }) }, phrases);
  const r = await t.call({ action: 'reopen', id: U1 });
  assert.ok(r.error.includes('list_entities with type account') && !/actual_accounts_list/.test(r.error), r.error);
});

// ---- read-only, published shape, metadata ----

await check('read-only: manage_accounts is not listed, and a valid call is refused with MCP_READ_ONLY and runs nothing', async () => {
  await manager.initialize({ toolsets: 'all', tools: '', readOnly: true, surface: 'compact' }, COMPACT_TOOLS);
  assert.ok(!manager.getPublishedToolNames().includes('manage_accounts'));
  const legacy = manager.getTool('actual_accounts_delete');
  const original = legacy.call;
  let ran = 0;
  legacy.call = async () => { ran++; return { success: true }; };
  try {
    let e;
    try { await manager.callTool('manage_accounts', { action: 'delete', entity: 'account', id: U1 }); } catch (x) { e = x; }
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
  assert.deepStrictEqual(js.properties.action.enum, ['create', 'update', 'close', 'reopen', 'delete', 'bank_sync', 'set_note']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'action') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
});
await check('description: Returns, every action, DESTRUCTIVE, no legacy name', () => {
  for (const w of ['Returns', 'list_entities', 'create:', 'update:', 'close:', 'reopen:', 'delete:', 'bank_sync:', 'set_note:', 'DESTRUCTIVE', 'account_group', 'REMOVED']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: destructive write tool, hints only', () => {
  assert.deepStrictEqual(annotationsFor('manage_accounts'), { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
});
await check('compactLegacyNames covers the targets, all write-capable', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), ['actual_account_groups_create','actual_account_groups_delete','actual_account_groups_update','actual_accounts_close','actual_accounts_create','actual_accounts_delete','actual_accounts_reopen','actual_accounts_update','actual_bank_sync','actual_notes_update']);
  for (const n of compactLegacyNames(spec)) assert.ok(WRITE_CAPABLE.has(n), n);
});

console.log(`\n[compact-manage-accounts] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
