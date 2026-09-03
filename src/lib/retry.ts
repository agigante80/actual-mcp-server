import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_BACKOFF_MS, MAX_RETRY_DELAY_MS } from './constants.js';
import { ModuleLoggers } from './loggerFactory.js';

const log = ModuleLoggers.RETRY;

/**
 * Error-message fragments that mark a TRANSIENT / infrastructure-level failure:
 * the kind a retry can actually recover from, and the kind worth dropping a
 * pooled connection over. Single source of truth for #177: the adapter's
 * `_shouldDropPoolOnError` derives from `isRetryableError`, so the retry
 * decision and the pool-drop decision cannot drift apart.
 *
 * #422 is the ONE deliberate divergence: a rate-limit ("too-many-requests") is
 * transient and worth backing off, but it does NOT corrupt the connection, so
 * `_shouldDropPoolOnError` subtracts it (`isRetryableError && !isRateLimitError`).
 * Re-initing during a throttle adds a fresh login to an already-full window,
 * which is itself rejected, cascading into a relogin storm (observed over stdio
 * in #383). Retry stays unified with this list; only drop carves the one case
 * out. That is #177's spirit (one authored pattern source) preserved, not a
 * second divergent list.
 *
 * Anything NOT matching here (domain/validation errors such as "is required",
 * "not found", "does not exist", Zod failures, and any unknown error) is
 * terminal: it fails the same way on every attempt, so it must NOT be retried.
 */
export const TRANSIENT_ERROR_PATTERNS: readonly string[] = [
  'Authentication failed',
  'ECONNRESET',
  'ECONNREFUSED',
  'socket hang up',
  'ETIMEDOUT',
  'out of memory',
  'ENOMEM',
  // #270: the adapter's per-op timeout (withOpTimeout) rejects a stalled upstream
  // call with a message containing "timed out". Classing it transient means the
  // pooled connection is dropped so the session re-inits cleanly on the next
  // call. The timeout error is thrown OUTSIDE any retry(), so this does not cause
  // a retry storm; it only feeds the pool-drop decision.
  'timed out',
];

/**
 * True only for known transient/infrastructure errors (#177). Non-Error and
 * unknown rejections return false (fail fast), so a deterministic domain error
 * is never retried.
 */
export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || '';
  return TRANSIENT_ERROR_PATTERNS.some(p => msg.includes(p));
}

/**
 * The rate-limit signal, in BOTH forms it reaches us (#422). `@actual-app/api`
 * throws `Authentication failed: ${result.error}`, interpolating the server's
 * raw string, so the exact shape is server-dependent:
 *   - the hyphenated code `too-many-requests` (referenced by the auth-retry
 *     comments, some Actual builds), and
 *   - the spaced express-rate-limit default `Too many requests, please try
 *     again later.` (what the E2E stack's server actually returns, #383).
 * The `[\s-]?` arms match both; `rate[\s-]?limit` covers "rate limit" phrasing.
 *
 * Shared by `_shouldDropPoolOnError` (to NOT drop a throttled-but-live
 * connection) and by `isRetryableAuthError` (to retry a login throttle). A
 * non-Error rejection is not a rate-limit.
 *
 * Checks both `.message` AND `.code`: a login throttle carries it in the message
 * (`Authentication failed: Too many requests...`), but a SYNC throttle surfaces
 * as `Error("We had an unknown problem opening ...")` with the rate-limit only in
 * `.code` (observed in the #383 write path). Matching just the message would miss
 * that shape.
 */
export const RATE_LIMIT_PATTERN = /too[\s-]?many[\s-]?requests|rate[\s-]?limit/i;

export function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  const codeStr = typeof code === 'string' ? code : '';
  return RATE_LIMIT_PATTERN.test(err.message || '') || RATE_LIMIT_PATTERN.test(codeStr);
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; backoffMs?: number; isRetryable?: (err: unknown) => boolean },
): Promise<T> {
  const retries = opts?.retries ?? DEFAULT_RETRY_ATTEMPTS;
  const backoffMs = opts?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  const isRetryable = opts?.isRetryable;
  let attempt = 0;
  while (true) {
    try {
      // Ensure the promise from fn() is properly awaited and any rejection is caught
      const result = await Promise.resolve().then(() => fn());
      return result;
    } catch (err) {
      // Fail fast on a non-retryable (domain/validation) error when a classifier
      // is supplied: retrying cannot help and only wastes work plus log noise
      // (#177). With no classifier, behaviour is unchanged (retry until the
      // attempt budget is exhausted), preserving every existing call site.
      if (isRetryable && !isRetryable(err)) {
        log.debug('Not retrying non-transient error', { error: (err as Error)?.message });
        throw err;
      }
      attempt++;
      if (attempt > retries) {
        log.error(`All retry attempts exhausted after ${retries} tries`, err as Error);
        throw err;
      }
      const delay = Math.min(backoffMs * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
      log.debug(`Retry attempt ${attempt}/${retries} after ${delay}ms`, { error: (err as Error).message });
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
