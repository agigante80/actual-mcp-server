#!/usr/bin/env node
// train-preflight.mjs
//
// #324: the six pre-flight controls that decide whether the @actual-app/api
// release train may run tonight. Extracted into a script, rather than added as
// workflow steps, for two reasons:
//
//  1. FOURTEEN places in dependency-update.yml consume
//     `steps.versions.outputs.update_needed`. A new step emitting its own output
//     would leave all fourteen gates reading the old one and the train would
//     proceed despite a denylist hit. This script keeps `update_needed` with its
//     exact existing name and semantics, so that diff is zero lines.
//  2. workflow_release_guards.test.js is a TEXT parser. It cannot execute a
//     step's shell, so logic living in a `run:` block cannot be unit tested. The
//     denylist is a two-sided contract, and an untested one fails silently in
//     precisely the situation it exists for: mid-incident, nobody reading closely.
//
// Mirrors the scripts/report-train-failure.mjs shape: pure exported decision
// functions, thin I/O layer behind a direct-invocation check.
//
// CONTROL ORDER IS LOAD BEARING. See decidePreflight.

import process from 'node:process';
import { readFileSync } from 'node:fs';

/** Closed enum. '' means "proceed". */
export const REFUSAL_REASONS = ['', 'up_to_date', 'not_forward', 'denied', 'soaking'];

/** Documented floor for the soak window, in hours. A repository variable may
 *  RAISE the window or lower it only to this floor; it can never silently
 *  disable the control by being unset, empty, or mistyped. */
export const SOAK_FLOOR_HOURS = 48;

/** And a CEILING. Clamping only the floor left the one direction that silently
 *  disables the train: a fat-fingered 4800 instead of 48 makes every run report
 *  `soaking`, which maps to `ignore`, so the train is off for six months and
 *  NOBODY IS TOLD. The step summary would even say "clears automatically, no
 *  action needed". A week is far past any real yank window. */
export const SOAK_CEILING_HOURS = 168;

/** A bare MAJOR.MINOR.PATCH triple. Deliberately NOT full semver: everything
 *  downstream compares release triples only, which is the domain where ordering
 *  is unambiguous. */
const TRIPLE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Anything with a prerelease or build suffix. */
const HAS_SUFFIX = /^\d+\.\d+\.\d+[-+]/;

export function parseTriple(raw) {
  const s = typeof raw === 'string' ? raw.trim().replace(/^[\^~]/, '') : '';
  const m = TRIPLE.exec(s);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], value: s } : null;
}

export function isPrerelease(raw) {
  return typeof raw === 'string' && HAS_SUFFIX.test(raw.trim().replace(/^[\^~]/, ''));
}

/** Strict numeric comparison. NOT `sort -V`.
 *
 *  Verified: `printf '26.8.0\n26.8.0-alpha.1\n' | sort -V | tail -1` yields the
 *  PRERELEASE, ranking it above its own release, which is the opposite of semver
 *  precedence. Prereleases are refused before this is ever reached, so this only
 *  ever compares two triples, but the comparison is done here in code rather than
 *  by shelling out so the semantics are testable and cannot drift. */
export function compareTriples(a, b) {
  const x = parseTriple(a);
  const y = parseTriple(b);
  if (!x || !y) throw new Error(`compareTriples needs two valid triples, got ${a} and ${b}`);
  return (x.major - y.major) || (x.minor - y.minor) || (x.patch - y.patch);
}

/**
 * Parse the committed denylist.
 *
 * Format contract, pinned by fixture tests:
 *  - one entry per line
 *  - everything from the first `#` to end of line is a comment and is stripped
 *  - the entry is the FIRST whitespace-delimited token of what remains
 *  - blank lines are ignored
 *  - matching is EXACT string equality on that token
 *
 * The exactness matters: a naive `grep -q "$LATEST"` would match a version named
 * inside a comment on an unrelated line and block a perfectly good release.
 */
/** Entries that are not bare version triples. A denylist is edited by a human
 *  mid-incident under time pressure, and `- 26.8.0`, `# 26.8.0`, `v26.8.0` or
 *  `^26.8.0` all READ as "this version is listed" while matching nothing. That
 *  is the guard-that-reads-as-protection defect one layer down, in the data. */
export function invalidDenylistEntries(text) {
  return [...parseDenylist(text)].filter((t) => !TRIPLE.test(t)).sort();
}

export function parseDenylist(text) {
  const out = new Set();
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const withoutComment = line.split('#')[0];
    const token = withoutComment.trim().split(/\s+/)[0];
    if (token) out.add(token);
  }
  return out;
}

/** Resolve the soak window, clamped. Repository variables are not code reviewed
 *  and no guard test can pin them, so an unset, empty, non-numeric or too-small
 *  value falls back to the floor rather than weakening the control. */
export function resolveSoakWindowHours(raw) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return SOAK_FLOOR_HOURS;
  return Math.min(Math.max(n, SOAK_FLOOR_HOURS), SOAK_CEILING_HOURS);
}

