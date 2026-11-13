#!/usr/bin/env node
// stdio-smoke.mjs
// Functional smoke test of the --stdio transport.
//
// The HTTP integration suite (tests/manual/index.js) only exercises the HTTP
// bearer container, so stdio had no functional coverage. This drives the same
// server over stdin/stdout and does a real round-trip against the live Actual
// server: initialize, tools/list, and two read-only compact tool calls (get_context, list_entities).
//
// It runs the server INSIDE the already-healthy bearer container via
// `docker exec` so it reuses that container's exact config and network access
// with no secrets on the host. Override the container with MCP_STDIO_CONTAINER.
//
// Exit codes: 0 = pass, 1 = fail (so the pipeline can gate on it).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { stdioExecArgs, prepareStdioDataDir } from './lib/harness-stdio.mjs';

const CONTAINER = process.env.MCP_STDIO_CONTAINER || 'actual-mcp-bearer-backend';
// #575: its own data dir, never the HTTP server's /app/data.
const DATA_DIR = '/tmp/mcp-stdio-smoke-data';
const EXPECTED = process.env.EXPECTED_TOOL_COUNT ? Number(process.env.EXPECTED_TOOL_COUNT) : null;
const TIMEOUT_MS = Number(process.env.MCP_STDIO_SMOKE_TIMEOUT_MS || 60000);

const fail = (msg) => {
  console.error(`\n✗ STDIO SMOKE: FAIL. ${msg}`);
  process.exit(1);
};

// Buffer the server's (noisy) stderr and only surface it if something breaks.
prepareStdioDataDir(CONTAINER, DATA_DIR);
const transport = new StdioClientTransport({
  command: 'docker',
  args: stdioExecArgs({ container: CONTAINER, dataDir: DATA_DIR }),
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

  // #681: compact calls. The smoke server runs the surface the container is configured with
  // (compact when MCP_TOOL_SURFACE is unset since #680); the compact tools are published on
  // `compact` and `all`, and the deploy script refuses a count mismatch via EXPECTED_TOOL_COUNT above.
  const ver = await withTimeout(client.callTool({ name: 'get_context', arguments: { topic: 'version' } }), 'get_context topic=version');
  if (ver.isError) fail(`get_context topic=version returned isError: ${textOf(ver)}`);
  const verText = textOf(ver);
  if (!/\d+\.\d+\.\d+/.test(verText)) fail(`get_context topic=version gave no version string: ${verText}`);
  console.log(`  ok get_context topic=version: ${verText}`);

  const acc = await withTimeout(client.callTool({ name: 'list_entities', arguments: { type: 'account' } }), 'list_entities type=account');
  if (acc.isError) fail(`list_entities type=account returned isError: ${textOf(acc)}`);
  const accCount = (textOf(acc).match(/"id"/g) || []).length;
  console.log(`  ok list_entities type=account: ${accCount} account(s)`);

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
