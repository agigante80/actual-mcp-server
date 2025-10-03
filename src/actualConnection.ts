import fs from 'fs';
import path from 'path';
import os from 'os';
import api from '@actual-app/api';
import logger from './logger.js';

const DEFAULT_DATA_DIR = path.resolve(os.homedir() || '.', '.actual');

let initialized = false;
let initializing = false;
let initializationError: Error | null = null;

export async function connectToActual() {
  if (initialized) return;
  if (initializing) {
    while (initializing) await new Promise(r => setTimeout(r, 100));
    if (initializationError) throw initializationError;
    return;
  }
  initializing = true;

  try {
    const SERVER_URL = process.env.ACTUAL_SERVER_URL;
    const PASSWORD = process.env.ACTUAL_PASSWORD;
    const BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID;
    const BUDGET_PASSWORD = process.env.ACTUAL_BUDGET_PASSWORD; // optional for E2E encrypted budgets
    const TEST_ACTUAL_CONNECTION = process.argv.includes('--test-actual-connection');

    // Use configured MCP_BRIDGE_DATA_DIR (fallback to DEFAULT_DATA_DIR) for all runs
    const DATA_DIR = process.env.MCP_BRIDGE_DATA_DIR || DEFAULT_DATA_DIR;

    if (!SERVER_URL) throw new Error('ACTUAL_SERVER_URL not set');
    if (!PASSWORD) throw new Error('ACTUAL_PASSWORD not set');
    if (!BUDGET_SYNC_ID) throw new Error('ACTUAL_BUDGET_SYNC_ID not set');
    new URL(SERVER_URL);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    logger.info(`Initializing Actual API with dataDir=${DATA_DIR}`);

    await api.init({
      dataDir: DATA_DIR,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });

    // pass budget password when available (for E2E encrypted budgets)
    if (BUDGET_PASSWORD) {
      // Some versions of @actual-app/api accept a password as a second argument,
      // but the current types expect a single string id. Try the untyped call first,
      // fall back to the typed call if that fails.
      try {
        await (api as any).downloadBudget(BUDGET_SYNC_ID, { password: BUDGET_PASSWORD });
      } catch (e) {
        logger.warn('downloadBudget with password failed, falling back to plain downloadBudget:', e);
        await api.downloadBudget(BUDGET_SYNC_ID);
      }
    } else {
      await api.downloadBudget(BUDGET_SYNC_ID);
    }

    if (TEST_ACTUAL_CONNECTION) {
      logger.info('Test flag detected (--test-actual-connection) — closing Actual session.');

      // Prefer the documented shutdown method only
      try {
        if (typeof (api as any).shutdown === 'function') {
          await (api as any).shutdown();
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
