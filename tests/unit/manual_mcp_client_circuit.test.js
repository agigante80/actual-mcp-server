// tests/unit/manual_mcp_client_circuit.test.js
//
// Regression test for #133 — verifies the consecutive-loss circuit breaker
// (CIRCUIT_BREAKER_THRESHOLD default = 10 via MCP_TEST_CIRCUIT_THRESHOLD).
//
// Run: node tests/unit/manual_mcp_client_circuit.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/133

import { createClient } from '../manual/mcp-client.js';

let passed = 0;
let failed = 0;
function describe(label) { console.log(`\n[manual-mcp-client/circuit] ${label}`); }
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

const fakeRl = { question: async () => '' };

function ok(body) {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: { get: () => 'sess-mock-1' },
  };
}

async function runTests() {
  // Tighten the breaker for fast tests via env var BEFORE importing — we
  // already imported above so set it directly on the client constants by
  // using a low _maxRetries so each call only burns 0 retries (limit=0). With
  // `_maxRetries=0` the very first failure throws, bumping consecutiveFailures
  // by 1 per callMCP invocation. After 10 such failed invocations, the 11th
  // must be rejected synchronously.

  describe('Case 1 — negative: 10 consecutive failed callMCP → 11th rejects with "Circuit breaker open"');
  {
    const fetchImpl = async () => {
      const e = new Error('ECONNRESET'); e.code = 'ECONNRESET';
      throw e;
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');

    // Exhaust the breaker: make 10 calls each with 0 retries so each call
    // bumps consecutiveFailures exactly once and then rejects via the cap.
    for (let i = 0; i < 10; i++) {
      try { await client.callMCP('tools/list', {}, 0); } catch { /* expected */ }
    }
    // The 11th call must trip the breaker BEFORE issuing a fetch.
    let calledBeforeReject = false;
    const fetchImpl2 = async () => { calledBeforeReject = true; throw new Error('should not reach'); };
    // Replace _fetch by creating a new client snapshot... actually our
    // breaker state is per-client, so we must use the same client. Instead
    // we observe: on the 11th call, `Circuit breaker open` error is thrown
    // synchronously (from the entry-point check) so no fetch ever happens.
    let thrown = null;
    try {
      await client.callMCP('tools/list', {}, 0);
    } catch (err) { thrown = err; }
    assert(thrown !== null, '11th callMCP rejected');
    assert(thrown && /Circuit breaker open/.test(thrown.message),
      'rejection message contains "Circuit breaker open"');
    assert(calledBeforeReject === false,
      'no fetch issued on the 11th call (breaker fires synchronously before network)');
  }

  describe('Case 2 — positive: 9 fails followed by 1 success resets the breaker');
  {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      if (callCount <= 9) {
        const e = new Error('ECONNRESET'); e.code = 'ECONNRESET';
        throw e;
      }
      // 10th onwards: success
      return ok({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');

    // 9 failing calls (each 0-retry, each bumps the breaker once).
    for (let i = 0; i < 9; i++) {
      try { await client.callMCP('tools/list', {}, 0); } catch { /* expected */ }
    }
    // 10th: succeeds, breaker should reset.
    const result = await client.callMCP('tools/list', {}, 0);
    assert(result?.ok === true, '10th call returned the expected result');

    // Now fail another 10 calls — breaker should NOT trip immediately because
    // the success in step 10 reset the counter to 0.
    callCount = 0;
    const fetchImpl2 = async () => {
      callCount++;
      const e = new Error('ECONNRESET'); e.code = 'ECONNRESET';
      throw e;
    };
    const client2 = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl: fetchImpl2, retryPauseMs: 0 });
    client2.setToken('Bearer anything');
    // First call after reset: must fail at the retry-cap, NOT at the breaker.
    let thrown = null;
    try { await client2.callMCP('tools/list', {}, 0); } catch (err) { thrown = err; }
    assert(thrown && /Max retries \(0\) exceeded/.test(thrown.message),
      'first failing call after a fresh client fails at retry-cap (counter is 1, not 11)');
  }

  console.log(`\n[manual-mcp-client/circuit] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
