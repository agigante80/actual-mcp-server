import fs from 'fs';
import path from 'path';
import os from 'os';
import api from '@actual-app/api';
import logger from './logger.js';
import config from './config.js';
import { connectionPool } from './lib/ActualConnectionPool.js';
import { createModuleLogger } from './lib/loggerFactory.js';

const log = createModuleLogger('CONNECTION');

const DEFAULT_DATA_DIR = path.resolve(os.homedir() || '.', '.actual');

let initialized = false;
let initializing = false;
let initializationError: Error | null = null;
// Feature flag to enable connection pooling - can be disabled via environment variable
let useConnectionPool = process.env.USE_CONNECTION_POOL !== 'false';

export async function connectToActual() {
  if (initialized) return;
  if (initializing) {
    while (initializing) await new Promise(r => setTimeout(r, 100));
    if (initializationError) throw initializationError;
    return;
  }
  initializing = true;

  try {
  const SERVER_URL = config.ACTUAL_SERVER_URL;
  const PASSWORD = config.ACTUAL_PASSWORD;
  const BUDGET_SYNC_ID = config.ACTUAL_BUDGET_SYNC_ID;
  const BUDGET_PASSWORD = process.env.ACTUAL_BUDGET_PASSWORD; // optional for E2E encrypted budgets
  const TEST_ACTUAL_CONNECTION = process.argv.includes('--test-actual-connection');

  // Use configured MCP_BRIDGE_DATA_DIR (fallback to DEFAULT_DATA_DIR) for all runs
  const DATA_DIR = config.MCP_BRIDGE_DATA_DIR || DEFAULT_DATA_DIR;

  new URL(SERVER_URL);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  log.info(`Initializing Actual API with dataDir=${DATA_DIR}`);

    await api.init({
      dataDir: DATA_DIR,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });

    log.info(`Downloading budget with sync ID: ${BUDGET_SYNC_ID}`);

    // According to official docs, downloadBudget accepts optional second parameter for E2E encryption
    if (BUDGET_PASSWORD) {
      const apiWithOptions = api as typeof api & { downloadBudget: (id: string, options?: { password: string }) => Promise<void> };
      await apiWithOptions.downloadBudget(BUDGET_SYNC_ID, { password: BUDGET_PASSWORD });
    } else {
      await api.downloadBudget(BUDGET_SYNC_ID);
    }

    if (TEST_ACTUAL_CONNECTION) {
      logger.info('Test flag detected (--test-actual-connection) — closing Actual session.');

      // Prefer the documented shutdown method only
      try {
        const maybeApi = api as unknown as { shutdown?: Function };
        if (typeof maybeApi.shutdown === 'function') {
          await (maybeApi.shutdown as () => Promise<unknown>)();
        } else {
          logger.warn('No shutdown method found on Actual API; leaving session as-is.');
        }
      } catch (closeErr) {
        logger.error('Error while shutting down Actual session during test run:', closeErr);
      }

      // allow small grace period for any IO to finish before cleanup/exit
      await new Promise((res) => setTimeout(res, 500));

      // no temp data dir cleanup — use persistent MCP_BRIDGE_DATA_DIR as configured

      logger.info('Exiting process after test connection.');
      // exit explicitly for test mode
      process.exit(0);
    }

    initialized = true;
    logger.info('✅ Connected to Actual Finance and downloaded budget');
  } catch (err) {
    initializationError = err instanceof Error ? err : new Error(String(err));
    logger.error('❌ Failed to connect to Actual Finance:', initializationError);
    throw initializationError;
  } finally {
    initializing = false;
  }
}

export async function shutdownActual() {
  if (useConnectionPool) {
    await connectionPool.shutdownAll();
    initialized = false;
    return;
  }
  
  try {
    const maybeApi = api as unknown as { shutdown?: Function };
    if (typeof maybeApi.shutdown === 'function') {
      await (maybeApi.shutdown as () => Promise<unknown>)();
    }
    initialized = false;
    logger.info('Actual API shutdown complete.');
  } catch (err) {
    logger.error('Error during Actual API shutdown:', err);
  }
}

/**
 * Initialize connection for a specific MCP session
 * Uses connection pooling to give each session its own Actual Budget connection
 */
export async function connectToActualForSession(sessionId: string) {
  if (!useConnectionPool) {
    // Fallback to shared connection
    return connectToActual();
  }
  
  try {
    await connectionPool.getConnection(sessionId);
    logger.info(`Actual API connection ready for session: ${sessionId}`);
  } catch (err) {
    logger.error(`Failed to connect to Actual for session ${sessionId}:`, err);
    throw err;
  }
}

/**
 * Shutdown connection for a specific MCP session
 */
export async function shutdownActualForSession(sessionId: string) {
  if (!useConnectionPool) {
    return;
  }
  
  try {
    await connectionPool.shutdownConnection(sessionId);
    logger.info(`Actual API connection shutdown for session: ${sessionId}`);
  } catch (err) {
    logger.error(`Error shutting down Actual for session ${sessionId}:`, err);
  }
}

export function getConnectionState() {
  return {
    initialized,
    initializationError,
    connectionPool: useConnectionPool ? connectionPool.getStats() : null,
  };
}

export function canAcceptNewSession(): boolean {
  if (!useConnectionPool) {
    return true; // Shared connection mode - always accept
  }
  return connectionPool.canAcceptNewSession();
}
