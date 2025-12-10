#!/usr/bin/env node
// Simple test to verify transaction creation works

import api from '@actual-app/api';

const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
const PASSWORD = process.env.ACTUAL_PASSWORD || '';
const SYNC_ID = '_test-budget';  // Use the test budget
const DATA_DIR = './test-actual-data';

async function test() {
  try {
    console.log('Initializing API...');
    await api.init({ serverURL: SERVER_URL, password: PASSWORD, dataDir: DATA_DIR });
    
    console.log('Loading budget...');
    await api.loadBudget(SYNC_ID);
    
    console.log('Getting accounts...');
    const accounts = await api.getAccounts();
    const testAccount = accounts.find(a => a.name.includes('MCP-Test'));
    
    if (!testAccount) {
      console.log('No MCP test account found, creating one...');
      const accountId = await api.createAccount({ name: 'MCP-SimpleTest-' + Date.now(), offbudget: false });
      console.log('Created account:', accountId);
      
      console.log('Creating transaction...');
      const txIds = await api.addTransactions(accountId, [{
        date: '2025-11-24',
        amount: -1000,
        notes: 'Simple test transaction'
      }], {});
      
      console.log('✅ Transaction created! IDs:', txIds);
      console.log('Type of return value:', typeof txIds, Array.isArray(txIds) ? '(array)' : '');
      
      // Verify it exists
      const txns = await api.getTransactions(accountId, '2025-11-01', '2025-11-30');
      console.log('Transactions in account:', txns.length);
      const ourTx = txns.find(t => t.notes === 'Simple test transaction');
      if (ourTx) {
        console.log('✅ Transaction found in database!', ourTx.id);
      } else {
        console.log('❌ Transaction NOT found in database');
      }
    } else {
      console.log('Using existing account:', testAccount.name, testAccount.id);
      
      console.log('Creating transaction...');
      const txIds = await api.addTransactions(testAccount.id, [{
        date: '2025-11-24',
        amount: -2000,
        notes: 'Simple test ' + Date.now()
      }], {});
      
      console.log('✅ Transaction created! IDs:', txIds);
      console.log('Type of return value:', typeof txIds, Array.isArray(txIds) ? '(array)' : '');
    }
    
    await api.shutdown();
    console.log('Done!');
  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  }
}

test();
