import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
// requestContext only imports async_hooks, so this is safe to import from the early-loaded
// logger module (no circular import).
import { requestContext } from './lib/requestContext.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// env-configurable
const STORE_LOGS = process.env.MCP_BRIDGE_STORE_LOGS === 'true';
const LOG_DIR = process.env.MCP_BRIDGE_LOG_DIR
  ? path.isAbsolute(process.env.MCP_BRIDGE_LOG_DIR)
    ? process.env.MCP_BRIDGE_LOG_DIR
    : path.join(process.cwd(), process.env.MCP_BRIDGE_LOG_DIR)
  : path.join(__dirname, '..', 'app', 'logs');

const DATE_PATTERN = process.env.MCP_BRIDGE_ROTATE_DATEPATTERN || 'YYYY-MM-DD';
const MAX_SIZE = process.env.MCP_BRIDGE_MAX_LOG_SIZE || '20m';
const MAX_FILES = process.env.MCP_BRIDGE_MAX_FILES || '14d';

function safeStringify(obj: unknown, maxLen = 2000) {
  try {
    const seen = new WeakSet();
    const s = JSON.stringify(
      obj,
      (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      },
      2
    );
    if (s.length > maxLen) return s.slice(0, maxLen) + '...';
    return s;
  } catch {
    try {
      return String(obj).slice(0, maxLen) + '...';
    } catch {
      return '[Unstringifiable]';
    }
  }
}

// ---------------------------------------------------------------------------
// Log configuration (#219)
//
// Read straight from process.env, NOT from src/config.ts: this module is imported
// during early bootstrap (before the Zod config is validated), exactly like the
// existing MCP_STDIO_MODE / MCP_BRIDGE_LOG_LEVEL reads, so going through config would
// risk an undefined format/level during start-up logging.
// ---------------------------------------------------------------------------

export interface LogConfig {
  useJson: boolean;
  level: string;
  service: string;
}

/**
 * Resolve the output format, level, and service name from the environment.
 *
 * Format precedence is deterministic: an explicit `LOG_FORMAT` ("json" | "pretty")
 * wins; otherwise `NODE_ENV==='production'` selects JSON; otherwise pretty. The
 * non-production default is therefore the human-readable text format, so existing
 * log-text-scraping tests keep passing and JSON is an explicit opt-in or prod-only.
 */
export function resolveLogConfig(env: NodeJS.ProcessEnv = process.env): LogConfig {
  const fmt = String(env.LOG_FORMAT || '').toLowerCase();
  const isProd = env.NODE_ENV === 'production';
  const useJson = fmt === 'json' ? true : fmt === 'pretty' ? false : isProd;
  const level = env.MCP_BRIDGE_LOG_LEVEL || (isProd ? 'info' : 'debug');
  const service = env.MCP_SERVICE_NAME || 'actual-mcp-server';
  return { useJson, level, service };
}

const { useJson: USE_JSON, level: DEFAULT_LEVEL, service: SERVICE } = resolveLogConfig(process.env);

// Fields that stay at the top level of a record; everything else is user metadata.
// `sessionId`/`requestId` are reserved correlation fields (#221), so they render top-level
// rather than nested under `context`.
const STANDARD_KEYS = new Set([
  'level', 'message', 'timestamp', 'service', 'module', 'stack', 'ms', 'sessionId', 'requestId',
]);

// Promote a `service` field onto every record.
const addService = winston.format((info) => {
  info.service = SERVICE;
  return info;
});

/**
 * Resolve a request correlation id: reuse a non-empty inbound `X-Correlation-ID`, else
 * generate one. Exported so the HTTP layer and tests share the exact decision (#221).
 *
 * The inbound value is CLIENT-CONTROLLED and is stamped on every log line for the request,
 * so it is sanitised first: control characters are stripped (prevents log-line forging in
 * non-JSON consumers) and the length is capped (prevents per-line bloat from a hostile
 * header). If nothing usable remains, a UUID is generated.
 */
