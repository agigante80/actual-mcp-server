import api from '@actual-app/api';
import { withOpTimeout } from './opTimeout.js';
import config from '../config.js';
import { setApiInitialized, setLoadedBudgetSyncId, registerBudgetLoad } from './apiState.js';
import { createModuleLogger } from './loggerFactory.js';

const log = createModuleLogger('BUDGET-LOADER');

/**
 * #390 round 3: the ONE way this codebase loads a budget.
 *
 * Every site used to hand-write `withOpTimeout(() => api.downloadBudget(...))` followed by a
 * record-on-success. That shape is wrong in a way no amount of care fixes, because
 * `withOpTimeout` races rather than cancels: on timeout the download keeps running and later
 * re-points the singleton outside the mutex, and recording only on success leaves the record
 * naming the PREVIOUS budget while the singleton holds the new one, which is the one direction
 * that makes the precondition silently pass.
 *
 * So: clear the record BEFORE starting (an abandonment can then only leave it indeterminate,
 * which forces a re-select), register the promise so a late landing is waited for rather than
 * discovered, and record the true outcome when it settles whether or not anyone is still
 * listening.
 *
 * #396 adds a POST-CONDITION, because a resolved download is not proof a budget is open.
 * See `assertBudgetOpen` below.
 *
 * INVARIANT: nothing in this file may call anything that takes `withApiLock`. Every caller
 * already holds that non-reentrant mutex, so `adapter.*` here would deadlock. It is also what
 * makes this loader safe to call from `actualConnection.ts`, which acquires the lock itself.
 * (#402 tracks making this structural rather than conventional.)
 */

/** The closed set of reasons upstream's `_loadBudget` can report, via `withErrorCode`. */
const KNOWN_LOAD_REASONS = new Set([
  'budget-not-found',
  'opening-budget',
  'out-of-sync-migrations',
  'out-of-sync-data',
  'loading-budget',
]);

/** Upper bound on any upstream prose we echo to the client (#396 security review). */
const MAX_REASON_CHARS = 200;

/** Sentinel: the diagnostic load worked, so the failure was not deterministic. */
const RETRY_SUCCEEDED = 'the load succeeded on a second attempt, so this looks transient; retry the operation';

/** Reported when the syncId has no LOCAL copy. Deliberately says nothing about what does exist. */
const NO_LOCAL_COPY = 'no local copy of this budget was found';

/**
 * Brand for "the download resolved but no budget is open", so the caller can tell it from an
 * upstream stall without matching prose. Deliberately NOT a PreflightRefusal: this is an
 * infrastructure failure, not a caller-fixable refusal (`errors.ts` taxonomy).
 */
const BUDGET_NOT_OPEN = Symbol.for('actual-mcp.budgetNotOpen');

function isBudgetNotOpen(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as Record<symbol, unknown>)[BUDGET_NOT_OPEN] === true;
}

/**
 * Read `.message` off anything upstream throws.
 *
 * NO `instanceof Error` GUARD, deliberately. `checkFileOpen()` throws `APIError(...)`, which
 * RETURNS A PLAIN OBJECT (`{ type: 'APIError', message, meta }`). Measured against
 * @actual-app/api 26.8.0: `err instanceof Error` is false and `String(err)` is `[object Object]`,
 * while `.message` works. Same precedent as `actual-adapter.ts` ("Handle Actual APIError plain
 * objects").
 */
function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return typeof err === 'string' ? err : '';
}

function codeOf(err: unknown): string | undefined {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return undefined;
}

/** A timeout from `withOpTimeout` is an upstream STALL, never an unloadable budget. */
function isOpTimeout(err: unknown): boolean {
  return /timed out after \d+ms \(ACTUAL_OP_TIMEOUT_MS\)/.test(messageOf(err));
}

/**
 * #396 POST-CONDITION: is a budget actually open?
 *
 * `api.downloadBudget()` can RESOLVE while leaving nothing open. Upstream's
 * `api/download-budget` discards the `{ error }` that `load-budget` returns, in BOTH branches
 * (loot-core `src/server/api.ts:237` for a local copy, `:261` after a fresh download), and
 * `load-budget` does not throw: it returns an error object having already called `closeBudget()`
 * internally, which unloads prefs. The sync that follows cannot catch it either, because
 * `_fullSync` opens with `if (... || !currentId) return []`, so with nothing loaded it reports
 * success by returning nothing. Reproduced two ways against a real budget (a planted unknown
 * migration id, and a `db.sqlite` that is not a database): the download resolves, nothing is
 * open, and every later call throws `No budget file is open` permanently for that data dir.
 *
 * The probe is `api.getBudgetMonths()`, and it is cheap for a reason worth stating rather than
 * assuming: it is `checkFileOpen()` plus `createAllBudgets()`, and `createAllBudgets()` already
 * ran once inside `_loadBudget` against the SAME in-process `Spreadsheet` singleton, while
 * `meta.createdMonths` is never persisted, so the second call filters to zero new months and does
 * no work beyond one indexed SQLite read. Measured at 0ms with no network call.
 */
