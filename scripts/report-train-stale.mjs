#!/usr/bin/env node
// report-train-stale.mjs
//
// #327: #325 reports a train that FAILED. It cannot report a train that never
// RAN, which lands in the same found-by-eye state it was filed to fix.
//
// Two causes, both verified:
//   1. GitHub disables scheduled workflows in PUBLIC repositories after 60 days
//      of repository inactivity. This repo is public, so the rule applies. It is
//      the lower-probability cause here, because near-daily commits keep the
//      clock resetting.
//   2. Cron dispatches are delayed under load and DROPPED under sufficiently
//      high load. GitHub does not guarantee a scheduled run fires. This is the
//      live cause.
//
// TWO SIGNALS, deliberately, because they detect disjoint failures:
//   - `state` catches a workflow that has been DISABLED. It is immediate,
//     scalar, threshold-free, and directly observable from the Actions API.
//   - recency catches a workflow that is `active` but is not firing anyway.
// Recency alone was the original proposal and is the worse primary: it is a
// derived proxy that cannot fire until the threshold has elapsed.
//
// WHY THIS IS A SEPARATE REPORTER, and not a `stale` member of TRAIN_OUTCOME.
// Trace classifyOutcome's gate order in report-train-failure.mjs: cancelled,
// not-in-KNOWN_OUTCOMES, equals 'failure', corroboration, equals 'success',
// fall-through.
//   - `stale` WITHOUT adding it to KNOWN_OUTCOMES trips gate 2 and files a
//     mislabelled "the release train failed" issue pointing at the wrong run.
//   - `stale` ADDED to KNOWN_OUTCOMES passes gate 2, fails 3/4/5, and falls
//     through to {action:'ignore'}: exit 0, green, NOTHING FILED. That is the
//     exact defect this ticket exists to eliminate, reproduced inside its own fix.
// This is the INVERSE of the noop_soaking lesson, where omission caused a false
// P1 nightly. There the fix was to add the member; here adding it is the silent
// branch. Two mitigations pulling opposite ways is a design smell, so the
// classifier is separate rather than a judgement call left to an implementer.
//
// ITS OWN LABEL, for the same reason. Sharing #325's `train-failure` marker
// would mean this reporter's healthy path hits decideTransition's `close_all`
// and closes every open train-failure issue with a comment falsely asserting
// recovery. Because ci-cd.yml runs on every push to develop, a genuine
// unresolved failure would be auto-closed within minutes of the next routine
// push. That would delete the notification #325 exists to provide.

import process from 'node:process';

export const STALE_LABEL = 'train-stale';
export const STALE_THRESHOLD_HOURS = 48;

/** #436: how long to wait before the ONE confirming re-read of a workflow that
 *  the first read called stale. Named rather than inlined because a delay chosen
 *  "short" can be served by the same lagging index that caused the false read,
 *  which makes the confirmation inert while looking implemented. Overridable by
 *  env for the reproduction harness, the same shape as STALE_THRESHOLD_HOURS. */
export const CONFIRM_DELAY_MS = 30000;

/** Watched scheduled workflows. A LIST, not a hardcoded filename:
 *  api-surface-drift.yml is a second scheduled workflow with identical exposure,
 *  so adding a third later must be a one-line data change. */
export const WATCHED_WORKFLOWS = ['dependency-update.yml', 'api-surface-drift.yml'];

/**
 * Classify one watched workflow.
 *
 * @param {object} a
 * @param {string} a.file
 * @param {string} a.state              active | disabled_manually | disabled_inactivity
 * @param {string|null} a.newestScheduledRunAt  `created_at` of the newest event=schedule run
 * @param {string|null} a.workflowCreatedAt      the workflow's own `created_at`
 * @param {string} a.now                injectable clock, so the boundary is testable
 * @param {number} a.thresholdHours
 */
