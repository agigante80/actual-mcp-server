// tests/unit/ci_workflow_guards.test.js
// Guards for the CI/CD Pipeline workflow (.github/workflows/ci-cd.yml) that pin
// release-reliability fixes so they cannot silently regress. Each check maps to
// a ticket whose bug cost a real release:
//   #271 tag-gate the two auxiliary jobs (docker-hub-description, deployment-test)
//   #272 concurrency group that never auto-cancels a release run
//   #274 npm-publish runs on a Node whose bundled npm >= 11.5.1 (no in-place
//        `npm install -g npm@latest` self-upgrade that dropped bundled sigstore)
// Text-based assertions on purpose (matches tests/unit/workflow_release_guards.test.js);
// no YAML dependency in the unit runner.
// Run: node tests/unit/ci_workflow_guards.test.js

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = readFileSync(join(ROOT, '.github', 'workflows', 'ci-cd.yml'), 'utf8');

let failures = 0;
function check(label, fn) {
  try {
    const ok = fn();
    if (ok) { console.log(`  ok: ${label}`); }
    else { console.error(`  FAIL: ${label}`); failures++; }
  } catch (e) {
    console.error(`  FAIL: ${label} -> ${e.message}`);
    failures++;
  }
}

// Return the text of a single top-level job block (2-space-indented `  name:`),
// from its header up to the next top-level job header.
function jobBlock(name) {
  const start = CI.search(new RegExp(`\\n  ${name}:\\n`));
  if (start < 0) return '';
  const rest = CI.slice(start + 1);
  const next = /\n  [A-Za-z][\w-]*:\n/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// Return the `if:` block text of a job (the `if:` line plus its continuation),
// up to the next same-indent key (`    key:`) or `steps:`.
function ifBlock(name) {
  const block = jobBlock(name);
  const m = /\n    if:\s*(\|[^\n]*)?\n([\s\S]*?)(?=\n    [A-Za-z][\w-]*:|\n    steps:)/.exec(block);
  if (m) return m[0];
  // single-line `if:` fallback
  const single = /\n    if:[^\n]*\n/.exec(block);
  return single ? single[0] : '';
}

console.log('[ci-workflow-guards] #271 auxiliary jobs are tag-gated');
check('docker-hub-description if: requires a v* tag ref', () => {
  const s = ifBlock('docker-hub-description');
  return /startsWith\(github\.ref,\s*'refs\/tags\/v'\)/.test(s);
});
check('docker-hub-description no longer runs on a bare main push', () => {
  const s = ifBlock('docker-hub-description');
  return !/github\.ref\s*==\s*'refs\/heads\/main'/.test(s);
});
check('deployment-test if: requires a v* tag ref', () => {
  const s = ifBlock('deployment-test');
  return /startsWith\(github\.ref,\s*'refs\/tags\/v'\)/.test(s);
});

console.log('\n[ci-workflow-guards] #272 concurrency protects release refs');
check('top-level concurrency block exists', () => /\nconcurrency:\n/.test(CI));
check('cancel-in-progress is an expression, NOT literally true', () => {
  const m = /\nconcurrency:\n([\s\S]*?)\n[A-Za-z]/.exec(CI);
  const blk = m ? m[1] : '';
  return /cancel-in-progress:\s*\$\{\{/.test(blk) && !/cancel-in-progress:\s*true\s*$/m.test(blk);
});
check('release refs (main + v* tags) are excluded from auto-cancel', () => {
  const m = /\nconcurrency:\n([\s\S]*?)\n[A-Za-z]/.exec(CI);
  const blk = m ? m[1] : '';
  return /refs\/heads\/main/.test(blk) && /refs\/tags\/v/.test(blk);
});

console.log('\n[ci-workflow-guards] #274 npm publish uses a bundled npm >= 11.5.1');
check('npm-publish sets up Node 24 (bundled npm >= 11.5.1)', () => {
  const s = jobBlock('npm-publish');
  return /node-version:\s*'?24'?/.test(s);
});
check('npm-publish does NOT do an in-place `npm install -g npm@latest`', () => {
  const s = jobBlock('npm-publish');
  // Match the STEP form (a `run:` invocation), not a mention in an explanatory
  // comment. Strip comment lines first so prose referencing the old command
  // does not trip the guard.
  const noComments = s.replace(/^\s*#.*$/gm, '');
  return !/run:\s*npm install -g npm@latest/.test(noComments);
});
check('npm-publish still publishes with provenance', () => {
  const s = jobBlock('npm-publish');
  return /npm publish --provenance/.test(s);
});

// #608: `hashFiles('<path>')` of a path that does not exist evaluates to an empty string and does
// not fail, so a cache key naming a moved file silently stops tracking it. Every literal
// argument must exist on disk. Glob arguments are skipped (they may legitimately match nothing).
function missingHashFilesPaths(text) {
  const missing = [];
  for (const m of text.matchAll(/hashFiles\(([^)]*)\)/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) {
      if (/[*?{[]/.test(lit[1])) continue;
      if (!existsSync(join(ROOT, lit[1]))) missing.push(lit[1]);
    }
  }
  return missing;
}
check('every literal hashFiles() path in the workflows exists on disk (#608)', () => {
  const dir = join(ROOT, '.github', 'workflows');
  const bad = [];
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    for (const p of missingHashFilesPaths(readFileSync(join(dir, f), 'utf8'))) bad.push(`${f}: ${p}`);
  }
  if (bad.length) throw new Error(`hashFiles of a missing path is silently empty: ${bad.join(', ')}`);
  return true;
});
check('NEGATIVE: a hashFiles() path that does not exist is reported (#608)', () => {
  const missing = missingHashFilesPaths("key: x-${{ hashFiles('no-such-dir/compose.yaml') }}");
  return missing.length === 1 && missing[0] === 'no-such-dir/compose.yaml';
});

console.log('');
if (failures === 0) {
  console.log('[ci-workflow-guards] All CI workflow guard checks passed');
  process.exit(0);
}
console.error(`[ci-workflow-guards] ${failures} check(s) FAILED`);
process.exit(1);