async function assertBudgetOpen(): Promise<void> {
  try {
    await withOpTimeout(() => (api as unknown as { getBudgetMonths: () => Promise<unknown> }).getBudgetMonths(), 'budget-open probe');
  } catch (err) {
    // An upstream STALL is not an unloadable budget. Propagate it unchanged so it keeps #270's
    // semantics: diagnosing it as a version or data-dir problem would point the user at the wrong
    // subsystem, and its message contains "timed out", which `_shouldDropPoolOnError` classes
    // transient (correctly, for a stall).
    if (isOpTimeout(err)) throw err;

    // #396 review: classify as "not open" ONLY on the signal that actually means it. Treating
    // EVERY probe rejection as not-open was wrong in the expensive direction: a transient
    // getBudgetMonths failure against a perfectly healthy OPEN budget would poison the singleton,
    // send `diagnose` off to CLOSE and reload that healthy budget, and hand the caller a
    // permanent-sounding "no budget file is open". Anything else is a genuine failure and
    // propagates unchanged; the enclosing `.catch` still fails closed either way.
    if (!/no budget file is open/i.test(messageOf(err))) throw err;

    const notOpen = new Error('the budget did not load') as Error & Record<symbol, boolean>;
    notOpen[BUDGET_NOT_OPEN] = true;
    throw notOpen;
  }
}

/**
 * Strip anything path-shaped from upstream prose before it reaches an MCP client.
 *
 * There is NO redaction backstop on this path: `actualToolsManager.callTool` rethrows and
 * `ActualMCPConnection.executeTool` propagates, so the message reaches the client verbatim, and
 * `redactSecrets` is a winston format that covers log transports only. The five `getSyncError`
 * strings interpolate just the budget UUID and are safe, but `_loadBudget` maps to that enum only
 * for failures it CATCHES: `db.loadClock()`, `prefs.savePrefs` and `startBackupService(id)` sit
 * outside every try/catch, so a raw fs or sqlite error carrying an ABSOLUTE PATH (and therefore a
 * username) can reach here. Capping does not scrub a path, so scrub first.
 */
function scrubReason(prose: string): string | undefined {
  if (!prose) return undefined;
  // #396 review: reject on ANY separator, not just one at a word boundary. The first version
  // required `/` at the string start or after whitespace, a quote or a paren, so
  // `ENOENT:/home/alice/...` and `C:/Users/alice/...` both slipped through WITH the OS username,
  // on a path that has no redaction backstop. The five known-safe upstream reasons are plain
  // prose plus a UUID and contain none of these characters, so rejecting outright costs nothing
  // and cannot leak.
  if (/[/\\~]/.test(prose)) return undefined;
  return prose.length > MAX_REASON_CHARS ? `${prose.slice(0, MAX_REASON_CHARS)}...` : prose;
}

/**
 * Ask upstream WHY the load failed, on the deterministic failure path only.
 *
 * Upstream logs the real reason and throws it away, which is the whole reason a user hitting this
 * has nothing actionable to go on. `api/load-budget` (unlike `api/download-budget`) DOES check the
 * error and throws it with `withErrorCode`, so re-attempting the load through that entry point
 * recovers the exact reason.
 *
 * Runs where a CALLER IS WAITING, never inside the promise `registerBudgetLoad` registers: every
 * `withApiLock` acquisition settles all registrations under ONE bound and fails closed on timeout,
 * so putting two network calls in there would extend the window in which unrelated sessions' lock
 * acquisitions throw, to build a message an abandoned load has no caller to read.
 */
