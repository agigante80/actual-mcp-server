/**
 * Shared module-level state for the @actual-app/api singleton's "live" flag.
 *
 * @actual-app/api is a process-wide singleton that gets `init()`d and
 * `shutdown()`d by multiple paths in this codebase: the connection pool's
 * per-session init (`ActualConnectionPool.getConnection`), the adapter's
 * legacy per-op cycle (`initActualApiForOperation` / `shutdownActualApi`),
 * and the write queue (`processWriteQueue`).
 *
 * The adapter's pool-cooperation logic (`withActualApi` in actual-adapter.ts)
 * needs to know whether the singleton is currently live so it can safely
 * skip the per-op init when the pool already has a connection. This module
 * exposes a tiny shared flag that all init/shutdown paths update, so any
 * caller can probe the truth without having to know about every path.
 *
 * Lives in src/lib/ rather than inside actual-adapter.ts so the connection
 * pool can update it without creating a circular import (the pool is itself
 * imported by the adapter).
 */
let _apiInitialized = false;

export function isApiInitialized(): boolean {
  return _apiInitialized;
}

export function setApiInitialized(value: boolean): void {
  _apiInitialized = value;
  // A singleton that is not live holds no budget. Clearing here means a shutdown can never
  // leave a stale claim behind for the next caller to trust.
  if (!value) _loadedBudgetSyncId = null;
}

/**
 * #390: the syncId of the budget the SINGLETON currently holds, as distinct from the budget
 * any given session believes it is on.
 *
 * WHY THIS HAS TO EXIST. `@actual-app/api` is process-global with ONE loaded budget, while the
 * pool tracks up to MAX_CONCURRENT_SESSIONS entries that each carry their own syncId. Before
 * this, nothing recorded which budget was actually loaded, so no code could tell that a
 * session was about to operate on someone else's. Both re-entry paths skip the download for
 * good reasons of their own: `getConnection` returns early for an initialised entry, and
 * `initActualApiForOperation` returns early when the singleton is live (which is #134's fix
 * for the #127 auth burst). Neither is wrong; together they meant the loaded budget was
 * whatever the last session to open had asked for.
 *
 * Reproduced before the fix: session A opened on budget A and wrote to it, session B opened
 * and switched to budget B, and session A's NEXT write landed in budget B. The budget ACL
 * could not see it, because `_enforceBudgetAcl` validates the budget the session believes it
 * is on while the operation executes against whatever is loaded.
 *
 * Written by every path that downloads a budget; read inside the api lock by the adapter's
 * precondition check. Lives here for the same reason the live flag does: the pool must update
 * it without importing the adapter.
 */
let _loadedBudgetSyncId: string | null = null;

export function getLoadedBudgetSyncId(): string | null {
  return _loadedBudgetSyncId;
}

export function setLoadedBudgetSyncId(syncId: string | null): void {
  _loadedBudgetSyncId = syncId;
}

/**
 * #390 round 3: an ABANDONED budget load.
 *
 * `withOpTimeout` races; it does not cancel. When a `downloadBudget` exceeds
 * ACTUAL_OP_TIMEOUT_MS the underlying call KEEPS RUNNING and eventually re-points the
 * singleton, outside the mutex, at a moment nobody is waiting for. Upstream makes this worse
 * than a failed no-op: `handlers['api/download-budget']` begins with `close-budget`, then
 * `load-budget` and `sync-budget`, so an abandoned download CLOSES whatever budget is loaded
 * and opens a different one mid-flight, underneath another session's lock.
 *
 * Two leaks were reproduced against the previous fix. The record stayed on the old budget
 * (only set on success), so the next matching session passed the check and read someone else's
 * data; and even after recording the true outcome, the re-point landed BETWEEN a session's
 * check and its raw call, so the write still went to the wrong budget. A mutex cannot serialise
 * a promise its holder has abandoned.
 *
 * So the load is tracked rather than merely bounded. The record is cleared BEFORE a download
 * starts, so an abandonment can only leave it indeterminate (the safe direction, which forces a
 * re-select), and the abandoned promise stays registered here until it settles. No operation
 * may proceed past a pending abandoned load: `awaitAbandonedBudgetLoad` is awaited inside the
 * api lock, so a late landing happens BEFORE the next check rather than between a check and its
 * use.
 */
let _pendingBudgetLoad: Promise<unknown> | null = null;

export function registerBudgetLoad(p: Promise<unknown>): void {
  // Never let the registration itself raise an unhandled rejection: the caller races this
  // promise and handles (or abandons) the failure on its own path.
  _pendingBudgetLoad = p.catch(() => undefined);
}

export function clearBudgetLoad(): void {
  _pendingBudgetLoad = null;
}

/**
 * Settle any abandoned load. MUST be called inside the api lock, before deciding whether the
 * loaded budget matches: that ordering is the whole point.
 *
 * Returns true when it actually waited, so callers can log it and tests can assert it.
 */
export async function awaitAbandonedBudgetLoad(): Promise<boolean> {
  if (!_pendingBudgetLoad) return false;
  const pending = _pendingBudgetLoad;
  await pending;
  // Only clear if nothing newer replaced it while we waited.
  if (_pendingBudgetLoad === pending) _pendingBudgetLoad = null;
  return true;
}

/** Test hook: is a load currently outstanding? */
export function _hasPendingBudgetLoadForTests(): boolean {
  return _pendingBudgetLoad !== null;
}
