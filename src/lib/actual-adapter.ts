// Must be the very first import — sets globalThis.navigator before @actual-app/api is evaluated.
// Required by @actual-app/api v26.3.0+ which uses navigator.platform at module load time.
import './node-polyfills.js';

import type { components } from '../../generated/actual-client/types.js';

import api from '@actual-app/api';

// @actual-app/api is a CJS package (no "type" field). In NodeNext/ESM context TypeScript
// cannot expose its named exports via static import syntax. At runtime the default import
// IS module.exports, so all methods are accessible as properties.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const {
  addTransactions: rawAddTransactions,
  getAccounts: rawGetAccounts,
  importTransactions: rawImportTransactions,
  getTransactions: rawGetTransactions,
  getCategories: rawGetCategories,
  createCategory: rawCreateCategory,
  getPayees: rawGetPayees,
  createPayee: rawCreatePayee,
  getBudgetMonths: rawGetBudgetMonths,
  getBudgetMonth: rawGetBudgetMonth,
  setBudgetAmount: rawSetBudgetAmount,
  createAccount: rawCreateAccount,
  updateAccount: rawUpdateAccount,
  getAccountBalance: rawGetAccountBalance,
  updateTransaction: rawUpdateTransaction,
  deleteTransaction: rawDeleteTransaction,
  updateCategory: rawUpdateCategory,
  deleteCategory: rawDeleteCategory,
  updatePayee: rawUpdatePayee,
  deletePayee: rawDeletePayee,
  deleteAccount: rawDeleteAccount,
  getRules: rawGetRules,
  createRule: rawCreateRule,
  updateRule: rawUpdateRule,
  deleteRule: rawDeleteRule,
  setBudgetCarryover: rawSetBudgetCarryover,
  closeAccount: rawCloseAccount,
  reopenAccount: rawReopenAccount,
  getCategoryGroups: rawGetCategoryGroups,
  createCategoryGroup: rawCreateCategoryGroup,
  updateCategoryGroup: rawUpdateCategoryGroup,
  deleteCategoryGroup: rawDeleteCategoryGroup,
  mergePayees: rawMergePayees,
  getPayeeRules: rawGetPayeeRules,
  batchBudgetUpdates: rawBatchBudgetUpdates,
  holdBudgetForNextMonth: rawHoldBudgetForNextMonth,
  resetBudgetHold: rawResetBudgetHold,
  runQuery: rawRunQuery,
  runBankSync: rawRunBankSync,
  getBudgets: rawGetBudgets,
  getIDByName: rawGetIDByName,
  getServerVersion: rawGetServerVersion,
  getSchedules: rawGetSchedules,
  createSchedule: rawCreateSchedule,
  updateSchedule: rawUpdateSchedule,
  deleteSchedule: rawDeleteSchedule,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = api as any;
import { EventEmitter } from 'events';
import observability from '../observability.js';
import retry, { isRetryableError } from './retry.js';
import logger from '../logger.js';
import config from '../config.js';
import { parseBudgetRegistry, type BudgetConfig } from './budget-registry.js';
import { requestContext } from './requestContext.js';
import { connectionPool } from './ActualConnectionPool.js';
import { isApiInitialized, setApiInitialized } from './apiState.js';

/**
 * Budget registry — all budgets configured via ACTUAL_* and BUDGET_n_* env vars.
 * Built once at startup; used by every withActualApi call.
 */
const budgetRegistry = parseBudgetRegistry(process.env, {
  serverUrl: config.ACTUAL_SERVER_URL,
  password: config.ACTUAL_PASSWORD,
  syncId: config.ACTUAL_BUDGET_SYNC_ID,
  encryptionPassword: config.ACTUAL_BUDGET_PASSWORD,
});

logger.info(
  `[ADAPTER] Budget registry: ${budgetRegistry.size} budget(s) — ` +
  [...budgetRegistry.values()].map(b => `"${b.name}" (${b.serverUrl})`).join(', '),
);

/**
 * Per-session active budget. Map from sessionId to lowercased budget key
 * (matches the keys in budgetRegistry).
 *
 * Issue #156: previously a single module-level `activeBudgetKey` was shared
 * across all sessions. In multi-user OIDC mode that meant one user's
 * actual_budgets_switch silently flipped the active budget for every other
 * concurrent session, leaking financial data across tenants. The per-session
 * map closes that hole: each MCP sessionId has its own slot.
 *
 * Sessions without an entry (or callers outside any requestContext.run scope:
 * stdio mode, startup health checks) fall back to the env-default budget
 * (first entry in budgetRegistry).
 *
 * Lifecycle: entries are removed on session close via session_close.ts and
 * implicitly when connectionPool.shutdownConnection runs (switchBudget calls
 * it to drop the stale pool entry bound to the previous syncId).
 */
const sessionBudgetState = new Map<string, string>();

function getActiveBudgetConfig(): BudgetConfig {
  // _resolveSessionId is declared below; function declarations hoist so this
  // call works at runtime. If we're not in any requestContext.run scope (stdio,
  // startup health checks), sessionId is undefined and we fall back to the
  // env-default budget (first registry entry).
  const sessionId = requestContext.getStore()?.sessionId;
  if (sessionId) {
    const key = sessionBudgetState.get(sessionId);
    if (key) {
      const found = budgetRegistry.get(key);
      if (found) return found;
    }
  }
  return [...budgetRegistry.values()][0];
}

/**
 * Global API session mutex.
 * @actual-app/api is a singleton with a single SQLite connection — concurrent
 * init/shutdown pairs corrupt the session.  All callers (reads via withActualApi,
 * writes via processWriteQueue) must acquire this lock before touching the API.
 */
let _apiSessionLock: Promise<void> = Promise.resolve();

function withApiLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const prevLock = _apiSessionLock;
  _apiSessionLock = new Promise<void>(resolve => { release = resolve; });
  return prevLock.then(() => fn()).finally(() => release());
}

// ----------------------------------------------------------------------------
// Per-session pool cooperation — issue #134
// ----------------------------------------------------------------------------
// Pre-#134, every adapter call did api.init() + op + api.shutdown(). With many
// tool calls in quick succession this produced a burst of upstream logins and
// tripped Actual's auth rate-limiter (#127's root cause).
//
// Post-#134, when an MCP session has already initialised a per-session
// connection via ActualConnectionPool (httpServer.ts wires this on session
// open), withActualApi reuses that connection: no init, no shutdown. Writes
// commit via api.sync() (the same pattern processWriteQueue already uses).
// The pool tears down once at session close.
//
// Fallback: when there is no sessionId in AsyncLocalStorage (e.g. startup
// health checks, internal calls outside any MCP session, stdio transport
// callers that don't run inside requestContext.run), or when there is a
// sessionId but the pool has no initialised connection for it, withActualApi
// falls back to the legacy init+shutdown path so non-MCP callers keep working.
let connectionReuseCount = 0;

// The "is the @actual-app/api singleton currently live?" flag lives in
// src/lib/apiState.ts so both this module and ActualConnectionPool can
// update it without a circular import. The pool's hasConnection() returns
// true based on its own per-session record; this flag is the second guard
// — the singleton's actual state. Both must agree before reuse is safe.

function _resolveSessionId(): string | undefined {
  return requestContext.getStore()?.sessionId;
}

function _hasPooledConnection(sessionId: string | undefined): sessionId is string {
  if (!sessionId) return false;
  if (!isApiInitialized()) return false; // singleton was shut down by some other path
  return connectionPool.hasConnection(sessionId);
}

/**
 * Decide whether an error from the wrapped operation suggests the api
 * singleton is in a corrupted state and the pool's session connection should
 * be released so the next call re-inits cleanly.
 *
 * **Drop on**: infrastructure-level errors that imply the api singleton, the
 * upstream connection, or process-level resources are no longer usable.
 *
 * **Keep on**: user-input validation errors, domain errors ("not found",
 * "does not exist"), Zod schema failures — these don't corrupt the api
 * singleton, so dropping the pool would discard a perfectly good connection
 * and force every retry through the legacy init+shutdown path (which is
 * exactly the auth-burst pattern #134 is trying to eliminate).
 *
 * Default: keep. We err on the side of preserving pool reuse — if the api is
 * actually corrupted but the error pattern doesn't match, the next call's op
 * will surface the same root cause and we'll catch it then.
 */
// Whether an error is infrastructure-level (drop the pooled connection so the
// next call re-inits cleanly). This is the SAME class as "retryable", so it
// delegates to isRetryableError (#177): the pool-drop decision and the retry
// decision share one pattern list and cannot drift. A consistency test pins
// this equivalence.
function _shouldDropPoolOnError(err: unknown): boolean {
  return isRetryableError(err);
}

/**
 * Enforce per-request budget ACL before any pool branching or lock acquisition.
 *
 * Issue #156: the documented isolation model (CF-5 OIDC + AUTH_BUDGET_ACL)
 * was never wired through to tool dispatch. canAccessBudget() in
 * src/auth/budget-acl.ts had zero call sites; budgetAclMiddleware only
 * attached req.allowedBudgets and trusted callers to honour it.
 *
 * This function is the single enforcement choke point: every withActualApi /
 * withActualApiWrite call passes through it. If the resolved active budget's
 * syncId is not in the request's allowedBudgets list, we throw with a clear
 * message and log at warn level with structured fields.
 *
 * stdio short-circuit: when there's no sessionId in context AND AUTH_PROVIDER
 * is not 'oidc', we treat the caller as trusted-local. stdio mode runs
 * outside requestContext.run by design (the transport handler is single-user
 * local on a process the user already controls), so requiring allowedBudgets
 * there would break stdio entirely. This short-circuit is load-bearing for
 * Claude Desktop / Claude Code compatibility.
 */
function _enforceBudgetAcl(toolName?: string): void {
  const store = requestContext.getStore();
  const sessionId = store?.sessionId;
  const allowedBudgets = store?.allowedBudgets;

  // Trusted-local short-circuit. stdio and startup health checks run with no
  // sessionId; in non-OIDC modes those are by-construction trusted (single
  // user, local process). The ACL only applies when an authenticated multi-
  // user context is in play (AUTH_PROVIDER === 'oidc').
  if (!sessionId && config.AUTH_PROVIDER !== 'oidc') {
    return;
  }

  // OIDC + no allowedBudgets in context: the request slipped past the
  // middleware. Defence-in-depth: refuse rather than fail open.
  if (config.AUTH_PROVIDER === 'oidc' && !allowedBudgets) {
    logger.warn(
      JSON.stringify({
        event: 'acl_denied',
        reason: 'no_allowed_budgets_in_context',
        sessionId: sessionId ?? null,
        tool: toolName ?? null,
      }),
    );
    throw new Error(
      'Budget ACL: no allowedBudgets in request context. ' +
        'This request bypassed the budget-acl middleware. Refusing for safety. See #156.',
    );
  }

  // No restriction.
  if (!allowedBudgets || allowedBudgets.includes('*')) return;

  const target = getActiveBudgetConfig();
  if (!allowedBudgets.includes(target.syncId)) {
    logger.warn(
      JSON.stringify({
        event: 'acl_denied',
        principal: null,
        attemptedBudget: target.syncId,
        allowedBudgets,
        sessionId: sessionId ?? null,
        tool: toolName ?? null,
      }),
    );
    throw new Error(
      `Budget ACL: budget "${target.name}" (${target.syncId}) is not in this session's allowedBudgets.`,
    );
  }
}

