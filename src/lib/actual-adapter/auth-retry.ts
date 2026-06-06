// Auth-rate-limit retry subsystem for the Actual adapter (#166 split out of
// actual-adapter.ts). Self-contained: the two observability counters are
// mutated ONLY here (withAuthRetry / the reset), so the mutable state never
// crosses a module boundary. actual-adapter reads the counts via
// getAuthRetryCounts() for getConcurrencyState, and wraps api.init() with
// withAuthRetry. Linked issue: #127.

import { DEFAULT_RETRY_ATTEMPTS, MAX_RETRY_DELAY_MS } from '../constants.js';
import logger from '../../logger.js';

let authRetryCount = 0;          // monotonic, observability
let authRetryFailureCount = 0;   // increments only when retry budget exhausted

// The auth-rate-limit path uses a deliberately LARGER backoff than the generic
// retry helper because Actual Budget's auth rate-limiter operates on a multi-
// second sliding window, not a per-request burst. The generic 200ms base
// would exhaust within 1.4s, well inside the upstream's window.
//
// Empirically (2026-05-06, #127):
//   - 200ms base = 1.4s total: too short, every retry hits the throttle.
//   - 2000ms base = 14s total: insufficient under heavy auth pressure.
//   - 5000ms base = 5s + 10s + 10s = 25s total (each step capped by
//     MAX_RETRY_DELAY_MS): clears the window in light-pressure scenarios.
//
// Beyond 25s, blocking the API mutex starts to harm tail latency for unrelated
// tool calls. The long-term fix for sustained pressure is session reuse.
const AUTH_RETRY_BASE_BACKOFF_MS = 5000;

export function isRetryableAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes('Authentication failed: too-many-requests') ||
    err.message.includes('Authentication failed: network-failure')
  );
}

/**
 * Wrap an operation with retry-on-rate-limit. Used to wrap api.init() so
 * transient too-many-requests errors are absorbed transparently. The retry
 * budget is capped at DEFAULT_RETRY_ATTEMPTS (3) attempts and total wallclock
 * is bounded by MAX_RETRY_DELAY_MS via exponential backoff.
 *
 * Test-friendly: opts.maxRetries / opts.baseBackoffMs override the defaults
 * so unit tests can run fast.
 *
 * Log hygiene: never logs the upstream URL, password, or any config-derived
 * value, only the error class and the Actual error code plus the attempt counter.
 */
export async function withAuthRetry<T>(
  operation: () => Promise<T>,
  opts?: { maxRetries?: number; baseBackoffMs?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;
  const baseBackoffMs = opts?.baseBackoffMs ?? AUTH_RETRY_BASE_BACKOFF_MS;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryableAuthError(err)) throw err;
      attempt++;
      if (attempt > maxRetries) {
        // Budget exhausted: log + bump failure counter, but do NOT bump
        // authRetryCount, which measures successful retry-and-sleep cycles.
        authRetryFailureCount++;
        const code = (err instanceof Error ? err.message.match(/Authentication failed: (\S+)/)?.[1] : null) || 'unknown';
        logger.error(`[ADAPTER] Auth retry exhausted after ${maxRetries} retries (last code: ${code})`);
        throw err;
      }
      // We're going to retry: count it and sleep with exponential backoff.
      authRetryCount++;
      const delay = Math.min(baseBackoffMs * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
      const code = (err instanceof Error ? err.message.match(/Authentication failed: (\S+)/)?.[1] : null) || 'unknown';
      logger.debug(`[ADAPTER] Auth retry ${attempt}/${maxRetries} (code: ${code}) after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/** Read-only snapshot of the auth-retry counters for getConcurrencyState. */
export function getAuthRetryCounts(): { authRetries: number; authRetryFailures: number } {
  return { authRetries: authRetryCount, authRetryFailures: authRetryFailureCount };
}

/** Test-only: reset the auth retry observability counters. */
export function _resetAuthRetryCountersForTests(): void {
  authRetryCount = 0;
  authRetryFailureCount = 0;
}
