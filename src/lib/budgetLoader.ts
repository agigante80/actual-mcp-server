import api from '@actual-app/api';
import { withOpTimeout } from './opTimeout.js';
import { setApiInitialized, setLoadedBudgetSyncId, registerBudgetLoad } from './apiState.js';

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
    // #393 review (P3-4): NOT clearBudgetLoad(tracked). `registerBudgetLoad` registers a
    // derived promise, not this handle, so that delete could never match and read as a working
    // belt-and-braces path a later change might lean on. Self-removal on settle is what
    // actually deregisters a completed load, and it has already happened by the time the
    // awaited promise resolves here.
  } catch (err) {
    // On timeout the tracked promise is still running. Leave it REGISTERED: the next operation
    // waits for it inside the lock rather than racing it.
    throw err;
  }
}
