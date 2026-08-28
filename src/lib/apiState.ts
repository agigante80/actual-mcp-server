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
const _pendingBudgetLoads = new Set<Promise<unknown>>();

/**
 * Register an in-flight budget load.
 *
 * A SET, and each entry removes itself once it settles. Two earlier shapes were wrong:
 * assigning to a single slot let a session opening during the window overwrite an outstanding
 * abandoned load, whose success then cleared it, so the abandoned promise became untracked and
 * landed later (that was #393's second P0). Chaining fixed the overwrite but left a completed
 * load registered forever, because a chained promise is no longer the handle its creator holds,
 * so nothing could clear it and "is a load outstanding" stopped meaning anything.
 *
 * With a set, concurrent loads all stay tracked and a finished one drops out on its own, so
 * what remains is exactly the loads that are still in flight.
 */
export function registerBudgetLoad(p: Promise<unknown>): void {
  // Never let the registration raise an unhandled rejection: the caller races this promise and
  // handles (or abandons) the failure on its own path.
  const safe: Promise<unknown> = p.then(
    () => undefined,
    () => undefined,
  );
  _pendingBudgetLoads.add(safe);
  void safe.then(() => {
    _pendingBudgetLoads.delete(safe);
  });
}

/** Drop a specific registration early. Settling removes it anyway; this is belt and braces. */
export function clearBudgetLoad(handle?: Promise<unknown>): void {
  if (handle) _pendingBudgetLoads.delete(handle);
  else _pendingBudgetLoads.clear();
}

/**
 * Settle every outstanding load, BOUNDED, and FAIL CLOSED on timeout.
 *
 * #393: the unbounded version was a P0 worse than the leak it closed. Both call sites were
 * inside the api mutex and outside any timeout, so ONE never-settling download blocked every
 * session forever, with no error after the first line and no recovery short of a process
 * restart. That is exactly the mode opTimeout.ts exists to remove and that #270 removed, so
 * reintroducing it was a regression against a fixed bug.
 *
 * On timeout this THROWS and leaves the registrations in place. Both alternatives are worse:
 * proceeding runs the operation against a singleton a landing download may re-point underneath
 * it (the original leak), and clearing forgets the landing entirely. A persistent, legible
 * per-request error with the mutex released each time is the honest failure for "an upstream
 * load is stuck and we cannot cancel it".
 *
 * Returns true when it actually waited, so callers can log it and tests can assert it.
 */
export async function awaitAbandonedBudgetLoad(
  bound: <T>(fn: () => Promise<T>, label?: string) => Promise<T>,
): Promise<boolean> {
  if (_pendingBudgetLoads.size === 0) return false;
  const outstanding = Promise.all([..._pendingBudgetLoads]);
  await bound(() => outstanding, 'abandoned budget load');
  return true;
}

/** Test hook: is a load currently outstanding? */
export function _hasPendingBudgetLoadForTests(): boolean {
  return _pendingBudgetLoads.size > 0;
}
