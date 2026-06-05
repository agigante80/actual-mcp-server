// tests/unit/pool_liveness.test.js
//
// #167: consolidate the httpServer + pool session tables behind a single
// source of truth. The pool now owns liveness and idle timing and notifies the
// transport layer on eviction, so the two tables can no longer drift.
//
// These tests drive the pool's internal state directly (poking the private
// `connections` Map, the same seam used by adapter_session_reuse.test.js) so no
// live Actual server is required.
//
// Run: node tests/unit/pool_liveness.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/167

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');

let passed = 0;
let failed = 0;
function describe(label) { console.log(`\n[pool-liveness] ${label}`); }
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

const idleMs = connectionPool.getIdleTimeoutMinutes() * 60 * 1000;

// Minimal seed: isLive / touch / cleanup only read `initialized` + `lastActivity`.
function seed(sessionId, lastActivity) {
  connectionPool.connections.set(sessionId, {
    sessionId,
    initialized: true,
    lastActivity,
    dataDir: '/tmp/test',
    serverUrl: 'http://test-server',
    password: 'x',
    syncId: 'unit-test-sync-id',
  });
}
function unseed(sessionId) {
  connectionPool.connections.delete(sessionId);
}

// One global eviction listener; cases assert membership by sessionId.
const evicted = [];
connectionPool.onSessionEvicted((sessionId) => { evicted.push(sessionId); });

// Start from a clean table so totalSessions assertions are exact.
connectionPool.connections.clear();

// ---------------------------------------------------------------------------
describe('isLive: known live session');
{
  seed('sess-live', Date.now());
  assert(connectionPool.isLive('sess-live') === true, 'isLive returns true for a fresh session');
  unseed('sess-live');
}

// ---------------------------------------------------------------------------
describe('isLive: unknown session has no side effect');
{
  const before = connectionPool.getStats().totalSessions;
  assert(connectionPool.isLive('does-not-exist') === false, 'isLive returns false for unknown session');
  const after = connectionPool.getStats().totalSessions;
  assert(before === after, `no entry created as a side effect (before=${before}, after=${after})`);
}

// ---------------------------------------------------------------------------
describe('isLive: expired session');
{
  seed('sess-expired', Date.now() - idleMs - 1000);
  assert(connectionPool.isLive('sess-expired') === false, 'isLive returns false past the idle window');
  unseed('sess-expired');
}

// ---------------------------------------------------------------------------
describe('touch: refreshes the idle clock and never creates entries');
{
  seed('sess-touch', Date.now() - idleMs - 1000);
  assert(connectionPool.isLive('sess-touch') === false, 'precondition: expired before touch');
  connectionPool.touch('sess-touch');
  assert(connectionPool.isLive('sess-touch') === true, 'live again after touch');
  unseed('sess-touch');

  const before = connectionPool.getStats().totalSessions;
  connectionPool.touch('never-existed');
  const after = connectionPool.getStats().totalSessions;
  assert(before === after, 'touch on unknown session creates no entry');
}

// ---------------------------------------------------------------------------
describe('eviction: idle sweep fires the listener and removes the entry');
{
  seed('sess-evict-idle', Date.now() - idleMs - 1000);
  await connectionPool.cleanupIdleConnections();
  assert(evicted.includes('sess-evict-idle'), 'eviction listener fired for the idle-swept session');
  const present = connectionPool.getStats().sessions.some(s => s.sessionId === 'sess-evict-idle');
  assert(present === false, 'entry absent from getStats().sessions after sweep');
}

// ---------------------------------------------------------------------------
describe('eviction: explicit close with evict:true fires the listener');
{
  seed('sess-evict-manual', Date.now());
  await connectionPool.shutdownConnection('sess-evict-manual', { evict: true });
  assert(evicted.includes('sess-evict-manual'), 'eviction listener fired for explicit close');
  assert(connectionPool.hasConnection('sess-evict-manual') === false, 'entry removed after close');
}

// ---------------------------------------------------------------------------
describe('eviction: plain shutdown (no evict) does NOT fire the listener');
{
  seed('sess-noevict', Date.now());
  await connectionPool.shutdownConnection('sess-noevict');
  assert(evicted.includes('sess-noevict') === false, 'listener NOT fired when evict is omitted (switchBudget / infra-drop case)');
  assert(connectionPool.hasConnection('sess-noevict') === false, 'entry still removed even without eviction');
}

// ---------------------------------------------------------------------------
describe('single source of truth: httpServer keeps no parallel activity map');
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const httpServerJs = fs.readFileSync(
    path.resolve(here, '../../dist/src/server/httpServer.js'),
    'utf8',
  );
  assert(!httpServerJs.includes('sessionLastActivity'),
    'compiled httpServer.js no longer references sessionLastActivity (guards against re-introduction)');
}

// ---------------------------------------------------------------------------
describe('has: raw map presence regardless of initialized (#171)');
{
  connectionPool.connections.clear();

  seed('sess-present', Date.now());
  assert(connectionPool.has('sess-present') === true, 'has returns true for a seeded session');

  const before = connectionPool.getStats().totalSessions;
  assert(connectionPool.has('sess-absent') === false, 'has returns false for an unknown session');
  assert(connectionPool.getStats().totalSessions === before, 'has creates no entry for an unknown session');
  unseed('sess-present');

  // Presence without initialized: has is true, hasConnection is false.
  connectionPool.connections.set('sess-uninit', {
    sessionId: 'sess-uninit',
    initialized: false,
    lastActivity: Date.now(),
    dataDir: '/tmp/test',
    serverUrl: 'http://test-server',
    password: 'x',
    syncId: 'unit-test-sync-id',
  });
  assert(connectionPool.has('sess-uninit') === true, 'has is true for an uninitialized entry');
  assert(connectionPool.hasConnection('sess-uninit') === false, 'hasConnection is false for the same uninitialized entry');
  unseed('sess-uninit');
}

console.log(`\n[pool-liveness] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
