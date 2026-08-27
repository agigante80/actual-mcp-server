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
