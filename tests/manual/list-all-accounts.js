#!/usr/bin/env node
/**
 * List all accounts in the budget
 */

import api from '@actual-app/api';
import fs from 'fs';

const DATA_DIR = process.env.MCP_BRIDGE_DATA_DIR || './test-actual-data';
const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
const PASSWORD = process.env.ACTUAL_PASSWORD;
const BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID;

async function main() {
  console.log('=== All Accounts in Budget ===\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  await api.init({
    dataDir: DATA_DIR,
    serverURL: SERVER_URL,
    password: PASSWORD,
  });

  await api.downloadBudget(BUDGET_SYNC_ID);
  
  const accounts = await api.getAccounts();
  
  console.log(`Total accounts: ${accounts.length}\n`);
  
  accounts.forEach((acc, i) => {
    const flags = [];
    if (acc.closed) flags.push('CLOSED');
    if (acc.offbudget) flags.push('OFF-BUDGET');
    
    console.log(`${i + 1}. ${acc.name}`);
    console.log(`   ID: ${acc.id}`);
    if (flags.length > 0) {
      console.log(`   Flags: ${flags.join(', ')}`);
    }
    console.log('');
  });

  await api.shutdown();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
