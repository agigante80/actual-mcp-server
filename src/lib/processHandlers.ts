/**
 * #622: the process-level unhandledRejection and uncaughtException handlers, as a pure
 * factory so unit tests can drive them without exiting. src/lib/processHandlersInstall.ts
 * registers them on `process`.
 *
 * Records are built from gated fields only (logging convention v1, agreed with
 * actual-sync): `{ type, code?, httpStatus?, category, safeMessage }`. The reason itself,
 * its message, its stack and any upstream `.type` never reach a record or winston, because
 * a rejection reason can carry a request object with an Authorization header, and upstream
 * text can quote account or payee names (#559).
 *
 * INVARIANT: imports only node: builtins, ./errors.js and ./rejection-allowlist.js, never
 * logger.ts or loggerFactory.ts. This module loads before MCP_STDIO_MODE is set, and the
 * logger reads that variable when winston is built.
 */
import { errorLogFields } from './errors.js';
import { isKnownBenignRejection } from './rejection-allowlist.js';

export type ErrorCategory =
  | 'not_found'
  | 'validation'
  | 'auth'
  | 'timeout'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'cancelled'
  | 'internal';

/** Fixed sentence per category, used when the throw site set no log-safe text. */
const SAFE_MESSAGES: Record<ErrorCategory, string> = {
  not_found: 'A requested item was not found.',
  validation: 'A request was rejected as invalid.',
  auth: 'An upstream request was not authorized.',
  timeout: 'An operation timed out.',
  conflict: 'An operation conflicted with existing state.',
  rate_limited: 'An upstream service rate limited the request.',
  upstream_unavailable: 'An upstream service was unavailable.',
  cancelled: 'An operation was cancelled.',
  internal: 'An internal error occurred.',
};

const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

interface CategoryInput {
  errorClass?: string;
  refusalKind?: string;
  code?: string;
  httpStatus?: number;
}

/** Closed mapping, first match wins. Never reads message text. */
export function categorizeError({ errorClass, refusalKind, code, httpStatus: s }: CategoryInput): ErrorCategory {
  if (refusalKind === 'not-found') return 'not_found';
  if (refusalKind === 'out-of-range') return 'validation';
  if (s === 401 || s === 403) return 'auth';
  if (s === 404) return 'not_found';
  if (s === 408 || s === 504 || code === 'ETIMEDOUT') return 'timeout';
  if (s === 409) return 'conflict';
  if (s === 429) return 'rate_limited';
  if (s === 400 || s === 422) return 'validation';
  if ((s !== undefined && s >= 500 && s <= 599) || (code !== undefined && UNAVAILABLE_CODES.has(code))) {
    return 'upstream_unavailable';
  }
  // The Node AbortError class (its ABORT_ERR code fails the E-shape gate). A fetch abort is a
  // DOMException and falls to internal by design: this keys on the class, never on `name`.
  if (errorClass === 'AbortError') return 'cancelled';
  return 'internal';
}

export interface ErrorRecord {
  type: string;
  code?: string;
  httpStatus?: number;
  category: ErrorCategory;
  safeMessage: string;
}

function isHttpStatus(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 100 && v <= 599;
}

function readHttpStatus(reason: unknown): number | undefined {
  if (typeof reason !== 'object' || reason === null) return undefined;
  const r = reason as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } | null };
  if (isHttpStatus(r.status)) return r.status;
  if (isHttpStatus(r.statusCode)) return r.statusCode;
  const response = r.response;
  if (typeof response === 'object' && response !== null && isHttpStatus(response.status)) return response.status;
  return undefined;
}

/**
 * The gated error object of a record. `type` is the prototype class name, never the
 * reason's own `.type` property (that can carry CR/LF from upstream). Can throw when the
 * reason has a hostile getter; the handlers catch that and write the fixed fallback.
 */
export function errorRecordFields(reason: unknown): ErrorRecord {
  const { errorClass, refusalKind, code, logMessage } = errorLogFields(reason);
  const httpStatus = readHttpStatus(reason);
  const category = categorizeError({ errorClass, refusalKind, code, httpStatus });
  const record: ErrorRecord = { type: errorClass, category, safeMessage: logMessage ?? SAFE_MESSAGES[category] };
  if (code !== undefined) record.code = code;
  if (httpStatus !== undefined) record.httpStatus = httpStatus;
  return record;
}

