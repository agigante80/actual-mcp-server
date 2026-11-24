import { AsyncLocalStorage } from 'node:async_hooks';
import config from '../config.js';
import { createModuleLogger } from './loggerFactory.js';

/**
 * Bound a single upstream Actual API call so a stall cannot hold the process-global
 * API mutex (or a session-open path) forever (#270). `@actual-app/api` is a
 * single-connection singleton: every op is serialised through `withApiLock`, and
 * session open runs `api.init()` + `downloadBudget()` in `ActualConnectionPool`.
 * The mutex releases in a `.finally()`, but the upstream calls it guards
 * (`api.init`, `downloadBudget`, `api.sync`, and each tool operation body) had no
 * timeout. If one stalled (a half-open socket, the server restarting mid-request,
 * a VPN idle-drop) the `release()` never ran and every subsequent tool call
 * blocked forever.
 *
 * This races the call against `ACTUAL_OP_TIMEOUT_MS`. On timeout it REJECTS with a
 * clear, actionable error; because the rejection propagates through the enclosing
 * `withApiLock(...).finally(release)` (reads), the write-queue catch (writes), or
 * the pool's own try/catch (session open), the resource is freed and later calls
 * proceed. A configured timeout of 0 disables the bound.
 *
 * Recovery: in the adapter legacy path the enclosing `finally` runs
 * `shutdownActualApi()`, so the next call re-inits a fresh singleton. In pooled
 * mode the timeout error message ("timed out") matches the transient pattern list
 * (retry.ts), so `_shouldDropPoolOnError` drops the pooled connection and the next
 * call re-inits cleanly. Because the timeout is thrown OUTSIDE any `retry()`,
 * classing it transient drops the pool without causing a retry storm.
 *
 * `fn()` is invoked via `Promise.resolve().then(fn)` so a SYNCHRONOUS throw from
 * `fn` becomes a rejected promise the race can settle on, rather than escaping
 * before `Promise.race` is built (which would orphan the armed timer and later
 * fire an unhandledRejection).
 */
export function withOpTimeout<T>(
  fn: () => Promise<T>,
  label = 'operation',
  overrideMs?: number,
  overrideKnob = 'ACTUAL_IMPORT_TIMEOUT_MS',
): Promise<T> {
  // #407: an explicit override, for an operation that is legitimately long rather than stalled.
  // A budget import is the only one today. Everything else keeps the general bound, because the
  // whole point of #270 is that one stalled call must not hold the process-global mutex.
  const timeoutMs = overrideMs === undefined ? config.ACTUAL_OP_TIMEOUT_MS : overrideMs;
  // #407 review (I4): name the knob that ACTUALLY applies. Hardcoding ACTUAL_OP_TIMEOUT_MS sent an
  // operator whose import died at the import bound to raise a variable with no effect on imports.
  //
  // The name is a PARAMETER rather than inferred from "an override exists" (round 2): inferring it
  // is correct only while exactly one call site passes an override, and the second one would
  // silently report the import knob for a different bound, which is the same misdirection.
  const knob = overrideMs === undefined ? 'ACTUAL_OP_TIMEOUT_MS' : overrideKnob;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fn();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `Actual API ${label} timed out after ${timeoutMs}ms (${knob}). ` +
        'The upstream Actual server may be unreachable or stalled; the operation was ' +
        'aborted so the session can recover. Please retry the request.',
      ));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const logger = createModuleLogger('OP_TIMEOUT');

/**
 * #800: `withOpTimeout` rejects the caller but cannot stop the callback, so a write that awaited
 * something (a guard listing, a read-back, a retry backoff) could resume AFTER the drain had moved
 * on, synced and released the api lock, and then do its raw write against whatever the api
 * singleton pointed at by then. The caller had been told "timed out, please retry", so the late
 * write became a duplicate.
 *
 * Design (options B, C and D were weighed and rejected in the ticket; do not re-litigate them):
 * a per-operation token held in an AsyncLocalStorage, set by `runAbandonable` once the bounded
 * callback has settled or lost the race, and checked by `assertOperationLive` at the one place
 * every raw write goes through (the guarded bindings in actual-adapter.ts).
 *
 * Limits, on purpose: only the window BEFORE a raw write starts is closed. A raw write already
 * called is in flight inside upstream and cannot be cancelled; a late read is wasteful but
 * harmless. A fire-and-forget write started after the callback's own settle would be outside the
 * token; none exists today.
 */
export class OperationAbandonedError extends Error {
  constructor() {
    // No "timed out" (the pool-drop classifier would match it) and no ids. Nobody normally sees
    // this: the caller already has the timeout error.
    super('Write operation was abandoned after its timeout and did not run; no data was modified by this step.');
    this.name = 'OperationAbandonedError';
  }
}

interface AbandonToken { abandoned: boolean }
const abandonStore = new AsyncLocalStorage<AbandonToken>();

/** `withOpTimeout` for a WRITE: once it settles for any reason, the callback may no longer write. */
export async function runAbandonable<T>(
  fn: () => Promise<T>,
  label = 'operation',
  overrideMs?: number,
  overrideKnob?: string,
): Promise<T> {
  const token: AbandonToken = { abandoned: false };
  try {
    return await withOpTimeout(() => abandonStore.run(token, fn), label, overrideMs, overrideKnob);
  } finally {
    // A settled callback has nothing left to write, so marking unconditionally is correct.
    token.abandoned = true;
  }
}

/**
 * Throws when the calling write lost its race: EVERY raw write attempted by an abandoned
 * operation is refused, including a follow-up write of an operation that already started one.
 * No store means not inside a bounded write.
 *
 * DECISION (2026-11-24, maintainer, option A; do not re-litigate): an earlier version let an
 * operation that had already started a raw write finish (a "started" relaxation), then limited
 * that to the same open budget. Review found both unsound: on the legacy path a timeout shuts the
 * api down, so the identity check refused the follow-up anyway, and the check is point-in-time,
 * so a follow-up could still land in a budget the next drain entry had just loaded. The simple
 * rule is the only one that can never write into a wrong budget. The cost, accepted and
 * documented in docs/development/testing-and-reliability.md: a multi-write operation that timed
 * out between two raw writes leaves a half-written state (for example a category group created as
 * expense instead of income, a schedule whose link condition was never stripped).
 */
export function assertOperationLive(): void {
  const token = abandonStore.getStore();
  if (token?.abandoned) {
    logger.debug('Refusing a raw write from an abandoned operation');
    throw new OperationAbandonedError();
  }
}
