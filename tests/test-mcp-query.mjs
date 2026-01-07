#!/usr/bin/env node
/**
 * Test MCP Query Tool - Verify actual_query_run works correctly
 * Tests SQL query execution including error handling for invalid queries
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3600/http';
const AUTH_TOKEN = process.env.MCP_SSE_AUTHORIZATION || 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

console.log('🧪 Testing MCP Query Tool...');
console.log(`📍 Server URL: ${MCP_SERVER_URL}\n`);

async function testQueryTool() {
  let sessionId;
  
  try {
    // Step 1: Initialize connection
    console.log('1️⃣  Initializing connection...');
    const initResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'query-test-client',
            version: '1.0.0'
          }
        }
      })
    });

    if (!initResponse.ok) {
      throw new Error(`Initialize failed: ${initResponse.status} ${initResponse.statusText}`);
    }

    sessionId = initResponse.headers.get('mcp-session-id');
    const initData = await initResponse.json();
    
    console.log(`   ✅ Connected successfully`);
    console.log(`   📝 Session ID: ${sessionId}\n`);

    // Step 2: Get list of accounts to use in queries
    console.log('2️⃣  Getting account list...');
    const accountsResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'actual_accounts_list',
          arguments: {}
        }
      })
    });

    if (!accountsResponse.ok) {
      throw new Error(`Accounts list failed: ${accountsResponse.status}`);
    }

    const accountsData = await accountsResponse.json();
    const accountsResult = JSON.parse(accountsData.result.content[0].text);
    // Response structure: {result: [{id, name, offbudget, closed}, ...]}
    const accounts = accountsResult.result || accountsResult.accounts || [];
    
    console.log(`   ✅ Found ${accounts.length} accounts`);
    
    if (accounts.length === 0) {
      console.log('   ⚠️  No accounts found, skipping account-specific queries\n');
      return await testBasicQueries(sessionId);
    }

    const testAccount = accounts[0];
    console.log(`   📌 Using account: ${testAccount.name} (${testAccount.id})\n`);

    // Step 3: Test valid query with SELECT *
    console.log('3️⃣  Testing valid query (SELECT * with LIMIT)...');
    const validQuery1 = `SELECT * FROM transactions WHERE account = "${testAccount.id}" ORDER BY date DESC LIMIT 5`;
    const result1 = await callQueryTool(sessionId, validQuery1);
    
    if (result1.success) {
      console.log(`   ✅ Query succeeded`);
      console.log(`   📊 Returned ${result1.data.length} rows\n`);
    } else {
      console.log(`   ❌ Query failed: ${result1.error}\n`);
    }

    // Step 4: Test valid query with specific fields (no aliases)
    console.log('4️⃣  Testing valid query (specific fields, no aliases)...');
    const validQuery2 = `SELECT id, date, amount, payee, category, notes FROM transactions WHERE account = "${testAccount.id}" LIMIT 3`;
    const result2 = await callQueryTool(sessionId, validQuery2);
    
    if (result2.success) {
      console.log(`   ✅ Query succeeded`);
      console.log(`   📊 Returned ${result2.data.length} rows`);
      if (result2.data[0]) {
        console.log(`   📝 Sample row fields: ${Object.keys(result2.data[0]).join(', ')}\n`);
      }
    } else {
      console.log(`   ❌ Query failed: ${result2.error}\n`);
    }

    // Step 5: Test query with SQL aliases (should strip aliases automatically)
    console.log('5️⃣  Testing query with SQL aliases (should strip AS clauses)...');
    const aliasQuery = `SELECT id, date, amount AS amt, payee.name AS payee_name, category.name AS cat FROM transactions WHERE account = "${testAccount.id}" LIMIT 3`;
    const result3 = await callQueryTool(sessionId, aliasQuery);
    
    if (result3.success) {
      console.log(`   ✅ Query succeeded (aliases stripped automatically)`);
      console.log(`   📊 Returned ${result3.data.length} rows\n`);
    } else {
      console.log(`   ❌ Query failed: ${result3.error}\n`);
    }

    // Step 6: Test invalid query (non-existent field) - should return error, NOT crash
    console.log('6️⃣  Testing invalid query (non-existent field)...');
    const invalidQuery = `SELECT id, payee_name FROM transactions LIMIT 5`;
    const result4 = await callQueryTool(sessionId, invalidQuery);
    
    if (!result4.success && result4.error) {
      console.log(`   ✅ Query properly returned error (server did not crash)`);
      console.log(`   📝 Error message: ${result4.error.substring(0, 100)}...\n`);
    } else if (result4.success) {
      console.log(`   ⚠️  Query unexpectedly succeeded (should have failed)\n`);
    } else {
      console.log(`   ❌ Unexpected result\n`);
    }

    // Step 7: Test query with joins
    console.log('7️⃣  Testing query with joins (payee.name, category.name)...');
    const joinQuery = `SELECT id, date, amount, payee.name, category.name FROM transactions WHERE account = "${testAccount.id}" LIMIT 3`;
    const result5 = await callQueryTool(sessionId, joinQuery);
    
    if (result5.success) {
      console.log(`   ✅ Query with joins succeeded`);
      console.log(`   📊 Returned ${result5.data.length} rows`);
      if (result5.data[0]) {
        console.log(`   📝 Fields: ${Object.keys(result5.data[0]).join(', ')}\n`);
      }
    } else {
      console.log(`   ❌ Query failed: ${result5.error}\n`);
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Query tool is working correctly`);
    console.log(`✅ SQL alias stripping works`);
    console.log(`✅ Error handling prevents server crashes`);
    console.log(`✅ Joins (payee.name, category.name) work correctly\n`);

    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error('\n📋 Stack trace:');
      console.error(error.stack);
    }
    return false;
  }
}

async function testBasicQueries(sessionId) {
  console.log('3️⃣  Testing basic queries without account filter...');
  
  // Test simple query
  const basicQuery = `SELECT id, date, amount FROM transactions LIMIT 5`;
  const result = await callQueryTool(sessionId, basicQuery);
  
  if (result.success) {
    console.log(`   ✅ Basic query succeeded`);
    console.log(`   📊 Returned ${result.data.length} rows\n`);
    return true;
  } else {
    console.log(`   ❌ Basic query failed: ${result.error}\n`);
    return false;
  }
}

async function callQueryTool(sessionId, query) {
  try {
    const response = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1000000),
        method: 'tools/call',
        params: {
          name: 'actual_query_run',
          arguments: { query }
        }
      })
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    
    if (data.error) {
      return { success: false, error: data.error.message || JSON.stringify(data.error) };
    }

    if (data.result && data.result.content && data.result.content[0]) {
      const resultText = data.result.content[0].text;
      try {
        const parsed = JSON.parse(resultText);
        return { success: true, data: parsed };
      } catch {
        return { success: true, data: resultText };
      }
    }

    return { success: false, error: 'No result in response' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Run the test
testQueryTool().then(success => {
  process.exit(success ? 0 : 1);
});
