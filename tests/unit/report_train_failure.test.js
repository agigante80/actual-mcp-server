// tests/unit/report_train_failure.test.js
//
// #325: the release train had no failure signal, so it sat dead for two nights.
// scripts/report-train-failure.mjs is the reporter. Its four decision functions
// are pure precisely so they can be exercised here without network.
//
// The governing principle under test throughout: WHEN IN DOUBT, NOTIFY. Every
// ambiguous state must resolve toward reporting. A control that fails quiet
// reproduces the exact defect the script exists to eliminate, and two drafts of
// the ticket got this backwards before review caught it, so the bias is pinned
// by test rather than left to reading comprehension.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  validateVersion,
  classifyOutcome,
  decideTransition,
  buildIssueBody,
  updateCounterBlock,
  readCounterBlock,
  VERSION_PLACEHOLDER,
  MARKER_LABEL,
} from '../../scripts/report-train-failure.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}\n    ${err.message}`);
  }
}

const step = (name, conclusion) => ({ name, conclusion });
const job = (name, steps, conclusion) => ({ name, conclusion, steps });

// ---------------------------------------------------------------------------
// classifyOutcome: the enum is corroborated, never trusted
// ---------------------------------------------------------------------------

check('outcome: unset fails toward notifying', () => {
  const r = classifyOutcome({ trainOutcome: undefined, jobs: [] });
  assert.strictEqual(r.action, 'failure');
  assert.strictEqual(r.reason, 'outcome_unset_or_unknown');
});

check('outcome: unrecognised fails toward notifying', () => {
  const r = classifyOutcome({ trainOutcome: 'banana', jobs: [] });
  assert.strictEqual(r.action, 'failure', 'a typo in the enum must not silence the reporter');
});

check('outcome: explicit failure is a failure', () => {
  const r = classifyOutcome({ trainOutcome: 'failure', jobs: [] });
  assert.strictEqual(r.action, 'failure');
  assert.strictEqual(r.disagreement, false);
});

check('outcome: success contradicted by a failed step', () => {
  const jobs = [job('main', [step('Unit tests', 'failure')], 'failure')];
  const r = classifyOutcome({ trainOutcome: 'success', jobs });
  assert.strictEqual(r.action, 'failure', 'the observed conclusion must win over the enum');
  assert.strictEqual(r.disagreement, true);
  assert.strictEqual(r.failingStep.step, 'Unit tests');
});

check('outcome: noop contradicted by a failed step (corroboration is not success-only)', () => {
  // A run that writes noop_up_to_date then goes red on the always()-guarded
  // Docker cleanup step would otherwise leave the reporter inert on a red run.
  const jobs = [job('main', [step('Cleanup Docker containers', 'failure')], 'failure')];
  const r = classifyOutcome({ trainOutcome: 'noop_up_to_date', jobs });
  assert.strictEqual(r.action, 'failure');
  assert.strictEqual(r.disagreement, true);
});

check('outcome: job-level cancel with no failed step', () => {
  // The two step-level timeouts do not cover the job-level `timeout-minutes: 60`.
  // That state is byte-identical to a human cancel and GitHub only states the
  // reason in the run log, which this design forbids reading. Fail toward notifying.
  const jobs = [job('main', [step('Docker E2E tests', 'cancelled')], 'cancelled')];
  const r = classifyOutcome({ trainOutcome: undefined, jobs, jobConclusion: 'cancelled' });
  assert.strictEqual(r.action, 'failure');
  assert.strictEqual(r.reason, 'cancelled_unattributed');
});

check('outcome: cancelled WITH a failed step attributing it', () => {
  const jobs = [job('main', [step('Build', 'failure'), step('E2E', 'cancelled')], 'cancelled')];
  const r = classifyOutcome({ trainOutcome: undefined, jobs, jobConclusion: 'cancelled' });
  assert.strictEqual(r.action, 'failure');
  assert.strictEqual(r.reason, 'cancelled_with_failed_step');
  assert.strictEqual(r.failingStep.step, 'Build', 'the attributing step must be named');
});

check('outcome: clean success is a success', () => {
  const jobs = [job('main', [step('Unit tests', 'success')], 'success')];
  assert.strictEqual(classifyOutcome({ trainOutcome: 'success', jobs }).action, 'success');
});

check('outcome: clean noop is ignored', () => {
  const jobs = [job('main', [step('Check versions', 'success')], 'success')];
  assert.strictEqual(classifyOutcome({ trainOutcome: 'noop_up_to_date', jobs }).action, 'ignore');
});

// --- regressions found in code review of the first implementation ----------

