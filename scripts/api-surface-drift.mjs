#!/usr/bin/env node
// api-surface-drift.mjs
//
// #321: the live @actual-app/api surface moves without a commit. That fact used
// to live inside a UNIT TEST, which meant an upstream release could turn the
// suite red with nobody touching the repo. 26.8.0 added three methods, the test
// went red, the auto-release train died for two nights, and security PR #319
// stayed blocked behind the same failure.
//
// The signal is real; it just is not a unit test. It lives here instead, in a
// lane that REPORTS rather than blocks.
//
// NON-BLOCKING IS STRUCTURAL, not a promise: nothing in ci-cd.yml or
// dependency-update.yml declares `needs:` on either job of the drift workflow,
// and neither job runs on `pull_request`, so this cannot gate a merge or the
// release train even when it is red.
//
// SECURITY: the pure core below never reads the registry or the tracker; it is
// fed injected arguments so it is testable from fixtures. Only main() imports
// anything, and main() runs in the low-privilege `detect` job. The job that
// holds `issues: write` never imports @actual-app/api, because reading the
// surface means `await import(...)`, which EXECUTES upstream top-level module
// code in-process: strictly worse than the postinstall case #325 split for.

import process from 'node:process';
import { readFileSync } from 'node:fs';

/** Marker label. The sentinel query is scoped to it. */
export const GAP_LABEL = 'api-coverage-gap';

/** A method name we are willing to put in an issue title or body. Gap names come
 *  from Object.keys() over a third-party module namespace: arbitrary strings
 *  chosen by someone else. 26.8.0's additions were benign identifiers; that is
 *  not a property we get to assume forever, and this mechanism is permanent. */
const METHOD_NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

export function validateMethodName(name) {
  return typeof name === 'string' && METHOD_NAME.test(name);
}

/** Body sentinel that suppresses re-filing for a method. */
export function gapSentinel(method) {
  return `<!-- api-gap:${method} -->`;
}

/**
 * Validate the committed baseline's shape. Pure; fed the parsed object.
 * Returns an array of human-readable problems, empty when valid.
 */
export function validateBaseline(baseline) {
  const problems = [];
  if (!baseline || typeof baseline !== 'object') return ['baseline is not an object'];
  if (typeof baseline.maxAccepted !== 'number' || !Number.isInteger(baseline.maxAccepted) || baseline.maxAccepted < 0) {
    problems.push('maxAccepted must be a non-negative integer');
  }
  const accepted = baseline.accepted;
  if (!accepted || typeof accepted !== 'object' || Array.isArray(accepted)) {
    return [...problems, 'accepted must be an object keyed by method name'];
  }
  for (const [method, entry] of Object.entries(accepted)) {
    if (!validateMethodName(method)) {
      problems.push(`accepted key is not a valid method name: ${JSON.stringify(method)}`);
    }
    if (!entry || typeof entry !== 'object') {
      problems.push(`${method}: entry must be an object`);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`${method}: reason must be a non-empty string`);
    }
    if (!Number.isInteger(entry.issue) || entry.issue < 0) {
      problems.push(`${method}: issue must be a non-negative integer (0 means not yet filed)`);
    }
    if (typeof entry.apiVersion !== 'string' || entry.apiVersion.trim() === '') {
      problems.push(`${method}: apiVersion must be a non-empty string`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.firstSeen ?? '')) {
      problems.push(`${method}: firstSeen must be YYYY-MM-DD`);
    }
  }
  return problems;
}

/**
 * Classify the live surface against our mapping and the baseline.
 *
 * Four conditions, not one. The first revision of #321 had only condition 1.
 *
 * @param {object} a
 * @param {Record<string,string>} a.apiToTool   injected, never read from the module
 * @param {string[]} a.liveSurface             injected, never enumerated here
 * @param {string[]} a.internalMethods
 * @param {string[]} a.gaps                    from analyzeCoverage
 * @param {object} a.baseline
 */
export function classify({ apiToTool = {}, liveSurface = [], internalMethods = [], gaps = [], baseline = {} } = {}) {
  const accepted = baseline.accepted ?? {};
  const live = new Set(liveSurface);
  const acceptedNames = Object.keys(accepted);

  // 1. New uncovered method, not accepted. Benign (a feature we lack). Files one.
  const newGaps = gaps.filter((m) => !Object.prototype.hasOwnProperty.call(accepted, m)).sort();

  // 2. Stale baseline entry: now covered, or no longer exported. Red, no filing.
  //    Without this the allowlist becomes the place findings hide.
  const staleBaseline = acceptedNames
    .filter((m) => !gaps.includes(m) || !live.has(m))
    .sort();

  // 3. Removed COVERED method. The direction the first revision missed, and the
  //    dangerous one: a shipped MCP tool now calls a method upstream no longer
  //    exports, which fails at runtime in a user's budget. mappingErrors does
  //    NOT catch this: it only checks the mapped TOOL exists in
  //    IMPLEMENTED_TOOLS, never that the mapped METHOD still exists upstream.
  const removedCovered = Object.entries(apiToTool)
    .filter(([method]) => !live.has(method))
    .map(([method, tool]) => ({ method, tool }))
    .sort((x, y) => x.method.localeCompare(y.method));

  // 4. Debt cap. A ratchet on the SIZE of the backlog, not on any single gap, so
  //    it still blocks nothing. Raising it is a reviewed commit, which is the point.
  const capExceeded = acceptedNames.length > (baseline.maxAccepted ?? 0);

  const red = newGaps.length > 0 || staleBaseline.length > 0 || removedCovered.length > 0 || capExceeded;

  return {
    red,
    newGaps,
    staleBaseline,
    removedCovered,
    capExceeded,
    acceptedCount: acceptedNames.length,
    maxAccepted: baseline.maxAccepted ?? 0,
    internalCount: internalMethods.length,
  };
}

