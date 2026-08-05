// tests/unit/stdio_framing_check.test.js
//
// #323 Tier 1. The framing contract is pure, so the whole thing is testable
// without Docker, a live Actual server, or a 30-minute suite.
//
// What is under test: stdout under --stdio must be newline-delimited JSON-RPC
// and nothing else. The console hijack in src/logger.ts already neutralises
// console.log, so the uncovered risk is a direct process.stdout.write, which is
// a FRAMING violation. A byte assertion catches it; a functional suite might
// pass while stray bytes corrupt a real client's parser.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  classifyLine, findFramingViolations, buildDockerArgs,
} from '../../scripts/stdio-framing-check.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const RESP = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}';

// --- what is acceptable -------------------------------------------------------

check('a JSON-RPC response line is clean', () => {
  assert.strictEqual(classifyLine(RESP).ok, true);
});

check('blank lines are tolerated', () => {
  assert.strictEqual(classifyLine('').ok, true);
  assert.strictEqual(classifyLine('   ').ok, true);
});

check('a clean multi-line capture has zero violations', () => {
  const raw = `${RESP}\n${RESP}\n`;
  assert.deepStrictEqual(findFramingViolations(raw), []);
});

// --- the failure this check exists for ---------------------------------------

check('THE RISK: a raw process.stdout.write is caught', () => {
  // The console hijack does not intercept this. It is why the check exists.
  const raw = `${RESP}\nDownloading budget...\n${RESP}\n`;
  const v = findFramingViolations(raw);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].kind, 'not_json');
  assert.strictEqual(v[0].line, 2, 'the offending line number must be reported');
  assert.ok(v[0].sample.includes('Downloading'), 'the offending bytes must be shown');
});

check('a partial write that is not JSON at all is caught', () => {
  assert.strictEqual(findFramingViolations('\x1b[32mINFO\x1b[0m ready\n').length, 1);
});

check('valid JSON that is NOT JSON-RPC is caught', () => {
  // A dependency dumping a JSON blob to stdout parses, but corrupts the stream.
  const v = findFramingViolations('{"level":"info","msg":"loaded"}\n');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].kind, 'not_jsonrpc');
});

check('a JSON array or scalar is caught', () => {
  assert.strictEqual(findFramingViolations('[1,2,3]\n')[0].kind, 'not_an_object');
  assert.strictEqual(findFramingViolations('42\n')[0].kind, 'not_an_object');
  assert.strictEqual(findFramingViolations('null\n')[0].kind, 'not_an_object');
});

check('a wrong jsonrpc version is caught', () => {
  assert.strictEqual(findFramingViolations('{"jsonrpc":"1.0","id":1}\n')[0].kind, 'not_jsonrpc');
});

check('every violation is reported, not just the first', () => {
  const raw = `oops\n${RESP}\nalso bad\n`;
  assert.strictEqual(findFramingViolations(raw).length, 2);
});

// --- the two CI blockers, encoded so they cannot regress ---------------------

const args = buildDockerArgs({ container: 'mcp-server-e2e-test', dataDir: '/app/data/stdio-framing' });
const joined = args.join(' ');

check('BLOCKER 1: the sync id is read from the file, not inherited', () => {
  // ACTUAL_BUDGET_SYNC_ID does NOT cross the docker exec boundary. The compose
  // environment: block does not carry it; the service entrypoint exports it
  // after reading /tmp/actual-sync-id.txt, so it lives in PID 1's runtime env.
  // docker exec builds a new process's env from container CONFIG, not PID 1.
  assert.ok(joined.includes('/tmp/actual-sync-id.txt'),
    'the spawn must read the same file the entrypoint reads');
  assert.ok(joined.includes('export ACTUAL_BUDGET_SYNC_ID'),
    'and export it into the stdio process');
});

check('BLOCKER 2: the data dir is writable, and is neither /tmp nor /app/data', () => {
  const dd = args[args.indexOf('-e') + 1];
  assert.ok(dd.startsWith('MCP_BRIDGE_DATA_DIR='));
  const path = dd.split('=')[1];
  assert.ok(!path.startsWith('/tmp'),
    'the test stack mounts bootstrap-data at /tmp READ-ONLY, so mkdir there fails silently');
  assert.notStrictEqual(path, '/app/data',
    '#280: two @actual-app/api instances must never share one budget cache');
  assert.ok(joined.includes(`mkdir -p "${path}"`), 'the dir must be created before the server starts');
});

check('the exec runs as app, not root', () => {
  // docker exec defaults to ROOT while the server runs as app (uid 1001).
  // Root-owned files in the volume are unusable by the server afterwards.
  assert.ok(joined.includes('-u app'));
});

// --- scope guard --------------------------------------------------------------

check('this check does NOT claim to replace the full dual-transport gate', () => {
  // Whitespace collapsed first: the phrase wraps across a comment line break in
  // the source, so a naive regex misses it and the guard reads as a failure of
  // the code rather than of the assertion.
  const src = readFileSync(new URL('../../scripts/stdio-framing-check.mjs', import.meta.url), 'utf8')
    .replace(/\s*\n\s*\/\/\s*/g, ' ')
    .replace(/\s+/g, ' ');
  assert.ok(/deploy-and-test\.sh/.test(src), 'it must name the gate it does not replace');
  assert.ok(/does not replace it/i.test(src),
    'the local main-promotion gate remains the full run; this is the automated-lane signal');
});

check('the SDK transport is deliberately NOT used', () => {
  // StdioClientTransport consumes stdout to parse frames, so it structurally
  // cannot report a raw byte that never formed a frame. That byte is the entire
  // subject of this check.
  const src = readFileSync(new URL('../../scripts/stdio-framing-check.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/StdioClientTransport/.test(src),
    'using the SDK transport would hide the exact bytes this check exists to find');
});

console.log(`\n[stdio-framing-check] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