check('REGRESSION: a cancelled SIBLING job must not be attributed to the train', () => {
  // jobConclusion now comes from `needs.<job>.result`, not from scanning the run.
  // When it was scanned, the cancelled branch preempted the success branch, so a
  // genuinely successful publish alongside any cancelled job was reported as a
  // failure AND left the open issue unclosed. Latent with two jobs; live the
  // moment a third is added, which the rest of this chain is heading toward.
  const jobs = [
    job('Some other job', [], 'cancelled'),
    job('Update', [step('Publish', 'success')], 'success'),
  ];
  const r = classifyOutcome({ trainOutcome: 'success', jobs, jobConclusion: 'success' });
  assert.strictEqual(r.action, 'success',
    'a cancelled sibling must not turn a successful train run into a reported failure');
  // Inline literal, not the iss() helper: that is declared further down and a
  // const is in its temporal dead zone up here.
  assert.strictEqual(decideTransition({ outcome: r, openIssues: [{ number: 1, body: '' }] }).kind, 'close',
    'and the open issue must still be closed');
});

check('REGRESSION: the reporter must not corroborate against its own job', () => {
  const jobs = [
    job('Report train failure', [step('Report', 'failure')], 'failure'),
    job('Update', [step('Publish', 'success')], 'success'),
  ];
  const r = classifyOutcome({ trainOutcome: 'success', jobs, jobConclusion: 'success' });
  assert.strictEqual(r.action, 'success',
    'a failure inside the reporter job itself must not be read as a train failure');
});

check('REGRESSION: classification survives the jobs API being unavailable', () => {
  // The jobs fetch degrades to [] rather than throwing. Losing corroboration
  // must never cost the notification.
  assert.strictEqual(classifyOutcome({ trainOutcome: undefined, jobs: [] }).action, 'failure');
  assert.strictEqual(classifyOutcome({ trainOutcome: 'noop_up_to_date', jobs: [] }).action, 'ignore');
  assert.strictEqual(classifyOutcome({ trainOutcome: 'success', jobs: [] }).action, 'success');
});

// ---------------------------------------------------------------------------
// validateVersion: gates the body sink, never the notification
// ---------------------------------------------------------------------------

check('version: plain semver passes', () => {
  const r = validateVersion('26.8.0');
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.value, '26.8.0');
});

check('version: prerelease passes', () => {
  // 416 of @actual-app/api's 491 published versions carry a prerelease suffix,
  // and upstream publishes any v*.*.* tag with no explicit --tag, which npm
  // defaults to `latest`. A /^\d+\.\d+\.\d+$/ check would reject all of them.
  for (const v of ['25.4.0-alpha.0', '25.6.0-edge.23', '26.9.0-nightly.20260804']) {
    assert.strictEqual(validateVersion(v).valid, true, `${v} must validate`);
    assert.strictEqual(validateVersion(v).value, v, `${v} must appear verbatim`);
  }
});

check('version: junk is placeheld, not fatal', () => {
  for (const bad of ["'; rm -rf /", '`whoami`', '${{ secrets.APP_PRIVATE_KEY }}', '', undefined]) {
    const r = validateVersion(bad);
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.value, VERSION_PLACEHOLDER,
      'an invalid version must be placeheld so the issue still files: refusing would hand the registry a notification-suppression oracle');
  }
});

// ---------------------------------------------------------------------------
// buildIssueBody: no sink for captured output exists
// ---------------------------------------------------------------------------

check('body: composed only from named fields, nothing interpolated', () => {
  const body = buildIssueBody({
    workflow: 'Dependency Update',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    failingStep: { job: 'main', step: 'Unit tests' },
    version: '26.8.0',
    outcome: { action: 'failure', reason: 'outcome_failure' },
  });
  assert.ok(body.includes('Unit tests'), 'the failing step must appear');
  assert.ok(body.includes('26.8.0'), 'the version must appear');
  assert.ok(body.includes('https://github.com/o/r/actions/runs/1'), 'the run URL must appear');
  assert.ok(!/ACTUAL_PASSWORD|APP_PRIVATE_KEY|extraheader|AUTHORIZATION/i.test(body),
    'no credential-shaped material may reach the body');
});

check('step: failing-step fallback when the jobs API names none', () => {
  const body = buildIssueBody({ workflow: 'w', runUrl: 'u', failingStep: null, version: '1.0.0', outcome: { action: 'failure', reason: 'outcome_failure' } });
  assert.ok(/no failing step reported/i.test(body),
    'an unattributed failure must say so rather than silently omitting the field');
});

check('body: an unattributed cancellation explains itself', () => {
  const body = buildIssueBody({ workflow: 'w', runUrl: 'u', failingStep: null, version: '1.0.0', outcome: { action: 'failure', reason: 'cancelled_unattributed' } });
  assert.ok(/Unattributed cancellation/.test(body));
  assert.ok(/will not reopen/.test(body), 'it must tell a human that closing is safe');
});

