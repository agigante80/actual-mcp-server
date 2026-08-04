#!/usr/bin/env node
// report-train-failure.mjs
//
// #325: the @actual-app/api release train had no failure signal. A failed
// scheduled run produced a red entry in the Actions tab and nothing else, and
// the train sat dead for two consecutive nights before anyone noticed by eye.
//
// This reports a train failure by opening (or updating) a single GitHub issue,
// and closes it again when a later run succeeds.
//
// GOVERNING PRINCIPLE: when in doubt, notify. Every control here fails toward
// reporting, never toward silence. A control that fails quiet reproduces the
// exact defect this script exists to eliminate. Two drafts of the ticket got
// this backwards (the version check and the cancellation guard), so it is
// stated once, here, and applied at every decision point.
//
// SECURITY: this runs in its own job (`report-train-failure`) holding only
// `issues: write` and `actions: read`. It never checks out with the App
// installation token and never runs `npm install`, so neither the token nor
// registry postinstall code is present in the process that can write to the
// tracker. The issue body is composed ONLY from the named fields in
// buildIssueBody(); never from captured output, env dumps, or git config, any
// of which can carry credential material. `::add-mask::` does not help here:
// it redacts logs, not an API payload.
//
// The four exported functions are pure so tests/unit/report_train_failure.test.js
// can exercise them without network.

import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** Marker label. Dedupe and auto-close are scoped to it so a malformed query
 *  can never touch an unrelated ticket. */
export const MARKER_LABEL = 'train-failure';

/** Body sentinel wrapping the machine-updated counter block. */
export const COUNTER_START = '<!-- train-failure:counter:start -->';
export const COUNTER_END = '<!-- train-failure:counter:end -->';

/** Substituted for a version that fails validation. Never abort on this: the
 *  version is registry-controlled, and refusing to file would hand an outside
 *  input a notification-suppression oracle. */
export const VERSION_PLACEHOLDER = '(version failed validation, see run)';

/** The closed TRAIN_OUTCOME enum. noop_denied, noop_not_forward and noop_soaking
 *  are all #324's deliverables (the denylist and the `sort -V` direction check are both
 *  its pre-flight safety work), added without this file changing. An earlier
 *  comment credited noop_not_forward to #321; that was wrong, #321's body never
 *  mentions TRAIN_OUTCOME at all. */
export const KNOWN_OUTCOMES = new Set([
  'success',
  'noop_up_to_date',
  'noop_denied',
  'noop_not_forward',
  'noop_soaking',
  'failure',
]);

/** Official semver, with optional prerelease and build metadata.
 *  NOT /^\d+\.\d+\.\d+$/: @actual-app/api has 491 published versions of which
 *  416 carry a prerelease suffix, including the non-nightly 25.4.0-alpha.0 and
 *  25.6.0-edge.23, and upstream publishes any v*.*.* tag with no explicit
 *  --tag, which npm defaults to `latest`. A strict triple would reject a
 *  legitimate value. Build metadata is accepted for correctness only: npm
 *  strips it at publish time, so this package cannot actually produce one. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Validate a registry-supplied version string.
 *
 * Gates the issue BODY sink only. An invalid value is placeheld and the issue
 * is still filed; it never suppresses the notification.
 *
 * @returns {{ valid: boolean, value: string }} value is safe to embed.
 */
export function validateVersion(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s && SEMVER.test(s)) return { valid: true, value: s };
  return { valid: false, value: VERSION_PLACEHOLDER };
}

/** The reporter's own job. Excluded from corroboration: it is in progress while
 *  it runs, and reading its own state would make the reporter self-referential. */
export const REPORTER_JOB_NAME = 'Report train failure';

/** Every failed step belonging to the TRAIN job, by allowlist.
 *
 *  An allowlist, not a denylist. Skipping only the reporter's own job left the
 *  original inversion reachable through a different door: any OTHER sibling job
 *  with a failed step was still attributed to the train, so a green publish was
 *  reported as a failure and the open issue was not closed. Latent with two
 *  jobs, live on the third.
 *
 *  Failure direction is deliberate: an unknown or stale `trainJobName` yields NO
 *  corroboration rather than WRONG corroboration, falling back to TRAIN_OUTCOME,
 *  which `if: success()` already makes fail-closed. */
