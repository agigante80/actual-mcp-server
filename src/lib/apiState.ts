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
}
