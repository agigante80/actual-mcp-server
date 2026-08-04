// tests/unit/api_coverage_baseline.test.js
//
// #321: guards the COMMITTED baseline file itself. api_surface_drift.test.js
// exercises validateBaseline against inline fixtures; this asserts the real
// docs/audit/api-coverage-baseline.json satisfies it.
//
// Why this is a separate file: the baseline is hand-edited by maintainers
// accepting a gap. A malformed edit there is a silent failure, because the drift
// lane cannot block anything by design, so a broken baseline would just quietly
// stop suppressing redness with nobody told.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateBaseline, validateMethodName } from '../../scripts/api-surface-drift.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATH = join(ROOT, 'docs', 'audit', 'api-coverage-baseline.json');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const raw = readFileSync(PATH, 'utf8');

check('the committed baseline is valid JSON', () => {
  // The first revision of #321 shipped a sample with `"issue": 000`, which is
  // not valid JSON: leading zeros are forbidden. Parse it for real.
  JSON.parse(raw);
});

const baseline = JSON.parse(raw);

check('the committed baseline satisfies the schema', () => {
  assert.deepStrictEqual(validateBaseline(baseline), []);
});

check('every accepted key is a safe method name', () => {
  for (const key of Object.keys(baseline.accepted ?? {})) {
    assert.ok(validateMethodName(key), `${key} must match the method-name pattern`);
  }
});

check('the accepted set is within its own declared cap', () => {
  assert.ok(Object.keys(baseline.accepted ?? {}).length <= baseline.maxAccepted,
    'the committed baseline must not itself exceed maxAccepted; raising the cap is a reviewed commit');
});

check('there is no global apiVersion field', () => {
  // Provenance is per entry deliberately: a single global field would lose which
  // upgrade introduced which gap, and would invite asserting it against the live
  // version, which is exactly the non-hermetic coupling this ticket removed.
  assert.strictEqual(baseline.apiVersion, undefined,
    'apiVersion belongs on each entry, never at the top level');
});

check('the file documents that it is human-maintained', () => {
  assert.ok(typeof baseline._comment === 'string' && baseline._comment.length > 0,
    'the rationale must travel with the file');
});

console.log(`\n[api-coverage-baseline] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
