// tests/unit/manual_mcp_client_session.test.js
//
// Regression test for #133 — verifies the session-expired retry cap
// (`_sessionAttempt` default = 3 via MCP_TEST_MAX_SESSION_RETRIES).
//
// Run: node tests/unit/manual_mcp_client_session.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/133

import { createClient } from '../manual/mcp-client.js';

let passed = 0;
let failed = 0;
function describe(label) { console.log(`\n[manual-mcp-client/session] ${label}`); }
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

const fakeRl = { question: async () => '' };

// Always returns a JSON-RPC error with "Session expired" — both the initialize
// call and the regular tool call will trip the session-expired branch.
function sessionExpiredResponse() {
  return {
    ok: true,
    text: async () => '',
    json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Session expired' } }),
    headers: { get: () => null },
  };
}

async function runTests() {
  describe('Case 1 — negative: every call returns "Session expired" → bails after MAX_SESSION_RETRIES (3)');
  {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return sessionExpiredResponse();
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');
    let thrown = null;
    try {
      await client.callMCP('tools/list', {});
    } catch (err) { thrown = err; }
    assert(thrown !== null, 'callMCP rejected (did not infinitely recurse)');
    assert(thrown && /Max session re-initializations \(3\) exceeded/.test(thrown.message),
      'error message contains "Max session re-initializations (3) exceeded"');
    // The recursion path is: initial tools/list (1) → re-init1 (1) → tools/list#2 (1) → re-init2 (1) → tools/list#3 (1) → re-init3 (1) → tools/list#4 (1, throws cap).
    // Each `Session expired` from initialize() also bumps the counter for
    // `tools/list`'s _sessionAttempt — so we expect a bounded, finite number
    // of fetch calls (definitely < the old infinite loop).
    assert(calls > 0 && calls < 20, `fetchImpl was called a bounded number of times: ${calls} (expected >0 and <20)`);
  }

  console.log(`\n[manual-mcp-client/session] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
