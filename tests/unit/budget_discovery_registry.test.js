// #688. The OIDC subject owns the session; Actual's userName determines its file list.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'discovery-registry-'));
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));
Object.assign(process.env, {
  MCP_BRIDGE_DATA_DIR: dataDir,
  ACTUAL_SERVER_URL: 'https://discovery.example.test', ACTUAL_PASSWORD: 'fixture',
  ACTUAL_BUDGET_SYNC_ID: 'configured', BUDGET_DEFAULT_NAME: 'Home',
  BUDGET_1_NAME: 'Original', BUDGET_1_SYNC_ID: 'copied', BUDGET_1_ENCRYPTION_PASSWORD: 'fixture-key',
  BUDGET_2_NAME: 'Archive', BUDGET_2_SYNC_ID: 'copied', BUDGET_2_SERVER_URL: 'https://archive.example.test',
  AUTH_BUDGET_DISCOVERY: 'true', AUTH_PROVIDER: 'oidc', AUTH_BUDGET_ACL_SOURCE: 'actual',
});
const { configSchema } = await import('../../dist/src/config.js');
for (const [provider, source] of [['none', 'actual'], ['oidc', 'static']]) {
  const result = configSchema.safeParse({ ...process.env, AUTH_PROVIDER: provider, AUTH_BUDGET_ACL_SOURCE: source });
  assert.ok(!result.success);
  assert.match(result.error.message, /AUTH_PROVIDER=oidc and AUTH_BUDGET_ACL_SOURCE=actual/);
}
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const adapter = await import('../../dist/src/lib/actual-adapter.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { resolveBudgetAccess, _resetDynamicAclCache } = await import('../../dist/src/auth/budget-acl-dynamic.js');
adapter._setSkipApiInitForTests(true);
function file(groupId, name, users, encryptKeyId = null) {
  return { groupId, name, usersWithAccess: users.map(userName => ({ userName })), encryptKeyId };
}
const shared = file('shared', 'Home', ['alice', 'bob']);
const rows = [shared, file('configured', 'remote name', ['alice']), file('locked', 'Locked', ['alice'], 'key'),
  file('private', '\u0000' + 'x'.repeat(110), ['bob'])];
const listing = 'listRemoteBudgetFiles' in adapter.default ? 'listRemoteBudgetFiles' : 'getBudgets';
adapter.default[listing] = async () => rows;
const ctx = async user => {
  const access = await resolveBudgetAccess(user);
  return { principal: 'opaque-sub-' + user, sessionId: 'session-' + user,
    discoveredBudgets: access.discoveredBudgets, allowedBudgets: access.allowed };
};
async function list(store) {
  return requestContext.run(store, () => adapter.getBudgetRegistry());
}
const alice = await ctx('alice');
const bob = await ctx('bob');
assert.deepEqual((await list(alice)).map(b => [b.syncId, b.name]), [['configured', 'Home'], ['shared', 'Home'], ['locked', 'Locked']]);
assert.deepEqual((await list(bob)).map(b => b.name), ['Home', 'x'.repeat(100)]);
assert.deepEqual(await list(await ctx('mallory')), []);
assert.deepEqual(await list(await ctx(null)), []);
assert.deepEqual(await list({ principal: bob.principal, allowedBudgets: ['private'] }), []);
assert.equal(requestContext.run(bob, () => adapter.initialBudgetForSession(bob.sessionId)).syncId, 'configured');
await assert.rejects(requestContext.run(bob, () => adapter.getAccounts()), /Budget ACL/);
// Two shared files with one name are told apart by Sync ID only.
rows.push(file('shared-2', 'Trip', ['alice']), file('shared-3', 'trip', ['alice']));
_resetDynamicAclCache();
await assert.rejects(requestContext.run(await ctx('alice'), () => adapter.switchBudget('Trip')),
  e => isPreflightRefusal(e) && /shared-2, shared-3/.test(e.message));
rows.splice(-2);
_resetDynamicAclCache();
await assert.rejects(requestContext.run(alice, () => adapter.switchBudget('locked')),
  e => isPreflightRefusal(e) && e.refusalKind === 'locked');
connectionPool.connections.set(bob.sessionId, {
  sessionId: bob.sessionId, serverUrl: process.env.ACTUAL_SERVER_URL, password: 'fixture',
  initialized: true, syncId: 'private', lastActivity: Date.now(),
});
await requestContext.run(bob, () => adapter.switchBudget('shared'));
assert.equal(adapter.resolveBatchBudget([{ requestStore: bob }]), 'shared');
const api = (await import('@actual-app/api')).default;
api.sync = async () => {};
adapter._setApiInitializedForTests(true);
const queuedBudget = store => requestContext.run(store, () =>
  adapter.withWriteSession(async () => adapter._getActiveBudgetConfigForTests().syncId));
assert.deepEqual(await Promise.all([queuedBudget(bob), queuedBudget(alice)]), ['shared', 'configured']);

shared.encryptKeyId = 'new-key';
_resetDynamicAclCache();
const encrypted = await ctx('bob');
await assert.rejects(requestContext.run(encrypted, () => adapter.getAccounts()), { refusalKind: 'locked', message: /^Budget shared / });
shared.encryptKeyId = null;
shared.usersWithAccess = [{ userName: 'alice' }];
_resetDynamicAclCache();
const revoked = await ctx('bob');
await assert.rejects(requestContext.run(revoked, () => adapter.getAccounts()), /Budget ACL/);
await assert.rejects(requestContext.run(revoked, () => adapter.switchBudget('shared')), isPreflightRefusal);
assert.deepEqual((await list(revoked)).map(b => b.syncId), ['private']);
assert.deepEqual((await list(await ctx('alice'))).map(b => b.syncId), ['configured', 'shared', 'locked']);
// A copied budget can keep its Sync ID on a second configured server.
const copied = file('copied', 'Original', ['carol']);
rows.push(copied);
const carol = await ctx('carol');
await requestContext.run(carol, async () => {
  await adapter.switchBudget('Archive');
  const activeServer = async () => adapter._getActiveBudgetConfigForTests().serverUrl;
  assert.equal(await adapter.withActualApi(activeServer), process.env.BUDGET_2_SERVER_URL);
  assert.equal(await adapter.withWriteSession(activeServer), process.env.BUDGET_2_SERVER_URL);
  await assert.rejects(adapter.switchBudget('copied'), error =>
    isPreflightRefusal(error) && /Original/.test(error.message) && /Archive/.test(error.message));
});
// A shared file named like a configured budget whose Sync ID is shared: the Sync ID cannot
// select the configured one, so its name must, and the file stays reachable by its own Sync ID.
rows.push(file('twin', 'Original', ['carol']));
_resetDynamicAclCache();
const twin = await ctx('carol');
await requestContext.run(twin, async () => {
  await adapter.switchBudget('Original');
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'copied');
  await adapter.switchBudget('twin');
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'twin');
});
rows.pop();
// A row whose Sync ID is not a string grants nothing and is never listed.
rows.push({ groupId: 123, name: 'Numeric', usersWithAccess: [{ userName: 'dave' }] });
_resetDynamicAclCache();
const dave = await resolveBudgetAccess('dave');
assert.deepEqual([dave.allowed, dave.discoveredBudgets], [[], []]);
rows.pop();
// The refusal text names the grammar in force: discovery accepts any name without control characters.
const { budgetSelectorRule, validBudgetSelector } = await import('../../dist/src/lib/budgetSelector.js');
assert.ok(validBudgetSelector('Casa (2026) & Co') && !validBudgetSelector('a\u0000b'));
assert.match(budgetSelectorRule('budgetName'), /control characters/);
const { default: switchTool } = await import('../../dist/src/tools/budgets_switch.js');
await assert.rejects(async () => switchTool.call({ budgetName: 'a\u0007b' }), /control characters/);
copied.encryptKeyId = 'new-key'; // Only Original has a configured key.
_resetDynamicAclCache();
const refreshed = await ctx('carol');
assert.deepEqual((await list(refreshed)).map(b => b.name), ['Original']);
copied.encryptKeyId = null;
// A configured name wins over a shared file of the same name, which keeps its Sync ID.
await requestContext.run({ ...alice, sessionId: 'session-alice-name' }, async () => {
  await adapter.switchBudget('Home');
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'configured');
});
// So does a configured name that a shared file carries as its Sync ID.
const lookalike = file('Home', 'Lookalike', ['alice']);
rows.push(lookalike);
_resetDynamicAclCache();
await requestContext.run({ ...(await ctx('alice')), sessionId: 'session-alice-id' }, async () => {
  await adapter.switchBudget('Home');
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'configured');
  await adapter.switchBudget('Lookalike');
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'Home');
});
lookalike.encryptKeyId = 'key';
_resetDynamicAclCache();
await requestContext.run(await ctx('alice'), async () => {
  assert.equal((await adapter.switchBudget('Home')).syncId, 'configured');
  await assert.rejects(adapter.switchBudget('Lookalike'), { refusalKind: 'locked', message: /^Budget Home / });
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'configured');
});
rows.pop();
_resetDynamicAclCache();
// A fresh session starts on the saved budget, or on the first usable one when the saved budget
// turned encrypted with no configured key; a user left with no usable budget is refused.
const { setPreferredBudgetSyncId } = await import('../../dist/src/lib/budget-preference-store.js');
const home = rows.find(row => row.groupId === 'configured');
home.usersWithAccess.push({ userName: 'erin' }, { userName: 'frank' }, { userName: 'gina' });
copied.usersWithAccess.push({ userName: 'erin' }, { userName: 'gina' });
let fresh = 0;
const starts = async user => {
  _resetDynamicAclCache();
  const store = { ...(await ctx(user)), sessionId: 'session-fresh-' + fresh++ };
  return requestContext.run(store, () => adapter._getActiveBudgetConfigForTests().name);
};
setPreferredBudgetSyncId('opaque-sub-erin', 'copied');
assert.equal(await starts('erin'), 'Original');
setPreferredBudgetSyncId('opaque-sub-erin', 'configured');
assert.equal(await starts('erin'), 'Home');
assert.equal(await starts('gina'), 'Home');
home.encryptKeyId = 'new-key';
assert.equal(await starts('erin'), 'Original');
assert.equal(await starts('gina'), 'Original');
_resetDynamicAclCache();
const frank = { ...(await ctx('frank')), sessionId: 'session-frank' };
assert.deepEqual((await list(frank)).map(b => [b.syncId, b.locked]), [['configured', true]]);
await assert.rejects(requestContext.run(frank, () => adapter.getAccounts()), { refusalKind: 'locked', message: /^Budget configured / });
// #690 decision 6: a locked configured Home and a usable shared Home are both visible.
await requestContext.run(await ctx('alice'), async () => {
  const homes = adapter.getBudgetRegistry().filter(budget => budget.name === 'Home');
  assert.deepEqual(homes.map(budget => [budget.syncId, budget.locked]), [['shared', undefined], ['configured', true]]);
  // The name is ambiguous: opening the share silently would let a sharer redirect a configured name.
  await assert.rejects(adapter.switchBudget('Home'), { refusalKind: 'out-of-range', message: 'Ambiguous budget name. Switch by Sync ID: shared, configured.' });
  assert.equal((await adapter.switchBudget('shared')).syncId, 'shared');
  await assert.rejects(adapter.switchBudget('configured'), { refusalKind: 'locked', message: /^Budget configured / });
  assert.equal(adapter._getActiveBudgetConfigForTests().syncId, 'shared');
});
home.encryptKeyId = null;
// The listing follows the allow-list of the request, not the file metadata alone.
assert.deepEqual(await list({ ...alice, allowedBudgets: [] }), []);
// Two rows with one Sync ID: only the row shared with the user names the budget.
rows.push(file('dup', 'Mine', ['hank']), file('dup', 'Not mine', ['alice']));
_resetDynamicAclCache();
assert.deepEqual((await resolveBudgetAccess('hank')).discoveredBudgets.map(b => b.name), ['Mine']);
rows.splice(-2);
// A file cannot grant the static ACL's "every budget" marker.
rows.push(file('*', 'Star', ['ivy']));
_resetDynamicAclCache();
const ivy = await resolveBudgetAccess('ivy');
assert.deepEqual([ivy.allowed, ivy.discoveredBudgets], [[], []]);
rows.pop();
_resetDynamicAclCache();
connectionPool.connections.delete(bob.sessionId);
process.stdout.write('Discovery registry, switching, encryption and revocation checks passed\n');
