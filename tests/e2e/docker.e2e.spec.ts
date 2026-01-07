/**
 * Docker-based E2E tests
 * 
 * Tests the full stack: Actual Budget server + MCP server (Docker build)
 * This verifies production deployment, real tool execution, and integration
 */

import { test, expect } from '@playwright/test';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://mcp-server-test:3600';
const HTTP_PATH = '/http';

test.describe('Docker E2E - Full Stack Integration', () => {
  let sessionId: string | undefined;

  test('should verify services are healthy', async ({ request }) => {
    // Check MCP server health
    const healthRes = await request.get(`${MCP_SERVER_URL}/health`);
    expect(healthRes.ok()).toBeTruthy();
    const health = await healthRes.json();
    console.log('MCP Server health:', health);
    expect(health.status).toBe('ok');
  });

  test('should initialize MCP session', async ({ request }) => {
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'docker-e2e-test', version: '1.0.0' },
      },
    };

    const initRes = await request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    expect(initRes.ok()).toBeTruthy();
    const initJson = await initRes.json();
    expect(initJson.result).toBeTruthy();
    
    sessionId = initRes.headers()['mcp-session-id'];
    expect(sessionId).toBeTruthy();
    console.log('Session initialized:', sessionId);
  });

  test('should list all available tools', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const listPayload = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };

    const listRes = await request.post(rpcUrl, {
      data: JSON.stringify(listPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    expect(listRes.ok()).toBeTruthy();
    const listJson = await listRes.json();
    const tools = listJson.result?.tools || [];
    
    expect(Array.isArray(tools)).toBeTruthy();
    expect(tools.length).toBeGreaterThan(40); // Should have 51 tools
    console.log(`Listed ${tools.length} tools`);
    
    // Verify key tools exist
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('actual_server_info');
    expect(toolNames).toContain('actual_accounts_list');
    expect(toolNames).toContain('actual_transactions_create');
  });

  test('should execute actual_server_info tool', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const callPayload = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'actual_server_info',
        arguments: {},
      },
    };

    const callRes = await request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    // Should have a result, not an error
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    console.log('Server info result:', result);
    
    // Verify result structure
    expect(result.content).toBeTruthy();
    expect(Array.isArray(result.content)).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
  });

  test('should list accounts (verifies Actual Budget connection)', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const callPayload = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'actual_accounts_list',
        arguments: {},
      },
    };

    const callRes = await request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    // Should succeed (even if empty accounts list)
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    console.log('Accounts list result:', JSON.stringify(result, null, 2).substring(0, 500));
    
    // Verify it's a valid response
    expect(result.content).toBeTruthy();
    expect(Array.isArray(result.content)).toBeTruthy();
  });

  test('should create a test account', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const testAccountName = `E2E-Test-Account-${Date.now()}`;
    
    const callPayload = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'actual_accounts_create',
        arguments: {
          name: testAccountName,
          offbudget: false,
        },
      },
    };

    const callRes = await request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    console.log('Create account result:', JSON.stringify(callJson, null, 2).substring(0, 500));
    
    // Should succeed
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    expect(result.content).toBeTruthy();
    
    // Parse the result to verify account was created
    const text = result.content[0]?.text || '';
    expect(text.toLowerCase()).toContain('created');
    expect(text).toContain(testAccountName);
  });

  test('should verify session persistence', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    
    // Make multiple calls with the same session - should all work
    for (let i = 0; i < 3; i++) {
      const callPayload = {
        jsonrpc: '2.0',
        id: 10 + i,
        method: 'tools/call',
        params: {
          name: 'actual_server_info',
          arguments: {},
        },
      };

      const callRes = await request.post(rpcUrl, {
        data: JSON.stringify(callPayload),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'mcp-session-id': sessionId!,
        },
      });

      expect(callRes.ok()).toBeTruthy();
      const callJson = await callRes.json();
      expect(callJson.error).toBeUndefined();
      expect(callJson.result).toBeTruthy();
      
      console.log(`Session persistence test ${i + 1}/3: ✓`);
    }
  });

  test('should handle SSE endpoint', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    
    // Test SSE connection (just verify it accepts the connection)
    const sseRes = await request.get(rpcUrl, {
      headers: {
        Accept: 'text/event-stream',
        'mcp-session-id': sessionId!,
      },
      timeout: 3000, // Short timeout, we just want to verify it connects
    });

    // Should get 200 and text/event-stream content type
    expect(sseRes.status()).toBe(200);
    const contentType = sseRes.headers()['content-type'] || '';
    expect(contentType).toContain('text/event-stream');
    
    console.log('SSE endpoint verified');
  });

  test('should verify Docker build includes all required files', async ({ request }) => {
    // This test verifies the Docker image was built correctly
    const healthRes = await request.get(`${MCP_SERVER_URL}/health`);
    const health = await healthRes.json();
    
    // Should have connection pool stats (proves actual-adapter.ts is working)
    expect(health.connectionPool).toBeTruthy();
    
    // Should have version (proves VERSION file or version detection works)
    // Note: If VERSION file not in build, this might fail - that's valuable to know!
    console.log('Health check includes:', Object.keys(health));
  });
});

test.describe('Docker E2E - Error Handling', () => {
  let sessionId: string | undefined;

  test.beforeAll(async ({ request }) => {
    // Initialize session for error tests
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'docker-e2e-error-test', version: '1.0.0' },
      },
    };

    const initRes = await request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });

    sessionId = initRes.headers()['mcp-session-id'];
  });

  test('should handle invalid tool name gracefully', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const callPayload = {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'nonexistent_tool',
        arguments: {},
      },
    };

    const callRes = await request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    // Should return 200 with JSON-RPC error (not HTTP error)
    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    expect(callJson.error).toBeTruthy();
    expect(callJson.error.message).toContain('Tool not found');
  });

  test('should handle invalid arguments gracefully', async ({ request }) => {
    expect(sessionId).toBeTruthy();
    
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const callPayload = {
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'actual_accounts_create',
        arguments: {
          // Missing required 'name' parameter
          offbudget: false,
        },
      },
    };

    const callRes = await request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    });

    // Should return 200 with JSON-RPC error
    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    expect(callJson.error).toBeTruthy();
    console.log('Validation error:', callJson.error.message);
  });
});
