// tests/unit/session_ownership.test.js
//
// A session belongs to the principal that created it. Session ids are bearer
// material for the Streamable HTTP transport, so:
//   1. /health (unauthenticated) reports pool counts only, never session ids.
//   2. actual_session_list lists only the caller's own sessions.
//   3. actual_session_close only closes, and only names, the caller's own sessions.
//   4. POST and GET on the MCP path refuse a session id the caller does not own.
//
// 1 to 3 are behavioural: the real compiled tools run against the real pool
// singleton, seeded with entries for two principals. 4 lives in closures inside
// startHttpServer, so the predicate is tested directly and the wiring is pinned
// by source guards, matching the other httpServer tests in this directory.
//
// Run: node tests/unit/session_ownership.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

const dist = '../../dist/src';
const owners = await import(`${dist}/lib/session-owners.js`);
const { connectionPool } = await import(`${dist}/lib/ActualConnectionPool.js`);
const { requestContext } = await import(`${dist}/lib/requestContext.js`);
const { getConnectionState } = await import(`${dist}/actualConnection.js`);
const sessionList = (await import(`${dist}/tools/session_list.js`)).default;
const sessionClose = (await import(`${dist}/tools/session_close.js`)).default;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const A = 'user-a';
const B = 'user-b';
const A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const A2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const B1 = 'bbbbbbbb-0000-4000-8000-000000000001';

// Seed the pool directly. `connections` is private only to TypeScript; going
// through getConnection would need a live Actual server.
function seed() {
  const map = connectionPool.connections;
  map.clear();
  const now = Date.now();
  for (const [sid, idleMin] of [[A1, 10], [A2, 1], [B1, 0]]) {
    map.set(sid, {
      sessionId: sid, initialized: true, lastActivity: now - idleMin * 60000,
      dataDir: '/nonexistent', serverUrl: 'http://localhost:5006', password: 'x', syncId: 's',
    });
  }
  owners.recordSessionOwner(A1, A);
  owners.recordSessionOwner(A2, A);
  owners.recordSessionOwner(B1, B);
}
const as = (principal, sessionId, fn) => requestContext.run({ principal, sessionId }, fn);

// --- the predicate -------------------------------------------------------------
console.log('\n[session ownership] predicate');

await check('the owner matches its own session, another principal does not', () => {
  seed();
  assert.strictEqual(owners.sessionOwnerMatches(A1, A), true);
  assert.strictEqual(owners.sessionOwnerMatches(A1, B), false);
  assert.strictEqual(owners.sessionOwnerMatches(B1, A), false);
});

await check('an unrecorded session matches no authenticated principal', () => {
  assert.strictEqual(owners.sessionOwnerMatches('never-recorded', A), false);
  assert.strictEqual(owners.sessionOwnerMatches('never-recorded', 'static-bearer'), false);
});

await check('auth disabled: an undefined principal still owns undefined-owned sessions (no behaviour change)', () => {
  owners.recordSessionOwner('anon', undefined);
  assert.strictEqual(owners.sessionOwnerMatches('anon', undefined), true);
  assert.strictEqual(owners.sessionOwnerMatches('anon', A), false);
  owners.forgetSessionOwner('anon');
});

await check('forgetting a session removes the binding', () => {
  owners.recordSessionOwner('gone', A);
  owners.forgetSessionOwner('gone');
  assert.strictEqual(owners.sessionOwnerMatches('gone', A), false);
});

// --- /health -------------------------------------------------------------------
console.log('\n[session ownership] /health state');

await check('getConnectionState carries pool counts but no session list', () => {
  seed();
  const state = getConnectionState();
  assert.ok(state.connectionPool, 'pool summary present');
  assert.strictEqual(state.connectionPool.totalSessions, 3);
  assert.strictEqual('sessions' in state.connectionPool, false);
});

await check('no session id, full or partial, appears anywhere in the /health state', () => {
  seed();
  const json = JSON.stringify(getConnectionState());
  for (const sid of [A1, A2, B1]) assert.ok(!json.includes(sid.slice(0, 8)), `${sid} leaked`);
});

// --- actual_session_list ---------------------------------------------------------
console.log('\n[session ownership] actual_session_list');

await check('B sees only B\'s session; totals stay pool-wide', async () => {
  seed();
  const out = await as(B, B1, () => sessionList.call({}));
  assert.deepStrictEqual(out.sessions.map((s) => s.sessionId), [B1]);
  assert.strictEqual(out.totalSessions, 3);
  assert.ok(!JSON.stringify(out).includes('aaaaaaaa'), 'A\'s ids must not appear');
});

