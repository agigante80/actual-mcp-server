#!/usr/bin/env node
// Test script that creates transactions by directly using the server's database
// This modifies the same file that the browser displays

import api from '@actual-app/api';
import { copyFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SERVER_DB_PATH = 'tests/manual/test-stack/actual/data-main/user-files/group-8b25ed65-5b9a-4ce2-8cc0-0c629849fc04.sqlite';
const WORK_DIR = './browser-budget-work';
const BUDGET_ID = 'browser-work';

async function test() {
  try {
    // Create working directory
    mkdirSync(WORK_DIR, { recursive: true });
    mkdirSync(join(WORK_DIR, BUDGET_ID), { recursive: true });
    
    // Copy server database to our working directory
    console.log('Copying server database...');
    const workDbPath = join(WORK_DIR, BUDGET_ID, 'db.sqlite');
    copyFileSync(SERVER_DB_PATH, workDbPath);
    console.log('Database copied to:', workDbPath);
    
    console.log('Initializing API...');
    await api.init({ dataDir: WORK_DIR });
    
    console.log('Loading budget...');
    await api.loadBudget(BUDGET_ID);
    
    console.log('Getting accounts...');
    const accounts = await api.getAccounts();
    console.log('Found accounts:', accounts.map(a => a.name).slice(0, 10).join(', '));
    
    let testAccount = accounts.find(a => a.name.includes('MCP-Test'));
    
    if (!testAccount) {
      console.log('No MCP test account found, creating one...');
      const accountId = await api.createAccount({ 
        name: 'MCP-BrowserTest-' + Date.now(), 
        offbudget: false 
      });
      testAccount = accounts.find(a => a.id === accountId);
      console.log('Created account:', testAccount.name);
    } else {
      console.log(`Using existing account: ${testAccount.name}`);
    }
    
    console.log(`Creating transaction...`);
    const result = await api.addTransactions(testAccount.id, [{
      date: '2025-11-24',
      amount: -5000,  // -$50.00
      notes: 'Browser test ' + Date.now(),
      cleared: true
    }]);
    
    console.log('✅ Transaction created! Result:', result);
    
    // Verify it exists
    const txns = await api.getTransactions(testAccount.id, '2025-11-01', '2025-11-30');
    console.log(`Total transactions in account: ${txns.length}`);
    
    await api.shutdown();
    
    // Copy the modified database back to the server
    console.log('\nCopying modified database back to server...');
    copyFileSync(workDbPath, SERVER_DB_PATH);
    console.log('✅ Database updated!');
    
    console.log('\n🎉 Transaction created successfully!');
    console.log('Refresh your browser to see the new transaction.');
    
  } catch (error) {
    console.error('Error:', error);
    await api.shutdown();
    process.exit(1);
  }
}

test();