const MAX_REQUEST_ID_LEN = 128;
export function resolveRequestId(inbound?: string | null): string {
  let id = typeof inbound === 'string' ? inbound.trim() : '';
  if (id) {
    // eslint-disable-next-line no-control-regex
    id = id.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_REQUEST_ID_LEN);
  }
  return id.length > 0 ? id : randomUUID();
}

// Stamp the active request's correlation ids onto every record (#221). Reads the
// AsyncLocalStorage store; the context-derived id is authoritative, so it OVERWRITES any
// caller-supplied `sessionId` metadata. When there is no active store (startup, CLI, stdio
// without a request wrapper) it is a no-op and never throws. Must run after splat() (which
// reverts top-level field additions made before it), so it is placed alongside addService.
const addCorrelation = winston.format((info) => {
  const store = requestContext.getStore();
  if (store?.sessionId) info.sessionId = store.sessionId;
  if (store?.requestId) info.requestId = store.requestId;
  return info;
});

// Collect non-standard fields into a single `context` object so JSON records have a
// stable shape ({ timestamp, level, service, module, message, stack?, context? }).
// winston hands the SAME info object to every transport's format, so this must be
// idempotent: a record passing through more than one transport (e.g. STORE_LOGS=true
// gives two file transports plus the console) must not re-nest `context` into
// `context.context`. Excluding the `context` key from the move makes a second pass a
// no-op, and any already-present context is merged rather than wrapped.
const nestContext = winston.format((info) => {
  const ctx: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (!STANDARD_KEYS.has(key) && key !== 'context') {
      ctx[key] = (info as Record<string, unknown>)[key];
      delete (info as Record<string, unknown>)[key];
    }
  }
  if (Object.keys(ctx).length > 0) {
    const existing = (info as Record<string, unknown>).context;
    (info as Record<string, unknown>).context =
      existing && typeof existing === 'object' ? { ...(existing as object), ...ctx } : ctx;
  }
  return info;
});

// ---------------------------------------------------------------------------
// Secret / PII redaction (#220)
//
// Runs inside buildLogFormat (per-transport), specifically AFTER winston.format.splat():
// splat() rebuilds the record from the original args and reverts top-level field mutations
// made before it (nested objects survive only because they are shared refs), so redaction
// placed before splat would silently fail to mask a top-level secret like `note`. Running
// it per-transport in the SAME pipeline that serializes (before nestContext, which moves
// fields under `context`) is the placement that actually reaches the output. It is
// idempotent (masking and value-scrub both go to a constant), so the STORE_LOGS
// multi-transport fan-out is safe. The live `note`/header tests pin this ordering: moving
// redactSecrets before splat makes them fail.
//
// Two mechanisms: a key-name denylist for structured fields at any depth, and a finite
// scrub of the actual configured secret VALUES (which catches a secret carried as a value
// under a benign key, or inside a stringified message).
// ---------------------------------------------------------------------------

const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization', 'proxy-authorization', 'token', 'password', 'encryptionpassword',
  'cookie', 'set-cookie', 'secret', 'apikey', 'api_key', 'x-api-key',
  'access_token', 'refresh_token', 'client_secret',
]);

/** A metadata key is sensitive if its lowercased name is denylisted or ends in a secret suffix. */
export function isSensitiveKey(key: string): boolean {
  const low = key.toLowerCase();
  if (SENSITIVE_KEYS.has(low)) return true;
  return (
    low.endsWith('password') ||
    low.endsWith('secret') ||
    low.endsWith('token') ||
    low.includes('authorization') ||
    low.includes('cookie')
  );
}

/** The actual configured secret values, so a secret echoed as a VALUE is also masked. */
export function collectSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    // length guard avoids masking short/common values that could collide with benign log
    // text (a short secret is still masked by KEY name when under a sensitive field; only
    // the free-text VALUE scrub is skipped for it).
    if (typeof v === 'string' && v.length >= 8 && /(PASSWORD|SECRET|AUTHORIZATION|_TOKEN)$/.test(k)) {
      out.push(v);
    }
  }
  return out;
}

