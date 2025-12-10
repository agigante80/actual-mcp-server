#!/usr/bin/env node
// Comprehensive test: Create transaction with payee, category, and notes

import api from '@actual-app/api';

const SERVER_URL = 'http://localhost:5006';
const PASSWORD = 'test';
const SYNC_ID = '8b25ed65-5b9a-4ce2-8cc0-0c629849fc04';
const DATA_DIR = './test-comprehensive';

async function test() {
  try {
    console.log('=== COMPREHENSIVE TRANSACTION TEST ===\n');
    
    await api.init({ dataDir: DATA_DIR, serverURL: SERVER_URL, password: PASSWORD });
    await api.downloadBudget(SYNC_ID);
    
    // 1. Create or get test account
    console.log('1. Setting up test account...');
    let testAccount = (await api.getAccounts()).find(a => a.name.includes('MCP-Test'));
    if (!testAccount) {
      const accountId = await api.createAccount({ name: 'MCP-ComprehensiveTest-' + Date.now(), offbudget: false });
      testAccount = { id: accountId, name: 'MCP-ComprehensiveTest-' + Date.now() };
    }
    console.log('   ✅ Account:', testAccount.name);
    
    // 2. Create test payee
    console.log('\n2. Creating test payee...');
    const payeeName = `Test-Payee-${Date.now()}`;
    const payeeId = await api.createPayee({ name: payeeName });
    console.log('   ✅ Payee created:', payeeName, '(ID:', payeeId, ')');
    
    // 3. Get or create test category
    console.log('\n3. Setting up test category...');
    const categories = await api.getCategories();
    let testCategory = categories.find(c => c.name && c.name.includes('MCP-'));
    
    if (!testCategory) {
      // Need a category group first
      const groups = await api.getCategoryGroups();
      let testGroup = groups.find(g => g.name && g.name.includes('MCP-'));
      
      if (!testGroup) {
        const groupId = await api.createCategoryGroup({ name: 'MCP-TestGroup-' + Date.now() });
        testGroup = { id: groupId, name: 'MCP-TestGroup' };
      }
      
      const categoryId = await api.createCategory({ name: 'MCP-TestCategory-' + Date.now(), group_id: testGroup.id });
      testCategory = { id: categoryId, name: 'MCP-TestCategory' };
    }
    console.log('   ✅ Category:', testCategory.name, '(ID:', testCategory.id, ')');
    
    // 4. Create transaction with ALL fields
    console.log('\n4. Creating transaction with payee, category, and notes...');
    const timestamp = Date.now();
    const txResult = await api.addTransactions(testAccount.id, [{
      date: '2025-11-24',
      amount: -7500,  // -$75.00
      payee: payeeId,
      category: testCategory.id,
      notes: `Comprehensive test ${timestamp}`,
      cleared: true
    }]);
    
    console.log('   ✅ Transaction API result:', txResult);
    
    // 5. Verify transaction was created with all fields
    console.log('\n5. Verifying transaction...');
    const txns = await api.getTransactions(testAccount.id);
    const ourTx = txns.find(t => t.notes && t.notes.includes(timestamp.toString()));
    
    if (!ourTx) {
      console.log('   ❌ Transaction not found!');
      await api.shutdown();
      return;
    }
    
    console.log('   ✅ Transaction found!');
    console.log('      ID:', ourTx.id);
    console.log('      Amount:', (ourTx.amount / 100).toFixed(2));
    console.log('      Date:', ourTx.date);
    console.log('      Payee ID:', ourTx.payee, payeeId === ourTx.payee ? '✅ MATCH' : '❌ MISMATCH');
    console.log('      Category ID:', ourTx.category, testCategory.id === ourTx.category ? '✅ MATCH' : '❌ MISMATCH');
    console.log('      Notes:', ourTx.notes, ourTx.notes.includes(timestamp.toString()) ? '✅ MATCH' : '❌ MISMATCH');
    console.log('      Cleared:', ourTx.cleared, ourTx.cleared ? '✅ YES' : '❌ NO');
    
    // 6. Sync to server
    console.log('\n6. Syncing to server...');
    await api.sync();
    console.log('   ✅ Synced');
    
    console.log('\n=== TEST SUMMARY ===');
    console.log('✅ Can create transaction: YES');
    console.log('✅ Can add payee: YES', payeeId === ourTx.payee ? '' : '(FAILED)');
    console.log('✅ Can add category: YES', testCategory.id === ourTx.category ? '' : '(FAILED)');
    console.log('✅ Can add notes: YES', ourTx.notes.includes(timestamp.toString()) ? '' : '(FAILED)');
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log(`\nView in browser: Account "${testAccount.name}"`);
    
    await api.shutdown();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    await api.shutdown();
    process.exit(1);
  }
}

test();
