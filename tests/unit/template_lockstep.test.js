// tests/unit/template_lockstep.test.js
//
// #605: scripts/check-template-lockstep.sh must FAIL when its canonical
// ticket-standards doc is missing, instead of silently dropping it from the lock.
// A stale default path used to pass and quietly unlock the doc.
//
// Each case runs the real script with `spawnSync('bash', [script, ...])` in a temp
// git repository (the no-arg run cds to the git toplevel of its CWD, so the temp
// repo keeps it hermetic). The fixture holds two work templates at
// template-version 6.
//
// Run: node tests/unit/template_lockstep.test.js

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-template-lockstep.sh');
const DEFAULT_DOC = 'docs/development/ticket-standards.md';

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** A temp git repo with two v6 work templates, plus the extra files given. */
function repo(extra = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'template-lockstep-'));
  fixtures.push(tmp);
  const init = spawnSync('git', ['init', '-q', tmp], { encoding: 'utf8' });
  assert.strictEqual(init.status, 0, `git init failed: ${init.stderr}`);
  const files = {
    '.github/ISSUE_TEMPLATE/a.yml': '# <!-- template-version: 6 -->\nname: a\n',
    '.github/ISSUE_TEMPLATE/b.yml': '# <!-- template-version: 6 -->\nname: b\n',
    ...extra,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(tmp, rel)), { recursive: true });
    writeFileSync(join(tmp, rel), content);
  }
  return tmp;
}

function run(cwd, args = []) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

console.log('\n[template lockstep]');

check('no-arg run with the default doc at the shared version exits 0 and locks 3 files', () => {
  const cwd = repo({ [DEFAULT_DOC]: '<!-- template-version: 6 -->\n# Ticket standards\n' });
  const r = run(cwd);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /all 3 versioned files at template-version 6\./);
});

check('no-arg run with the default doc at another version exits 1 (drift)', () => {
  const cwd = repo({ [DEFAULT_DOC]: '<!-- template-version: 5 -->\n' });
  const r = run(cwd);
  assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /DRIFT/);
});

check('no-arg run with the default doc absent exits 1 and names it', () => {
  const cwd = repo();
  const r = run(cwd);
  assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.ok(
    r.stderr.includes(`canonical doc not found: ${DEFAULT_DOC}`),
    `stderr did not name the doc: ${r.stderr}`,
  );
});

check('an explicit absent $2 exits 1 and names it', () => {
  const cwd = repo();
  const r = run(cwd, ['.github/ISSUE_TEMPLATE', 'docs/nope.md']);
  assert.strictEqual(r.status, 1, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.ok(r.stderr.includes('canonical doc not found: docs/nope.md'), `stderr: ${r.stderr}`);
});

check('the template dir alone checks templates only and exits 0', () => {
  const cwd = repo();
  const r = run(cwd, ['.github/ISSUE_TEMPLATE']);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /all 2 versioned files at template-version 6\./);
});

check('the real repository passes with its doc in the lock', () => {
  const r = run(ROOT);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /all \d+ versioned files at template-version \d+\./);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
