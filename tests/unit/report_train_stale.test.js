// tests/unit/report_train_stale.test.js
//
// #327: #325 reports a train that FAILED. This covers one that never RAN.
//
// The clock is injected, so the threshold boundary is testable without real time.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  classifyLiveness, decideStaleTransition, buildStaleBody,
  selectNewestScheduledRun, shouldConfirmStaleFinding, reconcileLivenessReads,
  STALE_LABEL, STALE_THRESHOLD_HOURS, WATCHED_WORKFLOWS, CONFIRM_DELAY_MS,
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

check('a workflow that has never run AND is old enough to have run is detected', () => {
  const r = cls({ newestScheduledRunAt: null, workflowCreatedAt: agoHours(100) });
  assert.strictEqual(r.stale, true);
  assert.strictEqual(r.reason, 'never_ran');
});

check('REGRESSION: a NEWLY ADDED workflow is not reported before it could have run', () => {
  // This shipped broken and reddened develop. api-surface-drift.yml reached the
  // default branch at 16:40Z with a first fire at 02:30Z, so the next push filed
  // a false issue. The original test asserted never_ran was stale with no age
  // input at all, so it ENCODED the bug instead of catching it.
  const r = cls({ newestScheduledRunAt: null, workflowCreatedAt: agoHours(2.5) });
  assert.strictEqual(r.stale, false, 'a workflow hours old cannot be evidence of a dead cron');
  assert.strictEqual(r.reason, 'too_young');
});

check('BOUNDARY: a never-run workflow becomes reportable exactly at the threshold', () => {
  assert.strictEqual(cls({ newestScheduledRunAt: null, workflowCreatedAt: agoHours(STALE_THRESHOLD_HOURS) }).stale, true);
  assert.strictEqual(cls({ newestScheduledRunAt: null, workflowCreatedAt: agoHours(STALE_THRESHOLD_HOURS - 1 / 60) }).stale, false);
});

