// #691: exercise the pinned SDK's login-only file listing with a local HTTP
// fixture. No budget has been opened when permissions are resolved.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverURL = 'https://actual.test';
const dataDir = await mkdtemp(join(tmpdir(), 'actual-list-files-'));
const originalFetch = globalThis.fetch;
const requests = [];
let unavailable = false;
const household = {
  fileId: 'household-file', groupId: 'household-sync', name: 'Household',
  deleted: 0, usersWithAccess: [{ userName: 'alice' }, { userName: 'bob' }],
};

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  assert.equal(url.origin, serverURL);
  const route = request.method + ' ' + url.pathname;
  requests.push(route);
  switch (route) {
    case 'POST /account/login':
      return Response.json({ status: 'ok', data: { token: 'synthetic-session' } });
    case 'GET /sync/list-user-files':
      assert.equal(request.headers.get('X-ACTUAL-TOKEN'), 'synthetic-session');
      if (unavailable) return new Response(null, { status: 503 });
      return Response.json({ status: 'ok', data: [
        household, { ...household, fileId: 'deleted-file', groupId: 'deleted-sync', deleted: 1 },
      ] });
    case 'POST /account/logout':
      return Response.json({ status: 'ok', data: {} });
    default:
      throw new Error('Unexpected fixture request: ' + route);
  }
};

try {
  const api = (await import('@actual-app/api')).default;
  await api.init({ dataDir, serverURL, password: 'fixture' });
  try {
    const files = await api.getBudgets();
    assert.deepEqual(files.map(file => file.groupId), [household.groupId]);
    assert.deepEqual(files[0].usersWithAccess, household.usersWithAccess);

    // A local Sync ID can survive a remote lookup failure. Only remote
    // membership is evidence that a principal may use the file.
    const localDir = join(dataDir, 'local-household');
    await mkdir(localDir);
    await writeFile(join(localDir, 'metadata.json'), JSON.stringify({
      budgetName: household.name, groupId: household.groupId, cloudFileId: household.fileId,
    }));
    unavailable = true;
    const cached = await api.getBudgets();
    assert.deepEqual(cached.map(file => file.groupId), [household.groupId]);
    assert.ok(cached.every(file => !file.usersWithAccess));
  } finally {
    await api.shutdown();
  }
  assert.deepEqual(requests, [
    'POST /account/login', 'GET /sync/list-user-files', 'GET /sync/list-user-files', 'POST /account/logout',
  ], 'listing on a fresh login must not download a budget');
  process.stdout.write('Login-only SDK listing checks passed\n');
} finally {
  globalThis.fetch = originalFetch;
  await rm(dataDir, { recursive: true, force: true });
}