check('body: a disagreement is stated', () => {
  const body = buildIssueBody({
    workflow: 'w', runUrl: 'u', failingStep: { step: 'X' }, version: '1.0.0',
    outcome: { action: 'failure', reason: 'corroboration_override' }, disagreement: true,
  });
  assert.ok(/Outcome disagreement/.test(body));
});

// ---------------------------------------------------------------------------
// decideTransition: the tracker state machine is total
// ---------------------------------------------------------------------------

const F = { action: 'failure' };
const S = { action: 'success' };
const I = { action: 'ignore' };
const iss = (n) => ({ number: n, body: '' });

check('transition: failure with none open', () => {
  assert.strictEqual(decideTransition({ outcome: F, openIssues: [] }).kind, 'open');
});

check('transition: failure with one open updates the counter', () => {
  const t = decideTransition({ outcome: F, openIssues: [iss(1)] });
  assert.strictEqual(t.kind, 'update_counter');
  assert.strictEqual(t.issue.number, 1);
});

check('transition: failure with three open converges on the oldest', () => {
  const t = decideTransition({ outcome: F, openIssues: [iss(1), iss(2), iss(3)] });
  assert.strictEqual(t.kind, 'comment_oldest_close_rest');
  assert.strictEqual(t.issue.number, 1, 'oldest wins');
  assert.deepStrictEqual(t.duplicates.map((d) => d.number), [2, 3]);
});

check('transition: success with none open', () => {
  assert.strictEqual(decideTransition({ outcome: S, openIssues: [] }).kind, 'noop');
});

check('transition: success with one open closes it', () => {
  const t = decideTransition({ outcome: S, openIssues: [iss(7)] });
  assert.strictEqual(t.kind, 'close');
  assert.strictEqual(t.issue.number, 7);
});

check('transition: success across a version change still closes', () => {
  // @actual-app/api has shipped same-day double bumps (26.5.1 then 26.5.2, seven
  // minutes apart). Dedupe is on the marker label, not the version, so an issue
  // opened for A is closed by a success on B rather than orphaned forever.
  const t = decideTransition({ outcome: S, openIssues: [iss(7)] });
  assert.strictEqual(t.kind, 'close');
});

check('transition: noop_up_to_date leaves an open issue open', () => {
  // The dominant nightly case is green with every test step SKIPPED. Closing on
  // that would be closing on zero evidence.
  assert.strictEqual(decideTransition({ outcome: I, openIssues: [iss(1)] }).kind, 'noop');
});

check('transition: noop_denied opens nothing', () => {
  assert.strictEqual(decideTransition({ outcome: I, openIssues: [] }).kind, 'noop');
});

check('transition: noop_not_forward opens nothing', () => {
  assert.strictEqual(decideTransition({ outcome: I, openIssues: [] }).kind, 'noop');
});

check('transition: manual close then fail again files fresh, never reopens', () => {
  // openIssues carries OPEN issues only by construction of the caller's query,
  // so a human's decision to close is structurally not overridden.
  const t = decideTransition({ outcome: F, openIssues: [] });
  assert.strictEqual(t.kind, 'open', 'a closed issue must not be reopened; a fresh one is filed');
});

// ---------------------------------------------------------------------------
// counter block: bounded comment volume
// ---------------------------------------------------------------------------

check('counter: block increments across 30 failures without 30 comments', () => {
  let body = buildIssueBody({
    workflow: 'w', runUrl: 'run/1', failingStep: null, version: '1.0.0',
    outcome: F, consecutive: 1, firstRunUrl: 'run/1', latestRunUrl: 'run/1',
  });
  for (let n = 2; n <= 30; n++) {
    const prev = readCounterBlock(body);
    body = updateCounterBlock(body, {
      consecutive: prev.consecutive + 1,
      firstRunUrl: prev.firstRunUrl,
      latestRunUrl: `run/${n}`,
    });
  }
  const final = readCounterBlock(body);
  assert.strictEqual(final.consecutive, 30, 'the counter must reach 30');
  assert.strictEqual(final.firstRunUrl, 'run/1', 'the first run must be preserved across updates');
  assert.ok(body.includes('run/30'), 'the latest run must be current');
  assert.strictEqual((body.match(/Consecutive failures/g) || []).length, 1,
    'the block must be replaced in place, not appended, or night thirty is unreadable');
});

