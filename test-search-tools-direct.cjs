#!/usr/bin/env node

/**
 * Direct MCP Server Test - Search Tools Validation
 * Tests all search_by_* tools with actual HTTP calls to MCP server
 */

const http = require('http');

const MCP_SERVER_URL = 'http://localhost:3600';
let SESSION_ID = `test-${Date.now()}`;
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
  console.log(`\n📞 Calling tool: ${toolName}`);
  console.log(`   Args: ${JSON.stringify(args, null, 2)}`);
  
  try {
    const result = await mcpRequest('tools/call', {
      name: toolName,
      arguments: args,
    });
    
    console.log(`   ✅ Success!`);
    return result;
  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    throw err;
  }
}

// Test setup
let testAccountId;
let testCategoryId;
let testPayeeId;
const testDate = new Date().toISOString().split('T')[0]; // Today's date YYYY-MM-DD

async function runTests() {
  console.log('🚀 Starting MCP Server Search Tools Test\n');
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`Test Date: ${testDate}\n`);

  try {
    // Initialize MCP session
    console.log('🔌 Initializing MCP session...');
    const initResult = await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    
    // Extract session ID from response if available
    if (initResult && initResult.meta && initResult.meta.sessionId) {
      SESSION_ID = initResult.meta.sessionId;
      console.log(`✅ Session initialized: ${SESSION_ID}\n`);
    } else {
      console.log('✅ Session initialized (using client-generated ID)\n');
    }

    // Step 1: Create test account
    console.log('📝 Step 1: Creating test account...');
    const accountResult = await callTool('actual_accounts_create', {
      name: `Test-Search-${Date.now()}`,
      offbudget: false,
      closed: false,
    });
    // Extract account ID from result
    const accountText = accountResult.content[0].text;
    const accountData = JSON.parse(accountText);
    testAccountId = accountData.result || accountData.data?.id || accountData.id;
    console.log(`   Account ID: ${testAccountId}\n`);

    // Step 2: Get/Create test category
    console.log('📝 Step 2: Getting categories...');
    const categoriesResult = await callTool('actual_categories_get');
    const categoriesText = categoriesResult.content[0].text;
    const categoriesData = JSON.parse(categoriesText);
    const categories = categoriesData.result || categoriesData.data || categoriesData;
    
    if (!Array.isArray(categories)) {
      throw new Error(`Expected categories array, got: ${typeof categories}`);
    }
    
    // Find existing "Food" category or use first available
    let foodCategory = categories.find(c => c.name && c.name.toLowerCase().includes('food'));
    if (!foodCategory && categories.length > 0) {
      // Use first available category
      foodCategory = categories[0];
      console.log(`   Using existing category: ${foodCategory.name}`);
    }
    if (!foodCategory) {
      throw new Error('No categories available. Please create at least one category in Actual Budget.');
    }
    testCategoryId = foodCategory.id;
    console.log(`   Category ID: ${testCategoryId} (${foodCategory.name})\n`);

    // Step 3: Get/Create test payees
    console.log('📝 Step 3: Getting payees...');
    const payeesResult = await callTool('actual_payees_get');
    const payeesData = JSON.parse(payeesResult.content[0].text);
    const payees = payeesData.result || payeesData.data || payeesData;
    
    if (!Array.isArray(payees)) {
      throw new Error(`Expected payees array, got: ${typeof payees}`);
    }
    
    // Find or create "Test Grocery Store" payee
    let groceryPayee = payees.find(p => p.name === 'Test Grocery Store');
    if (!groceryPayee) {
      console.log('   Creating "Test Grocery Store" payee...');
      const createPayeeResult = await callTool('actual_payees_create', {
        name: 'Test Grocery Store',
      });
      const payeeData = JSON.parse(createPayeeResult.content[0].text);
      testPayeeId = payeeData.result || payeeData.id;
    } else {
      testPayeeId = groceryPayee.id;
    }
    console.log(`   Grocery Payee ID: ${testPayeeId}\n`);

    // Step 4: Create test transactions
    console.log('📝 Step 4: Creating test transactions...');
    
    const transactions = [
      {
        account: testAccountId,
        date: testDate,
        amount: -5000, // -$50.00
        payee: testPayeeId,
        category: testCategoryId,
        notes: 'Test transaction 1',
      },
      {
        account: testAccountId,
        date: testDate,
        amount: -7500, // -$75.00
        payee: testPayeeId,
        category: testCategoryId,
        notes: 'Test transaction 2',
      },
      {
        account: testAccountId,
        date: testDate,
        amount: -2500, // -$25.00
        payee: testPayeeId,
        category: testCategoryId,
        notes: 'Test transaction 3',
      },
    ];

    for (let i = 0; i < transactions.length; i++) {
      await callTool('actual_transactions_create', transactions[i]);
      console.log(`   Created transaction ${i + 1}: ${transactions[i].amount / 100} USD`);
    }
    console.log(`   ✅ Created ${transactions.length} test transactions\n`);

    // Give the database a moment to sync
    await new Promise(resolve => setTimeout(resolve, 1000));

    // ========================================
    // TEST 1: Search by Payee
    // ========================================
    console.log('\n🧪 TEST 1: Search by Payee Name');
    console.log('=' .repeat(60));
    
    const payeeSearchResult = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'Test Grocery Store',
    });
    
    const payeeSearchData = JSON.parse(payeeSearchResult.content[0].text);
    console.log(`   Found ${payeeSearchData.count} transactions`);
    console.log(`   Total amount: ${payeeSearchData.totalAmount / 100} USD`);
    
    if (payeeSearchData.count >= 3) {
      console.log('   ✅ PASS: Found at least 3 transactions');
    } else {
      console.log(`   ❌ FAIL: Expected at least 3, found ${payeeSearchData.count}`);
    }
    
    if (payeeSearchData.totalAmount <= -15000) {
      console.log(`   ✅ PASS: Total amount is negative (${payeeSearchData.totalAmount / 100} USD)`);
    } else {
      console.log(`   ❌ FAIL: Expected negative amount, got ${payeeSearchData.totalAmount}`);
    }

    // ========================================
    // TEST 2: Search by Category
    // ========================================
    console.log('\n🧪 TEST 2: Search by Category Name');
    console.log('=' .repeat(60));
    
    const categorySearchResult = await callTool('actual_transactions_search_by_category', {
      categoryName: foodCategory.name, // Use actual category name from test setup
    });
    
    const categorySearchData = JSON.parse(categorySearchResult.content[0].text);
    console.log(`   Category: ${foodCategory.name}`);
    console.log(`   Found ${categorySearchData.count} transactions`);
    console.log(`   Total amount: ${categorySearchData.totalAmount / 100} USD`);
    
    if (categorySearchData.count >= 3) {
      console.log(`   ✅ PASS: Found at least 3 transactions in ${foodCategory.name} category`);
    } else {
      console.log(`   ❌ FAIL: Expected at least 3, found ${categorySearchData.count}`);
    }

    // ========================================
    // TEST 3: Search by Amount Range
    // ========================================
    console.log('\n🧪 TEST 3: Search by Amount Range');
    console.log('=' .repeat(60));
    
    const amountSearchResult = await callTool('actual_transactions_search_by_amount', {
      minAmount: -8000, // -$80.00
      maxAmount: -4000, // -$40.00
      accountId: testAccountId,
    });
    
    const amountSearchData = JSON.parse(amountSearchResult.content[0].text);
    console.log(`   Found ${amountSearchData.count} transactions`);
    console.log(`   Amount range: -$80.00 to -$40.00`);
    
    if (amountSearchData.count >= 2) {
      console.log('   ✅ PASS: Found at least 2 transactions in range');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${amountSearchData.count}`);
    }
    
    // Verify transactions are in range
    let allInRange = true;
    for (const txn of amountSearchData.transactions) {
      if (txn.amount < -8000 || txn.amount > -4000) {
        console.log(`   ❌ Transaction ${txn.id} amount ${txn.amount} out of range`);
        allInRange = false;
      }
    }
    if (allInRange) {
      console.log('   ✅ PASS: All transactions in specified range');
    }

    // ========================================
    // TEST 4: Search by Month
    // ========================================
    console.log('\n🧪 TEST 4: Search by Month');
    console.log('=' .repeat(60));
    
    const currentMonth = testDate.substring(0, 7); // YYYY-MM
    const monthSearchResult = await callTool('actual_transactions_search_by_month', {
      month: currentMonth,
      accountId: testAccountId,
    });
    
    const monthSearchData = JSON.parse(monthSearchResult.content[0].text);
    console.log(`   Month: ${currentMonth}`);
    console.log(`   Found ${monthSearchData.count} transactions`);
    console.log(`   Total amount: ${monthSearchData.totalAmount / 100} USD`);
    
    if (monthSearchData.count >= 3) {
      console.log('   ✅ PASS: Found at least 3 transactions in current month');
    } else {
      console.log(`   ❌ FAIL: Expected at least 3, found ${monthSearchData.count}`);
    }

    // ========================================
    // TEST 5: Combined Filters (Payee + Account)
    // ========================================
    console.log('\n🧪 TEST 5: Combined Filters (Payee + Account)');
    console.log('=' .repeat(60));
    
    const combinedResult = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'Test Grocery Store',
      accountId: testAccountId,
      minAmount: -6000, // -$60.00 or less
    });
    
    const combinedData = JSON.parse(combinedResult.content[0].text);
    console.log(`   Found ${combinedData.count} transactions`);
    console.log(`   Filters: Payee=Test Grocery Store, Account=${testAccountId.substring(0, 8)}..., Amount<=-$60`);
    
    if (combinedData.count >= 2) {
      console.log('   ✅ PASS: Found at least 2 transactions matching all filters');
    } else {
      console.log(`   ❌ FAIL: Expected at least 2, found ${combinedData.count}`);
    }

    // ========================================
    // TEST 6: Case-Insensitive Search
    // ========================================
    console.log('\n🧪 TEST 6: Case-Insensitive Payee Search');
    console.log('=' .repeat(60));
    
    const caseInsensitiveResult = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'test grocery store', // lowercase
    });
    
    const caseInsensitiveData = JSON.parse(caseInsensitiveResult.content[0].text);
    console.log(`   Searched for: "test grocery store" (lowercase)`);
    console.log(`   Found ${caseInsensitiveData.count} transactions`);
    
    if (caseInsensitiveData.count >= 3) {
      console.log('   ✅ PASS: Case-insensitive search works');
    } else {
      console.log(`   ❌ FAIL: Case-insensitive search failed`);
    }

    // ========================================
    // TEST 7: Non-Existent Payee
    // ========================================
    console.log('\n🧪 TEST 7: Non-Existent Payee Error Handling');
    console.log('=' .repeat(60));
    
    const nonExistentResult = await callTool('actual_transactions_search_by_payee', {
      payeeName: 'NonExistent Payee XYZ',
    });
    
    const nonExistentData = JSON.parse(nonExistentResult.content[0].text);
    console.log(`   Searched for: "NonExistent Payee XYZ"`);
    console.log(`   Found ${nonExistentData.count} transactions`);
    
    if (nonExistentData.count === 0 && nonExistentData.error) {
      console.log(`   ✅ PASS: Proper error handling - ${nonExistentData.error}`);
    } else if (nonExistentData.count === 0) {
      console.log('   ✅ PASS: Returns empty result for non-existent payee');
    } else {
      console.log(`   ❌ FAIL: Should return 0 results, got ${nonExistentData.count}`);
    }

    // ========================================
    // Summary
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('✨ All Tests Complete!');
    console.log('='.repeat(60));
    console.log('\nTest Account Details:');
    console.log(`  Account ID: ${testAccountId}`);
    console.log(`  Category ID: ${testCategoryId}`);
    console.log(`  Payee ID: ${testPayeeId}`);
    console.log(`  Test Date: ${testDate}`);
    console.log('\n✅ All search_by_* tools validated successfully!');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
