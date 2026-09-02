// tests/unit/playwright_version_drift.test.js
//
// #385: guards scripts/playwright-version-drift.mjs itself, and the real tree through it.
//
// Two Playwright versions are in play at once and they were pinned in different files: the E2E
// suite runs inside `mcr.microsoft.com/playwright:v<x>-jammy`, and `npm ci` inside that container
// then installs `@playwright/test` from the lockfile. Nothing checked that they agreed, and they
// had drifted by five minor versions (image v1.57.0, lockfile 1.62.1) before this existed.
//
// The drift was invisible because no spec in this repo drives a browser: they all use the
// `request` fixture, which is plain HTTP, so the browsers baked into the image are never launched.
// That is the argument FOR the guard rather than against it. The first browser-touching spec would
// fail with an opaque launch error rather than with "your image is five versions old", and the
// person adding it would have no reason to suspect the image.
//
// The checks below deliberately include FIXTURE cases, not just "the real tree is clean". A guard
// verified only against a tree that already passes is a guard nobody has seen fire, which is how
// #382 shipped a spec that never ran.
//
// Run: node tests/unit/playwright_version_drift.test.js

import assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'playwright-version-drift.mjs');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/** Run the guard against an arbitrary root, returning {code, out}. */
function run(root) {
  try {
    const out = execFileSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  }
}

/** A minimal tree: a lockfile, a compose file, and an optional workflow. */
function fixture({ locked, composeTag, workflowTag }) {
  const dir = mkdtempSync(join(tmpdir(), 'pw-drift-'));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/@playwright/test': { version: locked } },
  }));
  writeFileSync(join(dir, 'docker-compose.test.yaml'),
    composeTag ? `services:\n  e2e-test-runner:\n    image: mcr.microsoft.com/playwright:${composeTag}\n` : 'services: {}\n');
  if (workflowTag) {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'),
      `jobs:\n  e2e:\n    steps:\n      - run: docker save "mcr.microsoft.com/playwright:${workflowTag}"\n`);
  }
  return dir;
}

console.log('\n[playwright-version-drift]');

check('the REAL tree is clean', () => {
  const { code, out } = run(ROOT);
  assert.strictEqual(code, 0, `guard failed on the real tree:\n${out}`);
});

check('the real tree pins the image at exactly the lockfile version', () => {
  // Asserted independently of the script, so a bug that made the script pass vacuously
  // (for instance a scan that found no sites) cannot also make this pass.
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const locked = lock.packages['node_modules/@playwright/test'].version;
  const compose = readFileSync(join(ROOT, 'docker-compose.test.yaml'), 'utf8');
  assert.ok(
    compose.includes(`mcr.microsoft.com/playwright:v${locked}-`),
    `docker-compose.test.yaml does not pin v${locked}`,
  );
});

check('CATCHES a drifted compose tag (the state this ticket was filed for)', () => {
  const dir = fixture({ locked: '1.62.1', composeTag: 'v1.57.0-jammy' });
  try {
    const { code, out } = run(dir);
    assert.strictEqual(code, 1, 'guard passed on a drifted tree');
    assert.ok(/v1\.57\.0/.test(out) && /1\.62\.1/.test(out), `message names neither version:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('CATCHES a half-done bump, where the workflow still pins the old tag', () => {
  // The shape a single-file guard would miss: ci-cd.yml carries the tag twice, and bumping only
  // the compose file leaves the docker save caching an image the compose file never pulls.
  const dir = fixture({ locked: '1.62.1', composeTag: 'v1.62.1-jammy', workflowTag: 'v1.57.0-jammy' });
  try {
    const { code, out } = run(dir);
    assert.strictEqual(code, 1, 'guard passed with the workflow still on the old tag');
    assert.ok(/ci\.yml/.test(out), `message does not name the workflow file:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('CATCHES a base-image mismatch (jammy in one file, noble in another)', () => {
  const dir = fixture({ locked: '1.62.1', composeTag: 'v1.62.1-jammy', workflowTag: 'v1.62.1-noble' });
  try {
    const { code, out } = run(dir);
    assert.strictEqual(code, 1, 'guard passed with two different base images');
    assert.ok(/base/i.test(out), `message does not explain the base mismatch:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('FAILS rather than passing vacuously when no image reference exists', () => {
  // The failure mode every drift guard in this repo has to defend against: a file is renamed,
  // the scan finds nothing, and silence reads as success.
  const dir = fixture({ locked: '1.62.1', composeTag: null });
  try {
    const { code, out } = run(dir);
    assert.strictEqual(code, 1, 'guard passed with nothing to check');
    assert.ok(/stale|no mcr/i.test(out), `message does not say the scan found nothing:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('PASSES a consistent tree, so it is not simply always red', () => {
  const dir = fixture({ locked: '1.62.1', composeTag: 'v1.62.1-jammy', workflowTag: 'v1.62.1-jammy' });
  try {
    const { code, out } = run(dir);
    assert.strictEqual(code, 0, `guard failed on a consistent tree:\n${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n[playwright-version-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