/**
 * #404: the cached reason is re-derived every REDIAGNOSE_AFTER_USES failures.
 *
 * The cache exists because `diagnose()` runs INSIDE the process-global api mutex and makes two
 * bounded network calls, so re-running it per failed tool call stalls unrelated sessions. But an
 * entry was previously dropped only by a genuinely successful load or a process restart, so if a
 * budget's failure MODE changed with no success in between, the message reported the first reason
 * indefinitely.
 *
 * Bounding by USES rather than by wall-clock is deliberate: the cost this cache avoids is paid per
 * CALL, so capping in calls bounds staleness in the same unit, needs no clock, and is
 * deterministic under test. At 20, a persistent failure pays the diagnosis roughly 5 percent of
 * the time (the saving the cache exists for is kept) while no operator can see a stale reason for
 * more than 20 failed calls. The fail-closed DECISION is still never cached: every call
 * re-attempts the load and still fails.
 */
const REDIAGNOSE_AFTER_USES = 20;

const reasonCache = new Map<string, { reason: string; uses: number }>();

/** A load that genuinely succeeded clears any cached reason for that budget. */
function clearCachedReason(syncId: string): void {
  reasonCache.delete(syncId);
}

/** Test-only: the reason cache is module state, so a test suite must be able to reset it. */
export function _clearReasonCacheForTests(): void {
  reasonCache.clear();
}

async function diagnose(syncId: string): Promise<string | undefined> {
  // #409: what the cache held before a re-diagnosis, so a failed re-diagnosis can fall back to it
  // rather than reporting nothing.
  let staleReason: string | undefined;
  // #396 review: memoise the reason STRING, never the fail-closed decision. Without this, every
  // tool call while the condition persists pays two bounded network calls WHILE HOLDING the
  // process-global api mutex, so a single unloadable budget stalls unrelated sessions for up to
  // 2 x ACTUAL_OP_TIMEOUT_MS per call. The condition is deterministic, so the second diagnosis
  // would report what the first did. The ticket sanctions exactly this and nothing more: the
  // decision stays uncached, so the load is still re-attempted and still fails closed every time,
  // and a genuinely successful load clears the entry.
  // An empty string means "already diagnosed, and there was nothing safe to report". It must be
  // cached like any other outcome: review round 2 found that caching only the reportable outcomes
  // left the two most persistent failure classes re-diagnosing on every single call, which is
  // precisely the cost this memo exists to remove.
  const cached = reasonCache.get(syncId);
  if (cached !== undefined) {
    cached.uses += 1;
    if (cached.uses <= REDIAGNOSE_AFTER_USES) {
      log.debug('reusing the cached load-failure reason', { syncId, uses: cached.uses });
      return cached.reason || undefined;
    }
    // #404: the entry has served its budget of calls, so fall through to a fresh diagnosis and
    // pick up a failure mode that changed without an intervening success.
    //
    // #409: do NOT delete it here. Deleting first meant a re-diagnosis that then failed
    // transiently (a `getBudgets` blip) left the caller with "upstream discarded the reason"
    // despite a perfectly good cached one having existed a moment earlier, and the next call paid
    // two more bounded network calls inside the api mutex to rediscover it. The stale entry is
    // kept as a fallback and is only overwritten when a new answer is actually produced.
    staleReason = cached.reason;
    cached.uses = 0;
    log.debug('re-diagnosing the load failure after the cached reason served its budget', {
      syncId,
      afterUses: REDIAGNOSE_AFTER_USES,
    });
  }
  try {
    const budgets = (await withOpTimeout(
      () => (api as unknown as { getBudgets: () => Promise<unknown[]> }).getBudgets(),
      'diagnose getBudgets',
    )) as Array<{ id?: unknown; groupId?: unknown }>;

    // `api/get-budgets` does NO deduplication: it concatenates the local scan with
    // `get-remote-files`, so a budget synced both ways appears TWICE and only the LOCAL entry
    // carries `id`. Measured: [{"id":"_test-budget"},{"state":"remote"}] for one groupId.
    // Matching on groupId alone can select the remote twin and call loadBudget(undefined).
    const local = budgets.find((b) => b.groupId === syncId && typeof b.id === 'string');
    if (!local) {
      // Deliberately does NOT list what IS available: that would enumerate every budget on the
      // server to a caller the ACL scopes to one.
      reasonCache.set(syncId, { reason: NO_LOCAL_COPY, uses: 0 });
      return NO_LOCAL_COPY;
    }

    const localId = local.id as string;
    // Registered like any other load: it re-enters upstream's full `_loadBudget` against the
    // process-global singleton, so an abandoned diagnostic could otherwise land later and
    // re-point it outside the lock (the #390 leak with a new author).
    const p = (api as unknown as { loadBudget: (id: string) => Promise<void> }).loadBudget(localId);
    registerBudgetLoad(p);
    try {
      await withOpTimeout(() => p, 'diagnose loadBudget');
      // The diagnostic load SUCCEEDED, so the singleton now holds a budget nothing selected.
      // Record indeterminate: that forces a re-select on the next operation, which is the safe
      // direction #390 established. This line also satisfies block (4) of
      // budget_selection_precondition.test.js structurally rather than by exemption, and it must
      // stay in THIS brace-balanced block: the guard's window ends at the first `}` that takes
      // depth below zero, so a setter in a sibling `catch` or `finally` arm would be outside it.
      setLoadedBudgetSyncId(null);
      // #407 review (I3): DROP any cached reason here. #409 stopped deleting the entry before a
      // re-diagnosis, which is right for the failed-diagnosis path, but on THIS path the old
      // reason has just been proven wrong: the load worked. Leaving it cached with uses reset
      // meant the next 20 calls reported a permanent-sounding migration code for a condition the
      // diagnosis had just shown to be transient, which is exactly the reading the comment below
      // says to avoid.
      reasonCache.delete(syncId);
      // #396 review: the retry SUCCEEDED, so this was not a deterministic unloadable budget. Say
      // so rather than reporting "upstream discarded the reason", which reads as permanent. The
      // operation still fails (the record is indeterminate by design, which forces a re-select),
      // but the caller is told that retrying is the right move. Not cached: it is not a reason,
      // and the condition it describes is transient.
      return RETRY_SUCCEEDED;
    } catch (loadErr) {
      setLoadedBudgetSyncId(null);
      // Prefer the CODE. Upstream attaches it via `withErrorCode` precisely so callers need not
      // parse prose, and the prose is lossy: `getSyncError` collapses out-of-sync-migrations with
      // out-of-sync-data, and opening-budget with loading-budget, so message-only capture
      // distinguishes at most three of the five reasons.
      const code = codeOf(loadErr);
      log.warn('budget load diagnosis', { syncId, code: code ?? null, reason: messageOf(loadErr) });
      const reason = code && KNOWN_LOAD_REASONS.has(code) ? code : scrubReason(messageOf(loadErr));
      // Cache the outcome even when there is nothing reportable. A raw fs or sqlite failure has a
      // `.code` outside KNOWN_LOAD_REASONS and path-shaped prose that `scrubReason` drops, so it
      // yields `undefined`, and that is the ticket's own reproduced "db.sqlite is not a database"
      // case: the one most likely to persist. Storing '' records "diagnosed" without reporting.
      reasonCache.set(syncId, { reason: reason ?? '', uses: 0 });
      return reason;
    }
  } catch (diagErr) {
    // A failing diagnostic is LOGGED, never substituted for the post-condition error.
    log.warn('could not diagnose why the budget did not load', { syncId, error: messageOf(diagErr) });
    // #409: fall back to the previous answer rather than reporting nothing. It described this same
    // budget's failure moments ago and is far more useful than silence; the use counter was reset,
    // so the next call re-attempts the diagnosis anyway.
    if (staleReason !== undefined) {
      reasonCache.set(syncId, { reason: staleReason, uses: 0 });
      return staleReason || undefined;
    }
    return undefined;
  }
}