export function classifyLiveness({ file, state, newestScheduledRunAt, workflowCreatedAt, now, thresholdHours = STALE_THRESHOLD_HOURS } = {}) {
  // `state` is primary and threshold-free: a disabled workflow is reportable
  // immediately, without waiting out the recency window.
  if (state && state !== 'active') {
    return { file, stale: true, reason: 'disabled', state, ageHours: null };
  }

  const t = Date.parse(newestScheduledRunAt ?? '');
  const n = Date.parse(now ?? '');
  if (!Number.isFinite(n)) {
    // No usable clock. Fail toward NOT reporting: a false stale issue on every
    // push would be worse than a missed one, and the next push retries.
    return { file, stale: false, reason: 'inconclusive', state, ageHours: null };
  }
  if (!Number.isFinite(t)) {
    // COLD START. A workflow that has never had a scheduled run is not evidence
    // of a dead cron until it has existed long enough to have plausibly fired.
    // This shipped broken: api-surface-drift.yml was added and reached the
    // default branch hours before its first 02:30Z fire, so the first push after
    // it landed filed a false issue and reddened develop. The original test
    // asserted never_ran was stale, so it encoded the bug rather than catching
    // it. Judge a never-run workflow by ITS OWN age instead.
    const created = Date.parse(workflowCreatedAt ?? '');
    if (Number.isFinite(created) && (n - created) < thresholdHours * 3600000) {
      return { file, stale: false, reason: 'too_young', state, ageHours: (n - created) / 3600000 };
    }
    return { file, stale: true, reason: 'never_ran', state, ageHours: null };
  }

  const ageHours = (n - t) / 3600000;
  // Closed comparison: exactly at the threshold reports. A 48h window against a
  // nightly cron deliberately tolerates exactly one missed night.
  return {
    file,
    stale: ageHours >= thresholdHours,
    reason: ageHours >= thresholdHours ? 'no_recent_run' : 'ok',
    state,
    ageHours,
  };
}

/**
 * Pick the newest scheduled run from a page, BY TIMESTAMP, never by position.
 *
 * #436: this used to be `workflow_runs?.[0]`, which assumes the API returns
 * newest-first. That ordering is undocumented and the endpoint has no `sort` or
 * `direction` parameter, so it cannot be requested. On 2026-09-04 a read put a
 * 292h-old run at the head while a 4.5h-old run existed, which failed the job
 * and filed a false P2 (#434).
 *
 * @param {{created_at?: string, id?: number}[]} runs
 * @returns {{runAt: string|null, runId: number|null, considered: number}}
 */
export function selectNewestScheduledRun(runs = []) {
  let runAt = null;
  let runId = null;
  let newest = -Infinity;
  let considered = 0;
  for (const run of Array.isArray(runs) ? runs : []) {
    const t = Date.parse(run?.created_at ?? '');
    if (!Number.isFinite(t)) continue;   // an unusable entry is ignored, not fatal
    considered += 1;
    if (t > newest) {
      newest = t;
      runAt = run.created_at;
      runId = run?.id ?? null;
    }
  }
  return { runAt, runId, considered };
}

/**
 * Does this finding need the confirming re-read?
 *
 * TRUE for the two stale reasons derived from the RUNS PAGE, because both are
 * reachable by a read that was incomplete rather than by a dead cron:
 * `no_recent_run` from a partial page, `never_ran` from an empty one.
 * FALSE for `disabled`, which is derived from the workflow object instead, is
 * threshold-free, and is reportable immediately.
 *
 * Exported rather than inlined in the shell: the unit suite mocks no network, so
 * a predicate living in main() would be unreachable by every test, and this is
 * the predicate that was wrong when the ticket was first written.
 *
 * @returns {boolean}
 */
export function shouldConfirmStaleFinding(finding) {
  return finding?.stale === true && (finding.reason === 'no_recent_run' || finding.reason === 'never_ran');
}

/**
 * Reconcile two reads of the same workflow.
 *
 * Both arguments are classifyLiveness findings enriched with lastRunId, NOT raw
 * pages. The shell always supplies both, because a confirming read that throws
 * becomes an `inconclusive` finding rather than a missing one, so there is no
 * absent-second case and a nullish argument throws here rather than silently
 * resolving to nothing.
 *
 * A run seen by EITHER read proves the cron fired, so a non-stale finding always
 * wins. Falling back to the first read's stale verdict is forbidden: that is the
 * single-observation bug this exists to remove.
 *
 * @returns the finding to report
 */
