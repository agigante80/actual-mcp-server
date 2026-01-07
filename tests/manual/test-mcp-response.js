#!/usr/bin/env node

/**
 * Test MCP server response format
 */

import http from 'http';

const AUTH_TOKEN = '7Y6nx7kLc45pWvCoscCrOnabltezkRW1';
const MCP_URL = 'http://localhost:3600/http';

async function makeRequest(method, sessionId = null, params = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Accept': 'application/json, text/event-stream',
      },
    };

    if (sessionId) {
      options.headers['mcp-session-id'] = sessionId;
    }

    const req = http.request(MCP_URL, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function test() {
  console.log('1. Initializing...');
  const initResult = await makeRequest('initialize', null, {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  console.log('Init result:', JSON.stringify(initResult, null, 2));

  if (initResult.error) {
    console.error('Initialization failed:', initResult.error);
    return;
  }

  // Extract session ID from headers (MCP uses headers, not body)
  // For this test, we'll generate one and assume the server accepts it
  const sessionId = 'mcp-test-' + Date.now();
  console.log('\n2. Using Session ID:', sessionId);

  console.log('\n3. Listing tools...');
  const toolsResult = await makeRequest('tools/list', sessionId);
  console.log('Tools result keys:', Object.keys(toolsResult.result || {}));
  console.log('Number of tools:', toolsResult.result?.tools?.length || 0);

  if (toolsResult.result?.tools?.length > 0) {
    console.log('\n4. First tool:');
    const firstTool = toolsResult.result.tools[0];
    console.log(JSON.stringify(firstTool, null, 2));

    console.log('\n5. First tool inputSchema:');
    console.log(JSON.stringify(firstTool.inputSchema, null, 2));
  }
}

test().catch(console.error);