interface WarnLogger {
  warn(message: string, meta?: object): void;
}

export interface ProcessHandlerDeps {
  exit: (code: number) => void;
  writeSync: (fd: number, text: string) => void;
  getLogger: () => WarnLogger | undefined;
}

type Source = 'unhandledRejection' | 'uncaughtException';

const NODE_FLOOR_HINT = [
  `This almost certainly means Node ${process.version} is too old.`,
  'actual-mcp-server requires the Node version in package.json "engines".',
  'Import attributes (`with { type: "json" }`) need Node 22 or newer.',
];

/**
 * Upstream raises bank sync failures as plain Errors with no code, so message text is the
 * only signal. This is a documented exception to the no-text-matching rule: the text only
 * decides survive versus exit, and is never logged.
 */
function isBankSyncError(error: unknown): boolean {
  const errMsg = String((error as { message?: unknown } | null | undefined)?.message || error);
  const errType = (error as { type?: unknown } | null | undefined)?.type;
  return (
    errType === 'BankSyncError' ||
    errMsg.includes('BankSyncError') ||
    errMsg.includes('NORDIGEN_ERROR') ||
    errMsg.includes('RATE_LIMIT_EXCEEDED') ||
    errMsg.includes('Rate limit exceeded') ||
    errMsg.includes('Failed syncing account') ||
    errMsg.includes('GoCardless') ||
    errMsg.includes('SimpleFIN')
  );
}

export function createProcessHandlers(deps: ProcessHandlerDeps) {
  const { exit, writeSync, getLogger } = deps;

  // Fatal: the one synchronous record, then exit 1 even when the write fails. Never also
  // through winston, which under stdio already writes to stderr (one record per event).
  function crash(source: Source, error: ErrorRecord | { type: 'unknown'; category: 'internal'; safeMessage: string }): void {
    try {
      writeSync(2, JSON.stringify({ level: 'error', event: 'sys_crash', source, error }) + '\n');
    } catch {
      // stderr is a full or closed pipe: nothing more can be written.
    } finally {
      exit(1);
    }
  }

  function fallback(source: Source): void {
    crash(source, { type: 'unknown', category: 'internal', safeMessage: SAFE_MESSAGES.internal });
  }

  function survive(source: Source, event: string, message: string, error: ErrorRecord): void {
    const logger = getLogger();
    if (logger) {
      logger.warn(message, { event, source, error });
    } else {
      writeSync(2, JSON.stringify({ level: 'warn', event, source, error }) + '\n');
    }
  }

  function writeNodeFloorHint(error: ErrorRecord): void {
    if (error.code !== 'ERR_IMPORT_ASSERTION_TYPE_MISSING') return;
    for (const line of NODE_FLOOR_HINT) writeSync(2, line + '\n');
  }

  function onUnhandledRejection(reason: unknown): void {
    try {
      const error = errorRecordFields(reason);
      // #275 backstop: a library consumer reaches neither entry point's guard, and import
      // attributes fail asynchronously on an under-floor Node, so name the real cause.
      writeNodeFloorHint(error);
      if (isKnownBenignRejection(reason)) {
        survive('unhandledRejection', 'process.rejection_benign', 'Process-level rejection survived', error);
        return;
      }
      crash('unhandledRejection', error);
    } catch {
      fallback('unhandledRejection');
    }
  }

  function onUncaughtException(reason: unknown): void {
    try {
      const error = errorRecordFields(reason);
      writeNodeFloorHint(error);
      // GoCardless and SimpleFIN failures can surface here from inside @actual-app/api when
      // the provider answers asynchronously (RATE_LIMIT_EXCEEDED, for example). Non-fatal.
      if (isBankSyncError(reason)) {
        if (error.category === 'internal') {
          error.category = 'upstream_unavailable';
          if (error.safeMessage === SAFE_MESSAGES.internal) error.safeMessage = SAFE_MESSAGES.upstream_unavailable;
        }
        survive('uncaughtException', 'bank_sync.exception_benign', 'Bank sync error survived', error);
        return;
      }
      crash('uncaughtException', error);
    } catch {
      fallback('uncaughtException');
    }
  }

  return { onUnhandledRejection, onUncaughtException };
}
