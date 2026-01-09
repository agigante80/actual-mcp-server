#!/usr/bin/env node
/**
 * Test Script: Batch Budget Updates
 * 
 * Tests the actual_budget_updates_batch tool with various scenarios
 * to verify it works correctly and identify performance characteristics.
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';
const HTTP_PATH = process.env.HTTP_PATH || '/http';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

// Helper to make MCP tool calls
async function callMCPTool(sessionId, toolName, args = {}) {
  const url = `${MCP_SERVER_URL}${HTTP_PATH}`;
  const payload = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 10000),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const startTime = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'mcp-session-id': sessionId,
  };
  
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();

  if (json.error) {
    throw new Error(`MCP Error: ${json.error.message}`);
  }

  return { result: json.result, elapsed };
}

// Helper to initialize MCP session
async function initializeSession() {
  const url = `${MCP_SERVER_URL}${HTTP_PATH}`;
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-batch-updates', version: '1.0.0' },
    },
  };

  const headers = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  const sessionId = response.headers.get('mcp-session-id');

  if (!sessionId) {
    throw new Error('No session ID returned from server');
  }

  return sessionId;
}

// Get current month and next 2 months in YYYY-MM format
function getMonthRange(count = 3) {
  const months = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = date.toISOString().substring(0, 7);
    months.push(month);
  }
  
  return months;
}

console.log('🧪 Testing Batch Budget Updates\n');
console.log('=' .repeat(70));

let sessionId;
let testCategoryId;
let testCategoryGroupId;

async function runTests() {
  try {
    // Initialize session
    console.log('\n📡 Initializing MCP session...');
    sessionId = await initializeSession();
    console.log(`   ✅ Session ID: ${sessionId}`);

    // Create test category group
    console.log('\n📁 Creating test category group...');
    const { result: groupResult } = await callMCPTool(sessionId, 'actual_category_groups_create', {
      name: `Test-Batch-${Date.now()}`,
    });
    testCategoryGroupId = groupResult?.content?.[0]?.text 
      ? JSON.parse(groupResult.content[0].text).id 
      : groupResult.id;
    console.log(`   ✅ Created group: ${testCategoryGroupId}`);

    // Create test category
    console.log('\n📂 Creating test category (Savings)...');
    const { result: categoryResult } = await callMCPTool(sessionId, 'actual_categories_create', {
      name: 'Savings',
      group_id: testCategoryGroupId,
    });
    
    console.log('   🔍 Debug - categoryResult:', JSON.stringify(categoryResult, null, 2));
    
    // Try multiple extraction methods
    if (categoryResult?.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(categoryResult.content[0].text);
        testCategoryId = parsed.id || parsed.categoryId;
      } catch {
        testCategoryId = categoryResult.content[0].text;
      }
    } else if (categoryResult?.id) {
      testCategoryId = categoryResult.id;
    } else if (categoryResult?.categoryId) {
      testCategoryId = categoryResult.categoryId;
    } else if (typeof categoryResult === 'string') {
      testCategoryId = categoryResult;
    }
    
    console.log(`   ✅ Created category: ${testCategoryId}`);

    // TEST SCENARIOS
    const tests = [
      {
        name: 'Single month update',
        description: 'Set budget for current month only',
        operations: [
          { month: getMonthRange(1)[0], categoryId: testCategoryId, amount: 50000 }, // $500
        ],
      },
      {
        name: 'Three months update (example scenario)',
        description: 'Set "Savings" budget for 3 months with $300 each',
        operations: getMonthRange(3).map(month => ({
          month,
          categoryId: testCategoryId,
          amount: 30000, // $300 in cents
        })),
      },
      {
        name: 'Large batch (12 months)',
        description: 'Set budget for entire year',
        operations: getMonthRange(12).map(month => ({
          month,
          categoryId: testCategoryId,
          amount: 25000, // $250 in cents
        })),
      },
      {
        name: 'Mixed amounts across 6 months',
        description: 'Different amounts for different months',
        operations: [
          { month: getMonthRange(6)[0], categoryId: testCategoryId, amount: 10000 }, // $100
          { month: getMonthRange(6)[1], categoryId: testCategoryId, amount: 20000 }, // $200
          { month: getMonthRange(6)[2], categoryId: testCategoryId, amount: 30000 }, // $300
          { month: getMonthRange(6)[3], categoryId: testCategoryId, amount: 40000 }, // $400
          { month: getMonthRange(6)[4], categoryId: testCategoryId, amount: 50000 }, // $500
          { month: getMonthRange(6)[5], categoryId: testCategoryId, amount: 60000 }, // $600
        ],
      },
      {
        name: 'Update same month twice',
        description: 'Verify last update wins',
        operations: [
          { month: getMonthRange(1)[0], categoryId: testCategoryId, amount: 10000 }, // $100
          { month: getMonthRange(1)[0], categoryId: testCategoryId, amount: 99900 }, // $999 (should win)
        ],
      },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`\n📝 Test: ${test.name}`);
      console.log(`   Description: ${test.description}`);
      console.log(`   Operations: ${test.operations.length}`);
      console.log(`   Months: ${test.operations.map(op => op.month).join(', ')}`);

      try {
        console.log('\n   ⏳ Calling actual_budget_updates_batch...');
        const { result, elapsed } = await callMCPTool(
          sessionId,
          'actual_budget_updates_batch',
          { operations: test.operations }
        );

        console.log(`   ⏱️  Elapsed time: ${elapsed}ms`);
        console.log(`   📊 Result type: ${typeof result}`);

        // Extract the actual result
        let parsedResult = result;
        if (result?.content?.[0]?.text) {
          try {
            parsedResult = JSON.parse(result.content[0].text);
          } catch {
            parsedResult = result.content[0].text;
          }
        }

        console.log(`   ✅ PASS - Tool executed successfully`);
        console.log(`   📋 Result: ${JSON.stringify(parsedResult, null, 2).split('\n').map((l, i) => i === 0 ? l : '      ' + l).join('\n')}`);
        passed++;

        // Performance warning
        if (elapsed > 30000) {
          console.log(`   ⚠️  WARNING: Operation took ${(elapsed / 1000).toFixed(1)}s (>30s)`);
        }

      } catch (error) {
        console.log(`   ❌ FAIL - ${error.message}`);
        console.log(`   Error details: ${error.stack}`);
        failed++;
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log(`\n${'='.repeat(70)}`);
    console.log(`\n📊 Results: ${passed}/${tests.length} tests passed`);

    if (failed > 0) {
      console.log(`❌ ${failed} test(s) failed`);
      return false;
    } else {
      console.log('✅ All tests passed!');
      return true;
    }

  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.error(error.stack);
    return false;
  } finally {
    // Cleanup
    if (sessionId && testCategoryId) {
      console.log('\n🧹 Cleaning up test data...');
      try {
        await callMCPTool(sessionId, 'actual_categories_delete', {
          id: testCategoryId,
        });
        console.log('   ✅ Deleted test category');
      } catch (error) {
        console.log(`   ⚠️  Could not delete category: ${error.message}`);
      }
    }

    if (sessionId && testCategoryGroupId) {
      try {
        await callMCPTool(sessionId, 'actual_category_groups_delete', {
          id: testCategoryGroupId,
        });
        console.log('   ✅ Deleted test category group');
      } catch (error) {
        console.log(`   ⚠️  Could not delete category group: ${error.message}`);
      }
    }
  }
}

// Run tests
runTests().then((success) => {
  process.exit(success ? 0 : 1);
}).catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
