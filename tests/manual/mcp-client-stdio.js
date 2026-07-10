/**
 * mcp-client-stdio.js
 *
 * #280: the stdio twin of mcp-client.js, so the FULL integration suite runs over both
 * transports instead of HTTP only. Before this, stdio had four read-only calls
 * (scripts/stdio-smoke.mjs) and zero write-path coverage in the suite.
 *
 * It exposes the SAME seven-method surface as mcp-client.js, because the 13 test modules
 * only destructure `{ callTool }` and the runner uses `initialize`/`listTools`/`callTool`:
 *
 *   { callMCP, callTool, initialize, listTools, getToken, setToken, getSessionId }
 *
 * plus `close()`, which the HTTP client does not need but stdio does (see TEARDOWN).
 *
 * CONTRACT NOTES, each of which is load bearing:
 *
 * 1. `callMCP('tools/call', ...)` returns the RAW MCP envelope `{ content: [...] }`.
 *    tests/manual/tests/advanced.js:267,296 calls it directly and reads the envelope.
 *
 * 2. `callTool()` MUST NOT branch on `isError`. The HTTP client never inspects it: it
 *    takes `content[0].text`, JSON.parses it, and returns `unwrapToolResult(parsed)`, so a
 *    tool failure arrives as `{ error: "..." }`. Module assertions read that shape
 *    directly (tests/manual/tests/account.js:74 reads `badBalance.error`). If this client
 *    branched on `isError` it would return a different shape, and every nil-UUID negative
 *    assertion would silently stop testing anything while still printing a pass.
 *
 * 3. The kill-switches (#133) are per-client CLOSURE state in mcp-client.js, not runner
 *    state, so they are re-implemented here. `MCP_TEST_MAX_SESSION_RETRIES` is HTTP-only:
 *    stdio has no session to expire. It is reported as ignored rather than silently dropped.
 *
 * TEARDOWN
 * --------
 * The transport spawns `docker exec -i <container> node dist/src/index.js --stdio`. An
 * orphaned child holds the container's data dir and is the documented cause of this
 * project's data-dir contention hangs, so close() is idempotent and the runner calls it on
 * every exit path (0, 1, 2, 3, 4) and on SIGINT/SIGTERM.
 */

import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { unwrapToolResult } from '../shared/mcp-protocol.js';

const DEFAULT_MAX_RETRIES = parseInt(process.env.MCP_TEST_MAX_RETRIES || '5', 10);
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.MCP_TEST_CIRCUIT_THRESHOLD || '10', 10);

/**
 * @param {{ container?: string, rl?: object, retryPauseMs?: number }} opts
 */
