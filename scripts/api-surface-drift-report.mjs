#!/usr/bin/env node
// api-surface-drift-report.mjs
//
// #321: the tracker-writing half of the API surface drift lane.
//
// Runs in the `report` job, which holds `issues: write` and deliberately does
// NOT run `npm ci` and does NOT import @actual-app/api. Reading the surface
// means `await import(...)`, which executes upstream top-level module code
// in-process, and that must never share a process with a tracker-write token.
// This file consumes the JSON payload `detect` produced and nothing else.
//
// The payload arrives via an env var rather than shell interpolation, and is
// JSON-encoded by the producer, because $GITHUB_OUTPUT is newline-delimited and
// an arbitrary ES2022 export name can contain a newline. Everything in it is
// re-validated here, on this side of the trust boundary.

import process from 'node:process';
import {
  GAP_LABEL,
  gapSentinel,
  validateMethodName,
  filingPlan,
  buildGapBody,
} from './api-surface-drift.mjs';

const API = 'https://api.github.com';

function annotate(level, msg) {
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
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function ensureLabel(token, repo) {
  try {
    await gh(token, `/repos/${repo}/labels/${GAP_LABEL}`);
  } catch {
    await gh(token, `/repos/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: GAP_LABEL,
        color: '0E8A16',
        description: 'Uncovered or removed @actual-app/api method (#321)',
      }),
    }).catch(() => { /* raced a concurrent create */ });
  }
}

/**
 * Every method already filed, from issue bodies carrying the sentinel.
 *
 * state=all, NOT state=open. This deliberately diverges from #325, where never
 * reopening is self-healing for a transient train failure. Here the opposite
 * holds: a maintainer who closes a gap issue as wontfix has made a PERMANENT
 * decision, and a closed issue must still suppress re-filing.
 *
 * Paginates to exhaustion. report-train-failure reads a single page, which is
 * safe there because the open set is bounded at one; this state=all set only
 * ever grows, so a single page would silently stop suppressing at 100.
 */
async function alreadyFiledMethods(token, repo) {
  const found = new Set();
  for (let page = 1; page <= 50; page += 1) {
    const batch = await gh(
      token,
      `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(GAP_LABEL)}&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const issue of batch) {
      if (issue.pull_request) continue;
      const body = issue.body ?? '';
      const m = /<!-- api-gap:([A-Za-z_$][A-Za-z0-9_$]{0,63}) -->/g;
      let hit;
      while ((hit = m.exec(body)) !== null) found.add(hit[1]);
    }
    if (batch.length < 100) break;
  }
  return found;
}

async function main() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runUrl = `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  let result;
  try {
    result = JSON.parse(process.env.DRIFT_RESULT ?? '');
  } catch {
    annotate('error', 'api-surface-drift-report: DRIFT_RESULT was not valid JSON');
    process.exit(1);
  }

  if (!result?.red) {
    annotate('notice', `API surface drift: clean (${result?.acceptedCount ?? 0}/${result?.maxAccepted ?? 0} accepted gaps)`);
    return;
  }

  // Report the non-filing conditions in the run itself. They are red but there is
  // nothing to file: a stale baseline entry or an exceeded cap is a repo-side
  // bookkeeping problem, not an upstream discovery.
  for (const m of result.staleBaseline ?? []) {
    annotate('warning', `stale baseline entry: ${validateMethodName(m) ? m : '(invalid name)'} is either covered now or no longer exported`);
  }
  if (result.capExceeded) {
    annotate('warning', `accepted-gap debt cap exceeded: ${result.acceptedCount} accepted, cap is ${result.maxAccepted}. Raising it is a reviewed commit.`);
  }

  await ensureLabel(token, repo);
  const filed = await alreadyFiledMethods(token, repo);
  const plan = filingPlan(result, { alreadyFiled: filed });

  for (const name of plan.rejected) {
    annotate('warning', `refusing to file a method name that failed validation: ${JSON.stringify(String(name)).slice(0, 80)}`);
  }

  for (const item of plan.toFile) {
    const title = item.kind === 'removed'
      ? `P1: tool ${item.tool} maps to removed @actual-app/api method ${item.method}`
      : `Uncovered @actual-app/api method: ${item.method}`;
    const labels = item.kind === 'removed'
      ? [GAP_LABEL, 'P1', 'actual-api']
      : [GAP_LABEL, 'P3', 'actual-api'];
    const created = await gh(token, `/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: buildGapBody({ ...item, apiVersion: result.apiVersion, runUrl }),
        labels,
      }),
    });
    annotate('notice', `filed #${created.number} for ${item.method}`);
  }

  if (plan.overflow > 0) {
    annotate('warning', `${plan.overflow} further finding(s) not filed this run (cap is ${plan.toFile.length + plan.overflow > 0 ? 5 : 5} per run); they will file on the next run`);
  }

  // Deliberately exit 0 even when red. This lane reports; it must never become
  // something a downstream job can gate on. Redness lives in the annotations and
  // the filed issues, never in an exit code.
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    annotate('error', `api-surface-drift-report: ${err.message}`);
    process.exit(1);
  });
}

export { alreadyFiledMethods, gapSentinel };
