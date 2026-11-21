// tests/unit/session_principal_cap.test.js  (#577)
//
// MAX_SESSIONS_PER_PRINCIPAL bounds each principal under MAX_CONCURRENT_SESSIONS, so one client
// that opens sessions without closing them cannot hold every slot. It is checked in the same
// synchronous call as #581's global reservation, after the global check.
//
// Drives the REAL initialize path in src/server/httpServer.ts in a CHILD process per mode (config
// and the pool read env once), with connectionPool.getConnection stubbed to take a while before it
// creates the entry, the way a real login does (the #581 harness).
//
// Modes and scenarios:
//   static  MAX_SESSIONS_PER_PRINCIPAL=2, MAX_CONCURRENT_SESSIONS=15, MCP_STATIC_TOKENS alice and bob
//           plus the legacy MCP_SSE_AUTHORIZATION token.
//     C-over      (negative) alice holds 2, bob 1: alice's third gets the per-principal 503, exact
//                 shape, nothing derived from bob; bob still gets in.
//     C-other     bob holds 2: alice gets in (another principal's sessions are not hers).
//     C-parallel  (negative) alice's 6 initializes in one tick admit exactly 2, 4 per-principal 503s,
//                 2 logins. Red when the per-principal check is removed.
//     C-unauth    (negative) no token: 401 and no admission recorded.
//     C-failed    alice holds 1 and a second initialize's login rejects: her next one is admitted.
//     C-delete    alice holds 2 and closes one with DELETE: her next one is admitted.
//     C-evict     alice holds 2 and one is evicted (shutdownConnection with evict, the idle path):
//                 her next one is admitted.
//     C-drop      (negative) alice holds 2 and one's pool entry is dropped WITHOUT evict (the
//                 switchBudget slow path): the session is alive, so her next one is refused.
//     C-legacy    the shared legacy token is exempt: a fourth session on it is admitted.
//     C-nokey     after alice closed every session, no admission names her.
//   global  MAX_CONCURRENT_SESSIONS=2, MAX_SESSIONS_PER_PRINCIPAL=5: the global cap binds first,
//           with #581's refusal, and the refused id records no admission.
//   unset   MAX_SESSIONS_PER_PRINCIPAL unset, MAX_CONCURRENT_SESSIONS=2: bob's refusal has exactly
//           the global shape #581 ships and no per-principal field. (The ticket's scenario says a
//           cap of 15; 2 reaches the same refusal with fewer sessions.)
//   open    MCP_ALLOW_UNAUTHENTICATED=true, no token, MAX_SESSIONS_PER_PRINCIPAL=2: a fourth session
//           is admitted (no principal, global cap only).
//   oidc    MAX_SESSIONS_PER_PRINCIPAL=2 under AUTH_PROVIDER=oidc: a subject that reads
//           "static-bearer" IS capped (the exemption follows how the request authenticated, not
//           the principal string), and another subject still gets in.
//
// Run: node tests/unit/session_principal_cap.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SENTINEL = '__PRINCIPAL_CAP_577__ ';
const ISSUER = 'https://idp.test';
const RESOURCE = 'https://actual-mcp.example.com/http';
const TOK_ALICE = 'alice-token-for-unit-test-577-aaaaaaaaaa';
const TOK_BOB = 'bob-token-for-unit-test-577-bbbbbbbbbbbbbb';
const TOK_LEGACY = 'legacy-token-for-unit-test-577-llllllllll';
const STATIC = JSON.stringify({
  alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] },
  bob: { tokenEnv: 'MCP_TOKEN_BOB', budgets: ['Beta'] },
});

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const childFor = (mode) => `
import { generateKeyPair, SignJWT, exportJWK } from 'jose';
const MODE = ${JSON.stringify(mode)};
const ISSUER = ${JSON.stringify(ISSUER)};
const RESOURCE = ${JSON.stringify(RESOURCE)};
const realFetch = globalThis.fetch;
let tokenFor = null;
const oidc = process.env.AUTH_PROVIDER === 'oidc';
if (oidc) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.alg = 'RS256'; jwk.kid = 'k1';
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (u.startsWith(ISSUER + '/')) {
      if (u.endsWith('/.well-known/openid-configuration')) {
        return Response.json({ issuer: ISSUER, jwks_uri: ISSUER + '/jwks', userinfo_endpoint: ISSUER + '/userinfo',
          authorization_endpoint: ISSUER + '/authorize', token_endpoint: ISSUER + '/token', response_types_supported: ['code'] });
      }
      if (u.endsWith('/jwks')) return Response.json({ keys: [jwk] });
      return new Response('not stubbed: ' + u, { status: 404 });
    }
    return realFetch(input, init);
  };
  tokenFor = (sub) => new SignJWT({ scope: 'openid', preferred_username: sub }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(RESOURCE).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}

const { connectionPool } = await import('./dist/src/lib/ActualConnectionPool.js');
let logins = 0;
let failNext = false;
let takeReleasedSlot = false;
const openTargets = [];
connectionPool.getConnection = async (sid, budget) => {
  openTargets.push(budget.syncId);
  logins++;
  await new Promise((res) => setTimeout(res, 150));
  if (failNext) {
    failNext = false;
    connectionPool.releaseReservation(sid);
    if (takeReleasedSlot) connectionPool.reserveSession('other-session');
    throw new Error('login refused (stub)');
  }
  // The real getConnection hands the reservation over to the entry in one synchronous block.
  connectionPool.connections.set(sid, {
    sessionId: sid, initialized: true, lastActivity: Date.now(),
    dataDir: '/nonexistent', serverUrl: budget.serverUrl, password: budget.password, syncId: budget.syncId,
  });
  connectionPool.releaseReservation(sid);
};
const adapterMod = await import('./dist/src/lib/actual-adapter.js');
adapterMod._setSkipApiInitForTests(true);
let discoveryIds = ['shared', 'private'];
if (MODE === 'discovery') {
  const adapter = adapterMod.default;
  const listing = 'listRemoteBudgetFiles' in adapter ? 'listRemoteBudgetFiles' : 'getBudgets';
  adapter[listing] = async () => discoveryIds.map(groupId => ({ groupId, name: groupId, encryptKeyId: groupId === 'alpha-sync' ? 'fixture-key-id' : null, usersWithAccess: [{ userName: 'sub-bob-577' }] }));
}
const { startHttpServer } = await import('./dist/src/server/httpServer.js');
const mcp = { executeTool: async () => ({ ok: true }) };
const { listener, cleanup } = await startHttpServer(mcp, 0, '/http', {}, ['actual_accounts_list'], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined);
if (!listener.listening) await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
const base = 'http://127.0.0.1:' + listener.address().port + '/http';

const T = oidc
  ? { alice: await tokenFor('static-bearer'), bob: await tokenFor('sub-bob-577') }
  : { alice: ${JSON.stringify(TOK_ALICE)}, bob: ${JSON.stringify(TOK_BOB)}, legacy: ${JSON.stringify(TOK_LEGACY)}, none: null };
const held = []; // { sid, who } of every admitted session, closed by reset()
const open = async (who) => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (T[who]) headers.Authorization = 'Bearer ' + T[who];
  const r = await realFetch(base, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cap-577', version: '0' } } }) });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  const sid = r.headers.get('mcp-session-id');
  if (r.status === 200 && sid) held.push({ sid, who });
  return { status: r.status, sid, body };
};
const close = async (sid) => {
  const h = held.find((x) => x.sid === sid);
  const headers = { 'mcp-session-id': sid };
  if (h && T[h.who]) headers.Authorization = 'Bearer ' + T[h.who];
  const r = await realFetch(base, { method: 'DELETE', headers });
  await r.text();
  held.splice(held.indexOf(h), 1);
  return r.status;
};
const reset = async () => { for (const h of [...held]) await close(h.sid); logins = 0; failNext = false; };
const admissions = () => [...connectionPool.admissions.values()];
const statuses = (rs) => rs.map((x) => x.status).sort();
const results = {};

if (MODE === 'static') {
  const { setPreferredBudgetSyncId } = await import('./dist/src/lib/budget-preference-store.js');
  setPreferredBudgetSyncId('bob', 'alpha-sync');
  await open('bob');
  results.restricted = openTargets.slice();
  await reset();
  await open('alice'); await open('alice'); await open('bob');
  const third = await open('alice');
  const bob = await open('bob');
  results.over = { third: third.status, body: third.body, bob: bob.status };

  await reset();
  await open('bob'); await open('bob');
  results.other = { alice: (await open('alice')).status };

  await reset();
  const par = await Promise.all(Array.from({ length: 6 }, () => open('alice')));
  results.parallel = { statuses: statuses(par), logins, refusals: par.filter((x) => x.status === 503).map((x) => x.body && x.body.error && x.body.error.data) };

  await reset();
  const before = admissions().length;
  const anon = await open('none');
  results.unauth = { status: anon.status, before, after: admissions().length };

  await reset();
  await open('alice');
  failNext = true;
  const bad = await open('alice');
  results.failed = { bad: bad.status, next: (await open('alice')).status, aliceCount: admissions().filter((p) => p === 'alice').length };

  await reset();
  const d1 = await open('alice'); await open('alice');
  const closed = await close(d1.sid);
  results.delete = { closed, next: (await open('alice')).status };

  await reset();
  const e1 = await open('alice'); await open('alice');
  await connectionPool.shutdownConnection(e1.sid, { evict: true });
  held.splice(held.findIndex((x) => x.sid === e1.sid), 1);
  results.evict = { next: (await open('alice')).status };

  await reset();
  const x1 = await open('alice'); await open('alice');
  await connectionPool.shutdownConnection(x1.sid);
  const dropped = await open('alice');
  results.drop = { next: dropped.status, scopeData: dropped.body && dropped.body.error && dropped.body.error.data };

  await reset();
  const legacy = [await open('legacy'), await open('legacy'), await open('legacy'), await open('legacy')];
  results.legacy = { statuses: legacy.map((x) => x.status), admissions: admissions().length };

  await reset();
  await open('alice'); await open('alice');
  await reset();
  results.nokey = { admissions: admissions() };
}

if (MODE === 'global') {
  await open('alice'); await open('bob');
  const refused = await open('alice');
  results.global = { status: refused.status, body: refused.body, admissions: admissions().sort(), held: held.length };
  await reset();
  await open('alice'); await open('alice');
  await reset();
  await open('bob'); await open('bob');
  const nokey = await open('alice');
  results.nokey = { status: nokey.status, admissions: admissions() };
}

if (MODE === 'unset') {
  await open('alice'); await open('alice');
  const bob = await open('bob');
  results.unset = { status: bob.status, body: bob.body, admissions: admissions().length };
}

if (MODE === 'open') {
  const four = [await open('none'), await open('none'), await open('none'), await open('none')];
  results.open = { statuses: four.map((x) => x.status), admissions: admissions().length };
}

if (MODE === 'oidc') {
  await open('alice'); await open('alice');
  const third = await open('alice');
  const bob = await open('bob');
  results.oidc = { third: third.status, data: third.body && third.body.error && third.body.error.data, bob: bob.status };
}

if (MODE === 'discovery') {
  const { _resetDynamicAclCache } = await import('./dist/src/auth/budget-acl-dynamic.js');
  const { requestContext } = await import('./dist/src/lib/requestContext.js');
  const pending = () => connectionPool.getStats().pendingReservations;
  discoveryIds = ['shared'];
  failNext = true;
  const retry = await open('bob');
  const retryContext = ids => ({
    sessionId: retry.sid, principal: 'sub-bob-577', allowedBudgets: ids,
    discoveredBudgets: ids.map(syncId => ({ syncId, name: syncId, encrypted: false })),
  });
  const selection = ids => requestContext.run(retryContext(ids), () => adapterMod.initialBudgetForSession(retry.sid).syncId);
  const sdk = (await import('@actual-app/api')).default;
  const downloads = [];
  sdk.init = async () => {};
  sdk.shutdown = async () => {};
  sdk.getBudgetMonths = async () => [];
  sdk.getServerVersion = async () => ({ version: '26.5.0' });
  sdk.downloadBudget = async id => {
    downloads.push(id);
    if (downloads.length === 1) throw new Error('fixture download unavailable');
  };
  adapterMod._setSkipApiInitForTests(false);
  const read = (ids = ['shared']) => requestContext.run(retryContext(ids), () => adapterMod.withActualApi(async () => 'read'));
  results.heal = { first: await read().catch(err => err.message), second: await read(), downloads,
    pooled: connectionPool.connections.has(retry.sid) };
  results.afterShareRead = await read(['private', 'shared']).catch(err => err.message);
  adapterMod._setSkipApiInitForTests(true);
  results.retry = { status: retry.status, registered: connectionPool.registered.has(retry.sid),
    pending: pending(), target: openTargets.at(-1), next: selection(['shared']),
    afterShare: selection(['private', 'shared']), second: (await open('bob')).status };
  await reset();

  failNext = true;
  takeReleasedSlot = true;
  const lost = await open('bob');
  const followUp = await realFetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + T.bob, 'mcp-session-id': lost.sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  results.lost = { status: followUp.status, code: (await followUp.json()).error?.code,
    registered: connectionPool.registered.has(lost.sid), pending: pending(), admissions: admissions().length };
  connectionPool.releaseReservation('other-session');
  takeReleasedSlot = false;
  await reset();
  // The pin made by the HTTP server itself: one file opens at initialize, then a second appears.
  _resetDynamicAclCache();
  const pinned = await open('bob');
  results.pinned = { status: pinned.status, target: openTargets.at(-1),
    afterShare: requestContext.run({ ...retryContext(['private', 'shared']), sessionId: pinned.sid },
      () => adapterMod.initialBudgetForSession(pinned.sid).syncId) };
  await reset();
  discoveryIds = ['alpha-sync'];
  _resetDynamicAclCache();
  const lockedDefault = await open('bob');
  results.lockedDefault = { status: lockedDefault.status, pending: pending(), logins };
  await reset();
  discoveryIds = ['shared', 'private'];
  _resetDynamicAclCache();
  const first = await open('bob');
  results.live = { opened: first.status, pending: pending(), second: (await open('bob')).status };
  results.closed = { status: await close(first.sid), pending: pending() };
  const idle = await open('bob');
  if (idle.sid) {
    connectionPool.registered.set(idle.sid, Date.now() - connectionPool.getIdleTimeoutMinutes() * 60_000 - 1);
    await connectionPool.cleanupIdleConnections();
  }
  results.idle = { opened: idle.status, pending: pending(), next: (await open('bob')).status };
  await cleanup();
  results.shutdown = { pending: pending(), admissions: admissions().length, logins };
}

await new Promise((res) => listener.close(res));
process.removeListener('SIGTERM', cleanup); process.removeListener('SIGINT', cleanup);
process.stdout.write(${JSON.stringify(SENTINEL)} + JSON.stringify(results) + '\\n');
process.exit(0);
`;

const baseEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'stub-password-for-unit-test',
  ACTUAL_BUDGET_SYNC_ID: 'alpha-sync',
  BUDGET_DEFAULT_NAME: 'Alpha', BUDGET_1_NAME: 'Beta', BUDGET_1_SYNC_ID: 'beta-sync',
  NODE_ENV: 'production',
};
const staticEnv = { MCP_STATIC_TOKENS: STATIC, MCP_TOKEN_ALICE: TOK_ALICE, MCP_TOKEN_BOB: TOK_BOB };
const ENV = {
  static: { ...staticEnv, MCP_SSE_AUTHORIZATION: TOK_LEGACY, MAX_SESSIONS_PER_PRINCIPAL: '2', MAX_CONCURRENT_SESSIONS: '15' },
  global: { ...staticEnv, MAX_SESSIONS_PER_PRINCIPAL: '5', MAX_CONCURRENT_SESSIONS: '2' },
  unset: { ...staticEnv, MAX_CONCURRENT_SESSIONS: '2' },
  open: { MCP_ALLOW_UNAUTHENTICATED: 'true', MAX_SESSIONS_PER_PRINCIPAL: '2', MAX_CONCURRENT_SESSIONS: '15' },
  discovery: { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: ISSUER, OIDC_RESOURCE: RESOURCE, AUTH_BUDGET_ACL_SOURCE: 'actual',
    AUTH_BUDGET_DISCOVERY: 'true', MAX_SESSIONS_PER_PRINCIPAL: '1', MAX_CONCURRENT_SESSIONS: '1' },
  oidc: { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: ISSUER, OIDC_RESOURCE: RESOURCE, MAX_SESSIONS_PER_PRINCIPAL: '2', MAX_CONCURRENT_SESSIONS: '15' },
};
function run(mode) {
  const dataDir = mkdtempSync(join(tmpdir(), 'principal-cap-577-'));
  const env = { ...baseEnv, ...ENV[mode], MCP_BRIDGE_DATA_DIR: dataDir };
  const c = spawnSync(process.execPath, ['--input-type=module', '-e', childFor(mode)], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  rmSync(dataDir, { recursive: true, force: true });
  assert.strictEqual(c.signal, null, `${mode} child hung`);
  assert.strictEqual(c.status, 0, `${mode} child exited ${c.status}\n${(c.stderr || '').slice(-2000)}\n${(c.stdout || '').slice(-2000)}`);
  const lines = (c.stdout || '').split('\n').filter((l) => l.startsWith(SENTINEL));
  assert.strictEqual(lines.length, 1, `${mode}: expected one sentinel line`);
  return { r: JSON.parse(lines[0].slice(SENTINEL.length)), stderr: c.stderr || '', stdout: c.stdout || '' };
}
const runs = {};
for (const mode of Object.keys(ENV)) {
  check(`${mode}: the child ran to completion`, () => { runs[mode] = run(mode); });
}
const PRINCIPAL_MSG = /^Max sessions per principal \(2\) reached\. Yours: 2\. Please close one of your sessions or wait for idle sessions to time out \(\d+ minutes\)\.$/;

console.log('\n[#577 per-principal cap] MAX_SESSIONS_PER_PRINCIPAL=2 with static tokens');
const s = runs.static?.r;
if (s) {
  check('discovery off: a stale preference opens only the permitted configured budget', () => {
    assert.deepStrictEqual(s.restricted, ['beta-sync']);
  });
  check('C-over (negative) alice\'s third session gets the per-principal 503 with only her own cap and count', () => {
    assert.strictEqual(s.over.third, 503);
    assert.strictEqual(s.over.body.jsonrpc, '2.0');
    assert.strictEqual(s.over.body.error.code, -32000);
    assert.match(s.over.body.error.message, PRINCIPAL_MSG);
    const { idleTimeoutMinutes, ...rest } = s.over.body.error.data;
    assert.ok(Number.isInteger(idleTimeoutMinutes) && idleTimeoutMinutes > 0);
    assert.deepStrictEqual(rest, { maxSessionsPerPrincipal: 2, yourSessions: 2 });
  });
  check('C-over bob still gets in while alice is at her cap', () => assert.strictEqual(s.over.bob, 200));
  check('C-other bob holding 2 sessions does not consume alice\'s cap', () => assert.strictEqual(s.other.alice, 200));
  check('C-parallel (negative) 6 initializes from alice in one tick admit exactly 2, refuse 4 per principal, start 2 logins', () => {
    assert.deepStrictEqual(s.parallel.statuses, [200, 200, 503, 503, 503, 503]);
    assert.strictEqual(s.parallel.logins, 2);
    for (const d of s.parallel.refusals) assert.strictEqual(d.maxSessionsPerPrincipal, 2);
  });
  check('C-unauth (negative) an initialize with no token is refused 401 and records no admission', () => {
    assert.strictEqual(s.unauth.status, 401);
    assert.strictEqual(s.unauth.after, s.unauth.before);
  });
  check('C-failed a failed initialize frees alice\'s count', () => {
    assert.strictEqual(s.failed.next, 200);
    assert.strictEqual(s.failed.aliceCount, 2, 'the failed one must not still be counted');
  });
  check('C-delete a session closed with DELETE frees alice\'s count', () => {
    assert.deepStrictEqual(s.delete, { closed: 200, next: 200 });
  });
  check('C-evict an evicted session (the idle path) frees alice\'s count', () => assert.strictEqual(s.evict.next, 200));
  check('C-drop (negative) a pool drop without evict keeps the live session counted', () => {
    assert.strictEqual(s.drop.next, 503);
    assert.strictEqual(s.drop.scopeData.maxSessionsPerPrincipal, 2);
  });
  check('C-legacy the shared legacy token is exempt: a fourth session on it is admitted, none recorded', () => {
    assert.deepStrictEqual(s.legacy, { statuses: [200, 200, 200, 200], admissions: 0 });
  });
  check('C-nokey once alice has closed every session no admission names her', () => {
    assert.ok(!s.nokey.admissions.includes('alice'));
  });
  check('the refusal log line carries the cap and count but no principal and no session id', () => {
    const out = runs.static.stdout + runs.static.stderr;
    const lines = out.split('\n').filter((l) => l.includes('per-principal cap reached'));
    assert.ok(lines.length > 0, 'expected the refusal warn');
    for (const l of lines) {
      assert.doesNotMatch(l, /alice|bob/);
      assert.doesNotMatch(l, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });
}

console.log('\n[#577 per-principal cap] precedence, unset, no principal, OIDC');
const g = runs.global?.r;
if (g) {
  check('global (negative) the global cap binds first with #581\'s refusal and records no admission for the refused id', () => {
    assert.strictEqual(g.global.status, 503);
    assert.match(g.global.body.error.message, /^Max concurrent sessions \(2\) reached\./);
    assert.strictEqual(g.global.body.error.data.maxSessionsPerPrincipal, undefined);
    assert.deepStrictEqual(g.global.admissions, ['alice', 'bob']);
  });
  check('global after alice closed both and bob filled the pool, her refused initialize leaves no admission naming her', () => {
    assert.strictEqual(g.nokey.status, 503);
    assert.deepStrictEqual(g.nokey.admissions, ['bob', 'bob']);
  });
}
const u = runs.unset?.r;
if (u) {
  check('unset (negative) bob\'s refusal is exactly the global one, with no per-principal field', () => {
    assert.strictEqual(u.unset.status, 503);
    assert.strictEqual(u.unset.body.error.code, -32000);
    assert.match(u.unset.body.error.message, /^Max concurrent sessions \(2\) reached\. Active: 2\. Please close existing sessions or wait for idle sessions to timeout \(\d+ minutes\)\.$/);
    assert.deepStrictEqual(Object.keys(u.unset.body.error.data).sort(),
      ['activeSessions', 'availableSlots', 'idleTimeoutMinutes', 'maxConcurrent', 'pendingReservations']);
    assert.strictEqual(u.unset.admissions, 0, 'unset records no admissions at all');
  });
}
const o = runs.open?.r;
if (o) {
  check('open a request with no principal is bounded by the global cap only', () => {
    assert.deepStrictEqual(o.open, { statuses: [200, 200, 200, 200], admissions: 0 });
  });
}
const discovery = runs.discovery?.r;
if (discovery) {
  check('a listed locked default initializes without a connection attempt', () => {
    assert.deepStrictEqual(discovery.lockedDefault, { status: 200, pending: 1, logins: 0 });
  });
  check('failed discovered open keeps an unpinned session and takes back its slot', () => {
    assert.deepStrictEqual(discovery.retry, { status: 200, registered: true, pending: 1,
      target: 'shared', next: 'shared', afterShare: 'alpha-sync', second: 503 });
  });
  check('data calls retry the unpinned file on the shared connection until it opens', () => {
    assert.match(discovery.afterShareRead, /^Budget ACL:/);
    assert.deepStrictEqual(discovery.heal, { first: 'fixture download unavailable', second: 'read',
      downloads: ['shared', 'shared'], pooled: false });
  });
  check('a session the server opened on its only file stays on it after a second file appears', () => {
    assert.deepStrictEqual(discovery.pinned, { status: 200, target: 'shared', afterShare: 'shared' });
  });
  check('losing the reservation reports an initialize failure on the issued session', () => {
    assert.deepStrictEqual(discovery.lost, { status: 404, code: -32001, registered: false, pending: 1, admissions: 0 });
  });
  check('a discovery-only session holds its slot until DELETE', () => {
    assert.deepStrictEqual(discovery.live, { opened: 200, pending: 1, second: 503 });
    assert.deepStrictEqual(discovery.closed, { status: 200, pending: 0 });
  });
  check('orphan eviction releases the slot for the next discovery-only session', () => {
    assert.deepStrictEqual(discovery.idle, { opened: 200, pending: 0, next: 200 });
  });
  check('server shutdown releases an unopened session without logging in', () => {
    assert.deepStrictEqual(discovery.shutdown, { pending: 0, admissions: 0, logins: 0 });
  });
}
const d = runs.oidc?.r;
if (d) {
  check('oidc an OIDC subject reading "static-bearer" is capped (exemption follows the auth method)', () => {
    assert.strictEqual(d.oidc.third, 503);
    assert.deepStrictEqual({ ...d.oidc.data, idleTimeoutMinutes: 0 }, { maxSessionsPerPrincipal: 2, yourSessions: 2, idleTimeoutMinutes: 0 });
    assert.strictEqual(d.oidc.bob, 200);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