await check('A sees both of A\'s sessions and not B\'s', async () => {
  seed();
  const out = await as(A, A2, () => sessionList.call({}));
  assert.deepStrictEqual(out.sessions.map((s) => s.sessionId).sort(), [A1, A2]);
});

// --- actual_session_close --------------------------------------------------------
console.log('\n[session ownership] actual_session_close');

await check('B cannot close A\'s session by its full id; it reads as not found', async () => {
  seed();
  const out = await as(B, B1, () => sessionClose.call({ sessionId: A1 }));
  assert.strictEqual(out.success, false);
  assert.match(out.message, /No session found/);
  assert.ok(connectionPool.connections.has(A1), 'A1 must still be in the pool');
  assert.ok(!JSON.stringify(out.availableSessions).includes('aaaaaaaa'), 'reply must not list A\'s ids');
});

await check('B cannot close A\'s session by a partial id either', async () => {
  seed();
  const out = await as(B, B1, () => sessionClose.call({ sessionId: 'aaaaaaaa' }));
  assert.strictEqual(out.success, false);
  assert.ok(connectionPool.connections.has(A1) && connectionPool.connections.has(A2));
  assert.ok(!JSON.stringify(out).includes('aaaaaaaa-'), 'reply must not reveal A\'s full ids');
});

await check('with no id, B is told there is nothing to close rather than closing A\'s idle session', async () => {
  seed();
  // A1 is the oldest idle session in the pool, so the old code closed it.
  const out = await as(B, B1, () => sessionClose.call({}));
  assert.strictEqual(out.success, false);
  assert.match(out.message, /No other sessions/);
  assert.ok(connectionPool.connections.has(A1));
});

await check('partial matching still works within the caller\'s own sessions (ambiguity is reported)', async () => {
  seed();
  const out = await as(A, B1, () => sessionClose.call({ sessionId: 'aaaaaaaa' }));
  assert.strictEqual(out.success, false);
  assert.match(out.message, /Multiple sessions match/);
  assert.deepStrictEqual([...out.matchingSessions].sort(), [A1, A2]);
});

// --- HTTP wiring (source guards) -------------------------------------------------
console.log('\n[session ownership] httpServer wiring');

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');

await check('the owner is resolved from the initialize request and recorded before the transport is registered', () => {
  assert.match(src, /const sessionOwner = resolvePrincipal\(req\);/);
  const rec = src.indexOf('recordSessionOwner(sid, sessionOwner);');
  const reg = src.indexOf('transports.set(sid, transport);');
  assert.ok(rec > 0 && reg > rec, 'recordSessionOwner must precede transports.set');
});

await check('the eviction listener forgets the owner', () => {
  const start = src.indexOf('connectionPool.onSessionEvicted(');
  assert.ok(src.slice(start, start + 700).includes('forgetSessionOwner(sessionId);'));
});

await check('POST session reuse checks ownership before touching the session or handling the request', () => {
  const post = src.slice(src.indexOf('app.post(httpPath'), src.indexOf('app.get(httpPath'));
  const guard = post.indexOf('sessionOwnerMatches(sessionId, resolvePrincipal(req))');
  const touch = post.indexOf('connectionPool.touch(sessionId);');
  const handle = post.lastIndexOf('transport.handleRequest(req, res, req.body)');
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < touch && guard < handle, 'guard must come first');
});

await check('a non-owner tools/list gets the same discovery list an unknown id gets, not a 404', () => {
  const post = src.slice(src.indexOf('app.post(httpPath'), src.indexOf('app.get(httpPath'));
  const guard = post.indexOf('sessionOwnerMatches(sessionId, resolvePrincipal(req))');
  const branch = post.slice(guard, post.indexOf('res.status(404)', guard));
  assert.match(branch, /method === 'tools\/list'/, 'tools/list branch inside the ownership guard');
  assert.match(branch, /buildToolListEntries\(toolsList, resolveToolMeta\)/, 'it returns the shim tool list');
});

await check('GET checks ownership before touching the session or handling the request', () => {
  const get = src.slice(src.indexOf('app.get(httpPath'), src.indexOf("app.get('/mcp-info'"));
  const guard = get.indexOf('sessionOwnerMatches(sessionId, resolvePrincipal(req))');
  const touch = get.indexOf('connectionPool.touch(sessionId);');
  const handle = get.indexOf('transport.handleRequest(req, res)');
  assert.ok(guard > 0, 'guard present');
  assert.ok(guard < touch && guard < handle, 'guard must come first');
});

connectionPool.connections.clear();
console.log(`\n[session ownership] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
