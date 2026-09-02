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
//
// #387 widened this to a bare `FAIL` token as well, and that was not a hypothetical hardening.
// `notes.js` printed `  FAIL notes_update [...]` thirteen times, imported nothing from assert.js,
// and was therefore completely outside the ledger: the module could report thirteen failed
// assertions and the runner would still exit 0 and the release gate would still write green
// evidence. The ❌-anchored version could not see it because that module simply never used the
// glyph. A guard keyed to one character only guards the modules that happen to use it.
const BARE_FAILURE = /console\.log\(\s*[`'"](?:\\n)?\s*(?:❌|FAIL\b)/;

// #387: the SECOND way a module can report an unexpected result and still pass. A branch that
// prints a warning glyph and returns never touches the ledger, so the module exits 0, the runner
// exits 0, and `deploy-and-test.sh full` writes green evidence. That is not hypothetical: before
// #380 a full dual-transport run reported GREEN on both transports while printing a ZodError,
// which makes the release gate a check that can lie.
//
// Matched on the GLYPH SET rather than on one character, because the point is the shape (a
// diagnostic that does not fail), and a guard keyed to `⚠` alone is worked around by picking a
// different character. Anchored at the START of the argument for the same reason BARE_FAILURE is:
// an interpolated `${err.message}` can legitimately carry any of these mid-string.
//
// The sanctioned escape is `noteTolerated(reason)`, which exists so a branch that genuinely
// accepts either of two upstream behaviours can say WHY, and so a reader can tell that apart from
// a branch nobody finished.
const SILENT_WARNING = /console\.log\(\s*[`'"](?:\\n)?\s*(?:⚠|WARN\b|WARNING\b)/;

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

check('no manual module prints a WARNING and returns without reaching the ledger', () => {
  // The class #387 names: an unexpected result that scrolls past in a log nobody reads before a
  // promotion to main. There were 85 of these across 11 modules when this check was written, and
  // none of them fired in the v0.16.10 gate run, which is precisely why they were invisible.
  const offenders = [];
  for (const file of moduleFiles) {
    const src = readFileSync(join(MODULES_DIR, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (SILENT_WARNING.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepStrictEqual(
    offenders, [],
    `these branches report an outcome without reaching the ledger, so the run still exits 0.\n` +
    `Use fail() when the outcome is wrong, skip() when a precondition is missing, or\n` +
    `noteTolerated(reason) when BOTH outcomes are genuinely acceptable and you can say why:\n  ${offenders.join('\n  ')}`,
  );
});

check('the warning guard is proven to CATCH the shape it exists for', () => {
  // Without these it is a regex nobody has ever seen match, which is how #382 happened.
  assert.ok(SILENT_WARNING.test('    console.log("  ⚠ unexpected response");'));
  assert.ok(SILENT_WARNING.test('  console.log(`  ⚠ got ${x} items`);'));
  assert.ok(SILENT_WARNING.test('    console.log(`\\n  ⚠ teardown failed`);'));
  // and on a different glyph, so it is not worked around by picking another character
  assert.ok(SILENT_WARNING.test('    console.log("WARNING: unexpected");'));
});

check('the warning guard does NOT flag the sanctioned forms', () => {
  assert.ok(!SILENT_WARNING.test('    noteTolerated(`older builds lack the endpoint: ${e}`);'));
  assert.ok(!SILENT_WARNING.test('    skip("no account in context");'));
  assert.ok(!SILENT_WARNING.test('    fail(`unexpected: ${x}`);'));
  assert.ok(!SILENT_WARNING.test('    console.log(`  ✓ rejected: ${err.message}`);'));
  // an interpolated upstream message that happens to carry the glyph is not a silent branch
  assert.ok(!SILENT_WARNING.test('    console.log(`  ✓ got ${msg} ⚠ inside`);'));
});

check('noteTolerated exists and is exported, or the guard recommends a helper that is not there', () => {
  const assertSrc = readFileSync(join(ROOT, 'tests', 'manual', 'assert.js'), 'utf8');
  assert.ok(/export function noteTolerated\s*\(/.test(assertSrc), 'assert.js does not export noteTolerated');
});

check('every module that reports a failure imports from assert.js', () => {
  const missing = [];
  for (const file of moduleFiles) {
    const src = readFileSync(join(MODULES_DIR, file), 'utf8');
    const usesLedger = /\b(fail|expect|skip|noteTolerated)\s*\(/.test(src);
    const imports = /from '\.\.\/assert\.js'/.test(src);
    if (usesLedger && !imports) missing.push(file);
  }
  assert.deepStrictEqual(missing, [], `modules use fail()/expect()/skip() without importing assert.js: ${missing.join(', ')}`);
});

check('the guard regex is proven to CATCH a bare failure print', () => {
  // If the regex ever stops matching the very thing it guards, it is not a guard.
  assert.ok(BARE_FAILURE.test('    console.log("  ❌ Verify: broke");'));
  assert.ok(BARE_FAILURE.test('  console.log(`  ❌ thing ${x}`);'));
  // the shape that was invisible for the life of this guard until #387
  assert.ok(BARE_FAILURE.test('      console.log(`  FAIL notes_update [set note]: ${x}`);'));
});

check('the guard regex does NOT flag mid-message validator text or ✓/⏭ lines', () => {
  assert.ok(!BARE_FAILURE.test('    console.log(`  ✓ ok: ${err.message}`);'));      // a pass line carrying err text
  assert.ok(!BARE_FAILURE.test('    console.log(`  ⏭ skipped`);'));                  // a skip line
  assert.ok(!BARE_FAILURE.test('    fail(`got ${msg}`);'));                                // the correct helper call
  assert.ok(!BARE_FAILURE.test('    console.log(`result: ❌ inside message`);'));      // ❌ not at the start
  assert.ok(!BARE_FAILURE.test('    console.log(`  ✓ rejected: FAILED to parse`);'));   // FAIL mid-message, in a pass line
  assert.ok(!BARE_FAILURE.test('    fail(`notes_get: ${x}`);'));                        // the correct helper call
});

console.log(`\n[manual-assertions-use-helper] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
