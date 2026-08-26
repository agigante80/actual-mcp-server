import type { components } from '../../generated/actual-client/types.js';
import { subtransactionsSum } from './schemas/common.js';

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
  getCommonPayees: rawGetCommonPayees,
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
  getTags: rawGetTags,
  createTag: rawCreateTag,
  updateTag: rawUpdateTag,
  deleteTag: rawDeleteTag,
  getNote: rawGetNote,
  updateNote: rawUpdateNote,
  exportBudget: rawExportBudget,
  importBudget: rawImportBudget,
  getPreferences: rawGetPreferences,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = api as any;
import { EventEmitter } from 'events';
import observability from '../observability.js';
import { retry, isRetryableError } from './retry.js';
import { withOpTimeout } from './opTimeout.js';
import { NotFoundRefusal, OutOfRangeRefusal, constraintErrorMsg } from './errors.js';
import { findMatchingRule, type RuleCondition } from './rule-matching.js';
import logger from '../logger.js';
import { checkServerVersionOnce } from './server-version-guard.js';
import config from '../config.js';
import { parseBudgetRegistry, type BudgetConfig } from './budget-registry.js';
import { getPreferredBudgetSyncId, setPreferredBudgetSyncId, pickAllowedPreferredBudget } from './budget-preference-store.js';
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
  const store = requestContext.getStore();
  const sessionId = store?.sessionId;
  if (sessionId) {
    const key = sessionBudgetState.get(sessionId);
    if (key) {
      const found = budgetRegistry.get(key);
      if (found) return found;
    }
    // #189 Phase 1: no in-session selection yet (e.g. a fresh session after a
    // server restart + client re-initialize). Restore the principal's persisted
    // budget, but ONLY if the live ACL still permits it (pickAllowedPreferredBudget
    // re-checks allowedBudgets, so a stale preference can never widen access).
    // Memoize into the session slot so subsequent calls take the fast path above.
    const restored = pickAllowedPreferredBudget(
      getPreferredBudgetSyncId(store?.principal),
      store?.allowedBudgets,
      [...budgetRegistry.values()],
    );
    if (restored) {
      sessionBudgetState.set(sessionId, restored.name.toLowerCase());
      return restored;
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

// Per-op timeout (#270) lives in ./opTimeout.ts so ActualConnectionPool can bound
// its own session-open init/download without a circular import back into this
// module (which imports the pool singleton).

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
export async function withActualApi<T>(rawOperation: () => Promise<T>): Promise<T> {
  // ACL enforcement BEFORE pool branching or lock acquisition (#156).
  // Denial here means the lock is never acquired and no upstream resource is
  // touched.
  _enforceBudgetAcl();

  // #276: on the FIRST successful op, warn (once) if the Actual server version is outside
  // the range this build supports. It runs inside the op while the connection is live and
  // reuses it via rawGetServerVersion (NOT the withActualApi-wrapped getServerVersion, which
  // would re-enter the lock). The once-guard flips its flag synchronously, so this never
  // repeats per session or op. It is advisory: it never throws and never blocks the op.
  const operation = async (): Promise<T> => {
    const result = await rawOperation();
    await checkServerVersionOnce(
      () => rawGetServerVersion() as Promise<{ version: string } | { error: string }>,
      logger,
    );
    return result;
  };

  const sessionId = _resolveSessionId();

  if (_hasPooledConnection(sessionId)) {
    // Pooled mode: skip init+shutdown.
    return withApiLock(async () => {
      try {
        connectionReuseCount++;
        logger.debug(`[ADAPTER] Reusing pool connection for session ${sessionId} (reuses=${connectionReuseCount})`);
        return await withOpTimeout(operation);
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
      return await withOpTimeout(operation);
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
        const result = await withOpTimeout(operation);
        // Propagate the write to the server so other clients (and our next
        // read) see it. Pre-#134 this happened implicitly via api.shutdown().
        try {
          const apiAny = api as unknown as { sync?: () => Promise<unknown> };
          if (typeof apiAny.sync === 'function') {
            await withOpTimeout(() => apiAny.sync!(), 'sync');
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
      return await withOpTimeout(operation);
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

/**
 * Test-only readback of the active budget for the current requestContext, so a
 * restart-replay test (#189) can assert the per-principal preference is restored
 * on a fresh session. NOT part of the package public surface.
 */
export function _getActiveBudgetConfigForTests(): BudgetConfig {
  return getActiveBudgetConfig();
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

// Auth-rate-limit retry subsystem extracted to ./actual-adapter/auth-retry.ts
// (#166). Imported for internal use (wrapping api.init, getConcurrencyState)
// and re-exported so the public surface and importers are unchanged.
import {
  isRetryableAuthError,
  withAuthRetry,
  _resetAuthRetryCountersForTests,
  getAuthRetryCounts,
} from './actual-adapter/auth-retry.js';
export { isRetryableAuthError, withAuthRetry, _resetAuthRetryCountersForTests };

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
    // Bound EACH init attempt with the op timeout (#270), inside withAuthRetry:
    // a stalled login rejects per attempt, and a timeout is not an auth error so
    // withAuthRetry does not retry it. Wrapping per-attempt (not the whole retry
    // loop) means legitimate #127 auth-rate-limit backoff (up to ~25s) is not
    // counted against ACTUAL_OP_TIMEOUT_MS.
    await withAuthRetry(() => withOpTimeout(() => api.init({
      dataDir: DATA_DIR,
      serverURL: budget.serverUrl,
      password: budget.password || '',
    }), 'init'));

    logger.debug('[ADAPTER] Downloading budget');

    // Bound downloadBudget (#270): the legacy stdio path re-downloads on every
    // op, and a stall here was the production hang. On timeout it rejects and
    // the mutex releases.
    if (budget.encryptionPassword) {
      const encryptionPassword = budget.encryptionPassword;
      const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
      await withOpTimeout(() => apiWithOptions.downloadBudget(budget.syncId, { password: encryptionPassword }), 'downloadBudget');
    } else {
      await withOpTimeout(() => api.downloadBudget(budget.syncId), 'downloadBudget');
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
          await withOpTimeout(() => apiAny.sync!(), 'sync');
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
      // Bound shutdown too (#270): it runs inside withApiLock, so a stalled
      // shutdown would hold the mutex just like a stalled op. Errors here are
      // already best-effort (swallowed below), and a timeout is one of them.
      await withOpTimeout(() => maybeApi.shutdown!(), 'shutdown');
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

import { BANK_SYNC_SETTLE_MS, WRITE_SESSION_DELAY_MS } from './constants.js';

// Concurrency limiter extracted to ./actual-adapter/concurrency.ts (#166).
// Imported for internal use (every method wraps its raw call in withConcurrency)
// and setMaxConcurrency is re-exported.
import { withConcurrency, setMaxConcurrency, getConcurrencySnapshot } from './actual-adapter/concurrency.js';
export { setMaxConcurrency };

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
  // #278: bounds how long this entry may sit UNDISPATCHED. Cleared at dispatch.
  residencyTimer?: NodeJS.Timeout;
}

let writeQueue: WriteOperation<any>[] = [];
let isProcessingWrites = false;
let writeSessionTimeout: NodeJS.Timeout | null = null;

// Counter for diagnostic: writes that reused an existing pool connection
// (skipped the per-op init). Surfaces in getConcurrencyState(). See #158.
let writeConnectionReuseCount = 0;

// #278: one batch dispatch per processWriteQueue run. Exposed to tests so the debounce
// COALESCING property (N same-tick writes -> ONE batch, one init/sync cycle) is pinned.
// A fix that drained on every enqueue would close the deadlock and silently turn one
// batch into N; nothing else in the suite would notice.
let writeQueueBatchCount = 0;

/**
 * #278: the ONLY place a write-queue drain is scheduled.
 *
 * The callback nulls `writeSessionTimeout` BEFORE draining. That ordering is the whole
 * fix. Previously a timer that fired while a drain was in flight hit the early return in
 * `processWriteQueue` without clearing its own handle, leaving a dead-but-non-null value
 * behind. The drain's `finally` then skipped its re-drain because it tested
 * `writeSessionTimeout === null`, so an operation enqueued mid-drain was never dispatched
 * and its promise never settled. `withOpTimeout` (#270) could not catch it: that bounds
 * execution, and the operation never started.
 */
function scheduleWriteQueueDrain(): void {
  if (writeSessionTimeout) clearTimeout(writeSessionTimeout);
  writeSessionTimeout = setTimeout(() => {
    writeSessionTimeout = null;
    processWriteQueue();
  }, WRITE_SESSION_DELAY_MS);
}

async function processWriteQueue() {
  // Atomically check and set processing flag to prevent race conditions.
  // Safe to return without touching writeSessionTimeout: a fired timer has already
  // nulled it (scheduleWriteQueueDrain), and the finally below always reschedules
  // whenever the queue is non-empty.
  if (isProcessingWrites || writeQueue.length === 0) return;
  isProcessingWrites = true;

  // Clear the timeout since we're processing now
  if (writeSessionTimeout) {
    clearTimeout(writeSessionTimeout);
    writeSessionTimeout = null;
  }
  
  const batch = writeQueue.splice(0, writeQueue.length); // Take all current items

  // #278: these entries are now DISPATCHED, so their residency bound no longer applies.
  // Clearing here, before any await, means the timer can never fire on an in-flight op.
  for (const entry of batch) {
    if (entry.residencyTimer) {
      clearTimeout(entry.residencyTimer);
      entry.residencyTimer = undefined;
    }
  }
  writeQueueBatchCount++;

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
              // Bound each queued write (#270): a stalled op must reject its own
              // promise (so withWriteSession callers don't hang) and let the
              // batch settle so the api mutex releases.
              const result = await withOpTimeout(operation);
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
          await withOpTimeout(() => (api as any).sync(), 'sync');
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
    // #278: ALWAYS re-drain a non-empty queue. The old `&& writeSessionTimeout === null`
    // guard was the lost wakeup: a timer that fired mid-drain left a dead handle here,
    // so operations queued during the drain were stranded until an unrelated later write
    // happened to schedule a fresh timer. No busy loop: this only fires when work exists,
    // and the drain splices the entire queue.
    if (writeQueue.length > 0) scheduleWriteQueueDrain();
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
    const entry: WriteOperation<T> = { operation, resolve, reject, sessionId };

    // #278: bound queue RESIDENCY, not just execution. #270's withOpTimeout bounds an
    // operation that is RUNNING; it cannot bound one that never starts. Reuse the same
    // knob so there is one timeout concept: ACTUAL_OP_TIMEOUT_MS, with <= 0 meaning
    // disabled (matching withOpTimeout). Worst case for a single call is therefore
    // residency + execution = 2 * ACTUAL_OP_TIMEOUT_MS; residency is normally under
    // WRITE_SESSION_DELAY_MS (100ms).
    const residencyLimitMs = config.ACTUAL_OP_TIMEOUT_MS;
    if (Number.isFinite(residencyLimitMs) && residencyLimitMs > 0) {
      entry.residencyTimer = setTimeout(() => {
        const index = writeQueue.indexOf(entry);
        if (index === -1) return; // already dispatched; the timer was cleared, this is belt and braces
        writeQueue.splice(index, 1);
        logger.error(
          `[WRITE QUEUE] Operation was not dispatched within ${residencyLimitMs}ms; rejecting it (#278)`,
        );
        // Deliberately does NOT contain the substring "timed out". TRANSIENT_ERROR_PATTERNS
        // in ./retry.ts matches that substring, and _shouldDropPoolOnError delegates to
        // isRetryableError. An operation that was never dispatched never touched upstream,
        // so classifying it as an infrastructure failure would tear down a healthy pooled
        // connection on a false signal. This error is terminal by design.
        reject(new Error(
          `Write operation was not dispatched within ${residencyLimitMs}ms ` +
          '(write-queue stall, ACTUAL_OP_TIMEOUT_MS). The operation never ran and no data was modified.',
        ));
      }, residencyLimitMs);
      // A pending residency timer must never hold the stdio process open at shutdown.
      entry.residencyTimer.unref?.();
    }

    writeQueue.push(entry);
    scheduleWriteQueueDrain();
  });
}

/** #278 test hook: batches dispatched by processWriteQueue. Pins the coalescing property. */
export function _getWriteQueueBatchCountForTests(): number {
  return writeQueueBatchCount;
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

// Expose some helpers for testing concurrency
export function getConcurrencyState() {
  return {
    ...getConcurrencySnapshot(),
    // Auth-retry observability — issue #127. authRetries is monotonic over the
    // process lifetime; authRetryFailures only increments when retry budget
    // exhausted. A jump in authRetries without a matching jump in
    // authRetryFailures means the retry-with-backoff is absorbing rate-limit
    // pressure (healthy). Both jumping = upstream genuinely overloaded.
    ...getAuthRetryCounts(),
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
// Extracted to ./actual-adapter/normalize.ts (#166). Imported for internal use
// and re-exported so the public surface and external importers are unchanged.
import { normalizeToTransactionArray, normalizeToId, normalizeImportResult } from './actual-adapter/normalize.js';
export { normalizeToTransactionArray, normalizeToId, normalizeImportResult };
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

    // #359: upstream never validates the account. `addTransactions`
    // (loot-core/src/server/accounts/sync.ts) takes acctId, normalises, runs rules and
    // inserts, and `api/transactions-add` returns the string 'ok' unconditionally. Rule
    // evaluation does not rescue us either: prepareTransactionForRules resolves the
    // account with `r._account?.name || ''`. So a bogus account id produced rows with a
    // dangling `account` column that NO listing tool can return (they all filter by
    // account), that sync to every other client, and the tool reported success.
    //
    // This is the same guard `createTransfer` has performed since it was written, using
    // the same single accounts read inside the same write cycle. A CLOSED account is
    // deliberately still allowed: importing history into a closed account is legitimate,
    // which is why this diverges from createTransfer, where a closed account would be an
    // odd transfer destination.
    const accounts = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id: string; name?: string }>>, { retries: 2, backoffMs: 200 })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accountExists = (accounts as any[]).some((a: any) => a?.id === accountId);
    if (!accountExists) {
      throw new NotFoundRefusal(
        'Account',
        accountId,
        'actual_accounts_list',
        'No transactions were created: Actual would otherwise have written them against an ' +
          'account that does not exist, where no tool could retrieve them.',
      );
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
export async function getCommonPayees(): Promise<any[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.commonList').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetCommonPayees() as Promise<any[]>, { retries: 2, backoffMs: 200 }));
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
      // #377: MUST be a typed refusal. `budgets_setAmount` is one of the two tools whose
      // published contract is the SHAPE (#89: an unknown category returns
      // { success: false, error }, it does not throw), and the tool decides that by type
      // now. Leaving this as a bare Error silently undid #89, and the unit test did not
      // catch it because it stubbed the adapter and threw the refusal itself, reproducing
      // the fixture on both sides. There is a real-adapter case for it now.
      throw new NotFoundRefusal('Category', String(categoryId), 'actual_categories_get');
    }

    // #361: the MONTH is unvalidated, in format AND range. `api/budget-set-amount` is the
    // one budget handler that does not call upstream's `validateMonth`, unlike
    // budget-set-carryover, budget-hold-for-next-month and budget-reset-hold, and the
    // tool's schema is a bare `z.string().min(1)`, so even 'banana' reaches this point.
    // Upstream then runs `dbMonth(month)` and INSERTs a row keyed `<month>-<category>`.
    //
    // A membership test against the budget's own months covers both halves at once:
    // upstream's `validateMonth` and `api/budget-months` share the same
    // `get-budget-bounds()` plus `range()` computation, so this reproduces its range check
    // exactly, and a malformed string cannot be a member either.
    const months = await withConcurrency(() =>
      retry(() => rawGetBudgetMonths() as Promise<string[]>, { retries: 2, backoffMs: 200 })
    );
    if (Array.isArray(months) && months.length > 0 && !months.includes(String(month))) {
      throw new OutOfRangeRefusal(
        `Month "${month}" is outside this budget's range, which runs from ${months[0]} to ` +
          `${months[months.length - 1]}. Use actual_budgets_getMonths to see the months you can budget to.`,
        String(month),
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
    // #360: `db.update` does not run a SQL UPDATE. It sends CRDT messages, and the apply
    // path INSERTs when the row was absent, so an unknown id CREATES a partial row rather
    // than matching nothing. Refuse first, the way updateTag and updateRule already do.
    // A CLOSED account is still updatable: getAccounts filters `tombstone = 0`, not
    // `closed = 0`, so this refuses only ids that genuinely do not exist.
    const accounts = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!(Array.isArray(accounts) && accounts.some((a) => a?.id === id))) {
      throw new NotFoundRefusal('Account', id, 'actual_accounts_list');
    }
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
    // Pre-flight existence check (#212): the raw API silently no-ops on a missing id,
    // so an update that changed nothing would otherwise be reported as success. A
    // targeted ActualQL query by id keeps this cheap (indexed lookup). #305 extends
    // the select to is_parent + amount so the split guards below can run off the
    // same read (single source; no second out-of-queue read).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { q } = (await import('@actual-app/api')) as any;
    const rows = await withConcurrency(() =>
      retry(async () => {
        // #305: `.options({ splits: 'all' })` is REQUIRED. The default transactions
        // query excludes split PARENT rows, so a plain filter(id) returns 0 rows for
        // a split parent and this pre-flight would wrongly report it "not found"
        // (which is exactly what broke editing a split). `splits: 'all'` returns
        // regular transactions, split parents, and split children as flat rows, so
        // the existence + is_parent + amount read is correct for every kind.
        const res = (await rawRunQuery(
          q('transactions').options({ splits: 'all' }).filter({ id }).select(['id', 'is_parent', 'amount'])
        )) as { data?: Array<{ id: string; is_parent?: boolean; amount?: number }> };
        return Array.isArray(res?.data) ? res.data : [];
      }, { retries: 2, backoffMs: 200 })
    );
    if (rows.length === 0) {
      throw new Error(`Transaction "${id}" not found. Use actual_transactions_get to list transactions.`);
    }

    // #305: split-edit guards, BEFORE the raw write. Two rules:
    //   (a) subtransactions may only edit a transaction that is ALREADY a split;
    //       converting a plain transaction into a split via updateTransaction is
    //       broken in @actual-app/api 26.7.0 (it strands orphan children), so it
    //       is rejected here rather than silently corrupting data.
    //   (b) child amounts must sum to the effective parent amount. The API does
    //       not enforce this; the ground truth is the caller's new `amount` if
    //       supplied, else the stored amount read above.
    const subs = (fields as { subtransactions?: ReadonlyArray<{ amount: number }> })?.subtransactions;
    if (subs) {
      const row = rows[0];
      if (row.is_parent !== true) {
        throw new Error(
          `Transaction "${id}" is not a split. Converting a plain transaction into a split is not supported here; create the split with actual_transactions_create instead.`
        );
      }
      const providedAmount = (fields as { amount?: number | null }).amount;
      const parentAmount = providedAmount != null ? providedAmount : row.amount;
      const sum = subtransactionsSum(subs);
      if (sum !== parentAmount) {
        throw new Error(
          `Subtransactions must sum to the parent amount. Expected ${parentAmount}, got ${sum}.`
        );
      }
    }

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
    // Nothing to do for an empty batch. The tool enforces min 1, but the adapter is a
    // public export, so guard here and avoid an empty-$oneof existence query.
    if (updates.length === 0) return { succeeded: [], failed: [] };
    // Pre-flight existence check (#212): ONE query for all ids (not one per item),
    // since the raw API silently no-ops on a missing id and would otherwise report
    // a no-op as success. Missing ids are routed to failed[] without an update call.
    const ids = updates.map((u) => u.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { q } = (await import('@actual-app/api')) as any;
    const existing = await withConcurrency(() =>
      retry(async () => {
        // `.options({ splits: 'all' })` for the same reason as the single-update and
        // delete pre-flights (#305): the default query omits split PARENT rows, so a
        // batch touching a split parent would route a perfectly valid id to failed[]
        // as "not found". Splits themselves stay unsupported in batch (FieldsSchema
        // strips `subtransactions`); this only ensures a split parent's OTHER fields
        // are updatable here.
        const res = (await rawRunQuery(q('transactions').options({ splits: 'all' }).filter({ id: { $oneof: ids } }).select(['id']))) as { data?: Array<{ id: string }> };
        return new Set(Array.isArray(res?.data) ? res.data.map((r) => r.id) : []);
      }, { retries: 2, backoffMs: 200 })
    );

    const succeeded: { id: string }[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const { id, fields } of updates) {
      if (!existing.has(id)) {
        failed.push({ id, error: `Transaction "${id}" not found. Use actual_transactions_get to list transactions.` });
        continue;
      }
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
    // Pre-flight existence check: the raw API silently no-ops on a missing id and would
    // otherwise report success for a delete that removed nothing. A targeted ActualQL
    // query by id keeps this cheap (indexed lookup, not a full-table scan).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { q } = (await import('@actual-app/api')) as any;
    const found = await withConcurrency(() =>
      retry(async () => {
        // `.options({ splits: 'all' })` is REQUIRED, same as the update pre-flight
        // above (#305): the default transactions query excludes split PARENT rows,
        // so without it a split parent reads as non-existent and this check throws
        // "not found" before the raw delete is ever reached. The effect was that a
        // split could be created through the tools but never deleted through them.
        const res = (await rawRunQuery(q('transactions').options({ splits: 'all' }).filter({ id }).select(['id']))) as { data?: unknown[] };
        return Array.isArray(res?.data) && res.data.length > 0;
      }, { retries: 2, backoffMs: 200 })
    );
    if (!found) {
      throw new Error(`Transaction "${id}" not found. Use actual_transactions_get to list transactions.`);
    }
    // Non-idempotent: do not retry (#165). A retry after a lost-response would
    // re-issue the delete against an already-removed record and surface a
    // confusing "not found" even though the first attempt succeeded.
    await withConcurrency(() => retry(() => rawDeleteTransaction(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
export async function updateCategory(id: string, fields: Partial<components['schemas']['Category']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.categories.update').catch(() => {});
  return queueWriteOperation(async () => {
    // #360: `db.update` does not run a SQL UPDATE. It sends CRDT messages, and the apply
    // path INSERTs when the row was absent, so an unknown id CREATES a partial row rather
    // than matching nothing. Refuse first, the way updateTag and updateRule already do.
    // Called with no argument, upstream returns every category in every group, hidden
    // included, so a hidden category is not misreported as missing.
    const categories = await withConcurrency(() =>
      retry(() => rawGetCategories() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!(Array.isArray(categories) && categories.some((c) => c?.id === id))) {
      throw new NotFoundRefusal('Category', id, 'actual_categories_get');
    }
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
      throw new NotFoundRefusal('Category', id, 'actual_categories_get');
    }
    await withConcurrency(() =>
      retry(() => rawDeleteCategory(id) as Promise<void>, { retries: 0, backoffMs: 200 })
    );
  });
}
export async function updatePayee(id: string, fields: Partial<components['schemas']['Payee']> | unknown): Promise<void> {
  observability.incrementToolCall('actual.payees.update').catch(() => {});
  return queueWriteOperation(async () => {
    // #360: `db.update` does not run a SQL UPDATE. It sends CRDT messages, and the apply
    // path INSERTs when the row was absent, so an unknown id CREATES a partial row rather
    // than matching nothing. Refuse first, the way updateTag and updateRule already do.
    // Known edge, and why it is acceptable: `db.getPayees()` excludes a transfer payee whose
    // linked account has been hard-tombstoned, so such an orphan is refused here as
    // not-found. A caller CAN hold such an id (transaction rows carry `payee`, and
    // actual_entities_search and actual_get_id_by_name surface ids too), so this is not
    // strictly unreachable. It is accepted because updating an orphaned transfer payee,
    // whose account no longer exists, is not a real workflow, and because the alternative
    // is leaving four tools able to create phantom rows.
    const payees = await withConcurrency(() =>
      retry(() => rawGetPayees() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!(Array.isArray(payees) && payees.some((p) => p?.id === id))) {
      throw new NotFoundRefusal('Payee', id, 'actual_payees_get');
    }

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = (payees as any[]).find((p: any) => p.id === id) as
      | { id: string; name?: string; transfer_acct?: string | null }
      | undefined;
    const exists = Boolean(found);
    if (!exists) {
      throw new NotFoundRefusal('Payee', id, 'actual_payees_get');
    }
    // #356: the existence check above is not enough. Actual refuses to delete a
    // TRANSFER payee (the payee it auto-creates for each account) and refuses
    // SILENTLY: `db.deletePayee` opens with `if (transfer_acct) { return; }`, so the
    // call returns normally having done nothing and the tool reported success.
    //
    // `getPayees()` deliberately INCLUDES transfer payees, which is why they reach
    // this point at all, and it selects `COALESCE(a.name, p.name) AS name`, so a
    // transfer payee's own `name` is already the owning account's name. No second
    // lookup is needed to write a useful message.
    if (found?.transfer_acct) {
      throw new Error(
        `Payee "${found.name ?? id}" is a TRANSFER payee: it belongs to the account of the ` +
          'same name and Actual will not delete it on its own. Delete the account instead ' +
          'with actual_accounts_delete, which removes its transfer payee too.'
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
      // #342: `??` is WRONG for stage, and only for stage. null is a MEANINGFUL
      // value here (Actual's normal stage), not an absent one, so
      // `fieldsObj.stage ?? existingRule.stage` silently discards an explicit
      // `stage: null` and leaves the rule where it was. That made it impossible
      // to move a rule OUT of 'pre' or 'post' back to the normal stage, and it
      // failed silently: the call still returned success.
      //
      // Decide on PRESENCE of the key instead. The tool clones its input with
      // JSON.parse(JSON.stringify(...)), which preserves an explicit null key, so
      // `in` distinguishes "not supplied" from "supplied as null" correctly.
      //
      // The other three fields keep `??` deliberately: none of them treats null
      // as a distinct legal value, so nullish-coalescing is the right merge there.
      stage: 'stage' in fieldsObj ? fieldsObj.stage : existingRule.stage,
      conditionsOp: fieldsObj.conditionsOp ?? existingRule.conditionsOp,
      conditions: fieldsObj.conditions ?? existingRule.conditions ?? [],
      actions: fieldsObj.actions ?? existingRule.actions ?? [],
    };
    
    logger.debug(`[UPDATE RULE] Updating rule ${id} with merged fields: ${JSON.stringify(rule)}`);
    
    await withConcurrency(() => retry(() => rawUpdateRule(rule) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
    logger.debug(`[UPDATE RULE] Update completed for rule ${id}`);
  });
}
/**
 * #355: RETURNS the upstream verdict instead of discarding it, for the same reason
 * as `holdBudgetForNextMonth` above. Upstream `deleteRule`
 * (loot-core/src/server/transactions/transaction-rules.ts) returns `false` without
 * throwing when a schedule owns the rule, because Actual keeps a schedule and its
 * generated rule in step and will not let the rule be removed on its own.
 *
 * `actual_rules_delete` does not route through here (it calls the raw API inside one
 * `withWriteSession` cycle, per #142), so this method currently has NO caller, and the
 * same is true of `holdBudgetForNextMonth` below since #355 moved that tool to the same
 * pattern. Both are kept, and both carry the verdict, so that the next caller inherits
 * the correct contract instead of rediscovering this the hard way. Neither widening is
 * exercised by a test today, for the same reason: nothing calls them.
 */
/**
 * Idempotent rule upsert (#376): update the rule whose conditions match, or create one.
 *
 * Moved here from `src/tools/rules_create_or_update.ts`, which ran the read and the write
 * inside its own `withWriteSession` using raw api calls. Same single-cycle property, but the
 * read now goes through `retry` and there is one observability call site.
 *
 * The caller has already validated the payload; this owns identity and merge only.
 */
export async function upsertRule(
  input: { stage?: string | null; conditionsOp: string; conditions: RuleCondition[]; actions: unknown[] },
  stageWasSupplied: boolean,
): Promise<{ id: string; created: boolean }> {
  observability.incrementToolCall('actual.rules.create_or_update').catch(() => {});
  return queueWriteOperation(async () => {
    const existingRules = await withConcurrency(() =>
      retry(() => rawGetRules() as Promise<unknown[]>, { retries: 2, backoffMs: 200 })
    );
    const matchedRule = findMatchingRule(existingRules, input.conditions, input.conditionsOp);

    const ruleData = JSON.parse(JSON.stringify(input)); // deep clone for the API call

    if (matchedRule) {
      // The Actual Budget API expects the FULL merged rule object as one argument.
      //
      // #342: `??` is WRONG for stage. null is a MEANINGFUL value here (Actual's default
      // stage), not an absent one, so `ruleData.stage ?? existing` would silently discard
      // an explicit `stage: null` and keep the old stage, making it impossible to move a
      // rule back to the default. Decide on PRESENCE instead. That presence test used to
      // be `'stage' in ruleData`, which worked only because the tool passed its parsed
      // input straight through; it is now an explicit parameter so the meaning survives
      // the extra call boundary.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged: any = {
        id: matchedRule.id,
        stage: stageWasSupplied ? ruleData.stage : (matchedRule as Record<string, unknown>).stage,
        conditionsOp: ruleData.conditionsOp ?? (matchedRule as Record<string, unknown>).conditionsOp,
        conditions: ruleData.conditions ?? (matchedRule as Record<string, unknown>).conditions ?? [],
        actions: ruleData.actions ?? (matchedRule as Record<string, unknown>).actions ?? [],
      };
      // Non-idempotent from upstream's point of view: do not retry the write.
      await withConcurrency(() => retry(() => rawUpdateRule(merged) as Promise<void>, { retries: 0, backoffMs: 200 }));
      return { id: matchedRule.id, created: false };
    }

    // #342: stage has no Zod default on this tool, so an omitted stage arrives as
    // undefined. Actual's validator ALWAYS runs on a create and rejects undefined with
    // `Invalid rule stage: undefined`, so the key must be present. null is the correct
    // value: Actual's default stage.
    if (ruleData.stage === undefined) ruleData.stage = null;
    const rawId = await withConcurrency(() => retry(() => rawCreateRule(ruleData) as Promise<unknown>, { retries: 0, backoffMs: 200 }));
    return { id: normalizeToId(rawId), created: true };
  });
}

/**
 * #376: the existence guard and the schedule-owned refusal moved here from
 * `src/tools/rules_delete.ts`, which held them inside its own `withWriteSession`.
 *
 * WHY THE ADAPTER. Doing it in the tool meant reaching past `adapter.*` for the read, so
 * the read had no `retry` at all, and it left THIS method reachable and unguarded: calling
 * it directly silently failed to delete a schedule-owned rule, which is the #355 defect the
 * tool had already fixed. See "Where a read-then-write guard belongs" in CLAUDE.md.
 *
 * Both halves stay inside ONE `queueWriteOperation`, so the read, the decision and the
 * write share a single api lock cycle (#142). That excludes other SESSIONS; it does not
 * serialise against other operations in the same drain (see `reopenAccount` for the long
 * form of that caveat).
 */
export async function deleteRule(id: string): Promise<void> {
  observability.incrementToolCall('actual.rules.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRules = await withConcurrency(() =>
      retry(() => rawGetRules() as Promise<any[]>, { retries: 2, backoffMs: 200 })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!Array.isArray(allRules) || !allRules.some((r: any) => r?.id === id)) {
      throw new NotFoundRefusal('Rule', id, 'actual_rules_get');
    }

    // #355: the raw call RETURNS a verdict and it used to be discarded. Upstream
    // `deleteRule` returns `false`, without throwing, when a schedule owns this rule:
    // Actual keeps a schedule and its generated rule in step and refuses to remove the
    // rule on its own. The existence check above cannot catch that case, because the rule
    // genuinely exists. Reporting success there was a lie (CWE-252).
    //
    // Only an EXPLICIT `false` is a refusal. A build that returns `undefined` (the
    // published reference documents this method as `Promise<null>`) is treated as success,
    // so this stays correct against older and future versions.
    //
    // Not a PreflightRefusal: the write WAS attempted and upstream declined it. A
    // PreflightRefusal means nothing was tried. See the taxonomy in
    // .claude/skills/api-design-principles/SKILL.md.
    const deleted = await withConcurrency(() =>
      retry(() => rawDeleteRule(id) as Promise<boolean | void>, { retries: 0, backoffMs: 200 })
    );
    if (deleted === false) {
      throw new Error(
        `Rule "${id}" belongs to a schedule and cannot be deleted on its own. ` +
          'Actual keeps a schedule and its generated rule in step. Delete the schedule ' +
          'instead with actual_schedules_delete (find it with actual_schedules_get), ' +
          'which removes this rule too.',
      );
    }
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
/**
 * #376: the existence guard and the constraint-error translation moved here from
 * `src/tools/schedules_delete.ts`. The translation stays wrapped tightly around the delete
 * call so the message cannot regress into the raw SQLite text.
 */
export async function deleteSchedule(id: string): Promise<void> {
  observability.incrementToolCall('actual.schedules.delete').catch(() => {});
  return queueWriteOperation(async () => {
    const schedules = await withConcurrency(() =>
      retry(() => rawGetSchedules() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!Array.isArray(schedules) || !schedules.some((sch) => sch?.id === id)) {
      throw new NotFoundRefusal('Schedule', id, 'actual_schedules_get');
    }
    try {
      await withConcurrency(() => retry(() => rawDeleteSchedule(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NOT NULL constraint') || msg.includes('messages_crdt')) {
        throw new Error(constraintErrorMsg('Schedule', id, 'actual_schedules_get'));
      }
      throw err;
    }
  });
}
export async function setBudgetCarryover(month: string, categoryId: string, flag: boolean): Promise<void> {
  observability.incrementToolCall('actual.budgets.setCarryover').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawSetBudgetCarryover(month, categoryId, flag) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
/**
 * #357: forwards the two transfer arguments the published API documents.
 *
 * `closeAccount(id, transferAccountId?, transferCategoryId?)` is the documented
 * signature, and upstream throws `balance is non-zero: transferAccountId is required`
 * when an account with a balance is closed without one. This adapter used to pass the
 * id alone, so an account with a non-zero balance could not be closed through this
 * server at all: the caller was told to supply a parameter no tool accepted.
 *
 * Both remain OPTIONAL. A zero-balance account still closes with the id alone.
 */
/** What a close actually did, decided from observed state rather than from the call returning. */
export type CloseAccountOutcome =
  | { outcome: 'closed'; name?: string }
  | { outcome: 'removed'; name?: string }
  | { outcome: 'already-closed'; name?: string };

/**
 * #357, at the adapter layer since #371.
 *
 * Three upstream behaviours have to be handled together, because any one of them rewrites
 * this function:
 *
 *  (a) `closeAccount` opens with `if (!account || account.closed === 1) return;`, so an
 *      unknown id or an already-closed account did nothing and reported success.
 *  (b) `if (numTransactions === 0) await db.deleteAccount({id})`: an account with no
 *      transactions is TOMBSTONED, not closed, and cannot be reopened.
 *  (c) a non-zero balance throws `balance is non-zero: transferAccountId is required`, and
 *      the transfer arguments are documented but were not exposed until #357.
 *
 * Read, write and re-read share ONE `queueWriteOperation` cycle. A read-BEFORE is required
 * (unlike #347's pure verify-after) because (b) makes "absent afterwards" ambiguous: an
 * account deleted by the close and an id that never existed look identical from a single
 * post-read.
 *
 * WHY THIS LIVES HERE AND NOT IN THE TOOL. It was in the tool until #371. Keeping the read
 * and the write in one cycle does NOT require the raw api: this is the shape
 * `mergePayees` already used, and doing it here keeps `retry` on the reads, keeps ONE
 * observability call site, and leaves no unguarded `adapter.closeAccount` for a future
 * caller to reach for. The tool maps the outcome below onto its response wording.
 */
export async function closeAccount(
  id: string,
  transferAccountId?: string,
  transferCategoryId?: string,
): Promise<CloseAccountOutcome> {
  observability.incrementToolCall('actual.accounts.close').catch(() => {});
  return queueWriteOperation(async () => {
    const before = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id?: string; name?: string; closed?: boolean }>>, { retries: 2, backoffMs: 200 })
    );
    const list = Array.isArray(before) ? before : [];
    const target = list.find((a) => a?.id === id);

    if (!target) {
      throw new Error(
        `Account "${id}" not found. Use actual_accounts_list to see the accounts that exist. ` +
          'Note that an account closed while it had no transactions was REMOVED by Actual, ' +
          'not closed, so it will not appear there.'
      );
    }

    if (target.closed === true) {
      // Idempotent and truthful: the requested state already holds, and the caller is told
      // that nothing changed rather than being implied a state change happened.
      return { outcome: 'already-closed' as const, name: target.name };
    }

    if (transferAccountId) {
      const destination = list.find((a) => a?.id === transferAccountId);
      if (!destination) {
        throw new Error(
          `Transfer destination account "${transferAccountId}" not found. Use ` +
            'actual_accounts_list to pick an account to move the remaining balance to.'
        );
      }
      if (destination.closed === true) {
        throw new Error(
          `Transfer destination account "${destination.name ?? transferAccountId}" is CLOSED, ` +
            'so the closing balance would be moved somewhere hidden from most views. Pick an ' +
            'open account, or reopen that one with actual_accounts_reopen first.'
        );
      }
    }

    if (transferCategoryId) {
      // #359's lesson applied to the only WRITE this path can add. Upstream forwards this id
      // straight into `transaction-add` unchecked, so a bogus value writes a "Closing
      // account" transaction carrying a category that does not exist, and syncs it.
      const categories = await withConcurrency(() =>
        retry(() => rawGetCategories() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
      );
      const known = Array.isArray(categories) && categories.some((c) => c?.id === transferCategoryId);
      if (!known) {
        throw new Error(
          `Transfer category "${transferCategoryId}" not found. Use actual_categories_get to ` +
            'pick a category for the closing transaction, or omit transferCategoryId to leave ' +
            'it uncategorised.'
        );
      }
    }

    try {
      // Non-idempotent: do not retry (#165).
      await withConcurrency(() => retry(() => rawCloseAccount(id, transferAccountId, transferCategoryId) as Promise<void>, { retries: 0, backoffMs: 200 }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/balance is non-zero/i.test(msg)) {
        throw new Error(
          `Account "${target.name ?? id}" has a non-zero balance, so closing it requires ` +
            'transferAccountId: the id of the account to move the remaining balance to. ' +
            'Optionally pass transferCategoryId to categorise the balancing transaction. ' +
            'Use actual_accounts_list to pick a destination.'
        );
      }
      throw err;
    }

    const after = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id?: string; name?: string; closed?: boolean }>>, { retries: 2, backoffMs: 200 })
    );
    const survivor = (Array.isArray(after) ? after : []).find((a) => a?.id === id);

    if (!survivor) {
      // (b): upstream tombstoned a zero-transaction account instead of closing it.
      return { outcome: 'removed' as const, name: target.name };
    }
    if (survivor.closed !== true) {
      throw new Error(
        `Account "${survivor.name ?? id}" (${id}) is still open after the close. The call was ` +
          'accepted but had no effect; check the account state in Actual.'
      );
    }
    return { outcome: 'closed' as const, name: survivor.name };
  });
}
/**
 * #358, at the adapter layer since #371.
 *
 * Upstream `reopenAccount` is a bare `db.update('accounts', {id, closed: 0})`. `db.update`
 * does not run a SQL UPDATE: it sends CRDT messages, and the apply path INSERTs when the
 * row was absent. The accounts table has no NOT NULL columns and `tombstone` defaults to 0,
 * while `getAccounts()` filters `tombstone = 0`, so reopening an id that is not an account
 * CREATES a visible nameless account that syncs to every client.
 *
 * A pre-check is right here and was wrong in #347: there, the caller's intent ("make this
 * account not exist") could already be satisfied by an absent row, so refusing on absence
 * would have failed a complete request. Here the intent ("reopen this account") cannot be
 * satisfied by an absent row, and proceeding actively creates one.
 *
 * TWO DELIBERATE LIMITS, carried over from the tool-layer version so they are not
 * rediscovered as oversights.
 *
 * One `queueWriteOperation` keeps this read, write and re-read in a single api lock cycle.
 * It does NOT serialise against other operations in the same batch: `processWriteQueue`
 * dispatches with `Promise.allSettled`, so operations queued in the same drain window
 * interleave at await points. The cycle excludes other SESSIONS, not batch siblings.
 *
 * The not-found message covers both reasons an id can be missing (never existed, or removed
 * by a close while it had no transactions) rather than distinguishing them. `q().withDead()`
 * would tell them apart by reading tombstoned rows, at the cost of an extra query on the
 * failure path. Collapsing them was chosen because the message names both cases and the
 * remedy is the same either way.
 */
export type ReopenAccountOutcome = { outcome: 'reopened' | 'already-open'; name?: string };

export async function reopenAccount(id: string): Promise<ReopenAccountOutcome> {
  observability.incrementToolCall('actual.accounts.reopen').catch(() => {});
  return queueWriteOperation(async () => {
    const before = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id?: string; name?: string; closed?: boolean }>>, { retries: 2, backoffMs: 200 })
    );
    const target = (Array.isArray(before) ? before : []).find((a) => a?.id === id);
    if (!target) {
      throw new Error(
        `Account "${id}" not found, so it cannot be reopened. Use actual_accounts_list to see ` +
          'the accounts that exist. If this account was closed while it had no transactions, ' +
          'Actual removed it rather than closing it, and it cannot be reopened: create a new ' +
          'one with actual_accounts_create.'
      );
    }

    // #369 item 5: an already-open account needs no write. Upstream `reopenAccount` is a
    // db.update, which in Actual means a CRDT MESSAGE that syncs to every other client, so
    // issuing it for a no-op is not free: it is sync traffic and a device-state bump for a
    // change nobody made. Reporting the non-change is also the taxonomy's rule 1 (the
    // requested end state already holds, so this is a SUCCESS naming what did not happen),
    // and it matches what closeAccount already does with `already-closed`.
    if (target.closed !== true) {
      return { outcome: 'already-open' as const, name: target.name };
    }

    await withConcurrency(() => retry(() => rawReopenAccount(id) as Promise<void>, { retries: 2, backoffMs: 200 }));

    const after = await withConcurrency(() =>
      retry(() => rawGetAccounts() as Promise<Array<{ id?: string; name?: string; closed?: boolean }>>, { retries: 2, backoffMs: 200 })
    );
    const survivor = (Array.isArray(after) ? after : []).find((a) => a?.id === id);
    if (!survivor) {
      throw new Error(`Account "${id}" disappeared while being reopened. Check the account state in Actual.`);
    }
    if (survivor.closed === true) {
      throw new Error(
        `Account "${survivor.name ?? id}" (${id}) is still closed after the reopen. The call ` +
          'was accepted but had no effect; check the account state in Actual.'
      );
    }
    return { outcome: 'reopened' as const, name: survivor.name };
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
    // #360: `db.update` does not run a SQL UPDATE. It sends CRDT messages, and the apply
    // path INSERTs when the row was absent, so an unknown id CREATES a partial row rather
    // than matching nothing. Refuse first, the way updateTag and updateRule already do.
    // Called with no argument, upstream returns all groups including hidden ones, so a
    // hidden group is not misreported as missing (the same reason category_groups_delete
    // can rely on this listing).
    const groups = await withConcurrency(() =>
      retry(() => rawGetCategoryGroups() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!(Array.isArray(groups) && groups.some((g) => g?.id === id))) {
      throw new NotFoundRefusal('Category group', id, 'actual_category_groups_get');
    }
    await withConcurrency(() => retry(() => rawUpdateCategoryGroup(id, fields) as Promise<void>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
  });
}
/**
 * #376: the existence guard moved here from `src/tools/category_groups_delete.ts`. Same
 * reasoning as `deleteRule` above: the tool-layer version forwent `retry` on the read and
 * left this method reachable with no guard at all.
 */
export async function deleteCategoryGroup(id: string): Promise<void> {
  observability.incrementToolCall('actual.category_groups.delete').catch(() => {});
  return queueWriteOperation(async () => {
    const groups = await withConcurrency(() =>
      retry(() => rawGetCategoryGroups() as Promise<Array<{ id?: string }>>, { retries: 2, backoffMs: 200 })
    );
    if (!Array.isArray(groups) || !groups.some((g) => g?.id === id)) {
      throw new NotFoundRefusal('Category group', id, 'actual_category_groups_get');
    }
    // Non-idempotent: do not retry (#165).
    await withConcurrency(() => retry(() => rawDeleteCategoryGroup(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}
/**
 * #356: bound what an error message echoes back. The caller supplies these ids, they end
 * up in the tool response AND in `logger.error` via actualToolsManager, and `mergeIds`
 * accepts up to 50 of them at 64 characters each. Naming a handful is enough to act on;
 * naming all of them is an unbounded echo of caller-controlled input.
 */
function summariseIds(ids: string[], limit = 5): string {
  const shown = ids.slice(0, limit).map((id) => (id.length > 64 ? `${id.slice(0, 64)}...` : id));
  const rest = ids.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} (and ${rest} more)` : shown.join(', ');
}

/**
 * #356: merge, with the pre-flight it never had.
 *
 * Upstream `db.mergePayees` fails silently in two ways and throws unhelpfully in a
 * third:
 *
 *   if (payees[target].transfer_acct != null) { return; }          // silent no-op
 *   ids = ids.filter(id => payees[id].transfer_acct == null);      // sources dropped
 *
 * A transfer-payee target makes the whole call a no-op; transfer-payee sources are
 * dropped from the list without a word, while the tool still reported "merged N
 * payee(s)" using the length of its own INPUT. And an id that does not exist at all
 * is indexed straight off the map, so it surfaces as
 * `TypeError: Cannot read properties of undefined (reading 'transfer_acct')`.
 *
 * One `getPayees()` read inside this same write cycle answers all three. It returns the
 * de-duplicated ids it ACCEPTED for merge, which after those three refusals is the set
 * upstream will act on. Note what it is not: there is no post-write read here, unlike
 * close, reopen and hold, so a drop reason nobody has enumerated would still go unnoticed.
 */
export async function mergePayees(targetId: string, mergeIds: string[]): Promise<string[]> {
  observability.incrementToolCall('actual.payees.merge').catch(() => {});
  return queueWriteOperation(async () => {
    const payees = await withConcurrency(() =>
      retry(() => rawGetPayees() as Promise<Array<{ id: string; name?: string; transfer_acct?: string | null }>>, { retries: 2, backoffMs: 200 })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map((payees as any[]).map((p: any) => [p.id, p]));

    const target = byId.get(targetId);
    if (!target) {
      throw new Error(
        `Payee "${targetId}" not found. Use actual_payees_get to list available payees.`
      );
    }
    if (target.transfer_acct) {
      throw new Error(
        `Target payee "${target.name ?? targetId}" is a TRANSFER payee and cannot be merged ` +
          'into. Actual silently ignores such a merge. Pick a normal payee as the target.'
      );
    }

    const missing = mergeIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Payee(s) not found: ${summariseIds(missing)}. Use actual_payees_get to list available payees.`
      );
    }
    const transfers = mergeIds.filter((id) => byId.get(id)?.transfer_acct);
    if (transfers.length > 0) {
      const names = transfers.map((id) => String(byId.get(id)?.name ?? id));
      throw new Error(
        `Cannot merge TRANSFER payee(s): ${summariseIds(names)}. They belong to accounts of the ` +
          'same name, and Actual silently drops them from a merge rather than merging them. ' +
          'Remove them from mergeIds, or delete the account with actual_accounts_delete.'
      );
    }
    if (mergeIds.includes(targetId)) {
      throw new Error(
        `Payee "${targetId}" appears as both the merge target and a merge source.`
      );
    }

    // De-duplicate before reporting, or `['p','p']` claims two merges for one. The whole
    // point of returning ids is that the count describes what happened.
    const unique = [...new Set(mergeIds)];

    // Non-idempotent: do not retry (#165). A second merge against an
    // already-removed source payee can corrupt merge state or mislead.
    await withConcurrency(() => retry(() => rawMergePayees(targetId, unique) as Promise<void>, { retries: 0, backoffMs: 200 }));
    return unique;
  });
}
/**
 * Does a serialized Actual rule reference this payee? The payee id lives INSIDE a
 * condition or action whose `field` is 'payee': as `value` (op 'is'/'isNot') or as
 * a member of `value` (op 'oneOf', an array). A serialized rule has NO top-level
 * `payee_id` column, so the original BUG-3 post-filter (`r.payee_id === payeeId`)
 * matched nothing and made actual_payee_rules_get always return empty. This mirrors
 * `@actual-app/api`'s own getRulesForPayee, which scans payee-typed ids in the rule.
 */
export function ruleReferencesPayee(rule: unknown, payeeId: string): boolean {
  const r = rule as { conditions?: unknown; actions?: unknown };
  const clauses = [
    ...(Array.isArray(r?.conditions) ? r.conditions : []),
    ...(Array.isArray(r?.actions) ? r.actions : []),
  ] as Array<{ field?: unknown; value?: unknown }>;
  return clauses.some((c) => {
    if (c?.field !== 'payee') return false;
    return Array.isArray(c.value) ? c.value.includes(payeeId) : c?.value === payeeId;
  });
}
export async function getPayeeRules(payeeId: string): Promise<unknown[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.payees.getPayeeRules').catch(() => {});
    const allRules = await withConcurrency(() => retry(() => rawGetPayeeRules(payeeId) as Promise<unknown[]>, { retries: 2, backoffMs: 200 }));
    if (!Array.isArray(allRules)) return [];
    // Defensive narrowing to the requested payee. @actual-app/api already scopes
    // payee-rules-get to the id; the filter must use the real rule shape (payee
    // referenced in a condition/action), NOT a nonexistent `payee_id` column.
    const filtered = allRules.filter((r) => ruleReferencesPayee(r, payeeId));
    // Upstream already scopes to the payee, so this filter should be a no-op. If it
    // ever drops rows, the serialized rule shape has drifted and the predicate is now
    // silently under-matching: exactly the failure class that made #284 return empty
    // for months. Surface it instead of hiding it.
    if (filtered.length !== allRules.length) {
      logger.debug('[ADAPTER] getPayeeRules post-filter dropped rows; rule shape may have drifted', {
        payeeId, upstream: allRules.length, kept: filtered.length,
      });
    }
    return filtered;
  });
}
export async function batchBudgetUpdates(fn: () => Promise<void>): Promise<void> {
  observability.incrementToolCall('actual.budgets.batchUpdates').catch(() => {});
  return queueWriteOperation(async () => {
    await withConcurrency(() => retry(() => rawBatchBudgetUpdates(fn) as Promise<void>, { retries: 2, backoffMs: 200 }));
  });
}
/**
 * #355: RETURNS the upstream verdict instead of discarding it.
 *
 * Upstream `holdForNextMonth` (loot-core/src/server/budget/actions.ts) returns a
 * BOOLEAN: `true` when it buffered the amount, `false` when the month's To Budget
 * is not positive and it held nothing. It does not throw in the second case. The
 * published reference documents the method as `Promise<null>`, which is why the
 * value was being thrown away here and the tool reported success for a hold that
 * never happened (CWE-252, unchecked return value).
 *
 * `undefined` is deliberately NOT treated as a refusal: an older or future build
 * that returns nothing must keep working. Only an explicit `false` is a verdict.
 */
/**
 * #355, at the adapter layer since #371.
 *
 * Upstream has TWO ways of doing less than asked, and only one of them is a boolean:
 *
 *   holdForNextMonth:    if (toBudget > 0) { ...; return true; } return false;
 *   calcBufferedAmount:  amount = Math.min(Math.max(amount, -buffered), Math.max(toBudget, 0));
 *
 * So `false` means nothing was held, and `true` can still mean a PARTIAL hold: ask for
 * 100.00 with 30.00 left to budget and 30.00 is held, silently. Reading `forNextMonth`
 * before and after settles both from observed state, which is the #347 principle and is
 * strictly better than trusting either return value.
 *
 * Returns the amount ACTUALLY held. The caller compares it with what it requested.
 */
export async function holdBudgetForNextMonth(month: string, amount: number): Promise<number> {
  observability.incrementToolCall('actual.budgets.holdForNextMonth').catch(() => {});
  return queueWriteOperation(async () => {
    // `isRetryable` matters here, unlike most read sites: upstream's `api/budget-month` opens
    // with `validateMonth` and throws for an out-of-range month. Without a classifier,
    // retry() retries EVERY rejection (see retry.ts), so a deterministic domain error would
    // cost three upstream calls and 600ms of sleeping inside the api mutex, against the one
    // withOpTimeout budget this whole callback shares. #177 doctrine: domain errors are
    // terminal.
    const before = await withConcurrency(() =>
      retry(() => rawGetBudgetMonth(month) as Promise<{ forNextMonth?: number } | null>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError })
    );
    const heldBefore = Number(before?.forNextMonth ?? 0);

    // Non-idempotent: do not retry (#165). `calcBufferedAmount` is ADDITIVE
    // (`return buffered + amount`), so a second attempt after a committed first does not
    // re-set the buffer, it adds to it.
    await withConcurrency(() => retry(() => rawHoldBudgetForNextMonth(month, amount) as Promise<boolean | void>, { retries: 0, backoffMs: 200 }));

    const after = await withConcurrency(() =>
      retry(() => rawGetBudgetMonth(month) as Promise<{ forNextMonth?: number } | null>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError })
    );
    return Number(after?.forNextMonth ?? 0) - heldBefore;
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

// WHERE-clause translation extracted to ./actual-adapter/query.ts (#166).
// Imported for internal use by runQuery and re-exported (unit-tested directly).
import { parseWhereClause } from './actual-adapter/query.js';
export { parseWhereClause };
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
 *     Since #348 stdio HAS a session (a synthetic per-process id minted in
 *     stdioServer.ts), so it can switch. Genuinely session-less callers (CLI
 *     scripts, startup health checks) still fall back to the env-default budget
 *     and cannot switch (returns an error).
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
      'Budget switch requires an MCP session. This caller has none, which means a CLI script or an ' +
        'internal startup path rather than a client: both HTTP and stdio clients get a session (#348). ' +
        'Such callers operate on the env-default budget; configure ACTUAL_BUDGET_SYNC_ID (or the ' +
        'BUDGET_n_* variants) to select a different default.',
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

  // #189 Phase 1: the principal's chosen budget is persisted at each commit
  // point below (paired with the sessionBudgetState write), NOT here, so a
  // switch that throws before committing never leaves a stale preference. The
  // helper is keyed by a hash of the principal and never throws.

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
    setPreferredBudgetSyncId(store?.principal, found.syncId); // #189: persist at commit

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
        // Bound the in-place budget reload too (#270).
        if (found.encryptionPassword) {
          const encryptionPassword = found.encryptionPassword;
          const apiWithOptions = api as typeof api & {
            downloadBudget: (id: string, options?: { password: string }) => Promise<void>;
          };
          await withOpTimeout(() => apiWithOptions.downloadBudget(found.syncId, { password: encryptionPassword }), 'downloadBudget');
        } else {
          await withOpTimeout(() => api.downloadBudget(found.syncId), 'downloadBudget');
        }
      });
    }
    connectionPool.updateLoadedSyncId(sessionId, found.syncId);
    sessionBudgetState.set(sessionId, key);
    setPreferredBudgetSyncId(store?.principal, found.syncId); // #189: persist at commit

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
  setPreferredBudgetSyncId(store?.principal, found.syncId); // #189: persist at commit

  // Materialise a fresh pool entry bound to the new budget. Without this, the
  // next withActualApi call would find no pool entry and fall back to the
  // legacy init+shutdown path. Failure here is logged but not fatal: the
  // legacy fallback still works, just less efficiently.
  //
  // #348 EXCEPTION: never for a stdio session. stdio gained a synthetic session
  // id so it could switch budgets at all, but it must stay on the legacy
  // init/shutdown cycle. A pooled entry for stdio would be created here and then
  // NEVER refreshed, because connectionPool.touch() is called only from
  // httpServer.ts; it would expire after SESSION_IDLE_TIMEOUT_MINUTES and
  // cleanupIdleConnections would api.shutdown() it WITHOUT holding withApiLock,
  // which can tear the singleton down underneath an in-flight operation. The
  // legacy path re-reads getActiveBudgetConfig() on every call, so the switch
  // still takes effect; it just costs an init per operation, which is what stdio
  // already did before this ticket.
  if (store?.transport === 'stdio') {
    logger.debug(
      `[ADAPTER] switchBudget: session ${sessionId} is stdio; skipping pool materialisation ` +
        '(stdio stays on the legacy init/shutdown path by design, #348).',
    );
  } else if (_skipApiInitForTests) {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTags(): Promise<any[]> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.tags.get').catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await withConcurrency(() => retry(() => rawGetTags() as Promise<any[]>, { retries: 2, backoffMs: 200 }));
  });
}

export async function createTag(tag: { tag: string; color?: string; description?: string }): Promise<string> {
  observability.incrementToolCall('actual.tags.create').catch(() => {});
  return queueWriteOperation(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await withConcurrency(() => retry(() => rawCreateTag(tag) as Promise<string | { id?: string }>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }));
    return normalizeToId(raw);
  });
}

export async function updateTag(id: string, fields: { tag?: string; color?: string; description?: string }): Promise<void> {
  observability.incrementToolCall('actual.tags.update').catch(() => {});
  return queueWriteOperation(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = await withConcurrency(() => retry(() => rawGetTags() as Promise<any[]>, { retries: 2, backoffMs: 200 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (tags as any[]).some((t: any) => t.id === id);
    if (!exists) {
      throw new NotFoundRefusal('Tag', id, 'actual_tags_list');
    }
    await withConcurrency(() => retry(() => rawUpdateTag(id, fields) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
  });
}

export async function deleteTag(id: string): Promise<void> {
  observability.incrementToolCall('actual.tags.delete').catch(() => {});
  return queueWriteOperation(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = await withConcurrency(() => retry(() => rawGetTags() as Promise<any[]>, { retries: 2, backoffMs: 200 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = (tags as any[]).some((t: any) => t.id === id);
    if (!exists) {
      throw new NotFoundRefusal('Tag', id, 'actual_tags_list');
    }
    await withConcurrency(() => retry(() => rawDeleteTag(id) as Promise<void>, { retries: 0, backoffMs: 200 }));
  });
}

export async function getNote(id: string): Promise<{ id: string; note: string } | null> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.notes.get').catch(() => {});
    return await withConcurrency(() => retry(() => rawGetNote(id) as Promise<{ id: string; note: string } | null>, { retries: 2, backoffMs: 200 }));
  });
}

/** A note id of this shape is a budget MONTH note and resolves to no entity row. */
const BUDGET_MONTH_NOTE_RE = /^budget-\d{4}-\d{2}$/;

/**
 * #376: the orphan-id guard moved here from `src/tools/notes_update.ts`.
 *
 * WHY THIS ONE MATTERS MOST OF THE FIVE. The tool version issued FOUR `adapter.get*` calls
 * through `Promise.all`, each opening its own `withActualApi` cycle, and then a fifth cycle
 * for the write: five api lock acquisitions for one logical operation. `Promise.all` made it
 * look concurrent, but the api mutex is process-global, so they serialised anyway. Reading
 * inside one `queueWriteOperation` makes it ONE cycle, and the guard now sees the same
 * snapshot the write lands on.
 *
 * The refusal is a NotFoundRefusal so the tool can recognise it by type (#377). The tool
 * converts it to its published `{ error }` shape, which is a known deviation from the
 * refusal taxonomy and is tracked on #377 rather than changed here.
 */
export async function updateNote(id: string, note: string): Promise<void> {
  observability.incrementToolCall('actual.notes.update').catch(() => {});
  return queueWriteOperation(async () => {
    // A budget-YYYY-MM id is synthetic: it names a month, not a row, so there is nothing
    // to look up and the four reads below would all miss.
    if (!BUDGET_MONTH_NOTE_RE.test(id)) {
      const has = (rows: unknown): boolean =>
        Array.isArray(rows) && rows.some((e) => (e as { id?: string })?.id === id);

      const [accounts, categories, categoryGroups, payees] = await Promise.all([
        withConcurrency(() => retry(() => rawGetAccounts() as Promise<unknown[]>, { retries: 2, backoffMs: 200 })),
        withConcurrency(() => retry(() => rawGetCategories() as Promise<unknown[]>, { retries: 2, backoffMs: 200 })),
        withConcurrency(() => retry(() => rawGetCategoryGroups() as Promise<unknown[]>, { retries: 2, backoffMs: 200 })),
        withConcurrency(() => retry(() => rawGetPayees() as Promise<unknown[]>, { retries: 2, backoffMs: 200 })),
      ]);

      if (!has(accounts) && !has(categories) && !has(categoryGroups) && !has(payees)) {
        // Guarding matters here for the same reason as #360: upstream's note write is a
        // CRDT message, and the apply path INSERTs when the row is absent, so an unknown
        // id creates an orphan note that no tool can ever read back.
        throw new NotFoundRefusal(
          'Entity',
          id,
          'actual_accounts_list, actual_categories_get, actual_category_groups_get or actual_payees_get',
          'A budget month note uses an id like "budget-2026-01".',
        );
      }
    }

    await withConcurrency(() => retry(() => rawUpdateNote(id, note) as Promise<void>, { retries: 0, backoffMs: 200, isRetryable: isRetryableError }));
  });
}

/**
 * Export the currently-loaded budget as a zip (#332).
 *
 * READ path (`withActualApi`), not the write queue: the upstream call produces a
 * snapshot and mutates nothing, so it is safe to retry and must not serialise
 * behind pending writes.
 *
 * Returns the raw bytes. Deliberately NOT base64 here: the encoding decision, the
 * size cap, and the write-to-disk policy belong to the tool layer, so a future
 * caller that wants to stream the buffer is not forced through a string.
 */
export async function exportBudget(): Promise<Uint8Array> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.budgets.export').catch(() => {});
    return await withConcurrency(() =>
      retry(() => rawExportBudget() as Promise<Uint8Array>, { retries: 2, backoffMs: 200, isRetryable: isRetryableError }),
    );
  });
}

/**
 * Import a budget from an Actual `.zip` export or a YNAB4/YNAB5 export (#334).
 *
 * WRITE path, and NON-IDEMPOTENT: it creates a budget file and returns its new id,
 * so `retries: 0` is mandatory. A retry after a lost response would create a SECOND
 * budget rather than returning the first one's id. Guarded by
 * `tests/unit/adapter_nonidempotent_no_retry.test.js`.
 *
 * Side effect worth knowing at every call site: upstream `importBudget` LOADS the
 * imported budget, so the session's active budget changes to the new file. It is
 * therefore outside the `BUDGET_N_*` registry and outside whatever budget the ACL
 * resolved for this request. The write queue still enforces the ACL on entry, so a
 * caller cannot use this to escape a budget they were already denied, but the
 * resulting budget is un-ACL'd because it did not exist when the ACL was built.
 */
export async function importBudget(
  input: string | Uint8Array,
  opts: { type?: string; filename?: string } = {},
): Promise<{ id: string }> {
  observability.incrementToolCall('actual.budgets.import').catch(() => {});
  const result = await queueWriteOperation(async () => {
    return await withConcurrency(() =>
      retry(() => rawImportBudget(input, opts) as Promise<{ id: string }>, {
        retries: 0,
        backoffMs: 200,
        isRetryable: isRetryableError,
      }),
    );
  });

  // #349: an import CHANGES WHICH BUDGET IS LOADED, so the pool's record of it
  // must stop naming the old one.
  //
  // switchBudget's #172 fast path skips the re-download when
  // `currentEntry.syncId === found.syncId`, trusting that field as the record of
  // what is loaded. Every other path that changes the loaded budget keeps it in
  // sync; this one did not. The result was a switch BACK to the configured budget
  // returning `{success: true}` while the session stayed on the imported copy, so
  // subsequent writes and deletes landed in the wrong budget. That is the
  // reported-success-with-no-effect class of #347, with financial data at the
  // other end of it.
  //
  // The sentinel is deliberate rather than the imported id alone: configured sync
  // ids are UUIDs, so an `imported:` prefix can never compare equal to one, which
  // makes the fast path structurally unable to match after an import. An imported
  // budget frequently has no cloud sync id at all, so there is no true value to
  // record here; what matters is that the stale one is gone.
  // EVERY entry, not just this session's. The api singleton is process-global with
  // one loaded budget, so an import by session A changes what B..N are looking at
  // too. Invalidating only A would leave the others matching the fast path against
  // a record that is no longer true.
  const invalidated = connectionPool.invalidateAllLoadedSyncIds(`imported:${result.id}`);
  if (invalidated > 0) {
    logger.debug(
      `[ADAPTER] importBudget: invalidated the pooled syncId on ${invalidated} session(s) ` +
        `(now "imported:${result.id}"), so a switch back re-downloads instead of no-opping (#349).`,
    );
  }

  return result;
}

/**
 * Read the budget's synced preferences: number format, date format, currency,
 * first day of week, and similar display settings (#333).
 *
 * READ path. The shape is upstream's `SyncedPrefs`, which our tsconfig resolves to
 * the `@actual-app/core` stub (`any`), so there is no compile-time contract here.
 * The tool layer normalises it rather than trusting the shape.
 */
export async function getPreferences(): Promise<Record<string, unknown>> {
  return withActualApi(async () => {
    observability.incrementToolCall('actual.preferences.get').catch(() => {});
    return await withConcurrency(() =>
      retry(() => rawGetPreferences() as Promise<Record<string, unknown>>, {
        retries: 2,
        backoffMs: 200,
        isRetryable: isRetryableError,
      }),
    );
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
  getCommonPayees,
  createPayee,
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getNote,
  updateNote,
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
  upsertRule,
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
  exportBudget,
  importBudget,
  getPreferences,
  notifications,
};
