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
// #382 ADDS a second group to this file: the three CLI-entrypoint behaviours that used to
// live in `tests/e2e/stdio.spec.ts`. That file was collected by NEITHER Playwright config,
// so it had never executed once since it was added. Playwright bought it nothing (no
// browser, no fixtures, no server: just spawn the entrypoint and assert an exit code), and
// cost it everything, because an uncollected spec is silently inert. Here they are blocking.
//
// Run: node tests/unit/entrypoint_invariants.test.js

import assert from 'assert';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
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

// ── #382: CLI entrypoint behaviour, spawned for real ────────────────────────────
// Source-assertions above; these actually run `dist/src/index.js`. They need a build,
// which the test:unit-js chain already has (npm run build precedes it in the documented
// pre-commit sequence and in CI's Run Tests job).

async function checkAsync(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const ENTRY = join(ROOT, 'dist', 'src', 'index.js');

// These three cases spawn the BUILT entrypoint. `test:unit-js` does not itself build, and
// while both the documented pre-commit sequence and CI's Run Tests job run `npm run build`
// first, someone running this file alone against a clean checkout would otherwise get an
// opaque spawn failure. Say what is actually wrong.
check('the build these cases spawn is present', () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing. Run \`npm run build\` first.`);
});
// Deliberately unreachable upstream: these cases must not depend on a live Actual server,
// and must not touch the developer's real data dir.
// Removed on exit rather than leaked once per run. The spawned server may populate it.
const ENTRY_DATA_DIR = mkdtempSync(join(tmpdir(), 'mcp-entrypoint-'));
process.on('exit', () => { try { rmSync(ENTRY_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const ENTRY_ENV = {
  ...process.env,
  ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
  ACTUAL_PASSWORD: 'test',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-4000-8000-000000000000',
  // A throwaway dir OUTSIDE the repo. The spec file this came from pointed at
  // `<repo>/test-actual-data`, which is not gitignored, so a future change that made the
  // entrypoint create its data dir eagerly would have started dirtying the working tree.
  ACTUAL_DATA_DIR: ENTRY_DATA_DIR,
  LOG_LEVEL: 'error',
};

/** Spawn the entrypoint and resolve with { code, stderr }, killing it after `killAfterMs`. */
function runEntry(args, { killAfterMs, onStart, env } = {}) {
  return new Promise((resolve, reject) => {
    // #502: `env` overlays the child env; an `undefined` value REMOVES an inherited variable.
    const childEnv = { ...ENTRY_ENV, ...(args.includes('--stdio') ? { MCP_STDIO_MODE: 'true' } : {}), ...env };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    const proc = spawn(process.execPath, [ENTRY, ...args], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    const timer = killAfterMs
      ? setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`did not exit within ${killAfterMs}ms. stderr: ${stderr.slice(0, 300)}`)); }, killAfterMs)
      : null;
    proc.on('error', reject);
    proc.on('exit', (code) => { if (timer) clearTimeout(timer); resolve({ code, stderr, stdout }); });
    if (onStart) onStart(proc);
  });
}

await checkAsync('--http and --stdio together exit 1 with a mutual-exclusion message', async () => {
  const { code, stderr } = await runEntry(['--http', '--stdio'], { killAfterMs: 10_000 });
  assert.strictEqual(code, 1, `expected exit 1, got ${code}`);
  assert(/mutually exclusive/i.test(stderr), `stderr must explain the conflict, got: ${stderr.slice(0, 200)}`);
});

await checkAsync('--stdio starts and stays up rather than exiting on its own', async () => {
  // A crash-on-boot regression exits early. Staying up for the window IS the assertion.
  let proc;
  const settled = await Promise.race([
    runEntry(['--stdio'], { onStart: (p) => { proc = p; } }).then((r) => ({ exited: r })),
    new Promise((r) => setTimeout(() => r({ stillUp: true }), 3000)),
  ]);
  if (proc) proc.kill('SIGTERM');
  assert(settled.stillUp, `exited early with code ${settled.exited?.code}. stderr: ${settled.exited?.stderr?.slice(0, 300)}`);
});

await checkAsync('--stdio exits cleanly when stdin closes', async () => {
  // Claude Desktop terminates the server by closing stdin. A regression here leaves an
  // orphaned process holding the data dir, which is this project's documented cause of
  // data-dir contention hangs.
  const { code } = await runEntry(['--stdio'], {
    killAfterMs: 8000,
    onStart: (p) => setTimeout(() => p.stdin.end(), 1500),
  });
  assert.strictEqual(code, 0, `expected a clean exit 0 after stdin close, got ${code}`);
});

// ── #502: no non-JSON byte on stdout before the logger loads (stdio) ──────────────
// Two sources print via console.log before src/logger.ts replaces console.*: the --debug
// notice, and @dabh/diagnostics (winston.createLogger) when DEBUG/DIAGNOSTICS is set and
// NODE_ENV is not production. ENTRY_ENV inherits process.env, so every case pins
// NODE_ENV/DEBUG/DIAGNOSTICS; otherwise a production shell makes diagnostics a no-op and
// the cases pass vacuously.
const CLEAN = { NODE_ENV: undefined, DEBUG: undefined, DIAGNOSTICS: undefined };
const runStdio = (args, env) => runEntry(args, {
  killAfterMs: 8000,
  env,
  onStart: (p) => setTimeout(() => p.stdin.end(), 1500),
});

await checkAsync('#502 U1: --stdio --debug writes 0 bytes to stdout; notice and diagnostics go to stderr', async () => {
  const { code, stdout, stderr } = await runStdio(['--stdio', '--debug'], CLEAN);
  assert.strictEqual(code, 0, `expected exit 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
  assert.strictEqual(stdout, '', `stdout must be empty, got: ${JSON.stringify(stdout.slice(0, 300))}`);
  assert(stderr.includes('Debug mode enabled'), 'the notice must still be printed (on stderr)');
  assert(stderr.includes('winston:create-logger'), 'witness: diagnostics must have fired, else an empty stdout proves nothing');
});

await checkAsync('#502 U2: --stdio with user-set DEBUG=* writes 0 bytes to stdout', async () => {
  const { code, stdout, stderr } = await runStdio(['--stdio'], { ...CLEAN, DEBUG: '*' });
  assert.strictEqual(code, 0, `expected exit 0, got ${code}. stderr: ${stderr.slice(0, 300)}`);
  assert.strictEqual(stdout, '', `stdout must be empty, got: ${JSON.stringify(stdout.slice(0, 300))}`);
  assert(stderr.includes('winston:create-logger'), 'witness: diagnostics must have fired');
});

await checkAsync('#502 U3: control, plain --stdio has empty stdout and no diagnostics noise', async () => {
  const { code, stdout, stderr } = await runStdio(['--stdio'], CLEAN);
  assert.strictEqual(code, 0, `expected exit 0, got ${code}`);
  assert.strictEqual(stdout, '', `stdout must be empty, got: ${JSON.stringify(stdout.slice(0, 300))}`);
  assert(!stderr.includes('winston:create-logger'), 'the U1/U2 witness must be caused by enabling DEBUG, not unconditional');
});

/** Structural violations of the #502 pre-logger redirect in the source of src/index.ts. */
function preLoggerGuardViolations(src) {
  const v = [];
  const lines = src.split('\n');
  const calls = lines.filter((l) => {
    const t = l.trim();
    return t.includes('installPreLoggerStderrConsole()') && !t.startsWith('//') && !t.startsWith('*')
      && !/function\s+installPreLoggerStderrConsole\s*\(/.test(t);
  });
  if (calls.length !== 1) v.push(`installPreLoggerStderrConsole() must be called exactly once, found ${calls.length}`);
  const guarded = "if (argsEarly.includes('--stdio')) installPreLoggerStderrConsole();";
  if (calls.length !== 1 || calls[0].trim() !== guarded) v.push(`the call must be exactly: ${guarded}`);
  const callAt = calls.length ? src.indexOf(calls[0]) : -1;
  const dotenvAt = src.indexOf("import('dotenv')");
  const loggerAt = src.indexOf("import('./logger.js')");
  if (callAt < 0 || dotenvAt < 0 || loggerAt < 0 || callAt > dotenvAt || callAt > loggerAt) {
    v.push("the call must precede both import('dotenv') and import('./logger.js')");
  }
  const m = /if \(argsEarly\.includes\('--debug'\)\) \{([\s\S]*?)\n  \}/.exec(src);
  if (!m) v.push('could not locate the --debug block');
  else if (/console\./.test(m[1])) v.push('the --debug block must not call console.*');
  return v;
}

check('#502 U4: src/index.ts installs the stdio-only redirect first and the --debug block has no console.*', () => {
  assert.deepStrictEqual(preLoggerGuardViolations(read('src/index.ts')), []);
});

check('#502 U5: NEGATIVE fixtures prove the U4 predicate can fail', () => {
  const good = [
    "  if (argsEarly.includes('--stdio')) installPreLoggerStderrConsole();",
    "  const dotenv = await import('dotenv');",
    "  if (argsEarly.includes('--debug')) {",
    "    process.stderr.write('Debug mode enabled\\n');",
    "  }",
    "  const l = await import('./logger.js');",
  ];
  assert.deepStrictEqual(preLoggerGuardViolations(good.join('\n')), [], 'the fixture baseline must be clean');
  const a = [...good]; a[0] = '  installPreLoggerStderrConsole();';
  assert(preLoggerGuardViolations(a.join('\n')).some((x) => /exactly: /.test(x)), '(a) missing --stdio guard not caught');
  const b = [...good]; [b[0], b[5]] = [b[5], b[0]];
  assert(preLoggerGuardViolations(b.join('\n')).some((x) => /precede/.test(x)), '(b) call after logger import not caught');
  const c = [...good]; c[3] = "    console.log('Debug mode enabled');";
  assert(preLoggerGuardViolations(c.join('\n')).some((x) => /console/.test(x)), '(c) console.log in --debug block not caught');
});

console.log(`\n[entrypoint-invariants] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
