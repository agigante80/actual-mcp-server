// tests/unit/manual_mcp_client_retry.test.js
//
// Regression test for #133 — verifies the connection-lost retry cap
// (`_maxRetries` default = 5, configurable via MCP_TEST_MAX_RETRIES).
//
// Run: node tests/unit/manual_mcp_client_retry.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/133

import { createClient } from '../manual/mcp-client.js';

let passed = 0;
let failed = 0;

function describe(label) { console.log(`\n[manual-mcp-client/retry] ${label}`); }
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

// Mock readline interface (never actually called in these tests because we
// pre-set the auth token).
const fakeRl = { question: async () => '' };

// Mock response builder — fetch returns a minimal Response-shape object.
function ok(body) {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: { get: () => 'sess-mock-1' },
  };
}

async function runTests() {
  describe('Case 1 — positive: one ECONNRESET then success returns the result with 1 retry');
  {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        const e = new Error('ECONNRESET'); e.code = 'ECONNRESET';
        throw e;
      }
      return ok({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'x' }] } });
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');
    const result = await client.callMCP('tools/list', {});
    assert(calls === 2, 'fetchImpl was called exactly twice (one fail, one success)');
    assert(Array.isArray(result?.tools), 'result is the JSON-RPC `result` payload');
  }

  describe('Case 2 — negative: 5 consecutive ECONNRESET → rejects with "Max retries (5) exceeded"');
  {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      const e = new Error('ECONNRESET'); e.code = 'ECONNRESET';
      throw e;
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');
    let thrown = null;
    try {
      await client.callMCP('tools/list', {});
    } catch (err) {
      thrown = err;
    }
    assert(thrown !== null, 'callMCP rejected (did not livelock)');
    assert(thrown && /Max retries \(5\) exceeded/.test(thrown.message),
      'error message contains "Max retries (5) exceeded"');
    // 1 initial + 5 retries = 6 fetch calls.
    assert(calls === 6, `fetchImpl was called exactly 6 times (1 initial + 5 retries); got ${calls}`);
  }

  describe('Case 3 — negative: explicit lower _maxRetries (2) is honoured');
  {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      const e = new Error('socket hang up');
      throw e;
    };
    const client = createClient({ url: 'http://stub', rl: fakeRl, fetchImpl, retryPauseMs: 0 });
    client.setToken('Bearer anything');
    let thrown = null;
    try {
      await client.callMCP('tools/list', {}, 2);
    } catch (err) { thrown = err; }
    assert(thrown !== null, 'callMCP rejected with maxRetries=2');
    assert(thrown && /Max retries \(2\) exceeded/.test(thrown.message),
      'error message reflects the caller-supplied retry cap');
    assert(calls === 3, `fetchImpl was called exactly 3 times (1 initial + 2 retries); got ${calls}`);
  }

  console.log(`\n[manual-mcp-client/retry] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
