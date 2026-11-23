// #690: a grantee can identify a locked file without opening it or revealing it to anyone else.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'discovery-encrypted-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const key = randomUUID();
const origin = 'https://actual.example.test';
Object.assign(process.env, {
  ACTUAL_SERVER_URL: 'https://user:' + randomUUID() + '@actual.example.test/private?test=1',
  ACTUAL_BUDGET_SYNC_ID: 'default', ACTUAL_PASSWORD: 'fixture', MCP_BRIDGE_DATA_DIR: dir,
  BUDGET_1_NAME: 'Keyed', BUDGET_1_SYNC_ID: 'keyed', BUDGET_1_ENCRYPTION_PASSWORD: key,
  BUDGET_2_NAME: 'First', BUDGET_2_SYNC_ID: 'static', BUDGET_2_SERVER_URL: 'https://first.example.test/private',
  BUDGET_3_NAME: 'Second', BUDGET_3_SYNC_ID: 'static', BUDGET_3_SERVER_URL: 'https://second.example.test',
  BUDGET_4_NAME: 'Copy', BUDGET_4_SYNC_ID: 'keyed', USE_CONNECTION_POOL: 'false',
  AUTH_PROVIDER: 'oidc', AUTH_BUDGET_ACL_SOURCE: 'actual', AUTH_BUDGET_DISCOVERY: 'true',
});
const api = (await import('@actual-app/api')).default;
const keyId = randomUUID();
api.getBudgets = async () => [{ groupId: 'keyed', encryptKeyId: keyId },
  { groupId: 'locked', encryptKeyId: keyId }, { groupId: 'ungranted', encryptKeyId: keyId }];
