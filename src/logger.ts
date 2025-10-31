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
const DEFAULT_LEVEL = process.env.MCP_BRIDGE_LOG_LEVEL || 'debug';

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
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
      ),
    });

  // debug transport collects debug+ messages into debug-%DATE%.log
  transports.push(createDailyRotateTransport('debug'));
  // errors into error-%DATE%.log
  transports.push(createDailyRotateTransport('error'));
}

// single console transport for terminal output (use same level)
transports.push(
  new winston.transports.Console({
    level: DEFAULT_LEVEL,
    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
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
    // debug module not available or failed to patch — ignore
  }
})();

export default logger;