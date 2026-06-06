// tests/unit/httpServer_session_not_found.test.js
//
// #188: the HTTP transport's unknown/expired-session path must return the MCP
// spec signal HTTP 404 + JSON-RPC -32001 "Session not found" (it previously
// returned a non-spec 400 / -32000), so a spec-compliant client re-initializes
// instead of treating it as a generic error. The tools/list LobeChat-discovery
// shim must stay exempt, and live sessions must be unaffected.
//
// Two-pronged check (matching the repo convention, e.g. httpServer_bearer_auth):
//   1. Behavioural: a faithful replica of the not-found branch decision asserts
//      the routing outcome for each request shape.
//   2. Static source guard: parse src/server/httpServer.ts and assert the
//      production not-found branch carries 404 / -32001 and NOT the old
//      400 / -32000. Reverting the fix re-introduces the old constants and
//      fails this test before merge.
//
// Run: node tests/unit/httpServer_session_not_found.test.js
//
// Linked issue: https://github.com/agigante80/actual-mcp-server/issues/188

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, '../../src/server/httpServer.ts');
const source = readFileSync(sourcePath, 'utf8');

let passed = 0;
let failed = 0;
function ok(msg) { console.log(`  PASS: ${msg}`); passed++; }
function bad(msg) { console.error(`  FAIL: ${msg}`); failed++; }
function assert(cond, msg) { cond ? ok(msg) : bad(msg); }

console.log('Running #188 session-not-found (spec 404 / -32001) tests');

// ----------------------------------------------------------------------------
// 1. Behavioural replica of the POST-handler session branch.
//    Must stay in lockstep with src/server/httpServer.ts (the block around the
//    `if (!transport)` check): an initialize request starts a session; a present
//    transport is routed normally; tools/list with an unknown session hits the
//    LobeChat discovery shim (200 + tools); any other method with an unknown
//    session returns 404 / -32001.
// ----------------------------------------------------------------------------
function decideSessionOutcome({ method, isInitialize, transportPresent }) {
  // Initialize requests are handled as a new session upstream of the not-found
  // branch (a fresh transport is created), so they never 404.
  if (isInitialize) return { kind: 'init' };
  // A live, known session is served normally (pool idle clock is touched, #167).
  if (transportPresent) return { kind: 'route' };
  // Unknown/expired session below this point.
  if (method === 'tools/list') return { kind: 'tools-list-shim', status: 200 };
  return { kind: 'not-found', status: 404, code: -32001 };
}

console.log('\n[behaviour] not-found branch routing');
{
  const r = decideSessionOutcome({ method: 'tools/call', isInitialize: false, transportPresent: false });
  assert(r.kind === 'not-found' && r.status === 404 && r.code === -32001,
    'non-init request with an unknown session returns 404 / -32001');
}
{
  const r = decideSessionOutcome({ method: 'tools/list', isInitialize: false, transportPresent: false });
  assert(r.kind === 'tools-list-shim' && r.status === 200,
    'tools/list with an unknown session returns the discovery shim (200), not a 404');
}
{
  const r = decideSessionOutcome({ method: 'tools/call', isInitialize: false, transportPresent: true });
  assert(r.kind === 'route',
    'a present (live) transport is routed normally, not short-circuited by the not-found branch');
}
{
  const r = decideSessionOutcome({ method: 'initialize', isInitialize: true, transportPresent: false });
  assert(r.kind === 'init',
    'an initialize request with no session id starts a new session (not a 404)');
}

// ----------------------------------------------------------------------------
// 2. Static source guard: the production not-found branch must carry the spec
//    values and must not carry the old non-spec ones. Isolate the branch by
//    slicing from the "not found (method:" warn line to the end of its res.json.
// ----------------------------------------------------------------------------
console.log('\n[source] production not-found branch carries the spec values');
{
  const warnIdx = source.indexOf('not found (method:');
  assert(warnIdx !== -1, 'located the unknown-session warn line in httpServer.ts');

  // The not-found response is the first res.status(...).json after that warn.
  const branch = warnIdx !== -1 ? source.slice(warnIdx, warnIdx + 600) : '';

  assert(/res\.status\(404\)/.test(branch),
    'not-found branch responds with HTTP 404');
  assert(/code:\s*-32001/.test(branch),
    'not-found branch uses JSON-RPC code -32001 (Session not found)');
  assert(!/res\.status\(400\)/.test(branch),
    'not-found branch no longer responds with the non-spec HTTP 400');
  assert(!/code:\s*-32000/.test(branch),
    'not-found branch no longer uses the non-spec JSON-RPC code -32000');
}

console.log('\n[source] tools/list discovery shim is preserved');
{
  // The shim must still short-circuit tools/list on an expired session by
  // returning result.tools, ahead of the not-found branch.
  assert(/method === 'tools\/list'/.test(source),
    'tools/list expired-session shim is still present');
  assert(/result:\s*\{\s*tools\s*\}/.test(source),
    'tools/list shim still returns result: { tools }');
}

console.log(`\n[httpServer-session-not-found] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