function collectFailedSteps(jobs, trainJobName) {
  const out = [];
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (job?.name === REPORTER_JOB_NAME) continue;
    if (trainJobName && job?.name !== trainJobName) continue;
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      if (step?.conclusion === 'failure') {
        out.push({ job: job.name ?? null, step: step.name ?? null });
      }
    }
  }
  return out;
}

/**
 * Decide what the run actually was, from the enum plus observed job state.
 *
 * The enum is single-sourced and written mid-job, so it is corroborated rather
 * than trusted: if it reports ANY non-failure value while a step concluded
 * `failure`, the observation wins. Without that, a run that writes
 * noop_up_to_date and then goes red on the always()-guarded Docker cleanup
 * step would leave this script doing nothing on a red run.
 *
 * @returns {{ action: 'failure'|'success'|'ignore', reason: string,
 *             failingStep: {job: string|null, step: string|null}|null,
 *             disagreement: boolean }}
 */
export function classifyOutcome({ trainOutcome, jobs = [], jobConclusion, trainJobName } = {}) {
  const failed = collectFailedSteps(jobs, trainJobName);
  const failingStep = failed.length > 0 ? failed[0] : null;

  // `jobConclusion` is the result of the ONE job this reporter needs, taken from
  // `needs.<job>.result`, not derived by scanning the run. Scanning was wrong: a
  // cancelled SIBLING job would preempt the success branch below, so a genuinely
  // successful publish alongside any cancelled job would be reported as a train
  // failure AND would not close the open issue. Latent with two jobs, live the
  // moment a third is added, which #321/#324/#326 are heading toward.
  //
  // A job that exceeds `timeout-minutes` is CANCELLED by GitHub, not failed.
  // The step-level timeouts cover the two long steps; the job-level cap is not
  // attributable from the jobs API, and the only place GitHub states the reason
  // is the run log, which this design forbids reading. So an unattributed
  // cancel classifies as a failure. A human cancel costs one spurious issue,
  // which the never-reopen rule makes self-healing. One spurious issue beats a
  // silently swallowed timeout.
  if (jobConclusion === 'cancelled') {
    return {
      action: 'failure',
      reason: failingStep ? 'cancelled_with_failed_step' : 'cancelled_unattributed',
      failingStep,
      disagreement: false,
    };
  }

  if (!KNOWN_OUTCOMES.has(trainOutcome)) {
    return { action: 'failure', reason: 'outcome_unset_or_unknown', failingStep, disagreement: false };
  }

  if (trainOutcome === 'failure') {
    return { action: 'failure', reason: 'outcome_failure', failingStep, disagreement: false };
  }

  if (failingStep) {
    return { action: 'failure', reason: 'corroboration_override', failingStep, disagreement: true };
  }

  if (trainOutcome === 'success') {
    return { action: 'success', reason: 'outcome_success', failingStep: null, disagreement: false };
  }

  return { action: 'ignore', reason: trainOutcome, failingStep: null, disagreement: false };
}

/**
 * Map an outcome plus current tracker state onto a single transition.
 *
 * `openIssues` carries OPEN issues only, by construction of the caller's query,
 * which is what makes "a manually closed issue is never reopened" structural:
 * a closed issue simply is not in the list, so the next failure files fresh.
 * Ordered oldest first.
 */
export function decideTransition({ outcome, openIssues = [] } = {}) {
  const open = Array.isArray(openIssues) ? openIssues : [];
  const action = outcome?.action;

  if (action === 'failure') {
    if (open.length === 0) return { kind: 'open' };
    if (open.length === 1) return { kind: 'update_counter', issue: open[0] };
    // Race residue: search-then-create has no lock, so a cron run overlapping a
    // manual re-run can double-create. Converge on the oldest. Noisy, never
    // silent, which is the correct direction here.
    return { kind: 'comment_oldest_close_rest', issue: open[0], duplicates: open.slice(1) };
  }

  if (action === 'success') {
    if (open.length === 0) return { kind: 'noop' };
    if (open.length === 1) return { kind: 'close', issue: open[0] };
    return { kind: 'close_all', issues: open };
  }

  return { kind: 'noop' };
}

