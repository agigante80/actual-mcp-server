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
 * log.info('Server started', { port: 3000 });
 * // Output: [HTTP] Server started { port: 3000 }
 * 
 * log.error('Connection failed', new Error('Timeout'), { retries: 3 });
 * // Output: [HTTP] Connection failed { error: 'Timeout', stack: '...', retries: 3 }
 * ```
 */
export function createModuleLogger(moduleName: string): ModuleLogger {
  const prefix = `[${moduleName}]`;

  return {
    info: (message: string, meta?: object) => {
      logger.info(`${prefix} ${message}`, meta);
    },

    debug: (message: string, meta?: object) => {
      logger.debug(`${prefix} ${message}`, meta);
    },

    warn: (message: string, meta?: object) => {
      logger.warn(`${prefix} ${message}`, meta);
    },

    error: (message: string, error?: Error, meta?: object) => {
      if (error) {
        logger.error(`${prefix} ${message}`, {
          error: error.message,
          stack: error.stack,
          ...meta,
        });
      } else {
        logger.error(`${prefix} ${message}`, meta);
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
  SSE: createModuleLogger('SSE'),
  ADAPTER: createModuleLogger('ADAPTER'),
  TOOLS: createModuleLogger('TOOLS'),
  SESSION: createModuleLogger('SESSION'),
  CONNECTION: createModuleLogger('CONNECTION'),
  RETRY: createModuleLogger('RETRY'),
} as const;