check('REGRESSION: a human triage note above the block is not parsed as state', () => {
  // readCounterBlock used to scan the whole body and take the first match, so a
  // maintainer pasting a number above the machine block had it written back in.
  let body = buildIssueBody({
    workflow: 'w', runUrl: 'run/1', failingStep: null, version: '1.0.0',
    outcome: F, consecutive: 3, firstRunUrl: 'run/1', latestRunUrl: 'run/3',
  });
  body = `Triage note: **Consecutive failures:** 999\n**First:** see-my-comment\n\n${body}`;
  const read = readCounterBlock(body);
  assert.strictEqual(read.consecutive, 3, 'the machine block wins, not the human prose');
  assert.strictEqual(read.firstRunUrl, 'run/1');
});

check('REGRESSION: a $ pattern in a round-tripped value cannot corrupt the block', () => {
  // String.replace with a string replacement expands $&, $' and backtick-$.
  // firstRunUrl round-trips out of a human-editable body, so it can carry them.
  let body = buildIssueBody({
    workflow: 'w', runUrl: 'run/1', failingStep: null, version: '1.0.0',
    outcome: F, consecutive: 1, firstRunUrl: 'run/1', latestRunUrl: 'run/1',
  });
  const before = body.length;
  body = updateCounterBlock(body, { consecutive: 2, firstRunUrl: "$'", latestRunUrl: 'run/2' });
  assert.ok(body.length < before + 200, 'the body must not balloon from $-expansion');
  assert.strictEqual(readCounterBlock(body).consecutive, 2, 'the counter must survive intact');
  assert.ok(body.includes("**First:** $'"), 'the literal value must be written verbatim');
});

check('REGRESSION: recurrence records the CURRENT version and failing step', () => {
  // Dedupe is on the label, not the version, so the upstream version moves
  // underneath a long outage. Freezing these at night one makes them wrong.
  let body = buildIssueBody({
    workflow: 'w', runUrl: 'run/1', failingStep: { step: 'Unit tests' }, version: '26.8.0',
    outcome: F, consecutive: 1, firstRunUrl: 'run/1', latestRunUrl: 'run/1',
  });
  body = updateCounterBlock(body, {
    consecutive: 2, firstRunUrl: 'run/1', latestRunUrl: 'run/2',
    version: '26.9.0', failingStep: 'Docker E2E tests',
  });
  assert.ok(body.includes('**Latest version:** 26.9.0'), 'the current version must be recorded');
  assert.ok(body.includes('**Latest failing step:** Docker E2E tests'), 'the current failing step must be recorded');
});

// ---------------------------------------------------------------------------
// Source-level invariants for the I/O layer (not reachable by pure calls)
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/report-train-failure.mjs'),
  'utf8',
);

check('label: created on demand when absent', () => {
  assert.ok(/ensureLabel/.test(SRC), 'an ensureLabel path must exist');
  assert.ok(new RegExp(`/repos/\\$\\{repo\\}/labels`).test(SRC),
    'it must POST to the labels endpoint so a missing label cannot break dedupe');
  assert.ok(SRC.includes(MARKER_LABEL), 'the marker label must be named');
});

check('close path re-checks the marker label before acting', () => {
  assert.ok(/labels ?\?\?[^\n]*MARKER_LABEL|l\.name ?\?\? l\) === MARKER_LABEL/.test(SRC),
    'auto-close must be label-scoped so a malformed query cannot close unrelated tickets');
});

check('reporter never scrapes logs', () => {
  assert.ok(!/\/logs\b/.test(SRC), 'no log endpoint may be fetched: that is the credential-leak vector');
  assert.ok(/actions\/runs\/\$\{runId\}\/jobs/.test(SRC), 'the failing step must come from the jobs API');
});

check('a reporting error on failure keeps the run red; on a green run it does not', () => {
  assert.ok(/if \(isFailure\)[\s\S]{0,200}process\.exit\(1\)/.test(SRC),
    'a reporting error on a real failure must leave the run red');
  assert.ok(/::warning|annotate\('warning'/.test(SRC),
    'a tracker blip on a healthy run must degrade to a warning, not manufacture a phantom failure');
});

check('the jobs fetch degrades instead of throwing', () => {
  assert.ok(/jobs API unavailable/.test(SRC),
    'the jobs call must be wrapped so a transient error cannot cost the notification');
});

check('direct-invocation check uses a real file URL', () => {
  assert.ok(/pathToFileURL\(process\.argv\[1\]\)\.href/.test(SRC),
    'string-concatenated file:// URLs break on a path with a space or non-ASCII char, and main() would silently never run');
  assert.ok(!/=== `file:\/\/\$\{process\.argv\[1\]\}`/.test(SRC), 'the concatenated form must be gone');
});

check('the needed job result is used, not a scan of the run', () => {
  assert.ok(/TRAIN_JOB_RESULT/.test(SRC),
    'jobConclusion must come from needs.<job>.result so a cancelled sibling is not attributed to the train');
});

console.log(`\n[report-train-failure] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
