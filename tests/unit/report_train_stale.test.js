// tests/unit/report_train_stale.test.js
//
// #327: #325 reports a train that FAILED. This covers one that never RAN.
//
// The clock is injected, so the threshold boundary is testable without real time.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  classifyLiveness, decideStaleTransition, buildStaleBody,
  STALE_LABEL, STALE_THRESHOLD_HOURS, WATCHED_WORKFLOWS,
} from '../../scripts/report-train-stale.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
}

const NOW = '2026-08-04T12:00:00Z';
const agoHours = (h) => new Date(Date.parse(NOW) - h * 3600000).toISOString();
const cls = (over = {}) => classifyLiveness({
  file: 'dependency-update.yml', state: 'active',
  newestScheduledRunAt: agoHours(6), now: NOW, ...over,
});

// --- signal 1: state, immediate and threshold-free ---------------------------

check('a disabled workflow reports IMMEDIATELY, without waiting out the threshold', () => {
  // The original design used recency alone. That is a derived proxy which cannot
  // fire for 48 hours; `state` is directly observable and scalar.
  for (const s of ['disabled_inactivity', 'disabled_manually']) {
    const r = cls({ state: s, newestScheduledRunAt: agoHours(6) });
    assert.strictEqual(r.stale, true, s);
    assert.strictEqual(r.reason, 'disabled', s);
    assert.strictEqual(r.ageHours, null, 'no threshold is applied to a disabled workflow');
  }
});

check('an active workflow that ran recently is healthy', () => {
  const r = cls();
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.reason, 'ok');
});

// --- signal 2: recency, catching active-but-not-firing -----------------------

check('an ACTIVE workflow that has not run is still detected', () => {
  // The disjoint case: state alone would miss a dropped dispatch.
  const r = cls({ state: 'active', newestScheduledRunAt: agoHours(72) });
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.reason, 'no_recent_run');
});

check('BOUNDARY: exactly at the threshold reports; one minute short does not', () => {
  assert.strictEqual(cls({ newestScheduledRunAt: agoHours(STALE_THRESHOLD_HOURS) }).stale, true,
    'closed comparison: age >= threshold');
  assert.strictEqual(cls({ newestScheduledRunAt: agoHours(STALE_THRESHOLD_HOURS - 1 / 60) }).stale, false,
    '47h59m must not report');
});

check('a workflow that has never had a scheduled run is detected', () => {
  const r = cls({ newestScheduledRunAt: null });
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.reason, 'never_ran');
});

check('an unusable clock fails toward NOT reporting', () => {
  // A false stale issue on every push would be worse than a missed one, and the
  // next push retries. This is the one place the bias is deliberately inverted.
  const r = cls({ now: 'not-a-date' });
  assert.strictEqual(r.stale, false);
  assert.strictEqual(r.reason, 'inconclusive');
});

// --- the transition table ----------------------------------------------------

const healthy = { file: 'a.yml', stale: false, reason: 'ok' };
const stale = { file: 'a.yml', stale: true, reason: 'no_recent_run' };
const iss = (n) => ({ number: n });

check('SAFETY: the healthy steady state performs ZERO tracker writes', () => {
  // This ticket's primary safety requirement, and it is structural: noop is
  // returned before any write is considered.
  assert.strictEqual(decideStaleTransition({ findings: [healthy], openStaleIssues: [] }).kind, 'noop');
});

check('a stale workflow with nothing open files one issue', () => {
  assert.strictEqual(decideStaleTransition({ findings: [stale], openStaleIssues: [] }).kind, 'open');
});

check('IDEMPOTENT: N pushes while stale produce ONE issue updated in place', () => {
  // ci-cd.yml runs on every push to develop, so a non-idempotent reporter would
  // file an issue per push rather than per incident.
  const t = decideStaleTransition({ findings: [stale], openStaleIssues: [iss(1)] });
  assert.strictEqual(t.kind, 'update');
  assert.strictEqual(t.issue.number, 1);
});

check('recovery closes the stale issue: the explicit stale-to-active transition', () => {
  const t = decideStaleTransition({ findings: [healthy], openStaleIssues: [iss(1)] });
  assert.strictEqual(t.kind, 'close');
  assert.deepStrictEqual(t.issues.map((i) => i.number), [1]);
});

