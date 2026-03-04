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
export function createClient({ url, rl }) {
  let sessionId = null;
  let requestId = 1;
  let token = null;

  // -------------------------------------------------------------------------
  // Core transport
  // -------------------------------------------------------------------------

  async function callMCP(method, params = {}, _maxRetries = Infinity, _attempt = 0, timeoutMs = 90000) {
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
        response = await fetch(url, {
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

      return result.result;
    } catch (err) {
      // --- 401: prompt for token then retry ---
      if (err.message.includes('401') && !token) {
        console.log("Authorization required. Please provide a valid AUTH TOKEN.");
        const t = await rl.question("Enter AUTH TOKEN: ");
        token = `Bearer ${t.trim()}`;
        return callMCP(method, params);
      }
      // --- Session expired: re-initialize then retry ---
      if (
        err.message.includes('Session expired') ||
        err.message.includes('Session invalid') ||
        err.message.includes('re-initialize')
      ) {
        console.log("  ⚠ Session expired — re-initializing...");
        sessionId = null;
        await initialize();
        return callMCP(method, params, _maxRetries, _attempt, timeoutMs);
      }
      // --- Connection lost: pause then retry with SAME session (TCP dropped, not session expired) ---
      if (
        err.message.includes('socket hang up') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ECONNREFUSED')
      ) {
        if (_attempt >= _maxRetries) throw err;
        console.log("  ⚠ Connection lost — pausing 5s then retrying (session preserved)...");
        await new Promise(r => setTimeout(r, 5000));
        return callMCP(method, params, _maxRetries, _attempt + 1, timeoutMs);
      }
      // --- Request timeout: pause then retry with SAME session ---
      if (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('timed out')) {
        if (_attempt >= _maxRetries) throw err;
        console.log("  ⚠ Request timed out — pausing 5s then retrying (session preserved)...");
        await new Promise(r => setTimeout(r, 5000));
        return callMCP(method, params, _maxRetries, _attempt + 1, timeoutMs);
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
