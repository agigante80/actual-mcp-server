// #691. Drive both ACL consumers through the adapter without contacting Actual.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, {
  ACTUAL_SERVER_URL: 'https://acl.example.test/base/',
  ACTUAL_BUDGET_SYNC_ID: 'configured', ACTUAL_PASSWORD: 'fixture',
  ACTUAL_OP_TIMEOUT_MS: '120',
});
const config = (await import('../../dist/src/config.js')).default;
const api = (await import('@actual-app/api')).default;
let apiCalls = 0;
for (const method of ['init', 'shutdown', 'downloadBudget', 'getBudgets']) {
  api[method] = () => { apiCalls++; throw new Error('Unexpected SDK call'); };
}
const { default: adapter } = await import('../../dist/src/lib/actual-adapter.js');
const { resolveAllowedBudgetsFromActual: resolve, runAclPreflight, _resetDynamicAclCache } =
  await import('../../dist/src/auth/budget-acl-dynamic.js');
const state = await import('../../dist/src/lib/apiState.js');
const otherLogin = { serverUrl: 'https://other.example.test', password: 'other' };
state.setApiLogin(otherLogin);
state.setLoadedBudgetSyncId('other-open-budget');

const ok = data => Response.json({ status: 'ok', data });
const files = [
  { groupId: 'a', usersWithAccess: [{ userName: 'alice' }] },
  { groupId: 'h', usersWithAccess: [{ userName: 'alice' }, { userName: 'bob' }] },
  { groupId: 'old', deleted: 1, usersWithAccess: [{ userName: 'alice' }] },
];
let loginCount = 0, listCount = 0;
let loginResponse = () => ok({ token: 'fixture-token' });
let listResponse = () => ok(files);
let lastSignal;
const unexpectedUrls = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  assert.equal(init.redirect, 'manual');
  if (url === 'https://acl.example.test/base/account/login') {
    loginCount++;
    return loginResponse();
  }
  if (url !== 'https://acl.example.test/base/sync/list-user-files') {
    unexpectedUrls.push(url);
    throw new Error('Unexpected URL');
  }
  assert.equal(new Headers(init.headers).get('x-actual-token'), 'fixture-token');
  lastSignal = init.signal;
  listCount++;
  return listResponse();
};

assert.deepEqual(await resolve(null), []);
assert.equal(loginCount + listCount, 0);
assert.deepEqual(await Promise.all([resolve('alice'), resolve('bob')]), [['a', 'h'], ['h']]);
assert.deepEqual([loginCount, listCount], [1, 1]);
await runAclPreflight();
assert.deepEqual([loginCount, listCount], [1, 2]);
await resolve('third');
assert.deepEqual([loginCount, listCount], [1, 3]);

const now = Date.now;
try {
  Date.now = () => now() + 60_001;
  await adapter.listRemoteBudgetFiles();
  assert.deepEqual([loginCount, listCount], [2, 4]);
} finally {
  Date.now = now;
}

// A file without a Sync ID cannot grant access, but valid sibling rows still count.
listResponse = () => ok([...files, ...[{}, { groupId: null }].map(row => ({
  ...row, usersWithAccess: [{ userName: 'alice' }],
}))]);
_resetDynamicAclCache();
assert.deepEqual(await resolve('alice'), ['a', 'h']);

// On each failure, the next lookup for the same principal must log in and list again.
for (const failure of [
  () => { throw new Error('fixture network failure'); },
  // A valid body, so only the status check can refuse the redirect.
  () => Response.json({ status: 'ok', data: files }, { status: 302, headers: { Location: 'https://redirect.example.test' } }),
  () => new Response(null, { status: 500 }),
  () => Response.json({ status: 'error' }),
  () => Response.json({ status: 'ok', data: {} }),
  () => ok([...files, { groupId: 123, usersWithAccess: [{ userName: 'alice' }] }]),
  () => new Response('invalid-json'),
  () => new Promise(() => {}),
]) {
  _resetDynamicAclCache();
  listResponse = failure;
  assert.deepEqual(await resolve('alice'), []);
  assert.ok(lastSignal.aborted);
  const before = [loginCount, listCount];
  listResponse = () => ok(files);
  assert.deepEqual(await resolve('alice'), ['a', 'h']);
  assert.deepEqual([loginCount, listCount], [before[0] + 1, before[1] + 1]);
}
// The rejection names a reason from a fixed set, never the server's own text.
_resetDynamicAclCache();
for (const [failure, reason] of [
  [() => new Response('private body', { status: 404 }), /\(list-status-404\)$/],
  [() => Response.json({ status: 'ok', data: {} }), /\(invalid-file-list\)$/],
  [() => { throw new Error('private text'); }, /\(unknown\)$/],
  [() => new Promise(() => {}), /\(timeout\)$/],
]) {
  listResponse = failure;
  await assert.rejects(adapter.listRemoteBudgetFiles(), err => reason.test(err.message) && !/private/.test(err.message));
}
loginResponse = () => Response.json({ status: 'error', reason: 'private-reason-from-server' }, { status: 400 });
await assert.rejects(adapter.listRemoteBudgetFiles(), /\(unknown\)$/);
loginResponse = () => ok({ token: 'fixture-token' });
listResponse = () => new Response(null, { status: 401 });
await assert.rejects(adapter.listRemoteBudgetFiles());
for (const succeeds of [false, true]) {
  const before = [loginCount, listCount];
  listResponse = () => succeeds && listCount === before[1] + 2 ? ok(files) : new Response(null, { status: 401 });
  if (succeeds) assert.equal((await adapter.listRemoteBudgetFiles()).length, 2);
  else await assert.rejects(adapter.listRemoteBudgetFiles());
  assert.deepEqual([loginCount, listCount], [before[0] + 2, before[1] + 2]);
}
config.ACTUAL_PASSWORD = '';
const before = loginCount + listCount;
await assert.rejects(adapter.listRemoteBudgetFiles());
assert.equal(loginCount + listCount, before);
config.ACTUAL_PASSWORD = 'fixture';
loginResponse = () => ok({ returnUrl: '/openid' });
await assert.rejects(adapter.listRemoteBudgetFiles(), /\(openid-required\)$/);
assert.equal(loginCount + listCount, before + 1);
assert.deepEqual(unexpectedUrls, []);
assert.equal(apiCalls, 0);
assert.ok(state.isApiLoggedInTo(otherLogin));
assert.equal(state.getLoadedBudgetSyncId(), 'other-open-budget');
for (const dir of ['tools', 'compact']) {
  const root = fileURLToPath(new URL('../../src/' + dir, import.meta.url));
  for (const file of await readdir(root, { recursive: true })) {
    if (file.endsWith('.ts')) assert.doesNotMatch(await readFile(join(root, file), 'utf8'), /listRemoteBudgetFiles/);
  }
}
process.stdout.write('Remote ACL listing tests passed\n');
