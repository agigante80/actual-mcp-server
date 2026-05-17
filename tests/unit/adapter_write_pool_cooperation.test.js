// Regression test for #158: write path cooperates with the per-session
// connection pool. Before #158, processWriteQueue ran outside
// requestContext.run (setTimeout strips AsyncLocalStorage), so the
// pool-vs-legacy branch decision always fell through to legacy. Post-#158,
// queueWriteOperation captures sessionId at enqueue and processWriteQueue
// uses it to take the pool branch explicitly.
//
// Cases covered:
//   1. Pooled write: a write queued inside requestContext.run with a live
//      pool entry runs against the pool, increments writeConnectionReuses,
//      and does NOT call api.init() in the legacy fallback.
//   2. Non-pooled write: no sessionId in context, falls back to legacy
//      init+sync+shutdown, writeConnectionReuses unchanged.
//   3. Pool branch persistence: api.sync() IS called after the operation
//      in the pool branch (so writes propagate upstream).
//
// Run: node tests/unit/adapter_write_pool_cooperation.test.js

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = 'unit-test-sync-id';

let passed = 0;
let failed = 0;
function describe(label) { console.log(`\n[adapter-write-pool] ${label}`); }
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

(async () => {
  // Stub api.sync so the trailing sync in processWriteQueue is a no-op.
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  let syncCallCount = 0;
  apiDefault.sync = async () => { syncCallCount++; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const {
    withWriteSession,
    getConcurrencyState,
    _setSkipApiInitForTests,
    _setApiInitializedForTests,
    _resetConnectionReuseCounterForTests,
  } = adapterMod;

  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');

  // Disarm real network calls so the legacy fallback in processWriteQueue
  // does not try to init against the real upstream.
  _setSkipApiInitForTests(true);

  function primePoolSession(sessionId) {
    connectionPool.connections.set(sessionId, {
      sessionId,
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
    });
  }
  function clearPoolSession(sessionId) {
    connectionPool.connections.delete(sessionId);
  }

  // -------------------------------------------------------------------------
  // Case 1: pooled write reuses the connection, increments writeReuses,
  // does NOT run legacy init.
  // -------------------------------------------------------------------------
  describe('Case 1: pooled write takes the pool branch');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    primePoolSession('sess-write-pool');
    syncCallCount = 0;

    const before = getConcurrencyState();

    const result = await requestContext.run({ sessionId: 'sess-write-pool' }, async () => {
      return await withWriteSession(async () => 'wrote-1');
    });
    // withWriteSession resolves when the operation's resolve() fires, but
    // api.sync() runs AFTER that inside processWriteQueue. Yield enough to
    // let the trailing sync + shutdown microtasks complete.
    await new Promise((r) => setTimeout(r, 50));

    const after = getConcurrencyState();

    assert(result === 'wrote-1', 'withWriteSession returned the operation result');
    assert(
      after.writeConnectionReuses === before.writeConnectionReuses + 1,
      `writeConnectionReuses incremented by 1 (before=${before.writeConnectionReuses}, after=${after.writeConnectionReuses})`,
    );
    assert(syncCallCount >= 1, `api.sync() was called at least once (called ${syncCallCount} times)`);

    clearPoolSession('sess-write-pool');
  }

  // -------------------------------------------------------------------------
  // Case 2: non-pooled write falls back to legacy branch, writeReuses unchanged.
  // -------------------------------------------------------------------------
  describe('Case 2: non-pooled write takes the legacy branch');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(false);
    // No primePoolSession call: pool is empty.
    syncCallCount = 0;

    const before = getConcurrencyState();

    // No requestContext.run wrapper: sessionId resolves to undefined.
    const result = await withWriteSession(async () => 'wrote-2');
    await new Promise((r) => setTimeout(r, 50));

    const after = getConcurrencyState();

    assert(result === 'wrote-2', 'withWriteSession returned the operation result');
    assert(
      after.writeConnectionReuses === before.writeConnectionReuses,
      `writeConnectionReuses unchanged on legacy path (before=${before.writeConnectionReuses}, after=${after.writeConnectionReuses})`,
    );
    // The legacy branch still sync's at the end of the batch, so sync should be > 0.
    assert(syncCallCount >= 1, `api.sync() was called at least once on legacy path (called ${syncCallCount} times)`);
  }

  // -------------------------------------------------------------------------
  // Case 3: pool branch is reachable via sessionId in context + live pool.
  // -------------------------------------------------------------------------
  describe('Case 3: pool branch persistence (api.sync called)');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    primePoolSession('sess-write-persist');
    syncCallCount = 0;

    await requestContext.run({ sessionId: 'sess-write-persist' }, async () => {
      await withWriteSession(async () => 'persist');
    });
    await new Promise((r) => setTimeout(r, 50));

    assert(syncCallCount >= 1, `api.sync() was called after pool-branch write (called ${syncCallCount} times)`);

    clearPoolSession('sess-write-persist');
  }

  console.log(`\n#158 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
