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

const DEFAULT_DATA_DIR = path.resolve(os.homedir() || '.', '.actual');

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
  private evictionCallbacks: Array<(sessionId: string) => void> = [];

  constructor() {
    // Read from environment variable or default to 15
    // @actual-app/api is a singleton, so concurrent sessions cause conflicts
    this.MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '15', 10);
    
    // Configurable idle timeout (in minutes)
    const idleTimeoutMinutes = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '5', 10);
    this.IDLE_TIMEOUT = idleTimeoutMinutes * 60 * 1000;
    
    // Cleanup runs at half the idle timeout (or 2 minutes minimum)
    this.CLEANUP_INTERVAL = Math.max(Math.floor(this.IDLE_TIMEOUT / 5), 2 * 60 * 1000);
    
    logger.info(`[ConnectionPool] Max concurrent sessions: ${this.MAX_CONCURRENT_SESSIONS}`);
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
    return (Date.now() - conn.lastActivity) > this.IDLE_TIMEOUT;
  }

  /**
   * Refresh a session's activity timestamp. Called by the transport layer on
   * every request so the pool's idle clock reflects real usage (#167). Before
   * this, the pool only stamped lastActivity at init/switch, so an actively
   * used session's pool clock never advanced; httpServer kept a parallel
   * activity map to compensate, which is the drift this consolidation removes.
   * No-op for unknown sessions (does NOT create an entry).
   */
  touch(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  }

  /**
   * Register a listener invoked when the pool removes a session (idle sweep or
   * explicit close). httpServer registers one that closes the transport and
   * drops its table entries, keeping both tables consistent (#167). Listeners
   * must not throw; any error is logged and swallowed so one bad listener
   * cannot abort the removal of others.
   */
  onSessionEvicted(cb: (sessionId: string) => void): void {
    this.evictionCallbacks.push(cb);
  }

  private fireEviction(sessionId: string): void {
    for (const cb of this.evictionCallbacks) {
      try {
        cb(sessionId);
      } catch (err) {
        logger.error(`[ConnectionPool] Eviction listener threw for session ${sessionId} (ignoring):`, err);
      }
    }
  }

  /**
   * Check if we can accept a new session (under the concurrent limit)
   * Returns true if limit not reached, false otherwise
   */
  canAcceptNewSession(): boolean {
    const activeConnections = Array.from(this.connections.values()).filter(c => c.initialized).length;
    return activeConnections < this.MAX_CONCURRENT_SESSIONS;
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

    // Check concurrent session limit
    const activeConnections = Array.from(this.connections.values()).filter(c => c.initialized).length;
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
    const BUDGET_PASSWORD = budgetOverride?.encryptionPassword ?? process.env.ACTUAL_BUDGET_PASSWORD;

    // Use shared data directory so changes persist across sessions
    // This is critical: all sessions must share the same database to avoid data loss
    const DATA_DIR = config.MCP_BRIDGE_DATA_DIR || DEFAULT_DATA_DIR;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    try {
      await api.init({
        dataDir: DATA_DIR,
        serverURL: SERVER_URL,
        password: PASSWORD,
      });
      // Mark the singleton as live so the adapter's pool-cooperation branch
      // (withActualApi in actual-adapter.ts) can safely skip its per-op init.
      setApiInitialized(true);

      logger.info(`[ConnectionPool] Downloading budget for session: ${sessionId}`);

      if (BUDGET_PASSWORD) {
        const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
        await apiWithOptions.downloadBudget(BUDGET_SYNC_ID, { password: BUDGET_PASSWORD });
      } else {
        await api.downloadBudget(BUDGET_SYNC_ID);
      }

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

      this.connections.set(sessionId, conn);
      logger.info(`[ConnectionPool] Connection ready for session: ${sessionId}`);

    } catch (err) {
      logger.error(`[ConnectionPool] Failed to initialize connection for session ${sessionId}:`, err);

      // Clean up the failed connection attempt
      // Try to shutdown the API to leave it in a clean state for the next attempt
      try {
        const maybeApi = api as unknown as { shutdown?: Function };
        if (typeof maybeApi.shutdown === 'function') {
          await (maybeApi.shutdown as () => Promise<unknown>)();
          logger.debug(`[ConnectionPool] Cleaned up failed connection for session: ${sessionId}`);
        }
      } catch (cleanupErr) {
        logger.debug(`[ConnectionPool] Error during cleanup (ignoring): ${cleanupErr}`);
      }
      // Singleton is back to torn-down state regardless of cleanup outcome.
      setApiInitialized(false);

      // Ensure this session is not in the connections map
      this.connections.delete(sessionId);

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
      await api.init({
        dataDir: DATA_DIR,
        serverURL: SERVER_URL,
        password: PASSWORD,
      });
      setApiInitialized(true);

      if (BUDGET_PASSWORD) {
        const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
        await apiWithOptions.downloadBudget(BUDGET_SYNC_ID, { password: BUDGET_PASSWORD });
      } else {
        await api.downloadBudget(BUDGET_SYNC_ID);
      }

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
  async shutdownConnection(sessionId: string, opts: { evict?: boolean } = {}): Promise<void> {
    const conn = this.connections.get(sessionId);

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
   * Shutdown the shared connection
   */
  async shutdownSharedConnection(): Promise<void> {
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
      
      // Try to shutdown the API if it was left initialized
      const maybeApi = api as unknown as { shutdown?: Function };
      if (typeof maybeApi.shutdown === 'function') {
        await (maybeApi.shutdown as () => Promise<unknown>)();
        logger.info('[ConnectionPool] Successfully closed stale API connection');
      }
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
        await this.shutdownConnection(sessionId, { evict: true });
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
    // Snapshot the keys: shutdownConnection deletes from `connections`.
    for (const sessionId of [...this.connections.keys()]) {
      await this.shutdownConnection(sessionId);
    }

    if (this.sharedConnection?.initialized) {
      await this.shutdownSharedConnection();
    }

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
      maxConcurrent: this.MAX_CONCURRENT_SESSIONS,
      sharedConnection: this.sharedConnection?.initialized || false,
      sessions
    };
  }
}

// Export singleton instance
export const connectionPool = new ActualConnectionPool();

// NOTE: Process shutdown handlers are managed by the server (httpServer.ts)
// to ensure proper cleanup order. The connection pool should NOT have its own SIGTERM/SIGINT handlers
// as they would call process.exit() and prevent the server's cleanup from running.