function postConditionError(syncId: string, reason: string | undefined): Error {
  return new Error(
    `The budget "${syncId}" reported a successful download but no budget file is open, ` +
      `so every subsequent operation would fail. ` +
      (reason ? `Upstream reason: [${reason}]. ` : 'Upstream discarded the reason. ') +
      `Two causes account for almost all of these: a version mismatch between @actual-app/api and ` +
      `the Actual server or budget file (the server version guard logs a warning when it can detect ` +
      `this), and a local budget copy that cannot be opened (check the directory configured by ` +
      `MCP_BRIDGE_DATA_DIR, and note that two server processes sharing one data dir will do this).`,
  );
}

/**
 * The tracking discipline EVERY singleton-mutating load must follow (#390, #393, #394).
 *
 * Extracted so the two callers cannot drift. `downloadBudget` and `importBudget` are different
 * upstream calls with different failure shapes, but the discipline is identical and getting it
 * subtly different at one site is exactly how #390 stayed reachable for three rounds:
 *
 *   1. Clear the record BEFORE starting, so an abandonment can only leave it INDETERMINATE.
 *      That is the safe direction: it forces a re-select. Recording only on success leaves the
 *      record naming the PREVIOUS budget while the singleton moves to a new one, which is the one
 *      direction that makes the #390 precondition silently pass.
 *   2. Register the promise, so a late landing is WAITED FOR by the next lock acquisition rather
 *      than discovered mid-operation. `withOpTimeout` races; it does not cancel.
 *   3. Record the true outcome when it settles, whether or not anyone is still listening, and
 *      poison the singleton on failure, because upstream closes the current budget before opening
 *      the new one, so "failed" does not mean "unchanged".
 *
 * `verify` is #396's post-condition, and it runs BEFORE the record is written, so the record can
 * only ever describe a mutation that actually took effect.
 */
