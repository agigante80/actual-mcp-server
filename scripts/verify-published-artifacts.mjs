#!/usr/bin/env node
// verify-published-artifacts.mjs
//
// #326: a green pipeline is not proof the artifact exists.
//
// There are three distinct claims and the release lane conflates the last two:
//   1. the run TRIGGERED
//   2. the run went GREEN
//   3. the ARTIFACT EXISTS
// `needs:` on the publish jobs proves those jobs exited 0. It does not prove a
// third-party registry now serves what we think it serves.
//
// SCOPE, corrected during gating. The original ticket aimed this at Docker, but
// Docker is already largely covered: the manifest-assembly step hard-fails
// unless it finds exactly 2 per-arch digests, and the tag-gated deployment-test
// job already pulls AND runs the published image from both Docker Hub and
// ghcr.io. NOTHING anywhere reads back the npm artifact. npm is the real hole
// and gets the weight here.
//
// npm PUBLISHES CANNOT BE UNDONE, and that is accepted rather than engineered
// around. `npm dist-tag add` is unsupported by Trusted Publishers (npm/cli#8547),
// so a staged `next` publish would force a long-lived NPM_TOKEN back into an
// unattended nightly lane: a large permanent risk traded for a small rare one.
// Staging would not make a publish reversible anyway; the version is immutable
// and public the instant it lands. See docs/guides/DEPLOYMENT.md.

import process from 'node:process';

/** Docker tags are built from `docker_version`, NOT `version`: build metadata is
 *  not legal in a tag, so `+` becomes `-`. A verifier interpolating `version`
 *  would look up a nonexistent tag whenever build metadata is present and raise
 *  a false P1 on a perfectly healthy release. */
export function dockerVersionFor(version) {
  return String(version ?? '').replace(/\+/g, '-');
}

/** The platform set a release must serve. Set equality, never a count. */
export const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

/**
 * Real platforms in a manifest list, with attestation entries removed.
 *
 * Verified live against ghcr.io 0.9.3: `docker manifest inspect` returns FOUR
 * entries, not two. `--provenance` attaches attestation manifests carrying
 * `{"architecture":"unknown","os":"unknown"}`. So a count-based or "at least 2"
 * assertion passes a manifest that serves only one real architecture.
 */
export function realPlatforms(manifest) {
  const list = manifest?.manifests ?? [];
  return list
    .map((m) => m?.platform ?? {})
    .filter((p) => p.os && p.architecture && p.os !== 'unknown' && p.architecture !== 'unknown')
    .map((p) => `${p.os}/${p.architecture}`)
    .sort();
}

/** Set equality against the required platforms. */
export function assertPlatforms(manifest, required = REQUIRED_PLATFORMS) {
  const have = realPlatforms(manifest);
  const want = [...required].sort();
  const missing = want.filter((p) => !have.includes(p));
  const extra = have.filter((p) => !want.includes(p));
  return { ok: missing.length === 0 && extra.length === 0, have, missing, extra };
}

/**
 * Three-state probe classification. Two of these exit nonzero, but they are
 * distinguished in the report, because "the registry said no" and "we could not
 * ask" are different incidents and only the first is a P1.
 *
 * `inconclusive` must NEVER be reported as success, and never as absent.
 */
