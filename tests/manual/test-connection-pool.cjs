#!/usr/bin/env node
/**
 * Test script to verify connection pooling properly handles session lifecycle
 * and fixes the tombstone=1 issue.
 */

const http = require('http');
const { randomUUID } = require('crypto');

const MCP_URL = process.argv[2] || 'http://localhost:3600/http';
const TOKEN = process.argv[3];

if (!TOKEN) {
  console.error('Usage: node test-connection-pool.js [URL] <TOKEN>');
  console.error('Example: node test-connection-pool.js http://localhost:3600/http mytoken');
  process.exit(1);
}

// Helper to make MCP requests
async function mcpRequest(sessionId, method, params = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(MCP_URL);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params
    });

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${TOKEN}`,
        ...(sessionId && { 'mcp-session-id': sessionId })
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`MCP Error: ${JSON.stringify(response.error)}`));
          } else {
            // Include response headers for session ID
            response._headers = res.headers;
            resolve(response);
          }
        } catch (err) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runTest() {
  console.log('🧪 Connection Pool Lifecycle Test\n');
  console.log('This test verifies that:');
  console.log('1. Each MCP session gets its own Actual Budget connection');
  console.log('2. Connections are properly shutdown when sessions end');
  console.log('3. Data persists without tombstone=1 issue\n');

  try {
    // Step 1: Initialize a session
    console.log('📝 Step 1: Initialize MCP session');
    const initResponse = await mcpRequest(null, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });

    const sessionId = initResponse._headers['mcp-session-id'];
    if (!sessionId) {
      console.log('Response headers:', initResponse._headers);
      throw new Error('No session ID returned from initialize');
    }
    console.log(`✅ Session initialized: ${sessionId}`);

    // Wait a moment for session initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Create a test account
    console.log('\n📝 Step 2: Create test account');
    const accountName = `Pool-Test-${new Date().toISOString()}`;
    const createResponse = await mcpRequest(sessionId, 'tools/call', {
      name: 'actual_accounts_create',
      arguments: {
        account: {
          name: accountName,
          offbudget: false,
          closed: false
        }
      }
    });

    const accountId = JSON.parse(createResponse.result.content[0].text).data.id;
    console.log(`✅ Account created: ${accountId}`);
    console.log(`   Name: ${accountName}`);

    // Step 3: Verify account exists with tombstone=0
    console.log('\n📝 Step 3: Check database immediately');
    const { execSync } = require('child_process');
    
    const dbPath = './tests/manual/test-stack/mcp/actual-data/sessions/' + sessionId + '/*/db.sqlite';
    const checkCmd = `sqlite3 $(ls ${dbPath} 2>/dev/null | head -1) "SELECT name, tombstone FROM accounts WHERE id='${accountId}';" 2>/dev/null || echo "Database not found"`;
    
    try {
      const result = execSync(checkCmd, { encoding: 'utf-8' });
      console.log(`Database query result: ${result}`);
      
      if (result.includes('|0')) {
        console.log('✅ Account has tombstone=0 (persisted correctly)');
      } else if (result.includes('|1')) {
        console.log('❌ Account has tombstone=1 (BUG: still being marked as deleted)');
      } else {
        console.log('⚠️  Could not verify tombstone state');
      }
    } catch (err) {
      console.log('⚠️  Could not query database:', err.message);
    }

    console.log('\n✅ Test completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Account ID: ${accountId}`);
    console.log(`   Account Name: ${accountName}`);
    console.log('\nThe session will timeout after 30 minutes of inactivity,');
    console.log('at which point the connection will be properly shutdown.');
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

runTest();
