/**
 * Transport-level error logging (#504).
 *
 * `@modelcontextprotocol/sdk` reports transport and protocol errors through
 * `transport.onerror`, which `Protocol.connect` chains into the Server's `onerror`.
 * Nothing set it, so refusals (batch cap, parse errors, unknown ids) were invisible.
 *
 * The error text can echo CLIENT content (payloads, headers), so it is sanitized before
 * it is logged, the log message is a CONSTANT (the logger runs winston splat(), which
 * interpolates `%o`/`%s` in the message), and the Error object, stack and cause are never
 * passed to the logger (format.errors({ stack: true }) would re-emit the raw message).
 * Volume is bounded by ONE per-process window limiter.
 */

import { createModuleLogger, type ModuleLogger } from './loggerFactory.js';

const MAX_DETAIL_CODE_POINTS = 200;
const CUT_CHARS = /[{["'`]/;
// Control (C0, C1), line/paragraph separators, bidi format characters, and (#535) the
// invisible marks that can hide or reorder text in a log line: the Arabic letter mark,
// zero-width space/joiners, LRM/RLM and the BOM. Written with escapes, as src/logger.ts
// does: a raw U+2028 in source would terminate the literal.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
const OMITTED = '[payload omitted]';

/** Pure: turn an arbitrary thrown value into a bounded, payload-free, single-line string. */
export function sanitizeTransportErrorDetail(value: unknown): string {
  let raw = '';
  try {
    if (value === null || value === undefined) raw = '';
    else if (value instanceof Error) raw = String(value.message);
    else raw = String(value);
  } catch {
    raw = '';
  }
  let cut = false;
  const cutAt = raw.search(CUT_CHARS);
  if (cutAt >= 0) {
    raw = raw.slice(0, cutAt);
    cut = true;
  }
  let s = raw.replace(/%/g, ' ').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, MAX_DETAIL_CODE_POINTS).join('');
  if (cut) s = s ? `${s} ${OMITTED}` : OMITTED;
  return s === '' ? '[no message]' : s;
}

export interface WindowLimiter {
  take(): { allowed: boolean; suppressed: number };
}

/** Fixed-window limiter: first `max` calls per window pass, the rest are counted. */
export function createWindowLimiter(opts: { max: number; windowMs: number; now: () => number }): WindowLimiter {
  let windowStart = 0;
  let count = 0;
  let suppressed = 0;
  let started = false;
  return {
    take() {
      const t = opts.now();
      if (!started || t - windowStart >= opts.windowMs) {
        started = true;
        windowStart = t;
        count = 0;
      }
      if (count < opts.max) {
        count++;
        const reported = suppressed;
        suppressed = 0;
        return { allowed: true, suppressed: reported };
      }
      suppressed++;
      return { allowed: false, suppressed: 0 };
    },
  };
}

// ONE limiter per process so many HTTP sessions cannot multiply the budget.
const moduleLimiter = createWindowLimiter({ max: 50, windowMs: 60_000, now: Date.now });

function safeErrorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

interface ErrorHookTarget {
  onerror?: ((error: Error) => void) | undefined;
}

/**
 * Install a server.onerror that logs a sanitized, rate-limited record. Chains any prior
 * handler. The handler never throws (stdio invokes it inside a stdin data handler).
 */
export function attachTransportErrorLogger(
  server: ErrorHookTarget,
  transport: 'http' | 'stdio',
  deps: { logger?: ModuleLogger; limiter?: WindowLimiter } = {}
): void {
  const prev = server.onerror;
  const limiter = deps.limiter ?? moduleLimiter;
  let log: ModuleLogger | undefined = deps.logger;
  server.onerror = (error: Error) => {
    try {
      if (typeof prev === 'function') prev(error);
    } catch {
      // a broken prior handler must not stop ours or escape into the SDK
    }
    try {
      const { allowed, suppressed } = limiter.take();
      if (!allowed) return;
      log = log ?? createModuleLogger('TRANSPORT');
      log.warn('MCP transport error', {
        transport,
        errorName: safeErrorName(error),
        detail: sanitizeTransportErrorDetail(error),
        ...(suppressed > 0 ? { suppressed } : {}),
      });
    } catch {
      // never throw into the SDK
    }
  };
}
