/**
 * mcp-client.js
 *
 * MCP JSON-RPC 2.0 transport layer. All network I/O, session lifecycle, and
 * reconnect / retry logic lives here. Nothing in this file knows about Actual
 * Budget semantics or test levels.
 *
 * Usage:
 *   const client = createClient({ url, rl });
 *   client.setToken('Bearer abc123');
 *   await client.initialize();
 *   const result = await client.callTool('actual_accounts_list', {});
 */

import fetch from 'node-fetch';
import { unwrapToolResult } from '../shared/mcp-protocol.js';

/**
 * Create a stateful MCP client.
 *
 * @param {{ url: string, rl: import('node:readline/promises').Interface }} opts
 * @returns {{ callMCP, callTool, initialize, listTools, getToken, setToken, getSessionId }}
 */
// ---------------------------------------------------------------------------
// Kill-switch defaults — see tests/manual/README.md and issue #133.
// Override via env vars to relax in genuinely-slow environments, or tighten in
// CI to fail faster.
// ---------------------------------------------------------------------------
const DEFAULT_MAX_RETRIES = parseInt(process.env.MCP_TEST_MAX_RETRIES || '5', 10);
const DEFAULT_MAX_SESSION_RETRIES = parseInt(process.env.MCP_TEST_MAX_SESSION_RETRIES || '3', 10);
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.MCP_TEST_CIRCUIT_THRESHOLD || '10', 10);

