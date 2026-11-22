// Run after acl-e2e-verify.mjs so its disjoint, single-file fixtures stay intact.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const fx = JSON.parse(await readFile(process.argv[2], 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'acl-discovery-'));
Object.assign(process.env, {
  ACTUAL_SERVER_URL: fx.actualUrl, ACTUAL_PASSWORD: fx.password, ACTUAL_BUDGET_SYNC_ID: fx.syncIds.alice,
  MCP_BRIDGE_DATA_DIR: dir, AUTH_PROVIDER: 'oidc', AUTH_BUDGET_ACL_SOURCE: 'actual',
  AUTH_BUDGET_DISCOVERY: 'true', OIDC_ISSUER: fx.idpUrl + '/default',
  OIDC_RESOURCE: 'http://127.0.0.1/http', OIDC_ACCEPTED_AUDIENCES: fx.audience,
  MCP_TOOL_SURFACE: 'compact',
});

const clients = [];
const errors = [];
let server;
let token;
const fixtureFileIds = new Set();

async function admin(method, path, body) {
  const response = await fetch(fx.actualUrl + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-ACTUAL-TOKEN': token },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, method + ' ' + path.split('?')[0] + ' returned ' + response.status);
  return response;
}

async function cleanup(action) {
  try { await action(); } catch (err) { errors.push(err); }
}

try {
  const login = await fetch(fx.actualUrl + '/account/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginMethod: 'password', password: fx.password }),
  });
  assert.ok(login.ok);
  token = (await login.json()).data.token;
  const api = (await import('@actual-app/api')).default;
  const sdk = await api.init({ dataDir: dir, serverURL: fx.actualUrl, password: fx.password });
  const zip = fileURLToPath(new URL('../tests/fixtures/budgets/2026-01-08-Test Budget.zip', import.meta.url));
  async function importFixture() {
    const { id } = await api.importBudget(zip, { type: 'actual' });
    const file = (await api.getBudgets()).find(row => row.id === id);
    assert.ok(file?.cloudFileId && file.groupId && !Object.values(fx.files).includes(file.cloudFileId));
    assert.ok(!fixtureFileIds.has(file.cloudFileId));
    fixtureFileIds.add(file.cloudFileId);
    return file;
  }
  let household, lockedFile;
  try {
    household = await importFixture();
    const imported = await importFixture();
    await api.loadBudget(imported.id);
    const result = await sdk.send('key-make', { password: randomBytes(32).toString('hex') });
    assert.ok(!result?.error);
    lockedFile = (await api.getBudgets()).find(row => row.cloudFileId === imported.cloudFileId);
    assert.ok(lockedFile?.groupId && lockedFile.encryptKeyId);
  } finally {
    await api.shutdown();
  }
  await admin('POST', '/sync/update-user-filename', { fileId: household.cloudFileId, name: 'Household' });

  const { startHttpServer } = await import('../dist/src/server/httpServer.js');
  const { ActualMCPConnection } = await import('../dist/src/lib/ActualMCPConnection.js');
  const { _resetDynamicAclCache: refresh } = await import('../dist/src/auth/budget-acl-dynamic.js');
  const { default: toolManager } = await import('../dist/src/actualToolsManager.js');
  await toolManager.initialize();
  const tools = toolManager.getPublishedToolNames();
  server = await startHttpServer(new ActualMCPConnection(), 0, '/http', { tools: {}, resources: {}, prompts: {} }, tools,
    'discovery fixture', '', {}, 'test', '127.0.0.1');
  if (!server.listener.listening) await once(server.listener, 'listening');
  const url = new URL('http://127.0.0.1:' + server.listener.address().port + '/http');
  async function connect(user) {
    const res = await fetch(fx.idpUrl + '/default/token', { method: 'POST', body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: 'acl-e2e', client_secret: 'x', scope: 'user-' + user,
    }) });
    assert.ok(res.ok);
    const { access_token } = await res.json();
    const client = new Client({ name: 'discovery-fixture', version: '1' });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer ' + access_token } },
    });
    try { await client.connect(transport); } catch (err) {
      await client.close();
      throw err;
    }
    clients.push({ client, transport });
    return client;
  }
  async function disconnect(client) {
    const index = clients.findIndex(entry => entry.client === client);
    await clients[index].transport.terminateSession();
    await client.close();
    clients.splice(index, 1);
  }
  const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
  const read = client => call(client, 'list_entities', { type: 'account' });
  async function hasBobAccount(client) {
    const response = await read(client);
    assert.ok(!response.isError);
    const payload = JSON.parse(response.content[0].text);
    return (payload.result ?? payload).some(account => account.id === fx.bobAccountId);
  }
  async function switchTo(client, syncId) {
    return call(client, 'manage_budget_files', { action: 'switch', budget_name: syncId });
  }
  async function assertListing(client, expected) {
    const result = await call(client, 'list_entities', { type: 'budget_file' });
    assert.ok(!result.isError);
    const listing = JSON.parse(result.content[0].text);
    assert.deepEqual(listing.budgets.map(b => b.syncId).sort(), expected.slice().sort());
  }

  const alice = await connect('alice');
  const bob = await connect('bob');
  await assertListing(alice, [fx.syncIds.alice]);
  await assertListing(bob, [fx.syncIds.bob]);
  assert.ok(await hasBobAccount(bob));
  await assert.rejects(switchTo(bob, fx.syncIds.alice), /Budget not found/);

  for (const userId of [fx.users.alice, fx.users.bob]) {
    await admin('POST', '/admin/access', { fileId: household.cloudFileId, userId });
  }
  refresh();
  assert.ok(await hasBobAccount(bob)); // A new share cannot change the pinned private budget.
  for (const [client, privateId] of [[alice, fx.syncIds.alice], [bob, fx.syncIds.bob]]) {
    await assertListing(client, [privateId, household.groupId]);
    assert.ok(!(await switchTo(client, household.groupId)).isError);
    assert.equal(await hasBobAccount(client), false);
  }
  const accountName = 'Household queued write fixture';
  assert.ok(!(await call(bob, 'manage_accounts', { action: 'create', entity: 'account', name: accountName })).isError);
  assert.ok(JSON.stringify((await read(alice)).content).includes(accountName));
  await admin('DELETE', '/admin/access?fileId=' + encodeURIComponent(household.cloudFileId), { ids: [fx.users.bob] });
  refresh();
  await assertListing(bob, [fx.syncIds.bob]);
  await assert.rejects(read(bob), /Budget ACL/);
  assert.ok(!(await read(alice)).isError);
  assert.ok(!(await switchTo(bob, fx.syncIds.bob)).isError);
  const privateAccounts = await read(bob);
  assert.ok(!privateAccounts.isError);
  assert.ok(!JSON.stringify(privateAccounts.content).includes(accountName));
  assert.ok(!(await switchTo(alice, fx.syncIds.alice)).isError);
  const defaultAccounts = await read(alice);
  assert.ok(!defaultAccounts.isError);
  assert.ok(!JSON.stringify(defaultAccounts.content).includes(accountName));
  await disconnect(bob);
  await admin('DELETE', '/admin/access?fileId=' + encodeURIComponent(fx.files.bob), { ids: [fx.users.bob] });
  const downloadBudget = api.downloadBudget;
  let lockedDownloads = 0;
  try {
    await admin('POST', '/admin/access', { fileId: lockedFile.cloudFileId, userId: fx.users.bob });
    const response = await admin('GET', '/sync/list-user-files');
    const row = (await response.json()).data.find(file => file.groupId === lockedFile.groupId);
    assert.ok(row?.encryptKeyId, 'Actual must report encryption on the uploaded fixture');
    const grantees = row.usersWithAccess.map(user => user.userName);
    assert.ok(grantees.includes(fx.actualUserNames.bob));
    assert.ok(!grantees.includes(fx.actualUserNames.alice));
    api.downloadBudget = async (...args) => {
      if (args[0] === lockedFile.groupId) lockedDownloads++;
      return downloadBudget(...args);
    };
    refresh();
    const lockedBob = await connect('bob');
    const listing = await call(lockedBob, 'list_entities', { type: 'budget_file' });
    assert.ok(!listing.isError);
    const { budgets } = JSON.parse(listing.content[0].text);
    assert.deepEqual(budgets.map(row => row.syncId), [lockedFile.groupId]);
    assert.equal(budgets[0].hasEncryption, true);
    assert.equal(budgets[0].locked, true);
    const remedy = 'An operator can add or complete a BUDGET_n_* entry with this Sync ID and BUDGET_n_ENCRYPTION_PASSWORD, if every user the file is shared with may read it through this server.';
    assert.equal(budgets[0].hint, 'End-to-end encrypted and this server has no key for it. ' + remedy);
    const refusal = `Budget ${lockedFile.groupId} is end-to-end encrypted and this server has no key for it. ${remedy} Nothing was opened.`;
    await assert.rejects(switchTo(lockedBob, lockedFile.groupId), err => err.message.includes(refusal));
    await assert.rejects(read(lockedBob), err => err.message.includes(refusal));
    await assertListing(alice, [fx.syncIds.alice, household.groupId]);
    await assert.rejects(switchTo(alice, lockedFile.groupId), /Budget not found/);
    assert.equal(lockedDownloads, 0, 'initialize, list, switch and read must never download the locked file');
    await disconnect(lockedBob);
    await admin('DELETE', '/admin/access?fileId=' + encodeURIComponent(lockedFile.cloudFileId), { ids: [fx.users.bob] });
    refresh();
    await assert.rejects(connect('bob'), { code: 403, message: /Forbidden: no budget access configured for this user/ });
  } finally {
    api.downloadBudget = downloadBudget;
    await admin('POST', '/admin/access', { fileId: fx.files.bob, userId: fx.users.bob });
  }
} catch (err) {
  errors.push(err);
} finally {
  for (const { client, transport } of clients) {
    await cleanup(() => transport.terminateSession());
    await cleanup(() => client.close());
  }
  if (server) {
    await cleanup(() => server.cleanup());
    await cleanup(() => server.listener.close());
  }
  for (const fileId of fixtureFileIds) {
    await cleanup(async () => {
      const response = await admin('POST', '/sync/delete-user-file', { token, fileId });
      assert.equal((await response.json()).status, 'ok', 'Discovery fixture deletion failed');
    });
  }
  await cleanup(() => rm(dir, { recursive: true, force: true }));
}
if (errors.length) throw new AggregateError(errors, 'Household discovery or fixture cleanup failed');
process.stdout.write('Shared Household discovery and encrypted-file isolation passed through two OIDC MCP sessions\n');
