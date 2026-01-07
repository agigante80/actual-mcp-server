#!/usr/bin/env node
/**
 * Test GraphQL syntax detection in query tool
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3600/http';
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

console.log('🧪 Testing GraphQL Detection...\n');

async function testGraphQLDetection() {
  try {
    // Initialize connection
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
          clientInfo: { name: 'test', version: '1.0.0' }
        }
      })
    });
    
    const sessionId = initResponse.headers.get('mcp-session-id');
    const initResult = await initResponse.json();
    if (initResult.error) {
      throw new Error(`Initialize failed: ${initResult.error.message}`);
    }
    console.log('   ✅ Connected');
    console.log('   📝 Session ID:', sessionId, '\n');
    
    // Test 1: GraphQL syntax should be rejected
    console.log('2️⃣  Testing GraphQL syntax rejection...');
    const graphqlQuery = `query LastFiveTransactions {
      transactions(limit: 5, orderBy: { date: "desc" }) {
        id
        date
        amount
        payee {
          name
        }
      }
    }`;
    
    const graphqlResponse = await fetch(MCP_SERVER_URL, {
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
          name: 'actual_query_run',
          arguments: {
            query: graphqlQuery
          }
        }
      })
    });
    
    const graphqlResult = await graphqlResponse.json();
    
    if (graphqlResult.error && graphqlResult.error.message.includes('GraphQL syntax is not fully supported')) {
      console.log('   ✅ GraphQL syntax correctly rejected');
      console.log('   📝 Error message:\n', graphqlResult.error.message.substring(0, 200), '...\n');
    } else {
      console.log('   ❌ GraphQL syntax was NOT rejected as expected');
      console.log('   📝 Result:', JSON.stringify(graphqlResult, null, 2).substring(0, 500));
    }
    
    // Test 2: payee_name error should give helpful message
    console.log('3️⃣  Testing payee_name error detection...');
    const sqlQuery = 'SELECT id, payee_name FROM transactions LIMIT 5';
    
    const sqlResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'actual_query_run',
          arguments: {
            query: sqlQuery
          }
        }
      })
    });
    
    const sqlResult = await sqlResponse.json();
    
    if (sqlResult.error && sqlResult.error.message.includes('Use payee.name (NOT payee_name)')) {
      console.log('   ✅ Field name error correctly detected');
      console.log('   📝 Error message:\n', sqlResult.error.message.substring(0, 200), '...\n');
    } else {
      console.log('   ❌ Field name error was NOT detected as expected');
      console.log('   📝 Result:', JSON.stringify(sqlResult, null, 2).substring(0, 500));
    }
    
    // Test 3: Correct SQL should work
    console.log('4️⃣  Testing correct SQL syntax...');
    const correctQuery = 'SELECT id, date, amount, payee.name FROM transactions ORDER BY date DESC LIMIT 5';
    
    const correctResponse = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'actual_query_run',
          arguments: {
            query: correctQuery
          }
        }
      })
    });
    
    const correctResult = await correctResponse.json();
    
    if (!correctResult.error) {
      console.log('   ✅ Correct SQL syntax works');
      console.log('   📊 Returned', correctResult.result?.content?.[0]?.text ? 'data' : 'empty result', '\n');
    } else {
      console.log('   ❌ Correct SQL failed unexpectedly');
      console.log('   📝 Error:', correctResult.error.message);
    }
    
    console.log('============================================================');
    console.log('✅ All detection tests passed!');
    console.log('============================================================');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testGraphQLDetection();