/**
 * Compose the issue body from a fixed set of named fields.
 *
 * Structural, not conventional: there is no parameter here through which
 * captured output, an env dump, or a git config read could arrive, so the
 * "no credential material" property holds by construction rather than by an
 * implementer remembering it.
 */
export function buildIssueBody({
  workflow,
  runUrl,
  failingStep,
  version,
  outcome,
  disagreement = false,
  consecutive = 1,
  firstRunUrl,
  latestRunUrl,
} = {}) {
  const step = failingStep?.step ?? '(no failing step reported by the jobs API)';
  const lines = [
    '## The @actual-app/api release train failed',
    '',
    'Opened automatically by `scripts/report-train-failure.mjs` (#325).',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Workflow | \`${workflow ?? '(unknown)'}\` |`,
    `| Run | ${runUrl ?? '(unknown)'} |`,
    `| Failing step | \`${step}\` |`,
    `| @actual-app/api under test | \`${version ?? VERSION_PLACEHOLDER}\` |`,
    `| Classified as | \`${outcome?.action ?? 'failure'}\` (\`${outcome?.reason ?? 'unknown'}\`) |`,
  ];

  if (disagreement) {
    lines.push(
      '',
      '> **Outcome disagreement.** The job reported a non-failure `TRAIN_OUTCOME`,',
      '> but a step concluded `failure`. The observed conclusion wins.',
    );
  }

  if (outcome?.reason === 'cancelled_unattributed') {
    lines.push(
      '',
      '> **Unattributed cancellation.** The job was cancelled with no failing step.',
      '> That is most likely the job-level `timeout-minutes` cap, which the jobs API',
      '> cannot distinguish from a human pressing cancel. Reported as a failure by',
      '> design. If a human cancelled this run, close this issue: it will not reopen.',
    );
  }

  lines.push(
    '',
    counterBlock({
      consecutive,
      firstRunUrl: firstRunUrl ?? runUrl,
      latestRunUrl: latestRunUrl ?? runUrl,
      version,
      failingStepName: failingStep?.step ?? null,
    }),
    '',
    'Recurrences update the counter above in place rather than adding a comment per',
    'night, so this stays readable on night thirty. A later successful run closes',
    'this issue automatically.',
  );

  return lines.join('\n');
}

/** Replace the counter block in an existing body, preserving everything else.
 *
 *  The replacement uses the FUNCTION form of String.replace. This is not style:
 *  the string form expands `$&`, `$'` and `` $` `` in the replacement, and
 *  firstRunUrl is round-tripped out of a human-editable issue body, so a `$`
 *  pattern there would corrupt the block and then reparse as garbage. */
export function updateCounterBlock(body, fields) {
  const block = counterBlock(fields);
  const re = new RegExp(`${COUNTER_START}[\\s\\S]*?${COUNTER_END}`);
  return re.test(body) ? body.replace(re, () => block) : `${body}\n\n${block}`;
}

/** THE single definition of the counter block's schema. Both writers go through
 *  it: buildIssueBody for a new issue and updateCounterBlock for a recurrence.
 *  They used to format it independently and had already drifted (a fresh issue
 *  lacked the two "Latest" lines until its first recurrence). */
export function counterBlock({ consecutive, firstRunUrl, latestRunUrl, version, failingStepName }) {
  return [
    COUNTER_START,
    `**Consecutive failures:** ${consecutive}`,
    `**First:** ${firstRunUrl ?? '(unknown)'}`,
    `**Latest:** ${latestRunUrl ?? '(unknown)'}`,
    `**Latest version:** ${version ?? '(unknown)'}`,
    `**Latest failing step:** ${failingStepName ?? '(none reported)'}`,
    COUNTER_END,
  ].join('\n');
}

/** Extract only the machine-owned counter block, so a human's triage note in the
 *  body cannot be parsed as state. Returns '' when the block is absent. */
