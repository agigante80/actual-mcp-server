import { DEFAULT_RETRY_ATTEMPTS, DEFAULT_RETRY_BACKOFF_MS, MAX_RETRY_DELAY_MS } from './constants.js';
import { ModuleLoggers } from './loggerFactory.js';

const log = ModuleLoggers.RETRY;

/**
 * Error-message fragments that mark a TRANSIENT / infrastructure-level failure:
 * the kind a retry can actually recover from, and the kind worth dropping a
 * pooled connection over. Single source of truth for #177: the adapter's
 * `_shouldDropPoolOnError` delegates to `isRetryableError`, so the retry
 * decision and the pool-drop decision cannot drift apart.
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

export default retry;
