// tests/unit/manual_assertions_use_helper.test.js
//
// #281: keeps the manual integration modules honest. Every assertion failure must go
// through fail()/expect() in tests/manual/assert.js so it reaches the runner's ledger and
// FAILS the run. A bare `console.log("  ❌ ...")` bypasses the ledger and silently exits 0,
// which is the exact defect this ticket fixed. This test fails the build if any module
// reintroduces one, so the fix cannot rot when a new module is added later.
//
// The regex is anchored to a `❌` at the START of the console.log argument (a quote/backtick
// then optional whitespace then ❌). It therefore matches a bare failure print but NOT:
//   - the query validator's `❌`-prefixed error text interpolated MID-message
//     (src/lib/query-validator.ts:257), which reaches a test only inside `${err.message}`,
//   - assert.js's own internal `console.log(\`  ❌ ${message}\`)` (assert.js is excluded).
//
// Run: node tests/unit/manual_assertions_use_helper.test.js

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES_DIR = join(ROOT, 'tests', 'manual', 'tests');

// A bare failure print: console.log( <quote> <optional ws> ❌ ...
const BARE_FAILURE = /console\.log\(\s*[`'"]\s*❌/;

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[manual-assertions-use-helper]');

const moduleFiles = readdirSync(MODULES_DIR).filter((f) => f.endsWith('.js'));

check('the module set is real (guards against an empty glob passing vacuously)', () => {
  assert.ok(moduleFiles.length >= 10, `expected >= 10 test modules, found ${moduleFiles.length}`);
});

check('no manual module prints a bare console.log("❌ ...") that bypasses fail()', () => {
  const offenders = [];
  for (const file of moduleFiles) {
    const src = readFileSync(join(MODULES_DIR, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (BARE_FAILURE.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepStrictEqual(
    offenders, [],
    `these failure prints bypass the ledger and would silently exit 0:\n  ${offenders.join('\n  ')}`,
  );
});

check('every module that reports a failure imports from assert.js', () => {
  const missing = [];
  for (const file of moduleFiles) {
    const src = readFileSync(join(MODULES_DIR, file), 'utf8');
    const usesLedger = /\b(fail|expect|skip)\s*\(/.test(src);
    const imports = /from '\.\.\/assert\.js'/.test(src);
    if (usesLedger && !imports) missing.push(file);
  }
  assert.deepStrictEqual(missing, [], `modules use fail()/expect()/skip() without importing assert.js: ${missing.join(', ')}`);
});

check('the guard regex is proven to CATCH a bare failure print', () => {
  // If the regex ever stops matching the very thing it guards, it is not a guard.
  assert.ok(BARE_FAILURE.test('    console.log("  ❌ Verify: broke");'));
  assert.ok(BARE_FAILURE.test('  console.log(`  ❌ thing ${x}`);'));
});

check('the guard regex does NOT flag mid-message validator text or ✓/⏭ lines', () => {
  assert.ok(!BARE_FAILURE.test('    console.log(`  ✓ ok: ${err.message}`);'));      // a pass line carrying err text
  assert.ok(!BARE_FAILURE.test('    console.log(`  ⏭ skipped`);'));                  // a skip line
  assert.ok(!BARE_FAILURE.test('    fail(`got ${msg}`);'));                                // the correct helper call
  assert.ok(!BARE_FAILURE.test('    console.log(`result: ❌ inside message`);'));      // ❌ not at the start
});

console.log(`\n[manual-assertions-use-helper] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
