// tests/unit/dotenv_stdout_quiet.test.js
//
// #501: src/index.ts loads .env BEFORE it imports ./logger.js, the module that hijacks
// console.*. Whatever dotenv prints at that moment reaches the REAL stdout, which under
// --stdio is the JSON-RPC channel, and bypasses the #220 secret redaction. dotenv 18
// writes non-JSON text to stdout in debug mode even when DOTENV_CONFIG_QUIET is set, and
// newly honours DOTENV_OVERRIDE, DOTENV_PATH, DOTENV_ENCODING and DOTENV_FAST. Explicit config() options beat every
// DOTENV_* knob, so the server pins them at its single call, and that is the ONE control.
//
// Each behavioural case spawns a child node in a temp dir holding its own .env. The child
// imports the INSTALLED dotenv by absolute URL, so the temp cwd cannot resolve another
// copy, and its env is a copy of ours with every DOTENV_* key deleted, so a knob set in
// the developer's shell cannot change the result.
//
// fast: false is checked by source only (U4). DOTENV_FAST swaps in dotenv's alternate
// parser, and no .env input was found that the two parse differently, so U3b sets the knob
// but cannot observe it; the pin keeps an environment variable from choosing the parser.
//
// U2 and U3a are WITNESSES: they prove this harness can see dotenv's output and that the
// debug hazard is real on the installed version. Without them, "stdout was empty" in U1
// and U3b could just mean the child never ran dotenv at all.
//
// Run: node tests/unit/dotenv_stdout_quiet.test.js

import assert from 'assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOTENV_URL = pathToFileURL(createRequire(import.meta.url).resolve('dotenv')).href;

// The option set src/index.ts must pass. U4 checks the source carries each of these.
const PINNED = "{ quiet: true, debug: false, override: false, encoding: 'utf8', fast: false, path: path.resolve(process.cwd(), '.env') }";

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const dir = mkdtempSync(join(tmpdir(), 'dotenv-quiet-'));
writeFileSync(join(dir, '.env'), 'DOTENV_TEST_VAR=from-file\nACTUAL_PASSWORD=from-file\n');
writeFileSync(join(dir, 'other.env'), 'DOTENV_TEST_VAR=from-other\n');

function scrubbedEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('DOTENV_')) delete env[k];
  delete env.ACTUAL_PASSWORD;
  return { ...env, ...extra };
}

// Runs dotenv in a child and reports both streams plus the two variables it may set.
// The child's report goes to fd 3, never stdout, so stdout holds only what dotenv wrote.
function runChild(configArg, extraEnv = {}) {
  const script = [
    "import path from 'node:path';",
    "import { writeSync } from 'node:fs';",
    `const dotenv = (await import(${JSON.stringify(DOTENV_URL)})).default;`,
    `dotenv.config(${configArg});`,
    'writeSync(3, JSON.stringify({ v: process.env.DOTENV_TEST_VAR, p: process.env.ACTUAL_PASSWORD }));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: scrubbedEnv(extraEnv),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  assert.strictEqual(r.status, 0, `child exited ${r.status}: ${r.stderr}`);
  return { stdout: r.stdout, stderr: r.stderr, ...JSON.parse(r.output[3]) };
}

console.log('\n[dotenv stdout quiet]');

try {
  check('U1: the pinned options load .env and write nothing to either stream', () => {
    const r = runChild(PINNED);
    assert.strictEqual(r.stdout, '', `stdout: ${JSON.stringify(r.stdout)}`);
    assert.strictEqual(r.stderr, '', `stderr: ${JSON.stringify(r.stderr)}`);
    assert.strictEqual(r.v, 'from-file');
  });

  check('U2 WITNESS: a bare config() is visible to this harness (stderr carries "injected env")', () => {
    const r = runChild('');
    assert.strictEqual(r.stdout, '', `stdout: ${JSON.stringify(r.stdout)}`);
    assert.match(r.stderr, /injected env/);
  });

  check('U3a WITNESS: a bare config() under DOTENV_DEBUG writes non-JSON to stdout even when quiet', () => {
    const r = runChild('', { DOTENV_DEBUG: 'true', DOTENV_CONFIG_QUIET: 'true' });
    const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
    const nonJson = lines.filter((l) => { try { JSON.parse(l); return false; } catch { return true; } });
    assert.ok(nonJson.length > 0, `expected a non-JSON stdout line, got ${JSON.stringify(r.stdout)}`);
  });

  check('U3b: the pinned options beat every DOTENV_* knob and keep a preset secret, silently', () => {
    const r = runChild(PINNED, {
      DOTENV_DEBUG: 'true',
      DOTENV_CONFIG_DEBUG: 'true',
      DOTENV_OVERRIDE: 'true',
      DOTENV_PATH: join(dir, 'other.env'),
      DOTENV_ENCODING: 'bogus',
      DOTENV_CONFIG_ENCODING: 'bogus',
      DOTENV_FAST: 'true',
      ACTUAL_PASSWORD: 'preset',
    });
    assert.strictEqual(r.stdout, '', `stdout: ${JSON.stringify(r.stdout)}`);
    assert.strictEqual(r.stderr, '', `stderr: ${JSON.stringify(r.stderr)}`);
    assert.strictEqual(r.v, 'from-file', 'DOTENV_PATH redirected the load, or DOTENV_ENCODING skipped it');
    assert.strictEqual(r.p, 'preset', 'DOTENV_OVERRIDE replaced a secret already in the environment');
    for (const s of ['preset', 'from-file', 'ACTUAL_PASSWORD']) {
      assert.ok(!(r.stdout + r.stderr).includes(s), `a stream mentions ${s}`);
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

check('U4: src/index.ts makes exactly one dotenv.config call, with the pinned options', () => {
  const src = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
  const calls = src.match(/dotenv\.config\(/g) ?? [];
  assert.strictEqual(calls.length, 1, `expected one dotenv.config( call, found ${calls.length}`);
  const at = src.indexOf('dotenv.config(');
  const arg = src.slice(at, src.indexOf(');', at));
  for (const opt of [/quiet:\s*true/, /debug:\s*false/, /override:\s*false/, /encoding:\s*'utf8'/, /fast:\s*false/, /path:\s*path\.resolve\(process\.cwd\(\), '\.env'/]) {
    assert.match(arg, opt, `the dotenv.config call no longer pins ${opt}`);
  }
});

check('U4: nothing under src/ sets or reads DOTENV_CONFIG_QUIET (one control, not two)', () => {
  const r = spawnSync('grep', ['-rl', 'DOTENV_CONFIG_QUIET', join(ROOT, 'src')], { encoding: 'utf8' });
  assert.strictEqual(r.stdout.trim(), '', `found in: ${r.stdout.trim()}`);
});

check('U5: the installed dotenv is major 18 (the version whose options beat the env knobs)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules/dotenv/package.json'), 'utf8'));
  assert.strictEqual(Number(pkg.version.split('.')[0]), 18, `installed dotenv is ${pkg.version}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