export function reconcileLivenessReads(first, second) {
  if (!first.stale) return first;
  // An `inconclusive` second read is UNKNOWN, not health, and it is returned
  // deliberately. Reading this as "the non-stale read wins" misses that the
  // reason travels with it: decideStaleTransition then opens nothing AND closes
  // nothing, so the run asserts neither staleness nor recovery and the next push
  // retries. Returning `first` here instead would report stale on a SINGLE
  // observation, which is precisely the bug this whole change exists to remove.
  // The residue, a confirming read that fails persistently rather than once, is
  // the permanent-versus-transient distinction tracked in #444.
  if (second.reason === 'inconclusive') return second;
  if (!second.stale) return second;
  // Both stale. Prefer the read carrying EVIDENCE: `never_ran` always has a null
  // ageHours, and a naive Math.min(292, null) is 0, which renders as "0.0h", a
  // stale report that reads as perfectly fresh.
  const a = Number.isFinite(first.ageHours) ? first.ageHours : null;
  const b = Number.isFinite(second.ageHours) ? second.ageHours : null;
  if (a === null && b === null) return first;
  if (a === null) return second;
  if (b === null) return first;
  return b < a ? second : first;
}

/**
 * Map findings plus current tracker state onto one transition.
 *
 * The healthy steady state performs ZERO tracker writes. That is this ticket's
 * primary safety requirement and it is structural here: `noop` is returned
 * before any API call is considered.
 */
export function decideStaleTransition({ findings = [], openStaleIssues = [] } = {}) {
  const stale = findings.filter((f) => f.stale);
  const open = [...openStaleIssues];

  if (stale.length > 0) {
    if (open.length === 0) return { kind: 'open', findings: stale };
    // Idempotent while the condition persists: N pushes produce ONE issue
    // updated in place, not N issues.
    return { kind: 'update', issue: open[0], findings: stale, duplicates: open.slice(1) };
  }

  // #436: a read that FAILED is not evidence of recovery. Without this, a
  // workflow whose read threw reaches here as a non-stale finding, and an open
  // issue is CLOSED with a "Recovered" comment on the very run that could not
  // determine anything. That is a tracker write decided from an unknown, and the
  // next push files a fresh number, defeating the dedupe this file is built on.
  const unknown = findings.some((f) => f.reason === 'inconclusive');

  // Healthy. Closing an EXISTING train-stale issue is the explicit
  // stale-to-active transition, not part of the steady-state healthy path.
  if (open.length > 0 && !unknown) return { kind: 'close', issues: open };
  return { kind: 'noop' };
}

/** Named fields only. The run object also carries display_title,
 *  head_commit.message and actor.login, which are free text and externally
 *  influenced; none may reach the issue. */
