#!/usr/bin/env node
/**
 * Script to verify if accounts persist after creation
 */

import api from '@actual-app/api';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.MCP_BRIDGE_DATA_DIR || './test-actual-data';
const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
const PASSWORD = process.env.ACTUAL_PASSWORD;
const BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID;

async function main() {
  console.log('=== Account Persistence Verification ===\n');
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Server URL: ${SERVER_URL}`);
  console.log(`Budget Sync ID: ${BUDGET_SYNC_ID}\n`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initialize Actual API
  console.log('Initializing Actual API...');
  await api.init({
    dataDir: DATA_DIR,
    serverURL: SERVER_URL,
    password: PASSWORD,
  });

  console.log('Downloading budget...');
  await api.downloadBudget(BUDGET_SYNC_ID);
  console.log('✓ Budget downloaded\n');

  // List accounts BEFORE creation
  console.log('--- BEFORE CREATION ---');
  let accounts = await api.getAccounts();
  console.log(`Accounts count: ${accounts.length}`);
  accounts.forEach(acc => {
    console.log(`  - ${acc.name} (${acc.id}) ${acc.closed ? '[CLOSED]' : ''}`);
  });

  // Create a test account
  const testAccountName = `TEST-VERIFY-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  console.log(`\n--- CREATING ACCOUNT ---`);
  console.log(`Creating account: ${testAccountName}`);
  
  const accountId = await api.createAccount({ name: testAccountName }, 0);
  console.log(`✓ Account created with ID: ${accountId}\n`);

  // List accounts AFTER creation (before sync)
  console.log('--- AFTER CREATION (in memory) ---');
  accounts = await api.getAccounts();
  console.log(`Accounts count: ${accounts.length}`);
  const newAccount = accounts.find(a => a.id === accountId);
  if (newAccount) {
    console.log(`✓ Found new account: ${newAccount.name} (${newAccount.id})`);
  } else {
    console.log(`✗ New account NOT found in memory!`);
  }

  // Force sync to server
  console.log('\n--- SYNCING TO SERVER ---');
  await api.sync();
  console.log('✓ Synced to server\n');

  // List accounts AFTER sync
  console.log('--- AFTER SYNC ---');
  accounts = await api.getAccounts();
  console.log(`Accounts count: ${accounts.length}`);
  const accountAfterSync = accounts.find(a => a.id === accountId);
  if (accountAfterSync) {
    console.log(`✓ Found account after sync: ${accountAfterSync.name} (${accountAfterSync.id})`);
  } else {
    console.log(`✗ Account NOT found after sync!`);
  }

  // Close and re-download to verify persistence
  console.log('\n--- VERIFYING PERSISTENCE (re-download) ---');
  await api.shutdown();
  
  await api.init({
    dataDir: DATA_DIR,
    serverURL: SERVER_URL,
    password: PASSWORD,
  });
  
  await api.downloadBudget(BUDGET_SYNC_ID);
  console.log('✓ Re-downloaded budget\n');

  accounts = await api.getAccounts();
  console.log(`Accounts count: ${accounts.length}`);
  const persistedAccount = accounts.find(a => a.id === accountId);
  
  if (persistedAccount) {
    console.log(`✓✓✓ SUCCESS! Account persisted: ${persistedAccount.name} (${persistedAccount.id})`);
    console.log('\nThe account was successfully saved to the server!');
  } else {
    console.log(`✗✗✗ FAILED! Account NOT persisted after re-download!`);
    console.log('\nThe account was created but did not persist to the server.');
    console.log('This indicates the sync is not working properly.');
  }

  await api.shutdown();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
