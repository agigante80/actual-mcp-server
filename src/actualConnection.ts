// src/actualConnection.ts
import logger from './logger.js';
import * as ActualApi from '@actual-app/api';
import fs from 'fs';
import actualToolsManager from './actualToolsManager.js';

export async function connectToActual() {
  const SERVER_URL = process.env.ACTUAL_SERVER_URL || '';
  const PASSWORD = process.env.ACTUAL_PASSWORD || '';
  const BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || '';
  const DATA_DIR = process.env.MCP_BRIDGE_DATA_DIR || './actual-data';

/*  // Remove corrupted cache folder if suspected to avoid JSON parse errors
  if (fs.existsSync(DATA_DIR)) {
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      logger.warn('Corrupted actual-data cache removed, fresh sync will occur.');
    } catch (err) {
      logger.warn('Failed to remove actual-data cache:', err);
    }
  }
*/

  // Recreate data directory to ensure it exists
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!SERVER_URL) throw new Error('ACTUAL_SERVER_URL environment variable is not set');
  if (!BUDGET_SYNC_ID) throw new Error('ACTUAL_BUDGET_SYNC_ID environment variable is not set or empty');

  try {
    new URL(SERVER_URL);
  } catch {
    throw new Error(`ACTUAL_SERVER_URL is not a valid URL: "${SERVER_URL}"`);
  }

  logger.info('==================================================');
  logger.info('🟢 ACTUAL FINANCE CONFIGURATION');
  logger.info(`• Server URL:           ${SERVER_URL}`);
  logger.info(`• Password:             ${PASSWORD ? '*** (hidden)' : 'empty'}`);
  logger.info(`• Budget Sync ID:       ${BUDGET_SYNC_ID}`);
  logger.info('==================================================');

  try {
    await ActualApi.init({
      dataDir: DATA_DIR,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });

    await ActualApi.downloadBudget(BUDGET_SYNC_ID);

    logger.info(`✅ Connected to Actual Finance and budget loaded`);
    logger.info('==================================================');

    // Initialize tools (but no test calls)
    await actualToolsManager.initialize();

  } catch (err: any) {
    logger.error('❌ Failed to connect to Actual Finance:', err.message || err);
    logger.error(err); // Full error
    throw err;
  }
}

// NO call to main() here!