const adapter = await import('../../dist/src/lib/actual-adapter.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const { categorizeError } = await import('../../dist/src/lib/processHandlers.js');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const { getPreferredBudgetSyncId } = await import('../../dist/src/lib/budget-preference-store.js');
const { default: logger } = await import('../../dist/src/logger.js');
const { default: config } = await import('../../dist/src/config.js');
const { default: updateNote } = await import('../../dist/src/tools/notes_update.js');
const { default: createTransaction } = await import('../../dist/src/tools/transactions_create.js');
const { default: listAvailable } = await import('../../dist/src/tools/budgets_list_available.js');
const { default: switchTool } = await import('../../dist/src/tools/budgets_switch.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');
const downloads = [];
globalThis.fetch = async () => Response.json({ status: 'ok', data: { token: 'fixture' } });
api.init = async () => ({ send: async () => {} });
api.downloadBudget = async (...args) => { downloads.push(args); };
api.getBudgetMonths = async () => [];
api.getServerVersion = async () => ({ version: '26.11.0' });
api.sync = api.shutdown = async () => {};

const remedy = 'An operator can add or complete a BUDGET_n_* entry with this Sync ID and BUDGET_n_ENCRYPTION_PASSWORD, if every user the file is shared with may read it through this server.';
const hint = 'End-to-end encrypted and this server has no key for it. ' + remedy;
function message(id, count = 1) {
  const base = `Budget ${id} is end-to-end encrypted and this server has no key for it. ${remedy} Nothing was opened.`;
  return count === 1 ? base : base + ` ${count - 1} more locked budgets are listed by actual_budgets_list_available.`;
}
const file = (syncId, name, encrypted = true) => ({ syncId, name, encrypted });
const locked = file('locked', 'Locked file'), plain = file('plain', 'Private', false);
const other = file('other', 'Other');
function run(files, fn, { allowedBudgets = files.map(f => f.syncId), sessionId = randomUUID() } = {}) {
  return requestContext.run({ principal: sessionId, sessionId, transport: 'stdio', allowedBudgets, discoveredBudgets: files }, fn);
}
function lockedError(id, count = 1) {
  return err => isPreflightRefusal(err) && err.name === 'LockedRefusal' &&
    err.refusalKind === 'locked' && err.message === message(id, count);
}
function lockedRow(syncId, name, serverUrl = origin) {
  return { syncId, name, serverUrl, hasEncryption: true, locked: true, hint };
}
async function notFound(selector) {
  let result;
  await assert.rejects(adapter.switchBudget(selector), err => {
    result = [err.refusalKind, err.message];
    return isPreflightRefusal(err) && err.refusalKind === 'not-found';
  });
  return result;
}

test('list usable rows unchanged, then locked rows in discovery order with safe origins and first configured names', async () => {
  const files = [file('static', 'Remote'), locked, plain, file('keyed', 'Remote keyed')];
  await run(files, async () => {
    assert.deepEqual((await listAvailable.call({})).budgets, [
      { name: 'Keyed', syncId: 'keyed', serverUrl: origin, hasEncryption: true, active: true },
      { name: 'Private', syncId: 'plain', serverUrl: origin, hasEncryption: false },
      lockedRow('static', 'First', 'https://first.example.test'), lockedRow('locked', 'Locked file'),
    ]);
    await assert.rejects(adapter.switchBudget('first'), lockedError('static'));
    assert.deepEqual(await notFound('Second'), await notFound('unused'));
  });
});

test('refuse a granted ID or unique name before any download or preference change', async () => {
  await run([locked], async () => {
    for (const selector of ['locked', 'LOCKED FILE']) await assert.rejects(adapter.switchBudget(selector), lockedError('locked'));
    assert.equal(getPreferredBudgetSyncId(requestContext.getStore().principal), undefined);
  });
  assert.equal(downloads.length, 0);
});

test('two locked files with one name are ambiguous, not absent: the refusal lists both Sync IDs', async () => {
  const twins = [file('locked-a', 'Twin'), file('locked-b', 'Twin'), plain];
  await run(twins, async () => {
    await assert.rejects(adapter.switchBudget('twin'), err => isPreflightRefusal(err) &&
      err.refusalKind === 'out-of-range' && err.message === 'Ambiguous budget name. Switch by Sync ID: locked-a, locked-b.');
    await assert.rejects(adapter.switchBudget('locked-b'), lockedError('locked-b'));
  });
  assert.equal(downloads.length, 0);
});

test('an ungranted encrypted file is indistinguishable from an absent one', async () => {
  const visible = await run([plain], adapter.getBudgetRegistry);
  await run([locked, plain], async () => {
    assert.deepEqual(adapter.getBudgetRegistry(), visible);
    assert.deepEqual(await notFound('locked'), await notFound('unused'));
  }, { allowedBudgets: ['plain'] });
});

test('all locked: first file and count, with the existing enforcement audit', async t => {
  const warnings = t.mock.method(logger, 'warn', () => {});
  await run([other, locked], async () => {
    await assert.rejects(adapter.getAccounts(), lockedError('other', 2));
    assert.ok(warnings.mock.calls.some(c => String(c.arguments[0]).includes('"event":"acl_denied"')));
  });
  assert.equal(downloads.length, 0);
});

test('a transaction write keeps its structured refusal result and a note write is refused when every grant is locked (#757)', async () => {
  await run([locked], async () => {
    assert.deepEqual(await createTransaction.call({ account: randomUUID(), date: '2026-11-20', amount: 1 }),
      { success: false, error: message('locked'), id: null });
    // #757: the note tool no longer converts a refusal into an { error } result; it propagates.
    await assert.rejects(updateNote.call({ id: 'budget-2026-11', note: '' }), lockedError('locked'));
  });
  assert.equal(downloads.length, 0);
});

test('a locked pin takes priority with or without another usable file; its revocation remains private', async () => {
  const sessionId = randomUUID();
  await run([{ ...locked, encrypted: false }], () => adapter.pinSessionBudget(sessionId, adapter.initialBudgetForSession(sessionId)), { sessionId });
  for (const files of [[other, locked], [locked, plain]]) {
    await run(files, () => assert.rejects(adapter.getAccounts(), lockedError('locked')), { sessionId });
  }
  await run([locked, plain], () => assert.rejects(adapter.getAccounts(), { name: 'Error', message: /^Budget ACL:/ }),
    { sessionId, allowedBudgets: ['plain'] });
  await run([file('default', 'Default'), plain], () => assert.rejects(adapter.getAccounts(), { name: 'Error', message: /^Budget ACL:/ }));
});

test('compact listing and switch use the same locked row and typed refusal', async () => {
  const tools = new Map([listAvailable, switchTool].map(tool => [tool.name, tool]));
  const ops = { callOperation: (name, args) => tools.get(name).call(args) };
  const compact = name => buildCompactTool(COMPACT_TOOLS.find(t => t.name === name), ops, legacyPhrases(COMPACT_TOOLS));
  await run([locked], async () => {
    assert.deepEqual((await compact('list_entities').call({ type: 'budget_file', scope: 'configured' })).budgets, [lockedRow('locked', 'Locked file')]);
    await assert.rejects(compact('manage_budget_files').call({ action: 'switch', budget_name: 'locked' }), lockedError('locked'));
  });
});

test('locked refusals are logged as authorization failures', () => {
  assert.equal(categorizeError({ refusalKind: 'locked' }), 'auth');
});

test('discovery off keeps the static listing and refusal text', async () => {
  config.AUTH_BUDGET_DISCOVERY = false;
  try {
    await run([locked, file('keyed', 'Remote')], async () => {
      assert.deepEqual(adapter.getBudgetRegistry(), [
        { name: 'Keyed', syncId: 'keyed', serverUrl: origin, hasEncryption: true, active: true },
        { name: 'Copy', syncId: 'keyed', serverUrl: origin, hasEncryption: false },
      ]);
      await assert.rejects(adapter.switchBudget('locked'), { name: 'Error', message:
        'Budget "locked" not found in configuration. Available budgets: "Keyed", "Copy". Add BUDGET_n_NAME/SYNC_ID/SERVER_URL vars to configure additional budgets.' });
    });
  } finally { config.AUTH_BUDGET_DISCOVERY = true; }
});

test('a keyed static entry still opens with its configured encryption password', async () => {
  await run([file('keyed', 'Remote'), locked], async () => {
    assert.equal((await adapter.switchBudget('Keyed')).syncId, 'keyed');
    await adapter.withActualApi(async () => 'read');
    assert.deepEqual(downloads, [['keyed', { password: key }]]);
    assert.deepEqual(await adapter.getBudgets(), [
      { groupId: 'keyed', hasEncryption: true }, { groupId: 'locked', hasEncryption: true },
    ]);
  });
});

// #787: the active marker in discovery mode. requestBudgets() builds new row objects per call, so
// the match is on syncId and name, never object identity.
test('discovery: a shared file the session switched to carries active: true, and no other row does', async () => {
  await run([plain, other], async () => {
    await adapter.switchBudget('plain');
    const rows = adapter.getBudgetRegistry();
    assert.deepEqual(rows.filter(r => r.active).map(r => r.syncId), ['plain']);
    assert.equal(rows.filter(r => 'active' in r).length, 1);
  });
});

test('discovery: a locked row is never flagged', async () => {
  await run([locked, other], async () => {
    const rows = adapter.getBudgetRegistry();
    assert.ok(rows.some(r => r.locked));
    assert.deepEqual(rows.filter(r => r.locked && 'active' in r), []);
  });
});

test('discovery: an active budget that cannot be resolved gives no flag and no error', async () => {
  const sessionId = randomUUID();
  await run([plain], () => adapter.switchBudget('plain'), { sessionId });
  await run([other], async () => {
    let rows;
    assert.doesNotThrow(() => { rows = adapter.getBudgetRegistry(); });
    assert.deepEqual(rows.filter(r => 'active' in r), []);
  }, { sessionId });
});