function scrubSecretValues(s: string, secrets: string[]): string {
  let out = s;
  for (const sec of secrets) {
    if (sec && out.includes(sec)) out = out.split(sec).join(REDACTED);
  }
  return out;
}

const MAX_REDACT_DEPTH = 8;
const MAX_REDACT_NODES = 2000;

/**
 * Return a redacted version of a value. NESTED objects/arrays are COPIED (copy-on-write),
 * never mutated, so redacting a log record cannot corrupt a live caller object (e.g.
 * `req.headers` passed by reference). Depth/node caps and a cycle guard bound pathological
 * or cyclic structures.
 */
function redactValue(
  val: unknown,
  secrets: string[],
  depth: number,
  seen: WeakSet<object>,
  counter: { n: number }
): unknown {
  if (val && typeof val === 'object') {
    if (depth > MAX_REDACT_DEPTH || counter.n > MAX_REDACT_NODES) return '[Truncated]';
    if (seen.has(val as object)) return '[Circular]';
    seen.add(val as object);
    if (Array.isArray(val)) return val.map((v) => redactValue(v, secrets, depth + 1, seen, counter));
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(val as Record<string, unknown>)) {
      counter.n++;
      copy[key] = isSensitiveKey(key)
        ? REDACTED
        : redactValue((val as Record<string, unknown>)[key], secrets, depth + 1, seen, counter);
    }
    return copy;
  }
  if (typeof val === 'string' && secrets.length > 0) return scrubSecretValues(val, secrets);
  return val;
}

/**
 * Mask sensitive keys and scrub known-secret values. The TOP-LEVEL record is mutated in
 * place (winston hands the transport its own copy, and the winston Symbol keys must be
 * preserved), but every NESTED object is replaced with a redacted copy so a shared live
 * object (a request's headers) is never altered. Masking to a constant is idempotent.
 */
export function redactRecord<T>(record: T, secrets: string[] = []): T {
  if (!record || typeof record !== 'object') return record;
  const seen = new WeakSet<object>();
  const counter = { n: 0 };
  const rec = record as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    rec[key] = isSensitiveKey(key) ? REDACTED : redactValue(rec[key], secrets, 1, seen, counter);
  }
  return record;
}

const SECRET_VALUES = collectSecretValues(process.env);
const redactSecrets = winston.format((info) => redactRecord(info, SECRET_VALUES));

/**
 * Build the winston format. Reuses winston's own building blocks
 * (`format.errors` + `format.splat` + `format.json`) rather than a hand-rolled
 * serializer, so the metadata that loggerFactory already attaches flows through.
 * The previous printf referenced only `{ timestamp, level, message }`, which is
 * why metadata (including error stacks) was silently dropped.
 */
export function buildLogFormat(
  useJson: boolean,
  colorize: boolean = !!process.stdout.isTTY
): winston.Logform.Format {
  if (useJson) {
    return winston.format.combine(
      winston.format.timestamp(), // ISO 8601 UTC
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      // #220: redact AFTER splat. splat() rebuilds the record from the original args and
      // reverts top-level field mutations made before it (nested objects survive as shared
      // refs), so redaction must run after splat to actually mask top-level secrets.
      redactSecrets(),
      addCorrelation(), // #221: stamp sessionId/requestId (after splat, like addService)
      addService(),
      nestContext(),
      winston.format.json()
    );
  }
  // Colorize only for an interactive terminal, so piped output and log files do not get
  // ANSI escape codes (also keeps the format deterministic and unit-testable).
  return winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    redactSecrets(), // #220: after splat (see note in the json branch)
    addCorrelation(), // #221: stamp sessionId/requestId
    ...(colorize ? [winston.format.colorize()] : []),
    winston.format.printf((info) => {
      const rec = info as Record<string, unknown>;
      let line = `${rec.timestamp} ${rec.level}: ${rec.message}`;
      if (rec.stack) line += `\n${rec.stack as string}`;
      // Append any remaining metadata for dev readability (it is no longer dropped).
      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(rec)) {
        if (!STANDARD_KEYS.has(key)) extra[key] = rec[key];
      }
      if (Object.keys(extra).length > 0) line += ` ${safeStringify(extra, 1000)}`;
      return line;
    })
  );
}