export function createClient({ url, rl, fetchImpl, retryPauseMs }) {
  let sessionId = null;
  let requestId = 1;
  let token = null;

  // Test seams (production callers omit these):
  //   fetchImpl     — override the network transport (default: imported node-fetch)
  //   retryPauseMs  — override the 5s pause between retries (default: 5000ms)
  const _fetch = fetchImpl || fetch;
  const _retryPauseMs = typeof retryPauseMs === 'number' ? retryPauseMs : 5000;

  // Per-client circuit breaker: counts callMCP invocations that hit ANY retry
  // path consecutively. Reset to 0 on the first invocation that completes
  // without entering a retry branch. Once it reaches CIRCUIT_BREAKER_THRESHOLD
  // the next invocation rejects synchronously rather than starting fresh
  // 5s-pause cycles against an unhealthy server.
  let consecutiveFailures = 0;

  // Per-client session-reset counter, separate from connectionLost retries.
  // Lives in the closure (not in the callMCP arglist) because initialize()
  // recurses by calling callMCP("initialize", ...) with no _sessionAttempt
  // parameter, which would otherwise reset a per-call counter every time. The
  // closure-state counter is reset to 0 on any successful response.
  let consecutiveSessionResets = 0;

  // -------------------------------------------------------------------------
  // Core transport
  // -------------------------------------------------------------------------

  async function callMCP(method, params = {}, _maxRetries = DEFAULT_MAX_RETRIES, _attempt = 0, timeoutMs = 90000, _sessionAttempt = 0) {
    // Circuit breaker — only checked on a fresh invocation (_attempt === 0 &&
    // _sessionAttempt === 0) so in-flight retry chains complete naturally.
    if (_attempt === 0 && _sessionAttempt === 0 && consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      throw new Error(`Circuit breaker open — ${consecutiveFailures} consecutive call failures, server appears unhealthy`);
    }
    const payload = {
      jsonrpc: "2.0",
      id: requestId++,
      method,
      params,
    };

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(token ? { "Authorization": token } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs); // per-call timeout (default 90s; pass higher for slow ops like bank sync)
      let response;
      try {
        response = await _fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      // Capture session ID from response header when first established
      const newSessionId = response.headers.get('mcp-session-id');
      if (newSessionId && !sessionId) {
        sessionId = newSessionId;
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`MCP Error ${result.error.code}: ${result.error.message}`);
      }

      // Successful response: reset both counters so transient recovered
      // failures don't stay armed forever.
      consecutiveFailures = 0;
      consecutiveSessionResets = 0;
      return result.result;
    } catch (err) {
      // --- 401: prompt for token then retry ---
      if (err.message.includes('401') && !token) {
        console.log("Authorization required. Please provide a valid AUTH TOKEN.");
        const t = await rl.question("Enter AUTH TOKEN: ");
        token = `Bearer ${t.trim()}`;
        return callMCP(method, params);
      }
      // --- Session expired: re-initialize then retry (capped at DEFAULT_MAX_SESSION_RETRIES) ---
      if (
        err.message.includes('Session expired') ||
        err.message.includes('Session invalid') ||
        err.message.includes('re-initialize')
      ) {
        consecutiveFailures++;
        consecutiveSessionResets++;
        if (consecutiveSessionResets > DEFAULT_MAX_SESSION_RETRIES) {
          throw new Error(`Max session re-initializations (${DEFAULT_MAX_SESSION_RETRIES}) exceeded for ${method} — last error: ${err.message}`);
        }
        console.log(`  ⚠ Session expired — re-initializing (attempt ${consecutiveSessionResets}/${DEFAULT_MAX_SESSION_RETRIES})...`);
        sessionId = null;
        await initialize();
        return callMCP(method, params, _maxRetries, _attempt, timeoutMs, _sessionAttempt);
      }
      // --- Connection lost: pause then retry with SAME session (TCP dropped, not session expired) ---
      if (
        err.message.includes('socket hang up') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ECONNREFUSED')
      ) {
        consecutiveFailures++;
        if (_attempt >= _maxRetries) {
          throw new Error(`Max retries (${_maxRetries}) exceeded for ${method} — last error: ${err.message}`);
        }
        console.log(`  ⚠ Connection lost — pausing 5s then retrying (attempt ${_attempt + 1}/${_maxRetries}, session preserved)...`);
        await new Promise(r => setTimeout(r, _retryPauseMs));
        return callMCP(method, params, _maxRetries, _attempt + 1, timeoutMs, _sessionAttempt);
      }
      // --- Request timeout: pause then retry with SAME session ---
      if (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('timed out')) {
        consecutiveFailures++;
        if (_attempt >= _maxRetries) {
          throw new Error(`Max retries (${_maxRetries}) exceeded for ${method} — last error: ${err.message}`);
        }
        console.log(`  ⚠ Request timed out — pausing 5s then retrying (attempt ${_attempt + 1}/${_maxRetries}, session preserved)...`);
        await new Promise(r => setTimeout(r, _retryPauseMs));
        return callMCP(method, params, _maxRetries, _attempt + 1, timeoutMs, _sessionAttempt);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // High-level helpers
  // -------------------------------------------------------------------------

  async function initialize() {
    console.log("Initializing MCP session...");
    const result = await callMCP("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "actual-mcp-test-client",
        version: "1.0.0",
      },
    });
    console.log("✓ Session initialized:", sessionId);
    console.log("✓ Server info:", result.serverInfo?.name, result.serverInfo?.version);
    return result;
  }

  async function listTools() {
    console.log("Fetching available tools...");
    const result = await callMCP("tools/list", {});
    console.log(`✓ Found ${result.tools.length} tools`);
    return result.tools;
  }

  async function callTool(toolName, args = {}) {
    const response = await callMCP("tools/call", {
      name: toolName,
      arguments: args,
    });

    // Unwrap MCP envelope: tools return { content: [{ text: '{"result":...}' }] }
    if (response && response.content && response.content[0]) {
      const textContent = response.content[0].text;
      if (textContent) {
        try {
          const parsed = JSON.parse(textContent);
          return unwrapToolResult(parsed);
        } catch {
          return textContent;
        }
      }
    }

    return response;
  }

  // -------------------------------------------------------------------------
  // Token accessors (runner sets the token after reading CLI args / prompt)
  // -------------------------------------------------------------------------

  function getToken() { return token; }
  function setToken(t) { token = t; }
  function getSessionId() { return sessionId; }

  return { callMCP, callTool, initialize, listTools, getToken, setToken, getSessionId };
}
