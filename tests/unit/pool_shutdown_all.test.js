// tests/unit/pool_shutdown_all.test.js
//
// #164: shutdownAll() fanned N shutdownConnection() calls out via Promise.all.
// Each hits the process-global @actual-app/api singleton, so N calls reached
// api.shutdown() before any finally set the singleton flag false, double-
// shutting-down it ("not initialized"). Fix: sequential iteration plus an
// isApiInitialized() guard around the api.shutdown() call.
//
// Drives the pool's internal state directly (same seam as pool_liveness.test.js)
// and spies on api.shutdown to count real invocations.
//
// Run: node tests/unit/pool_shutdown_all.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD || 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';

import assert from 'assert';

const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
const { setApiInitialized, isApiInitialized } = await import('../../dist/src/lib/apiState.js');
const apiMod = await import('@actual-app/api');
const api = apiMod.default ?? apiMod;

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

// Spy on api.shutdown (best-effort: some builds freeze the export).
let shutdownCalls = 0;
const realShutdown = api.shutdown;
let spyInstalled = false;
try {
  api.shutdown = async () => { shutdownCalls++; };
  spyInstalled = api.shutdown !== realShutdown;
} catch { /* not writable; fall back to behavioural assertions only */ }

function seed(id) {
  connectionPool.connections.set(id, {
    sessionId: id, initialized: true, lastActivity: Date.now(),
    dataDir: '/tmp', serverUrl: 'http://test-server', password: 'x', syncId: 'unit-test-sync-id',
  });
}

console.log(`\n[pool-shutdown-all] (api.shutdown spy ${spyInstalled ? 'installed' : 'NOT installed, behavioural only'})`);

// Case 1: multiple sessions + singleton live -> exactly one real api.shutdown.
connectionPool.connections.clear();
seed('sess-a'); seed('sess-b'); seed('sess-c');
setApiInitialized(true);
shutdownCalls = 0;
await connectionPool.shutdownAll();
check('all session entries removed', connectionPool.getStats().totalSessions === 0);
check('singleton flag is false after shutdownAll', isApiInitialized() === false);
if (spyInstalled) check('api.shutdown called exactly once for 3 sessions (no double-shutdown)', shutdownCalls === 1);

// Case 2: singleton already torn down -> api.shutdown is skipped, entries still removed.
seed('sess-d');
setApiInitialized(false);
shutdownCalls = 0;
await connectionPool.shutdownAll();
check('entry removed even when singleton already down', connectionPool.getStats().totalSessions === 0);
if (spyInstalled) check('api.shutdown skipped when singleton already false', shutdownCalls === 0);

// Case 3 (negative): no connections -> no throw, no shutdown.
connectionPool.connections.clear();
setApiInitialized(false);
shutdownCalls = 0;
let threw = false;
try { await connectionPool.shutdownAll(); } catch { threw = true; }
check('shutdownAll with no connections does not throw', threw === false);
if (spyInstalled) check('api.shutdown not called when there is nothing to shut down', shutdownCalls === 0);

// restore
try { api.shutdown = realShutdown; } catch { /* ignore */ }

console.log(`\n[pool-shutdown-all] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