/**
 * Has the upstream release aged past the window?
 *
 * FAILS CLOSED. A missing, unparseable, or absent timestamp means NOT soaked, so
 * the train no-ops with a warning. It must never read missing age data as
 * sufficient age. The cost of failing closed is latency on a nightly job with
 * nobody waiting, and the next run retries automatically.
 */
export function isSoaked({ publishedAt, now, windowHours }) {
  const t = Date.parse(publishedAt ?? '');
  const n = Date.parse(now ?? '');
  if (!Number.isFinite(t) || !Number.isFinite(n)) return false;
  return (n - t) >= windowHours * 3600 * 1000;
}

/** Upstream MAJOR bumps us a MINOR, never a patch.
 *
 *  Semver describes OUR contract (the 71-tool MCP surface), not our dependency
 *  versions. Caveat recorded deliberately: @actual-app/api majors are CalVer and
 *  roll over every January regardless of content, so this fires annually by
 *  construction. Minor is still the honest signal, but nobody should read it as
 *  "proven safe": tool OUTPUT shapes are pinned by no test anywhere. */
export function bumpTypeFor({ current, latest }) {
  const a = parseTriple(current);
  const b = parseTriple(latest);
  if (!a || !b) return 'patch';
  return b.major > a.major ? 'minor' : 'patch';
}

/**
 * The single decision point.
 *
 * ORDER IS LOAD BEARING, and three adjacencies in particular:
 *
 *  - VALIDITY BEFORE DIRECTION. Verified: `printf '%s\n%s\n' "26.8.0" "" |
 *    sort -V | tail -1` returns 26.8.0, so an empty LATEST makes the direction
 *    check take its else branch and report a quiet "refusing to downgrade".
 *    Validity is the only control whose disposition is RED; direction is silent.
 *    The wrong order turns a multi-night registry outage into total silence,
 *    which is verbatim the defect #325 exists to eliminate.
 *  - EQUALITY BEFORE DIRECTION. Two equal values make `sort -V | tail -1` return
 *    that value, which equals LATEST, so update_needed would fire and the train
 *    would branch, run a no-op install, bump, and publish a release containing no
 *    dependency change, every single night.
 *  - DENYLIST BEFORE SOAK. A version that is both denylisted and young must
 *    report `denied`, not `soaking`. The soak clears itself; the denylist does
 *    not. Reporting "soaking" would leave an operator waiting for a publish that
 *    is never coming.
 *
 * @returns {{updateNeeded: boolean, refusalReason: string, bumpType: string,
 *            error: string|null, warning: string|null}}
 */
