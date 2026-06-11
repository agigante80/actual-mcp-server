/**
 * Module Logger Factory
 * 
 * Creates module-specific loggers with consistent formatting.
 * Each logger automatically prefixes messages with [MODULE_NAME] for
 * easier tracing and debugging in production.
 */

import logger from '../logger.js';

/**
 * Module-specific logger interface
 * Provides standard logging methods with automatic module prefixing
 */
export interface ModuleLogger {
  /**
   * Log informational message
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  info(message: string, meta?: object): void;

  /**
   * Log debug message (only in development)
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  debug(message: string, meta?: object): void;

  /**
   * Log warning message
   * @param message - Log message
   * @param meta - Optional metadata object
   */
  warn(message: string, meta?: object): void;

  /**
   * Log error message with error details
   * @param message - Error message
   * @param error - Error object (optional)
   * @param meta - Optional metadata object
   */
  error(message: string, error?: Error, meta?: object): void;
}

/**
 * Create a module-specific logger
 * 
 * @param moduleName - Name of the module (e.g., 'HTTP', 'ADAPTER', 'TOOLS')
 * @returns Module logger with automatic prefixing
 * 
 * @example
 * ```typescript
 * import { createModuleLogger } from '../lib/loggerFactory.js';
 * 
 * const log = createModuleLogger('HTTP');
 * log.info('Server started', { port: 3600 });
 * // Output: [HTTP] Server started { port: 3600 }
 * 
 * log.error('Connection failed', new Error('Timeout'), { retries: 3 });
 * // Output: [HTTP] Connection failed { error: 'Timeout', stack: '...', retries: 3 }
 * ```
 */
export function createModuleLogger(moduleName: string): ModuleLogger {
  const prefix = `[${moduleName}]`;

  // `module` is attached as a structured field (promoted to a top-level field by the
  // logger format, #219) while the `[MODULE]` prefix is kept in the message for the
  // pretty/dev output. `module` is spread LAST so it stays authoritative and a caller's
  // metadata cannot accidentally overwrite it.
  return {
    info: (message: string, meta?: object) => {
      logger.info(`${prefix} ${message}`, { ...meta, module: moduleName });
    },

    debug: (message: string, meta?: object) => {
      logger.debug(`${prefix} ${message}`, { ...meta, module: moduleName });
    },

    warn: (message: string, meta?: object) => {
      logger.warn(`${prefix} ${message}`, { ...meta, module: moduleName });
    },

    error: (message: string, error?: Error, meta?: object) => {
      if (error) {
        logger.error(`${prefix} ${message}`, {
          error: error.message,
          stack: error.stack,
          ...meta,
          module: moduleName,
        });
      } else {
        logger.error(`${prefix} ${message}`, { ...meta, module: moduleName });
      }
    },
  };
}

/**
 * Pre-configured module loggers for common components
 * Can be imported directly for convenience
 * 
 * @example
 * ```typescript
 * import { ModuleLoggers } from '../lib/loggerFactory.js';
 * 
 * ModuleLoggers.HTTP.info('Request received');
 * ModuleLoggers.ADAPTER.debug('Processing transaction');
 * ```
 */
export const ModuleLoggers = {
  HTTP: createModuleLogger('HTTP'),
  ADAPTER: createModuleLogger('ADAPTER'),
  TOOLS: createModuleLogger('TOOLS'),
  SESSION: createModuleLogger('SESSION'),
  CONNECTION: createModuleLogger('CONNECTION'),
  RETRY: createModuleLogger('RETRY'),
} as const;