async function trackBudgetMutation<T>(
  start: () => Promise<T>,
  describeLoaded: (result: T) => string,
  label: string,
  verify?: () => Promise<void>,
  onRecorded?: () => void,
  timeoutMs?: number,
): Promise<T> {
  // Indeterminate from here until it settles. Cleared BEFORE the load is even started, so the
  // record can never name the outgoing budget while the singleton is moving away from it: that is
  // the one direction that makes #390's precondition silently pass. It used to be cleared on the
  // statement AFTER `start()`, which was safe in practice (both run in one synchronous turn, so
  // nothing could observe the gap) but made the invariant untestable and the comment's own word
  // "first" untrue.
  setLoadedBudgetSyncId(null);

  const raw = start();

  // #403: was this load ABANDONED by the caller's bound?
  //
  // The post-condition probe lives inside this chain so an abandoned load is verified when it
  // lands rather than recording a success nobody checked (#396). The cost, raised in review, is
  // that a LATE landing runs that probe with no lock held, against the single SQLite connection,
  // while another session may be mid-operation inside the lock.
  //
  // The resolution is not to probe on that path at all. A landing whose caller has already given
  // up leaves the record INDETERMINATE, which forces the next operation to re-select. That is the
  // safe direction #390 established, it costs one extra re-selection after an event that is rare
  // by construction (a load that outran its bound), and it removes the unsynchronised read
  // entirely rather than arguing about whether it is observable.
  let abandoned = false;
  const tracked = raw
    .then(async (result) => {
      if (abandoned) {
        log.warn('an abandoned budget load landed after its caller gave up; leaving the record indeterminate', {
          label,
        });
        // The load itself SUCCEEDED upstream, so any cached failure reason for this budget is
        // stale even though we are not recording the syncId. Clearing here keeps the hook's stated
        // contract true on the abandoned path as well (see the note on `onRecorded` below).
        try { onRecorded?.(); } catch { /* a hook cannot change the outcome */ }
        return result;
      }
      if (verify) await verify();
      // #403 review: re-check. `abandoned` can flip DURING `verify()`, when the load resolves just
      // before its bound expires. Without this the probe runs and the record is written on a load
      // whose caller has gone, which contradicts the contract stated above. The value written
      // would be true rather than false, so this is about honesty of the invariant rather than
      // safety, but a contract the code only honours on the common path is not a contract.
      if (abandoned) {
        log.warn('a budget load was abandoned while its post-condition ran; leaving the record indeterminate', { label });
        try { onRecorded?.(); } catch { /* a hook cannot change the outcome */ }
        return result;
      }
      setLoadedBudgetSyncId(describeLoaded(result));
      // #392 review (finding 5): this runs INSIDE the chain, not after the awaited call. On the
      // abandoned-then-eventually-successful path the caller has already thrown, so a hook placed
      // after the await would never run and the cached failure reason would outlive the load that
      // actually succeeded.
      // Wrapped: a hook cannot be allowed to change the recorded outcome. Unwrapped, a throwing
      // hook would be caught by the trailing .catch, reported as a load failure, and would leave
      // the record written while setApiInitialized(false) says the singleton is dead: an
      // incoherent pair rather than a fail-safe one.
      try { onRecorded?.(); } catch (hookErr) {
        log.warn('post-record hook threw; the recorded outcome stands', { error: String(hookErr) });
      }
      return result;
    })
    .catch((err) => {
      // A failed load leaves the singleton in a state nobody can describe: upstream's
      // download and import handlers both close the current budget before opening the new one,
      // so "failed" does not mean "unchanged". Poison it so the next operation re-inits.
      setApiInitialized(false);
      throw err;
    });
  registerBudgetLoad(tracked);
  try {
    // On timeout the tracked promise is still running. Leave it REGISTERED: the next operation
    // waits for it inside the lock rather than racing it.
    return await withOpTimeout(() => tracked, label, timeoutMs);
  } catch (err) {
    // #403: from here the caller has given up, so anything still in flight must not touch the api
    // with no lock held. The chain checks this before probing. Set on ANY rejection, which is
    // harmless when the chain itself already failed: it has settled, so nothing reads the flag.
    abandoned = true;
    throw err;
  }
}

