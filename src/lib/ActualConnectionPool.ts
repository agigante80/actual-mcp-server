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

const DEFAULT_DATA_DIR = path.resolve(os.homedir() || '.', '.actual');

interface ActualConnection {
  sessionId: string;
  initialized: boolean;
  lastActivity: number;
  dataDir: string;
}

class ActualConnectionPool {
  private connections: Map<string, ActualConnection> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT: number; // Configurable via SESSION_IDLE_TIMEOUT_MINUTES env var (default: 10 minutes)
  private readonly CLEANUP_INTERVAL: number; // Check frequency (default: 2 minutes)
  private readonly MAX_CONCURRENT_SESSIONS: number; // Configurable via MAX_CONCURRENT_SESSIONS env var (default: 1)
  private sharedConnection: ActualConnection | null = null;

  constructor() {
    // Read from environment variable or default to 3
    // @actual-app/api is a singleton, so concurrent sessions cause conflicts
    this.MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS || '3', 10);
    
    // Configurable idle timeout (in minutes)
    const idleTimeoutMinutes = parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '2', 10);
    this.IDLE_TIMEOUT = idleTimeoutMinutes * 60 * 1000;
    
    // Cleanup runs at half the idle timeout (or 2 minutes minimum)
    this.CLEANUP_INTERVAL = Math.max(Math.floor(this.IDLE_TIMEOUT / 5), 2 * 60 * 1000);
    
    logger.info(`[ConnectionPool] Max concurrent sessions: ${this.MAX_CONCURRENT_SESSIONS}`);
    logger.info(`[ConnectionPool] Session idle timeout: ${idleTimeoutMinutes} minutes`);
    logger.info(`[ConnectionPool] Cleanup interval: ${Math.floor(this.CLEANUP_INTERVAL / 1000)}s`);
    
    // Force close any stale connections from previous instance
    this.forceCloseStaleConnections();
    
    // Start periodic cleanup of idle connections
    this.startCleanupTimer();
  }

  /**
   * Check if a session has an active connection
   */
  hasConnection(sessionId: string): boolean {
    const conn = this.connections.get(sessionId);
    return conn?.initialized ?? false;
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
   * Get or create a connection for an MCP session
   */
  async getConnection(sessionId: string): Promise<void> {
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
    
    const SERVER_URL = config.ACTUAL_SERVER_URL;
    const PASSWORD = config.ACTUAL_PASSWORD;
    const BUDGET_SYNC_ID = config.ACTUAL_BUDGET_SYNC_ID;
    const BUDGET_PASSWORD = process.env.ACTUAL_BUDGET_PASSWORD;
    
    // Use shared data directory so changes persist across sessions
    // This is critical - all sessions must share the same database to avoid data loss
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
        dataDir: DATA_DIR
      };

      this.connections.set(sessionId, conn);
      logger.info(`[ConnectionPool] Connection ready for session: ${sessionId}`);
      
    } catch (err) {
      logger.error(`[ConnectionPool] Failed to initialize connection for session ${sessionId}:`, err);
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
        dataDir: DATA_DIR
      };

      logger.info('[ConnectionPool] Shared connection ready');
      
    } catch (err) {
      logger.error('[ConnectionPool] Failed to initialize shared connection:', err);
      throw err;
    }
  }

  /**
   * Shutdown connection for a specific session
   */
  async shutdownConnection(sessionId: string): Promise<void> {
    const conn = this.connections.get(sessionId);
    
    if (!conn || !conn.initialized) {
      return;
    }

    logger.info(`[ConnectionPool] Shutting down connection for session: ${sessionId}`);
    
    try {
      const maybeApi = api as unknown as { shutdown?: Function };
      if (typeof maybeApi.shutdown === 'function') {
        await (maybeApi.shutdown as () => Promise<unknown>)();
      }
      
      conn.initialized = false;
      this.connections.delete(sessionId);
      
      // NOTE: We do NOT delete the data directory because it's shared across all sessions
      // Deleting it would cause data loss for other active sessions
      
      logger.info(`[ConnectionPool] Connection shutdown complete for session: ${sessionId}`);
      
    } catch (err) {
      logger.error(`[ConnectionPool] Error shutting down connection for session ${sessionId}:`, err);
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
      const maybeApi = api as unknown as { shutdown?: Function };
      if (typeof maybeApi.shutdown === 'function') {
        await (maybeApi.shutdown as () => Promise<unknown>)();
      }
      
      this.sharedConnection.initialized = false;
      this.sharedConnection = null;
      
      logger.info('[ConnectionPool] Shared connection shutdown complete');
      
    } catch (err) {
      logger.error('[ConnectionPool] Error shutting down shared connection:', err);
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
   * Start periodic cleanup of idle connections
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Clean up idle connections that haven't been used recently
   */
  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    for (const [sessionId, conn] of this.connections.entries()) {
      if (now - conn.lastActivity > this.IDLE_TIMEOUT) {
        connectionsToRemove.push(sessionId);
      }
    }

    if (connectionsToRemove.length > 0) {
      logger.info(`[ConnectionPool] Cleaning up ${connectionsToRemove.length} idle connections`);
      
      for (const sessionId of connectionsToRemove) {
        await this.shutdownConnection(sessionId);
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

    // Shutdown all session connections
    const shutdownPromises: Promise<void>[] = [];
    for (const sessionId of this.connections.keys()) {
      shutdownPromises.push(this.shutdownConnection(sessionId));
    }
    
    // Shutdown shared connection
    if (this.sharedConnection?.initialized) {
      shutdownPromises.push(this.shutdownSharedConnection());
    }

    await Promise.all(shutdownPromises);
    
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
      sessionId: id.substring(0, 8) + '...',
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

// NOTE: Process shutdown handlers are managed by the server (httpServer.ts, wsServer.ts, sseServer.ts)
// to ensure proper cleanup order. The connection pool should NOT have its own SIGTERM/SIGINT handlers
// as they would call process.exit() and prevent the server's cleanup from running.
