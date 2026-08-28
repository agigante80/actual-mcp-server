import api from '@actual-app/api';
import { withOpTimeout } from './opTimeout.js';
import { setApiInitialized, setLoadedBudgetSyncId, registerBudgetLoad, clearBudgetLoad } from './apiState.js';

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
 */
export async function loadBudgetTracked(syncId: string, encryptionPassword?: string, label = 'downloadBudget'): Promise<void> {
  const raw = encryptionPassword
    ? (api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> })
        .downloadBudget(syncId, { password: encryptionPassword })
    : api.downloadBudget(syncId);

  // Indeterminate from here until it settles. Cleared first, deliberately.
  setLoadedBudgetSyncId(null);

  const tracked = raw.then(
    () => {
      setLoadedBudgetSyncId(syncId);
    },
    (err) => {
      // A failed load leaves the singleton in a state nobody can describe: upstream's
      // download handler closes the current budget before opening the new one, so "failed"
      // does not mean "unchanged". Poison it so the next operation re-inits from scratch.
      setApiInitialized(false);
      throw err;
    },
  );
  registerBudgetLoad(tracked);
  try {
    await withOpTimeout(() => tracked, label);
    // Pass the handle: with chaining, this is usually no longer the registered value, so it
    // correctly no-ops and leaves the chain for the next lock acquisition to settle. Clearing
    // unconditionally here is how an abandoned sibling load got forgotten (#393).
    clearBudgetLoad(tracked);
  } catch (err) {
    // On timeout the tracked promise is still running. Leave it REGISTERED: the next operation
    // waits for it inside the lock rather than racing it.
    throw err;
  }
}
