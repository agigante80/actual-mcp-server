/**
 * Application-wide constants
 * 
 * Centralized constant values for retry logic, timeouts, limits, and other
 * configuration that should remain consistent across the application.
 */

// ============================================================================
// RETRY & RESILIENCE
// ============================================================================

/**
 * Default number of retry attempts for transient failures
 */
export const DEFAULT_RETRY_ATTEMPTS = 3;

/**
 * Initial backoff delay in milliseconds for exponential backoff retry
 */
export const DEFAULT_RETRY_BACKOFF_MS = 200;

/**
 * Maximum delay between retries (prevents unbounded exponential growth)
 */
export const MAX_RETRY_DELAY_MS = 10000;

// ============================================================================
// CONCURRENCY & RATE LIMITING
// ============================================================================

/**
 * Default concurrency limit for Actual Budget API operations
 * Prevents overwhelming the API with too many simultaneous requests
 */
export const DEFAULT_CONCURRENCY_LIMIT = 5;

// ============================================================================
// TIMEOUTS
// ============================================================================

/**
 * Default timeout for API operations in milliseconds
 */
export const DEFAULT_OPERATION_TIMEOUT_MS = 30000;

/**
 * Timeout for server shutdown grace period
 */
export const SHUTDOWN_GRACE_PERIOD_MS = 5000;

// ============================================================================
// MCP SERVER
// ============================================================================

/**
 * Default HTTP server bind host
 */
export const DEFAULT_BIND_HOST = 'localhost';

/**
 * Default HTTP port for MCP server
 */
export const DEFAULT_HTTP_PORT = 3000;

/**
 * Default HTTP path for MCP server endpoint
 */
export const DEFAULT_HTTP_PATH = '/';

/**
 * Server information
 */
export const SERVER_INFO = {
  name: 'actual-budget-mcp',
  version: '1.0.0',
  description: 'MCP server for Actual Budget - 42 tools for finance management',
} as const;

// ============================================================================
// VALIDATION & LIMITS
// ============================================================================

/**
 * Maximum length for name fields (accounts, categories, payees)
 */
export const MAX_NAME_LENGTH = 255;

/**
 * Maximum length for notes/description fields
 */
export const MAX_NOTES_LENGTH = 1000;

/**
 * Date format pattern (YYYY-MM-DD)
 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Month format pattern (YYYY-MM)
 */
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * UUID pattern for ID validation
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// LOGGING
// ============================================================================

/**
 * Log level for production environments
 */
export const PRODUCTION_LOG_LEVEL = 'info';

/**
 * Log level for development environments
 */
export const DEVELOPMENT_LOG_LEVEL = 'debug';

/**
 * Maximum number of log files to retain
 */
export const MAX_LOG_FILES = 14;

/**
 * Maximum size of a single log file before rotation
 */
export const MAX_LOG_FILE_SIZE = '20m';
