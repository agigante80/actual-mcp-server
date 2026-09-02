import { awaitAbandonedBudgetLoad, getLoadedBudgetSyncId } from './apiState.js';
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
 * IT IS NOT REENTRANT, and that is load bearing. An inner acquisition queues behind the outer
 * call's own release, which cannot happen until the outer callback resolves. The observable
 * symptom is a stall ended by #270's operation timeout, NOT a hang, and it should be read as a
 * probable nesting bug rather than a slow upstream. Before adding an acquisition, check that no
 * caller above you already holds it.
 */

/**
 * #391: BUDGET AFFINITY, replacing strict FIFO.
 *
 * The problem this solves, measured rather than asserted: with two sessions on different
 * budgets, 20 alternating tool calls produced 19 full budget downloads, 19 syncs of the outgoing
 * budget and 19 post-condition probes, all serialised through this mutex. That is #390's
 * isolation working correctly and costing a re-selection per operation. On a large budget the
 * download can exceed ACTUAL_OP_TIMEOUT_MS, at which point neither user completes anything while
 * the other is active, and any two authenticated accounts on different budgets can hold the
 * process there deliberately.
 *
 * The fix is to serialise by BUDGET rather than by operation: when the lock is released, prefer a
 * waiter whose budget is already loaded. A run of same-budget operations then pays ONE
 * re-selection instead of one each, so the cost tracks ALTERNATIONS rather than call count.
 *
 * THE MUTEX SHAPE CHANGED to make this possible. It was a chained-promise FIFO, which has no
 * waiter list to reorder. It is now an explicit queue with a held flag. Three properties are
 * load bearing, and each has a mutation-proven test in tests/unit/api_lock_affinity.test.js:
 *
 *   1. BOUNDED STARVATION. Preferring the loaded budget indefinitely starves the other one, which
 *      is a failure mode strict FIFO did not have. At most MAX_AFFINITY_SKIPS consecutive grants
 *      may skip the head of the queue; the next grant then goes to the head regardless of budget.
 *   2. FIFO WITHIN A BUDGET. Among waiters on the same budget the oldest is always chosen.
 *      Several correctness arguments elsewhere rest on same-session ordering.
 *   3. THE ABANDONED-LOAD WAIT STILL HAPPENS on every acquisition (#393), and per operation inside
 *      a drain (#406). Reordering acquisitions must not let one skip it.
 */

/**
 * How many consecutive grants may skip the head of the queue.
 *
 * The trade is thrash against latency, and neither end is free. Zero is strict FIFO, which is
 * what #391 exists to stop. Unbounded starves the other budget entirely.
 *
 * Eight, because a switch costs three upstream operations (sync the outgoing budget, download the
 * incoming one, probe it), so amortising one switch over eight operations puts the per-operation
 * cost well below the un-batched case, while the waiter at the head of the queue can be delayed by
 * at most eight operations rather than indefinitely. It is deliberately a small number: the goal
 * is to remove the per-CALL switch, not to let one tenant monopolise the process.
 *
 * The bound is in OPERATIONS, not wall clock, and the difference matters in the scenario this
 * ticket cites. Eight operations that each run to ACTUAL_OP_TIMEOUT_MS is 240 seconds at the
 * default, which is past most clients' own request timeouts. That is the accepted trade: bounding
 * by time instead would need the lock to know how long an operation has left, which it cannot.
 */
const MAX_AFFINITY_SKIPS = 8;

interface Waiter {
  /** The budget this acquisition wants loaded, when the caller can name one unambiguously. */
  budget?: string;
  grant: () => void;
  /** Settle without running the body. Test-reset only; production never aborts a waiter. */
  abort: (err: Error) => void;
}

let held = false;
const waiters: Waiter[] = [];
let consecutiveSkips = 0;

/**
 * The release path's diagnostic, behind a seam.
 *
 * Not indirection for its own sake: this exists so a test can install a THROWING hook and prove
 * the lock is still released. Round 2 caught the previous test asserting source-text ordering
 * instead, which stayed green when the exact regression was reintroduced a few lines away.
 */
let onSkipGrant: (info: { skipped: number; consecutiveSkips: number; waiting: number }) => void = (info) => {
  logger.debug('granting out of order to keep the loaded budget', info);
};

export function _setApiLockLogHookForTests(
  hook: ((info: { skipped: number; consecutiveSkips: number; waiting: number }) => void) | null,
): void {
  onSkipGrant = hook ?? ((info) => {
    logger.debug('granting out of order to keep the loaded budget', info);
  });
}

/** Test hook: the queue is module state, so a suite must be able to observe and reset it. */
export function _getApiLockStateForTests(): { held: boolean; waiting: number; consecutiveSkips: number } {
  return { held, waiting: waiters.length, consecutiveSkips };
}

/**
 * #411: is the api mutex currently held?
 *
 * Exists so the `...Locked` variants can ASSERT their precondition instead of documenting it. The
 * audit of which callers hold the lock lives in a doc comment today, and this repo has paid four
 * times (#371, #376, #390, #393) for the difference between a convention and a check.
 *
 * Deliberately coarse: it reports that SOMEONE holds the lock, not that YOU do, because a
 * chained-promise mutex has no owner identity. That is still enough to catch the mistake that
 * matters, which is calling a Locked variant from a path that holds nothing at all.
 */
