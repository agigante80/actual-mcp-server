#!/usr/bin/env node
// Test script that creates transactions in the server budget (not local offline budget)

import api from '@actual-app/api';

const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
const PASSWORD = process.env.ACTUAL_PASSWORD || '';
const DATA_DIR = './test-actual-data';  // Use same data dir with already-downloaded budget

async function test() {
  try {
    console.log('Initializing API...');
    await api.init({ serverURL: SERVER_URL, password: PASSWORD, dataDir: DATA_DIR });
    
    console.log('Loading budget...');
    // Load the test budget that's already been downloaded
    await api.loadBudget('_test-budget');
    
    console.log('Getting accounts...');
    const accounts = await api.getAccounts();
    console.log('Found accounts:', accounts.map(a => a.name));
    
    const testAccount = accounts.find(a => a.name.includes('MCP-Test'));
    
    if (!testAccount) {
      console.log('No MCP test account found, creating one...');
      const accountId = await api.createAccount({ name: 'MCP-ServerTest-' + Date.now(), offbudget: false });
      console.log('Created account:', accountId);
      
      console.log('Creating transaction...');
      const txIds = await api.addTransactions(accountId, [{
        date: '2025-11-24',
        amount: -3000,  // -$30.00
        notes: 'Server test ' + Date.now()
      }]);
      
      console.log('✅ Transaction created! Result:', txIds);
    } else {
      console.log('Using existing account:', testAccount.name, testAccount.id);
      
      console.log('Creating transaction...');
      const txIds = await api.addTransactions(testAccount.id, [{
        date: '2025-11-24',
        amount: -3000,  // -$30.00
        notes: 'Server test ' + Date.now()
      }]);
      
      console.log('✅ Transaction created! Result:', txIds);
      console.log('Type of return value:', typeof txIds, Array.isArray(txIds) ? '(array)' : '');
      
      // Get transactions to verify
      const txns = await api.getTransactions(testAccount.id, '2025-11-01', '2025-11-30');
      console.log('Total transactions in account:', txns.length);
      if (txns.length > 0) {
        console.log('Recent transactions:', txns.slice(-3).map(t => ({ 
          id: t.id, 
          amount: t.amount, 
          notes: t.notes 
        })));
      }
    }
    
    console.log('Syncing...');
    await api.sync();
    
    console.log('Done!');
    await api.shutdown();
  } catch (error) {
    console.error('Error:', error);
    await api.shutdown();
    process.exit(1);
  }
}

test();
