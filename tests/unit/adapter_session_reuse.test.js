// tests/unit/adapter_session_reuse.test.js
//
// Regression test for #134 — withActualApi cooperates with the per-session
// connection pool to eliminate the per-op login burst that caused #127.
//
// The adapter exposes a test seam (_setSkipApiInitForTests) that turns the
// legacy fallback path into a no-op so the wrapper's branch decision can be
// verified end-to-end without driving a real api.init() against the upstream.
//
// Cases covered:
//   1. Pooled mode (positive): sessionId in AsyncLocalStorage + pool says yes
//      + api flag is initialised → operation runs without a fresh init/shutdown,
//      connectionReuses increments by 1.
//   2. Fallback (no sessionId): pool branch correctly skipped, legacy path
//      runs, connectionReuses unchanged.
//   3. Fallback (pool miss): connectionReuses does NOT increment.
//   4. Error path: pool connection is released on operation failure.
//   5. Stale-singleton guard: pool says yes but _apiInitialized is false →
//      pool branch is skipped (catches the case where processWriteQueue shut
//      the api singleton down behind our back).
//
// Run: node tests/unit/adapter_session_reuse.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/134

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = 'unit-test-sync-id';

import('../../dist/src/lib/actual-adapter.js').then(async ({
  withActualApi,
  getConcurrencyState,
  _resetConnectionReuseCounterForTests,
  _setApiInitializedForTests,
  _setSkipApiInitForTests,
}) => {
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');

  // Disarm real network calls in the legacy fallback path.
  _setSkipApiInitForTests(true);

  let passed = 0;
  let failed = 0;
  function describe(label) { console.log(`\n[adapter-session-reuse] ${label}`); }
  function assert(cond, msg) {
    if (cond) { console.log(`  ✓ ${msg}`); passed++; }
    else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
  }

  // Helper: prime the pool with a fake initialized session record. Pokes the
  // private `connections` Map directly because the pool has no public setter.
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
  // Case 1 — pooled mode: skip init, no shutdown, increment counter
  // -------------------------------------------------------------------------
  describe('Case 1 — pooled mode reuses connection without init/shutdown');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    primePoolSession('sess-reuse-1');

    const before = getConcurrencyState().connectionReuses;
    const result = await requestContext.run({ sessionId: 'sess-reuse-1' }, async () => {
      return await withActualApi(async () => 'ok');
    });
    const after = getConcurrencyState().connectionReuses;

    assert(result === 'ok', 'withActualApi returned the operation result');
    assert(after === before + 1,
      `connectionReuses incremented by 1 (before=${before}, after=${after})`);

    clearPoolSession('sess-reuse-1');
  }

  // -------------------------------------------------------------------------
  // Case 2 — no sessionId in context: legacy path runs, no reuse
  // -------------------------------------------------------------------------
  describe('Case 2 — no sessionId in context: pool branch is skipped');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);

    // No requestContext wrapping → sessionId is undefined → legacy branch.
    const result = await withActualApi(async () => 'legacy-ok');
    const after = getConcurrencyState().connectionReuses;

    assert(result === 'legacy-ok', 'legacy path completed and returned the operation value');
    assert(after === 0, `connectionReuses unchanged (got ${after}) → pool branch correctly skipped`);
  }

  // -------------------------------------------------------------------------
  // Case 3 — sessionId in context but pool has no entry: legacy path runs
  // -------------------------------------------------------------------------
  describe('Case 3 — pool miss: connectionReuses does NOT increment');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    clearPoolSession('sess-miss');

    const result = await requestContext.run({ sessionId: 'sess-miss' }, async () => {
      return await withActualApi(async () => 'legacy-ok-2');
    });
    const after = getConcurrencyState().connectionReuses;

    assert(result === 'legacy-ok-2', 'legacy path completed for pool-miss case');
    assert(after === 0, `pool miss did not bump connectionReuses (got ${after})`);
  }

  // -------------------------------------------------------------------------
  // Case 4a — INFRASTRUCTURE error in pooled-mode op releases the pool conn
  // -------------------------------------------------------------------------
  describe('Case 4a — infrastructure error in pooled mode releases the pool connection');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    primePoolSession('sess-err-infra');
    let observedShutdown = false;
    const originalShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => {
      if (sid === 'sess-err-infra') observedShutdown = true;
      connectionPool.connections.delete(sid);
    };

    let thrown = null;
    try {
      await requestContext.run({ sessionId: 'sess-err-infra' }, async () => {
        // Simulates a real upstream failure — auth lost mid-call.
        await withActualApi(async () => { throw new Error('Authentication failed: too-many-requests'); });
      });
    } catch (err) { thrown = err; }

    connectionPool.shutdownConnection = originalShutdown;

    assert(thrown !== null && /too-many-requests/.test(thrown.message),
      'original infrastructure error propagated to caller');
    assert(observedShutdown === true,
      'connectionPool.shutdownConnection was called for the failing session');
    assert(connectionPool.hasConnection('sess-err-infra') === false,
      'pool no longer reports the session as connected');
  }

  // -------------------------------------------------------------------------
  // Case 4b — USER-INPUT/domain error does NOT release the pool connection
  // -------------------------------------------------------------------------
  describe('Case 4b — user-input/domain error keeps the pool connection alive');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(true);
    primePoolSession('sess-err-domain');
    let observedShutdown = false;
    const originalShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => {
      if (sid === 'sess-err-domain') observedShutdown = true;
      connectionPool.connections.delete(sid);
    };

    let thrown = null;
    try {
      await requestContext.run({ sessionId: 'sess-err-domain' }, async () => {
        // Simulates a Zod validation failure / domain rejection — api state is fine.
        await withActualApi(async () => { throw new Error('Field "payee_name" does not exist in table "transactions"'); });
      });
    } catch (err) { thrown = err; }

    connectionPool.shutdownConnection = originalShutdown;

    assert(thrown !== null && /payee_name/.test(thrown.message),
      'original domain error propagated to caller');
    assert(observedShutdown === false,
      'connectionPool.shutdownConnection was NOT called (pool entry preserved)');
    assert(connectionPool.hasConnection('sess-err-domain') === true,
      'pool still reports the session as connected (next call can reuse)');

    clearPoolSession('sess-err-domain');
  }

  // -------------------------------------------------------------------------
  // Case 5 — stale-singleton guard: pool says yes but _apiInitialized is false
  // -------------------------------------------------------------------------
  describe('Case 5 — pool branch skipped when api singleton is shut down');
  {
    _resetConnectionReuseCounterForTests();
    _setApiInitializedForTests(false);  // simulate "processWriteQueue shut down"
    primePoolSession('sess-stale');

    const result = await requestContext.run({ sessionId: 'sess-stale' }, async () => {
      return await withActualApi(async () => 'legacy-ok-3');
    });
    const after = getConcurrencyState().connectionReuses;

    assert(result === 'legacy-ok-3', 'legacy path completed when singleton is uninit');
    assert(after === 0,
      `pool branch skipped when _apiInitialized is false (got ${after})`);

    clearPoolSession('sess-stale');
  }

  console.log(`\n[adapter-session-reuse] Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
