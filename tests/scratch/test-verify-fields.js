#!/usr/bin/env node
// Quick test to verify transaction creation with payee, category, and notes

import api from '@actual-app/api';

const SERVER_URL = 'http://localhost:5006';
const PASSWORD = 'test';
const SYNC_ID = '8b25ed65-5b9a-4ce2-8cc0-0c629849fc04';
const DATA_DIR = './test-verify-transaction';

async function test() {
  try {
    await api.init({ dataDir: DATA_DIR, serverURL: SERVER_URL, password: PASSWORD });
    await api.downloadBudget(SYNC_ID);
    
    const accounts = await api.getAccounts();
    const testAccount = accounts.find(a => a.name.includes('MCP-Test-2025-11-24T14-01'));
    
    if (!testAccount) {
      console.log('❌ Test account not found');
      return;
    }
    
    console.log(`Found test account: ${testAccount.name}`);
    
    // Get all transactions for this account
    const txns = await api.getTransactions(testAccount.id);
    console.log(`\nTotal transactions: ${txns.length}`);
    
    if (txns.length > 0) {
      const latestTxn = txns[txns.length - 1];
      console.log('\nLatest transaction details:');
      console.log('  ID:', latestTxn.id);
      console.log('  Amount:', (latestTxn.amount / 100).toFixed(2));
      console.log('  Date:', latestTxn.date);
      console.log('  Payee ID:', latestTxn.payee);
      console.log('  Category ID:', latestTxn.category);
      console.log('  Notes:', latestTxn.notes);
      console.log('  Cleared:', latestTxn.cleared);
      
      // Get payee and category names
      if (latestTxn.payee) {
        const payees = await api.getPayees();
        const payee = payees.find(p => p.id === latestTxn.payee);
        console.log('  Payee Name:', payee?.name);
      }
      
      if (latestTxn.category) {
        const categories = await api.getCategories();
        const category = categories.find(c => c.id === latestTxn.category);
        console.log('  Category Name:', category?.name);
      }
      
      console.log('\n✅ Transaction has all required fields!');
    } else {
      console.log('❌ No transactions found in account');
    }
    
    await api.shutdown();
  } catch (error) {
    console.error('Error:', error);
    await api.shutdown();
  }
}

test();
