import config from '../config.js';

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
