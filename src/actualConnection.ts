import fs from 'fs';
import path from 'path';
import os from 'os';
import api from '@actual-app/api';
import { loadBudgetTracked } from './lib/budgetLoader.js';
import { withApiLock } from './lib/apiLock.js';
import { withOpTimeout } from './lib/opTimeout.js';
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
  // #396: reset before each attempt. It was set on failure and NEVER cleared, so once the
  // silent-success bug is fixed and a bad load throws routinely, a single failure would poison
  // every later session open for the process lifetime: a concurrent caller arriving while
  // `initializing` is true rethrows whatever was left here.
  initializationError = null;

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

    // #396: this is the SIXTH budget load site, and it is production reachable. Revision 0 of
    // that ticket claimed it was `--test-actual-connection` only; it is not.
    // `connectToActualForSession` below falls through to this function whenever
    // USE_CONNECTION_POOL=false (a documented, supported variable), and httpServer calls it on
    // every HTTP session open. It used to hand-write the download and record the loaded syncId
    // UNCONDITIONALLY, so it had none of the guarantees the other five sites have.
    //
    // The lock is acquired HERE, around init plus load only, mirroring
    // ActualConnectionPool.getConnection. Never around the `while (initializing)` spin-wait
    // above: that would hold the mutex while waiting for its holder and deadlock. No caller of
    // this function holds the api lock, so this acquisition is safe.
    //
    // This is NOT behaviour neutral, and that is intended: the download becomes bounded by
    // ACTUAL_OP_TIMEOUT_MS with abandon-not-cancel semantics, and becomes a registered load that
    // later lock acquisitions wait for. Both match what the pool sites already do.
    await withApiLock(async () => {
      // #396 review: BOUND the init. It was unbounded here before, which was survivable only
      // because this call held no lock. Now that it does, an unbounded stalled login would never
      // settle, `.finally(release)` would never run, and the process-global api mutex would be
      // wedged permanently for every session: the exact #270 class. Both pool sites already bound
      // their `api.init` this way, and this was the only `api.init` in the repo that did not.
      await withOpTimeout(() => api.init({
        dataDir: DATA_DIR,
        serverURL: SERVER_URL,
        password: PASSWORD,
      }), 'connectToActual init');

      log.info(`Downloading budget with sync ID: ${BUDGET_SYNC_ID}`);

      await loadBudgetTracked(BUDGET_SYNC_ID, BUDGET_PASSWORD);
    });

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
    // Ensure connection pool initialization is complete before accepting connections
    await connectionPool.waitForInitialization();
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
    // evict: true so the pool tears down the matching httpServer transport too
    // (#167). This wrapper is only used for session-ending events (explicit
    // session_close, server shutdown); the adapter's switchBudget / infra-drop
    // paths call connectionPool.shutdownConnection directly without evict so the
    // transport survives a budget switch or transient error.
    await connectionPool.shutdownConnection(sessionId, { evict: true });
    logger.info(`Actual API connection shutdown for session: ${sessionId}`);
  } catch (err) {
    logger.error(`Error shutting down Actual for session ${sessionId}:`, err);
  }
}

export function getConnectionState() {
  // When using connection pooling, consider server initialized if pool is ready
  // (even with 0 active connections, pool being initialized means server is ready to accept sessions)
  const isPoolInitialized = useConnectionPool && connectionPool.isInitialized();
  const effectivelyInitialized = useConnectionPool ? isPoolInitialized : initialized;
  
  return {
    initialized: effectivelyInitialized,
    initializationError,
    connectionPool: useConnectionPool ? connectionPool.getStats() : null,
    idleTimeoutMinutes: useConnectionPool ? connectionPool.getIdleTimeoutMinutes() : null,
  };
}

export function canAcceptNewSession(): boolean {
  if (!useConnectionPool) {
    return true; // Shared connection mode - always accept
  }
  return connectionPool.canAcceptNewSession();
}