/** Cap per-run filing volume so a pathological upstream change cannot flood the
 *  tracker. Overflow is still reported, in the run's own output. */
export const MAX_FILES_PER_RUN = 5;

export function filingPlan(result, { alreadyFiled = new Set() } = {}) {
  const wanted = [
    ...result.newGaps
      .filter((m) => validateMethodName(m))
      .map((m) => ({ kind: 'gap', method: m })),
    ...result.removedCovered
      .filter(({ method }) => validateMethodName(method))
      .map(({ method, tool }) => ({ kind: 'removed', method, tool })),
  ].filter((x) => !alreadyFiled.has(x.method));

  return {
    toFile: wanted.slice(0, MAX_FILES_PER_RUN),
    overflow: Math.max(0, wanted.length - MAX_FILES_PER_RUN),
    rejected: [
      ...result.newGaps.filter((m) => !validateMethodName(m)),
      ...result.removedCovered.map((r) => r.method).filter((m) => !validateMethodName(m)),
    ].sort(),
  };
}

/** Build an issue body from named fields only. Same discipline as #325: there is
 *  no parameter here through which captured output could arrive. */
export function buildGapBody({ method, kind, tool, apiVersion, runUrl }) {
  const safe = validateMethodName(method) ? method : '(name failed validation)';
  const lines = kind === 'removed'
    ? [
      `## A shipped tool maps to an \`@actual-app/api\` method that no longer exists`,
      '',
      `\`API_TO_TOOL\` maps \`${safe}\` to the tool \`${tool ?? '(unknown)'}\`, but the live surface no longer exports it.`,
      'That tool fails at runtime in a user budget. This is a P1.',
    ]
    : [
      `## Uncovered \`@actual-app/api\` method: \`${safe}\``,
      '',
      'The live surface exports this method and no MCP tool maps to it.',
      '',
      'This is informational: the drift lane blocks nothing. Either implement a tool,',
      `or accept the gap by adding \`${safe}\` to \`docs/audit/api-coverage-baseline.json\``,
      'with a reason and this issue number.',
    ];
  lines.push(
    '',
    `Detected against \`@actual-app/api\` ${apiVersion ?? '(unknown)'} by the api-surface-drift lane.`,
    `Run: ${runUrl ?? '(unknown)'}`,
    '',
    gapSentinel(safe),
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// IO shell. Runs only in the low-privilege `detect` job.
// ---------------------------------------------------------------------------

async function main() {
  const { analyzeCoverage, readImplementedTools, API_TO_TOOL, INTERNAL_METHODS } =
    await import('./list-actual-api-methods.mjs');
  const ActualApi = await import('@actual-app/api');
  const liveSurface = Object.keys(ActualApi).filter((k) => typeof ActualApi[k] === 'function');

  const baseline = JSON.parse(readFileSync(new URL('../docs/audit/api-coverage-baseline.json', import.meta.url), 'utf8'));
  const problems = validateBaseline(baseline);
  if (problems.length > 0) {
    process.stdout.write(`::error::api-coverage-baseline.json is invalid: ${problems.join('; ')}\n`);
    process.exit(1);
  }

  const { gaps } = analyzeCoverage({ apiMethodsOverride: liveSurface });
  const result = classify({
    apiToTool: API_TO_TOOL,
    liveSurface,
    internalMethods: INTERNAL_METHODS,
    gaps,
    baseline,
  });

  const apiVersion = JSON.parse(
    readFileSync(new URL('../node_modules/@actual-app/api/package.json', import.meta.url), 'utf8'),
  ).version;

  // JSON-encoded single line: the detect-to-report hop is an injection sink of
  // its own, since $GITHUB_OUTPUT is newline-delimited and an arbitrary ES2022
  // export name can carry a newline. Validation happens on the unprivileged side.
  const payload = JSON.stringify({ ...result, apiVersion, readImplemented: readImplementedTools().length });
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `result=${payload}\n`);
  }
  process.stdout.write(`${payload}\n`);

  if (result.red) {
    process.stdout.write('::warning::api surface drift detected; see the report job\n');
  }
  // Exit 0 regardless. Redness is carried in the payload, never in an exit code
  // that something downstream could learn to gate on.
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stdout.write(`::error::api-surface-drift: ${err.message}\n`);
    process.exit(1);
  });
}
