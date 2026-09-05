/**
 * #276: warn (once) when the Actual Budget SERVER version is outside the range this build's
 * `@actual-app/api` is known to work with.
 *
 * Reporting already existed (actual_server_get_version, actual_server_info) but nothing
 * enforced or even flagged compatibility. This adds an ADVISORY startup-ish warning: the
 * real compatibility contract is the migration check `@actual-app/api` runs at
 * downloadBudget, so this warning never fails startup and never blocks an operation.
 *
 * Design (mirrors src/lib/node-version-guard.ts):
 *  - The comparator is PURE (no I/O, no logging), so its truth table is unit-testable.
 *  - It FAILS OPEN: an unparseable version produces no warning. A spurious warning on a
 *    healthy deployment would be worse than staying quiet.
 *  - The firing is a per-PROCESS once-guard: the flag is flipped SYNCHRONOUSLY before any
 *    await, so the check runs exactly once no matter how many ops or sessions occur, and it
 *    reuses the connection the triggering op already established (no extra auth burst,
 *    avoiding the #127/#134 class). There is NO boot-time probe: index.ts deliberately has
 *    no startup connection, and a naive boot call would double-init then be torn down by
 *    shutdownActualApi.
 */

import { SUPPORTED_ACTUAL_SERVER_RANGE } from './constants.js';
import { INSTALLED_API_VERSION } from './installed-api-version.js';

export interface ServerVersionVerdict {
  ok: boolean;
  message?: string;
}

/** Parse `26.7.0` (or `v26.7.0`) into `[26, 7, 0]`. Returns null when unparseable. */
export function parseVersion(v: string): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

/** a < b as semver triples. */
function lessThan(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Pure. Compare a running server version against the supported range.
 * FAILS OPEN on anything unparseable (returns ok:true, no message), so a version string we
 * did not anticipate never produces a false warning.
 */
export function checkServerVersion(
  running: string,
  range: { minVersion: string; testedMaxMajor: number } = SUPPORTED_ACTUAL_SERVER_RANGE,
  bundledApi: string | null = INSTALLED_API_VERSION,
): ServerVersionVerdict {
  const have = parseVersion(running);
  const min = parseVersion(range.minVersion);
  if (!have || !min) return { ok: true };

  if (lessThan(have, min)) {
    return {
      ok: false,
      message:
        `Actual Budget server ${running} is older than the minimum this build supports ` +
        `(>= ${range.minVersion}). Some tools may misbehave. Upgrade the Actual Budget server, ` +
        'or pin an older actual-mcp-server. This is advisory: the server, not this warning, ' +
        'enforces compatibility at budget download.',
    };
  }

  if (have[0] > range.testedMaxMajor) {
    return {
      ok: false,
      message:
        `Actual Budget server ${running} is newer than this build was tested against ` +
        `(tested up to major ${range.testedMaxMajor}.x). It will very likely work, but if a ` +
        'tool behaves oddly, update actual-mcp-server. Advisory only.',
    };
  }

  // #439: the server is ahead of the `@actual-app/api` this build bundles.
  //
  // LAST in the chain deliberately (DECISION 3). Server 27.0.0 against bundled
  // 26.9.0 satisfies this AND the testedMaxMajor branch above, and the verdict is
  // single-valued, so the precedence is decided here rather than discovered by
  // whoever reads the message. The existing branch keeps priority and its
  // assertion stays green unchanged.
  //
  // MAJOR.MINOR ONLY (DECISION 2). Actual ships schema changes in MINOR releases
  // (26.9.0 added account_group_id), while server patches ship independently of
  // api patches, so comparing patches would be pure false-positive volume. It is
  // silent when equal and silent when the server is behind.
  //
  // Scope, stated because it is narrower than it looks: this fires only when ops
  // still SUCCEED, since the caller runs after a completed operation. A server so
  // far ahead that budget download already fails never reaches it, and that case
  // is #438's (surface the real session-init error) rather than this one's.
  const bundled = parseVersion(bundledApi ?? '');
  if (bundled && (have[0] > bundled[0] || (have[0] === bundled[0] && have[1] > bundled[1]))) {
    return {
      ok: false,
      message:
        `Actual Budget server ${running} is newer than the @actual-app/api ${bundledApi} ` +
        'this build bundles. Actual ships schema changes in minor releases, so a budget ' +
        'download can fail with an invalid-schema error once one lands. Upgrade ' +
        'actual-mcp-server, or hold the server upgrade until its dependency update has ' +
        'shipped. Advisory only.',
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-process once-guard.
// ---------------------------------------------------------------------------

let checked = false;

/**
 * Run the compatibility check at most once per process. Call this from inside a successful
 * `withActualApi` operation (while the connection is live), passing a function that reads the
 * server version through the SAME live connection (rawGetServerVersion, not the withActualApi
 * wrapped getServerVersion, to avoid re-entering the lock).
 *
 * NEVER throws. A read failure is a single `debug`; being outside the range is a single
 * `warn`; being in range is silent. The `log` argument is the module logger so all output
 * goes through the redaction-protected logger (never console.*), keeping stdio framing intact.
 */
export async function checkServerVersionOnce(
  readVersion: () => Promise<{ version: string } | { error: string }>,
  log: { warn: (msg: string) => void; debug: (msg: string) => void },
  // #439: injected as a VALUE, not a function, and defaulted here rather than
  // resolved per call. A per-call resolver would do blocking readFileSync inside
  // the process-global api mutex. Tests pass an explicit literal so no in-chain
  // assertion depends on what is installed (#321).
  bundledApi: string | null = INSTALLED_API_VERSION,
): Promise<void> {
  if (checked) return;
  checked = true; // set synchronously, before any await, so a concurrent op cannot double-fire

  try {
    const result = await readVersion();
    if (!result || 'error' in result || typeof result.version !== 'string') {
      log.debug('[server-version] could not read the Actual server version; skipping the compatibility check');
      return;
    }
    const verdict = checkServerVersion(result.version, SUPPORTED_ACTUAL_SERVER_RANGE, bundledApi);
    if (!verdict.ok && verdict.message) {
      log.warn(verdict.message);
    }
  } catch {
    // Advisory only: a failure to check must never surface as an error or affect the op.
    log.debug('[server-version] compatibility check threw; ignored');
  }
}

/** Test-only: reset the once-guard between cases. */
export function _resetForTests(): void {
  checked = false;
}
