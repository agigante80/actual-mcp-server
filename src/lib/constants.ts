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
 * How long (ms) to wait after calling rawRunBankSync for the SDK's background
 * promise to surface a BankSyncError as an unhandledRejection.
 *
 * Bank provider errors (GoCardless RATE_LIMIT_EXCEEDED, auth failures, etc.)
 * arrive as HTTP responses. Fast banks respond within 1-3 seconds; slower
 * institutions can take considerably longer. 30 seconds gives a comfortable
 * margin while keeping the tool's wall-clock time acceptable for MCP clients.
 */
export const BANK_SYNC_SETTLE_MS = 30_000;

/**
 * How long (ms) to wait for additional queued writes before closing the
 * shared budget session. Increasing this value batches more writes per
 * session at the cost of slightly higher latency.
 */
export const WRITE_SESSION_DELAY_MS = 100;

// ============================================================================
// MCP SERVER
// ============================================================================

/**
 * Default HTTP port for MCP server. Canonical default is 3600 (#230): it matches
 * the listen-port fallback in src/index.ts, the Dockerfile EXPOSE/HEALTHCHECK, the
 * published image, .env.example, and every deployment guide.
 *
 * @public Consumed by the text-parsing port_alignment guard (tests/unit/port_alignment.test.js),
 * not by a runtime import, so Knip cannot see the usage. Alive: removing it breaks the guard.
 */
export const DEFAULT_HTTP_PORT = 3600;

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