/**
 * Helper to run an operation with the Actual API ready, deciding the lifecycle
 * mode automatically:
 *
 *   - **Pooled mode** (preferred): when an MCP session is in the AsyncLocalStorage
 *     context AND the connection pool has an initialised connection for it.
 *     The operation runs against the existing connection. No init, no shutdown.
 *     If the operation throws, the pool's connection for that session is
 *     released so the next call gets a fresh init.
 *
 *   - **Legacy mode** (fallback): the original per-op init → op → shutdown
 *     cycle. Used when there is no sessionId in context, or the pool has no
 *     connection for the sessionId. Preserves the original tombstone /
 *     persistence semantics for non-MCP callers.
 *
 * In either mode `withApiLock` serialises against concurrent callers because
 * `@actual-app/api` is a process-wide singleton.
 */
export async function withActualApi<T>(operation: () => Promise<T>): Promise<T> {
  // ACL enforcement BEFORE pool branching or lock acquisition (#156).
  // Denial here means the lock is never acquired and no upstream resource is
  // touched.
  _enforceBudgetAcl();

  const sessionId = _resolveSessionId();

  if (_hasPooledConnection(sessionId)) {
    // Pooled mode: skip init+shutdown.
    return withApiLock(async () => {
      try {
        connectionReuseCount++;
        logger.debug(`[ADAPTER] Reusing pool connection for session ${sessionId} (reuses=${connectionReuseCount})`);
        return await operation();
      } catch (err) {
        // Only drop the pool connection on errors that suggest the api
        // singleton itself is in a bad state. User-input validation /
        // domain errors leave the connection fine and dropping it would
        // re-introduce the auth-burst pattern #134 is fixing.
        if (_shouldDropPoolOnError(err)) {
          logger.warn(`[ADAPTER] Releasing pool connection for session ${sessionId} after infrastructure-level error`);
          try { await connectionPool.shutdownConnection(sessionId); } catch (_e) { /* swallow */ }
        }
        throw err;
      }
    });
  }

  if (sessionId) {
    logger.warn(`[ADAPTER] Pool miss for session ${sessionId}; falling back to per-op init`);
  }

  // Legacy mode: init+shutdown around every operation.
  return withApiLock(async () => {
    try {
      await initActualApiForOperation();
      return await operation();
    } finally {
      await shutdownActualApi();
    }
  });
}

/**
 * Variant of `withActualApi` for write operations. Identical to `withActualApi`
 * except that, in pooled mode, it explicitly calls `api.sync()` after the
 * operation succeeds so writes propagate to the upstream Actual server (and so
 * tombstones for deletes propagate). In legacy mode the existing
 * `shutdownActualApi()` already handles the persistence flush — no extra sync
 * call needed there.
 *
 * Pattern source: `processWriteQueue` already uses `api.sync()` between writes
 * within a batch (without shutdown), so this is the same proven approach
 * generalised to single-write call sites.
 */
export async function withActualApiWrite<T>(operation: () => Promise<T>): Promise<T> {
  // ACL enforcement BEFORE pool branching or lock acquisition (#156).
  _enforceBudgetAcl();

  const sessionId = _resolveSessionId();

  if (_hasPooledConnection(sessionId)) {
    return withApiLock(async () => {
      try {
        connectionReuseCount++;
        logger.debug(`[ADAPTER] Reusing pool connection for write session ${sessionId} (reuses=${connectionReuseCount})`);
        const result = await operation();
        // Propagate the write to the server so other clients (and our next
        // read) see it. Pre-#134 this happened implicitly via api.shutdown().
        try {
          const apiAny = api as unknown as { sync?: () => Promise<unknown> };
          if (typeof apiAny.sync === 'function') {
            await apiAny.sync();
          }
        } catch (syncErr) {
          // Sync failure on a write IS infrastructure-level — drop the pool
          // connection so the next call re-inits, then surface the error.
          logger.error(`[ADAPTER] api.sync() failed after write in session ${sessionId}; releasing pool connection`);
          try { await connectionPool.shutdownConnection(sessionId); } catch (_e) { /* swallow */ }
          throw syncErr;
        }
        return result;
      } catch (err) {
        // Same policy as withActualApi: only drop the pool on errors that
        // suggest the api singleton is corrupted. User-input / domain errors
        // leave the connection fine.
        if (_shouldDropPoolOnError(err)) {
          logger.warn(`[ADAPTER] Releasing pool connection for write session ${sessionId} after infrastructure-level error`);
          try { await connectionPool.shutdownConnection(sessionId); } catch (_e) { /* swallow */ }
        }
        throw err;
      }
    });
  }

  if (sessionId) {
    logger.warn(`[ADAPTER] Pool miss for session ${sessionId}; falling back to per-op init (write)`);
  }

  return withApiLock(async () => {
    try {
      await initActualApiForOperation();
      return await operation();
    } finally {
      await shutdownActualApi();
    }
  });
}

/**
 * Test-only: reset the connection-reuse counter. NOT exported via the package
 * public surface — only used by unit tests.
 */
export function _resetConnectionReuseCounterForTests(): void {
  connectionReuseCount = 0;
}

/**
 * Test-only: directly set the api-initialised flag. Lets unit tests exercise
 * the pool-cooperation branch without driving a real api.init() against the
 * upstream. NOT exported via the package public surface.
 */
export function _setApiInitializedForTests(value: boolean): void {
  setApiInitialized(value);
}

/**
 * Test-only: short-circuit `initActualApiForOperation` and `shutdownActualApi`
 * so the legacy fallback path can run without making network calls against a
 * real upstream Actual server. Used by unit tests that want to verify the
 * branch decision in `withActualApi` (pool vs legacy) without hanging on the
 * real api.init network handshake.
 *
 * NOT exported via the package public surface.
 */
let _skipApiInitForTests = false;
export function _setSkipApiInitForTests(value: boolean): void {
  _skipApiInitForTests = value;
}

// ----------------------------------------------------------------------------
// Auth-rate-limit retry — issue #127
// ----------------------------------------------------------------------------
// The Actual Budget server returns "Authentication failed: too-many-requests"
// when many MCP sessions log in in quick succession (e.g. a burst of E2E
// tests). Without a retry-with-backoff at the adapter layer, the very first
// burst spike fails through to the test runner and cascades into the bearer
// MCP container's session-init crash (see #132).
//
// We retry only on errors known to be transient at the auth layer
// (too-many-requests, network-failure). invalid-password and other terminal
// errors propagate immediately so callers see the real cause.
//
// The retry budget is bounded so a rate-limited init cannot indefinitely
// hold the API mutex (withApiLock) and starve other operations.
// ----------------------------------------------------------------------------

let authRetryCount = 0;          // monotonic, observability
let authRetryFailureCount = 0;   // increments only when retry budget exhausted

// The auth-rate-limit path uses a deliberately LARGER backoff than the generic
// retry helper because Actual Budget's auth rate-limiter operates on a multi-
// second sliding window, not a per-request burst. The generic 200ms base
// would exhaust within 1.4s — well inside the upstream's window.
//
// Empirically (2026-05-06, #127):
//   - 200ms base = 1.4s total: too short, every retry hits the throttle.
//   - 2000ms base = 14s total: insufficient under heavy auth pressure
//     (e.g. 10 rapid logins before a tool call still throttle 14s+).
//   - 5000ms base = 5s + 10s + 10s = 25s total (each step capped by
//     MAX_RETRY_DELAY_MS): clears the rate-limit window in light-pressure
//     scenarios (3 rapid logins) without holding the API mutex unreasonably
//     long.
//
// Beyond 25s, blocking the API mutex starts to harm tail latency for
// unrelated tool calls. The proper long-term fix for sustained-pressure
// scenarios is session reuse (avoid init+shutdown per op) — out of scope for
// this ticket; tracked as a follow-up.
const AUTH_RETRY_BASE_BACKOFF_MS = 5000;

export function isRetryableAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes('Authentication failed: too-many-requests') ||
    err.message.includes('Authentication failed: network-failure')
  );
}

/**
 * Wrap an operation with retry-on-rate-limit. Used to wrap api.init() so
 * transient too-many-requests errors are absorbed transparently. The retry
 * budget is capped at DEFAULT_RETRY_ATTEMPTS (3) attempts and total wallclock
 * is bounded by MAX_RETRY_DELAY_MS via exponential backoff.
 *
 * Test-friendly: opts.maxRetries / opts.baseBackoffMs override the defaults
 * so unit tests can run fast.
 *
 * Log hygiene: this function never logs the upstream URL, password, or any
 * config-derived value — only the error class and the Actual error code
 * (extracted from the message) plus the attempt counter.
 */