check('a never-run workflow with NO age information is still reported', () => {
  // Fail toward notifying when we cannot establish youth: an unknown-age
  // workflow that has never run is the original hazard.
  const r = cls({ newestScheduledRunAt: null, workflowCreatedAt: null });
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

// --- #436: selection by timestamp, never by position -------------------------
//
// The 2026-09-04 incident: the runs endpoint returned a 292h-old run at the head
// of the page while a 4.5h-old run existed, so `workflow_runs?.[0]` failed the
// job and filed a false P2 (#434). The endpoint has no `sort` or `direction`
// parameter, so newest-first cannot be requested and must not be assumed.

const OLD_AT = agoHours(292);
const RECENT_AT = agoHours(4.5);

check('#436: the newest run wins even when the page is out of order', () => {
  const got = selectNewestScheduledRun([
    { id: 32611627661, created_at: OLD_AT },
    { id: 33826298441, created_at: RECENT_AT },
  ]);
  assert.deepStrictEqual(got, { runAt: RECENT_AT, runId: 33826298441, considered: 2 });
});

check('#436: an in-order page still selects the newest run (no regression)', () => {
  const got = selectNewestScheduledRun([
    { id: 33826298441, created_at: RECENT_AT },
    { id: 32611627661, created_at: OLD_AT },
  ]);
  assert.deepStrictEqual(got, { runAt: RECENT_AT, runId: 33826298441, considered: 2 });
});

check('#436: an entry with an unusable created_at is ignored, not fatal', () => {
  const got = selectNewestScheduledRun([
    { id: 1, created_at: undefined },
    { id: 2, created_at: 'not-a-date' },
    { id: 3, created_at: OLD_AT },
  ]);
  assert.deepStrictEqual(got, { runAt: OLD_AT, runId: 3, considered: 1 },
    'considered counts only the entries that carried a usable timestamp');
});

check('#436: an empty or absent page yields the cold-start shape', () => {
  assert.deepStrictEqual(selectNewestScheduledRun([]), { runAt: null, runId: null, considered: 0 });
  assert.deepStrictEqual(selectNewestScheduledRun(undefined), { runAt: null, runId: null, considered: 0 });
});

// --- #436: which findings get the confirming re-read -------------------------

check('#436: both runs-page stale reasons are confirmed, and only those', () => {
  // no_recent_run comes from a partial page, never_ran from an empty one. BOTH
  // are reachable by an incomplete read, which is why never_ran cannot be left
  // out: no page size fixes an empty page.
  assert.strictEqual(shouldConfirmStaleFinding({ stale: true, reason: 'no_recent_run' }), true);
  assert.strictEqual(shouldConfirmStaleFinding({ stale: true, reason: 'never_ran' }), true);
  // disabled is derived from the workflow object, not the runs page: threshold
  // free, immediately reportable, and no delay may be paid for it.
  assert.strictEqual(shouldConfirmStaleFinding({ stale: true, reason: 'disabled' }), false);
  for (const reason of ['too_young', 'ok', 'inconclusive']) {
    assert.strictEqual(shouldConfirmStaleFinding({ stale: false, reason }), false, reason);
  }
});

// --- #436: reconciling the two reads -----------------------------------------

const staleFinding = (over = {}) => ({ file: 'dependency-update.yml', stale: true, reason: 'no_recent_run', ageHours: 292, ...over });

check('#436: a run seen by EITHER read proves the cron fired', () => {
  const first = staleFinding();
  const second = { file: 'dependency-update.yml', stale: false, reason: 'ok', ageHours: 4.5 };
  assert.deepStrictEqual(reconcileLivenessReads(first, second), second);
});

check('#436: two stale numeric reads report the freshest evidence either saw', () => {
  const first = staleFinding({ ageHours: 292 });
  const second = staleFinding({ ageHours: 100 });
  assert.strictEqual(reconcileLivenessReads(first, second).ageHours, 100);
  assert.strictEqual(reconcileLivenessReads(second, first).ageHours, 100, 'order independent');
});

check('#436: a numeric ageHours beats a null one, so a stale report never renders 0.0h', () => {
  // never_ran ALWAYS carries ageHours: null, and a naive Math.min(292, null) is
  // 0, which buildStaleBody renders as "0.0h": a stale report that reads as
  // perfectly fresh under a 48h threshold.
  const numeric = staleFinding({ ageHours: 292 });
  const nullish = staleFinding({ reason: 'never_ran', ageHours: null });
  assert.strictEqual(reconcileLivenessReads(numeric, nullish).ageHours, 292);
  assert.strictEqual(reconcileLivenessReads(nullish, numeric).ageHours, 292, 'order independent');
  const body = buildStaleBody({ findings: [reconcileLivenessReads(numeric, nullish)] });
  assert.ok(/292\.0h/.test(body), 'the freshest evidence is rendered');
  assert.ok(!/\b0\.0h/.test(body), 'Math.min(292, null) === 0 must never reach the body');
});

check('#436: two null ageHours reconcile to the first, so the contract is total', () => {
  const a = staleFinding({ file: 'a.yml', reason: 'never_ran', ageHours: null });
  const b = staleFinding({ file: 'b.yml', reason: 'never_ran', ageHours: null });
  assert.strictEqual(reconcileLivenessReads(a, b).file, 'a.yml');
});

check('#436: a confirming read that failed is UNKNOWN, and unknown reports nothing either way', () => {
  // The shell substitutes this shape when the second read throws. Falling back
  // to the first read's stale verdict would reintroduce the single-observation
  // bug this whole change exists to remove. Assert the WHOLE chain, not just the
  // reconcile step: a reviewer reasonably read the non-stale return as the job
  // asserting health, and the answer is that the reason travels with it, so the
  // run neither opens nor closes.
  const first = staleFinding();
  const inconclusive = { file: 'dependency-update.yml', stale: false, reason: 'inconclusive', ageHours: null };
  const reconciled = reconcileLivenessReads(first, inconclusive);
  assert.strictEqual(reconciled.reason, 'inconclusive');
  assert.strictEqual(decideStaleTransition({ findings: [reconciled], openStaleIssues: [{ number: 434 }] }).kind, 'noop',
    'a valid issue is NOT closed on an unknown');
  assert.strictEqual(decideStaleTransition({ findings: [reconciled], openStaleIssues: [] }).kind, 'noop',
    'and no new issue is opened from a single observation');
  const sibling = staleFinding({ file: 'api-surface-drift.yml', ageHours: 300 });
  assert.strictEqual(decideStaleTransition({ findings: [reconciled, sibling], openStaleIssues: [] }).kind, 'open',
    'a workflow that IS confirmed stale still reports, so unknown is not a blanket mute');
});

// --- #436: an unknown read is not evidence of RECOVERY ------------------------

check('#436: an inconclusive finding suppresses the close branch', () => {
  // Red against the pre-#436 transition function, which returned {kind:'close'}
  // here and would POST "Recovered ..." then close a still-valid issue, on the
  // very run that could not determine anything. The next push then files a fresh
  // number, defeating the dedupe pinned above.
  const t = decideStaleTransition({
    findings: [
      { file: 'dependency-update.yml', stale: false, reason: 'inconclusive' },
      { file: 'api-surface-drift.yml', stale: false, reason: 'ok' },
    ],
    openStaleIssues: [{ number: 434 }],
  });
  assert.strictEqual(t.kind, 'noop', 'a read that failed is not evidence of recovery');
});

check('#436: a genuinely recovered run still closes, so suppression is not a blanket off-switch', () => {
  const t = decideStaleTransition({
    findings: [
      { file: 'dependency-update.yml', stale: false, reason: 'ok' },
      { file: 'api-surface-drift.yml', stale: false, reason: 'too_young' },
    ],
    openStaleIssues: [{ number: 434 }],
  });
  assert.strictEqual(t.kind, 'close');
});

check('#436: a genuine stale finding still opens even when a sibling read failed', () => {
  const t = decideStaleTransition({
    findings: [
      staleFinding(),
      { file: 'api-surface-drift.yml', stale: false, reason: 'inconclusive' },
    ],
    openStaleIssues: [],
  });
  assert.strictEqual(t.kind, 'open', 'suppression applies to closing, never to reporting');
});

// --- #436: the query shape the fix depends on --------------------------------

check('#436: the runs query reads a PAGE and no code path indexes it positionally', () => {
  // Comments stripped, for the reason given by the sibling case below.
  const raw = readFileSync(new URL('../../scripts/report-train-stale.mjs', import.meta.url), 'utf8');
  const src = raw.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n');
  const POSITIONAL = /workflow_runs\s*\??\.?\s*\[\s*0\s*\]/;
  // Witness: the pattern must be able to fire, or this case is vacuous. The
  // defective line was `workflow_runs?.[0]`, so a literal `workflow_runs[0]`
  // scan would have passed against the very code it was written to condemn.
  assert.ok(POSITIONAL.test('const newest = runs?.workflow_runs?.[0];'), 'pattern matches optional chaining');
  assert.ok(POSITIONAL.test('runs.workflow_runs[0]'), 'pattern matches plain indexing');
  assert.ok(/per_page=30/.test(src), 'a page is read, not a single row');
  assert.ok(!POSITIONAL.test(src),
    'selection must go through selectNewestScheduledRun; the API has no sort or direction parameter, so position means nothing');
});

check('#436 review: a disabled verdict survives a failed runs read', () => {
  // The runs GET sits in its own try precisely so this holds: `state` alone
  // decides `disabled`, and classifyLiveness returns it before ever consulting
  // the runs page. Sharing one try would let a rate-limited runs call discard
  // the higher-severity signal, which is the one #327 exists to catch.
  const f = classifyLiveness({ file: 'dependency-update.yml', state: 'disabled_inactivity', newestScheduledRunAt: null, now: NOW });
  assert.strictEqual(f.stale, true);
  assert.strictEqual(f.reason, 'disabled');
  assert.strictEqual(shouldConfirmStaleFinding(f), false, 'and it needs no confirming re-read');
});

check('#436: the confirmation delay is a named constant with a real value', () => {
  // A delay chosen "short" can be served by the same lagging index that caused
  // the false read, which makes the confirmation inert while looking implemented.
  assert.strictEqual(typeof CONFIRM_DELAY_MS, 'number');
  assert.ok(CONFIRM_DELAY_MS >= 10000, 'must outlast a transient index lag');
  // Worst case added wall clock is the delay times the watched set, and the job
  // is capped at timeout-minutes: 10.
  assert.ok((CONFIRM_DELAY_MS * WATCHED_WORKFLOWS.length) < 600000 / 2, 'stays well inside the job timeout');
});

console.log(`\n[report-train-stale] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
