// tests/unit/check_coverage.test.js
//
// #187: guards the API coverage auditor (scripts/list-actual-api-methods.mjs).
// The old script hardcoded a 37-entry tool list that drifted from the real 70.
// This test asserts the auditor now (a) sources the tool set from the real
// registry (count matches the dist tool files), (b) maps every method to a tool
// that actually exists (mapping integrity), (c) never buckets a covered method
// as a gap, (d) buckets lifecycle methods as internal, (e) reports an empty
// genuine-gaps bucket against the current API, and still (f) surfaces a real
// gap when one exists (via a synthetic method).
//
// Run: node tests/unit/check_coverage.test.js

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// @actual-app/api needs navigator at import time (Node 20). Polyfill before import.
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { platform: 'Linux', userAgent: `Node.js/${process.version}` };
}

const here = dirname(fileURLToPath(import.meta.url));
const { analyzeCoverage, readImplementedTools, API_TO_TOOL, INTERNAL_METHODS } =
  await import('../../scripts/list-actual-api-methods.mjs');
const ActualApi = await import('@actual-app/api');

let passed = 0, failed = 0;
function ok(m) { console.log(`  PASS: ${m}`); passed++; }
function bad(m) { console.error(`  FAIL: ${m}`); failed++; }
function assert(c, m) { c ? ok(m) : bad(m); }

console.log('Running #187 check:coverage auditor tests');

const realMethods = Object.keys(ActualApi).filter(k => typeof ActualApi[k] === 'function');

// (a) the parser matches the real registry (catches the original under-report).
console.log('\n[registry sourcing]');
{
  const tools = readImplementedTools();
  const fileCount = readdirSync(resolve(here, '../../dist/src/tools'))
    .filter(f => f.endsWith('.js') && f !== 'index.js').length;
  assert(tools.length === fileCount,
    `parser tool count (${tools.length}) equals dist tool-file count (${fileCount})`);
  assert(new Set(tools).size === tools.length, 'no duplicate tool names parsed');
  assert(tools.every(t => t.startsWith('actual_')), 'every parsed name is an actual_ tool');
  // The pre-#187 bug: a hardcoded 37. Ensure we are well past that.
  assert(tools.length > 37, `parser is not stuck at the old hardcoded count (${tools.length} > 37)`);
}

// (b)-(e) classify the real API surface.
console.log('\n[coverage analysis: real API surface]');
{
  const { covered, internal, gaps, mappingErrors } = analyzeCoverage({ apiMethodsOverride: realMethods });
  assert(mappingErrors.length === 0,
    `no mapping errors (every mapped tool exists in IMPLEMENTED_TOOLS); got ${JSON.stringify(mappingErrors)}`);
  assert(gaps.length === 0,
    `genuine-gaps bucket is empty against the current API; got ${JSON.stringify(gaps)}`);
  assert(covered.some(c => c.method === 'getSchedules' && c.tool === 'actual_schedules_get'),
    'a known-covered method (getSchedules) is in the covered bucket');
  assert(internal.includes('init') && internal.includes('shutdown'),
    'known lifecycle methods (init, shutdown) are in the internal bucket');
  assert(!gaps.includes('getSchedules') && !gaps.includes('createTag'),
    'covered methods (getSchedules, createTag) are never in the gaps bucket');
}

// (f) a real gap still surfaces, proven with a synthetic uncovered method.
console.log('\n[synthetic gap detection]');
{
  const SYNTH = '__totally_uncovered_method__';
  const { gaps } = analyzeCoverage({ apiMethodsOverride: [...realMethods, SYNTH] });
  assert(gaps.includes(SYNTH), 'a synthetic uncovered method appears in the gaps bucket');
  assert(!gaps.includes('getAccounts'), 'a covered method does not leak into gaps when a synthetic gap is present');
}

// mapping-integrity check actually fires when the registry lacks a mapped tool.
console.log('\n[mapping-integrity check fires]');
{
  const { mappingErrors } = analyzeCoverage({ apiMethodsOverride: realMethods, implementedToolsOverride: [] });
  assert(mappingErrors.length === Object.keys(API_TO_TOOL).length,
    'with an empty registry, every mapped method is reported as a mapping error');
}

console.log(`\n[check-coverage] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
