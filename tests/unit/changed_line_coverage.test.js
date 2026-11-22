// tests/unit/changed_line_coverage.test.js
//
// #720: scripts/changed-line-coverage.mjs reports which CHANGED src/ lines the
// unit and adapter suites execute, from raw NODE_V8_COVERAGE output.
//
// The fixture is compiled and RUN here, under NODE_V8_COVERAGE, so the test
// reads what this Node really writes (the "source-map-cache" block is
// documented as experimental). A change in that shape fails here first.

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRows, changedSrcLines, collectionIsPartial, compressLines, decodeMappings, lineHits, readCoverage, renderReport,
} from '../../scripts/changed-line-coverage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO, 'scripts/changed-line-coverage.mjs');
const FIXTURE = path.join(HERE, 'fixtures/changed-line-coverage');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

// --- a real project root: compile the fixture, run it under coverage ---------

const ROOT = mkdtempSync(path.join(os.tmpdir(), 'clc-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));
cpSync(path.join(FIXTURE, 'src'), path.join(ROOT, 'src'), { recursive: true });
writeFileSync(path.join(ROOT, 'package.json'), '{ "type": "module" }\n');
const tsc = spawnSync(path.join(REPO, 'node_modules/.bin/tsc'), [
  '--ignoreConfig', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
  '--inlineSourceMap', '--rootDir', '.', '--outDir', 'dist', 'src/sample.ts',
], { cwd: ROOT, encoding: 'utf8' });
if (tsc.status !== 0) {
  console.error(`FAIL: could not compile the fixture: ${tsc.stdout}${tsc.stderr}`);
  process.exit(1);
}
const env = { ...process.env };
delete env.NODE_V8_COVERAGE; // a parent collection run must not leak into the fixture dirs
function runCovered(dir, args) {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...env, NODE_V8_COVERAGE: dir } });
  assert.strictEqual(r.status, 0, r.stderr);
}
const COV_ONE = path.join(ROOT, 'cov-one');   // sample.js alone: neverCalled() is never called
const COV_TWO = path.join(ROOT, 'cov-two');   // plus a second process that calls it
runCovered(COV_ONE, ['dist/src/sample.js']);
runCovered(COV_TWO, ['dist/src/sample.js']);
runCovered(COV_TWO, ['--input-type=module', '-e',
  "const m = await import('./dist/src/sample.js'); m.neverCalled(1); m.used(1, { double: false });"]);

const sampleLines = readFileSync(path.join(ROOT, 'src/sample.ts'), 'utf8').split('\n');
function diffFor(file, from, to, lines) {
  const body = lines.slice(from - 1, to).map((l) => `+${l}`).join('\n');
  return `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${from},0 +${from},${to - from + 1} @@\n${body}\n`;
}
const DIFF_ALL = diffFor('src/sample.ts', 8, 20, sampleLines);
function cli(args) {
  return spawnSync(process.execPath, [SCRIPT, '--root', ROOT, ...args], { encoding: 'utf8', env });
}
function writeDiff(name, text) {
  const p = path.join(ROOT, name);
  writeFileSync(p, text);
  return p;
}

// --- the five scenarios of the ticket ------------------------------------------