export function classifyProbe({ status, errorCode, body, attemptsExhausted = true } = {}) {
  // A definite negative only counts on the FINAL attempt.
  if (!attemptsExhausted) return 'inconclusive';

  if (status === 200 || status === 'ok') return 'confirmed_present';

  // npm exits nonzero with parseable JSON carrying error.code E404 for a version
  // that genuinely is not published. Any other nonzero shape is inconclusive.
  if (errorCode === 'E404' || status === 404) return 'confirmed_absent';

  if (status === 429 || (typeof status === 'number' && status >= 500)) return 'inconclusive';
  if (status === 401 || status === 403) return 'inconclusive';
  if (['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(errorCode)) return 'inconclusive';
  if (body !== undefined && body !== null && typeof body !== 'object') return 'inconclusive';
  return 'inconclusive';
}

/** Retry budgets. npm is slower to become readable after publish than a registry. */
export const BUDGETS = {
  npm: { attempts: 10, delaysMs: [5000, 10000, 20000, 40000], capMs: 60000, deadlineMs: 300000 },
  registry: { attempts: 5, delaysMs: [5000, 10000, 20000], capMs: 30000, deadlineMs: 120000 },
};

export function backoffFor(kind, attempt) {
  const b = BUDGETS[kind];
  if (!b) throw new Error(`unknown budget ${kind}`);
  return Math.min(b.delaysMs[attempt] ?? b.capMs, b.capMs);
}

/** Overall disposition across every surface probed. */
export function overallVerdict(results) {
  const vals = Object.values(results ?? {});
  if (vals.some((v) => v === 'confirmed_absent')) return 'artifact_absent';
  if (vals.some((v) => v === 'inconclusive')) return 'inconclusive';
  return vals.length > 0 && vals.every((v) => v === 'confirmed_present') ? 'ok' : 'inconclusive';
}

/** A short, bounded detail string naming which surface failed, for the #325
 *  reporter. Named fields only, never captured output. */
export function detailFor(results) {
  return Object.entries(results ?? {})
    .filter(([, v]) => v !== 'confirmed_present')
    .map(([surface, v]) => `${surface}=${v}`)
    .sort()
    .join(' ')
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// IO shell
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function probeNpm(pkg, version) {
  const { execFileSync } = await import('node:child_process');
  const started = Date.now();
  for (let attempt = 0; attempt < BUDGETS.npm.attempts; attempt += 1) {
    const last = attempt === BUDGETS.npm.attempts - 1
      || Date.now() - started > BUDGETS.npm.deadlineMs;
    try {
      const out = execFileSync('npm', ['view', `${pkg}@${version}`, 'version', '--json'], {
        encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (JSON.parse(out) === version) return 'confirmed_present';
    } catch (err) {
      let code;
      try { code = JSON.parse(err.stderr ?? '{}')?.error?.code; } catch { code = undefined; }
      const verdict = classifyProbe({ errorCode: code, attemptsExhausted: last });
      if (last) return verdict;
    }
    if (!last) await sleep(backoffFor('npm', attempt));
  }
  return 'inconclusive';
}

async function probeManifest(ref) {
  const { execFileSync } = await import('node:child_process');
  const started = Date.now();
  for (let attempt = 0; attempt < BUDGETS.registry.attempts; attempt += 1) {
    const last = attempt === BUDGETS.registry.attempts - 1
      || Date.now() - started > BUDGETS.registry.deadlineMs;
    try {
      const out = execFileSync('docker', ['manifest', 'inspect', ref], {
        encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const res = assertPlatforms(JSON.parse(out));
      if (res.ok) return 'confirmed_present';
      process.stdout.write(`::warning::${ref} serves [${res.have.join(', ')}], missing [${res.missing.join(', ')}]\n`);
      return 'confirmed_absent';
    } catch (err) {
      if (/no such manifest|manifest unknown|not found/i.test(err.stderr ?? err.message ?? '')) {
        if (last) return 'confirmed_absent';
      } else if (last) return 'inconclusive';
    }
    if (!last) await sleep(backoffFor('registry', attempt));
  }
  return 'inconclusive';
}

async function main() {
  const version = process.env.VERIFY_VERSION;
  const dockerVersion = dockerVersionFor(version);
  const pkg = process.env.VERIFY_NPM_PACKAGE ?? 'actual-mcp-server';
  const hub = process.env.VERIFY_HUB_IMAGE;
  const ghcr = process.env.VERIFY_GHCR_IMAGE;

  if (!version) {
    process.stdout.write('::error::VERIFY_VERSION is required\n');
    process.exit(1);
  }

  const results = {};
  results.npm = await probeNpm(pkg, version);
  if (hub) results.dockerhub = await probeManifest(`${hub}:${dockerVersion}`);
  if (ghcr) results.ghcr = await probeManifest(`${ghcr}:${dockerVersion}`);

  const verdict = overallVerdict(results);
  const detail = detailFor(results);

  for (const [surface, r] of Object.entries(results)) {
    process.stdout.write(`${surface}: ${r}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\ndetail=${detail}\n`);
  }

  if (verdict === 'ok') {
    process.stdout.write(`::notice::all published artifacts confirmed for ${version}\n`);
    return;
  }
  // Both remaining verdicts are red, but the message distinguishes "the registry
  // said no" from "we could not ask".
  process.stdout.write(`::error::artifact verification ${verdict}: ${detail}\n`);
  process.exit(1);
}

const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stdout.write(`::error::verify-published-artifacts: ${err.message}\n`);
    process.exit(1);
  });
}