export async function withAuthRetry<T>(
  operation: () => Promise<T>,
  opts?: { maxRetries?: number; baseBackoffMs?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_RETRY_ATTEMPTS;
  const baseBackoffMs = opts?.baseBackoffMs ?? AUTH_RETRY_BASE_BACKOFF_MS;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (err) {
      if (!isRetryableAuthError(err)) throw err;
      attempt++;
      if (attempt > maxRetries) {
        // Budget exhausted: log + bump failure counter, but do NOT bump
        // authRetryCount — that counter measures successful retry-and-sleep
        // cycles, not failed final attempts.
        authRetryFailureCount++;
        const code = (err instanceof Error ? err.message.match(/Authentication failed: (\S+)/)?.[1] : null) || 'unknown';
        logger.error(`[ADAPTER] Auth retry exhausted after ${maxRetries} retries (last code: ${code})`);
        throw err;
      }
      // We're going to retry — count it and sleep with exponential backoff.
      authRetryCount++;
      const delay = Math.min(baseBackoffMs * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
      const code = (err instanceof Error ? err.message.match(/Authentication failed: (\S+)/)?.[1] : null) || 'unknown';
      logger.debug(`[ADAPTER] Auth retry ${attempt}/${maxRetries} (code: ${code}) after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Test-only: reset the auth retry observability counters. NOT exported via
 * the package public surface — only used by unit tests.
 */
export function _resetAuthRetryCountersForTests(): void {
  authRetryCount = 0;
  authRetryFailureCount = 0;
}

/**
 * Initialize Actual API - based on s-stefanov/actual-mcp pattern
 * This calls api.init() and api.downloadBudget() for each operation
 */
async function initActualApiForOperation(): Promise<void> {
  if (_skipApiInitForTests) {
    setApiInitialized(true);
    return;
  }
  // If the api singleton is already live (e.g. the connection pool initialised
  // it at MCP session open), don't redundantly call api.init() again — that
  // would trigger an extra upstream login and reintroduce the auth-burst
  // pattern #134 is fixing. The pool keeps the singleton alive across writes;
  // we just join in.
  if (isApiInitialized()) {
    logger.debug('[ADAPTER] api already initialised; skipping redundant init');
    return;
  }
  try {
    const budget = getActiveBudgetConfig();
    const DATA_DIR = config.MCP_BRIDGE_DATA_DIR;

    logger.debug(`[ADAPTER] Initializing Actual API for operation (budget: "${budget.name}", server: ${budget.serverUrl})`);

    // Wrap api.init in auth-rate-limit retry so a transient too-many-requests
    // doesn't surface to the caller (and doesn't trigger #132's crash path).
    await withAuthRetry(() => api.init({
      dataDir: DATA_DIR,
      serverURL: budget.serverUrl,
      password: budget.password || '',
    }));

    logger.debug('[ADAPTER] Downloading budget');

    if (budget.encryptionPassword) {
      const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
      await apiWithOptions.downloadBudget(budget.syncId, { password: budget.encryptionPassword });
    } else {
      await api.downloadBudget(budget.syncId);
    }

    setApiInitialized(true);
    logger.debug('[ADAPTER] Actual API initialized for operation');
  } catch (err) {
    logger.error('[ADAPTER] Error initializing Actual API:', err);
    throw err;
  }
}

async function shutdownActualApi(): Promise<void> {
  if (_skipApiInitForTests) {
    setApiInitialized(false);
    return;
  }
  // If the connection pool currently has any active per-session connections,
  // those sessions own the api singleton's lifecycle — tearing it down here
  // would invalidate every active session's pool entry and force the next
  // tool call back through legacy init+shutdown (the very pattern #134 is
  // eliminating). Instead, just sync (the persistence guarantee that
  // shutdown was previously providing implicitly) and leave the singleton
  // alive for the pool to manage.
  try {
    const stats = connectionPool.getStats();
    if (stats.activeSessions > 0) {
      try {
        const apiAny = api as unknown as { sync?: () => Promise<unknown> };
        if (typeof apiAny.sync === 'function') {
          await apiAny.sync();
          logger.debug('[ADAPTER] api.sync() instead of shutdown (pool has active sessions)');
        }
      } catch (syncErr) {
        logger.error('[ADAPTER] sync-without-shutdown failed:', syncErr);
        // Don't propagate — shutdown was best-effort anyway.
      }
      return;
    }
  } catch (statsErr) {
    // Pool not available (e.g. early startup) — fall through to legacy shutdown.
    logger.debug('[ADAPTER] could not read pool stats; defaulting to full shutdown:', statsErr);
  }

  try {
    const maybeApi = api as unknown as { shutdown?: () => Promise<void> };
    if (typeof maybeApi.shutdown === 'function') {
      await maybeApi.shutdown();
      logger.debug('[ADAPTER] Actual API shutdown complete');
    }
  } catch (err) {
    logger.error('[ADAPTER] Error during Actual API shutdown:', err);
  } finally {
    // Always reset the flag — even if shutdown threw, the api singleton is
    // no longer in a known-good state, so pool reuse must NOT be attempted
    // until something explicitly re-inits.
    setApiInitialized(false);
  }
}

import { BANK_SYNC_SETTLE_MS, DEFAULT_CONCURRENCY_LIMIT, DEFAULT_RETRY_ATTEMPTS, MAX_RETRY_DELAY_MS, WRITE_SESSION_DELAY_MS } from './constants.js';

/**
 * Very small concurrency limiter for adapter calls. This prevents bursts from
 * overloading the actual server. It's intentionally tiny and in-memory; replace
 * with Bottleneck or p-queue for production.
 */
let MAX_CONCURRENCY = parseInt(process.env.ACTUAL_API_CONCURRENCY || String(DEFAULT_CONCURRENCY_LIMIT), 10);
let running = 0;
const queue: Array<() => void> = [];

/**
 * Write operation queue with budget session management
 * This ensures write operations share a single budget session to avoid race conditions
 */
interface WriteOperation<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  // sessionId captured at enqueue time so the pool-vs-legacy branch in
  // processWriteQueue has the right context, even though setTimeout strips
  // AsyncLocalStorage. See #158.
  sessionId?: string;
}

let writeQueue: WriteOperation<any>[] = [];
let isProcessingWrites = false;
let writeSessionTimeout: NodeJS.Timeout | null = null;

// Counter for diagnostic: writes that reused an existing pool connection
// (skipped the per-op init). Surfaces in getConcurrencyState(). See #158.
let writeConnectionReuseCount = 0;

async function processWriteQueue() {
  // Atomically check and set processing flag to prevent race conditions
  if (isProcessingWrites || writeQueue.length === 0) return;
  isProcessingWrites = true;
  
  // Clear the timeout since we're processing now
  if (writeSessionTimeout) {
    clearTimeout(writeSessionTimeout);
    writeSessionTimeout = null;
  }
  
  const batch = writeQueue.splice(0, writeQueue.length); // Take all current items
  // Pool-cooperation decision (#158): use the first queued op's captured
  // sessionId as the batch's sessionId. In practice all ops batched together
  // came from the same setTimeout window and same request, so they share
  // a session. The heuristic is safe: a stale sessionId just means we take
  // the legacy branch, never that we attribute one session's writes to
  // another's pool entry.
  const batchSessionId = batch[0]?.sessionId;
  const usePoolBranch = !!batchSessionId && _hasPooledConnection(batchSessionId);
  logger.debug(
    `[WRITE QUEUE] Processing batch of ${batch.length} operations ` +
      `(sessionId=${batchSessionId ?? 'none'}, poolBranch=${usePoolBranch})`,
  );

  try {
    await withApiLock(async () => {
      try {
        if (usePoolBranch) {
          // Pool branch: api singleton already live for this session, no need
          // to init or shutdown around the batch. Sync at the end to commit
          // writes upstream. On infrastructure-level errors, release the pool
          // entry so the next call materialises a fresh connection.
          writeConnectionReuseCount++;
          logger.debug(
            `[WRITE QUEUE] Reusing pool connection for session ${batchSessionId} ` +
              `(writeReuses=${writeConnectionReuseCount})`,
          );
        } else {
          // Legacy branch: no pool entry, init+shutdown around the batch as
          // before. initActualApiForOperation() still short-circuits if the
          // api is somehow already live (e.g. another path init'd it).
          await initActualApiForOperation();
        }

        // Process all queued writes in the same session
        // Each operation handles its own success/failure
        await Promise.allSettled(
          batch.map(async ({ operation, resolve, reject }) => {
            try {
              const result = await operation();
              resolve(result);
            } catch (error) {
              logger.error('[WRITE QUEUE] Operation failed:', error);
              reject(error);
            }
          })
        );

        // Explicitly sync changes to server before shutdown (legacy) or just
        // before returning (pool). Persistence guarantee in both branches.
        logger.debug(`[WRITE QUEUE] Syncing ${batch.length} operations to server`);
        try {
          await (api as any).sync();
          logger.debug(`[WRITE QUEUE] Sync completed`);
        } catch (syncError) {
          logger.error('[WRITE QUEUE] Sync failed:', syncError);
          // Pool branch: drop the connection on infrastructure-level sync
          // failure so the next write re-initialises cleanly. Mirrors
          // withActualApiWrite's policy.
          if (usePoolBranch && _shouldDropPoolOnError(syncError)) {
            logger.warn(
              `[WRITE QUEUE] Releasing pool connection for session ${batchSessionId} after sync failure`,
            );
            try {
              await connectionPool.shutdownConnection(batchSessionId!);
            } catch (_e) {
              /* swallow */
            }
          }
          // Don't throw - we still want to shutdown cleanly
          // Individual operation errors were already reported to callers
        }

        if (!usePoolBranch) {
          // Legacy branch only: actually shut the singleton down.
          // shutdownActualApi() itself short-circuits to sync-only if another
          // path has active pool sessions, so this is safe under contention.
          await shutdownActualApi();
        }
        logger.debug(`[WRITE QUEUE] Batch completed successfully`);
      } catch (error) {
        logger.error('[WRITE QUEUE] Fatal error in write queue:', error);
        // Reject any operations that weren't processed
        batch.forEach(({ reject }) => {
          try {
            reject(error);
          } catch (e) {
            logger.error('[WRITE QUEUE] Error rejecting operation:', e);
          }
        });
        // Pool branch: drop the pool entry if the error suggests infrastructure
        // corruption. Legacy branch: full shutdown.
        if (usePoolBranch) {
          if (_shouldDropPoolOnError(error)) {
            try {
              await connectionPool.shutdownConnection(batchSessionId!);
            } catch (_e) {
              /* swallow */
            }
          }
        } else {
          await shutdownActualApi();
        }
      }
    });
  } finally {
    isProcessingWrites = false;
    // Process any new operations that were queued while we were processing
    if (writeQueue.length > 0 && writeSessionTimeout === null) {
      writeSessionTimeout = setTimeout(() => {
        processWriteQueue();
      }, WRITE_SESSION_DELAY_MS);
    }
  }
}

function queueWriteOperation<T>(operation: () => Promise<T>): Promise<T> {
  // ACL enforcement at the write-queue entry (#156). Failing here means the
  // op is never enqueued and no upstream resource is touched.
  _enforceBudgetAcl();

  // Capture sessionId from AsyncLocalStorage at enqueue time. The setTimeout
  // below strips the ALS frame, so without capturing here the pool-branch
  // decision in processWriteQueue would always miss. See #158.
  const sessionId = _resolveSessionId();
  return new Promise((resolve, reject) => {
    writeQueue.push({ operation, resolve, reject, sessionId });

    // Clear existing timeout
    if (writeSessionTimeout) {
      clearTimeout(writeSessionTimeout);
    }

    // Set new timeout to process queue
    writeSessionTimeout = setTimeout(() => {
      processWriteQueue();
    }, WRITE_SESSION_DELAY_MS);
  });
}

/**
 * Run a read+write atomic sequence inside a SINGLE write-queue session.
 *
 * Use this when a tool needs to read state, decide what to write based on
 * that state, and write all within one lock acquisition. Compare with the
 * default pattern of one `withActualApi` (read) followed by one
 * `queueWriteOperation` (write), which holds the api lock TWICE.
 *
 * Inside the callback, use the raw `@actual-app/api` functions imported at
 * the top of `actual-adapter.ts` (e.g. `rawGetRules`, `rawDeleteRule`). Do
 * NOT call public adapter methods (e.g. `adapter.getRules`) inside the
 * callback, since each public adapter method opens its own lock cycle and
 * defeats the purpose of this helper.
 *
 * Inherits the correctness guarantees of `queueWriteOperation`: serialised
 * via `withApiLock`, single `api.sync()` after the callback resolves,
 * pool-aware shutdown semantics. Issue #142.
 */
export async function withWriteSession<T>(fn: () => Promise<T>): Promise<T> {
  return queueWriteOperation(fn);
}

function processQueue() {
  if (running >= MAX_CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;
  running++;
  try {
    next();
  } catch (e) {
    // next() will manage its own promise resolution
    running--;
    processQueue();
  }
}

function withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENCY) {
    running++;
    return fn().finally(() => {
      running--;
      processQueue();
    });
  }
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const r = await fn();
        resolve(r);
      } catch (err) {
        reject(err);
      } finally {
        running--;
        processQueue();
      }
    });
  });
}

// Expose some helpers for testing concurrency
export function getConcurrencyState() {
  return {
    running,
    queueLength: queue.length,
    maxConcurrency: MAX_CONCURRENCY,
    // Auth-retry observability — issue #127. authRetries is monotonic over the
    // process lifetime; authRetryFailures only increments when retry budget
    // exhausted. A jump in authRetries without a matching jump in
    // authRetryFailures means the retry-with-backoff is absorbing rate-limit
    // pressure (healthy). Both jumping = upstream genuinely overloaded.
    authRetries: authRetryCount,
    authRetryFailures: authRetryFailureCount,
    // Pool-cooperation observability — issue #134. connectionReuses increments
    // every time withActualApi reused an existing per-session pool connection
    // instead of running its own init+shutdown cycle. Pre-#134 this was
    // structurally always 0; post-#134 it should grow at least linearly with
    // tool-call volume on healthy MCP sessions.
    connectionReuses: connectionReuseCount,
    // Pool-cooperation observability for WRITES (issue #158). Before #158 the
    // write path (processWriteQueue) never used the pool branch explicitly,
    // so this counter stayed at 0 even when reads were reusing the pool.
    // Post-#158 it grows with write volume on pooled sessions.
    writeConnectionReuses: writeConnectionReuseCount,
  };
}

/**
 * Sync local changes to the Actual Budget server.
 * 
 * This function should be called after write operations (create, update, delete)
 * to ensure changes are properly synced to the remote server. Without syncing,
 * changes may only exist locally and could be lost.
 * 
 * Note: Adds a small delay to ensure local changes are committed before syncing.
 */
async function syncToServer(): Promise<void> {
  try {
    // Small delay to ensure local changes are committed to the database
    // before attempting to sync to the server
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // TypeScript doesn't recognize sync in the type definitions, but it exists at runtime
    console.log('[SYNC] Calling api.sync()...');
    await (api as any).sync();
    console.log('[SYNC] api.sync() completed successfully');
  } catch (err) {
    // Log but don't throw - sync failures shouldn't break the operation
    console.error('[SYNC] Sync to server failed:', err);
  }
}

export function setMaxConcurrency(n: number) {
  MAX_CONCURRENCY = n;
}

/**
 * Wrap a raw function with the standard adapter retry + concurrency behavior.
 * Useful for tests that want to exercise retry behavior without calling the real raw methods.
 */
export function callWithRetry<T>(fn: () => Promise<T>, opts?: { retries?: number; backoffMs?: number }): Promise<T> {
  // retry already types the options; forward them directly and let TypeScript
  // validate shapes rather than using `as any`.
  return withConcurrency(() => retry(fn, opts));
}

export const notifications = new EventEmitter();

// --- Normalization helpers -------------------------------------------------
export function normalizeToTransactionArray(raw: unknown): components['schemas']['Transaction'][] {
  if (!raw) return [];
  // If already an array of transactions
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'object')) return raw as components['schemas']['Transaction'][];
  // If a single transaction object, wrap it
  if (typeof raw === 'object' && raw !== null && 'id' in (raw as Record<string, unknown>)) return [raw as components['schemas']['Transaction']];
  // If array of ids returned, convert to minimal Transaction objects
  if (Array.isArray(raw) && (raw as unknown[]).every(r => typeof r === 'string')) {
    return (raw as string[]).map(id => ({ id } as components['schemas']['Transaction']));
  }
  // Fallback: try to coerce
  return Array.isArray(raw) ? (raw as components['schemas']['Transaction'][]) : [];
}

export function normalizeToId(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>)) {
    const idVal = (raw as Record<string, unknown>)['id'];
    if (typeof idVal === 'string') return idVal;
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') return raw[0] as string;
  return String(raw ?? '');
}

export function normalizeImportResult(raw: unknown): { added?: string[]; updated?: string[]; errors?: string[] } {
  if (!raw || typeof raw !== 'object') return { added: [], updated: [], errors: [] };
  const r = raw as Record<string, unknown>;
  return {
    added: Array.isArray(r.added) ? (r.added as string[]) : [],
    updated: Array.isArray(r.updated) ? (r.updated as string[]) : [],
    errors: Array.isArray(r.errors) ? (r.errors as string[]) : [],
  };
}
// ---------------------------------------------------------------------------

export async function getAccounts(): Promise<components['schemas']['Account'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.list').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetAccounts() as Promise<components['schemas']['Account'][]>, { retries: 2, backoffMs: 200 }));
  });
}
// addTransactions returns various formats: "ok", array of IDs, or Transaction objects
export async function addTransactions(txs: components['schemas']['TransactionInput'][] | components['schemas']['TransactionInput'], options: { runTransfers?: boolean } = {}) : Promise<string[]> {
  observability.incrementToolCall('actual.transactions.create').catch(() => {});
  return queueWriteOperation(async () => {
    // The Actual API expects addTransactions(accountId, transactions, options)
    // Extract accountId from the first transaction and remove it from transaction objects
    const txArray = Array.isArray(txs) ? txs : [txs];
    if (txArray.length === 0) {
      throw new Error('No transactions provided');
    }

    const accountId = (txArray[0] as any).account || (txArray[0] as any).accountId;
    if (!accountId) {
      throw new Error('Transaction must include account or accountId');
    }

    // Remove account/accountId from transaction objects as they're passed separately
    const cleanedTxs = txArray.map(tx => {
      const { account, accountId: _, ...rest } = tx as any;
      return rest;
    });

    // API docs say it returns id[], but reality is it can return "ok", array of IDs, or Transaction objects
    const result = await withConcurrency(() => retry(() => rawAddTransactions(accountId, cleanedTxs, options) as Promise<unknown>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    
    // Handle various return formats
    if (result === 'ok') {
      // Transaction created successfully but no IDs returned
      // We'll need to query the account to get the transaction IDs
      return ['ok'];  // Return success indicator
    } else if (Array.isArray(result)) {
      // Could be array of IDs (strings) or array of Transaction objects
      if (result.length === 0) return [];
      if (typeof result[0] === 'string') return result as string[];
      if (typeof result[0] === 'object' && result[0] !== null && 'id' in result[0]) {
        return result.map((t: any) => t.id);
      }
    } else if (typeof result === 'object' && result !== null && 'id' in (result as any)) {
      // Single Transaction object
      return [(result as any).id];
    }
    
    return [];
  });
}
export async function importTransactions(accountId: string | undefined, txs: components['schemas']['TransactionInput'][] | unknown) : Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>{
  observability.incrementToolCall('actual.transactions.import').catch(() => {});
  return queueWriteOperation(async () => {
    const raw = await withConcurrency(() => retry(() => rawImportTransactions(accountId, txs) as Promise<{ added?: string[]; updated?: string[]; errors?: string[] }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    return raw || { added: [], updated: [], errors: [] };
  });
}

export async function createTransfer(params: {
  from_account: string;
  to_account: string;
  amount: number;
  date: string;
  notes?: string;
}): Promise<{ success: true; from_id: string | null; to_id: string | null } | { success: false; error: string }> {
  observability.incrementToolCall('actual.transfers.create').catch(() => {});

  // ── Phase 1: validate + write ─────────────────────────────────────────────
  const writeResult = await queueWriteOperation(async (): Promise<{ success: true } | { success: false; error: string }> => {
    if (params.from_account === params.to_account) {
      return { success: false as const, error: 'from_account and to_account must be different accounts.' };
    }

    const accounts = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<components['schemas']['Account'][]>, { retries: 2, backoffMs: 200 })
    );
    const fromAcc = accounts.find((a: any) => a.id === params.from_account);
    const toAcc   = accounts.find((a: any) => a.id === params.to_account);

    if (!fromAcc) return { success: false as const, error: `Account '${params.from_account}' not found. Use actual_accounts_list to find valid accounts.` };
    if ((fromAcc as any).closed) return { success: false as const, error: `Source account '${(fromAcc as any).name}' is closed.` };
    if (!toAcc)   return { success: false as const, error: `Account '${params.to_account}' not found. Use actual_accounts_list to find valid accounts.` };
    if ((toAcc as any).closed)   return { success: false as const, error: `Destination account '${(toAcc as any).name}' is closed.` };

    const payees = await withConcurrency(() =>
      retry(() => rawGetPayees() as Promise<Array<{ id: string; transfer_acct?: string; tombstone?: boolean }>>, { retries: 2, backoffMs: 200 })
    );
    const transferPayee = payees.find((p: any) => p.transfer_acct === params.to_account && !p.tombstone);
    if (!transferPayee) {
      return { success: false as const, error: `No transfer payee found for destination account '${(toAcc as any).name}'. The account may not support transfers.` };
    }

    const sourceTx: Record<string, unknown> = {
      date: params.date,
      amount: -Math.abs(params.amount),
      payee: transferPayee.id,
      ...(params.notes !== undefined && { notes: params.notes }),
    };

    await withConcurrency(() =>
      retry(() => rawAddTransactions(params.from_account, [sourceTx], { runTransfers: true }) as Promise<unknown>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError })
    );

    return { success: true as const };
  });

  if (!writeResult.success) return writeResult;

  // ── Phase 2: read-back in a fresh session (after write has synced) ────────
  // A new withActualApi session downloads the budget from the server, which
  // reflects the synced write, guaranteeing transfer_id is fully committed.
  try {
    return await withActualApi(async () => {
      const txns = await withConcurrency(() =>
        retry(() => rawGetTransactions(params.from_account, params.date, params.date) as Promise<any[]>, { retries: 2, backoffMs: 200 })
      );
      // Find the most recently created transfer matching our amount.
      // imported_id is not synced via Actual Budget CRDT, so we sort by
      // sort_order descending and take the newest matching transfer instead.
      const tx = (txns ?? [])
        .filter((t: any) => t.amount === -Math.abs(params.amount) && t.transfer_id != null)
        .sort((a: any, b: any) => (b.sort_order ?? 0) - (a.sort_order ?? 0))[0];
      return { success: true as const, from_id: tx?.id ?? null, to_id: tx?.transfer_id ?? null };
    });
  } catch {
    // Transfer was created; IDs just can't be retrieved right now.
    return { success: true as const, from_id: null, to_id: null };
  }
}

export async function getTransactions(accountId: string | undefined, startDate?: string, endDate?: string): Promise<components['schemas']['Transaction'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.transactions.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetTransactions(accountId, startDate, endDate) as Promise<components['schemas']['Transaction'][]>, { retries: 2, backoffMs: 200 }));
  });
}

export async function getCategories(): Promise<components['schemas']['Category'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.categories.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetCategories() as Promise<components['schemas']['Category'][]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function createCategory(category: components['schemas']['Category'] | unknown): Promise<string> {
  observability.incrementToolCall('actual.categories.create').catch(() => {});
  return queueWriteOperation(async () => {
    try {
      const raw = await withConcurrency(() => retry(() => rawCreateCategory(category) as Promise<string | { id?: string }>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
      return normalizeToId(raw);
    } catch (error) {
      logger.error('[CREATE CATEGORY] Error creating category:', error);
      // Re-throw the error with proper context
      if (error instanceof Error) {
        throw error;
      }
      // Handle Actual APIError plain objects: { type: "APIError", message: "..." }
      const msg = (error as any)?.message ? String((error as any).message) : JSON.stringify(error);
      throw new Error(msg);
    }
  });
}
export async function getPayees(): Promise<components['schemas']['Payee'][]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetPayees() as Promise<components['schemas']['Payee'][]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function createPayee(payee: components['schemas']['Payee'] | unknown): Promise<string> {
  observability.incrementToolCall('actual.payees.create').catch(() => {});
  return queueWriteOperation(async () => {
    const raw = await withConcurrency(() => retry(() => rawCreatePayee(payee) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    return normalizeToId(raw);
  });
}
export async function getBudgetMonths(): Promise<string[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getMonths').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetBudgetMonths() as Promise<string[]>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getBudgetMonth(month: string | undefined): Promise<components['schemas']['BudgetMonth']> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getMonth').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetBudgetMonth(month) as Promise<components['schemas']['BudgetMonth']>, { retries: 2, backoffMs: 200 }));
  });
}
export async function setBudgetAmount(month: string | undefined, categoryId: string | undefined, amount: number | undefined): Promise<components['schemas']['BudgetSetRequest'] | null | void> {
  observability.incrementToolCall('actual.budgets.setAmount').catch(() => {});
  return queueWriteOperation(async () => {
    // Pre-flight: verify category exists — nil/unknown UUIDs silently no-op in Actual Budget
    const categories = await withConcurrency(() =>
      retry(() => rawGetCategories() as Promise<Array<{ id: string }>>, { retries: 2, backoffMs: 200 })
    );
    const exists = (categories as any[]).some((c: any) => c.id === categoryId);
    if (!exists) {
      throw new Error(
        `Category "${categoryId}" not found. Use actual_categories_get to list available categories.`
      );
    }
    const result = await withConcurrency(() => retry(() => rawSetBudgetAmount(month, categoryId, amount) as Promise<components['schemas']['BudgetSetRequest'] | null | void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    return result;
  });
}

/**
 * Atomic budget transfer between two categories within a single month.
 *
 * Reads the current budget amounts, validates source-side sufficient funds,
 * and writes both adjustments inside ONE `queueWriteOperation` cycle. This
 * is the structural fix for issue #141: the previous tool body did three
 * separate lock cycles (read + write + write) which could hang for the
 * full Playwright timeout when the upstream server's mutator queue stalled
 * between cycles.
 *
 * Both writes run inside `rawBatchBudgetUpdates` so the upstream Actual
 * Budget server treats them as one transaction, guaranteeing no partial
 * transfer is observable from the server's perspective.
 */
export interface TransferBudgetResult {
  transferred: number;
  fromCategory: { id: string; previousAmount: number; newAmount: number };
  toCategory: { id: string; previousAmount: number; newAmount: number };
}

export async function transferBudgetAmount(
  month: string,
  fromCategoryId: string,
  toCategoryId: string,
  amount: number,
): Promise<TransferBudgetResult> {
  observability.incrementToolCall('actual.budgets.transfer').catch(() => {});
  return queueWriteOperation(async () => {
    // Inside processWriteQueue we already hold _apiSessionLock and the api is
    // initialised. Call raw functions only: adapter wrappers would re-enter
    // queueWriteOperation / withActualApi and defeat the single-cycle goal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const budgetMonth: any = await rawGetBudgetMonth(month);
    if (!budgetMonth?.categoryGroups) {
      throw new Error(`Budget not found for month ${month}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats = budgetMonth.categoryGroups.flatMap((g: any) => g.categories || []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = cats.find((c: any) => c.id === fromCategoryId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const to = cats.find((c: any) => c.id === toCategoryId);
    if (!from) throw new Error(`Source category ${fromCategoryId} not found in budget`);
    if (!to) throw new Error(`Target category ${toCategoryId} not found in budget`);
    const prevFrom = from.budgeted || 0;
    const prevTo = to.budgeted || 0;
    if (prevFrom < amount) {
      throw new Error(`Insufficient budget in source category. Available: ${prevFrom}, Requested: ${amount}`);
    }

    await rawBatchBudgetUpdates(async () => {
      await rawSetBudgetAmount(month, fromCategoryId, prevFrom - amount);
      await rawSetBudgetAmount(month, toCategoryId, prevTo + amount);
    });

    return {
      transferred: amount,
      fromCategory: { id: fromCategoryId, previousAmount: prevFrom, newAmount: prevFrom - amount },
      toCategory: { id: toCategoryId, previousAmount: prevTo, newAmount: prevTo + amount },
    };
  });
}

export async function createAccount(account: components['schemas']['Account'] | unknown, initialBalance?: number): Promise<string> {
  observability.incrementToolCall('actual.accounts.create').catch(() => {});
  return queueWriteOperation(async () => {
    const raw = await withConcurrency(() => retry(() => rawCreateAccount(account, initialBalance) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    const id = normalizeToId(raw);
    // NO NEED for syncToServer() - shutdown() will handle persistence
    return id;
  });
}
export async function updateAccount(id: string, fields: Partial<components['schemas']['Account']> | unknown): Promise<void | null> {
  observability.incrementToolCall('actual.accounts.update').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawUpdateAccount(id, fields) as Promise<void | null>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    return null;
  });
}
export async function getAccountBalance(id: string, cutoff?: string): Promise<number> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.get.balance').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetAccountBalance(id, cutoff) as Promise<number>, { retries: 2, backoffMs: 200 }));
  });
}

/**
 * Fetch all accounts with their current balances in a single API session.
 * Using a single withActualApi session avoids N separate init/shutdown cycles
 * that would occur if you called getAccountBalance() once per account.
 */
export async function getAccountsWithBalances(): Promise<(components['schemas']['Account'] & { balance_current: number | null })[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.accounts.list').catch(() => {});
    const accounts = await withConcurrency(() => retry(() => rawGetAccounts() as Promise<components['schemas']['Account'][]>, { retries: 2, backoffMs: 200 }));
    const result: (components['schemas']['Account'] & { balance_current: number | null })[] = [];
    for (const account of accounts) {
      try {
        const balance = await rawGetAccountBalance(account.id as string);
        result.push({ ...account, balance_current: balance as number });
      } catch {
        result.push({ ...account, balance_current: null });
      }
    }
    return result;
  });
}
export async function deleteAccount(id: string): Promise<void> {
  observability.incrementToolCall('actual.accounts.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // Non-idempotent: do not retry (#165).
    await withConcurrency(() => retry(() => rawDeleteAccount(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function updateTransaction(id: string, fields: Partial<components['schemas']['Transaction']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.transactions.update').catch(() => {});
  // Use write queue to batch concurrent updates in a single budget session
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawUpdateTransaction(id, fields) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
export async function updateTransactionBatch(
  updates: Array<{ id: string; fields: Partial<components['schemas']['Transaction']> | unknown }>
): Promise<{ succeeded: { id: string }[]; failed: { id: string; error: string }[] }> {
  observability.incrementToolCall('actual.transactions.updateBatch').catch(() => {});
  // All updates share one queueWriteOperation → one init/sync/shutdown cycle (issue #79).
  // Sequential loop (not Promise.all) is intentional: concurrent rawUpdateTransaction calls
  // within one session can interleave withMutation CRDT messages unpredictably.
  return queueWriteOperation(async () => {
    const succeeded: { id: string }[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const { id, fields } of updates) {
      try {
        await withConcurrency(() =>
          retry(() => rawUpdateTransaction(id, fields) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError })
        );
        succeeded.push({ id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ id, error: message });
      }
    }
    return { succeeded, failed };
  });
}
export async function deleteTransaction(id: string): Promise<void> {
  observability.incrementToolCall('actual.transactions.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // Non-idempotent: do not retry (#165). A retry after a lost-response would
    // re-issue the delete against an already-removed record and surface a
    // confusing "not found" even though the first attempt succeeded.
    await withConcurrency(() => retry(() => rawDeleteTransaction(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function updateCategory(id: string, fields: Partial<components['schemas']['Category']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.categories.update').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawUpdateCategory(id, fields) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
export async function deleteCategory(id: string): Promise<void> {
  observability.incrementToolCall('actual.categories.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // Pre-flight: verify category exists to avoid ECONNRESET on missing id (BUG-1)
    const categories = await withConcurrency(() =>
      retry(() => rawGetCategories() as Promise<Array<{ id: string }>>, { retries: 2, backoffMs: 200 })
    );
    const exists = (categories as any[]).some((c: any) => c.id === id);
    if (!exists) {
      throw new Error(
        `Category "${id}" not found. Use actual_categories_get to list available categories.`
      );
    }
    await withConcurrency(() =>
      retry(() => rawDeleteCategory(id) as Promise<void>, { retries: 0, backoffMs: 200 })
    );
  });
}
export async function updatePayee(id: string, fields: Partial<components['schemas']['Payee']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.payees.update').catch(() => {});
  return queueWriteOperation(async () => {
    const fieldsObj = fields as Record<string, unknown>;

    // Extract `category` — it is NOT a direct column on the payees table in Actual Budget.
    // The "default category" feature is implemented via rules (condition: payee is X → action: set category).
    // Passing `category` to rawUpdatePayee would cause: "Field 'category' does not exist on table payees".
    let categoryValue: string | null | undefined = undefined; // undefined = not provided
    let directFields: Record<string, unknown> = fieldsObj;
    if ('category' in fieldsObj) {
      categoryValue = fieldsObj.category as string | null;
      const { category: _stripped, ...rest } = fieldsObj;
      directFields = rest;
    }

    // Update the payee's direct fields (name, transfer_acct, etc.)
    if (Object.keys(directFields).length > 0) {
      await withConcurrency(() => retry(() => rawUpdatePayee(id, directFields) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    }

    // Handle category via the rules mechanism (same approach Actual Budget uses internally)
    if (categoryValue !== undefined) {
      const existingRules = await withConcurrency(() =>
        retry(() => rawGetPayeeRules(id) as Promise<unknown[]>, { retries: 2, backoffMs: 200 })
      );

      // Find an existing "set category" action rule for this payee
      const setCategoryRule = (existingRules as any[]).find((rule: any) =>
        Array.isArray(rule.actions) &&
        rule.actions.some((a: any) => a.op === 'set' && a.field === 'category')
      );

      if (setCategoryRule) {
        if (categoryValue === null) {
          // null = clear the default category — delete the rule
          await withConcurrency(() => retry(() => rawDeleteRule(setCategoryRule.id) as Promise<void>, { retries: 0, backoffMs: 200 }));
          logger.debug(`[UPDATE PAYEE] Cleared default category rule for payee ${id}`);
        } else {
          // Update existing rule's category action value
          const updatedRule = {
            ...setCategoryRule,
            actions: setCategoryRule.actions.map((a: any) =>
              a.op === 'set' && a.field === 'category' ? { ...a, value: categoryValue } : a
            ),
          };
          await withConcurrency(() => retry(() => rawUpdateRule(updatedRule) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
          logger.debug(`[UPDATE PAYEE] Updated default category rule for payee ${id} to category ${categoryValue}`);
        }
      } else if (categoryValue !== null) {
        // Create a new "set category" rule for this payee
        const newRule = {
          stage: null,
          conditionsOp: 'and',
          conditions: [{ op: 'is', field: 'payee', value: id }],
          actions: [{ op: 'set', field: 'category', value: categoryValue }],
        };
        await withConcurrency(() => retry(() => rawCreateRule(newRule) as Promise<unknown>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
        logger.debug(`[UPDATE PAYEE] Created default category rule for payee ${id} with category ${categoryValue}`);
      }
      // category=null + no existing rule = no-op (already clear)
    }
  });
}
export async function deletePayee(id: string): Promise<void> {
  observability.incrementToolCall('actual.payees.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // Pre-flight: verify payee exists to avoid ECONNRESET on missing id (BUG-2)
    const payees = await withConcurrency(() =>
      retry(() => rawGetPayees() as Promise<Array<{ id: string }>>, { retries: 2, backoffMs: 200 })
    );
    const exists = (payees as any[]).some((p: any) => p.id === id);
    if (!exists) {
      throw new Error(
        `Payee "${id}" not found. Use actual_payees_get to list available payees.`
      );
    }
    await withConcurrency(() =>
      retry(() => rawDeletePayee(id) as Promise<void>, { retries: 0, backoffMs: 200 })
    );
  });
}
export async function getRules(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.rules.get').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetRules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function createRule(rule: unknown): Promise<string> {
  observability.incrementToolCall('actual.rules.create').catch(() => {});
  return queueWriteOperation(async () => {
    const raw = await withConcurrency(() => retry(() => rawCreateRule(rule) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function updateRule(id: string, fields: unknown): Promise<void> {
  observability.incrementToolCall('actual.rules.update').catch(() => {});
  return queueWriteOperation(async () => {
    // The Actual Budget API validation requires conditions and actions arrays to exist
    // We must fetch the existing rule and merge with the update fields
    const rules = await withConcurrency(() => retry(() => rawGetRules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    const existingRule = (rules as any[]).find((r: any) => r.id === id);
    
    if (!existingRule) {
      throw new Error(`Rule with id ${id} not found`);
    }
    
    const fieldsObj = fields as any;
    const rule: any = {
      id,
      stage: fieldsObj.stage ?? existingRule.stage,
      conditionsOp: fieldsObj.conditionsOp ?? existingRule.conditionsOp,
      conditions: fieldsObj.conditions ?? existingRule.conditions ?? [],
      actions: fieldsObj.actions ?? existingRule.actions ?? [],
    };
    
    logger.debug(`[UPDATE RULE] Updating rule ${id} with merged fields: ${JSON.stringify(rule)}`);
    
    await withConcurrency(() => retry(() => rawUpdateRule(rule) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
    logger.debug(`[UPDATE RULE] Update completed for rule ${id}`);
  });
}
export async function deleteRule(id: string): Promise<void> {
  observability.incrementToolCall('actual.rules.delete').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawDeleteRule(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function getSchedules(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.schedules.get').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetSchedules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function createSchedule(schedule: unknown): Promise<string> {
  observability.incrementToolCall('actual.schedules.create').catch(() => {});
  return queueWriteOperation(async () => {
    // Note: rawCreateSchedule(schedule) passes the external schedule object directly.
    // Do NOT wrap in { schedule: ... } — that would double-nest and break date parsing.
    const raw = await withConcurrency(() => retry(() => rawCreateSchedule(schedule as Record<string, unknown>) as Promise<string>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function updateSchedule(id: string, fields: unknown, resetNextDate?: boolean): Promise<void> {
  observability.incrementToolCall('actual.schedules.update').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawUpdateSchedule(id, fields as Record<string, unknown>, resetNextDate) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
export async function deleteSchedule(id: string): Promise<void> {
  observability.incrementToolCall('actual.schedules.delete').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawDeleteSchedule(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
  observability.incrementToolCall('actual.budgets.setCarryover').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawSetBudgetCarryover(month, categoryId, flag) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
export async function closeAccount(id: string): Promise<void> {
  observability.incrementToolCall('actual.accounts.close').catch(() => {});
  return queueWriteOperation(async () => {
    // Non-idempotent: do not retry (#165).
    await withConcurrency(() => retry(() => rawCloseAccount(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function reopenAccount(id: string): Promise<void> {
  observability.incrementToolCall('actual.accounts.reopen').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawReopenAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function getCategoryGroups(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.category_groups.get').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetCategoryGroups() as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}
export async function createCategoryGroup(group: unknown): Promise<string> {
  observability.incrementToolCall('actual.category_groups.create').catch(() => {});
  return queueWriteOperation(async () => {
    const raw = await withConcurrency(() => retry(() => rawCreateCategoryGroup(group) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    const id = normalizeToId(raw);
    return id;
  });
}
export async function updateCategoryGroup(id: string, fields: unknown): Promise<void> {
  observability.incrementToolCall('actual.category_groups.update').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawUpdateCategoryGroup(id, fields) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
export async function deleteCategoryGroup(id: string): Promise<void> {
  observability.incrementToolCall('actual.category_groups.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // Non-idempotent: do not retry (#165).
    await withConcurrency(() => retry(() => rawDeleteCategoryGroup(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function mergePayees(targetId: string, mergeIds: string[]): Promise<void> {
  observability.incrementToolCall('actual.payees.merge').catch(() => {});
  return queueWriteOperation(async () => {
    // Non-idempotent: do not retry (#165). A second merge against an
    // already-removed source payee can corrupt merge state or mislead.
    await withConcurrency(() => retry(() => rawMergePayees(targetId, mergeIds) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function getPayeeRules(payeeId: string): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.getPayeeRules').catch(() => {});
    const allRules = await withConcurrency(() => retry(() => rawGetPayeeRules(payeeId) as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    if (!Array.isArray(allRules)) return [];
    // API ignores payeeId filter — apply post-filter (BUG-3)
    return allRules.filter((r: any) => r?.payee_id === payeeId);
  });
}
export async function batchBudgetUpdates(fn: () => Promise<void>): Promise<void> {
  observability.incrementToolCall('actual.budgets.batchUpdates').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawBatchBudgetUpdates(fn) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function holdBudgetForNextMonth(month: string, amount: number): Promise<void> {
  observability.incrementToolCall('actual.budgets.holdForNextMonth').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawHoldBudgetForNextMonth(month, amount) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function resetBudgetHold(month: string): Promise<void> {
  observability.incrementToolCall('actual.budgets.resetHold').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawResetBudgetHold(month) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
export async function runQuery(queryString: string | any): Promise<unknown> {
  try {
    return await withActualApi(async () => {
      observability.incrementToolCall('actual.query.run').catch(() => {});
      
      try {
        // Import validation utilities
        const { validateQuery, formatValidationErrors } = await import('./query-validator.js');
        
        // The Actual Budget runQuery expects an ActualQL query object with serialize() method
        // Import the q builder dynamically
        const api = await import('@actual-app/api');
        const q = (api as any).q;
      
      if (!q) {
        throw new Error('ActualQL query builder not available. Ensure @actual-app/api is properly installed and the budget is loaded.');
      }
      
      // If already a serialized query object, use it directly
      if (typeof queryString === 'object' && queryString !== null) {
        try {
          return await withConcurrency(async () => {
            try {
              return await rawRunQuery(queryString) as Promise<unknown>;
            } catch (err: any) {
              // Catch errors from the query execution to prevent unhandled rejections
              const msg = err?.message || String(err);
              logger.error(`[ADAPTER] Query execution error: ${msg}`);
              if (msg.includes('does not exist in table') || msg.includes('Field') || msg.includes('does not exist')) {
                throw new Error(`Invalid field in query: ${msg}`);
              }
              throw err;
            }
          });
        } catch (error: any) {
          throw new Error(`Query execution failed: ${error.message}`);
        }
      }
    
    const trimmed = queryString.trim();
    let query;
    
    // Check for GraphQL-like query syntax: query Name { table(...) { fields } }
    const graphqlMatch = trimmed.match(/^query\s+\w+\s*\{\s*(\w+)\s*\(([^)]*)\)\s*\{([^}]+)\}\s*\}$/is);
    
    if (graphqlMatch) {
      const [, tableName, argsStr, fieldsStr] = graphqlMatch;
      query = q(tableName);
      
      // Parse arguments (e.g., startDate: "2025-06-01", endDate: "2025-11-30")
      if (argsStr.trim()) {
        const args = argsStr.split(',').map((a: string) => a.trim());
        for (const arg of args) {
          const argMatch = arg.match(/^(\w+):\s*"([^"]+)"$/);
          if (argMatch) {
            const [, key, value] = argMatch;
            // Map GraphQL args to ActualQL filters
            if (key === 'startDate') {
              query = query.filter({ date: { $gte: value } });
            } else if (key === 'endDate') {
              query = query.filter({ date: { $lte: value } });
            } else {
              // Generic filter for other args
              query = query.filter({ [key]: value });
            }
          }
        }
      }
      
      // Parse fields (including nested objects like account { id name })
      const fieldNames = [];
      const nestedFieldPattern = /(\w+)\s*\{[^}]+\}/g;
      const simpleFields = fieldsStr.replace(nestedFieldPattern, '').split(/\s+/).filter((f: string) => f.trim());
      fieldNames.push(...simpleFields.map((f: string) => f.trim()));
      
      // Extract nested field names (e.g., account, payee, category)
      let nestedMatch;
      while ((nestedMatch = nestedFieldPattern.exec(fieldsStr)) !== null) {
        fieldNames.push(nestedMatch[1]);
      }
      
      if (fieldNames.length > 0) {
        query = query.select(fieldNames);
      }
    } else {
      // Enhanced SQL-like parsing supporting WHERE, ORDER BY, and LIMIT
      // Pattern: SELECT [fields] FROM table [WHERE conditions] [ORDER BY field ASC|DESC] [LIMIT n]
      const sqlMatch = trimmed.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/is);
      
      if (sqlMatch) {
        const [, fields, tableName, whereClause, orderField, orderDir, limitStr] = sqlMatch;
        
        // ✅ VALIDATE QUERY BEFORE EXECUTION
        const validation = validateQuery(trimmed);
        if (!validation.valid) {
          const errorMsg = formatValidationErrors(validation);
          throw new Error(`Invalid SQL query:\n${errorMsg}\n\nQuery: "${trimmed}"`);
        }
        
        query = q(tableName);
        
        // Apply SELECT fields (if not *)
        if (fields.trim() !== '*') {
          // Strip SQL aliases (AS alias_name) since ActualQL doesn't support them
          const fieldList = fields.split(',').map((f: string) => {
            const field = f.trim();
            // Remove "AS alias" part if present (case-insensitive)
            return field.replace(/\s+AS\s+\w+$/i, '').trim();
          });
          query = query.select(fieldList);
        }
        
        // Apply WHERE conditions
        if (whereClause) {
          query = parseWhereClause(query, whereClause);
        }
        
        // Apply ORDER BY
        if (orderField) {
          query = query.orderBy({ [orderField]: orderDir?.toUpperCase() === 'DESC' ? 'desc' : 'asc' });
        }
        
        // Apply LIMIT
        if (limitStr) {
          query = query.limit(parseInt(limitStr));
        }
      } else {
        // Assume it's just a table name
        query = q(trimmed);
      }
    }
    
    try {
      return await withConcurrency(async () => {
        try {
          return await rawRunQuery(query) as Promise<unknown>;
        } catch (err: any) {
          // Catch errors from the query execution to prevent unhandled rejections
          const msg = err?.message || String(err);
          logger.error(`[ADAPTER] Query execution error: ${msg}`);
          if (msg.includes('does not exist in table') || msg.includes('Field') || msg.includes('does not exist')) {
            throw new Error(`Invalid field in query: ${msg}`);
          }
          throw err;
        }
      });
    } catch (error: any) {
      // Enhance error messages with helpful context
      const errorMsg = error?.message || String(error);
      
      // If the error already contains formatted validation errors (with suggestions), preserve them
      if (errorMsg.includes('Invalid SQL query:') && (errorMsg.includes('Available fields:') || errorMsg.includes('Available tables:'))) {
        throw error; // Re-throw the well-formatted validation error as-is
      }
      
      if (errorMsg.includes('does not exist in the schema') || errorMsg.includes('Invalid field in query') || errorMsg.includes('does not exist in table')) {
        throw new Error(`Table or field does not exist. Query: "${trimmed}". Available tables: transactions, accounts, categories, payees, category_groups, schedules, rules. Use dot notation for joins (e.g., payee.name, category.name). Original error: ${errorMsg}`);
      }
      
      // Re-throw with original error if no specific handling
      throw error;
    }
    } catch (error: any) {
      // Outer catch for query parsing errors
      const errorMsg = error?.message || String(error);
      
      if (errorMsg.includes('tableName') || errorMsg.includes('expandStar') || errorMsg.includes('Cannot read properties of undefined')) {
        throw new Error(`SQL query parsing failed. The Actual Budget query engine has limitations with complex SQL features like COUNT(*), SUM(), GROUP BY, and aggregate functions. Try using simpler queries or ActualQL format instead. See https://actualbudget.org/docs/api/actual-ql/ for supported syntax. Error: ${errorMsg}`);
      }
      
      throw error;
    }
  });
  } catch (error: any) {
    // Top-level catch to ensure no unhandled rejections escape
    const errorMsg = error?.message || String(error);
    logger.error(`[ADAPTER] Query execution failed: ${errorMsg}`);
    
    // If the error already contains formatted validation errors with suggestions, preserve them
    if (errorMsg.includes('Invalid SQL query:') && (errorMsg.includes('Available fields:') || errorMsg.includes('Available tables:'))) {
      throw error; // Re-throw the well-formatted validation error without wrapping
    }
    
    throw new Error(`Query execution failed: ${errorMsg}`);
  }
}

// Helper function to parse WHERE clause conditions.
// Exported so it can be unit-tested directly.
// Strip a single pair of surrounding quotes from a SQL value literal.
function _stripWhereQuotes(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

// Coerce a SQL value literal to a number when it looks numeric, else keep the
// (unquoted) string. Used for IN lists and comparison operands. Empty stays a
// string so an empty literal is not silently turned into 0.
function _coerceWhereValue(s: string): string | number {
  const v = _stripWhereQuotes(s);
  if (v === '') return v;
  const n = Number(v);
  return isNaN(n) ? v : n;
}

export function parseWhereClause(query: any, whereClause: string): any {
  // OR is not supported. Detect it up front and fail loudly. Without this guard
  // a clause like `amount = 100 OR amount < 0` is left as a single fragment by
  // the AND-splitter, and the comparison regex's greedy value capture swallows
  // `100 OR amount < 0` into the operand, running a silently-wrong filter rather
  // than erroring. That silent mishandling is exactly what #178 set out to stop.
  // This shares the AND-splitter's quote-naive simplicity: an " OR " inside a
  // quoted value is a known limitation, the same as " AND ".
  if (/\sOR\s/i.test(whereClause)) {
    throw new Error(
      `Unsupported WHERE condition: OR is not supported. ` +
      `Supported operators: =, !=, >, >=, <, <=, IN (...), LIKE, NOT LIKE, IS NULL, IS NOT NULL. ` +
      `Combine conditions with AND only.`,
    );
  }

  // Split by AND. This is a simple parser: it does not handle OR or nested /
  // parenthesised conditions (see the unsupported-operator throw below).
  const conditions = whereClause.split(/\s+AND\s+/i);

  for (const condition of conditions) {
    const trimmedCondition = condition.trim();
    if (!trimmedCondition) continue;

    // IS NULL / IS NOT NULL: lets callers find unmerged rows (e.g. imported_payee
    // IS NULL). ActualQL treats `field: null` as IS NULL and `$ne: null` as IS NOT NULL.
    const nullMatch = trimmedCondition.match(/^([\w.]+)\s+IS\s+(NOT\s+)?NULL$/i);
    if (nullMatch) {
      const [, field, not] = nullMatch;
      query = not
        ? query.filter({ [field]: { $ne: null } })
        : query.filter({ [field]: null });
      continue;
    }

    // NOT LIKE (checked before LIKE so the longer keyword wins).
    const notLikeMatch = trimmedCondition.match(/^([\w.]+)\s+NOT\s+LIKE\s+(.+)$/i);
    if (notLikeMatch) {
      const [, field, valueStr] = notLikeMatch;
      query = query.filter({ [field]: { $notlike: _stripWhereQuotes(valueStr) } });
      continue;
    }

    // LIKE: pattern match. ActualQL's $like runs through NORMALISE + UNICODE_LIKE,
    // so it is case-insensitive and accent-insensitive. Use % as the wildcard,
    // e.g. imported_payee LIKE '%amazon%'.
    const likeMatch = trimmedCondition.match(/^([\w.]+)\s+LIKE\s+(.+)$/i);
    if (likeMatch) {
      const [, field, valueStr] = likeMatch;
      query = query.filter({ [field]: { $like: _stripWhereQuotes(valueStr) } });
      continue;
    }

    // IN clause: field IN (value1, value2, ...)
    // [\w.]+ matches both simple fields (amount) and joined fields (category.name)
    const inMatch = trimmedCondition.match(/^([\w.]+)\s+IN\s+\((.+)\)$/i);
    if (inMatch) {
      const [, field, valuesStr] = inMatch;
      const values = valuesStr.split(',').map(_coerceWhereValue);
      query = query.filter({ [field]: { $oneof: values } });
      continue;
    }

    // Comparison operators: field >= value, field = value, etc.
    // [\w.]+ matches both simple fields (amount) and joined fields (category.name, payee.name)
    const compMatch = trimmedCondition.match(/^([\w.]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
    if (compMatch) {
      const [, field, operator, valueStr] = compMatch;
      const operatorMap: { [key: string]: string } = {
        '>=': '$gte',
        '<=': '$lte',
        '>': '$gt',
        '<': '$lt',
        '=': '$eq',
        '!=': '$ne',
      };
      const actualOp = operatorMap[operator];
      const finalValue = _coerceWhereValue(valueStr);
      if (actualOp === '$eq') {
        // Simple equality can use the direct field: value shorthand.
        query = query.filter({ [field]: finalValue });
      } else {
        query = query.filter({ [field]: { [actualOp]: finalValue } });
      }
      continue;
    }

    // Nothing matched. Refuse to silently drop the condition: dropping it would
    // run the query UNFILTERED and hand back misleading "matches everything"
    // results. Fail loudly with an actionable error instead. See #178.
    throw new Error(
      `Unsupported WHERE condition: "${trimmedCondition}". ` +
      `Supported operators: =, !=, >, >=, <, <=, IN (...), LIKE, NOT LIKE, IS NULL, IS NOT NULL. ` +
      `OR, REGEXP, NOT IN, and parenthesised groups are not yet supported.`,
    );
  }

  return query;
}
export async function runBankSync(accountId?: string): Promise<void> {
  try {
    return await withActualApi(async () => {
      observability.incrementToolCall('actual.bank.sync').catch(() => {});
      // Bank sync must NOT be retried — retrying could import duplicate transactions.
      // Pass { accountId } for a specific account, or {} to sync all linked accounts.
      const args = accountId != null ? { accountId } : {};

      // Pre-check: verify bank-linked accounts exist before calling rawRunBankSync.
      // The SDK silently resolves void for local accounts (account_sync_source: null),
      // which would otherwise be misreported as success and cause an unnecessary 30s wait.
      if (accountId != null) {
        // Per-account check: verify the specified account is bank-linked.
        const { data: acctRows } = await rawRunQuery(
          (api as any).q('accounts')
            .select(['account_sync_source', 'name'])
            .filter({ id: accountId, tombstone: false })
        ) as { data: Array<{ account_sync_source: string | null; name: string }> };

        const acct = acctRows?.[0];
        if (!acct) {
          throw new Error(`Bank sync failed: Account not found (id: ${accountId})`);
        }
        if (!acct.account_sync_source) {
          throw new Error(
            `Bank sync failed: Account "${acct.name}" is a local account — not configured for bank sync. ` +
            `To use bank sync, link your account with a supported provider (GoCardless or SimpleFIN) in the Actual Budget UI. ` +
            `See https://actualbudget.org/docs/advanced/bank-sync for setup instructions.`
          );
        }
      } else {
        // Global check: verify at least one bank-linked account exists across the budget.
        const { data: allAccounts } = await rawRunQuery(
          (api as any).q('accounts')
            .select(['account_sync_source'])
            .filter({ tombstone: false })
        ) as { data: Array<{ account_sync_source: string | null }> };

        const linkedCount = allAccounts?.filter(a => a.account_sync_source).length ?? 0;
        if (linkedCount === 0) {
          throw new Error(
            `Bank sync failed: No accounts are configured for bank sync. ` +
            `To use bank sync, link your account(s) with a supported provider (GoCardless or SimpleFIN) in the Actual Budget UI. ` +
            `See https://actualbudget.org/docs/advanced/bank-sync for setup instructions.`
          );
        }
      }

      // rawRunBankSync returns void immediately; the actual provider call runs on
      // a background promise inside the SDK and surfaces errors as unhandledRejection.
      // We install a temporary listener to capture any BankSyncError and re-throw.
      let capturedRejection: any = null;
      const rejectionHandler = (reason: any) => {
        const msg: string = reason?.message || String(reason);
        if (
          reason?.type === 'BankSyncError' ||
          msg.includes('BankSyncError') ||
          msg.includes('NORDIGEN_ERROR') ||
          msg.includes('Rate limit exceeded') ||
          msg.includes('Failed syncing account') ||
          msg.includes('GoCardless') ||
          msg.includes('SimpleFIN')
        ) {
          capturedRejection = reason;
        }
      };
      process.on('unhandledRejection', rejectionHandler);
      try {
        await rawRunBankSync(args) as unknown as void;
        // Wait for the SDK's background promise to resolve/reject.
        // Provider errors (rate limits, auth failures) arrive in < 3s in practice;
        // BANK_SYNC_SETTLE_MS gives a comfortable margin to catch them.
        await new Promise(resolve => setTimeout(resolve, BANK_SYNC_SETTLE_MS));
        if (capturedRejection !== null) throw capturedRejection;
      } finally {
        process.off('unhandledRejection', rejectionHandler);
      }
    });
  } catch (error: any) {
    const errorMsg = error?.message || String(error);

    // Network / connectivity errors (includes "fetch failed" from Node.js native fetch)
    if (
      errorMsg.includes('fetch failed') ||
      errorMsg.includes('network-failure') ||
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('ENOTFOUND') ||
      errorMsg.includes('Authentication failed')
    ) {
      throw new Error(
        `Bank sync failed: Cannot connect to Actual Budget server. ` +
        `Check that ACTUAL_SERVER_URL is reachable from the MCP server container. (${errorMsg})`
      );
    }

    // Account not configured for bank sync
    if (
      errorMsg.includes('No bank account') ||
      errorMsg.includes('not configured') ||
      errorMsg.includes('not linked') ||
      !errorMsg ||
      errorMsg === '{}'
    ) {
      throw new Error(
        `Bank sync failed: The ${accountId ? 'specified account is' : 'accounts are'} not configured for bank sync. ` +
        `To use bank sync, you must first link your account(s) with a supported provider (GoCardless or SimpleFIN) in the Actual Budget UI. ` +
        `See https://actualbudget.org/docs/advanced/bank-sync for setup instructions.`
      );
    }

    // GoCardless / SimpleFIN provider-level errors
    // BankSyncError objects (from @actual-app/api) may have { type, category, code, message }
    const bankSyncCategory = (error as any)?.category || '';
    if (
      errorMsg.includes('Rate limit exceeded') ||
      errorMsg.includes('RATE_LIMIT_EXCEEDED') ||
      bankSyncCategory === 'RATE_LIMIT_EXCEEDED'
    ) {
      const reset = (error as any)?.details?.rateLimitHeaders?.http_x_ratelimit_account_success_reset;
      const retryIn = reset ? ` Retry in ~${Math.ceil(Number(reset) / 60)} minute(s).` : '';
      throw new Error(
        `Bank sync failed: GoCardless rate limit exceeded for this account.${retryIn} ` +
        `(NORDIGEN RATE_LIMIT_EXCEEDED — account success quota exhausted)`
      );
    }
    if (
      (error as any)?.type === 'BankSyncError' ||
      errorMsg.includes('BankSyncError') ||
      errorMsg.includes('NORDIGEN_ERROR') ||
      errorMsg.includes('Failed syncing account')
    ) {
      throw new Error(`Bank sync failed: Provider error — ${errorMsg}`);
    }

    throw new Error(`Bank sync failed: ${errorMsg}`);
  }
}
export async function getBudgets(): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.getAll').catch(() => {});
    const raw = await withConcurrency(() => retry(() => rawGetBudgets() as Promise<unknown>, { retries: 2, backoffMs: 200 }));
    return Array.isArray(raw) ? raw : [];
  });
}

/**
 * Switch the active budget by name (case-insensitive, EXACT match only).
 * The budget must be pre-configured via BUDGET_n_NAME env vars.
 *
 * Issue #156:
 *   * Per-session: writes to the per-session map keyed by current sessionId.
 *     Stdio / non-session callers fall back to the env-default budget and
 *     cannot switch (returns an error).
 *   * ACL: refuses when the target budget's syncId is not in this session's
 *     allowedBudgets.
 *   * Exact match only (substring matching removed: it was a sharp edge that
 *     allowed an LLM prompt-injection to walk the registry).
 *   * Pool release: BEFORE mutating the session map, releases the existing
 *     pool entry bound to the previous syncId. The next withActualApi call
 *     materialises a fresh pool entry against the new budget. Without this,
 *     the stale pool entry would serve the new request against the old
 *     upstream.
 */
export async function switchBudget(name: string): Promise<{ name: string; syncId: string; serverUrl: string }> {
  const store = requestContext.getStore();
  const sessionId = store?.sessionId;
  const allowedBudgets = store?.allowedBudgets;

  // Stdio / no-session callers: per-session map has no slot for them, so the
  // switch would have no effect. Refuse explicitly rather than silently no-op.
  if (!sessionId) {
    throw new Error(
      'Budget switch requires an MCP session. Stdio/local callers operate on the env-default budget; ' +
        'configure ACTUAL_BUDGET_SYNC_ID (or the BUDGET_n_* variants) to select a different default.',
    );
  }

  const key = name.toLowerCase();
  const found: BudgetConfig | undefined = budgetRegistry.get(key);
  if (!found) {
    const available = [...budgetRegistry.values()].map(b => `"${b.name}"`).join(', ');
    throw new Error(
      `Budget "${name}" not found in configuration. ` +
      `Available budgets: ${available}. ` +
      `Add BUDGET_n_NAME/SYNC_ID/SERVER_URL vars to configure additional budgets.`,
    );
  }

  // ACL enforcement: the target budget must be in this session's allowedBudgets.
  // OIDC mode: explicit ACL required. Non-OIDC: short-circuit allow (single-user).
  if (config.AUTH_PROVIDER === 'oidc') {
    if (!allowedBudgets) {
      logger.warn(
        JSON.stringify({
          event: 'acl_denied',
          reason: 'no_allowed_budgets_in_context',
          attemptedBudget: found.syncId,
          sessionId,
          tool: 'actual_budgets_switch',
        }),
      );
      throw new Error(
        `Budget ACL: cannot switch to "${found.name}". No allowedBudgets in request context.`,
      );
    }
    if (!allowedBudgets.includes('*') && !allowedBudgets.includes(found.syncId)) {
      logger.warn(
        JSON.stringify({
          event: 'acl_denied',
          attemptedBudget: found.syncId,
          allowedBudgets,
          sessionId,
          tool: 'actual_budgets_switch',
        }),
      );
      throw new Error(
        `Budget ACL: budget "${found.name}" (${found.syncId}) is not in this session's allowedBudgets.`,
      );
    }
  }

  // Fast path (#172): if the current pool entry's auth descriptor matches the
  // target budget's (same serverUrl + password + encryptionPassword), skip
  // release + re-auth. Just download the new budget file on the already-
  // authenticated api singleton. Eliminates the upstream login burst when
  // switching between budgets hosted on the same Actual server.
  const currentEntry = connectionPool.getConnectionInfo(sessionId);
  const sameAuth =
    !!currentEntry &&
    currentEntry.serverUrl === found.serverUrl &&
    currentEntry.password === (found.password || '') &&
    (currentEntry.encryptionPassword ?? '') === (found.encryptionPassword ?? '');

  if (sameAuth && currentEntry!.syncId === found.syncId) {
    // No-op: already on this exact budget. Keep session map consistent and return.
    sessionBudgetState.set(sessionId, key);
    logger.info(
      `[ADAPTER] switchBudget no-op for session ${sessionId}: already on "${found.name}" (${found.syncId})`,
    );
    return { name: found.name, syncId: found.syncId, serverUrl: found.serverUrl };
  }

  if (sameAuth) {
    // Same server + creds, different syncId. Reload budget file in place.
    logger.info(
      `[ADAPTER] switchBudget fast path for session ${sessionId}: ` +
        `same server, reloading budget "${found.name}" (${found.syncId})`,
    );
    if (_skipApiInitForTests) {
      // Skip the real downloadBudget call in tests; tests verify the fast
      // path was taken by spying on connectionPool.shutdownConnection.
    } else {
      await withApiLock(async () => {
        if (found.encryptionPassword) {
          const apiWithOptions = api as typeof api & {
            downloadBudget: (id: string, options?: { password: string }) => Promise<void>;
          };
          await apiWithOptions.downloadBudget(found.syncId, { password: found.encryptionPassword });
        } else {
          await api.downloadBudget(found.syncId);
        }
      });
    }
    connectionPool.updateLoadedSyncId(sessionId, found.syncId);
    sessionBudgetState.set(sessionId, key);
    logger.info(
      `[ADAPTER] Active budget switched for session ${sessionId} to: "${found.name}" (${found.syncId}) on ${found.serverUrl}`,
    );
    return { name: found.name, syncId: found.syncId, serverUrl: found.serverUrl };
  }

  // Slow path: different server or credentials. Release the existing pool
  // entry (bound to the previous syncId / server) BEFORE mutating the session
  // map. Swallow shutdown errors: a stale or missing pool entry is benign.
  try {
    await connectionPool.shutdownConnection(sessionId);
  } catch (e) {
    logger.debug(`[ADAPTER] switchBudget: shutdownConnection raised (likely no prior entry): ${e}`);
  }

  // Update the per-session active-budget slot. Subsequent getActiveBudgetConfig
  // calls for this session now return the new budget.
  sessionBudgetState.set(sessionId, key);

  // Materialise a fresh pool entry bound to the new budget. Without this, the
  // next withActualApi call would find no pool entry and fall back to the
  // legacy init+shutdown path. Failure here is logged but not fatal: the
  // legacy fallback still works, just less efficiently.
  if (_skipApiInitForTests) {
    setApiInitialized(true);
  } else {
    try {
      await connectionPool.getConnection(sessionId, {
        serverUrl: found.serverUrl,
        password: found.password || '',
        syncId: found.syncId,
        encryptionPassword: found.encryptionPassword,
      });
    } catch (poolErr) {
      logger.warn(
        `[ADAPTER] switchBudget: failed to materialise new pool entry for session ${sessionId}: ${poolErr}. ` +
          'Subsequent calls will use the legacy init+shutdown fallback.',
      );
    }
  }

  logger.info(
    `[ADAPTER] Active budget switched for session ${sessionId} to: "${found.name}" (${found.syncId}) on ${found.serverUrl}`,
  );
  return { name: found.name, syncId: found.syncId, serverUrl: found.serverUrl };
}

/**
 * Clear the per-session budget state for a session. Called from
 * session_close so the per-session map does not accumulate stale entries
 * after a session ends. See #156.
 */
export function clearSessionBudgetState(sessionId: string): void {
  sessionBudgetState.delete(sessionId);
}

/**
 * Return all configured budgets from the registry (for listing in actual_budgets_list_available).
 */
export function getBudgetRegistry(): Array<{ name: string; syncId: string; serverUrl: string; hasEncryption: boolean }> {
  return [...budgetRegistry.values()].map(b => ({
    name: b.name,
    syncId: b.syncId,
    serverUrl: b.serverUrl,
    hasEncryption: !!b.encryptionPassword,
  }));
}

/**
 * Get the UUID for any Account, Payee, Category or Schedule by name.
 * Allowed types: 'accounts', 'schedules', 'categories', 'payees'
 */
export async function getIDByName(type: string, name: string): Promise<string> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.getIDByName').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetIDByName(type, name) as Promise<string>, { retries: 2, backoffMs: 200 }));
  });
}

/**
 * Get the current Actual Budget server version.
 * Returns { version: string } on success, { error: string } on failure.
 */
export async function getServerVersion(): Promise<{ version: string } | { error: string }> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.getServerVersion').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetServerVersion() as Promise<{ version: string } | { error: string }>, { retries: 2, backoffMs: 200 }));
  });
}

export default {
  getAccounts,
  getAccountsWithBalances,
  addTransactions,
  importTransactions,
  createTransfer,
  getTransactions,
  getCategories,
  createCategory,
  getPayees,
  createPayee,
  getBudgetMonths,
  getBudgetMonth,
  setBudgetAmount,
  createAccount,
  updateAccount,
  getAccountBalance,
  deleteAccount,
  updateTransaction,
  deleteTransaction,
  updateCategory,
  deleteCategory,
  updatePayee,
  deletePayee,
  getRules,
  createRule,
  updateRule,
  deleteRule,
  setBudgetCarryover,
  closeAccount,
  reopenAccount,
  getCategoryGroups,
  createCategoryGroup,
  updateCategoryGroup,
  deleteCategoryGroup,
  mergePayees,
  getPayeeRules,
  batchBudgetUpdates,
  transferBudgetAmount,
  holdBudgetForNextMonth,
  resetBudgetHold,
  runQuery,
  runBankSync,
  getBudgets,
  switchBudget,
  getBudgetRegistry,
  getIDByName,
  getServerVersion,
  getSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  updateTransactionBatch,
  withWriteSession,
  notifications,
};
