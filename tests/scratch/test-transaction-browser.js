#!/usr/bin/env node
// Test script that creates transactions in the ACTUAL browser budget
// This writes to the server's database file that the browser displays

import api from '@actual-app/api';

const SERVER_URL = 'http://localhost:5006';
const PASSWORD = '';
const SYNC_ID = '8b25ed65-5b9a-4ce2-8cc0-0c629849fc04';  // The actual browser budget
const DATA_DIR = './browser-budget-data';  // Separate data dir for this budget

async function test() {
  try {
    console.log('Initializing API...');
    await api.init({ serverURL: SERVER_URL, password: PASSWORD, dataDir: DATA_DIR });
    
    console.log(`Downloading budget ${SYNC_ID} from server...`);
    await api.downloadBudget(SYNC_ID);
    
    console.log('Getting accounts...');
    const accounts = await api.getAccounts();
    console.log('Found accounts:', accounts.map(a => `${a.name} (${a.id})`).join(', '));
    
    let testAccount = accounts.find(a => a.name.includes('MCP-Test'));
    
    if (!testAccount) {
      console.log('No MCP test account found, creating one...');
      const accountId = await api.createAccount({ 
        name: 'MCP-BrowserTest-' + Date.now(), 
        offbudget: false 
      });
      console.log('Created account:', accountId);
      testAccount = { id: accountId, name: 'MCP-BrowserTest-' + Date.now() };
    } else {
      console.log(`Using existing account: ${testAccount.name}`);
    }
    
    console.log(`Creating transaction in account ${testAccount.id}...`);
    const txIds = await api.addTransactions(testAccount.id, [{
      date: '2025-11-24',
      amount: -5000,  // -$50.00
      notes: 'Browser test ' + Date.now(),
      cleared: true
    }]);
    
    console.log('✅ Transaction created! Result:', txIds);
    
    // Verify it exists
    const txns = await api.getTransactions(testAccount.id, '2025-11-01', '2025-11-30');
    console.log(`Total transactions in account: ${txns.length}`);
    if (txns.length > 0) {
      console.log('Recent transactions:', txns.slice(-5).map(t => ({ 
        amount: t.amount / 100,  // Convert cents to dollars
        notes: t.notes 
      })));
    }
    
    console.log('\n✅ Done! The transaction should now be visible in your browser.');
    console.log('Refresh the browser page if needed.');
    
    await api.shutdown();
  } catch (error) {
    console.error('Error:', error);
    await api.shutdown();
    process.exit(1);
  }
}

test();