function counterSection(body) {
  const text = body ?? '';
  const a = text.indexOf(COUNTER_START);
  const b = text.indexOf(COUNTER_END);
  return a === -1 || b === -1 || b < a ? '' : text.slice(a, b + COUNTER_END.length);
}

/** Read the counter out of an existing body so a recurrence can increment it.
 *  Scoped to the sentinels: an unscoped scan took the FIRST match anywhere in
 *  the body, so a maintainer pasting "**Consecutive failures:** 999" above the
 *  block would have that value written back into the machine state. */
export function readCounterBlock(body) {
  const section = counterSection(body);
  const m = /\*\*Consecutive failures:\*\*\s*(\d+)/.exec(section);
  const first = /\*\*First:\*\*\s*(\S+)/.exec(section);
  const ver = /\*\*Latest version:\*\*\s*(.+)/.exec(section);
  return {
    consecutive: m ? Number.parseInt(m[1], 10) : 0,
    firstRunUrl: first ? first[1] : null,
    // Round-tripped so a later run with an unreadable version preserves the last
    // known-good one instead of erasing it.
    version: ver ? ver[1].trim() : null,
  };
}


// ---------------------------------------------------------------------------
// I/O layer. Everything above is pure and unit-tested; everything below talks
// to the GitHub API and runs only when this file is executed directly.
// ---------------------------------------------------------------------------

const API = 'https://api.github.com';

function annotate(level, msg) {
  // GitHub workflow command. Safe: no secret material is ever passed here.
  process.stdout.write(`::${level}::${msg}\n`);
}

