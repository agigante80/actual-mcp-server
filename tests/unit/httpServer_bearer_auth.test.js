// Tests for the hardened static-Bearer auth path in httpServer.ts (#157).
//
// Two-pronged check:
//   1. Behavioural: replicate the comparison logic from authenticateRequest
//      and assert it returns the right answer in constant time. Verifies the
//      Buffer-length short-circuit and timingSafeEqual usage are correct.
//   2. Static-analysis log-leak guard: parse the source file and forbid any
//      debug-log line that includes token contents (the strings that were
//      logged before this fix landed). Removing the fix would re-introduce
//      one of these strings; the test catches it before merge.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, '../../src/server/httpServer.ts');
const source = readFileSync(sourcePath, 'utf8');

console.log('Running #157 bearer-auth hardening tests');

let passed = 0;
let failed = 0;
function ok(msg) {
  console.log(`  PASS: ${msg}`);
  passed++;
}
function bad(msg) {
  console.error(`  FAIL: ${msg}`);
  failed++;
}

// Replica of the production comparison logic. Must stay in lockstep with
// src/server/httpServer.ts:authenticateRequest. If the production code
// changes, this replica should change identically.
function compareToken(token, expected) {
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// 1. Matching tokens: returns true.
{
  const result = compareToken('MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6', 'MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6');
  if (result === true) ok('matching tokens return true');
  else bad(`matching tokens should return true, got ${result}`);
}

// 2. Mismatched tokens, same length: returns false.
{
  const result = compareToken('MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6', 'MCP-BEARER-LOCAL-XXXXXXXXXXXXXXXXX');
  if (result === false) ok('same-length mismatched tokens return false');
  else bad(`same-length mismatch should return false, got ${result}`);
}

// 3. Different lengths: returns false without calling timingSafeEqual (which would throw).
{
  let threw = false;
  try {
    compareToken('short', 'this-is-a-much-longer-string');
  } catch (e) {
    threw = true;
  }
  const result = compareToken('short', 'this-is-a-much-longer-string');
  if (result === false && !threw) ok('different-length tokens return false without throwing');
  else bad(`different-length tokens should return false without throwing, got ${result}, threw=${threw}`);
}

// 4. Empty token vs configured non-empty: returns false.
{
  const result = compareToken('', 'something');
  if (result === false) ok('empty token returns false');
  else bad(`empty token should return false, got ${result}`);
}

// 5. Empty configured vs non-empty token: returns false.
{
  const result = compareToken('something', '');
  if (result === false) ok('empty configured returns false');
  else bad(`empty configured should return false, got ${result}`);
}

// 6. Log-leak guard: forbid debug-log strings that previously dumped token contents.
//    Each string is a substring of one of the five lines removed by this fix.
//    Re-introducing any of them re-introduces a token leak in debug logs.
const FORBIDDEN_LOG_PATTERNS = [
  'Auth header received',
  'Extracted token',
  'Expected token',
  'Tokens equal',
  'Token hex dump',
];
for (const pat of FORBIDDEN_LOG_PATTERNS) {
  if (source.includes(pat)) {
    bad(`Source file contains forbidden debug-log pattern: "${pat}". See #157.`);
  } else {
    ok(`source does not log "${pat}"`);
  }
}

// 7. Source uses timingSafeEqual.
if (source.includes('timingSafeEqual')) {
  ok('source uses timingSafeEqual');
} else {
  bad('source must use timingSafeEqual; not found');
}

// 8. Source no longer uses bare !== for the auth comparison.
//    More specific match: the prior code had `token !== config.MCP_SSE_AUTHORIZATION`.
if (source.includes('token !== config.MCP_SSE_AUTHORIZATION')) {
  bad('source still contains non-constant-time comparison `token !== config.MCP_SSE_AUTHORIZATION`. See #157.');
} else {
  ok('source no longer uses non-constant-time comparison for the bearer token');
}

console.log(`\n#157 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