export function createClient({ container, rl: _rl, retryPauseMs } = {}) {
  const CONTAINER = container || process.env.MCP_STDIO_CONTAINER || 'actual-mcp-bearer-backend';
  // Its OWN budget cache, never the live server's. Under /tmp so the `app` user can create
  // it (the volume root /app is root-owned) and so it is discarded with the container.
  const DATA_DIR = process.env.MCP_STDIO_DATA_DIR || '/tmp/mcp-stdio-data';
  const _retryPauseMs = typeof retryPauseMs === 'number' ? retryPauseMs : 5000;

  if (process.env.MCP_TEST_MAX_SESSION_RETRIES) {
    console.log('  ℹ MCP_TEST_MAX_SESSION_RETRIES is HTTP-only and has no effect over stdio (there is no session to expire).');
  }

  let client = null;
  let transport = null;
  let closed = false;
  let consecutiveFailures = 0;

  function isTransportError(err) {
    const m = String(err?.message || err);
    return (
      m.includes('socket hang up') || m.includes('ECONNRESET') || m.includes('ECONNREFUSED') ||
      m.includes('EPIPE') || m.includes('closed') || m.includes('aborted') || m.includes('timed out')
    );
  }

  async function connect() {
    // Pre-create the isolated data dir as `app`. The server mkdirs it on some paths, but the
    // adapter's legacy init `scandir`s it first, so an absent dir surfaces as ENOENT.
    try {
      execFileSync('docker', ['exec', '-u', 'app', CONTAINER, 'mkdir', '-p', DATA_DIR], { stdio: 'ignore' });
    } catch {
      // Container not reachable yet; connect() will fail with a clearer error below.
    }

    // DATA-DIR ISOLATION (#280). Two @actual-app/api instances must never share one budget
    // cache. `docker exec` inherits MCP_BRIDGE_DATA_DIR=/app/data, which is the directory the
    // live HTTP server is already using, so the stdio pass would put a second writer on the
    // same SQLite files. That is the documented data-dir contention, and it wedged this
    // environment during development: a stale budget directory carrying the same cloudFileId
    // then blocked every re-download until it was moved out of the data dir.
    //
    // -u app: `docker exec` defaults to ROOT while the server runs as `app` (uid 1001).
    // Root-owned files inside the volume are unusable by the server afterwards.
    const args = [
      'exec', '-i',
      '-u', 'app',
      '-e', `MCP_BRIDGE_DATA_DIR=${DATA_DIR}`,
      CONTAINER, 'node', 'dist/src/index.js', '--stdio',
    ];
    transport = new StdioClientTransport({ command: 'docker', args });
    client = new Client({ name: 'actual-mcp-test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  }

  /**
   * Mirrors the HTTP client's callMCP: same retry budget, same circuit breaker, and it
   * returns the RAW result for each method.
   */
  async function callMCP(method, params = {}, _maxRetries = DEFAULT_MAX_RETRIES, _attempt = 0) {
    if (_attempt === 0 && consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      throw new Error(`Circuit breaker open: ${consecutiveFailures} consecutive call failures, server appears unhealthy`);
    }

    try {
      if (!client) await connect();
      let result;
      switch (method) {
        case 'initialize':
          // connect() already performed the handshake. Report the same shape the HTTP
          // client returns so the runner's logging is identical.
          result = { protocolVersion: '2024-11-05', serverInfo: client.getServerVersion?.() ?? {} };
          break;
        case 'tools/list':
          result = await client.listTools();
          break;
        case 'tools/call':
          // Returns { content: [...], isError?: boolean }. Handed back UNTOUCHED:
          // advanced.js reads the envelope, and callTool() below does the unwrapping.
          result = await client.callTool({ name: params.name, arguments: params.arguments ?? {} });
          break;
        default:
          throw new Error(`stdio client does not implement MCP method "${method}"`);
      }
      consecutiveFailures = 0;
      return result;
    } catch (err) {
      if (isTransportError(err) && !closed) {
        consecutiveFailures++;
        if (_attempt >= _maxRetries) {
          throw new Error(`Max retries (${_maxRetries}) exceeded for ${method}: ${err.message}`);
        }
        console.log(`  ⚠ stdio transport lost: pausing then retrying (attempt ${_attempt + 1}/${_maxRetries})...`);
        await hardClose();
        await new Promise((r) => setTimeout(r, _retryPauseMs));
        return callMCP(method, params, _maxRetries, _attempt + 1);
      }
      throw err;
    }
  }

  async function initialize() {
    console.log(`Initializing MCP stdio session (docker exec ${CONTAINER})...`);
    const result = await callMCP('initialize', {});
    console.log('✓ Session initialized: stdio (no session id)');
    console.log('✓ Server info:', result.serverInfo?.name, result.serverInfo?.version);
    return result;
  }

  async function listTools() {
    console.log('Fetching available tools...');
    const result = await callMCP('tools/list', {});
    console.log(`✓ Found ${result.tools.length} tools`);
    return result.tools;
  }

  /** Byte-for-byte the HTTP client's unwrapping. See contract note 2 above. */
  async function callTool(toolName, args = {}) {
    const response = await callMCP('tools/call', { name: toolName, arguments: args });

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

  async function hardClose() {
    try { await client?.close(); } catch { /* already gone */ }
    try { await transport?.close(); } catch { /* already gone */ }
    client = null;
    transport = null;
  }

  /** Idempotent. Safe to call from a signal handler and from `finally`. */
  async function close() {
    if (closed) return;
    closed = true;
    await hardClose();
  }

  // stdio has no bearer auth and no session id. These exist to satisfy the shared
  // interface; the runner calls setToken() unconditionally.
  function getToken() { return null; }
  function setToken(_t) { /* no-op: stdio is authenticated by container access */ }
  function getSessionId() { return null; }

  return { callMCP, callTool, initialize, listTools, getToken, setToken, getSessionId, close };
}
