// tests/unit/bot_target_branch.test.js
//
// #265: dependency bots must target develop, never main. The git policy makes
// main fast-forward-only from develop, so a bot PR against main is structurally
// unmergeable and rots until manually superseded (the #252/#253/#257/#258
// pattern). This guard asserts every dependabot update block carries
// target-branch: "develop" and the (currently inert, app-not-installed)
// Renovate config's baseBranches includes develop. Mirrors the text-parsing
// guard pattern (config_drift / knip_config).
//
// Run: node tests/unit/bot_target_branch.test.js

import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// Split dependabot.yml into per-ecosystem update blocks and name the ones
// missing target-branch: "develop". Pure on text for fixture testing.
function dependabotBlocksNotTargetingDevelop(text) {
  const blocks = text.split(/\n(?=\s*- package-ecosystem:)/).filter((b) => b.includes('package-ecosystem:'));
  return blocks
    .filter((b) => !/target-branch:\s*["']?develop["']?/.test(b))
    .map((b) => (b.match(/package-ecosystem:\s*["']?([\w-]+)/) || [])[1] || 'unknown');
}

function renovateTargetsDevelop(config) {
  return Array.isArray(config.baseBranches) && config.baseBranches.includes('develop');
}

console.log('\n[bot-target-branch]');

check('every dependabot update block targets develop', () => {
  const text = readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8');
  const missing = dependabotBlocksNotTargetingDevelop(text);
  assert.strictEqual(missing.length, 0,
    `dependabot blocks without target-branch: "develop": ${missing.join(', ')} (#265: bot PRs against main are unmergeable under the develop-first policy)`);
});

check('renovate config (inert until the app is installed) targets develop and carries the activation warning', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, '.github', 'renovate.json'), 'utf8'));
  assert.ok(renovateTargetsDevelop(cfg), 'renovate baseBranches must include "develop" (#265)');
  assert.ok(typeof cfg.description === 'string' && /scoping decision/i.test(cfg.description),
    'renovate description must warn that activation needs the dependabot-overlap scoping decision first (#265)');
});

check('NEGATIVE: a block missing target-branch, or one pointing at main, is detected and named', () => {
  const missing = '  - package-ecosystem: "npm"\n    directory: "/"\n  - package-ecosystem: "docker"\n    directory: "/"\n    target-branch: "develop"';
  assert.deepStrictEqual(dependabotBlocksNotTargetingDevelop(missing), ['npm']);
  const toMain = '  - package-ecosystem: "github-actions"\n    target-branch: "main"';
  assert.deepStrictEqual(dependabotBlocksNotTargetingDevelop(toMain), ['github-actions']);
  const ok = '  - package-ecosystem: "npm"\n    target-branch: "develop"';
  assert.deepStrictEqual(dependabotBlocksNotTargetingDevelop(ok), []);
});

check('NEGATIVE: a renovate config without develop in baseBranches is detected', () => {
  assert.strictEqual(renovateTargetsDevelop({}), false);
  assert.strictEqual(renovateTargetsDevelop({ baseBranches: ['main'] }), false);
  assert.strictEqual(renovateTargetsDevelop({ baseBranches: ['develop'] }), true);
});

console.log(`\n[bot-target-branch] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
