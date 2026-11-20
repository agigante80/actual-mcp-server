/**
 * Connection Pool for Actual Budget API
 * 
 * Manages separate Actual Budget connections for each MCP session.
 * Each connection has its own lifecycle (init -> operations -> shutdown).
 * This ensures proper data persistence according to Actual Budget's API design.
 * 
 * NOTE: Since @actual-app/api is a singleton module, this implementation
 * supports sequential session handling (one active session at a time).
 * For true concurrent multi-session support, the Actual Budget API would
 * need to support multiple instances or we'd need request queuing.
 */

import api from '@actual-app/api';
import logger from '../logger.js';
import config from '../config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { isApiInitialized, setApiInitialized } from './apiState.js';
import { initApiLoggedIn } from './apiLogin.js';
import { withApiLock, isApiLockHeld } from './apiLock.js';
import { loadBudgetTracked } from './budgetLoader.js';

const DEFAULT_DATA_DIR = path.resolve(os.homedir() || '.', '.actual');

/** Why a session left the pool: `evicted` is the #167 path (idle entry or explicit close),
 *  `orphaned` is #530 (registered id, no entry, one idle window without a served request). */
// #563: `closed` is a client-initiated DELETE; httpServer tears the session down itself.
export type EvictionReason = 'evicted' | 'orphaned' | 'closed';

interface ActualConnection {
  sessionId: string;
  initialized: boolean;
  lastActivity: number;
  dataDir: string;
  // Auth descriptor: identifies the upstream Actual instance this pool entry
  // is authenticated against. switchBudget compares incoming budget descriptor
  // against these fields; if they match, the entry can be reused for the new
  // budget without re-authenticating (just api.downloadBudget(newSyncId)). See #172.
  serverUrl: string;
  password: string;
  encryptionPassword?: string;
  // Currently-loaded budget on this pool entry. Tracks downloads after the
  // initial init so switchBudget can decide whether to reload (#172).
  syncId: string;
}

class ActualConnectionPool {
  private connections: Map<string, ActualConnection> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT: number; // Configurable via SESSION_IDLE_TIMEOUT_MINUTES env var (default: 5 minutes)
  private readonly CLEANUP_INTERVAL: number; // Check frequency (default: 2 minutes)
  private readonly MAX_CONCURRENT_SESSIONS: number; // Configurable via MAX_CONCURRENT_SESSIONS env var (default: 15)
  private sharedConnection: ActualConnection | null = null;
  private initializationPromise: Promise<void> | null = null;
  // Eviction listeners. The pool is the single source of truth for session
  // liveness and idle timing (#167); when it removes a session it notifies the
  // transport layer (httpServer) so the transport object is torn down in the
  // same window. This is callback-based eager teardown, not lazy query-on-demand:
  // a lazily-cleaned table would leak transport objects for sessions a client
  // abandons without reconnecting.
  private evictionCallbacks: Array<(sessionId: string, reason: EvictionReason) => void> = [];
  // #530: every HTTP session the transport layer registered, with the time it was last
  // served. An entry in `connections` is not the only thing that must expire: an
  // infra-error drop (or `switchBudget`'s slow path) removes the pool entry WITHOUT
  // evicting the transport, and before #530 a client that then went away left its
  // transport, owner record and init promise behind forever, because nothing timed an
  // entry-less session. The sweep reaps a registered id that has no entry and was not
  // served for one idle window ("orphaned"). `touch()` stamps it, so a served request
  // keeps the session alive whether or not the entry is back.
  private registered: Map<string, number> = new Map();
  // #530 (review M1): requests currently being served per session. The orphan sweep skips a
  // session with a request in flight: an entry-less session running a long operation (an
  // import past the idle window, or a request queued behind another session's drain) has
  // stamped its registration only at the START of the request, so without this the sweep
  // would close its transport mid-operation. Entries have the #392 lock re-check and the
  // #378 in-drain touch for the same hazard; registrations have neither.
  private inFlight: Map<string, number> = new Map();
  // #581: session ids that hold a slot under MAX_CONCURRENT_SESSIONS but have no initialized
  // entry yet. Before this the cap counted initialized entries only, and an entry is created
  // after the login and budget download, so every initialize that arrived while those were in
  // flight saw the same count and was admitted: 6 parallel initializes all logged in under a cap
  // of 2. A slot is now taken synchronously at admission (`reserveSession`) and handed over to
  // the entry in one synchronous block in `getConnection`. Ids only: this count reaches the
  // unauthenticated /health as a number, never as a list.
  private reservations: Set<string> = new Set();
  // #577: session id to the principal its admission was capped under, for the session's whole
  // lifetime (not the pool entry's: a mid-session pool drop keeps the session, so it keeps
  // counting). A principal's count is the number of values equal to it, computed by iterating,
  // so there is no counter to drift and a principal with no sessions has no value here. Only
  // capped admissions are recorded: the cap must be set and the caller must pass a principal.
  // Deleted by `forgetSession` (every session end) and `releaseAdmission` (an initialize that
  // never registered). Never logged, never in getStats.
  private admissions: Map<string, string> = new Map();
  private readonly MAX_SESSIONS_PER_PRINCIPAL: number | undefined;

  constructor() {
    // Read from environment variable or default to 15
    // @actual-app/api is a singleton, so concurrent sessions cause conflicts
    this.MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '15', 10);
    // #577: validated by the config schema, so no raw read here.
    this.MAX_SESSIONS_PER_PRINCIPAL = config.MAX_SESSIONS_PER_PRINCIPAL;
    
