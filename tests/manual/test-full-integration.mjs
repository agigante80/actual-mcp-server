#!/usr/bin/env node

/**
 * Full Integration Test for Actual MCP Server
 * Tests the complete flow with Actual API 26.1.0
 */

const BASE_URL = 'http://localhost:3600/http';
const TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

let sessionId = null;
let testsPassed = 0;
let testsFailed = 0;

async function makeRequest(method, params = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`
  };
  
  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }
  
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10000),
      method,
      params
    })
  });
  
  const json = await response.json();
  
  // Capture session ID from response headers if present
  if (method === 'initialize') {
    const headerSessionId = response.headers.get('mcp-session-id');
    if (headerSessionId) {
      sessionId = headerSessionId;
    }
  }
  
  return json;
}

async function test(name, fn) {
  try {
    process.stdout.write(`📝 ${name}... `);
    await fn();
    console.log('✅ PASS');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAIL: ${error.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('🧪 Full Integration Test\n');
  
  // Test 1: Initialize
  await test('Initialize session', async () => {
    const response = await makeRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {}
      },
      clientInfo: {
        name: 'integration-test',
        version: '1.0.0'
      }
    });
    
    if (response.error) throw new Error(response.error.message);
    if (!response.result?.serverInfo?.name) throw new Error('No server info');
    if (!sessionId) throw new Error('No session ID in response headers');
  });
  
  // Test 2: List tools
  await test('List 51 tools', async () => {
    const response = await makeRequest('tools/list');
    if (response.error) throw new Error(response.error.message);
    if (response.result.tools.length !== 51) {
      throw new Error(`Expected 51 tools, got ${response.result.tools.length}`);
    }
  });
  
  // Test 3: Server info
  await test('Get server info', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_server_info',
      arguments: {}
    });
    if (response.error) throw new Error(response.error.message);
  });
  
  // Test 4: List accounts
  await test('List accounts', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_accounts_list',
      arguments: {}
    });
    if (response.error) throw new Error(response.error.message);
    if (!response.result?.content?.[0]?.text) throw new Error('No account data');
  });
  
  // Test 5: Filter transactions
  await test('Filter transactions', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_transactions_filter',
      arguments: { account: null }
    });
    if (response.error) throw new Error(response.error.message);
  });
  
  // Test 6: Run SQL query
  await test('Run SQL query', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_query_run',
      arguments: { query: 'SELECT id FROM accounts LIMIT 1' }
    });
    if (response.error) throw new Error(response.error.message);
  });
  
  // Test 7: GraphQL rejection
  await test('Reject GraphQL syntax', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_query_run',
      arguments: { query: '{transactions{id}}' }
    });
    if (!response.error) throw new Error('Should have rejected GraphQL');
    // GraphQL is rejected, that's all we need to verify
  });
  
  // Test 8: Invalid field error
  await test('Detect invalid field', async () => {
    const response = await makeRequest('tools/call', {
      name: 'actual_query_run',
      arguments: { query: 'SELECT payee_name FROM transactions LIMIT 1' }
    });
    if (!response.error) throw new Error('Should have rejected payee_name');
    if (!response.error.message.includes('payee_name')) {
      throw new Error('Wrong error message for invalid field');
    }
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Results: ${testsPassed}/${testsPassed + testsFailed} tests passed`);
  
  if (testsFailed > 0) {
    console.log(`❌ ${testsFailed} tests failed`);
    process.exit(1);
  } else {
    console.log('✅ All integration tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
