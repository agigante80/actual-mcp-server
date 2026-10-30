// tests/unit/knip_config.test.js
//
// #234: package.json#knip (formerly knip.json, #608) must exist, and every `entry` glob root must resolve to a real path
// on disk. A typo in an entry pattern silently drops live code from Knip's reachable
// set and re-introduces false positives, so this guard catches it. Mirrors the
// text-parsing guard pattern (port_alignment / config_drift / compose_profile_sync).
//
// Run: node tests/unit/knip_config.test.js

import assert from 'assert';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// The literal prefix of a glob pattern, up to the first glob metacharacter. For
// "scripts/**/*.{js,mjs}" this is "scripts"; for "src/index.ts" it is "src/index.ts".
function globRoot(pattern) {
  const cut = pattern.search(/[*?{[]/);
  const head = cut === -1 ? pattern : pattern.slice(0, cut);
  // Trim back to the last complete path segment.
  return head.replace(/\/[^/]*$/, (m) => (cut === -1 ? m : ''));
}

// Returns the list of entry roots that do not exist on disk (empty = all resolve).
function missingEntryRoots(config, root = ROOT) {
  const entries = Array.isArray(config.entry) ? config.entry : [];
  return entries
    .map((p) => globRoot(p))
    .filter((r) => r.length > 0 && !existsSync(join(root, r)));
}

console.log('\n[knip-config]');

// #608: the config lives in package.json#knip. knip reads any root config file ahead of
// package.json#knip (its KNIP_CONFIG_LOCATIONS), so a stale one would silently win.
const SHADOWING_CONFIGS = [
  'knip.json', 'knip.jsonc', '.knip.json', '.knip.jsonc',
  'knip.ts', 'knip.js', 'knip.config.ts', 'knip.config.js',
];
function knipConfigProblem(pkg) {
  const cfg = pkg && pkg.knip;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return 'package.json#knip must exist and be an object';
  if (!Array.isArray(cfg.entry) || cfg.entry.length === 0) return 'package.json#knip must declare a non-empty entry array';
  return null;
}
function shadowingConfig(root) {
  const found = SHADOWING_CONFIGS.find((f) => existsSync(join(root, f)));
  return found ? `a root knip config file must not exist: ${found}` : null;
}
const loadPkg = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

check('package.json#knip exists with a non-empty entry array', () => {
  assert.strictEqual(knipConfigProblem(loadPkg()), null);
});

check('every package.json#knip entry glob root exists on disk', () => {
  const missing = missingEntryRoots(loadPkg().knip);
  assert.strictEqual(missing.length, 0, `package.json#knip entry roots not found on disk: ${missing.join(', ')}`);
});

check('package.json#knip entry covers the moved docker Playwright config and keeps ignoreBinaries lychee', () => {
  const cfg = loadPkg().knip;
  assert.ok(cfg.entry.includes('tests/e2e/playwright.config.docker.ts'), 'entry must name tests/e2e/playwright.config.docker.ts');
  assert.ok(Array.isArray(cfg.ignoreBinaries) && cfg.ignoreBinaries.includes('lychee'), 'ignoreBinaries must contain lychee (#602)');
});

check('no root knip config file shadows package.json#knip', () => {
  assert.strictEqual(shadowingConfig(ROOT), null);
});

check('NEGATIVE: a package.json without a knip key is flagged, naming package.json#knip', () => {
  const problem = knipConfigProblem({ name: 'x' });
  assert.ok(problem && problem.includes('package.json#knip'), `got: ${problem}`);
});

check('NEGATIVE: a root knip.json is flagged as shadowing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knip-shadow-'));
  try {
    writeFileSync(join(dir, 'knip.json'), '{}');
    assert.strictEqual(shadowingConfig(dir), 'a root knip config file must not exist: knip.json');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// NEGATIVE: a fixture config (inline, NOT the committed file) with a bad entry root is
// caught by the same check, naming the missing path.
check('NEGATIVE: a non-existent entry root is detected and named', () => {
  const fixture = { entry: ['src/index.ts', 'src/nonexistent/**/*.ts'] };
  const missing = missingEntryRoots(fixture);
  assert.deepStrictEqual(missing, ['src/nonexistent'], 'guard must flag exactly the missing root');
});

// #237: the Knip CI gate runs in FAILING mode. A `--no-exit-code` in scripts.knip silently
// reverts it to report-only (dead code stops failing CI), so this guard forbids it.
function knipScriptIsReportOnly(scriptValue) {
  return /--no-exit-code/.test(String(scriptValue || ''));
}

check('package.json scripts.knip is in failing mode (no --no-exit-code)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const knip = pkg.scripts && pkg.scripts.knip;
  assert.ok(knip, 'package.json must define a scripts.knip');
  assert.ok(!knipScriptIsReportOnly(knip), `scripts.knip must not contain --no-exit-code (found: "${knip}")`);
});

check('NEGATIVE: a report-only knip script (--no-exit-code) is detected', () => {
  assert.strictEqual(knipScriptIsReportOnly('knip --no-exit-code'), true);
  assert.strictEqual(knipScriptIsReportOnly('knip'), false);
});

console.log(`\n[knip-config] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