export function isApiLockHeld(): boolean {
  return held;
}

export function _resetApiLockForTests(): void {
  // REJECT queued waiters rather than granting or dropping them.
  //
  // Dropping leaves promises that never settle (the hazard `_clearPendingBudgetLoadsForTests`
  // documents in apiState.ts). Granting is worse and was the first attempt: a granted waiter RUNS
  // ITS BODY and then calls grantNext(), releasing a lock it was never exclusively handed. Probed
  // at four concurrent holders. Rejecting settles the promise without running anything and without
  // a spurious release, which is what "reset" should mean.
  const pending = waiters.splice(0, waiters.length);
  held = false;
  consecutiveSkips = 0;
  for (const w of pending) w.abort(new Error('api lock reset by a test hook'));
}

function acquire(budget?: string): Promise<void> {
  if (!held) {
    held = true;
    return Promise.resolve();
  }
  return new Promise<void>((grant, abort) => {
    waiters.push({ budget, grant, abort });
  });
}

/**
 * Hand the lock to exactly one waiter, or release it if none are queued.
 *
 * Ownership TRANSFERS: `held` stays true when a waiter is granted, so no third party can slip in
 * between the release and the grant. That is what makes this a mutex rather than a suggestion.
 */
function grantNext(): void {
  if (waiters.length === 0) {
    held = false;
    consecutiveSkips = 0;
    return;
  }

  let index = 0; // strict FIFO by default, which is also the anti-starvation fallback
  if (consecutiveSkips < MAX_AFFINITY_SKIPS) {
    const loaded = getLoadedBudgetSyncId();
    if (loaded !== null) {
      // The OLDEST waiter on the loaded budget, so ordering within a budget is preserved.
      const match = waiters.findIndex((w) => w.budget === loaded);

      // An UNHINTED waiter is a BARRIER that affinity may not cross.
      //
      // Review caught this, and it was the worst thing in the change. An unhinted waiter can never
      // equal `loaded`, so without this it was freely skipped, and the three unhinted acquisitions
      // are the ones least able to afford it: the pool's session open, `shutdownAll`, and a write
      // drain whose batch spans budgets. (#417 later let a UNANIMOUS drain hint its own budget, so
      // that case is no longer a barrier. A mixed batch still is, and must stay so: one entry's
      // budget says nothing about the rest.) Reproduced on a SINGLE-budget setup, where affinity can never save a
      // re-selection because only one budget is ever loaded: a drain enqueued first ran ninth,
      // behind eight reads. So the majority deployment got the reordering with none of the benefit,
      // a write could be overtaken by reads issued after it (impossible under the old FIFO, and
      // visible to a client issuing parallel tool calls), and #412's teardown could be delayed by
      // eight operations at exactly the moment it is racing SIGTERM.
      //
      // Skipping a same-budget waiter that is merely LATER in the queue is safe; skipping one that
      // cannot express a preference is not, because "no hint" does not mean "no ordering
      // requirement".
      const barrier = waiters.findIndex((w) => w.budget === undefined);
      if (match > 0 && (barrier === -1 || match < barrier)) index = match;
    }
  }

  if (index > 0) {
    consecutiveSkips++;
  } else {
    // The head ran, so nobody is being starved right now.
    consecutiveSkips = 0;
  }

  // GRANT FIRST, log after, and never let the log break the release.
  //
  // This runs in a `finally`, so anything that throws here leaves `held` true with a queue nobody
  // will ever be handed. No timeout can rescue that: the waiters never enter the lock body, so
  // `withOpTimeout` never applies to them. It is #278's signature, and CLAUDE.md's own line is
  // that a hang has no timeout large enough. The previous chained-promise mutex released with a
  // bare `resolve()`, which could not throw; this queue can, so the ordering is deliberate.
  const skipped = index;
  const [chosen] = waiters.splice(index, 1);
  chosen.grant();
  if (skipped > 0) {
    try {
      onSkipGrant({ skipped, consecutiveSkips, waiting: waiters.length });
    } catch { /* the release path must never throw */ }
  }
}

/**
 * Run `fn` holding the api mutex.
 *
 * `budget` is an optional AFFINITY HINT, not an assertion: pass the syncId this acquisition will
 * operate on when the caller can name one unambiguously. Callers that cannot (a write drain whose
 * batch spans budgets) pass nothing and are treated as ordinary FIFO waiters, which is always
 * correct and merely forgoes the optimisation.
 */
export function withApiLock<T>(fn: () => Promise<T>, opts?: { budget?: string }): Promise<T> {
  return acquire(opts?.budget).then(async () => {
    try {
      // #393: settling an abandoned budget load is part of ACQUIRING the lock, not something call
      // sites remember to do. Every previous round of #390 guarded per call site and every round
      // missed one. Putting it here makes the set of call sites stop mattering: nothing reaches
      // @actual-app/api without this lock, so nothing reaches it without the wait.
      //
      // It is bounded and fails closed (see `awaitAbandonedBudgetLoad`): an unbounded wait here
      // would wedge every session on one stuck download, which is what made #390's round-2
      // version worse than the bug it fixed.
      if (await awaitAbandonedBudgetLoad(withOpTimeout)) {
        logger.warn('waited for an abandoned budget load before running this operation');
      }
      return await fn();
    } finally {
      grantNext();
    }
  });
}
