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
 *  - The firing is a per-PROCESS once-guard ON SUCCESS, and the qualifier is #453's change:
 *    `checked` is set only once a version has actually been READ, with `inFlight` providing the
 *    concurrency property the old synchronous latch provided and `attempts` capping the retries
 *    at MAX_PROBE_ATTEMPTS. A FAILING probe is therefore retried up to that cap instead of
 *    silencing the warning for the life of the process, which is what the synchronous latch did
 *    once the probe moved ahead of the first budget download. There are TWO call sites now: the
 *    pre-download one in budgetLoader (which issues its own bounded /info read) and the original
 *    post-op one in withActualApi (which reuses the connection the triggering op established, so
 *    it adds no auth burst, avoiding the #127/#134 class). NEITHER call site bounds its reader:
 *    the bound lives in `raceWithBound` below, deliberately, so the set of call sites cannot
 *    matter. Do not delete it on the strength of a caller looking safe. There is still NO boot-time probe:
 *    index.ts deliberately has no startup connection, and a naive boot call would double-init
 *    then be torn down by shutdownActualApi.
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
  // Scope: this USED to fire only when ops still SUCCEEDED, because the only caller ran after a
  // completed operation, so a server far enough ahead that the budget download already failed
  // never reached it. #453 removed that limit by adding a call site BEFORE the download in
  // loadBudgetTracked, which is the case this branch most wanted to reach. The verdict is
  // unchanged; only WHEN it can be asked changed. #438 still owns surfacing the real error
  // AFTER a failure; this warns before one.
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

/**
 * How long a version probe may take before it is abandoned. Deliberately a CONSTANT and not an
 * env var: it is an advisory diagnostic, nobody should have to tune it, and a new config key would
 * need threading through config.ts, .env.example and the README table (the config-drift guard
 * enforces all three) to buy nothing. 5 seconds is far more than a healthy /info needs.
 */
export const SERVER_VERSION_PROBE_TIMEOUT_MS = 5000;

let checked = false;      // a version WAS read and judged: never check again
let inFlight = false;     // a check is running right now: a concurrent caller must not duplicate it
let attempts = 0;         // failed attempts, so an unreachable /info cannot be probed forever

/** Failed probes tolerated before the check gives up for the process. */
const MAX_PROBE_ATTEMPTS = 3;

/**
 * Bound the read WITHOUT importing `withOpTimeout`.
 *
 * The obvious implementation reuses that helper, and review caught what it drags in: `opTimeout`
 * imports `config.ts`, which Zod-validates the environment AT MODULE LOAD and hard-exits when it
 * is missing. That breaks this module's own design note, that the comparator is PURE and
 * unit-testable without I/O, and it makes `tests/unit/server_version_guard.test.js` unable to
 * load at all without an environment.
 *
 * ONE CORRECTION to how this was first justified, since a wrong reason in a comment outlives the
 * observation that produced it: the original wording claimed the import turned the unit chain
 * "red locally, green in CI". The chain ALREADY dies without env vars, earlier, at
 * `config_https_validation.test.js`. So the import does not change what the chain does on a bare
 * machine. The property is still worth enforcing (a pure comparator that any harness can import
 * and test in isolation), the drama was not.
 *
 * So the bound is an inline race with a fixed constant, and this module keeps importing nothing
 * but its two pure siblings. The timer is always cleared, so a fast read leaves nothing pending
 * to hold the process open.
 */
async function raceWithBound<T>(read: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`server-version probe exceeded ${SERVER_VERSION_PROBE_TIMEOUT_MS}ms`)),
          SERVER_VERSION_PROBE_TIMEOUT_MS,
        );
        // NOT unref'd, and that is deliberate. `unref` was the first instinct ("never hold the
        // process open for an advisory diagnostic") and it quietly breaks the bound: an unref'd
        // timer does not keep the event loop alive, so in a process with nothing else pending
        // Node exits before it fires and the race never rejects. The test that pins this bound
        // caught exactly that, as an unsettled top-level await. A live server always has other
        // work, so it would have fired there and the hazard would have stayed hidden.
        //
        // The cost of keeping it ref'd is bounded by construction: at most
        // SERVER_VERSION_PROBE_TIMEOUT_MS, and the `finally` below clears it as soon as the read
        // answers, so a healthy probe leaves nothing pending at all.
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  if (checked || inFlight || attempts >= MAX_PROBE_ATTEMPTS) return;
  // #453 review: the latch used to be set here, synchronously, before the await. That was right
  // while this ran only AFTER a successful operation. Once the probe moved BEFORE the first
  // download it became the most failure-prone moment available (a slow or unreachable /info, or
  // the op timeout firing), and a single failure then disabled the warning for the LIFETIME of
  // the process, including #276's surviving post-op call site. The deployment that silenced it
  // is precisely the one the guard exists for.
  //
  // THE BOUND IS APPLIED HERE, not by the caller. It started at the call sites and review was
  // right that prose cannot hold it: `inFlight` is cleared in a `finally`, so a reader whose
  // promise NEVER settles leaves it true for the life of the process and permanently disables the
  // warning, which is the very failure this rework removed, just relocated. Bounding inside makes
  // the set of call sites stop mattering, the same argument #393 used for the abandoned-load wait.
  //
  // So: `inFlight` keeps the concurrency property the synchronous latch was actually providing,
  // `checked` is now set only once a version was really read and judged, and `attempts` bounds
  // the retries so an unreachable server costs at most MAX_PROBE_ATTEMPTS extra /info calls per
  // process rather than one per budget load.
  inFlight = true;

  try {
    const result = await raceWithBound(readVersion);
    if (!result || 'error' in result || typeof result.version !== 'string') {
      attempts++;
      log.debug('[server-version] could not read the Actual server version; skipping the compatibility check');
      return;
    }
    checked = true;   // a real answer: this is the one and only judgement
    const verdict = checkServerVersion(result.version, SUPPORTED_ACTUAL_SERVER_RANGE, bundledApi);
    if (!verdict.ok && verdict.message) {
      log.warn(verdict.message);
    }
  } catch (err) {
    // Advisory only: a failure to check must never surface as an error or affect the op.
    //
    // NAME THE CAUSE. Once the bound moved inside this function, "probe exceeded 5000ms" became
    // the most common way through here, and it is indistinguishable from `rawGetServerVersion`
    // being undefined (it is destructured from `api as any` at module load, so an upstream build
    // that stops exporting it throws a TypeError down this same path). An operator wondering why
    // the compatibility warning never appears would have had nothing to go on.
    attempts++;
    const reason = err instanceof Error ? err.message : String(err);
    log.debug(`[server-version] compatibility check failed; ignored: ${reason}`);
  } finally {
    inFlight = false;
  }
}

/** Test-only: reset the once-guard between cases. */
export function _resetForTests(): void {
  checked = false;
  inFlight = false;
  attempts = 0;
}
