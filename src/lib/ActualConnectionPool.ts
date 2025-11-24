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
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private sharedConnection: ActualConnection | null = null;

  constructor() {
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
   * Get or create a connection for an MCP session
   */
  async getConnection(sessionId: string): Promise<void> {
    let conn = this.connections.get(sessionId);
    
    if (conn && conn.initialized) {
      conn.lastActivity = Date.now();
      logger.debug(`[ConnectionPool] Reusing connection for session: ${sessionId}`);
      return;
    }

    // Create new connection for this session
    logger.info(`[ConnectionPool] Creating Actual connection for session: ${sessionId}`);
    
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
   * Get connection statistics
   */
  getStats(): { activeConnections: number; sharedConnection: boolean } {
    return {
      activeConnections: this.connections.size,
      sharedConnection: this.sharedConnection?.initialized || false
    };
  }
}

// Export singleton instance
export const connectionPool = new ActualConnectionPool();

// NOTE: Process shutdown handlers are managed by the server (httpServer.ts, wsServer.ts, sseServer.ts)
// to ensure proper cleanup order. The connection pool should NOT have its own SIGTERM/SIGINT handlers
// as they would call process.exit() and prevent the server's cleanup from running.