export function buildStaleBody({ findings = [], thresholdHours = STALE_THRESHOLD_HOURS, serverUrl, repo } = {}) {
  const lines = [
    '## A watched scheduled workflow is not running',
    '',
    'Opened automatically by `scripts/report-train-stale.mjs` (#327).',
    '',
    '`report-train-failure.mjs` reports a train that FAILED. It cannot report one that',
    'never RAN, because no run means no reporter job. This covers that gap.',
    '',
    '| Workflow | State | Last scheduled run | Age | Verdict |',
    '|---|---|---|---|---|',
  ];
  for (const f of findings) {
    const age = f.ageHours === null ? 'n/a' : `${f.ageHours.toFixed(1)}h`;
    const last = f.lastRunId && serverUrl && repo
      ? `[${f.lastRunId}](${serverUrl}/${repo}/actions/runs/${f.lastRunId})`
      : '(none found)';
    lines.push(`| \`${f.file}\` | \`${f.state ?? 'unknown'}\` | ${last} | ${age} | \`${f.reason}\` |`);
  }
  lines.push(
    '',
    `Threshold: ${thresholdHours}h against a nightly cron, which tolerates exactly one missed night.`,
    '',
    '**If the reason is `disabled`:** GitHub disables scheduled workflows in public',
    'repositories after 60 days of repository inactivity. Re-enable it in the Actions tab.',
    '',
    '**If the reason is `no_recent_run` while the state is `active`:** the dispatch is',
    'being dropped, or the `schedule:` block changed on the default branch. Note that',
    'scheduled workflows run ONLY from the default branch, so a fix on develop has no',
    'effect until it reaches main.',
    '',
    '<!-- train-stale:marker -->',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// I/O shell
// ---------------------------------------------------------------------------

const API = 'https://api.github.com';
const annotate = (level, msg) => process.stdout.write(`::${level}::${msg}\n`);

async function gh(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A workflow whose read failed is UNKNOWN, not healthy. #436: it used to be
 *  dropped from the findings list entirely, which reaches the same close branch
 *  as a healthy verdict. */
const inconclusiveFinding = (file, state) => ({ file, stale: false, reason: 'inconclusive', state, ageHours: null, lastRunId: null });

/** Read the runs page and classify it. Used for BOTH the first pass and the
 *  confirming re-read, so the two cannot drift apart. */
async function readRunsFinding(token, repo, file, { state, workflowCreatedAt, thresholdHours }) {
  // event=schedule specifically. dependency-update.yml also carries
  // workflow_dispatch, and manually dispatching the train is the FIRST
  // diagnostic step when it looks dead, so an unfiltered query would let
  // that diagnostic reset the liveness clock while the cron stayed dead.
  // Status is deliberately NOT filtered: a scheduled run that FAILED still
  // proves the cron fired, and reporting that is #325's job, not this one's.
  // per_page=30 covers about a month of a nightly cron, so a page returned in
  // any order still contains the newest run. It is ONE request, exactly as the
  // single-row read it replaces was.
  const runs = await gh(token, `/repos/${repo}/actions/workflows/${file}/runs?event=schedule&per_page=30`);
  // created_at, not run_started_at: created_at timestamps the DISPATCH,
  // which is the property under test. run_started_at conflates dispatch with
  // runner availability and would report a queued-but-dispatched run as dead.
  const { runAt, runId } = selectNewestScheduledRun(runs?.workflow_runs);
  const f = classifyLiveness({
    file, state, newestScheduledRunAt: runAt, workflowCreatedAt,
    now: new Date().toISOString(), thresholdHours,
  });
  return { ...f, lastRunId: runId };
}

async function main() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!token || !repo) {
    annotate('error', 'report-train-stale: GH_TOKEN and GITHUB_REPOSITORY are required');
    process.exit(1);
  }

  const thresholdHours = Number.parseInt(process.env.STALE_THRESHOLD_HOURS ?? '', 10) || STALE_THRESHOLD_HOURS;
  // Validated rather than `|| CONFIRM_DELAY_MS`: that idiom cannot express 0, so
  // the harness override this constant documents would silently pay the full
  // delay, and a NEGATIVE value would pass through truthy into sleep(-1), making
  // the confirmation inert while looking implemented.
  const parsedDelay = Number.parseInt(process.env.CONFIRM_DELAY_MS ?? '', 10);
  const confirmDelayMs = Number.isFinite(parsedDelay) && parsedDelay >= 0 ? parsedDelay : CONFIRM_DELAY_MS;

  const findings = [];
  for (const file of WATCHED_WORKFLOWS) {
    let state = null;
    let workflowCreatedAt = null;
    try {
      const wf = await gh(token, `/repos/${repo}/actions/workflows/${file}`);
      state = wf?.state ?? null;
      workflowCreatedAt = wf?.created_at ?? null;
    } catch (err) {
      annotate('warning', `report-train-stale: could not read ${file}: ${err.message}`);
      findings.push(inconclusiveFinding(file, null));
      continue;
    }

    // The runs read is a SEPARATE try, because `state` is already in hand here
    // and a `disabled` workflow is decidable from it ALONE: classifyLiveness
    // returns `disabled` before it ever consults the runs page. Sharing one try
    // with the read above would let a rate-limited runs call discard the very
    // verdict #327 exists to catch, which is the higher-severity signal of the two.
    let first;
    try {
      first = await readRunsFinding(token, repo, file, { state, workflowCreatedAt, thresholdHours });
    } catch (err) {
      annotate('warning', `report-train-stale: could not read runs for ${file}: ${err.message}`);
      findings.push(state && state !== 'active'
        ? { ...classifyLiveness({ file, state, now: new Date().toISOString(), thresholdHours }), lastRunId: null }
        : inconclusiveFinding(file, state));
      continue;
    }

    // The confirming re-read is paid ONLY when this pass is about to call a
    // workflow dead, never on the healthy steady state, and never for a
    // `disabled` finding, which needs no runs page at all.
    if (!shouldConfirmStaleFinding(first)) {
      findings.push(first);
      continue;
    }
    annotate('notice', `${file} looks stale (${first.reason}); confirming with one re-read`);
    await sleep(confirmDelayMs);
    let second;
    try {
      second = await readRunsFinding(token, repo, file, { state, workflowCreatedAt, thresholdHours });
    } catch (err) {
      annotate('warning', `report-train-stale: confirming read for ${file} failed: ${err.message}`);
      second = inconclusiveFinding(file, state);
    }
    findings.push(reconcileLivenessReads(first, second));
  }

  const stale = findings.filter((f) => f.stale);

  // Zero tracker WRITES on the healthy steady state. Note the read below is
  // unconditional: this list GET always happens, so the healthy path costs one
  // request per watched workflow for the workflow object, one for its runs page,
  // and this one. A GET is not a write, so the invariant holds, but the previous
  // wording here claimed the list was not fetched at all unless something was
  // stale, which was never true.
  let openStaleIssues = [];
  try {
    const list = await gh(token, `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(STALE_LABEL)}&sort=created&direction=asc&per_page=100`);
    openStaleIssues = (list ?? [])
      .filter((i) => !i.pull_request)
      .filter((i) => (i.labels ?? []).some((l) => (l.name ?? l) === STALE_LABEL));
  } catch (err) {
    annotate('warning', `report-train-stale: could not list issues: ${err.message}`);
    if (stale.length === 0) return;
  }

  const t = decideStaleTransition({ findings, openStaleIssues });

  if (t.kind === 'noop') {
    // Do not print OK when a read failed: the run is inconclusive, not healthy,
    // and the distinction is the whole point of the suppression above.
    const unknown = findings.filter((f) => f.reason === 'inconclusive');
    const label = unknown.length > 0 ? 'train liveness INCONCLUSIVE (nothing reported, next push retries)' : 'train liveness OK';
    annotate('notice', `${label}: ${findings.map((f) => `${f.file}=${f.reason}`).join(' ')}`);
    // A suppressed close must not be SILENT. If an issue is open and a read
    // failed, the run can neither confirm recovery nor report staleness, and a
    // read that keeps failing (a watched workflow renamed out of the repo, say)
    // would otherwise hold that issue open forever at notice level. The design
    // half, telling a permanent 404 from a transient failure, is #444; this
    // makes the state visible meanwhile.
    if (unknown.length > 0 && openStaleIssues.length > 0) {
      annotate('warning', `report-train-stale: not closing #${openStaleIssues[0].number} while ${unknown.map((f) => f.file).join(', ')} could not be read`);
    }
    return;
  }

  // The label is created on demand rather than assumed, so a fresh clone cannot
  // break dedupe.
  try {
    await gh(token, `/repos/${repo}/labels/${STALE_LABEL}`);
  } catch {
    await gh(token, `/repos/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name: STALE_LABEL, color: 'D93F0B', description: 'A watched scheduled workflow is not running (#327)' }),
    }).catch(() => {});
  }

  const body = buildStaleBody({ findings: t.findings ?? [], serverUrl: server, repo });

  if (t.kind === 'open') {
    const created = await gh(token, `/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Scheduled workflow not running: ${t.findings.map((f) => f.file).join(', ')}`,
        body,
        labels: [STALE_LABEL, 'P2', 'infrastructure'],
      }),
    });
    annotate('error', `opened #${created.number}: a watched scheduled workflow is not running`);
    process.exit(1);
  }

  if (t.kind === 'update') {
    await gh(token, `/repos/${repo}/issues/${t.issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    annotate('error', `updated #${t.issue.number}: a watched scheduled workflow is still not running`);
    process.exit(1);
  }

  if (t.kind === 'close') {
    for (const issue of t.issues) {
      await gh(token, `/repos/${repo}/issues/${issue.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: 'Recovered: every watched scheduled workflow is active and has run recently. Closing.' }),
      });
      await gh(token, `/repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      annotate('notice', `closed #${issue.number}: liveness recovered`);
    }
  }
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    annotate('error', `report-train-stale: ${err.message}`);
    process.exit(1);
  });
}
