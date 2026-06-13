// tests/unit/entrypoint_invariants.test.js
//
// #227: docker/entrypoint.sh applies the PUID/PGID remap then drops privileges.
// Two invariants are load-bearing and easy to break in a future edit, so this
// guard pins them by source-assertion (a behavioural Docker run is in the Docker
// E2E / local-env layer; this is the fast, CI-friendly check):
//   - FAIL-CLOSED: `set -eu` so a failed remap/chown aborts before the drop, and
//     the app never continues as root.
//   - ZERO STDOUT: the image is shared with stdio users (Claude Desktop) where
//     stdout is reserved for JSON-RPC framing, so every informational `echo` must
//     be redirected to stderr (>&2). One stray stdout line corrupts the framing.
// Plus the structural pieces: the root branch, the chown of both writable dirs,
// the su-exec drop, and the non-root passthrough.
//
// Run: node tests/unit/entrypoint_invariants.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Lines that write to stdout if not redirected. Returns the offending lines (an
// `echo` without a `>&2` redirect). Used positively (real script) and negatively.
function stdoutLeaks(src) {
  return src.split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => /^echo\b/.test(l) && !/>&2/.test(l));
}

console.log('\n[entrypoint-invariants]');

const SH = read('docker/entrypoint.sh');

check('fail-closed: set -eu is present', () => {
  assert(/^\s*set -eu\b/m.test(SH), 'entrypoint must `set -eu` so a failed remap/chown aborts before the drop');
});

check('has the root branch', () => {
  assert(/\[\s*"\$\(id -u\)"\s*=\s*"0"\s*\]/.test(SH), 'missing the `[ "$(id -u)" = "0" ]` root check');
});

check('remaps the user with non-unique-id flag', () => {
  assert(/groupmod -o -g "\$PGID" app/.test(SH), 'missing groupmod -o -g "$PGID" app');
  assert(/usermod -o -u "\$PUID" app/.test(SH), 'missing usermod -o -u "$PUID" app');
});

check('chowns both writable volume dirs', () => {
  assert(/chown -R app:app \/app\/data \/app\/logs/.test(SH), 'must chown -R app:app /app/data /app/logs');
});

check('drops privileges via su-exec, execing the CMD', () => {
  assert(/exec su-exec app "\$@"/.test(SH), 'must `exec su-exec app "$@"` in the root branch');
});

check('non-root path execs the CMD as-is', () => {
  assert(/\nexec "\$@"\s*$/.test(SH) || /^exec "\$@"$/m.test(SH), 'must `exec "$@"` when not root');
});

check('zero stdout: every informational echo is redirected to stderr', () => {
  const leaks = stdoutLeaks(SH);
  assert.strictEqual(leaks.length, 0, `stdout would be written (corrupts stdio JSON-RPC framing): ${leaks.join(' | ')}`);
});

// NEGATIVE fixtures: prove the comparators catch a regression.
check('NEGATIVE: a missing set -e is detected', () => {
  assert(!/^\s*set -eu\b/m.test('#!/bin/sh\nexec "$@"\n'), 'guard must flag a script without set -eu');
});

check('NEGATIVE: an echo without >&2 is detected as a stdout leak', () => {
  const leaks = stdoutLeaks('#!/bin/sh\necho "starting"\nexec "$@"\n');
  assert.deepStrictEqual(leaks, ['echo "starting"'], 'guard must flag an unredirected echo');
});

console.log(`\n[entrypoint-invariants] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
