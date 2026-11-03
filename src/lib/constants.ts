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
 * How many ids each list of an `actual_bank_sync` report carries (#548). The counts are
 * always the full lengths; only the id lists are cut, so a first sync of a large account
 * cannot flood the client's context. The tool sets `truncated` when any list was cut.
 */
export const BANK_SYNC_IDS_CAP = 100;

/**
 * How long (ms) to wait for additional queued writes before closing the
 * shared budget session. Increasing this value batches more writes per
 * session at the cost of slightly higher latency.
 */
export const WRITE_SESSION_DELAY_MS = 100;

/**
 * #489: how long (ms) to wait for a plain-to-split conversion to become visible.
 *
 * Upstream `api/transaction-update` returns `handlers['transactions-batch-update'](diff)['updated']`
 * without awaiting it (verified at @actual-app/api 26.9.0), so the write lands AFTER the call
 * resolves. Measured live, a read issued immediately after still sees the plain row. The adapter
 * therefore reads the split back, polling every SPLIT_VERIFY_INTERVAL_MS, and refuses to report
 * success if it has not appeared within this bound. A local SQLite write, so milliseconds in
 * practice; the bound only decides how long a genuinely lost write takes to be reported.
 *
 * #494: the poll runs inside the drain under ACTUAL_OP_TIMEOUT_MS, which races the callback rather
 * than cancelling it. So the effective bound is min(this, ACTUAL_OP_TIMEOUT_MS / 2), counted from
 * the start of the operation; an op timeout of 0 (disabled) leaves this bound alone. The cap is
 * cooperative: one read already in flight at the deadline can still outlive the op timeout if that
 * single read takes longer than the remaining half. Separately, the pre-flight read's retry backoff
 * (200ms then 400ms) can by itself exceed an op timeout under 600ms; that is outside the poll.
 */
export const SPLIT_VERIFY_TIMEOUT_MS = 2000;
export const SPLIT_VERIFY_INTERVAL_MS = 25;

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
 * #479: the most dates actual_schedules_dates returns, so a daily schedule cannot flood the context.
 */
export const SCHEDULE_DATES_CAP = 366;

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
 * UUID pattern for ID validation.
 *
 * Case-insensitive by CHARACTER CLASS, never by flag (#588). `z.toJSONSchema()` publishes
 * `.source` as the JSON Schema `pattern` and silently drops `.flags` (a JSON Schema pattern
 * cannot carry one), so a `/i` here made the server accept ids that every client validating
 * `inputSchema` (the MCP SDK's Ajv validator, LibreChat, Claude Desktop) refused before the
 * call left the client. Not a corner case: Actual's bundled default-db.sqlite gives every
 * budget an Income category group with the fixed uppercase id
 * `2E1F5BDB-209B-43F9-AF2C-3CE28E380C00`, and SQLite compares ids byte for byte, so the
 * server cannot lowercase on its behalf either. The two-case class accepts exactly the same
 * inputs as the flagged form did and survives serialisation.
 *
 * Guarded by tests/unit/schema_published_parity.test.js: no regex check in any tool schema
 * may carry a flag, and Zod and the SDK's validator must agree on every fixture. Not
 * `z.guid()`: it also publishes `format: "uuid"`, which a strict validator without format
 * support rejects, and one rejected schema disables the whole tool surface in some clients
 * (#293). Any change to the published contract belongs in its own ticket.
 */
export const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * #276: the Actual Budget SERVER version range this build's `@actual-app/api` is known
 * to work with. HAND-MAINTAINED: `@actual-app/api` v26 exposes no supported-server range
 * (verified: getServerVersion just proxies the server's build.version), so there is no
 * upstream fact to derive this from and no #275-style drift guard is possible.
 *
 * UPDATE THIS when bumping `@actual-app/api`: set `minVersion` to the oldest server the new
 * client supports, and `testedMaxMajor` to the newest server major it has been tested
 * against. The check is ADVISORY only (the real compatibility contract is the migration
 * check `@actual-app/api` runs at downloadBudget), so a wrong value here can at most produce
 * a spurious or missing warning, never a broken deployment.
 */
export const SUPPORTED_ACTUAL_SERVER_RANGE = {
  /** Oldest server version this client supports. Below this: "too old" warning. */
  minVersion: '25.0.0',
  /** Newest server MAJOR tested against `@actual-app/api` v26. Above this: "newer than tested".
   *  #439: now deliberately REDUNDANT with the derived upper bound (the installed
   *  api version), which subsumes it whenever this constant holds the installed
   *  major, the only value it is meant to hold. Retained as the hand-maintained
   *  fallback for when the installed version cannot be resolved. Deleting it and
   *  deriving the bound entirely is defensible and removes the drift class, but it
   *  changes a shared constant, so it belongs in its own ticket. */
  testedMaxMajor: 26,
} as const;
