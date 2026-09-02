import api from '@actual-app/api';
import { withOpTimeout } from './opTimeout.js';
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
const reasonCache = new Map<string, string>();

/** A load that genuinely succeeded clears any cached reason for that budget. */
function clearCachedReason(syncId: string): void {
  reasonCache.delete(syncId);
}

/** Test-only: the reason cache is module state, so a test suite must be able to reset it. */
export function _clearReasonCacheForTests(): void {
  reasonCache.clear();
}

async function diagnose(syncId: string): Promise<string | undefined> {
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
    log.debug('reusing the cached load-failure reason', { syncId });
    return cached || undefined;
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
      reasonCache.set(syncId, NO_LOCAL_COPY);
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
      reasonCache.set(syncId, reason ?? '');
      return reason;
    }
  } catch (diagErr) {
    // A failing diagnostic is LOGGED, never substituted for the post-condition error.
    log.warn('could not diagnose why the budget did not load', { syncId, error: messageOf(diagErr) });
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

export async function loadBudgetTracked(syncId: string, encryptionPassword?: string, label = 'downloadBudget'): Promise<void> {
  const raw = encryptionPassword
    ? (api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> })
        .downloadBudget(syncId, { password: encryptionPassword })
    : api.downloadBudget(syncId);

  // Indeterminate from here until it settles. Cleared first, deliberately.
  setLoadedBudgetSyncId(null);

  // #396: `.then(onFulfilled).catch(onRejected)`, NOT the two-argument `.then`. A throw from the
  // `onFulfilled` argument of `.then(onFulfilled, onRejected)` is NOT caught by that same
  // `onRejected`, so with the old shape a probe failure would skip the fail-closed
  // `setApiInitialized(false)` below: exactly the new failure path this adds.
  //
  // The probe lives INSIDE this chain so an ABANDONED load is verified when it lands, rather than
  // recording a false success nobody checked. The network enrichment deliberately does not.
  const tracked = raw
    .then(async () => {
      await assertBudgetOpen();
      setLoadedBudgetSyncId(syncId);
      clearCachedReason(syncId);
    })
    .catch((err) => {
      // A failed load leaves the singleton in a state nobody can describe: upstream's
      // download handler closes the current budget before opening the new one, so "failed"
      // does not mean "unchanged". Poison it so the next operation re-inits from scratch.
      setApiInitialized(false);
      throw err;
    });
  registerBudgetLoad(tracked);
  try {
    await withOpTimeout(() => tracked, label);
    // #393 review (P3-4): NOT clearBudgetLoad(tracked). `registerBudgetLoad` registers a
    // derived promise, not this handle, so that delete could never match and read as a working
    // belt-and-braces path a later change might lean on. Self-removal on settle is what
    // actually deregisters a completed load, and it has already happened by the time the
    // awaited promise resolves here.
  } catch (err) {
    // On timeout the tracked promise is still running. Leave it REGISTERED: the next operation
    // waits for it inside the lock rather than racing it.
    if (isBudgetNotOpen(err)) {
      log.error('download resolved but no budget is open', undefined, { syncId });
      throw postConditionError(syncId, await diagnose(syncId));
    }
    throw err;
  }
}
