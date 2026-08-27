/**
 * The process-global @actual-app/api session mutex.
 *
 * WHY IT LIVES HERE rather than in actual-adapter.ts, which is where it was written and where
 * every existing caller still reaches it from (the adapter re-exports it, so importers are
 * unchanged). #390 needed `ActualConnectionPool` to hold this lock around its own
 * init + downloadBudget, and the pool cannot import from the adapter: the adapter imports the
 * pool singleton, so that edge is circular. This is the same reason `apiState.ts` and
 * `opTimeout.ts` were split out before it, and the comments there say so.
 *
 * WHAT IT GUARANTEES. `@actual-app/api` is a singleton over one SQLite connection, and
 * concurrent init/shutdown pairs corrupt the session. Every path that touches the api takes
 * this first: reads via `withActualApi`, writes via `processWriteQueue`, and since #390 the
 * pool's session-open init and budget download.
 *
 * IT IS NOT REENTRANT, and that is load bearing. It is a strict FIFO chained-promise mutex, so
 * an inner acquisition waits on the outer call's own release promise, which cannot fire until
 * the outer callback resolves. The observable symptom is a stall ended by #270's operation
 * timeout, NOT a hang, and it should be read as a probable nesting bug rather than a slow
 * upstream. Before adding an acquisition, check that no caller above you already holds it.
 */
let _apiSessionLock: Promise<void> = Promise.resolve();

export function withApiLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prevLock = _apiSessionLock;
  _apiSessionLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prevLock.then(() => fn()).finally(() => release());
}
