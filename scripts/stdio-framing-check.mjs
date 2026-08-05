#!/usr/bin/env node
// stdio-framing-check.mjs
//
// #323 Tier 1: the BLOCKING stdio gate. Asserts that every byte the server
// writes to stdout under --stdio parses as newline-delimited JSON-RPC.
//
// WHY THIS AND NOT THE FULL DUAL-TRANSPORT SUITE.
//
// The ticket was built on "a new @actual-app/api version that adds a
// console.log would silently break every Claude Desktop user". Verified against
// the tree: that is FALSE. src/logger.ts:394-398 already replaces
// console.log/info/warn/error/debug, and @actual-app/api 26.7.0 already calls
// console.log at 14 sites and console.warn/error at 15, and stdio survives them
// today because of that hijack.
//
// The genuinely uncovered failure mode is a direct `process.stdout.write` (or
// any raw write to fd 1) from the dependency, which the console hijack does NOT
// intercept: verified, `process.stdout.write` is patched nowhere in src/. That
// is a FRAMING property, and a byte-level assertion tests it directly. A
// functional suite tests it only incidentally, and could pass while stray bytes
// corrupt a real client's parser.
//
// It is also the only shape that fits the budget. The train's step caps already
// sum to 70 against a 75-minute job; a full dual-transport run is 30 to 35
// minutes and would need roughly 130, which materially raises the chance of a
// job-level CANCEL, the unattributable state #325 exists to prevent. This check
// runs in well under a minute.
//
// The full dual-transport run remains the local main-promotion gate
// (scripts/deploy-and-test.sh, .release/dual-transport-report.json). This does
// not replace it; it gives the AUTOMATED lane a blocking stdio signal.
//
// WHY IT SPAWNS THE SERVER ITSELF rather than using StdioClientTransport: the
// SDK transport consumes stdout to parse frames, so it structurally cannot
// report a raw byte that never formed a frame. That byte is the entire subject
// of this check.

import process from 'node:process';
import { spawn } from 'node:child_process';

/** A line is acceptable stdout only if it is a JSON-RPC 2.0 message. */
export function classifyLine(line) {
  const s = line.trim();
  if (s === '') return { ok: true, kind: 'blank' };
  let parsed;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { ok: false, kind: 'not_json', sample: s.slice(0, 120) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, kind: 'not_an_object', sample: s.slice(0, 120) };
  }
  if (parsed.jsonrpc !== '2.0') {
    return { ok: false, kind: 'not_jsonrpc', sample: s.slice(0, 120) };
  }
  return { ok: true, kind: 'jsonrpc' };
}

/**
 * Every framing violation in a raw stdout capture.
 *
 * Pure, so the whole contract is testable without Docker or a live server.
 */
export function findFramingViolations(raw) {
  return String(raw ?? '')
    .split('\n')
    .map((line, i) => ({ line: i + 1, ...classifyLine(line) }))
    .filter((r) => !r.ok);
}

/** The container command. Two details are load bearing, see the comments. */
export function buildDockerArgs({ container, dataDir }) {
  return [
    'exec', '-i',
    // `docker exec` defaults to ROOT while the server runs as `app` (uid 1001).
    // Root-owned files inside the volume are unusable by the server afterwards.
    '-u', 'app',
    // DATA-DIR ISOLATION (#280). Two @actual-app/api instances must never share
    // one budget cache: that contention wedged the dev environment. This must
    // NOT be /app/data (the HTTP server's own dir) and must NOT be under /tmp,
    // which the test stack mounts READ-ONLY (bootstrap-data:/tmp:ro), where the
    // mkdir would fail silently inside a bare catch and resurface later as an
    // ENOENT during adapter init.
    '-e', `MCP_BRIDGE_DATA_DIR=${dataDir}`,
    container,
    'sh', '-c',
    // The sync id does NOT cross the `docker exec` boundary. The compose
    // `environment:` block does not carry ACTUAL_BUDGET_SYNC_ID; the service
    // entrypoint `export`s it after reading /tmp/actual-sync-id.txt, so it lives
    // in PID 1's runtime environment. `docker exec` builds a new process's env
    // from the container CONFIG, not from PID 1, so it arrives empty. Read the
    // same file the entrypoint reads. (:ro is fine, this only reads.)
    'set -e; '
    + 'if [ -f /tmp/actual-sync-id.txt ]; then export ACTUAL_BUDGET_SYNC_ID="$(cat /tmp/actual-sync-id.txt)"; fi; '
    + `mkdir -p "${dataDir}"; `
    + 'exec node dist/src/index.js --stdio',
  ];
}

const REQUESTS = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'framing-check', version: '1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'actual_accounts_get', arguments: {} } },
];

async function main() {
  const container = process.env.MCP_STDIO_CONTAINER || 'mcp-server-e2e-test';
  const dataDir = process.env.MCP_STDIO_DATA_DIR || '/app/data/stdio-framing';
  const timeoutMs = Number.parseInt(process.env.MCP_STDIO_FRAMING_TIMEOUT_MS ?? '', 10) || 90000;

  const args = buildDockerArgs({ container, dataDir });
  process.stderr.write(`stdio framing check: docker ${args.slice(0, 8).join(' ')} ...\n`);

  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d.toString('utf8'); });
  child.stderr.on('data', (d) => { err += d.toString('utf8'); });

  const done = new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); resolve('closed'); });
    child.on('error', () => { clearTimeout(timer); resolve('spawn_error'); });
  });

  for (const req of REQUESTS) {
    child.stdin.write(`${JSON.stringify(req)}\n`);
    // Small stagger so a response is flushed between requests; the assertion is
    // about bytes, not timing, so this only makes the capture easier to read.
    await new Promise((r) => { setTimeout(r, 1500); });
  }
  child.stdin.end();
  const how = await done;

  const violations = findFramingViolations(out);
  const responses = out.split('\n').filter((l) => l.trim() !== '').length;

  process.stderr.write(`captured ${responses} stdout line(s), ${violations.length} violation(s), exit path: ${how}\n`);

  if (violations.length > 0) {
    process.stderr.write('\n::error::stdout is not clean newline-delimited JSON-RPC. A raw write to fd 1 corrupts every stdio client.\n');
    for (const v of violations.slice(0, 10)) {
      process.stderr.write(`  line ${v.line}: ${v.kind}: ${JSON.stringify(v.sample)}\n`);
    }
    process.exit(1);
  }

  if (responses === 0) {
    process.stderr.write('::error::the server produced NO stdout at all; it did not start or did not respond\n');
    process.stderr.write(`--- stderr tail ---\n${err.slice(-2000)}\n`);
    process.exit(1);
  }

  process.stderr.write('stdio framing OK: every stdout byte parsed as JSON-RPC 2.0\n');
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(`::error::stdio-framing-check: ${e.message}\n`);
    process.exit(1);
  });
}
