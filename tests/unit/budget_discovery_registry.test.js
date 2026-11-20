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
assert.deepEqual((await list(alice)).map(b => [b.syncId, b.name]), [['configured', 'Home'], ['shared', 'Home']]);
assert.deepEqual((await list(bob)).map(b => b.name), ['Home', 'x'.repeat(100)]);
assert.deepEqual(await list(await ctx('mallory')), []);
assert.deepEqual(await list(await ctx(null)), []);
assert.deepEqual(await list({ principal: bob.principal, allowedBudgets: ['private'] }), []);
assert.equal(requestContext.run(bob, () => adapter.initialBudgetForSession(bob.sessionId)).syncId, 'configured');
await assert.rejects(requestContext.run(bob, () => adapter.getAccounts()), /Budget ACL/);
await assert.rejects(requestContext.run(alice, () => adapter.switchBudget('Home')),
  e => isPreflightRefusal(e) && /configured, shared/.test(e.message));
await assert.rejects(requestContext.run(alice, () => adapter.switchBudget('locked')), isPreflightRefusal);
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
await assert.rejects(requestContext.run(encrypted, () => adapter.getAccounts()), /Budget ACL/);
shared.encryptKeyId = null;
shared.usersWithAccess = [{ userName: 'alice' }];
_resetDynamicAclCache();
const revoked = await ctx('bob');
await assert.rejects(requestContext.run(revoked, () => adapter.getAccounts()), /Budget ACL/);
await assert.rejects(requestContext.run(revoked, () => adapter.switchBudget('shared')), isPreflightRefusal);
assert.deepEqual((await list(revoked)).map(b => b.syncId), ['private']);
assert.deepEqual((await list(await ctx('alice'))).map(b => b.syncId), ['configured', 'shared']);
connectionPool.connections.delete(bob.sessionId);
process.stdout.write('Discovery registry, switching, encryption and revocation checks passed\n');
