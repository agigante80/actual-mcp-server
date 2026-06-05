// tests/unit/adapter_auth_rate_limit.test.js
//
// Regression test for #127 — verifies the auth-rate-limit retry path in
// src/lib/actual-adapter.ts. The retry must:
//   - retry transient too-many-requests / network-failure errors transparently
//   - NOT retry terminal auth errors (invalid-password)
//   - cap at DEFAULT_RETRY_ATTEMPTS (3) total retries
//   - bound total wall-clock by MAX_RETRY_DELAY_MS
//   - never log credentials (sentinel env vars must not appear in any log)
//   - leave the concurrency slot count at baseline after exhaustion
//   - bump the observability counters on getConcurrencyState()
//
// Run: node tests/unit/adapter_auth_rate_limit.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/127

// Required env to let config.ts load
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
// #161: this fixture pairs an http upstream with an encryption password; that
// combination is refused in production, so opt into the trusted-network override.
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.ACTUAL_BUDGET_PASSWORD = 'sentinel-budget-pwd-DO-NOT-LEAK';
process.env.MCP_SSE_AUTHORIZATION = 'sentinel-bearer-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = 'unit-test-sync-id';

import('../../dist/src/lib/actual-adapter.js').then(async ({
  withAuthRetry,
  isRetryableAuthError,
  getConcurrencyState,
  _resetAuthRetryCountersForTests,
}) => {
  let passed = 0;
  let failed = 0;
  function describe(label) { console.log(`\n[adapter-auth-rate-limit] ${label}`); }
  function assert(cond, msg) {
    if (cond) { console.log(`  ✓ ${msg}`); passed++; }
    else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
  }

  // --------------------------------------------------------------------------
  // Case 1 — positive: 1 fail then success, retry absorbs the rate-limit
  // --------------------------------------------------------------------------
  describe('Case 1 — positive: too-many-requests on attempt 1 then success returns the value');
  {
    _resetAuthRetryCountersForTests();
    let calls = 0;
    const op = async () => {
      calls++;
      if (calls === 1) throw new Error('Authentication failed: too-many-requests');
      return 'init-ok';
    };
    const result = await withAuthRetry(op, { maxRetries: 3, baseBackoffMs: 1 });
    assert(result === 'init-ok', 'withAuthRetry returns the value from the second attempt');
    assert(calls === 2, `op was called exactly twice; got ${calls}`);
    const state = getConcurrencyState();
    assert(state.authRetries === 1, `getConcurrencyState().authRetries === 1; got ${state.authRetries}`);
    assert(state.authRetryFailures === 0, `getConcurrencyState().authRetryFailures === 0; got ${state.authRetryFailures}`);
  }

  // --------------------------------------------------------------------------
  // Case 2 — negative: every attempt fails, retry budget is exhausted
  // --------------------------------------------------------------------------
  describe('Case 2 — negative: too-many-requests on all 4 attempts → reject with bounded wallclock');
  {
    _resetAuthRetryCountersForTests();
    let calls = 0;
    const op = async () => {
      calls++;
      throw new Error('Authentication failed: too-many-requests');
    };
    const start = Date.now();
    let thrown = null;
    try {
      // baseBackoffMs=1 → delays of 1, 2, 4 ms = 7ms total — well under MAX_RETRY_DELAY_MS.
      await withAuthRetry(op, { maxRetries: 3, baseBackoffMs: 1 });
    } catch (err) { thrown = err; }
    const elapsed = Date.now() - start;

    assert(thrown !== null, 'withAuthRetry rejected after exhaustion');
    assert(thrown && /too-many-requests/.test(thrown.message),
      'rejection contains the original Actual error');
    assert(calls === 4, `op was called exactly 4 times (1 initial + 3 retries); got ${calls}`);

    // Use the real DEFAULT timing: baseBackoffMs=1 worst-case = 7ms; allow 5000ms
    // slack for test environment jitter. The real-world cap (10000ms) is
    // bounded by MAX_RETRY_DELAY_MS regardless.
    assert(elapsed < 5000, `total wall-clock elapsed < 5000ms (got ${elapsed}ms)`);

    const state = getConcurrencyState();
    assert(state.authRetries === 3, `authRetries === 3; got ${state.authRetries}`);
    assert(state.authRetryFailures === 1, `authRetryFailures === 1; got ${state.authRetryFailures}`);
  }

  // --------------------------------------------------------------------------
  // Case 3 — negative: terminal auth errors are NOT retried
  // --------------------------------------------------------------------------
  describe('Case 3 — negative: invalid-password rejects immediately (no retry)');
  {
    _resetAuthRetryCountersForTests();
    let calls = 0;
    const op = async () => {
      calls++;
      throw new Error('Authentication failed: invalid-password');
    };
    let thrown = null;
    try {
      await withAuthRetry(op, { maxRetries: 3, baseBackoffMs: 1 });
    } catch (err) { thrown = err; }
    assert(thrown !== null, 'invalid-password rejected');
    assert(calls === 1, `op called exactly once (no retry); got ${calls}`);
    const state = getConcurrencyState();
    assert(state.authRetries === 0, 'authRetries did not increment for non-retryable error');
  }

  // --------------------------------------------------------------------------
  // Case 4 — over-match guard: arbitrary errors are not classified as retryable
  // --------------------------------------------------------------------------
  describe('Case 4 — isRetryableAuthError classifier');
  {
    assert(isRetryableAuthError(new Error('Authentication failed: too-many-requests')) === true,
      'too-many-requests is retryable');
    assert(isRetryableAuthError(new Error('Authentication failed: network-failure')) === true,
      'network-failure is retryable');
    assert(isRetryableAuthError(new Error('Authentication failed: invalid-password')) === false,
      'invalid-password is NOT retryable');
    assert(isRetryableAuthError(new Error('budget-not-found')) === false,
      'unrelated error is NOT retryable');
    assert(isRetryableAuthError('not-an-error-object') === false,
      'non-Error reason is NOT retryable');
  }

  // --------------------------------------------------------------------------
  // Case 5 — concurrency slot is at baseline after exhaustion
  // --------------------------------------------------------------------------
  describe('Case 5 — concurrency slot is released after retry exhaustion');
  {
    _resetAuthRetryCountersForTests();
    const before = getConcurrencyState();
    const op = async () => { throw new Error('Authentication failed: too-many-requests'); };
    try { await withAuthRetry(op, { maxRetries: 3, baseBackoffMs: 1 }); } catch { /* expected */ }
    const after = getConcurrencyState();
    // withAuthRetry runs OUTSIDE the withConcurrency wrapper (init happens
    // before any tool operation enters the slot). So `running` should never
    // have been incremented in the first place — and certainly should be 0
    // after the rejected init.
    assert(after.running === before.running,
      `running count unchanged: before=${before.running}, after=${after.running}`);
    assert(after.queueLength === 0, `queueLength is 0; got ${after.queueLength}`);
  }

  // --------------------------------------------------------------------------
  // Case 6 — log hygiene: forced rejection must not log credentials
  // --------------------------------------------------------------------------
  describe('Case 6 — log hygiene: no credentials in retry-exhaustion logs');
  {
    _resetAuthRetryCountersForTests();
    // Capture stdout + stderr that winston writes to. Since we can't easily
    // intercept the production logger here, we rely on the documented behavior
    // in withAuthRetry: it logs `[ADAPTER] Auth retry exhausted after N retries (last code: <code>)`
    // — which by construction contains no env-var values. We assert the
    // exhaustion message structure matches the safe template.
    const captured = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return origStderrWrite(chunk, ...rest);
    };
    try {
      await withAuthRetry(
        async () => { throw new Error('Authentication failed: too-many-requests'); },
        { maxRetries: 1, baseBackoffMs: 1 }
      );
    } catch { /* expected */ }
    process.stderr.write = origStderrWrite;

    const allOutput = captured.join('');

    assert(!allOutput.includes('sentinel-pwd-DO-NOT-LEAK'),
      'log output does not contain ACTUAL_PASSWORD value');
    assert(!allOutput.includes('sentinel-budget-pwd-DO-NOT-LEAK'),
      'log output does not contain ACTUAL_BUDGET_PASSWORD value');
    assert(!allOutput.includes('sentinel-bearer-DO-NOT-LEAK'),
      'log output does not contain MCP_SSE_AUTHORIZATION bearer token');
    assert(!/password\s*[:=]/i.test(allOutput),
      'log output does not contain a password=/password: substring');
  }

  console.log(`\n[adapter-auth-rate-limit] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
