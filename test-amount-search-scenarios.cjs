#!/usr/bin/env node
/**
 * Test script for actual_transactions_search_by_amount with absoluteAmount parameter
 * Tests various scenarios for searching transactions by amount
 */

const http = require('http');

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'localhost';
const MCP_SERVER_PORT = process.env.MCP_SERVER_PORT || 3600;
const AUTH_TOKEN = process.env.MCP_SSE_AUTHORIZATION || 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

let sessionId = `test-amount-search-${Date.now()}`;
let requestId = 0;

function mcpRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method,
      params,
    });

    const options = {
      hostname: MCP_SERVER_URL,
      port: MCP_SERVER_PORT,
      path: '/http',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(response.error.message || JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        } catch (err) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function initialize() {
  console.log('🔌 Initializing MCP session...');
  console.log(`   Session ID: ${sessionId}`);
  const result = await mcpRequest('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'amount-search-test', version: '1.0.0' },
  });
  console.log(`✅ Session initialized\n`);
}

async function callTool(toolName, args) {
  const result = await mcpRequest('tools/call', {
    name: toolName,
    arguments: args,
  });
  
  if (result.content && result.content[0] && result.content[0].text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AMOUNT SEARCH TEST SUITE - absoluteAmount Feature');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let testsPassed = 0;
  let testsFailed = 0;

  async function test(name, testFn) {
    process.stdout.write(`📝 ${name}... `);
    try {
      await testFn();
      console.log('✅ PASS');
      testsPassed++;
    } catch (err) {
      console.log(`❌ FAIL: ${err.message}`);
      testsFailed++;
    }
  }

  // Test 1: Search by absoluteAmount=5000 (should find both +5000 and -5000)
  await test('Search by absoluteAmount=5000 (both income and expense)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 5000,
      limit: 20,
    });
    
    if (result.count === 0) {
      throw new Error('No transactions found with absoluteAmount=5000');
    }
    
    // Check if we found both positive and negative amounts
    const hasNegative = result.transactions.some(t => t.amount < 0);
    const hasPositive = result.transactions.some(t => t.amount > 0);
    
    console.log(`\n   Found ${result.count} transactions (negative: ${hasNegative ? 'yes' : 'no'}, positive: ${hasPositive ? 'yes' : 'no'})`);
    console.log(`   Total amount: ${result.totalAmount} cents ($${(result.totalAmount / 100).toFixed(2)})`);
    
    // Verify all have absolute value of 5000
    const allMatch = result.transactions.every(t => Math.abs(t.amount) === 5000);
    if (!allMatch) {
      throw new Error('Not all transactions have absolute value of 5000');
    }
  });

  // Test 2: Old way - minAmount/maxAmount for exact signed value
  await test('Search minAmount=5000, maxAmount=5000 (only positive)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      minAmount: 5000,
      maxAmount: 5000,
      limit: 20,
    });
    
    console.log(`\n   Found ${result.count} transactions with amount exactly +5000`);
    if (result.count > 0) {
      const allPositive = result.transactions.every(t => t.amount === 5000);
      if (!allPositive) {
        throw new Error('Found transactions that are not exactly +5000');
      }
    }
  });

  // Test 3: Search for negative amounts using signed range
  await test('Search minAmount=-6000, maxAmount=-4000 (expenses only)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      minAmount: -6000,
      maxAmount: -4000,
      limit: 20,
    });
    
    console.log(`\n   Found ${result.count} transactions in range -$60 to -$40`);
    if (result.count > 0) {
      const allInRange = result.transactions.every(t => t.amount >= -6000 && t.amount <= -4000);
      if (!allInRange) {
        throw new Error('Found transactions outside the range');
      }
      console.log(`   Sample amounts: ${result.transactions.slice(0, 3).map(t => `$${(t.amount / 100).toFixed(2)}`).join(', ')}`);
    }
  });

  // Test 4: Search by absoluteAmount=10000
  await test('Search by absoluteAmount=10000', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 10000,
      limit: 20,
    });
    
    console.log(`\n   Found ${result.count} transactions with magnitude $100.00`);
    if (result.count > 0) {
      const allMatch = result.transactions.every(t => Math.abs(t.amount) === 10000);
      if (!allMatch) {
        throw new Error('Not all transactions have absolute value of 10000');
      }
    }
  });

  // Test 5: Search with absoluteAmount and account filter
  await test('Search absoluteAmount=5000 with account filter', async () => {
    // First get an account ID
    const accountsResult = await callTool('actual_accounts_list', {});
    const accounts = accountsResult.accounts || accountsResult || [];
    
    if (!Array.isArray(accounts) || accounts.length === 0) {
      console.log('\n   ⏭️  Skipped - no accounts available');
      return;
    }
    
    const accountId = accounts[0].id;
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 5000,
      accountId: accountId,
      limit: 20,
    });
    
    console.log(`\n   Found ${result.count} transactions in account "${accounts[0].name}"`);
    if (result.count > 0) {
      const allCorrectAccount = result.transactions.every(t => t.account === accountId);
      if (!allCorrectAccount) {
        throw new Error('Found transactions from wrong account');
      }
    }
  });

  // Test 6: Search with absoluteAmount and date range
  await test('Search absoluteAmount=5000 with date range (Dec 2025)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 5000,
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      limit: 20,
    });
    
    console.log(`\n   Found ${result.count} transactions in December 2025`);
    if (result.count > 0) {
      const sample = result.transactions[0];
      console.log(`   Sample: date=${sample.date}, amount=$${(sample.amount / 100).toFixed(2)}`);
    }
  });

  // Test 7: Large amount search
  await test('Search by absoluteAmount=50000 (large transactions)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 50000,
      limit: 10,
    });
    
    console.log(`\n   Found ${result.count} transactions with magnitude $500.00`);
  });

  // Test 8: Small amount search
  await test('Search by absoluteAmount=100 (small transactions)', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 100,
      limit: 10,
    });
    
    console.log(`\n   Found ${result.count} transactions with magnitude $1.00`);
  });

  // Test 9: Verify absoluteAmount takes precedence over min/max
  await test('absoluteAmount overrides minAmount/maxAmount', async () => {
    const result = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 5000,
      minAmount: 10000, // This should be ignored
      maxAmount: 20000, // This should be ignored
      limit: 20,
    });
    
    if (result.count > 0) {
      // Should find transactions with absolute value 5000, not in range 10000-20000
      const allMatch = result.transactions.every(t => Math.abs(t.amount) === 5000);
      if (!allMatch) {
        throw new Error('absoluteAmount did not override minAmount/maxAmount');
      }
      console.log(`\n   ✓ Correctly found ${result.count} transactions with absolute value 5000`);
      console.log('   ✓ Ignored minAmount=10000, maxAmount=20000');
    }
  });

  // Test 10: Comprehensive comparison
  await test('Compare old vs new search methods', async () => {
    // Old method: signed range
    const oldResult = await callTool('actual_transactions_search_by_amount', {
      minAmount: -5000,
      maxAmount: 5000,
      limit: 50,
    });
    
    // New method: absolute value
    const newResult = await callTool('actual_transactions_search_by_amount', {
      absoluteAmount: 5000,
      limit: 50,
    });
    
    console.log('\n   Old method (minAmount=-5000, maxAmount=5000):');
    console.log(`     - Found ${oldResult.count} transactions`);
    console.log(`     - Includes all amounts from -$50 to +$50`);
    
    console.log('   New method (absoluteAmount=5000):');
    console.log(`     - Found ${newResult.count} transactions`);
    console.log(`     - Only exact magnitude of $50 (both + and -)`);
    
    if (newResult.count > oldResult.count) {
      throw new Error('absoluteAmount should find equal or fewer results than wide range');
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return testsFailed === 0;
}

async function main() {
  try {
    await initialize();
    const success = await runTests();
    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