// --- the regression this ticket must not cause -------------------------------

check('REGRESSION GUARD: this reporter uses its OWN label, never train-failure', () => {
  // Sharing #325's marker would mean the healthy path hits decideTransition's
  // close_all and closes every open train-failure issue with a comment falsely
  // asserting recovery. Because ci-cd.yml runs on every push to develop, a
  // genuine unresolved failure would be auto-closed within minutes of the next
  // routine push, deleting the notification #325 exists to provide.
  assert.strictEqual(STALE_LABEL, 'train-stale');
  assert.notStrictEqual(STALE_LABEL, 'train-failure');
  const src = readFileSync(new URL('../../scripts/report-train-stale.mjs', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
  assert.ok(!/'train-failure'/.test(src) && !/"train-failure"/.test(src),
    'the stale reporter must never reference the train-failure label in executable code');
});

check('REGRESSION GUARD: stale must NOT be added to the TRAIN_OUTCOME enum', () => {
  // The INVERSE of the noop_soaking lesson. There, omitting a value from the set
  // caused a false P1 nightly, so the fix was to add it. Here, ADDING it makes
  // classifyOutcome fall through to {action:'ignore'}: green, nothing filed.
  const failureSrc = readFileSync(new URL('../../scripts/report-train-failure.mjs', import.meta.url), 'utf8');
  const enumBlock = /KNOWN_OUTCOMES = new Set\(\[([\s\S]*?)\]\)/.exec(failureSrc)[1];
  assert.ok(!/['"]stale['"]/.test(enumBlock),
    'adding stale to KNOWN_OUTCOMES is the SILENT branch; the stale reporter has its own classifier');
});

// --- body composition --------------------------------------------------------

check('the body is composed only from named fields', () => {
  const body = buildStaleBody({
    findings: [{ file: 'dependency-update.yml', state: 'disabled_inactivity', reason: 'disabled', ageHours: null, lastRunId: 123 }],
    serverUrl: 'https://github.com', repo: 'o/r',
  });
  assert.ok(body.includes('dependency-update.yml'));
  assert.ok(body.includes('disabled_inactivity'));
  assert.ok(body.includes('https://github.com/o/r/actions/runs/123'));
  // The run object also carries display_title, head_commit.message and
  // actor.login, all free text and externally influenced.
  const src = readFileSync(new URL('../../scripts/report-train-stale.mjs', import.meta.url), 'utf8');
  for (const field of ['display_title', 'head_commit', 'actor']) {
    assert.ok(!new RegExp(`\\.${field}`).test(src), `${field} must never reach the issue`);
  }
});

check('the body explains the default-branch trap', () => {
  const body = buildStaleBody({ findings: [{ file: 'x.yml', state: 'active', reason: 'no_recent_run', ageHours: 72 }] });
  assert.ok(/default branch/i.test(body),
    'scheduled workflows run only from the default branch, so a fix on develop has no effect until it reaches main');
});

// --- watched set -------------------------------------------------------------

check('both scheduled workflows are watched, not just the train', () => {
  // api-surface-drift.yml is a second scheduled workflow with identical exposure.
  assert.ok(WATCHED_WORKFLOWS.includes('dependency-update.yml'));
  assert.ok(WATCHED_WORKFLOWS.includes('api-surface-drift.yml'));
});

check('the runs query filters event=schedule and reads created_at', () => {
  // Comments stripped first. The file DOCUMENTS why run_started_at is wrong, so
  // asserting over raw source flags the explanation of the rule as a violation
  // of it. That has now happened enough times in this repo to be a habit.
  const raw = readFileSync(new URL('../../scripts/report-train-stale.mjs', import.meta.url), 'utf8');
  const src = raw.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
  assert.ok(/event=schedule/.test(src),
    'manually dispatching the train is the first diagnostic when it looks dead; an unfiltered query would let that reset the clock');
  assert.ok(/created_at/.test(src),
    'created_at timestamps the DISPATCH, which is the property under test');
  assert.ok(!/run_started_at/.test(src),
    'run_started_at conflates dispatch with runner availability and would report a queued-but-dispatched run as a dead cron');
});

console.log(`\n[report-train-stale] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
