#!/usr/bin/env node

/**
 * Test Account Filtering in Search Tools
 * Validates that search tools work correctly with and without accountId parameter
 */

const http = require('http');

let SESSION_ID = `test-account-filter-${Date.now()}`;
// Test token - clearly identifiable as testing only (not production)
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

let messageId = 1;

// Helper: Make JSON-RPC request to MCP server
async function mcpRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      jsonrpc: '2.0',
      id: messageId++,
      method,
      params,
    });

    const options = {
      hostname: 'localhost',
      port: 3600,
      path: '/http',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': SESSION_ID,
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.error) {
            reject(new Error(`MCP Error: ${JSON.stringify(response.error)}`));
          } else {
            resolve(response.result);
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Helper: Call a tool
async function callTool(toolName, args = {}) {
  try {
    const result = await mcpRequest('tools/call', {
      name: toolName,
      arguments: args,
    });
    return result;
  } catch (err) {
    console.error(`   ❌ Error calling ${toolName}:`, err.message);
    throw err;
  }
}

async function runTests() {
  console.log('🧪 Testing Account Filtering in Search Tools\n');
  console.log('=' .repeat(70));

  try {
    // Initialize MCP session
    console.log('🔌 Initializing MCP session...');
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    console.log('✅ Session initialized\n');

    const testDate = new Date().toISOString().split('T')[0];

    // Create TWO test accounts
    console.log('📝 Creating two test accounts...');
    
    const account1Result = await callTool('actual_accounts_create', {
      name: `Test-Account-1-${Date.now()}`,
      offbudget: false,
      closed: false,
    });
    const account1Data = JSON.parse(account1Result.content[0].text);
    const account1Id = account1Data.result;
    console.log(`   ✅ Account 1: ${account1Id.substring(0, 8)}...`);

    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

    const account2Result = await callTool('actual_accounts_create', {
      name: `Test-Account-2-${Date.now()}`,
      offbudget: false,
      closed: false,
    });
    const account2Data = JSON.parse(account2Result.content[0].text);
    const account2Id = account2Data.result;
    console.log(`   ✅ Account 2: ${account2Id.substring(0, 8)}...\n`);

    // Get or create test payees
    console.log('📝 Setting up test payees...');
    const payeesResult = await callTool('actual_payees_get');
    const payeesData = JSON.parse(payeesResult.content[0].text);
    const payees = payeesData.result || payeesData;
    
    let testPayee1 = payees.find(p => p.name === 'Test Store ABC');
    if (!testPayee1) {
      const createPayeeResult = await callTool('actual_payees_create', {
        name: 'Test Store ABC',
      });
      const payeeData = JSON.parse(createPayeeResult.content[0].text);
      testPayee1 = { id: payeeData.result, name: 'Test Store ABC' };
    }
    console.log(`   ✅ Payee 1: ${testPayee1.name} (${testPayee1.id.substring(0, 8)}...)`);
    
    let testPayee2 = payees.find(p => p.name === 'Coffee Shop XYZ');
    if (!testPayee2) {
      const createPayeeResult = await callTool('actual_payees_create', {
        name: 'Coffee Shop XYZ',
      });
      const payeeData = JSON.parse(createPayeeResult.content[0].text);
      testPayee2 = { id: payeeData.result, name: 'Coffee Shop XYZ' };
    }
    console.log(`   ✅ Payee 2: ${testPayee2.name} (${testPayee2.id.substring(0, 8)}...)\n`);

    // Get existing categories
    console.log('📝 Getting categories...');
    const categoriesResult = await callTool('actual_categories_get');
    const categoriesData = JSON.parse(categoriesResult.content[0].text);
    const categories = categoriesData.result || categoriesData;
    const testCategory1 = categories[0];
    const testCategory2 = categories.length > 1 ? categories[1] : categories[0];
    console.log(`   ✅ Category 1: ${testCategory1.name} (${testCategory1.id.substring(0, 8)}...)`);
    console.log(`   ✅ Category 2: ${testCategory2.name} (${testCategory2.id.substring(0, 8)}...)\n`);

    // Create transactions in BOTH accounts with varied payees and categories
    console.log('📝 Creating transactions in Account 1...');
    console.log('   ┌──────────┬─────────────────────────┬──────────────────────────────────┬────────────────────────────────────┐');
    console.log('   │  Amount  │         Payee           │            Category              │              Notes                 │');
    console.log('   ├──────────┼─────────────────────────┼──────────────────────────────────┼────────────────────────────────────┤');
    
    await callTool('actual_transactions_create', {
      account: account1Id,
      date: testDate,
      amount: -3000, // -$30
      payee: testPayee1.id,
      category: testCategory1.id,
      notes: 'Transaction in Account 1 - #1 (Payee1, Cat1)',
    });
    console.log(`   │ -$30.00  │ ${testPayee1.name.padEnd(23)} │ ${testCategory1.name.padEnd(32)} │ Account 1 - #1 (Payee1, Cat1)  │`);
    
    await callTool('actual_transactions_create', {
      account: account1Id,
      date: testDate,
      amount: -4000, // -$40
      payee: testPayee2.id,
      category: testCategory1.id,
      notes: 'Transaction in Account 1 - #2 (Payee2, Cat1)',
    });
    console.log(`   │ -$40.00  │ ${testPayee2.name.padEnd(23)} │ ${testCategory1.name.padEnd(32)} │ Account 1 - #2 (Payee2, Cat1)  │`);
    console.log('   └──────────┴─────────────────────────┴──────────────────────────────────┴────────────────────────────────────┘');
    console.log('   ✅ Created 2 transactions in Account 1 (total: -$70.00)\n');

    console.log('📝 Creating transactions in Account 2...');
    console.log('   ┌──────────┬─────────────────────────┬──────────────────────────────────┬────────────────────────────────────┐');
    console.log('   │  Amount  │         Payee           │            Category              │              Notes                 │');
    console.log('   ├──────────┼─────────────────────────┼──────────────────────────────────┼────────────────────────────────────┤');
    
    await callTool('actual_transactions_create', {
      account: account2Id,
      date: testDate,
      amount: -5000, // -$50
      payee: testPayee1.id,
      category: testCategory2.id,
      notes: 'Transaction in Account 2 - #1 (Payee1, Cat2)',
    });
    console.log(`   │ -$50.00  │ ${testPayee1.name.padEnd(23)} │ ${testCategory2.name.padEnd(32)} │ Account 2 - #1 (Payee1, Cat2)  │`);
    
    await callTool('actual_transactions_create', {
      account: account2Id,
      date: testDate,
      amount: -6000, // -$60
      payee: testPayee2.id,
      category: testCategory2.id,
      notes: 'Transaction in Account 2 - #2 (Payee2, Cat2)',
    });
    console.log(`   │ -$60.00  │ ${testPayee2.name.padEnd(23)} │ ${testCategory2.name.padEnd(32)} │ Account 2 - #2 (Payee2, Cat2)  │`);
    console.log('   └──────────┴─────────────────────────┴──────────────────────────────────┴────────────────────────────────────┘');
    console.log('   ✅ Created 2 transactions in Account 2 (total: -$110.00)\n');

    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('=' .repeat(70));
    console.log('\n🧪 TEST 1: Search by Payee (Test Store ABC) WITHOUT accountId (all accounts)');
    console.log('-'.repeat(70));
    
    const payeeAllResult = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'Test Store ABC',
    });
    const payeeAllData = JSON.parse(payeeAllResult.content[0].text);
    
    console.log(`   Found: ${payeeAllData.count} transactions`);
    console.log(`   Total Amount: $${(payeeAllData.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: At least 2 transactions (1 from each account with Test Store ABC)\n`);
    
    // Check transactions from both accounts are present
    const account1Txns = payeeAllData.transactions.filter(t => t.account === account1Id);
    const account2Txns = payeeAllData.transactions.filter(t => t.account === account2Id);
    
    console.log('   📋 Transactions returned:');
    
    // Get payee and category names for display
    const allPayees = await callTool('actual_payees_get');
    const payeesMap = new Map((JSON.parse(allPayees.content[0].text).result || []).map(p => [p.id, p.name]));
    const allCategories = await callTool('actual_categories_get');
    const categoriesMap = new Map((JSON.parse(allCategories.content[0].text).result || []).map(c => [c.id, c.name]));
    
    payeeAllData.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1' : t.account === account2Id ? 'Acct2' : 'Other';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    console.log(`   Account 1 transactions: ${account1Txns.length} (total: $${(account1Txns.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    console.log(`   Account 2 transactions: ${account2Txns.length} (total: $${(account2Txns.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    
    if (payeeAllData.count >= 2) {
      console.log('   ✅ PASS: Found transactions from multiple accounts');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${payeeAllData.count}`);
    }
    
    if (account1Txns.length >= 1 && account2Txns.length >= 1) {
      console.log('   ✅ PASS: Transactions from both accounts present\n');
    } else {
      console.log(`   ❌ FAIL: Missing transactions from one or both accounts\n`);
    }

    console.log('🧪 TEST 2: Search by Payee (Test Store ABC) WITH Account 1 ID (specific account)');
    console.log('-'.repeat(70));
    
    const payeeAccount1Result = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'Test Store ABC',
      accountId: account1Id,
    });
    const payeeAccount1Data = JSON.parse(payeeAccount1Result.content[0].text);
    
    console.log(`   AccountId filter: ${account1Id.substring(0, 8)}...`);
    console.log(`   Found: ${payeeAccount1Data.count} transactions`);
    console.log(`   Total Amount: $${(payeeAccount1Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: Only 1 transaction from Account 1 (Test Store ABC only)\n`);
    
    console.log('   📋 Transactions returned:');
    payeeAccount1Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    // Verify ALL transactions belong to account1
    const wrongAccountTxns = payeeAccount1Data.transactions.filter(t => t.account !== account1Id);
    
    console.log(`   Transactions in Account 1: ${payeeAccount1Data.transactions.filter(t => t.account === account1Id).length}`);
    console.log(`   Transactions in other accounts: ${wrongAccountTxns.length}`);
    
    if (payeeAccount1Data.count >= 1) {
      console.log('   ✅ PASS: Found at least 1 transaction');
    } else {
      console.log(`   ❌ FAIL: Expected at least 1, found ${payeeAccount1Data.count}`);
    }
    
    if (wrongAccountTxns.length === 0) {
      console.log('   ✅ PASS: All transactions belong to specified account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongAccountTxns.length} transactions from wrong account\n`);
    }

    console.log('🧪 TEST 3: Search by Payee (Test Store ABC) WITH Account 2 ID (specific account)');
    console.log('-'.repeat(70));
    
    const payeeAccount2Result = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'Test Store ABC',
      accountId: account2Id,
    });
    const payeeAccount2Data = JSON.parse(payeeAccount2Result.content[0].text);
    
    console.log(`   AccountId filter: ${account2Id.substring(0, 8)}...`);
    console.log(`   Found: ${payeeAccount2Data.count} transactions`);
    console.log(`   Total Amount: $${(payeeAccount2Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: Only 1 transaction from Account 2 (Test Store ABC only)\n`);
    
    console.log('   📋 Transactions returned:');
    payeeAccount2Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account2Id ? 'Acct2✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    // Verify ALL transactions belong to account2
    const wrongAccount2Txns = payeeAccount2Data.transactions.filter(t => t.account !== account2Id);
    
    console.log(`   Transactions in Account 2: ${payeeAccount2Data.transactions.filter(t => t.account === account2Id).length}`);
    console.log(`   Transactions in other accounts: ${wrongAccount2Txns.length}`);
    
    if (payeeAccount2Data.count >= 1) {
      console.log('   ✅ PASS: Found at least 1 transaction');
    } else {
      console.log(`   ❌ FAIL: Expected at least 1, found ${payeeAccount2Data.count}`);
    }
    
    if (wrongAccount2Txns.length === 0) {
      console.log('   ✅ PASS: All transactions belong to specified account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongAccount2Txns.length} transactions from wrong account\n`);
    }

    // Test with Category search
    console.log(`🧪 TEST 4: Search by Category (${testCategory1.name}) WITHOUT accountId (all accounts)`);
    console.log('-'.repeat(70));
    
    const categoryAllResult = await callTool('actual_transactions_search_by_category', {
      categoryName: testCategory1.name,
    });
    const categoryAllData = JSON.parse(categoryAllResult.content[0].text);
    
    console.log(`   Category: ${testCategory1.name}`);
    console.log(`   Found: ${categoryAllData.count} transactions (no account filter)`);
    console.log(`   Total Amount: $${(categoryAllData.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: At least 2 transactions (both from Account 1 with ${testCategory1.name})`);
    
    const catAccount1 = categoryAllData.transactions.filter(t => t.account === account1Id);
    const catAccount2 = categoryAllData.transactions.filter(t => t.account === account2Id);
    
    console.log(`\n   📋 All Transactions returned:`);
    categoryAllData.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1' : t.account === account2Id ? 'Acct2' : 'Other';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    console.log(`   From Account 1: ${catAccount1.length} (total: $${(catAccount1.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    console.log(`   From Account 2: ${catAccount2.length} (total: $${(catAccount2.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    
    if (categoryAllData.count >= 2) {
      console.log(`   ✅ PASS: Found transactions with ${testCategory1.name}\n`);
    } else {
      console.log(`   ❌ FAIL: Expected at least 2 total, found ${categoryAllData.count}\n`);
    }

    console.log(`🧪 TEST 5: Search by Category (${testCategory1.name}) WITH Account 1 ID`);
    console.log('-'.repeat(70));
    
    const categoryAccount1Result = await callTool('actual_transactions_search_by_category', {
      categoryName: testCategory1.name,
      accountId: account1Id,
    });
    const categoryAccount1Data = JSON.parse(categoryAccount1Result.content[0].text);
    
    console.log(`   Category: ${testCategory1.name}`);
    console.log(`   AccountId filter: ${account1Id.substring(0, 8)}...`);
    console.log(`   Found: ${categoryAccount1Data.count} transactions`);
    console.log(`   Total Amount: $${(categoryAccount1Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: 2 transactions from Account 1 with ${testCategory1.name}\n`);
    
    console.log('   📋 Transactions returned:');
    categoryAccount1Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    const wrongCatAcct = categoryAccount1Data.transactions.filter(t => t.account !== account1Id);
    
    if (categoryAccount1Data.count >= 2) {
      console.log('   ✅ PASS: Found at least 2 transactions');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${categoryAccount1Data.count}`);
    }
    
    if (wrongCatAcct.length === 0) {
      console.log('   ✅ PASS: All transactions from correct account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongCatAcct.length} from wrong account\n`);
    }

    // Test Amount Search
    console.log(`🧪 TEST 6: Search by Amount (-$35 to -$45) WITHOUT accountId (all accounts)`);
    console.log('-'.repeat(70));
    
    const amountAllResult = await callTool('actual_transactions_search_by_amount', {
      minAmount: -4500, // -$45
      maxAmount: -3500, // -$35
    });
    const amountAllData = JSON.parse(amountAllResult.content[0].text);
    
    console.log(`   Amount Range: -$45.00 to -$35.00`);
    console.log(`   Found: ${amountAllData.count} transactions`);
    console.log(`   Total Amount: $${(amountAllData.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: At least 1 transaction (-$40 from Account 1)\n`);
    
    const amountAccount1 = amountAllData.transactions.filter(t => t.account === account1Id);
    const amountAccount2 = amountAllData.transactions.filter(t => t.account === account2Id);
    
    console.log('   📋 Transactions returned:');
    amountAllData.transactions.slice(0, 5).forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1' : t.account === account2Id ? 'Acct2' : 'Other';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    if (amountAllData.transactions.length > 5) {
      console.log(`      ... and ${amountAllData.transactions.length - 5} more`);
    }
    console.log();
    
    console.log(`   From Account 1: ${amountAccount1.length} (total: $${(amountAccount1.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    console.log(`   From Account 2: ${amountAccount2.length} (total: $${(amountAccount2.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    
    if (amountAllData.count >= 1) {
      console.log('   ✅ PASS: Found transactions in amount range\n');
    } else {
      console.log(`   ❌ FAIL: Expected at least 1, found ${amountAllData.count}\n`);
    }

    console.log(`🧪 TEST 7: Search by Amount (-$35 to -$45) WITH Account 1 ID`);
    console.log('-'.repeat(70));
    
    const amountAccount1Result = await callTool('actual_transactions_search_by_amount', {
      minAmount: -4500, // -$45
      maxAmount: -3500, // -$35
      accountId: account1Id,
    });
    const amountAccount1Data = JSON.parse(amountAccount1Result.content[0].text);
    
    console.log(`   Amount Range: -$45.00 to -$35.00`);
    console.log(`   AccountId filter: ${account1Id.substring(0, 8)}...`);
    console.log(`   Found: ${amountAccount1Data.count} transactions`);
    console.log(`   Total Amount: $${(amountAccount1Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: 1 transaction (-$40 from Account 1)\n`);
    
    console.log('   📋 Transactions returned:');
    amountAccount1Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    const wrongAmountAcct = amountAccount1Data.transactions.filter(t => t.account !== account1Id);
    
    if (amountAccount1Data.count >= 1) {
      console.log('   ✅ PASS: Found at least 1 transaction');
    } else {
      console.log(`   ❌ FAIL: Expected at least 1, found ${amountAccount1Data.count}`);
    }
    
    if (wrongAmountAcct.length === 0) {
      console.log('   ✅ PASS: All transactions from correct account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongAmountAcct.length} from wrong account\n`);
    }

    // Test Month Search
    console.log(`🧪 TEST 8: Search by Month (2025-12) WITHOUT accountId (all accounts)`);
    console.log('-'.repeat(70));
    
    const monthAllResult = await callTool('actual_transactions_search_by_month', {
      month: '2025-12',
    });
    const monthAllData = JSON.parse(monthAllResult.content[0].text);
    
    console.log(`   Month: 2025-12 (December 2025)`);
    console.log(`   Found: ${monthAllData.count} transactions`);
    console.log(`   Total Amount: $${(monthAllData.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: At least 4 transactions (2 from Account 1, 2 from Account 2)\n`);
    
    const monthAccount1 = monthAllData.transactions.filter(t => t.account === account1Id);
    const monthAccount2 = monthAllData.transactions.filter(t => t.account === account2Id);
    
    console.log('   📋 Sample transactions (showing first 10):');
    monthAllData.transactions.slice(0, 10).forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1' : t.account === account2Id ? 'Acct2' : 'Other';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    if (monthAllData.transactions.length > 10) {
      console.log(`      ... and ${monthAllData.transactions.length - 10} more`);
    }
    console.log();
    
    console.log(`   From Account 1: ${monthAccount1.length} (total: $${(monthAccount1.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    console.log(`   From Account 2: ${monthAccount2.length} (total: $${(monthAccount2.reduce((sum, t) => sum + t.amount, 0) / 100).toFixed(2)})`);
    
    if (monthAllData.count >= 4) {
      console.log('   ✅ PASS: Found transactions in December 2025\n');
    } else {
      console.log(`   ❌ FAIL: Expected at least 4, found ${monthAllData.count}\n`);
    }

    console.log(`🧪 TEST 9: Search by Month (2025-12) WITH Account 1 ID`);
    console.log('-'.repeat(70));
    
    const monthAccount1Result = await callTool('actual_transactions_search_by_month', {
      month: '2025-12',
      accountId: account1Id,
    });
    const monthAccount1Data = JSON.parse(monthAccount1Result.content[0].text);
    
    console.log(`   Month: 2025-12 (December 2025)`);
    console.log(`   AccountId filter: ${account1Id.substring(0, 8)}...`);
    console.log(`   Found: ${monthAccount1Data.count} transactions`);
    console.log(`   Total Amount: $${(monthAccount1Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: 2 transactions from Account 1\n`);
    
    console.log('   📋 Transactions returned:');
    monthAccount1Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account1Id ? 'Acct1✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    const wrongMonthAcct = monthAccount1Data.transactions.filter(t => t.account !== account1Id);
    
    if (monthAccount1Data.count >= 2) {
      console.log('   ✅ PASS: Found at least 2 transactions');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${monthAccount1Data.count}`);
    }
    
    if (wrongMonthAcct.length === 0) {
      console.log('   ✅ PASS: All transactions from correct account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongMonthAcct.length} from wrong account\n`);
    }

    console.log(`🧪 TEST 10: Search by Month (2025-12) WITH Account 2 ID`);
    console.log('-'.repeat(70));
    
    const monthAccount2Result = await callTool('actual_transactions_search_by_month', {
      month: '2025-12',
      accountId: account2Id,
    });
    const monthAccount2Data = JSON.parse(monthAccount2Result.content[0].text);
    
    console.log(`   Month: 2025-12 (December 2025)`);
    console.log(`   AccountId filter: ${account2Id.substring(0, 8)}...`);
    console.log(`   Found: ${monthAccount2Data.count} transactions`);
    console.log(`   Total Amount: $${(monthAccount2Data.totalAmount / 100).toFixed(2)}`);
    console.log(`   Expected: 2 transactions from Account 2\n`);
    
    console.log('   📋 Transactions returned:');
    monthAccount2Data.transactions.forEach((t, i) => {
      const acctLabel = t.account === account2Id ? 'Acct2✓' : 'WRONG!';
      const payeeName = payeesMap.get(t.payee) || 'Unknown';
      const categoryName = categoriesMap.get(t.category) || 'Unknown';
      console.log(`      ${i + 1}. $${(t.amount / 100).toFixed(2)} | ${acctLabel} | ${t.date} | ${payeeName} | ${categoryName}`);
      console.log(`         Notes: ${t.notes || 'No notes'}`);
    });
    console.log();
    
    const wrongMonthAcct2 = monthAccount2Data.transactions.filter(t => t.account !== account2Id);
    
    if (monthAccount2Data.count >= 2) {
      console.log('   ✅ PASS: Found at least 2 transactions');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${monthAccount2Data.count}`);
    }
    
    if (wrongMonthAcct2.length === 0) {
      console.log('   ✅ PASS: All transactions from correct account\n');
    } else {
      console.log(`   ❌ FAIL: Found ${wrongMonthAcct2.length} from wrong account\n`);
    }

    // Summary
    console.log('=' .repeat(70));
    console.log('📊 SUMMARY');
    console.log('=' .repeat(70));
    console.log('\nExpected Behavior:');
    console.log('  ✓ NO accountId → Search ALL accounts');
    console.log('  ✓ WITH accountId → Search ONLY that account\n');
    
    console.log('Test Setup:');
    console.log(`  • Account 1: ${account1Id.substring(0, 8)}...`);
    console.log(`    - Txn 1: -$30 | ${testPayee1.name} | ${testCategory1.name}`);
    console.log(`    - Txn 2: -$40 | ${testPayee2.name} | ${testCategory1.name}`);
    console.log(`  • Account 2: ${account2Id.substring(0, 8)}...`);
    console.log(`    - Txn 1: -$50 | ${testPayee1.name} | ${testCategory2.name}`);
    console.log(`    - Txn 2: -$60 | ${testPayee2.name} | ${testCategory2.name}\n`);
    
    console.log('Results:');
    console.log(`  • TEST 1 - Search "Test Store ABC" without accountId: ${payeeAllData.count} transactions`);
    console.log(`  • TEST 2 - Search "Test Store ABC" with Account 1 ID: ${payeeAccount1Data.count} transactions`);
    console.log(`  • TEST 3 - Search "Test Store ABC" with Account 2 ID: ${payeeAccount2Data.count} transactions`);
    console.log(`  • TEST 4 - Search "${testCategory1.name}" without accountId: ${categoryAllData.count} transactions`);
    console.log(`  • TEST 5 - Search "${testCategory1.name}" with Account 1 ID: ${categoryAccount1Data.count} transactions`);
    console.log(`  • TEST 6 - Search by Amount (-$45 to -$35) without accountId: ${amountAllData.count} transactions`);
    console.log(`  • TEST 7 - Search by Amount (-$45 to -$35) with Account 1 ID: ${amountAccount1Data.count} transactions`);
    console.log(`  • TEST 8 - Search by Month (2025-12) without accountId: ${monthAllData.count} transactions`);
    console.log(`  • TEST 9 - Search by Month (2025-12) with Account 1 ID: ${monthAccount1Data.count} transactions`);
    console.log(`  • TEST 10 - Search by Month (2025-12) with Account 2 ID: ${monthAccount2Data.count} transactions\n`);
    
    // Expected: 1 transaction per account with "Test Store ABC" (newly created)
    // Note: There may be more from previous test runs, but we validate the new ones
    const allTestsPassed = 
      payeeAllData.count >= 2 &&              // At least our 2 new transactions (1 per account)
      payeeAccount1Data.count >= 1 &&         // At least 1 in Account 1
      payeeAccount2Data.count >= 1 &&         // At least 1 in Account 2
      wrongAccountTxns.length === 0 &&        // No wrong account in Account 1 results
      wrongAccount2Txns.length === 0 &&       // No wrong account in Account 2 results
      categoryAccount1Data.count >= 2 &&      // Both Account 1 transactions use same category
      amountAllData.count >= 1 &&             // At least 1 transaction in amount range
      amountAccount1Data.count >= 1 &&        // At least 1 in Account 1 amount range
      wrongAmountAcct.length === 0 &&         // No wrong account in amount results
      monthAllData.count >= 4 &&              // At least 4 transactions in December
      monthAccount1Data.count >= 2 &&         // At least 2 in Account 1 for December
      monthAccount2Data.count >= 2 &&         // At least 2 in Account 2 for December
      wrongMonthAcct.length === 0 &&          // No wrong account in month Account 1 results
      wrongMonthAcct2.length === 0;           // No wrong account in month Account 2 results
    
    if (allTestsPassed) {
      console.log('✅ ALL 10 TESTS PASSED!');
      console.log('   Account filtering works correctly in all scenarios:');
      console.log('   • Payee search (with and without accountId)');
      console.log('   • Category search (with and without accountId)');
      console.log('   • Amount range search (with and without accountId)');
      console.log('   • Month search (with and without accountId)');
      console.log(`   Note: Found ${payeeAllData.count} total "Test Store ABC" transactions (includes previous test runs)\n`);
    } else {
      console.log('⚠️  SOME TESTS FAILED');
      console.log('   Test Results:');
      console.log(`     • payeeAllData.count >= 2: ${payeeAllData.count >= 2 ? '✅' : '❌'} (actual: ${payeeAllData.count})`);
      console.log(`     • payeeAccount1Data.count >= 1: ${payeeAccount1Data.count >= 1 ? '✅' : '❌'} (actual: ${payeeAccount1Data.count})`);
      console.log(`     • payeeAccount2Data.count >= 1: ${payeeAccount2Data.count >= 1 ? '✅' : '❌'} (actual: ${payeeAccount2Data.count})`);
      console.log(`     • wrongAccountTxns.length === 0: ${wrongAccountTxns.length === 0 ? '✅' : '❌'} (actual: ${wrongAccountTxns.length})`);
      console.log(`     • wrongAccount2Txns.length === 0: ${wrongAccount2Txns.length === 0 ? '✅' : '❌'} (actual: ${wrongAccount2Txns.length})`);
      console.log(`     • categoryAccount1Data.count >= 2: ${categoryAccount1Data.count >= 2 ? '✅' : '❌'} (actual: ${categoryAccount1Data.count})`);
      console.log(`     • amountAllData.count >= 1: ${amountAllData.count >= 1 ? '✅' : '❌'} (actual: ${amountAllData.count})`);
      console.log(`     • amountAccount1Data.count >= 1: ${amountAccount1Data.count >= 1 ? '✅' : '❌'} (actual: ${amountAccount1Data.count})`);
      console.log(`     • wrongAmountAcct.length === 0: ${wrongAmountAcct.length === 0 ? '✅' : '❌'} (actual: ${wrongAmountAcct.length})`);
      console.log(`     • monthAllData.count >= 4: ${monthAllData.count >= 4 ? '✅' : '❌'} (actual: ${monthAllData.count})`);
      console.log(`     • monthAccount1Data.count >= 2: ${monthAccount1Data.count >= 2 ? '✅' : '❌'} (actual: ${monthAccount1Data.count})`);
      console.log(`     • monthAccount2Data.count >= 2: ${monthAccount2Data.count >= 2 ? '✅' : '❌'} (actual: ${monthAccount2Data.count})`);
      console.log(`     • wrongMonthAcct.length === 0: ${wrongMonthAcct.length === 0 ? '✅' : '❌'} (actual: ${wrongMonthAcct.length})`);
      console.log(`     • wrongMonthAcct2.length === 0: ${wrongMonthAcct2.length === 0 ? '✅' : '❌'} (actual: ${wrongMonthAcct2.length})\n`);
    }

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