check('#720 scenario 1: a changed line no test executes is NAMED, with the percent', () => {
  const rows = buildRows(changedSrcLines(DIFF_ALL), readCoverage(COV_ONE, ROOT).sources);
  assert.strictEqual(rows.length, 1);
  const [row] = rows;
  assert.strictEqual(row.file, 'src/sample.ts');
  // 12: the branch not taken. 16 to 18: the body of the function never called.
  assert.deepStrictEqual(row.missed, [12, 16, 17, 18]);
  assert.strictEqual(row.changed, 13);
  assert.strictEqual(row.executable, 11, 'the blank lines 14 and 19 have no mapping and are not executable');
  assert.strictEqual(row.executed, 7);
  const r = cli(['--coverage-dir', COV_ONE, '--diff-file', writeDiff('all.diff', DIFF_ALL)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| `src\/sample\.ts` \| 13 \| 11 \| 7 \| 63 percent \| 12, 16 to 18 \|/);
});

check('#720 scenario 1, negative: a type-only changed line is not counted as unexecuted', () => {
  const rows = buildRows(changedSrcLines(diffFor('src/sample.ts', 4, 6, sampleLines)), readCoverage(COV_ONE, ROOT).sources);
  assert.strictEqual(rows[0].executable, 0);
  assert.deepStrictEqual(rows[0].missed, []);
  assert.match(renderReport(rows), /no executable changed line/);
});

check('#720 scenario 2: fully executed changed lines read 100 percent with nothing listed', () => {
  const r = cli(['--coverage-dir', COV_ONE, '--diff-file', writeDiff('hit.diff', diffFor('src/sample.ts', 9, 10, sampleLines))]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| `src\/sample\.ts` \| 2 \| 2 \| 2 \| 100 percent \|  \|/);
});

check('#720 scenario 2: a line is executed when ANY process ran it (processes are merged)', () => {
  const rows = buildRows(changedSrcLines(DIFF_ALL), readCoverage(COV_TWO, ROOT).sources);
  assert.deepStrictEqual(rows[0].missed, [], 'the second process ran line 12 and lines 16 to 18');
  assert.strictEqual(rows[0].executed, 11);
});

check('#720 scenario 3: a diff with no src/ change says so in one line and exits 0', () => {
  const other = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,0 +2,1 @@\n+text\n'
    + 'diff --git a/tests/unit/x.test.js b/tests/unit/x.test.js\n--- a/tests/unit/x.test.js\n+++ b/tests/unit/x.test.js\n@@ -1,0 +2,1 @@\n+x\n';
  // The coverage directory does not exist either: the diff is decided first.
  const r = cli(['--coverage-dir', path.join(ROOT, 'absent'), '--diff-file', writeDiff('other.diff', other)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, 'changed-line coverage: no src/ line changed, nothing to measure\n');
});

check('#720 scenario 4: a missing coverage directory prints skip: and exits 0', () => {
  const r = cli(['--coverage-dir', path.join(ROOT, 'absent'), '--diff-file', writeDiff('all.diff', DIFF_ALL)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skip: changed-line coverage: coverage directory .*absent does not exist \(run npm run test:coverage\)\n$/);
});

check('#720 scenario 4: a coverage directory with no source-mapped script is a skip, not a table of zeros', () => {
  const empty = path.join(ROOT, 'cov-empty');
  mkdirSync(empty, { recursive: true });
  writeFileSync(path.join(empty, 'coverage-1.json'), JSON.stringify({ result: [] }));
  writeFileSync(path.join(empty, 'coverage-2.json'), '{ truncated');
  const r = cli(['--coverage-dir', empty, '--diff-file', writeDiff('all.diff', DIFF_ALL)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skip: changed-line coverage: 1 coverage file\(s\) .* hold no source-mapped dist\/src script/);
});

check('#720 scenario 5: a changed file no process loaded is reported as not loaded, with its line count', () => {
  const never = readFileSync(path.join(ROOT, 'src/never_loaded.ts'), 'utf8').split('\n');
  const diff = DIFF_ALL + diffFor('src/never_loaded.ts', 1, 4, never);
  const r = cli(['--coverage-dir', COV_ONE, '--diff-file', writeDiff('never.diff', diff)]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| `src\/never_loaded\.ts` \| 4 \| not loaded by any test process \| \| \| \|/);
  assert.match(r.stdout, /\| `src\/sample\.ts` \| 13 \| 11 \| 7 \|/, 'the loaded file is still measured');
});

// --- the pure parts --------------------------------------------------------------

check('decodeMappings: relative VLQ fields accumulate across segments and lines', () => {
  // "AAAA" = source 0 line 0; "AACA" = line +1; "AADA" = line -1; "A" = no source.
  assert.deepStrictEqual(decodeMappings('AAAA;A,AACA;;AADA'), [[[0, 0]], [[0, 1]], [], [[0, 0]]]);
  // A multi-digit VLQ: "gB" is 16.
  assert.deepStrictEqual(decodeMappings('AAgBA'), [[[0, 16]]]);
});

check('decodeMappings, negative: a character outside base64 is refused, not read as zero', () => {
  assert.throws(() => decodeMappings('AA!A'), /invalid base64 VLQ character "!"/);
});

check('lineHits: the innermost range fully covering a line decides it', () => {
  // Three lines of 10 characters (offsets 0, 11, 22). The function ran once, its
  // inner block (line 2 only) never did.
  const fns = [{ ranges: [{ startOffset: 0, endOffset: 32, count: 1 }, { startOffset: 11, endOffset: 21, count: 0 }] }];
  assert.deepStrictEqual(lineHits([10, 10, 10], fns), [true, false, true]);
});

check('lineHits, negative: a range covering only part of a line does not decide it', () => {
  const fns = [{ ranges: [{ startOffset: 0, endOffset: 32, count: 1 }, { startOffset: 15, endOffset: 21, count: 0 }] }];
  assert.deepStrictEqual(lineHits([10, 10, 10], fns), [true, true, true]);
  assert.deepStrictEqual(lineHits([10, 10], []), [false, false], 'no range at all means not executed');
});

check('changedSrcLines: only added lines of src/**/*.ts count, at their new line numbers', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -3,2 +3,3 @@ function x() {', ' keep', '-gone', '+new4', '+++ plus signs in content', '\\ No newline at end of file',
    '@@ -20 +21,0 @@', '-only a deletion',
    'diff --git a/src/types.d.ts b/src/types.d.ts', '--- a/src/types.d.ts', '+++ b/src/types.d.ts', '@@ -0,0 +1 @@', '+declare',
    'diff --git a/scripts/b.mjs b/scripts/b.mjs', '--- a/scripts/b.mjs', '+++ b/scripts/b.mjs', '@@ -0,0 +1 @@', '+x',
    'diff --git a/src/gone.ts b/src/gone.ts', '--- a/src/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
  ].join('\n');
  assert.deepStrictEqual([...changedSrcLines(diff)], [['src/a.ts', [4, 5]]]);
});

check('renderReport: a failed collection is flagged as partial above the table, a clean one is not', () => {
  const rows = [{ file: 'src/a.ts', loaded: true, changed: 2, executable: 2, executed: 1, missed: [4] }];
  const partial = renderReport(rows, { partial: true }).split('\n');
  assert.match(partial[2], /^partial: a test chain failed during collection/);
  assert.ok(partial.indexOf('| File | Changed lines | Executable | Executed | Percent | Not executed |') > 2);
  assert.ok(!renderReport(rows).includes('partial:'), 'no partial line on a clean run');
});

check('collectionIsPartial: a failed or interrupted collection stays partial for a later report-only run', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clc-status-'));
  try {
    assert.strictEqual(collectionIsPartial(dir), false, 'no status file: coverage collected by hand');
    writeFileSync(path.join(dir, 'collection-status.txt'), '0\n');
    assert.strictEqual(collectionIsPartial(dir), false);
    for (const v of ['1\n', 'incomplete\n']) {
      writeFileSync(path.join(dir, 'collection-status.txt'), v);
      assert.strictEqual(collectionIsPartial(dir), true, v.trim());
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

check('negative: --collect with another --coverage-dir is refused before anything runs', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--collect', '--coverage-dir', 'coverage/other'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--collect always writes coverage\/v8; --coverage-dir is for report-only runs/);
});

check('compressLines: runs of three or more become a range', () => {
  assert.strictEqual(compressLines([9, 3, 7, 8, 12, 13]), '3, 7 to 9, 12, 13');
  assert.strictEqual(compressLines([]), '');
});

check('negative: an unknown argument is refused with exit 2', () => {
  const r = cli(['--threshold', '80']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unknown argument: --threshold/);
});

check('negative: a base that is not a plain ref is a skip, never handed to git as an option', () => {
  const r = cli(['--base', '--output=/tmp/x']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skip: changed-line coverage: base ref "--output=\/tmp\/x" is not a plain ref\n$/);
});

// --- the CI wiring stays warn-only ---------------------------------------------------

check('#720: the CI job is warn-only, gates nothing, and leaves the gating job alone', () => {
  const ci = readFileSync(path.join(REPO, '.github/workflows/ci-cd.yml'), 'utf8');
  const start = ci.indexOf('\n  changed-line-coverage:\n');
  assert.ok(start > 0, 'the job exists');
  const job = ci.slice(start, ci.indexOf('\n  # ----', start));
  assert.match(job, /\n    continue-on-error: true\n/, 'a failure or a timeout here never marks the run red');
  assert.match(job, /\n    if: \$\{\{ github\.event_name == 'pull_request' \}\}\n/);
  assert.match(job, /changed-line-coverage\.mjs --collect --base "\$COVERAGE_BASE_SHA"/);
  assert.ok(job.indexOf('        run: |') > 0, 'the shell text is a run block');
  assert.ok(!/\$\{\{[^}]*\}\}/.test(job.slice(job.indexOf('        run: |'))), 'no expression is interpolated into the shell text');
  assert.ok(!/needs:[^\n]*changed-line-coverage/.test(ci), 'no job waits on the report');
  const gate = ci.slice(ci.indexOf('\n  test:\n'), ci.indexOf('\n  changed-line-coverage:\n'));
  assert.ok(gate.includes('run: npm run test:unit-js'), 'the gating unit run is still in Run Tests');
  assert.ok(!gate.includes('changed-line-coverage.mjs'), 'and Run Tests does not run the report');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