    // Configurable idle timeout (in minutes)
    const idleTimeoutMinutes = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '5', 10);
    this.IDLE_TIMEOUT = idleTimeoutMinutes * 60 * 1000;
    
    // Cleanup runs at half the idle timeout (or 2 minutes minimum)
    this.CLEANUP_INTERVAL = Math.max(Math.floor(this.IDLE_TIMEOUT / 5), 2 * 60 * 1000);
    
    logger.info(`[ConnectionPool] Max concurrent sessions: ${this.MAX_CONCURRENT_SESSIONS}`);
    if (this.MAX_SESSIONS_PER_PRINCIPAL !== undefined) {
      logger.info(`[ConnectionPool] Max sessions per principal: ${this.MAX_SESSIONS_PER_PRINCIPAL}`);
    }
    logger.info(`[ConnectionPool] Session idle timeout: ${idleTimeoutMinutes} minutes`);
    logger.info(`[ConnectionPool] Cleanup interval: ${Math.floor(this.CLEANUP_INTERVAL / 1000)}s`);
    
    // Initialize asynchronously (force close stale connections, then start cleanup timer)
    // Store the promise so callers can await it if needed
    this.initializationPromise = this.initialize();
  }

  /**
   * Async initialization: force close stale connections, then start cleanup timer
   * This ensures cleanup completes before any connections are accepted
   */
  private async initialize(): Promise<void> {
    // Force close any stale connections from previous instance
    await this.forceCloseStaleConnections();
    
    // Start periodic cleanup of idle connections
    this.startCleanupTimer();
    
    logger.info('[ConnectionPool] Initialization complete, ready to accept connections');
  }

  /**
   * Wait for connection pool initialization to complete
   * Should be called before accepting any connections
   */
  async waitForInitialization(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Check if connection pool has completed initialization
   * Returns true if pool is ready to accept connections
   */
  isInitialized(): boolean {
    return this.initializationPromise !== null && this.cleanupInterval !== null;
  }

  /**
   * Check if a session has an active connection
   */
  hasConnection(sessionId: string): boolean {
    const conn = this.connections.get(sessionId);
    return conn?.initialized ?? false;
  }

  /**
   * Raw map presence for a session id, regardless of `initialized` state (#171).
   * `hasConnection`/`isLive` are too strict for callers that only need to know
   * whether an entry exists at all (e.g. session_close validating a target),
   * and reaching into the private `connections` Map with an `as any` cast leaks
   * pool internals into tool code. This is the public, type-checked surface for
   * that check. Pure read: unknown ids return false and create no entry.
   */
  has(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Single source of truth for session liveness (#167). Returns true only if
   * the session has an initialized connection that has not passed the idle
   * timeout. Returns false for unknown or expired sessions, and never creates
   * an entry as a side effect. httpServer uses this as a per-request defensive
   * guard against the race where the idle sweep evicts a session while a
   * request for it is already in flight.
   */
  isLive(sessionId: string): boolean {
    const conn = this.connections.get(sessionId);
    if (!conn || !conn.initialized) return false;
    return !this.isExpired(conn);
  }

  /**
   * Single definition of "past the idle window". Shared by isLive and the idle
   * sweep so the two can never disagree about where the boundary is (#167).
   */
  private isExpired(conn: ActualConnection): boolean {
    // #530: a registered session's clock is the later of the entry's lastActivity and its
    // last served request, so a recycled entry cannot make a session look idle.
    return this.isPastIdle(Math.max(conn.lastActivity, this.registered.get(conn.sessionId) ?? 0));
  }

  /** The one boundary for entries and registrations alike (#167, #530). */
  private isPastIdle(lastActivity: number): boolean {
    return (Date.now() - lastActivity) > this.IDLE_TIMEOUT;
  }

  /**
   * #530: the transport layer registers each HTTP session when it registers the transport,
   * so the pool can time it even while it has no entry. Idempotent; stamps "now".
   */
  registerSession(sessionId: string): void {
    this.registered.set(sessionId, Date.now());
  }

  /**
   * #530: drop a registration (idempotent). Every eviction path calls this itself.
   * #577: also drops the session's per-principal admission. Every session end (DELETE, idle
   * eviction, an evicting shutdown, the orphan sweep) reaches here through the transport's
   * teardown; a non-evicting `shutdownConnection` does not, so the session keeps counting.
   */
  forgetSession(sessionId: string): void {
    this.registered.delete(sessionId);
    // A discovery-only session can end before getConnection takes over its slot.
    this.releaseAdmission(sessionId);
  }

  /**
   * Refresh a session's activity timestamp. Called by the transport layer on
   * every request so the pool's idle clock reflects real usage (#167). Before
   * this, the pool only stamped lastActivity at init/switch, so an actively
   * used session's pool clock never advanced; httpServer kept a parallel
   * activity map to compensate, which is the drift this consolidation removes.
   * No-op for unknown sessions (does NOT create an entry). #530: also stamps the session's
   * registration when it has one, so a session whose entry was dropped stays alive while
   * it is being served (the #378 in-drain touch feeds the same clock). Never registers.
   */
  touch(sessionId: string): void {
    const now = Date.now();
    const conn = this.connections.get(sessionId);
    if (conn) {
      conn.lastActivity = now;
    }
    if (this.registered.has(sessionId)) {
      this.registered.set(sessionId, now);
    }
  }

  /**
   * #530: mark a request as in flight for the session (and touch it). While the count is
   * above zero the orphan sweep leaves the session alone. httpServer calls this on POST only:
   * an open GET event stream is idle by nature and must not pin an orphan.
   */
  beginRequest(sessionId: string): void {
    this.touch(sessionId);
    this.inFlight.set(sessionId, (this.inFlight.get(sessionId) ?? 0) + 1);
  }

  /**
   * #530: the request has ended (response finished or the client went away). Drops the
   * in-flight count and touches, so the idle window starts from the END of a long request,
   * not its start. Idempotent for an unknown or already-evicted session.
   */
  endRequest(sessionId: string): void {
    const n = this.inFlight.get(sessionId);
    if (n !== undefined) {
      if (n <= 1) this.inFlight.delete(sessionId);
      else this.inFlight.set(sessionId, n - 1);
    }
    this.touch(sessionId);
  }

  /**
   * Register a listener invoked when the pool removes a session (idle sweep or
   * explicit close). httpServer registers one that closes the transport and
   * drops its table entries, keeping both tables consistent (#167). Listeners
   * must not throw; any error is logged and swallowed so one bad listener
   * cannot abort the removal of others. #530: the listener also receives the reason
   * (`evicted` for the #167 paths, `orphaned` for the entry-less sweep).
   */
  onSessionEvicted(cb: (sessionId: string, reason: EvictionReason) => void): void {
    this.evictionCallbacks.push(cb);
  }

  private fireEviction(sessionId: string, reason: EvictionReason = 'evicted'): void {
    this.registered.delete(sessionId); // #530: whatever the path, the session is gone
    this.inFlight.delete(sessionId); // #530: a late endRequest finds nothing to decrement
    for (const cb of this.evictionCallbacks) {
      try {
        cb(sessionId, reason);
      } catch (err) {
        logger.error(`[ConnectionPool] Eviction listener threw for session ${sessionId} (ignoring):`, err);
      }
    }
  }

  /**
   * #581: slots held under MAX_CONCURRENT_SESSIONS, optionally leaving one session out: every
   * initialized entry, plus every reservation whose id has no initialized entry (a session that
   * holds both counts once).
   */
  private slotsInUse(exclude?: string): number {
    let n = 0;
    for (const [id, c] of this.connections) if (c.initialized && id !== exclude) n++;
    for (const id of this.reservations) if (id !== exclude && !this.connections.get(id)?.initialized) n++;
    return n;
  }

  /** #581: reservations still waiting for their entry (a count only, see `reservations`). */
  private pendingReservations(): number {
    let n = 0;
    for (const id of this.reservations) if (!this.connections.get(id)?.initialized) n++;
    return n;
  }

  /**
   * #581: take a slot for `sessionId`, synchronously. The count and the add have no `await`
   * between them, which is the whole fix: parallel callers cannot all see the same count.
   * A session that already holds a slot (an initialized entry or a reservation) reserves again
   * without counting twice, which is how switchBudget keeps its slot across its slow path.
   * Every successful call must be paired with `releaseReservation` on the caller's exit path;
   * `getConnection` hands a reservation over to the entry on success.
   */
  reserveSession(sessionId: string): boolean {
    return this.admitSession(sessionId).admitted;
  }

  /**
   * #577: `reserveSession` plus the per-principal cap, in the same synchronous call. The global
   * check runs first, then the per-principal one; a refusal of either scope records nothing.
   * Only the initialize route passes a principal, and only for a request that is capped (see
   * `capPrincipal` in httpServer.ts); every other caller is bounded by the global cap alone.
   * A principal refusal carries the caller's own cap and count and nothing about anyone else.
   */
  admitSession(sessionId: string, principal?: string): AdmissionResult {
    const holds = this.reservations.has(sessionId) || this.connections.get(sessionId)?.initialized === true;
    if (!holds && this.slotsInUse() >= this.MAX_CONCURRENT_SESSIONS) return { admitted: false, scope: 'global' };
    const cap = this.MAX_SESSIONS_PER_PRINCIPAL;
    const capped = principal !== undefined && cap !== undefined;
    if (capped && !this.admissions.has(sessionId)) {
      const count = this.principalSessions(principal);
      if (count >= cap) return { admitted: false, scope: 'principal', cap, count };
    }
    this.reservations.add(sessionId);
    if (capped) this.admissions.set(sessionId, principal);
    return { admitted: true };
  }

  /** #577: sessions admitted under `principal` (iterated, see `admissions`). */
  private principalSessions(principal: string): number {
    let n = 0;
    for (const p of this.admissions.values()) if (p === principal) n++;
    return n;
  }

  /** #581: give back a slot that never became an entry. Idempotent; a no-op after the hand-over. */
  releaseReservation(sessionId: string): void {
    this.reservations.delete(sessionId);
  }

  /**
   * Give back both the global reservation and any per-principal admission on failed
   * initialize or session teardown. Idempotent after getConnection takes over the slot.
   */
  releaseAdmission(sessionId: string): void {
    this.reservations.delete(sessionId);
    this.admissions.delete(sessionId);
  }

  /**
   * Read-only view of the pool entry for a session. Used by switchBudget to
   * compare the incoming budget's auth descriptor against the current entry's
   * descriptor before deciding whether to reuse (fast path) or release+recreate
   * (slow path). See #172.
   */
  getConnectionInfo(sessionId: string): Readonly<ActualConnection> | undefined {
    return this.connections.get(sessionId);
  }

  /**
   * Update the syncId tracked on a pool entry after a successful in-place
   * downloadBudget(newSyncId) call. switchBudget's fast path uses this so
   * subsequent comparisons reflect the loaded budget. See #172.
   */
  /**
   * #349 (review follow-up): invalidate the tracked syncId on EVERY entry.
   *
   * `@actual-app/api` is a process-global singleton with ONE loaded budget, while
   * this pool tracks up to MAX_CONCURRENT_SESSIONS entries that each carry their
   * own `syncId`. An import performed by session A therefore changes the loaded
   * budget for sessions B..N as well, but only A knows it happened. Invalidating
   * A alone leaves B's next switchBudget matching the #172 fast path against a
   * record that is no longer true, returning success while B operates on A's
   * imported budget: the same failure #349 fixed, arriving from a direction the
   * user cannot see.
   *
   * Returns the number of entries invalidated, for logging.
   */
  invalidateAllLoadedSyncIds(sentinel: string): number {
    let n = 0;
    for (const entry of this.connections.values()) {
      entry.syncId = sentinel;
      n += 1;
    }
    return n;
  }

  updateLoadedSyncId(sessionId: string, newSyncId: string): void {
    const entry = this.connections.get(sessionId);
    if (entry) {
      entry.syncId = newSyncId;
      entry.lastActivity = Date.now();
    }
  }

  /**
   * Get or create a connection for an MCP session.
   *
   * Optional `budgetOverride` lets callers bind the new pool entry to a
   * specific budget (used by `switchBudget` in actual-adapter.ts so the
   * post-switch entry hits the correct upstream). Without it, defaults
   * come from env (`ACTUAL_SERVER_URL` / `ACTUAL_PASSWORD` / `ACTUAL_BUDGET_SYNC_ID`
   * / `ACTUAL_BUDGET_PASSWORD`), matching pre-#172 behaviour. See #172.
   */
  async getConnection(
    sessionId: string,
    budgetOverride?: { serverUrl: string; password: string; syncId: string; encryptionPassword?: string },
  ): Promise<void> {
    let conn = this.connections.get(sessionId);

    if (conn && conn.initialized) {
      conn.lastActivity = Date.now();
      logger.debug(`[ConnectionPool] Reusing connection for session: ${sessionId}`);
      return;
    }

    // Check concurrent session limit. #581: against every OTHER session's slot, reservations
    // included, and take this session's slot in the same synchronous block, so a caller that
    // did not reserve first (switchBudget's slow path, a non-HTTP caller) is just as atomic as
    // the initialize route. A caller that already reserved keeps its reservation.
    const activeConnections = this.slotsInUse(sessionId);
    if (activeConnections >= this.MAX_CONCURRENT_SESSIONS) {
      const errorMsg = `[ConnectionPool] Max concurrent sessions (${this.MAX_CONCURRENT_SESSIONS}) reached. Active: ${activeConnections}. Please close some connections or wait for idle sessions to timeout.`;
      logger.warn(errorMsg);
      throw new Error(errorMsg);
    }

    // Create new connection for this session
    logger.info(`[ConnectionPool] Creating Actual connection for session: ${sessionId} (${activeConnections + 1}/${this.MAX_CONCURRENT_SESSIONS})`);

    const SERVER_URL = budgetOverride?.serverUrl ?? config.ACTUAL_SERVER_URL;
    const PASSWORD = budgetOverride?.password ?? config.ACTUAL_PASSWORD;
    const BUDGET_SYNC_ID = budgetOverride?.syncId ?? config.ACTUAL_BUDGET_SYNC_ID;
    // #571: an override carries its own budget's encryption password, absent included. Falling back
    // to the default budget's would bind a budget from another server to a password it never had.
    const BUDGET_PASSWORD = budgetOverride ? budgetOverride.encryptionPassword : process.env.ACTUAL_BUDGET_PASSWORD;

    // Use shared data directory so changes persist across sessions
    // This is critical: all sessions must share the same database to avoid data loss
    const DATA_DIR = config.MCP_BRIDGE_DATA_DIR || DEFAULT_DATA_DIR;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // #581: taken here, still with no `await` since the check above, so that a throw before the
    // try (the mkdir) cannot leave a slot behind; the catch below releases it on any failure.
    this.reservations.add(sessionId);
    try {
      // #390 round 2: hold the api mutex across init + download.
      //
      // Recording the loaded budget and checking it inside the lock only NARROWED the race
      // while this mutator stayed outside it. Reproduced: a pooled read passed the
      // precondition, parked at an await still holding the lock, a new session opened here on
      // a different budget, and the first session's raw call then executed against it. The
      // window is not small: it is the whole duration of an operation, and since #378 made the
      // drain sequential, the whole duration of a batch, with one check at the start.
      //
      // Safe against the non-reentrant mutex: the two callers of getConnection
      // (actualConnection's session-open helper and switchBudget's slow path) are both OUTSIDE
      // any withApiLock block. switchBudget's own downloadBudget takes the lock separately and
      // has already released it before it reaches here.
      await withApiLock(async () => {
      // Bound the session-open init/download (#270): this is the HTTP exposure.
      // A stalled upstream here would otherwise hang session open unbounded and,
      // because the api singleton is process-global, wedge other sessions too.
      await initApiLoggedIn(DATA_DIR, { serverUrl: SERVER_URL, password: PASSWORD || '' }, 'pool init');

      logger.info(`[ConnectionPool] Downloading budget for session: ${sessionId}`);

      // #390: the shared tracked loader, not a hand-written download. It clears the record
      // BEFORE starting and keeps an abandoned load registered, so a session-open download that
      // outruns ACTUAL_OP_TIMEOUT_MS cannot silently re-point the singleton later.
      await loadBudgetTracked(BUDGET_SYNC_ID, BUDGET_PASSWORD, 'pool downloadBudget');

      // Mark the singleton as live only AFTER the budget is downloaded (#270):
      // setting it before downloadBudget left a poisoning window where the
      // adapter's pool-cooperation branch could reuse a connection whose budget
      // never loaded (a stalled/failed download would leak isApiInitialized=true).
      setApiInitialized(true);
      }); // #390: end of the api-mutex block. Everything after this is pool bookkeeping and
          // touches no singleton state, so it does not need the lock.

      conn = {
        sessionId,
        initialized: true,
        lastActivity: Date.now(),
        dataDir: DATA_DIR,
        // Track auth descriptor + currently-loaded budget on the pool entry
        // so switchBudget can decide whether to reuse this entry (#172).
        serverUrl: SERVER_URL,
        password: PASSWORD,
        encryptionPassword: BUDGET_PASSWORD,
        syncId: BUDGET_SYNC_ID,
      };

      // #581: the hand-over. Both in one synchronous block, so the slot is never counted twice
      // (entry plus reservation) or not at all.
      this.connections.set(sessionId, conn);
      this.reservations.delete(sessionId);
      logger.info(`[ConnectionPool] Connection ready for session: ${sessionId}`);

    } catch (err) {
      logger.error(`[ConnectionPool] Failed to initialize connection for session ${sessionId}:`, err);

      // Clean up the failed connection attempt
      // Try to shutdown the API to leave it in a clean state for the next attempt.
      //
      // #390 round 3: UNDER THE MUTEX, like the init above it. Locking the mutator and leaving
      // its compensating mutator unlocked closes nothing: reproduced as this cleanup's
      // api.shutdown() firing while ANOTHER session's operation was in flight inside the lock,
      // so that operation observed a torn-down api. The lock is re-acquired rather than held
      // across the whole try, because the init block released it on the way out and this
      // function is never called from inside a lock (both callers are outside one).
      // #393 review: the lock ITSELF can reject now (it settles an abandoned budget load on
      // acquisition), and this is a CLEANUP path. If that rejection escaped, `setApiInitialized(false)`
      // and the connections.delete below would be skipped and the caller would receive
      // "abandoned budget load timed out" instead of the real session-open failure. Cleanup
      // must not be able to fail louder than the thing it is cleaning up after, so the whole
      // acquisition is swallowed here, not just the shutdown call.
      await withApiLock(async () => {
        const maybeApi = api as unknown as { shutdown?: Function };
        if (typeof maybeApi.shutdown === 'function') {
          await (maybeApi.shutdown as () => Promise<unknown>)();
          logger.debug(`[ConnectionPool] Cleaned up failed connection for session: ${sessionId}`);
        }
      }).catch((cleanupErr) => {
        logger.debug(`[ConnectionPool] Error during cleanup (ignoring): ${cleanupErr}`);
      });
      // Singleton is back to torn-down state regardless of cleanup outcome.
      setApiInitialized(false);

      // Ensure this session is not in the connections map
      this.connections.delete(sessionId);
      // #581: and holds no slot.
      this.reservations.delete(sessionId);

      throw err;
    }
  }

  /**
   * Get or create the shared/fallback connection (for backward compatibility)
   */
  async getSharedConnection(): Promise<void> {
    if (this.sharedConnection?.initialized) {
      this.sharedConnection.lastActivity = Date.now();
      return;
    }

    logger.info('[ConnectionPool] Creating shared Actual connection');
    
    const SERVER_URL = config.ACTUAL_SERVER_URL;
    const PASSWORD = config.ACTUAL_PASSWORD;
    const BUDGET_SYNC_ID = config.ACTUAL_BUDGET_SYNC_ID;
    const BUDGET_PASSWORD = process.env.ACTUAL_BUDGET_PASSWORD;
    const DATA_DIR = config.MCP_BRIDGE_DATA_DIR || DEFAULT_DATA_DIR;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    try {
      // #390 round 2: same reasoning as getConnection above; this mutates the same
      // process-global singleton, so it takes the same mutex.
      await withApiLock(async () => {
      // Bound the session-open init/download (#270), same as getConnection.
      await initApiLoggedIn(DATA_DIR, { serverUrl: SERVER_URL, password: PASSWORD || '' }, 'pool init');

      // #390: the shared tracked loader, not a hand-written download. It clears the record
      // BEFORE starting and keeps an abandoned load registered, so a session-open download that
      // outruns ACTUAL_OP_TIMEOUT_MS cannot silently re-point the singleton later.
      await loadBudgetTracked(BUDGET_SYNC_ID, BUDGET_PASSWORD, 'pool downloadBudget');

      // Mark live only after a successful download (#270): avoids the poisoning
      // window where a stalled/failed download would leak isApiInitialized=true.
      setApiInitialized(true);
      }); // #390: end of the api-mutex block.

      this.sharedConnection = {
        sessionId: 'shared',
        initialized: true,
        lastActivity: Date.now(),
        dataDir: DATA_DIR,
        serverUrl: SERVER_URL,
        password: PASSWORD,
        encryptionPassword: BUDGET_PASSWORD,
        syncId: BUDGET_SYNC_ID,
      };

      logger.info('[ConnectionPool] Shared connection ready');

    } catch (err) {
      logger.error('[ConnectionPool] Failed to initialize shared connection:', err);
      setApiInitialized(false);
      throw err;
    }
  }

  /**
   * Shutdown connection for a specific session.
   *
   * `opts.evict` controls whether eviction listeners fire (#167). Pass `true`
   * when the session itself is ending (idle sweep, explicit session close) so
   * the transport layer tears down its transport. Leave it false (default) when
   * the pool entry is being recycled but the MCP session continues, e.g.
   * switchBudget's slow path which shuts the entry down and immediately
   * recreates it, or an infra-error drop where the next request re-establishes
   * the connection: in those cases the transport must survive.
   */
  async shutdownConnection(sessionId: string, opts: { evict?: boolean; onlyIfExpired?: boolean } = {}): Promise<void> {
    // #392: acquire the api mutex, because this calls api.shutdown() on the PROCESS-GLOBAL
    // singleton. Without it, the idle sweep or an explicit session close can tear the api down
    // while ANOTHER session's operation is in flight inside the lock, and that operation then
    // observes a torn-down api. Reproduced during #390's security review for the sibling cleanup
    // site, which #390 fixed; these were the paths it left behind.
    //
    // NOT reentrant, so this variant is for callers that do NOT hold the lock. Callers that DO
    // must call shutdownConnectionLocked directly; wrapping there would deadlock, and the symptom
    // is a ~30s stall ended by #270's timeout rather than an obvious hang. The audit of which is
    // which is recorded on shutdownConnectionLocked.
    // #392 review (BLOCKING): the acquisition itself can REJECT. Since #393, taking the api lock
    // settles any abandoned budget load and THROWS on timeout, so this wrapper gained a rejection
    // path the old body never had (it was try/catch/finally end to end). Its callers are cleanup
    // paths that do not expect one: `cleanupIdleConnections` is invoked from `setInterval`
    // unawaited, and "abandoned budget load timed out" is not in `rejection-allowlist.ts`, so the
    // escape reached `src/index.ts`'s unhandledRejection handler and called process.exit(1). That
    // is the exact defect #393 fixed one level up in the write drain, reintroduced at a new
    // acquisition site.
    //
    // So the acquisition is swallowed, matching the established pattern in the session-open
    // cleanup above: cleanup must not fail louder than the thing it is cleaning up after.
    // The entry is still torn down on that path, unless the caller asked for expiry to be
    // re-checked and the session came back, which is the sweep's own contract. Tearing down
    // matters because a stuck load must not make idle sessions un-evictable: the pool would fill
    // to MAX_CONCURRENT_SESSIONS and start refusing new sessions with nothing in the log saying
    // why. The unlocked shutdown in this handler is acceptable for a specific reason worth
    // stating: while a registration is stuck, EVERY lock acquisition throws, so no operation can
    // be running inside the lock at the moment this path fires.
    await withApiLock(() => this.shutdownConnectionLocked(sessionId, opts)).catch(async (err) => {
      logger.error(
        `[ConnectionPool] Could not acquire the api lock to shut down ${sessionId}; ` +
          `tearing the entry down without it: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.shutdownConnectionLocked(sessionId, { ...opts, expectUnlocked: true }).catch(() => { /* cleanup is best effort */ });
    });
  }

  /**
   * The body of shutdownConnection, for callers that ALREADY hold the api mutex.
   *
   * #392 call-site audit, done explicitly rather than by inspection because the mutex is not
   * reentrant and getting it wrong produces a stall that reads as a slow upstream server:
   *
   *   HOLDS the lock, so calls this variant:
   *     - actual-adapter withActualApi pooled branch, infra-error drop
   *     - actual-adapter withActualApiWrite, sync failure and infra-error drop
   *     - actual-adapter processWriteQueue drain, sync failure and batch error
   *   Does NOT hold it, so calls the wrapping shutdownConnection:
   *     - actual-adapter switchBudget slow path (its own withApiLock block has closed by then)
   *     - actualConnection.shutdownActualForSession (session close)
   *     - this.cleanupIdleConnections (the idle sweep)
   *
   *   Since #412, `shutdownAll` HOLDS the lock (one acquisition for the whole teardown instead of
   *   one per session) and therefore calls this variant directly. Its fallback path runs unlocked
   *   on purpose and passes `expectUnlocked` to say so.
   */
  async shutdownConnectionLocked(sessionId: string, opts: { evict?: boolean; onlyIfExpired?: boolean; expectUnlocked?: boolean } = {}): Promise<void> {
    // #411: assert the precondition rather than documenting it. The audit above says which callers
    // hold the lock; this is what keeps that audit true as call sites are added.
    //
    // A WARNING, not a throw, and deliberately so: this is reached from cleanup paths, and a false
    // positive that threw would turn a tidy-up into an outage, which is a worse trade than the
    // hazard it guards. The nearest legitimate exception is the fallback in shutdownConnection
    // itself, which runs unlocked ON PURPOSE when the acquisition failed, so it passes
    // `expectUnlocked` to say so.
    if (!opts.expectUnlocked && !isApiLockHeld()) {
      logger.warn(
        `[ConnectionPool] shutdownConnectionLocked called for ${sessionId} without the api mutex. ` +
          'Callers that do not hold it must use shutdownConnection, which acquires it.',
      );
    }
    const conn = this.connections.get(sessionId);

    // #392 review: the idle sweep decides who is expired BEFORE waiting for the mutex, and that
    // wait is no longer negligible. Re-checking here means a session that was touched while we
    // queued keeps its connection instead of being closed mid-conversation.
    if (opts.onlyIfExpired && conn && !this.isExpired(conn)) {
      logger.debug(`[ConnectionPool] ${sessionId} was touched while waiting for the api lock; not evicting`);
      return;
    }

    if (!conn || !conn.initialized) {
      return;
    }

    logger.info(`[ConnectionPool] Shutting down connection for session: ${sessionId}`);

    try {
      // Singleton-level guard (#164): skip api.shutdown() when the @actual-app/api
      // singleton is already torn down (e.g. a prior session's shutdown in a
      // sequential shutdownAll). Double-shutdown surfaces as "not initialized".
      // The finally block below still runs so the #167 cleanup/eviction contract
      // is preserved.
      const maybeApi = api as unknown as { shutdown?: Function };
      if (typeof maybeApi.shutdown === 'function' && isApiInitialized()) {
        await (maybeApi.shutdown as () => Promise<unknown>)();
      }

      logger.info(`[ConnectionPool] Connection shutdown complete for session: ${sessionId}`);

    } catch (err) {
      logger.error(`[ConnectionPool] Error shutting down connection for session ${sessionId}:`, err);
    } finally {
      // Remove the entry in all cases so liveness can never report a session
      // alive after its shutdown was attempted. On error the singleton is in
      // an unknown state, so we must not leave it reusable either.
      conn.initialized = false;
      this.connections.delete(sessionId);
      setApiInitialized(false);

      // NOTE: We do NOT delete the data directory because it's shared across all sessions
      // Deleting it would cause data loss for other active sessions

      if (opts.evict) {
        this.fireEviction(sessionId);
      }
    }
  }

  /**
   * Acquire the mutex and tear down the shared connection.
   *
   * #412 left this with NO caller in `src/`: `shutdownAll` now holds the lock itself and calls the
   * Locked variant. It is kept, rather than deleted, because `USE_CONNECTION_POOL=false` uses the
   * shared connection and a future teardown path for it must not hand-roll the acquisition. That
   * is a deliberate decision rather than an oversight: knip does not analyse class members, so
   * nothing else would have flagged it, and CLAUDE.md's own lesson from `adapter.deleteRule` is
   * that a callerless wrapper left reachable is how the next caller finds the unguarded path.
   */
  async shutdownSharedConnection(): Promise<void> {
    await withApiLock(() => this.shutdownSharedConnectionLocked()).catch(async (err) => {
      logger.error(
        `[ConnectionPool] Could not acquire the api lock to shut down the shared connection; ` +
          `tearing it down without it: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.shutdownSharedConnectionLocked().catch(() => { /* cleanup is best effort */ });
    });
  }

  /** The body of shutdownSharedConnection, for callers that already hold the api mutex. */
  async shutdownSharedConnectionLocked(opts: { expectUnlocked?: boolean } = {}): Promise<void> {
    // #411: same precondition check as shutdownConnectionLocked. Round 2 pointed out that keeping
    // the callerless wrapper (M3) is only defensible if the guard that would catch a future
    // hand-rolled caller exists on BOTH variants.
    if (!opts.expectUnlocked && !isApiLockHeld()) {
      logger.warn(
        '[ConnectionPool] shutdownSharedConnectionLocked called without the api mutex. ' +
          'Callers that do not hold it must use shutdownSharedConnection, which acquires it.',
      );
    }
    if (!this.sharedConnection?.initialized) {
      return;
    }

    logger.info('[ConnectionPool] Shutting down shared connection');

    try {
      // Singleton-level guard (#164): skip when already torn down.
      const maybeApi = api as unknown as { shutdown?: Function };
      if (typeof maybeApi.shutdown === 'function' && isApiInitialized()) {
        await (maybeApi.shutdown as () => Promise<unknown>)();
      }

      this.sharedConnection.initialized = false;
      this.sharedConnection = null;
      setApiInitialized(false);

      logger.info('[ConnectionPool] Shared connection shutdown complete');

    } catch (err) {
      logger.error('[ConnectionPool] Error shutting down shared connection:', err);
      setApiInitialized(false);
    }
  }

  /**
   * Force close any stale connections from previous server instance
   * This ensures clean state on restart
   */
  private async forceCloseStaleConnections(): Promise<void> {
    try {
      logger.info('[ConnectionPool] Force closing any stale connections from previous instance');
      
      // Try to shutdown the API if it was left initialized.
      //
      // #411 put this under the api mutex: it was the last api.shutdown() running without it.
      // #416 then separated the two failures it was conflating. The body is a raw api.shutdown(),
      // which can reject on its own, and reporting that as "could not take the api lock" sent the
      // reader to the wrong subsystem while the retry repeated the call that had just failed.
      //
      // So: the guarded shutdown happens INSIDE the lock, matching every other shutdown path
      // (which check isApiInitialized first, per #164, or a second call surfaces as
      // "not initialized"). The catch below therefore genuinely means the ACQUISITION failed, and
      // its fallback runs the same guarded shutdown once, unlocked and best effort.
      const guardedShutdown = async () => {
        if (!isApiInitialized()) return;
        const maybeApi = api as unknown as { shutdown?: Function };
        if (typeof maybeApi.shutdown !== 'function') return;
        try {
          await (maybeApi.shutdown as () => Promise<unknown>)();
          logger.info('[ConnectionPool] Successfully closed stale API connection');
        } catch (shutdownErr) {
          logger.debug(`[ConnectionPool] Stale API connection would not close (ignoring): ${shutdownErr}`);
        } finally {
          setApiInitialized(false);
        }
      };
      await withApiLock(guardedShutdown).catch(async (lockErr) => {
        logger.debug(
          `[ConnectionPool] Could not take the api lock to close a stale connection: ${lockErr}`,
        );
        await guardedShutdown();
      });
    } catch (err) {
      // Ignore errors - connection may not have been initialized
      logger.debug('[ConnectionPool] No stale connections to close (or already closed)');
    }
    
    // Clear any connection state
    this.connections.clear();
    this.sharedConnection = null;
  }

  /**
   * Start periodic cleanup of idle connections.
   *
   * The interval is `unref()`d so it does not keep the Node event loop alive
   * on its own. Without this, importing the pool from a one-shot script
   * (e.g. unit test, `--test-actual-connection`) would prevent natural
   * process exit. The interval still fires while the server runs because
   * other handles (HTTP listener, stdio transport, etc.) keep the loop alive.
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.CLEANUP_INTERVAL);
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up idle connections that haven't been used recently
   */
  private async cleanupIdleConnections(): Promise<void> {
    const connectionsToRemove: string[] = [];

    for (const [sessionId, conn] of this.connections.entries()) {
      if (this.isExpired(conn)) {
        connectionsToRemove.push(sessionId);
      }
    }

    if (connectionsToRemove.length > 0) {
      logger.info(`[ConnectionPool] Cleaning up ${connectionsToRemove.length} idle connections`);
      
      for (const sessionId of connectionsToRemove) {
        // evict: true so the transport layer tears down the matching transport
        // in the same window (#167). This is the path that previously drifted:
        // the pool's autonomous timer removed an entry httpServer's separate
        // timer knew nothing about.
        //
        // #392 review: RE-CHECK expiry, because the decision above was taken before the lock and
        // the eviction now waits for it. Before #392 that wait was effectively zero; since #378
        // made drains sequential, one lock hold is the SUM of a batch's operations, so it is
        // bounded only by batch length times ACTUAL_OP_TIMEOUT_MS. A session that was idle when
        // marked can be active again by the time the lock arrives, and evicting it then closes
        // its transport mid-conversation. Deciding and acting on the same side of the mutex is
        // what makes the decision mean anything.
        await this.shutdownConnection(sessionId, { evict: true, onlyIfExpired: true });
      }
    }

    // #530: registered sessions with no entry. Walked AFTER the entry evictions (each of
    // which already dropped its registration) and synchronously: there is no api call to
    // make, only the transport layer's tables to clear, so the lock is not involved and a
    // request served in the meantime has already stamped the registration. A session with
    // a request still in flight is never an orphan, however long that request runs.
    const orphans: string[] = [];
    for (const [sessionId, lastServed] of this.registered.entries()) {
      if (!this.connections.has(sessionId) && !this.inFlight.has(sessionId) && this.isPastIdle(lastServed)) {
        orphans.push(sessionId);
      }
    }
    if (orphans.length > 0) {
      logger.info(`[ConnectionPool] Reaping ${orphans.length} orphaned sessions (no pool entry, idle for one window)`);
      for (const sessionId of orphans) {
        this.fireEviction(sessionId, 'orphaned');
      }
    }
  }

  /**
   * Shutdown all connections and stop cleanup timer
   */
  async shutdownAll(): Promise<void> {
    logger.info('[ConnectionPool] Shutting down all connections');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Shut sessions down SEQUENTIALLY, not via Promise.all (#164). Each call
    // hits the process-global @actual-app/api singleton; running them
    // concurrently meant N calls reached api.shutdown() before any of their
    // finally blocks set the singleton flag false, double-shutting-down the
    // singleton ("not initialized" during graceful shutdown). Sessions are few
    // (15 max) and shutdown is rare, so sequential is fine. The first call does
    // the real shutdown; the isApiInitialized() guard makes the rest no-ops.
    // #412: ONE acquisition for the whole teardown, not one per session.
    //
    // Since #392 each shutdownConnection takes the api mutex, and since #393 acquiring it settles
    // any abandoned budget load, bounded, and throws on timeout while KEEPING the registration. So
    // with a stuck load, N sessions cost N times ACTUAL_OP_TIMEOUT_MS: 15 sessions at the 30s
    // default is 450 seconds, and Docker sends SIGKILL after a 10 second grace period. The
    // container died with a page of "could not acquire" lines and no clean api.shutdown().
    //
    // Acquiring once also makes the teardown ONE critical section rather than 16, which is more
    // correct: nothing can interleave between the sessions being torn down.
    //
    // Swallowed for the same reason the per-session wrapper swallows: this is a cleanup path, and
    // a stuck load must not stop the entries being removed. The fallback repeats the loop with the
    // Locked variants, which is safe because nothing can be holding the lock while a registration
    // is stuck (every acquisition throws in that state).
    const teardown = async (expectUnlocked = false) => {
      // Snapshot the keys: shutdownConnectionLocked deletes from `connections`.
      for (const sessionId of [...this.connections.keys()]) {
        await this.shutdownConnectionLocked(sessionId, { expectUnlocked });
      }
      if (this.sharedConnection?.initialized) {
        await this.shutdownSharedConnectionLocked({ expectUnlocked });
      }
    };
    await withApiLock(() => teardown()).catch(async (err) => {
      logger.error(
        `[ConnectionPool] Could not acquire the api lock for shutdownAll; tearing down without it: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // `expectUnlocked`: this path runs without the mutex ON PURPOSE, so #411's warning would
      // otherwise fire once per session at the exact moment the code chose not to take it.
      await teardown(true).catch(() => { /* cleanup is best effort */ });
    });

    this.registered.clear(); // #530: the transport layer is going down with the pool
    this.inFlight.clear();
    logger.info('[ConnectionPool] All connections shut down');
  }

  /**
   * Get idle timeout in minutes
   */
  getIdleTimeoutMinutes(): number {
    return Math.floor(this.IDLE_TIMEOUT / 60000);
  }

  /**
   * Get connection statistics
   */
  getStats(): { 
    totalSessions: number; 
    activeSessions: number;
    pendingReservations: number;
    maxConcurrent: number;
    sharedConnection: boolean;
    sessions: Array<{ sessionId: string; lastActivity: Date; idleMinutes: number }>;
  } {
    const now = Date.now();
    const sessions = Array.from(this.connections.entries()).map(([id, conn]) => ({
      sessionId: id, // Return full session ID so session_close can use it
      lastActivity: new Date(conn.lastActivity),
      idleMinutes: Math.floor((now - conn.lastActivity) / 60000)
    }));

    return {
      totalSessions: this.connections.size,
      activeSessions: Array.from(this.connections.values()).filter(c => c.initialized).length,
      pendingReservations: this.pendingReservations(),
      maxConcurrent: this.MAX_CONCURRENT_SESSIONS,
      sharedConnection: this.sharedConnection?.initialized || false,
      sessions
    };
  }
}

/** #577: the outcome of `admitSession`. A refusal records nothing. */
export type AdmissionResult =
  | { admitted: true }
  | { admitted: false; scope: 'global' }
  | { admitted: false; scope: 'principal'; cap: number; count: number };

// Export singleton instance
export const connectionPool = new ActualConnectionPool();

// NOTE: Process shutdown handlers are managed by the server (httpServer.ts)
// to ensure proper cleanup order. The connection pool should NOT have its own SIGTERM/SIGINT handlers
// as they would call process.exit() and prevent the server's cleanup from running.
