// Debug script to test account creation and verify persistence

import fetch from 'node-fetch';

const MCP_URL = 'http://localhost:3600/http';
const token = 'Bearer 9381d5ca23f3746fdbcd2a9438ebe4cf';
let sessionId = null;
let requestId = 1;

async function callMCP(method, params = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': token,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
  };
  
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  
  // Capture session ID from response header if present
  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId && !sessionId) {
    sessionId = newSessionId;
  }
  
  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message);
  }
  
  return result.result;
}

async function test() {
  // Initialize
  await callMCP('initialize', { 
    protocolVersion: '2024-11-05', 
    capabilities: {},
    clientInfo: { name: 'debug-test', version: '1.0.0' } 
  });
  console.log('✓ Session initialized:', sessionId);
  
  // Create account
  const accountName = 'DEBUG-Test-' + new Date().toISOString().replace(/[:.]/g, '-');
  console.log('\nCreating account:', accountName);
  const createResult = await callMCP('tools/call', {
    name: 'actual_accounts_create',
    arguments: { name: accountName, offbudget: false, closed: false }
  });
  console.log('✓ Create result:', JSON.stringify(createResult, null, 2));
  
  // Wait a bit for sync
  console.log('\nWaiting 2 seconds for sync...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // List accounts
  console.log('Listing accounts...');
  const listResult = await callMCP('tools/call', {
    name: 'actual_accounts_list',
    arguments: {}
  });
  
  const accountsData = JSON.parse(listResult.content[0].text);
  const accounts = accountsData.result || accountsData;
  console.log(`\n✓ Total accounts: ${accounts.length}`);
  
  const found = accounts.find(a => a.name === accountName);
  if (found) {
    console.log(`✅ SUCCESS: Account "${accountName}" found!`);
    console.log('   ID:', found.id);
    console.log('   Closed:', found.closed);
    console.log('   OffBudget:', found.offbudget);
  } else {
    console.log(`❌ FAILURE: Account "${accountName}" NOT FOUND`);
  }
  
  // Show ALL accounts to debug
  console.log('\n=== ALL ACCOUNTS ===');
  accounts.forEach((a, i) => {
    console.log(`${i+1}. ${a.name}`);
    console.log(`   ID: ${a.id}`);
    console.log(`   Closed: ${a.closed}, OffBudget: ${a.offbudget}`);
  });
  
  // Show accounts from integration test
  console.log('\n=== Checking for integration test accounts ===');
  const testAccounts = accounts.filter(a => a.name.includes('MCP-Test') || a.name.includes('12-06'));
  if (testAccounts.length > 0) {
    console.log('Found', testAccounts.length, 'test accounts:');
    testAccounts.forEach(a => console.log(`  - ${a.name} (ID: ${a.id}, Closed: ${a.closed})`));
  } else {
    console.log('No MCP-Test or 12-06 accounts found');
  }
}

test().catch(console.error);
