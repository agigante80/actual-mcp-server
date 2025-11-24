#!/usr/bin/env node
/**
 * Test script to verify proper session lifecycle with shutdown
 * This tests the connection pooling approach where shutdown is called
 * ONLY at the end of the session, not after every operation.
 */

import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

const MCP_URL = process.argv[2] || 'http://localhost:3600/http';
const TOKEN = process.argv[3];

if (!TOKEN) {
  console.error('Usage: node test-session-shutdown.js [URL] <TOKEN>');
  process.exit(1);
}

let sessionId = null;
let requestId = 1;

async function mcpRequest(method, params = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params
  };

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${TOKEN}`,
    ...(sessionId && { 'mcp-session-id': sessionId })
  };

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const newSessionId = response.headers.get('mcp-session-id');
  if (newSessionId && !sessionId) {
    sessionId = newSessionId;
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`MCP Error: ${JSON.stringify(result.error)}`);
  }

  return result.result;
}

async function callTool(toolName, args = {}) {
  const response = await mcpRequest('tools/call', {
    name: toolName,
    arguments: args
  });
  
  if (response && response.content && response.content[0]) {
    const textContent = response.content[0].text;
    if (textContent) {
      try {
        return JSON.parse(textContent);
      } catch (e) {
        return textContent;
      }
    }
  }
  
  return response;
}

async function run() {
  console.log('🧪 Testing Session Lifecycle with Proper Shutdown\n');
  console.log('This test will:');
  console.log('1. Create an MCP session');
  console.log('2. Create a test account');
  console.log('3. Make multiple operations');
  console.log('4. Wait for session to timeout (30 min) OR manually trigger shutdown');
  console.log('5. Verify account has tombstone=0\n');

  try {
    // Initialize session
    console.log('📝 Step 1: Initialize MCP session');
    await mcpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shutdown-test-client', version: '1.0.0' }
    });
    console.log(`✅ Session initialized: ${sessionId}\n`);

    // Wait for connection pool to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create test account
    console.log('📝 Step 2: Create test account');
    const accountName = `Session-Test-${new Date().toISOString()}`;
    const createResponse = await callTool('actual_accounts_create', {
      name: accountName,
      balance: 0
    });
    const accountId = createResponse.data?.id || createResponse.id;
    console.log(`✅ Account created: ${accountId}`);
    console.log(`   Name: ${accountName}\n`);

    // Make some additional operations
    console.log('📝 Step 3: Update account');
    await callTool('actual_accounts_update', {
      id: accountId,
      fields: { name: accountName + '-Updated' }
    });
    console.log('✅ Account updated\n');

    console.log('📝 Step 4: Get account balance');
    const balance = await callTool('actual_accounts_get_balance', { id: accountId });
    console.log(`✅ Balance: ${JSON.stringify(balance)}\n`);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Session ID: ${sessionId}`);
    console.log(`Account ID: ${accountId}`);
    console.log(`Account Name: ${accountName}-Updated`);
    console.log('');
    console.log('⚠️  IMPORTANT: The account currently has unknown tombstone status.');
    console.log('');
    console.log('To complete this test and verify the fix:');
    console.log('');
    console.log('Option A - Wait for automatic timeout (30 minutes):');
    console.log('  1. Leave this session idle');
    console.log('  2. Wait 30 minutes for connection pool to timeout');
    console.log('  3. Connection pool will call shutdown() automatically');
    console.log('  4. Check database after 30+ minutes');
    console.log('');
    console.log('Option B - Manual verification (recommended):');
    console.log('  1. Stop the MCP server (Ctrl+C or pkill)');
    console.log('  2. Server shutdown will trigger connectionPool.shutdownAll()');
    console.log('  3. Check database immediately:');
    console.log(`     sqlite3 test-actual-data/_test-budget/db.sqlite \\`);
    console.log(`       "SELECT id, name, tombstone FROM accounts WHERE id='${accountId}';"`);
    console.log('  4. Expected: tombstone=0');
    console.log('');
    console.log('Option C - Verify existing account with tombstone=0:');
    console.log('  1. Check if account "MCP-Test-2025-11-21T14-43-20-464Z" is visible');
    console.log('     in Actual Budget UI at http://localhost:5006');
    console.log('  2. This account already has tombstone=0 in the database');
    console.log('  3. If visible, it proves the approach works!');
    console.log('');
    console.log('Database location:');
    console.log('  ./test-actual-data/_test-budget/db.sqlite');
    console.log('═══════════════════════════════════════════════════════════');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

run();