async function gh(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Status and path only. Never the response body wholesale, and never the
    // request headers, which carry the token.
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function ensureLabel(token, repo) {
  try {
    await gh(token, `/repos/${repo}/labels/${MARKER_LABEL}`);
  } catch {
    // Absent (a fresh clone, a restored repo). Create it rather than letting
    // dedupe silently break.
    await gh(token, `/repos/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: MARKER_LABEL,
        color: 'B60205',
        description: 'Opened by the release-train reporter (#325)',
      }),
    }).catch(() => { /* raced with a concurrent create; harmless */ });
  }
}

async function main() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const workflow = process.env.GITHUB_WORKFLOW;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const trainOutcome = process.env.TRAIN_OUTCOME;
  const runUrl = `${server}/${repo}/actions/runs/${runId}`;

  if (!token || !repo || !runId) {
    annotate('error', 'report-train-failure: missing GH_TOKEN, GITHUB_REPOSITORY or GITHUB_RUN_ID');
    process.exit(1);
  }

  // `valid` is load bearing, not decoration: TRAIN_VERSION is empty on any run
  // that dies before the version-check step (checkout, setup-node, a registry
  // blip), and an unconditional write would then overwrite a known-good version
  // in the title and body with the placeholder. Freezing was the old bug;
  // ERASING would be a worse one.
  const { valid: versionValid, value: version } = validateVersion(process.env.TRAIN_VERSION);

  // Which step failed, from the jobs API. Never by scraping logs: that is what
  // makes "no raw log capture" structural rather than conventional.
  //
  // This call MUST degrade rather than throw. It used to sit outside the try
  // below, so a transient 500 here propagated to the top-level catch and exited
  // 1 having written nothing: a real failure produced a red run and no issue,
  // which is verbatim the defect this script exists to eliminate, and a healthy
  // nightly no-op was turned red, which is the phantom failure the asymmetric
  // error policy exists to prevent. Corroboration is a refinement; losing it
  // must never cost the notification.
  let jobs = [];
  try {
    const jobsResp = await gh(token, `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
    jobs = jobsResp?.jobs ?? [];
  } catch (err) {
    annotate('warning', `report-train-failure: jobs API unavailable, classifying without corroboration: ${err.message}`);
  }

  // Authoritative, and NOT derived by scanning the run: see classifyOutcome.
  const jobConclusion = process.env.TRAIN_JOB_RESULT || undefined;

  const outcome = classifyOutcome({
    trainOutcome, jobs, jobConclusion, trainJobName: process.env.TRAIN_JOB_NAME,
  });
  const isFailure = outcome.action === 'failure';

  try {
    await ensureLabel(token, repo);

    const search = await gh(
      token,
      `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(MARKER_LABEL)}&sort=created&direction=asc&per_page=100`,
    );
    // Defensive: the issues endpoint also returns PRs. Drop them, and re-check
    // the marker label so a close can never touch an unrelated ticket.
    const openIssues = (search ?? [])
      .filter((i) => !i.pull_request)
      .filter((i) => (i.labels ?? []).some((l) => (l.name ?? l) === MARKER_LABEL));

    const t = decideTransition({ outcome, openIssues });

    if (t.kind === 'open') {
      const body = buildIssueBody({
        workflow, runUrl, failingStep: outcome.failingStep, version, outcome,
        disagreement: outcome.disagreement, consecutive: 1,
        firstRunUrl: runUrl, latestRunUrl: runUrl,
      });
      const created = await gh(token, `/repos/${repo}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Release train failed: @actual-app/api ${version}`,
          body,
          labels: [MARKER_LABEL, 'P1', 'infrastructure'],
        }),
      });
      annotate('error', `Release train failed. Opened #${created.number}: ${created.html_url}`);
    } else if (t.kind === 'update_counter' || t.kind === 'comment_oldest_close_rest') {
      const issue = t.issue;
      const prev = readCounterBlock(issue.body);
      const consecutive = prev.consecutive + 1;
      // Refresh the title and the volatile fields too. Dedupe is on the label,
      // not the version, so the upstream version moves underneath a long-running
      // outage; leaving them frozen at night one makes them actively wrong
      // rather than merely stale, on the issue that is the train's only human
      // interface.
      await gh(token, `/repos/${repo}/issues/${issue.number}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...(versionValid ? { title: `Release train failed: @actual-app/api ${version}` } : {}),
          body: updateCounterBlock(issue.body ?? '', {
            consecutive,
            firstRunUrl: prev.firstRunUrl ?? runUrl,
            latestRunUrl: runUrl,
            version: versionValid ? version : prev.version,
            failingStepName: outcome.failingStep?.step ?? null,
          }),
        }),
      });
      for (const dup of t.duplicates ?? []) {
        await gh(token, `/repos/${repo}/issues/${dup.number}`, {
          method: 'PATCH', body: JSON.stringify({ state: 'closed' }),
        });
        await gh(token, `/repos/${repo}/issues/${dup.number}/comments`, {
          method: 'POST', body: JSON.stringify({ body: `Duplicate of #${issue.number}. Closed by the release-train reporter.` }),
        });
      }
      annotate('error', `Release train failed again (${consecutive} consecutive). Updated #${issue.number}.`);
    } else if (t.kind === 'close' || t.kind === 'close_all') {
      for (const issue of t.issues ?? [t.issue]) {
        await gh(token, `/repos/${repo}/issues/${issue.number}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: `Recovered: the release train succeeded in ${runUrl}. Closing.` }),
        });
        await gh(token, `/repos/${repo}/issues/${issue.number}`, {
          method: 'PATCH', body: JSON.stringify({ state: 'closed' }),
        });
        annotate('notice', `Release train recovered. Closed #${issue.number}.`);
      }
    }
  } catch (err) {
    if (isFailure) {
      // The underlying failure is real and must stay visible. Do not let a
      // reporting error hide it.
      annotate('error', `report-train-failure: ${err.message}`);
      process.exit(1);
    }
    // A tracker blip on a healthy run must not manufacture a phantom train
    // failure by reddening a good publish.
    annotate('warning', `report-train-failure: non-fatal on a ${outcome.action} run: ${err.message}`);
    return;
  }

  // A genuine failure keeps the run red even when reporting succeeded.
  if (isFailure) process.exit(1);
}

// pathToFileURL, not string concatenation: import.meta.url percent-encodes, so a
// checkout path containing a space or any non-ASCII character made this false,
// main() never ran, and the job exited 0 having reported nothing.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    annotate('error', `report-train-failure: unhandled: ${err.message}`);
    process.exit(1);
  });
}
