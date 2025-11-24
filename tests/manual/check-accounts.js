#!/usr/bin/env node
/**
 * Quick script to check what accounts exist in the budget
 */

import fetch from 'node-fetch';

const MCP_SERVER = process.argv[2] || 'http://localhost:3600/http';
const AUTH_TOKEN = process.argv[3] || '9381d5ca23f3746fdbcd2a9438ebe4cf';

let sessionId = null;

async function callMCP(method, params = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (sessionId) {
    headers['x-session-id'] = sessionId;
  }
  
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetch(MCP_SERVER, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random().toString(36).substring(7),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`MCP Error: ${data.error.message}`);
  }

  return data.result;
}

async function callTool(name, args = {}) {
  const result = await callMCP('tools/call', { name, arguments: args });
  
  if (result.isError) {
    throw new Error(`Tool error: ${JSON.stringify(result.content)}`);
  }

  if (result.content && result.content[0] && result.content[0].text) {
    return JSON.parse(result.content[0].text);
  }
  
  return result;
}

async function main() {
  console.log('Initializing session...');
  const initResult = await callMCP('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'check-accounts', version: '1.0.0' }
  });
  
  sessionId = initResult.sessionId;
  console.log(`✓ Session: ${sessionId}\n`);

  console.log('Fetching accounts...');
  const accounts = await callTool('actual_accounts_list', {});
  
  console.log('\n=== ACCOUNTS IN BUDGET ===');
  if (accounts.result && Array.isArray(accounts.result)) {
    console.log(`Found ${accounts.result.length} accounts:\n`);
    accounts.result.forEach((account, i) => {
      console.log(`${i + 1}. ${account.name}`);
      console.log(`   ID: ${account.id}`);
      console.log(`   Balance: ${account.balance || 0}`);
      console.log(`   Closed: ${account.closed || false}`);
      console.log(`   Off Budget: ${account.offbudget || false}`);
      console.log('');
    });
  } else {
    console.log('No accounts found or unexpected format:');
    console.log(JSON.stringify(accounts, null, 2));
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
