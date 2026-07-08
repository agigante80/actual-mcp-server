#!/usr/bin/env node
// stdio-smoke.mjs
// Functional smoke test of the --stdio transport.
//
// The HTTP integration suite (tests/manual/index.js) only exercises the HTTP
// bearer container, so stdio had no functional coverage. This drives the same
// server over stdin/stdout and does a real round-trip against the live Actual
// server: initialize, tools/list, and two read-only tool calls.
//
// It runs the server INSIDE the already-healthy bearer container via
// `docker exec` so it reuses that container's exact config and network access
// with no secrets on the host. Override the container with MCP_STDIO_CONTAINER.
//
// Exit codes: 0 = pass, 1 = fail (so the pipeline can gate on it).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTAINER = process.env.MCP_STDIO_CONTAINER || 'actual-mcp-bearer-backend';
const EXPECTED = process.env.EXPECTED_TOOL_COUNT ? Number(process.env.EXPECTED_TOOL_COUNT) : null;
const TIMEOUT_MS = Number(process.env.MCP_STDIO_SMOKE_TIMEOUT_MS || 60000);

const fail = (msg) => {
  console.error(`\n✗ STDIO SMOKE: FAIL. ${msg}`);
  process.exit(1);
};

// Buffer the server's (noisy) stderr and only surface it if something breaks.
const transport = new StdioClientTransport({
  command: 'docker',
  args: ['exec', '-i', CONTAINER, 'node', 'dist/src/index.js', '--stdio'],
  stderr: 'pipe',
});
let serverStderr = '';
transport.stderr?.on('data', (c) => { serverStderr += c.toString(); });

const client = new Client({ name: 'stdio-smoke', version: '1.0.0' }, { capabilities: {} });

const withTimeout = (p, label) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${TIMEOUT_MS}ms during: ${label}`)), TIMEOUT_MS)),
]);

const textOf = (res) => res?.content?.find((c) => c.type === 'text')?.text ?? '';

try {
  await withTimeout(client.connect(transport), 'connect/initialize');
  const info = client.getServerVersion();
  console.log(`  ok connected over stdio: ${info?.name} v${info?.version}`);

  const { tools } = await withTimeout(client.listTools(), 'tools/list');
  if (EXPECTED != null && tools.length !== EXPECTED) {
    fail(`tool count ${tools.length} != expected ${EXPECTED}`);
  }
  console.log(`  ok tools/list: ${tools.length} tools${EXPECTED != null ? ` (expected ${EXPECTED})` : ''}`);

  const ver = await withTimeout(client.callTool({ name: 'actual_server_get_version', arguments: {} }), 'actual_server_get_version');
  if (ver.isError) fail(`actual_server_get_version returned isError: ${textOf(ver)}`);
  const verText = textOf(ver);
  if (!/\d+\.\d+\.\d+/.test(verText)) fail(`actual_server_get_version gave no version string: ${verText}`);
  console.log(`  ok actual_server_get_version: ${verText}`);

  const acc = await withTimeout(client.callTool({ name: 'actual_accounts_list', arguments: {} }), 'actual_accounts_list');
  if (acc.isError) fail(`actual_accounts_list returned isError: ${textOf(acc)}`);
  const accCount = (textOf(acc).match(/"id"/g) || []).length;
  console.log(`  ok actual_accounts_list: ${accCount} account(s)`);

  await client.close();
  console.log('\n✓ STDIO SMOKE: PASS');
  process.exit(0);
} catch (e) {
  if (serverStderr.trim()) {
    console.error('\n--- server stderr (last 2000 chars) ---');
    console.error(serverStderr.slice(-2000));
  }
  fail(e?.message || String(e));
}
