#!/usr/bin/env node
// Test script using exact same connection method as the MCP server

import api from '@actual-app/api';

const SERVER_URL = 'http://localhost:5006';
const PASSWORD = 'test';  // From .env
const SYNC_ID = '8b25ed65-5b9a-4ce2-8cc0-0c629849fc04';  // From .env
const DATA_DIR = './test-browser-connection';

async function test() {
  try {
    console.log('Initializing API with server connection...');
    await api.init({
      dataDir: DATA_DIR,
      serverURL: SERVER_URL,
      password: PASSWORD,
    });
    
    console.log(`Downloading budget ${SYNC_ID}...`);
    await api.downloadBudget(SYNC_ID);
    
    console.log('Getting accounts...');
    const accounts = await api.getAccounts();
    console.log(`Found ${accounts.length} accounts`);
    console.log('Account names:', accounts.map(a => a.name).slice(0, 10));
    
    let testAccount = accounts.find(a => a.name.includes('MCP-Test'));
    
    if (!testAccount) {
      console.log('\nNo MCP test account found, creating one...');
      const accountId = await api.createAccount({ 
        name: 'MCP-BrowserTest-' + Date.now(), 
        offbudget: false 
      });
      testAccount = { id: accountId, name: 'MCP-BrowserTest-' + Date.now() };
      console.log('Created account:', testAccount.name);
    } else {
      console.log(`\nUsing existing account: ${testAccount.name}`);
    }
    
    console.log(`\nCreating transaction in account ${testAccount.id}...`);
    const timestamp = Date.now();
    const result = await api.addTransactions(testAccount.id, [{
      date: '2025-11-24',
      amount: -5000,  // -$50.00
      notes: `Browser test ${timestamp}`,
      cleared: true
    }]);
    
    console.log('✅ Transaction created! Result:', result);
    
    // Verify it exists
    const txns = await api.getTransactions(testAccount.id);
    console.log(`\nTotal transactions in account: ${txns.length}`);
    
    const ourTx = txns.find(t => t.notes && t.notes.includes(timestamp.toString()));
    if (ourTx) {
      console.log('✅ Transaction verified in database!');
      console.log('   ID:', ourTx.id);
      console.log('   Amount:', (ourTx.amount / 100).toFixed(2));
      console.log('   Notes:', ourTx.notes);
    }
    
    console.log('\nSyncing changes to server...');
    await api.sync();
    
    console.log('\n🎉 SUCCESS! Transaction created and synced to server.');
    console.log('Refresh your browser to see the transaction in account:', testAccount.name);
    
    await api.shutdown();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    await api.shutdown();
    process.exit(1);
  }
}

test();
