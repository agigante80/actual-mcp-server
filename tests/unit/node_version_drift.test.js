// tests/unit/node_version_drift.test.js
//
// #275: guards scripts/node-version-drift.mjs itself. The real tree must be clean, and
// the script must actually FAIL on a tree that drifts, otherwise it is a guard that
// only ever says yes. Sibling of tests/unit/config_drift.test.js.
//
// Run: node tests/unit/node_version_drift.test.js

import assert from 'assert';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'node-version-drift.mjs');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const run = (root) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });

// Fixture trees are removed on exit so a pre-commit loop does not litter os.tmpdir().
const fixtures = [];
process.on('exit', () => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true });
});

/** Build a fixture tree. Overrides replace the defaults, which are all consistent at 22. */
function fixture({ engines = '>=22.0.0', dockerfile, ci, readme, extraWorkflow } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'nvd-'));
  fixtures.push(tmp);
  mkdirSync(join(tmp, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'actual-mcp-server', engines: { node: engines } }));
  writeFileSync(join(tmp, 'Dockerfile'), dockerfile ?? 'FROM node:22-alpine AS build\nFROM node:22-alpine AS runtime\n');
  writeFileSync(join(tmp, '.github', 'workflows', 'ci-cd.yml'), ci ?? "env:\n  NODE_VERSION: '22'\n");
  writeFileSync(join(tmp, 'README.md'), readme ?? '- **Node.js 22+** (npm method) or **Docker**\n');
  if (extraWorkflow) writeFileSync(join(tmp, '.github', 'workflows', 'extra.yml'), extraWorkflow);
  return tmp;
}

console.log('\n[node-version-drift]');

check('the REAL repository tree is consistent (exit 0)', () => {
  const r = run(ROOT);
  assert.strictEqual(r.status, 0, `drift script failed on the real tree:\n${r.stdout}\n${r.stderr}`);
});

check('a consistent fixture passes', () => {
  assert.strictEqual(run(fixture()).status, 0);
});

check('DRIFT: a Dockerfile below the floor fails and names the file', () => {
  const r = run(fixture({ dockerfile: 'FROM node:20-alpine AS build\n' }));
  assert.strictEqual(r.status, 1, 'must reject a drifted Dockerfile');
  assert.ok(/Dockerfile/.test(r.stderr), 'must name the offending file');
  assert.ok(/node:20/.test(r.stderr), 'must name the offending value');
});

check('DRIFT: a Dockerfile ABOVE the floor also fails (image must equal the tested floor)', () => {
  const r = run(fixture({ dockerfile: 'FROM node:24-alpine AS build\n' }));
  assert.strictEqual(r.status, 1);
});

check('DRIFT: NODE_VERSION disagreeing with engines fails', () => {
  const r = run(fixture({ ci: "env:\n  NODE_VERSION: '20'\n" }));
  assert.strictEqual(r.status, 1);
  assert.ok(/NODE_VERSION/.test(r.stderr));
});

check('DRIFT: bumping engines without bumping the other sites is caught', () => {
  // The exact scenario the guard exists for: someone moves the floor to 24 and the
  // Dockerfile, CI, and README stay on 22.
  const r = run(fixture({ engines: '>=24.0.0' }));
  assert.strictEqual(r.status, 1);
  assert.ok(/Dockerfile/.test(r.stderr) && /README/.test(r.stderr), 'must name every stale site');
});

check('a workflow pinned ABOVE the floor is allowed (npm-publish pins 24 deliberately)', () => {
  const ci = "env:\n  NODE_VERSION: '22'\njobs:\n  publish:\n    steps:\n      - with:\n          node-version: '24'\n";
  assert.strictEqual(run(fixture({ ci })).status, 0);
});

check('a workflow pinned BELOW the floor fails without the exemption marker', () => {
  const ci = "env:\n  NODE_VERSION: '22'\njobs:\n  old:\n    steps:\n      - with:\n          node-version: '20'\n";
  const r = run(fixture({ ci }));
  assert.strictEqual(r.status, 1);
  assert.ok(/below the engines floor/.test(r.stderr));
});

check('a below-floor pin WITH the marker directly above it is allowed', () => {
  const ci =
    "env:\n  NODE_VERSION: '22'\njobs:\n  guard:\n    steps:\n      - with:\n" +
    '          # node-version-drift: allow-below-floor\n' +
    "          node-version: '20'\n";
  const r = run(fixture({ ci }));
  assert.strictEqual(r.status, 0, `marker must exempt the line:\n${r.stderr}`);
});

