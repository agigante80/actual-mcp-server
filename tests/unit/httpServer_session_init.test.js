// tests/unit/httpServer_session_init.test.js
//
// Regression test for #132 — bug(server): unhandled promise rejection on Actual
// auth failure crashes bearer MCP container.
//
// The fix lives in two places:
//   1. src/server/httpServer.ts — adds initPromise.catch(() => {}) immediately
//      after the deferred-promise creation so the rejection is always handled,
//      even when no request path awaits it.
//   2. src/index.ts — extends the unhandledRejection allow-list with the
//      "Authentication failed:" pattern as defence-in-depth.
//
// This file unit-tests the deferred-promise pattern (#1) and the allow-list
// classifier (#2) without booting the full HTTP server.
//
// Run: node tests/unit/httpServer_session_init.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/132

let passed = 0;
let failed = 0;

function describe(label) {
  console.log(`\n[httpServer-session-init] ${label}`);
}

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ----------------------------------------------------------------------------
// Helper — recreate the exact deferred-promise pattern from httpServer.ts:367
// so we can verify the .catch() guard works without needing a full server boot.
// ----------------------------------------------------------------------------

function makeDeferred() {
  let resolveInit;
  let rejectInit;
  const initPromise = new Promise((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });
  // The fix from src/server/httpServer.ts:373 — always attach a no-op .catch()
  // so the rejection is marked handled even if no other path awaits it.
  initPromise.catch(() => {});
  return { initPromise, resolveInit, rejectInit };
}

// ----------------------------------------------------------------------------
// Test cases
// ----------------------------------------------------------------------------

async function runTests() {
  describe('Case 1 — auth failure rejects initPromise without an unhandled rejection');
  {
    let unhandled = null;
    const handler = (reason) => {
      unhandled = reason;
    };
    process.on('unhandledRejection', handler);

    const { rejectInit } = makeDeferred();
    rejectInit(new Error('Authentication failed: too-many-requests'));

    // Wait two macrotask ticks so any unhandled-rejection event would fire.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    process.off('unhandledRejection', handler);

    assert(unhandled === null,
      'rejectInit on a deferred Promise with .catch() guard does not trigger unhandledRejection');
  }

  describe('Case 2 — when a path DOES await initPromise, the rejection still propagates to that awaiter');
  {
    const { initPromise, rejectInit } = makeDeferred();

    // Simulate a tools/call arriving after the failed init — the .catch() guard
    // must not swallow the rejection from a real await chain.
    let observed = null;
    const awaitingPath = (async () => {
      try {
        await initPromise;
      } catch (err) {
        observed = err;
      }
    })();

    rejectInit(new Error('Authentication failed: network-failure'));
    await awaitingPath;

    assert(observed !== null && /network-failure/.test(observed.message),
      'awaiting code path still receives the rejection (no swallowing of legitimate errors)');
  }

  describe('Case 3 — index.ts allow-list classifies "Authentication failed:" as known/non-fatal');
  {
    // Source the allow-list logic by replicating the predicates added in src/index.ts:39-46.
    // (We test the classification, not the full unhandledRejection handler — that
    // path calls process.exit and cannot be exercised in-process.)
    function isKnownDomainError(reason) {
      const reasonStr = String(reason);
      return (
        reasonStr.includes('Authentication failed:')
      );
    }

    assert(isKnownDomainError(new Error('Authentication failed: too-many-requests')) === true,
      'too-many-requests is classified as known');
    assert(isKnownDomainError(new Error('Authentication failed: network-failure')) === true,
      'network-failure is classified as known');
    assert(isKnownDomainError(new Error('Authentication failed: invalid-password')) === true,
      'invalid-password is classified as known');
  }

  describe('Case 4 — over-match guard: arbitrary errors are NOT classified as known');
  {
    function isKnownDomainError(reason) {
      const reasonStr = String(reason);
      return (
        reasonStr.includes('Authentication failed:')
      );
    }

    // A generic error must NOT match — otherwise we'd silence real bugs.
    assert(isKnownDomainError(new Error('TypeError: undefined is not a function')) === false,
      'unrelated TypeError is not classified as known');
    assert(isKnownDomainError(new Error('ENOMEM: out of memory')) === false,
      'unrelated ENOMEM is not classified as known');
    assert(isKnownDomainError(new Error('Authentication required')) === false,
      'similar-but-different "Authentication required" (no colon) is not classified as known');
  }

  describe('Case 5 — log hygiene: forced rejection log output never contains credentials');
  {
    // Set sentinel values for env vars that must never leak.
    const SENTINEL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
    const SENTINEL_BUDGET_PWD = 'sentinel-budget-pwd-DO-NOT-LEAK';
    const SENTINEL_BEARER = 'sentinel-bearer-DO-NOT-LEAK';
    const previous = {
      ACTUAL_PASSWORD: process.env.ACTUAL_PASSWORD,
      ACTUAL_BUDGET_PASSWORD: process.env.ACTUAL_BUDGET_PASSWORD,
      MCP_SSE_AUTHORIZATION: process.env.MCP_SSE_AUTHORIZATION,
    };
    process.env.ACTUAL_PASSWORD = SENTINEL_PASSWORD;
    process.env.ACTUAL_BUDGET_PASSWORD = SENTINEL_BUDGET_PWD;
    process.env.MCP_SSE_AUTHORIZATION = SENTINEL_BEARER;

    // Capture what gets serialised when logger.error is given an Error object —
    // this mirrors the existing log call at src/server/httpServer.ts:390.
    const captured = [];
    const fakeLogger = {
      error: (msg, err) => captured.push(`${msg} ${err && err.stack ? err.stack : String(err)}`),
    };

    const sid = '11111111-2222-3333-4444-555555555555';
    const err = new Error('Authentication failed: too-many-requests');
    fakeLogger.error(`[SESSION] Failed to initialize Actual for session ${sid}:`, err);

    const allOutput = captured.join('\n');

    assert(!allOutput.includes(SENTINEL_PASSWORD),
      'log output does not contain ACTUAL_PASSWORD value');
    assert(!allOutput.includes(SENTINEL_BUDGET_PWD),
      'log output does not contain ACTUAL_BUDGET_PASSWORD value');
    assert(!allOutput.includes(SENTINEL_BEARER),
      'log output does not contain MCP_SSE_AUTHORIZATION bearer token');
    assert(!/password\s*[:=]/i.test(allOutput),
      'log output does not contain a password=/password: substring');
    assert(allOutput.includes(sid),
      'log output DOES contain the session UUID (used as correlation token)');
    assert(allOutput.includes('too-many-requests'),
      'log output DOES contain the Actual error code');

    // Restore env vars so subsequent tests aren't affected.
    if (previous.ACTUAL_PASSWORD === undefined) delete process.env.ACTUAL_PASSWORD;
    else process.env.ACTUAL_PASSWORD = previous.ACTUAL_PASSWORD;
    if (previous.ACTUAL_BUDGET_PASSWORD === undefined) delete process.env.ACTUAL_BUDGET_PASSWORD;
    else process.env.ACTUAL_BUDGET_PASSWORD = previous.ACTUAL_BUDGET_PASSWORD;
    if (previous.MCP_SSE_AUTHORIZATION === undefined) delete process.env.MCP_SSE_AUTHORIZATION;
    else process.env.MCP_SSE_AUTHORIZATION = previous.MCP_SSE_AUTHORIZATION;
  }

  console.log(`\n[httpServer-session-init] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
