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
  _shouldKeepSingletonAlive,
}) => {
  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  const { isApiInitialized } = await import('../../dist/src/lib/apiState.js');

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
    // #392 split this into shutdownConnection (acquires the api lock) and
    // shutdownConnectionLocked (for callers already holding it). The adapter's pooled error
    // paths hold the lock, so they call the Locked variant. Spy on BOTH, because the assertion
    // is that the pool entry was dropped, not which variant did it.
    const originalShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    const originalShutdownLocked = connectionPool.shutdownConnectionLocked.bind(connectionPool);
    connectionPool.shutdownConnectionLocked = async (sid) => {
      if (sid === 'sess-err-infra') observedShutdown = true;
      connectionPool.connections.delete(sid);
    };

    let thrown = null;
    try {
      await requestContext.run({ sessionId: 'sess-err-infra' }, async () => {
        // Simulates a real upstream INFRASTRUCTURE failure (connection dropped mid-call). #422:
        // must be a non-rate-limit transient, because a rate-limit no longer drops the connection.
        await withActualApi(async () => { throw new Error('socket hang up'); });
      });
    } catch (err) { thrown = err; }

    connectionPool.shutdownConnection = originalShutdown;
    connectionPool.shutdownConnectionLocked = originalShutdownLocked;

    assert(thrown !== null && /socket hang up/.test(thrown.message),
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
    // #392 split this into shutdownConnection (acquires the api lock) and
    // shutdownConnectionLocked (for callers already holding it). The adapter's pooled error
    // paths hold the lock, so they call the Locked variant. Spy on BOTH, because the assertion
    // is that the pool entry was dropped, not which variant did it.
    const originalShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    const originalShutdownLocked = connectionPool.shutdownConnectionLocked.bind(connectionPool);
    connectionPool.shutdownConnectionLocked = async (sid) => {
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
    connectionPool.shutdownConnectionLocked = originalShutdownLocked;

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

  // =========================================================================
  // #419: stdio keeps the api singleton alive across ops (no per-call login),
  // with a self-heal that tears it down on an infrastructure-level error.
  //
  // The skip seam's shutdownActualApi honours _shouldKeepSingletonAlive, so
  // these cases observe the real branch decision through isApiInitialized()
  // without driving a live api.init(). MCP_STDIO_MODE is the process signal.
  // =========================================================================

  // -------------------------------------------------------------------------
  // Case 6: _shouldKeepSingletonAlive decision (pure, mutation-proof)
  // -------------------------------------------------------------------------
  describe('Case 6: _shouldKeepSingletonAlive decision (#419)');
  {
    const priorStdio = process.env.MCP_STDIO_MODE;
    delete process.env.MCP_STDIO_MODE; // not a stdio process
    assert(_shouldKeepSingletonAlive(0, false) === false, 'http, no active sessions -> full shutdown');
    assert(_shouldKeepSingletonAlive(1, false) === true, 'http, active session -> keep alive');
    assert(_shouldKeepSingletonAlive(1, true) === true, 'force does NOT defeat the active-HTTP-session keep-alive');
    process.env.MCP_STDIO_MODE = 'true'; // stdio process
    assert(_shouldKeepSingletonAlive(0, false) === true, 'stdio -> keep singleton alive between ops');
    assert(_shouldKeepSingletonAlive(0, true) === false, 'stdio + forceFullShutdown -> self-heal teardown');
    assert(_shouldKeepSingletonAlive(1, true) === true, 'an active session still wins even under force');
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }

  // -------------------------------------------------------------------------
  // Case 7: stdio keeps the singleton alive: one login for N calls
  // -------------------------------------------------------------------------
  describe('Case 7: stdio process keeps the singleton alive across ops (#419)');
  {
    const priorStdio = process.env.MCP_STDIO_MODE;
    process.env.MCP_STDIO_MODE = 'true';
    _setApiInitializedForTests(false); // fresh process, no login yet
    const sid = 'stdio-keepalive-1';
    await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
      await withActualApi(async () => 'ok');
    });
    assert(isApiInitialized() === true,
      'after a stdio op the singleton stays live (next init no-ops -> one login for N calls)');
    await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
      await withActualApi(async () => 'ok2');
    });
    assert(isApiInitialized() === true, 'still live after a second stdio op');
    _setApiInitializedForTests(false);
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }

  // -------------------------------------------------------------------------
  // Case 8: self-heal: transient error tears down, domain error does not
  // -------------------------------------------------------------------------
  describe('Case 8: stdio self-heal on infrastructure error, not on domain error (#419)');
  {
    const priorStdio = process.env.MCP_STDIO_MODE;
    process.env.MCP_STDIO_MODE = 'true';
    const sid = 'stdio-selfheal-1';

    _setApiInitializedForTests(false);
    let thrown = null;
    try {
      await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
        // #422: a NON-rate-limit infra transient (a rate-limit would now be kept alive, see Case 10).
        await withActualApi(async () => { throw new Error('socket hang up'); });
      });
    } catch (e) { thrown = e; }
    assert(thrown !== null && /socket hang up/.test(thrown.message), 'transient error propagated');
    assert(isApiInitialized() === false,
      'transient error forced a full teardown (isApiInitialized reset) -> next op re-inits fresh');

    _setApiInitializedForTests(false);
    thrown = null;
    try {
      await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
        await withActualApi(async () => { throw new Error('Field "payee_name" does not exist'); });
      });
    } catch (e) { thrown = e; }
    assert(thrown !== null && /payee_name/.test(thrown.message), 'domain error propagated');
    assert(isApiInitialized() === true,
      'domain error left the singleton alive (kept warm, no per-op login reintroduced)');

    _setApiInitializedForTests(false);
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }

  // -------------------------------------------------------------------------
  // Case 9: pool-miss warn fires at most once per process, not per call
  // -------------------------------------------------------------------------
  describe('Case 9: pool-miss warning suppressed once the singleton is live (#419)');
  {
    const priorStdio = process.env.MCP_STDIO_MODE;
    process.env.MCP_STDIO_MODE = 'true';
    const loggerMod = await import('../../dist/src/logger.js');
    const log = loggerMod.default;
    const originalWarn = log.warn.bind(log);
    let poolMissWarns = 0;
    log.warn = (...args) => { if (/Pool miss/.test(String(args[0]))) poolMissWarns++; return originalWarn(...args); };
    try {
      _setApiInitializedForTests(false); // first call warns (a real init is ahead)
      const sid = 'stdio-warn-1';
      for (let i = 0; i < 3; i++) {
        await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
          await withActualApi(async () => 'ok');
        });
      }
    } finally {
      log.warn = originalWarn;
    }
    assert(poolMissWarns <= 1,
      `pool-miss warn fired at most once per process, not per call (got ${poolMissWarns})`);
    _setApiInitializedForTests(false);
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }

  // -------------------------------------------------------------------------
  // Case 10 (#422): a RATE-LIMIT error must NOT tear the stdio singleton down.
  // A rate-limit is transient (worth backing off) but does not corrupt the
  // connection, so re-logging-in during the throttle would only add a fresh
  // rejected login. Distinct from Case 8's non-rate-limit transient, which DOES
  // tear down. This is the #383 relogin-cascade trigger, fixed at the source.
  // -------------------------------------------------------------------------
  describe('Case 10 (#422): a rate-limit error keeps the stdio singleton alive (no teardown)');
  {
    const priorStdio = process.env.MCP_STDIO_MODE;
    process.env.MCP_STDIO_MODE = 'true';
    const sid = 'stdio-ratelimit-1';

    // Spaced express-default form (what the E2E server returns).
    _setApiInitializedForTests(false);
    let thrown = null;
    try {
      await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
        await withActualApi(async () => { throw new Error('Authentication failed: Too many requests, please try again later.'); });
      });
    } catch (e) { thrown = e; }
    assert(thrown !== null && /too many requests/i.test(thrown.message), 'rate-limit error propagated');
    assert(isApiInitialized() === true,
      'a rate-limit did NOT force a teardown (singleton kept alive, no relogin storm)');

    // Hyphenated code form (other server builds) behaves the same.
    _setApiInitializedForTests(false);
    thrown = null;
    try {
      await requestContext.run({ sessionId: sid, transport: 'stdio' }, async () => {
        await withActualApi(async () => { throw new Error('Authentication failed: too-many-requests'); });
      });
    } catch (e) { thrown = e; }
    assert(thrown !== null, 'hyphenated rate-limit error propagated');
    assert(isApiInitialized() === true, 'the hyphenated rate-limit form also keeps the singleton alive');

    _setApiInitializedForTests(false);
    if (priorStdio === undefined) delete process.env.MCP_STDIO_MODE; else process.env.MCP_STDIO_MODE = priorStdio;
  }

  console.log(`\n[adapter-session-reuse] Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
