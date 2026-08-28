import { awaitAbandonedBudgetLoad } from './apiState.js';
import { withOpTimeout } from './opTimeout.js';
import { createModuleLogger } from './loggerFactory.js';

const logger = createModuleLogger('API LOCK');

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

/**
 * #393: settling an abandoned budget load is part of ACQUIRING the lock, not something call
 * sites remember to do.
 *
 * Every previous round of #390 guarded per call site and every round missed one. Round 1 missed
 * the legacy path (a silent cross-tenant read). Round 2 put the wait in the two adapter entry
 * points and missed the three `loadBudgetTracked` sites that reach the api without passing
 * through them, so a session opening during the window untracked the abandoned load and the
 * leak stayed reachable. CLAUDE.md already names this hazard class for `withOpTimeout`: the
 * protection is per-call-site rather than structural, so a new acquisition site added without
 * it fails silently.
 *
 * Putting it here makes the set of call sites stop mattering. Nothing reaches
 * `@actual-app/api` without this lock, so nothing reaches it without the wait.
 *
 * It is bounded and fails closed (see `awaitAbandonedBudgetLoad`): an unbounded wait here would
 * wedge every session on one stuck download, which is what made the round-2 version worse than
 * the bug it fixed.
 */
export function withApiLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prevLock = _apiSessionLock;
  _apiSessionLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prevLock
    .then(async () => {
      if (await awaitAbandonedBudgetLoad(withOpTimeout)) {
        logger.warn('[API LOCK] waited for an abandoned budget load before running this operation');
      }
      return await fn();
    })
    .finally(() => release());
}