export function decidePreflight({
  current, latest, denylistText, publishedAt, now, soakWindowRaw,
} = {}) {
  const no = (refusalReason, warning = null) =>
    ({ updateNeeded: false, refusalReason, bumpType: 'patch', error: null, warning });
  const red = (error) =>
    ({ updateNeeded: false, refusalReason: '', bumpType: 'patch', error, warning: null });

  // The absent-denylist disposition lives HERE, not only in the caller. Leaving
  // it in the I/O shell meant any future second caller of this function silently
  // lost the control, which is the same per-call-site-rather-than-structural
  // pattern CLAUDE.md already flags for withOpTimeout.
  if (denylistText === null || denylistText === undefined) {
    return red('denylist is missing or unreadable; refusing to run without it');
  }
  const malformed = invalidDenylistEntries(denylistText);
  if (malformed.length > 0) {
    return red(`denylist has entries that are not bare version triples and would match nothing: ${malformed.join(', ')}`);
  }

  // 1. VALIDITY. Both sides. `node -p "require('./package.json').dependencies[x]"`
  //    prints the literal string "undefined" for a missing key (verified), so an
  //    invalid CURRENT is our own repo state and equally deserves a red run.
  if (!parseTriple(current)) {
    return red(`CURRENT is not a valid version triple: ${JSON.stringify(current ?? null)}`);
  }
  if (!parseTriple(latest) && !isPrerelease(latest)) {
    return red(`LATEST is not a valid version: ${JSON.stringify(latest ?? null)}`);
  }

  // 2. EQUALITY.
  if (String(current).replace(/^[\^~]/, '').trim() === String(latest).trim()) {
    return no('up_to_date');
  }

  // 3. PRERELEASE. Before direction, so the comparison below only ever sees two
  //    release triples. If a prerelease ever reached the `latest` dist-tag and we
  //    took it, the NEXT night the move back to the real release would be refused
  //    as backwards and the repo would be stuck on a prerelease permanently,
  //    emitting a quiet no-op nightly with no failure signal.
  if (isPrerelease(latest)) {
    return no('not_forward', `refusing prerelease ${latest}: the train ships release triples only`);
  }

  // 4. DIRECTION. Refuse anything that is not a strict forward move. The `latest`
  //    dist-tag is publisher-controlled and CAN move backwards; that is the
  //    standard remediation for a bad release, since npm blocks unpublish after
  //    72 hours.
  if (compareTriples(latest, current) <= 0) {
    return no('not_forward', `refusing non-forward move ${current} to ${latest}`);
  }

  // 5. DENYLIST. Before soak. A missing file is handled by the caller as RED: an
  //    absent safety control is a failure, not a no-op.
  const denied = parseDenylist(denylistText);
  if (denied.has(String(latest).trim())) {
    return no('denied', `refusing denylisted version ${latest}`);
  }

  // 6. SOAK. Proactive where the denylist is reactive. Bad releases are typically
  //    yanked inside 24 to 72 hours, and this is a nightly job with nobody
  //    waiting, so the latency is free.
  const windowHours = resolveSoakWindowHours(soakWindowRaw);
  if (!isSoaked({ publishedAt, now, windowHours })) {
    return no('soaking', `refusing ${latest}: younger than the ${windowHours}h soak window, or its publish time could not be read`);
  }

  return {
    updateNeeded: true,
    refusalReason: '',
    bumpType: bumpTypeFor({ current, latest }),
    error: null,
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// I/O shell. Registry READS only: this must never run `npm install`, so it does
// not widen what the update-test-release job executes.
// ---------------------------------------------------------------------------

async function main() {
  const { execFileSync } = await import('node:child_process');
  const out = [];
  const emit = (k, v) => out.push(`${k}=${v}`);

  const current = String(process.env.TRAIN_CURRENT ?? '').trim();

  // Retry the registry lookup so a single transient blip cannot file a phantom P1.
  let latest = '';
  let lookupError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      latest = execFileSync('npm', ['show', '@actual-app/api', 'version'], { encoding: 'utf8' }).trim();
      lookupError = null;
      break;
    } catch (err) {
      lookupError = err;
      if (attempt < 3) execFileSync('sleep', ['10']);
    }
  }

  // Write current and latest BEFORE evaluating any control, so an early refusal
  // still populates the reporter's TRAIN_VERSION instead of leaving it placeheld.
  emit('current', current);
  emit('latest', latest);

  // Same 3-retry treatment as `npm show`, and its exhaustion is RED.
  //
  // It previously swallowed every error into `publishedAt = null`, which the soak
  // then reported as `soaking`: a green run, an invisible warning, and no issue
  // filed. "Young" (a legitimate quiet wait) and "we could not read the
  // timestamp" (an infrastructure fault) shared one disposition, so a persistent
  // output-shape change would have stopped the train permanently and silently.
  let publishedAt = null;
  let timeError = null;
  if (latest) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const times = JSON.parse(
          execFileSync('npm', ['view', '@actual-app/api', 'time', '--json'], { encoding: 'utf8' }),
        );
        // Indexed by the EXACT resolved version. That map also carries `created`
        // and `modified`, which are not versions, so any positional read or a
        // fallback to `modified` would be wrong.
        publishedAt = times?.[latest] ?? null;
        timeError = publishedAt ? null : new Error(`no publish time recorded for ${latest}`);
        if (publishedAt) break;
      } catch (err) {
        timeError = err;
      }
      if (attempt < 3) execFileSync('sleep', ['10']);
    }
  }

  let denylistText = null;
  try {
    denylistText = readFileSync(new URL('../.github/actual-api-denylist.txt', import.meta.url), 'utf8');
  } catch {
    // Pass null through rather than exiting here: decidePreflight owns the
    // disposition, so the control cannot be lost by a future second caller.
    denylistText = null;
  }

  const decision = decidePreflight({
    current,
    latest,
    denylistText,
    publishedAt,
    now: new Date().toISOString(),
    soakWindowRaw: process.env.TRAIN_SOAK_HOURS,
  });

  // F6: flush what is already known BEFORE any red exit. The comment above
  // claimed an early refusal still populates the reporter's TRAIN_VERSION, but
  // the append happened after all three exit sites, so the two RED paths (the
  // ones that actually page a human) wrote nothing.
  const flush = async () => {
    if (!process.env.GITHUB_OUTPUT) return;
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `${out.join('\n')}\n`);
  };

  if (timeError && latest) {
    await flush();
    process.stdout.write(`::error::could not read the publish time for ${latest} after 3 attempts: ${timeError.message}\n`);
    process.exit(1);
  }
  if (lookupError && !latest) {
    await flush();
    process.stdout.write(`::error::npm show failed after 3 attempts: ${lookupError.message}\n`);
    process.exit(1);
  }
  if (decision.error) {
    await flush();
    process.stdout.write(`::error::${decision.error}\n`);
    process.exit(1);
  }
  if (decision.warning) {
    process.stdout.write(`::warning::${decision.warning}\n`);
  }

  emit('update_needed', String(decision.updateNeeded));
  emit('refusal_reason', decision.refusalReason);
  emit('bump_type', decision.bumpType);
  emit('soak_hours', String(resolveSoakWindowHours(process.env.TRAIN_SOAK_HOURS)));

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `${out.join('\n')}\n`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stdout.write(`::error::train-preflight: ${err.message}\n`);
    process.exit(1);
  });
}