check('a below-floor pin with the marker on the owning step is allowed', () => {
  const ci =
    "env:\n  NODE_VERSION: '22'\njobs:\n  guard:\n    steps:\n" +
    '      # node-version-drift: allow-below-floor\n' +
    "      - with:\n          node-version: '20'\n";
  const r = run(fixture({ ci }));
  assert.strictEqual(r.status, 0, `marker must exempt the line:\n${r.stderr}`);
});

check('a marker too far above does NOT exempt (it must be visibly attached to the pin)', () => {
  const ci =
    "env:\n  NODE_VERSION: '22'\njobs:\n  guard:\n" +
    '    # node-version-drift: allow-below-floor\n' +
    "    steps:\n      - name: a\n        run: x\n      - name: b\n      - with:\n          node-version: '20'\n";
  const r = run(fixture({ ci }));
  assert.strictEqual(r.status, 1, 'a distant marker must not silently exempt an unrelated pin');
});

check('DRIFT: a README naming an older Node than the floor fails', () => {
  const r = run(fixture({ readme: 'Requires Node.js 18+ or Docker\n' }));
  assert.strictEqual(r.status, 1);
  assert.ok(/README/.test(r.stderr));
});

check('COVERAGE: a NEWLY ADDED workflow is scanned, not just a hardcoded list', () => {
  // The guard exists because a requirement declared in many places was verified in none.
  // A guard that only checks three known files repeats that mistake at a smaller scale.
  const extraWorkflow = "jobs:\n  nightly:\n    steps:\n      - with:\n          node-version: '18'\n";
  const r = run(fixture({ extraWorkflow }));
  assert.strictEqual(r.status, 1, 'a new workflow must not escape the guard');
  assert.ok(/extra\.yml/.test(r.stderr), 'must name the new workflow');
});

check('QUOTING: an unquoted or double-quoted pin below the floor is still caught', () => {
  const bare = "jobs:\n  a:\n    steps:\n      - with:\n          node-version: 18\n";
  assert.strictEqual(run(fixture({ extraWorkflow: bare })).status, 1, 'unquoted pin must be checked');
  const dq = 'jobs:\n  a:\n    steps:\n      - with:\n          node-version: "18"\n';
  assert.strictEqual(run(fixture({ extraWorkflow: dq })).status, 1, 'double-quoted pin must be checked');
});

check("QUOTING: an x-range pin like '20.x' below the floor is caught", () => {
  const xr = "jobs:\n  a:\n    steps:\n      - with:\n          node-version: '20.x'\n";
  const r = run(fixture({ extraWorkflow: xr }));
  assert.strictEqual(r.status, 1, "'20.x' must be compared, not silently skipped");
});

check('an incomparable pin (lts/*) is a violation, not a silent skip', () => {
  const lts = "jobs:\n  a:\n    steps:\n      - with:\n          node-version: 'lts/*'\n";
  const r = run(fixture({ extraWorkflow: lts }));
  assert.strictEqual(r.status, 1);
  assert.ok(/no comparable major version/.test(r.stderr));
});

check('a commented-out example pin is not treated as a real pin', () => {
  const commented = "jobs:\n  a:\n    steps:\n      - with:\n          # node-version: '18'\n          node-version: '22'\n";
  assert.strictEqual(run(fixture({ extraWorkflow: commented })).status, 0);
});

check('an ${{ env.NODE_VERSION }} expression is skipped (rule 2 pins the env itself)', () => {
  const expr = 'jobs:\n  a:\n    steps:\n      - with:\n          node-version: ${{ env.NODE_VERSION }}\n';
  assert.strictEqual(run(fixture({ extraWorkflow: expr })).status, 0);
});

check('a non-numeric Dockerfile tag is a violation, not a silent skip', () => {
  // `FROM node:lts-alpine` alongside a numeric stage used to pass unchecked.
  const r = run(fixture({ dockerfile: 'FROM node:lts-alpine AS build\nFROM node:22-alpine AS runtime\n' }));
  assert.strictEqual(r.status, 1);
  assert.ok(/no comparable major version/.test(r.stderr), 'must name the incomparable tag');
});

check('a missing engines.node is a hard error, not a silent pass', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nvd-noeng-'));
  fixtures.push(tmp);
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'actual-mcp-server' }));
  assert.strictEqual(run(tmp).status, 1);
});

console.log(`\n[node-version-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
