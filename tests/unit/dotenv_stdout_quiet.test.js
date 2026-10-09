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
// fast: false is checked by source only (U4, dotenvProblems). DOTENV_FAST swaps in dotenv's alternate
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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTsComments } from './helpers/source-text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOTENV_URL = pathToFileURL(createRequire(import.meta.url).resolve('dotenv')).href;

// The option set the child cases pass (dotenvProblems pins the same options in src/index.ts).
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

// #533: the dotenv load-path guard. `files` maps a repo-relative path to stripTsComments text;
// returns a sorted string[], [] when clean. A bounded text scanner (typescript 7 has no JS
// scanner API): it resolves the dotenv specifiers, the one `config(` call and the one binding.
const DOTENV_PINS = [
  /quiet:\s*true/, /debug:\s*false/, /override:\s*false/, /encoding:\s*'utf8'/, /fast:\s*false/,
  /path:\s*path\.resolve\(process\.cwd\(\), '\.env'\)/,
];
const INDEX = 'src/index.ts';

function dotenvProblems(files) {
  const problems = new Set();
  const specRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)(['"])dotenv(\/[^'"]*)?\1/g;
  for (const [path, text] of Object.entries(files)) {
    for (const m of text.matchAll(specRe)) {
      if (path !== INDEX) problems.add(`${path}: loads dotenv (only ${INDEX} may)`);
      if (m[2]) problems.add(`${path}: imports the dotenv subpath 'dotenv${m[2]}'`);
    }
    if (/\bconfigDotenv\s*\(/.test(text)) problems.add(`${path}: calls configDotenv(`);
  }
  const idx = files[INDEX] ?? '';
  const calls = [...idx.matchAll(/\bconfig\s*\(/g)];
  const written = calls.length === 1 && idx.slice(0, calls[0].index).endsWith('dotenv.');
  let callAt = -1;
  if (!written) {
    problems.add(`${INDEX}: expected exactly one config( call, written dotenv.config(, found ${calls.length}`);
  } else {
    callAt = calls[0].index;
    const open = idx.indexOf('(', callAt);
    let depth = 0;
    let end = -1;
    let quote = '';
    for (let i = open; i < idx.length && end < 0; i++) {
      const c = idx[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) end = i;
    }
    const arg = idx.slice(open + 1, end < 0 ? idx.length : end).trim();
    if (!(arg.startsWith('{') && arg.endsWith('}'))) {
      problems.add(`${INDEX}: the dotenv.config argument is not an object literal`);
    } else {
      if (arg.includes('...')) problems.add(`${INDEX}: the dotenv.config argument uses a spread`);
      for (const pin of DOTENV_PINS) {
        if (!pin.test(arg)) problems.add(`${INDEX}: the dotenv.config call no longer pins ${pin}`);
      }
    }
  }
  const decl = idx.match(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*(['"])dotenv\2\s*\)/);
  if (!decl) {
    problems.add(`${INDEX}: dotenv is not bound by const <name> = await import('dotenv')`);
  } else {
    const declAt = decl.index + decl[0].indexOf(decl[1], 'const'.length);
    const uses = [...idx.matchAll(new RegExp(`(?<![.\\w$'"])${decl[1].replace(/\$/g, '\\$&')}(?![\\w$])`, 'g'))];
    // The allowed call occurrence is the binding just before `.config(`.
    const callBinding = callAt >= 0 ? callAt - 'dotenv.'.length : -1;
    if (uses.some((u) => u.index !== declAt && u.index !== callBinding)) {
      problems.add(`${INDEX}: the dotenv binding is used other than the one dotenv.config( call`);
    }
  }
  return [...problems].sort();
}

function srcTsFiles(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? srcTsFiles(rel) : rel.endsWith('.ts') ? [rel] : [];
  });
}
const liveSrc = () => Object.fromEntries(srcTsFiles('src').map((f) => [f, stripTsComments(readFileSync(join(ROOT, f), 'utf8'))]));
const rawIndex = readFileSync(join(ROOT, INDEX), 'utf8');
// The raw dotenv.config({...}); statement in the live file, so fixtures follow the file.
const cfgStart = rawIndex.indexOf('dotenv.config(');
const cfgEnd = rawIndex.indexOf(');', cfgStart) + 2;
const cfgStmt = rawIndex.slice(cfgStart, cfgEnd);
const withIndex = (raw, extra = {}) => ({ ...liveSrc(), [INDEX]: stripTsComments(raw), ...extra });

check('U4: src/ loads dotenv once, in src/index.ts, with the pinned options (comment-stripped, #533)', () => {
  assert.deepStrictEqual(dotenvProblems(liveSrc()), []);
});

check('#533 P6, U7 to U9d: dotenvProblems fixtures', () => {
  assert.ok(cfgStmt.endsWith('});'), 'fixture anchor: the dotenv.config statement');
  assert.deepStrictEqual(dotenvProblems(withIndex(rawIndex)), []); // P6
  assert.deepStrictEqual(
    dotenvProblems(withIndex(rawIndex.replace(cfgStmt, `/* ${cfgStmt} */\n(await import('dotenv')).config();`))), // U7
    ['src/index.ts: expected exactly one config( call, written dotenv.config(, found 1']);
  assert.deepStrictEqual(
    dotenvProblems({ ...liveSrc(), 'src/lib/env.ts': "import 'dotenv/config';" }), // U8
    ["src/lib/env.ts: imports the dotenv subpath 'dotenv/config'", 'src/lib/env.ts: loads dotenv (only src/index.ts may)']);
  assert.deepStrictEqual(
    dotenvProblems({ ...liveSrc(), 'src/lib/env.ts': "import { configDotenv } from 'dotenv';\nconfigDotenv();" }), // U8b
    ['src/lib/env.ts: calls configDotenv(', 'src/lib/env.ts: loads dotenv (only src/index.ts may)']);
  assert.deepStrictEqual(
    dotenvProblems(withIndex(rawIndex.replace('dotenv.config({', 'dotenv.config({ ...opts,'))), // U9
    ['src/index.ts: the dotenv.config argument uses a spread']);
  assert.deepStrictEqual(
    dotenvProblems(withIndex(rawIndex.replace(cfgStmt, `${cfgStmt}\n    const c = dotenv.config; c();`))), // U9c
    ['src/index.ts: the dotenv binding is used other than the one dotenv.config( call']);
  assert.deepStrictEqual(
    dotenvProblems(withIndex(rawIndex.replace(cfgStmt, `${cfgStmt}\n    dotenv['config']();`))), // U9d
    ['src/index.ts: the dotenv binding is used other than the one dotenv.config( call']);
  const b = dotenvProblems(withIndex(rawIndex.replace('quiet: true,', '/* quiet: true, */ quiet: false,'))); // U9b
  assert.strictEqual(b.length, 1, JSON.stringify(b));
  assert.match(b[0], /no longer pins .*quiet/);
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