const transports: winston.transport[] = [];

// file transports when enabled (capture debug+)
if (STORE_LOGS) {
  const createDailyRotateTransport = (level: string) =>
    new DailyRotateFile({
      level,
      dirname: LOG_DIR,
      filename: `${level}-%DATE%.log`,
      datePattern: DATE_PATTERN,
      zippedArchive: true,
      maxSize: MAX_SIZE,
      maxFiles: MAX_FILES,
      // Files must never get ANSI colour, regardless of whether stdout is a TTY.
      format: buildLogFormat(USE_JSON, false),
    });

  // debug transport collects debug+ messages into debug-%DATE%.log
  transports.push(createDailyRotateTransport('debug'));
  // errors into error-%DATE%.log
  transports.push(createDailyRotateTransport('error'));
}

// single console transport for terminal output (use same level).
// In stdio mode all output must go to stderr. Writing to stdout corrupts JSON-RPC framing.
// MCP_STDIO_MODE is set by src/index.ts before this module is first imported.
transports.push(
  new winston.transports.Console({
    level: DEFAULT_LEVEL,
    ...(process.env.MCP_STDIO_MODE === 'true'
      ? { stderrLevels: ['error', 'warn', 'info', 'verbose', 'debug', 'silly', 'http'] }
      : {}),
    format: buildLogFormat(USE_JSON),
  })
);

const logger = winston.createLogger({
  level: DEFAULT_LEVEL,
  transports,
  exitOnError: false,
});

import type { Request } from 'express';

export function logTransportWithDirection(
  direction: 'to' | 'from',
  clientIp: string,
  req: Request,
  data: unknown
) {
  // Log STRUCTURED meta (not a pre-stringified blob) so the redaction format (#220) can
  // mask sensitive header keys (Authorization, Cookie) and known-secret values in the
  // payload before anything is written.
  logger.debug('transport message', {
    direction,
    clientIp,
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    payload: safeStringify(data, 2000),
  });
}

// --- Wire debug module into winston and route console.* to winston only ---
// NOTE: avoid writing to both original console and winston to prevent duplicates.
(function wireConsoleAndDebug() {
  const writeToWinston = (level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]) => {
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : safeStringify(a, 2000))).join(' ');
      // call winston at the requested level
      // @ts-ignore dynamic level
      logger[level](text);
    } catch {
      // ignore
    }
  };

  // Replace global console methods to feed winston (do NOT call original console.*)
  console.log = (...args: unknown[]) => writeToWinston('info', args);
  console.info = (...args: unknown[]) => writeToWinston('info', args);
  console.warn = (...args: unknown[]) => writeToWinston('warn', args);
  console.error = (...args: unknown[]) => writeToWinston('error', args);
  console.debug = (...args: unknown[]) => writeToWinston('debug', args);

  // Patch debug module (express, undici, debug(...) callers) to forward to winston.debug
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const debugModule = require('debug');
    if (debugModule) {
      // replace debug.log so debug(...) prints go into winston
      debugModule.log = (...args: unknown[]) => {
        try {
          const s = args.map((a) => (typeof a === 'string' ? a : safeStringify(a, 1000))).join(' ');
          logger.debug(s);
        } catch {
          // ignore
        }
      };
    }
  } catch {
    // debug module not available or failed to patch, ignore
  }
})();

export default logger;