/**
 * #394: the same discipline for an IMPORT.
 *
 * Upstream's `importBudget` LOADS the imported budget, so it re-points the process-global
 * singleton exactly as a download does, and a large YNAB or zip import exceeding
 * ACTUAL_OP_TIMEOUT_MS is the expected case rather than a rare one. Before this, nothing cleared
 * the record before it started, nothing registered the promise, and the sentinel was written
 * AFTER the await, so a timeout skipped it entirely and the record went on naming the PRE-IMPORT
 * budget while the singleton moved to an out-of-registry, un-ACL'd file. A victim session then
 * passed the #390 precondition legitimately and had its reads served from the importer's file.
 *
 * ACCEPTED COST, recorded because nothing else states it. Registering the import means every
 * subsequent `withApiLock` acquisition waits for it, bounded, and throws on timeout. An import is
 * not "stuck", it is legitimately long: a large YNAB or zip import can run for minutes. So while
 * one runs past ACTUAL_OP_TIMEOUT_MS, other sessions stall for that bound and then fail with
 * "abandoned budget load timed out", and write drains reject their batch. That is a strictly
 * better failure than the silent cross-tenant read it replaces (a victim reading the importer's
 * un-ACL'd file), and it is the same trade #393 accepted for downloads. It is NOT free, and the
 * operator-facing consequence is a process-wide stall for the duration of one tenant's import.
 * Giving imports their own larger bound is tracked separately rather than bolted on here.
 *
 * No `verify` here, deliberately: unlike `download-budget`, upstream's `importBudget` already
 * asserts its own post-condition. It checks `result.error` and then `!result.id`, throwing
 * "no budget was loaded", so it cannot resolve without having loaded something. Verified in the
 * shipped upstream source. Adding a probe would be duplicate work on the write path.
 */
export async function importBudgetTracked<T extends { id: string }>(
  start: () => Promise<T>,
  label = 'importBudget',
): Promise<T> {
  // A sentinel rather than a real syncId: an imported file is outside the budget registry and
  // outside the ACL, so no session can ever legitimately match it and every session's next
  // operation re-selects its own budget. Configured sync ids are UUIDs, so an `imported:` prefix
  // can never compare equal to one.
  // #407: the import's OWN bound. See ACTUAL_IMPORT_TIMEOUT_MS in config.ts for why a long
  // import must not be abandoned at the ordinary operation timeout: it is tracked, so every other
  // session waits on it, and abandoning it early turns one tenant's import into a process-wide
  // stall without making the import itself any faster.
  return trackBudgetMutation(
    start,
    (result) => `imported:${result.id}`,
    label,
    undefined,
    undefined,
    config.ACTUAL_IMPORT_TIMEOUT_MS,
  );
}

export async function loadBudgetTracked(syncId: string, encryptionPassword?: string, label = 'downloadBudget'): Promise<void> {
  try {
    await trackBudgetMutation(
      // #410: no redundant clear here any more. `trackBudgetMutation` owns the clear-before, and
      // the guard in tests/unit/budget_selection_precondition.test.js now asserts the invariant
      // that actually holds (a raw load must be inside the tracked helper) rather than looking for
      // a setter in the same block, which had stopped discriminating.
      () =>
        encryptionPassword
          ? (api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> })
              .downloadBudget(syncId, { password: encryptionPassword })
          : api.downloadBudget(syncId),
      () => syncId,
      label,
      // #396: the post-condition runs INSIDE the tracked chain, before the record is written, so
      // an ABANDONED load is verified when it lands rather than recording a success nobody
      // checked. The network enrichment below deliberately does NOT run there.
      assertBudgetOpen,
      () => clearCachedReason(syncId),
    );
  } catch (err) {
    // Enrich HERE, where a caller is actually waiting. Every `withApiLock` acquisition settles
    // all registrations under ONE bound and fails closed on timeout, so two network calls inside
    // the tracked chain would extend the window in which unrelated sessions' lock acquisitions
    // throw, to build a message an abandoned load has no caller to read.
    if (isBudgetNotOpen(err)) {
      log.error('download resolved but no budget is open', undefined, { syncId });
      throw postConditionError(syncId, await diagnose(syncId));
    }
    throw err;
  }
}
