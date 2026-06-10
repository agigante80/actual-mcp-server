import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

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
// Log configuration + format (#219)
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
const STANDARD_KEYS = new Set(['level', 'message', 'timestamp', 'service', 'module', 'stack', 'ms']);

// Promote a `service` field onto every record.
const addService = winston.format((info) => {
  info.service = SERVICE;
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
  const meta = {
    direction,
    clientIp,
    method: req.method,
    url: req.originalUrl,
    headers: req.headers,
    payload: safeStringify(data, 2000),
  };
  logger.debug(safeStringify(meta, 4000));
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
