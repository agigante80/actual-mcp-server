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
 * @param {string} a.now                injectable clock, so the boundary is testable
 * @param {number} a.thresholdHours
 */
export function classifyLiveness({ file, state, newestScheduledRunAt, now, thresholdHours = STALE_THRESHOLD_HOURS } = {}) {
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

  // Healthy. Closing an EXISTING train-stale issue is the explicit
  // stale-to-active transition, not part of the steady-state healthy path.
  if (open.length > 0) return { kind: 'close', issues: open };
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

async function main() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  if (!token || !repo) {
    annotate('error', 'report-train-stale: GH_TOKEN and GITHUB_REPOSITORY are required');
    process.exit(1);
  }

  const findings = [];
  for (const file of WATCHED_WORKFLOWS) {
    let state = null;
    let newestScheduledRunAt = null;
    let lastRunId = null;
    try {
      const wf = await gh(token, `/repos/${repo}/actions/workflows/${file}`);
      state = wf?.state ?? null;
      // event=schedule specifically. dependency-update.yml also carries
      // workflow_dispatch, and manually dispatching the train is the FIRST
      // diagnostic step when it looks dead, so an unfiltered query would let
      // that diagnostic reset the liveness clock while the cron stayed dead.
      // Status is deliberately NOT filtered: a scheduled run that FAILED still
      // proves the cron fired, and reporting that is #325's job, not this one's.
      const runs = await gh(token, `/repos/${repo}/actions/workflows/${file}/runs?event=schedule&per_page=1`);
      const newest = runs?.workflow_runs?.[0];
      // created_at, not run_started_at: created_at timestamps the DISPATCH,
      // which is the property under test. run_started_at conflates dispatch with
      // runner availability and would report a queued-but-dispatched run as dead.
      newestScheduledRunAt = newest?.created_at ?? null;
      lastRunId = newest?.id ?? null;
    } catch (err) {
      annotate('warning', `report-train-stale: could not read ${file}: ${err.message}`);
      continue;
    }
    const f = classifyLiveness({
      file, state, newestScheduledRunAt, now: new Date().toISOString(),
      thresholdHours: Number.parseInt(process.env.STALE_THRESHOLD_HOURS ?? '', 10) || STALE_THRESHOLD_HOURS,
    });
    findings.push({ ...f, lastRunId });
  }

  const stale = findings.filter((f) => f.stale);

  // Zero tracker writes on the healthy steady state: the issue list is not even
  // fetched unless something is stale or a previous run left an issue open.
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
    annotate('notice', `train liveness OK: ${findings.map((f) => `${f.file}=${f.reason}`).join(' ')}`);
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
