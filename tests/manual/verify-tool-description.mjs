#!/usr/bin/env node
/**
 * Verify the actual tool description shown to AI
 */

import fetch from 'node-fetch';

const MCP_SERVER_URL = 'http://localhost:3600/http';
const AUTH_TOKEN = 'TEST-TOKEN-FOR-AUTOMATED-TESTING-ONLY';

async function getToolDescription() {
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
  
  // Get tools list
  const toolsResponse = await fetch(MCP_SERVER_URL, {
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
      method: 'tools/list'
    })
  });
  
  const toolsData = await toolsResponse.json();
  const queryTool = toolsData.result.tools.find(t => t.name === 'actual_query_run');
  
  console.log('📋 Tool Description as Seen by AI:\n');
  console.log('═'.repeat(80));
  console.log(queryTool.description);
  console.log('═'.repeat(80));
  
  console.log('\n🔍 Key Points:\n');
  const desc = queryTool.description;
  console.log('✓ SQL marked as RECOMMENDED:', desc.includes('**RECOMMENDED: Use SQL syntax**') ? 'YES ✅' : 'NO ❌');
  console.log('✓ Uses payee.name (correct):', desc.includes('payee.name') ? 'YES ✅' : 'NO ❌');
  console.log('✓ Warns against payee_name:', desc.includes('(NOT payee_name)') ? 'YES ✅' : 'NO ❌');
  console.log('✓ Has Common Queries section:', desc.includes('Common Queries:') ? 'YES ✅' : 'NO ❌');
  console.log('✓ Has IMPORTANT Field Names:', desc.includes('IMPORTANT - Field Names:') ? 'YES ✅' : 'NO ❌');
}

getToolDescription().catch(console.error);
