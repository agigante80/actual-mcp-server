#!/usr/bin/env node
import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3600/http';
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

const CRITICAL_TOOLS = [
  { name: 'actual_accounts_list', args: {} },
  { name: 'actual_transactions_filter', args: { account: null } },
  { name: 'actual_categories_get', args: {} },
  { name: 'actual_payees_get', args: {} },
  { name: 'actual_budgets_getMonth', args: { month: '2026-01' } },
  { name: 'actual_server_info', args: {} },
  { name: 'actual_query_run', args: { query: 'SELECT * FROM accounts LIMIT 1' } }
];

async function testTools() {
  console.log('🧪 Testing Critical MCP Tools...\n');
  
  // Initialize
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
  console.log(`✅ Session initialized: ${sessionId}\n`);
  
  let passed = 0;
  let failed = 0;
  
  for (const { name, args } of CRITICAL_TOOLS) {
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
          id: 2,
          method: 'tools/call',
          params: {
            name: name,
            arguments: args
          }
        })
      });
      
      const result = await response.json();
      
      if (result.error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${result.error.message}\n`);
        failed++;
      } else {
        const content = result.result?.content?.[0]?.text;
        const data = content ? JSON.parse(content) : null;
        const count = Array.isArray(data?.result) ? data.result.length : 
                      data?.result ? 'ok' : 
                      data ? 'ok' : 'unknown';
        console.log(`✅ ${name} → ${count}`);
        passed++;
      }
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Exception: ${error.message}\n`);
      failed++;
    }
  }
  
  console.log('\n============================================================');
  console.log(`📊 Results: ${passed}/${CRITICAL_TOOLS.length} tools passed`);
  if (failed === 0) {
    console.log('✅ All critical tools working!');
  } else {
    console.log(`❌ ${failed} tools failed`);
    process.exit(1);
  }
}

testTools().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
