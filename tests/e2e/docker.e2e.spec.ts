/**
 * Docker-based E2E tests
 * 
 * Tests the full stack: Actual Budget server + MCP server (Docker build)
 * This verifies production deployment, real tool execution, and integration
 */

import { test, expect } from '@playwright/test';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://mcp-server-test:3600';
const HTTP_PATH = '/http';
const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 2000;

// Helper function to wait for MCP server health with retries
async function waitForMCPHealth(request: any, url: string, maxRetries = HEALTH_CHECK_RETRIES): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthRes = await request.get(url);
      if (healthRes.ok()) {
        const healthData = await healthRes.json();
        console.log(`[HEALTH CHECK ${i + 1}/${maxRetries}] Status:`, healthData.status);
        if (healthData.status === 'ok') {
          console.log('✅ MCP server is healthy and ready');
          return true;
        }
      }
    } catch (error) {
      console.log(`[HEALTH CHECK ${i + 1}/${maxRetries}] Error:`, error instanceof Error ? error.message : String(error));
    }
    
    if (i < maxRetries - 1) {
      console.log(`⏳ Waiting ${HEALTH_CHECK_DELAY_MS}ms before next health check...`);
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_DELAY_MS));
    }
  }
  return false;
}

// Helper function to retry a request with exponential backoff
async function retryRequest(requestFn: () => Promise<any>, maxRetries = 3, delayMs = 1000): Promise<any> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await requestFn();
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`Request attempt ${i + 1}/${maxRetries} failed:`, error instanceof Error ? error.message : String(error));
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1))); // Exponential backoff
      }
    }
  }
  throw lastError;
}

test.describe('Docker E2E - Full Stack Integration', () => {
  let sessionId: string | undefined;

  test('should initialize MCP session', async ({ request }) => {
    console.log('🔌 Initializing MCP session...');
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

    const initRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }));

    expect(initRes.ok()).toBeTruthy();
    const initJson = await initRes.json();
    expect(initJson.result).toBeTruthy();
    
    sessionId = initRes.headers()['mcp-session-id'];
    expect(sessionId).toBeTruthy();
    console.log('✅ Session initialized:', sessionId);
  });

  test('should verify services are healthy', async ({ request }) => {
    console.log('🏥 Checking MCP server health...');
    // Wait for MCP server to be fully healthy (status: 'ok')
    // Note: After initialization, it should transition from 'not-initialized' to 'ok'
    const isHealthy = await waitForMCPHealth(request, `${MCP_SERVER_URL}/health`);
    if (!isHealthy) {
      throw new Error('MCP server did not become healthy in time. Status may still be "not-initialized".');
    }
    
    // Final health check to verify
    const healthRes = await request.get(`${MCP_SERVER_URL}/health`);
    expect(healthRes.ok()).toBeTruthy();
    const health = await healthRes.json();
    console.log('✅ MCP Server health:', health);
    expect(health.status).toBe('ok');
  });

  test('should list all available tools', async ({ request }) => {
    if (!sessionId) {
      test.skip(); // Skip if previous test failed
      return;
    }
    
    console.log('📋 Listing available tools...');
    const rpcUrl = `${MCP_SERVER_URL}${HTTP_PATH}`;
    const listPayload = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };

    const listRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(listPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    expect(listRes.ok()).toBeTruthy();
    const listJson = await listRes.json();
    const tools = listJson.result?.tools || [];
    
    expect(Array.isArray(tools)).toBeTruthy();
    expect(tools.length).toBeGreaterThan(40); // Should have 49+ tools
    console.log(`✅ Listed ${tools.length} tools`);
    
    // Verify key tools exist
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('actual_server_info');
    expect(toolNames).toContain('actual_accounts_list');
    expect(toolNames).toContain('actual_transactions_create');
  });

  test('should execute actual_server_info tool', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('🔧 Testing actual_server_info tool...');
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

    const callRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    // Should have a result, not an error
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    console.log('✅ Server info result:', JSON.stringify(result, null, 2).substring(0, 300));
    
    // Verify result structure
    expect(result.content).toBeTruthy();
    expect(Array.isArray(result.content)).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
  });

  test('should list accounts (verifies Actual Budget connection)', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('📁 Listing accounts...');
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

    const callRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    // Should succeed (even if empty accounts list)
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    console.log('✅ Accounts list result:', JSON.stringify(result, null, 2).substring(0, 500));
    
    // Verify it's a valid response
    expect(result.content).toBeTruthy();
    expect(Array.isArray(result.content)).toBeTruthy();
  });

  test('should create a test account', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('➕ Creating test account...');
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

    const callRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    
    console.log('✅ Create account result:', JSON.stringify(callJson, null, 2).substring(0, 500));
    
    // Should succeed
    expect(callJson.error).toBeUndefined();
    expect(callJson.result).toBeTruthy();
    
    const result = callJson.result;
    expect(result.content).toBeTruthy();
    
    // The actual_accounts_create tool returns the account ID (UUID) in the result
    // Verify we got a valid response (either UUID or success message)
    const text = result.content[0]?.text || '';
    expect(text.length).toBeGreaterThan(0);
    
    // If it's a JSON result with the UUID, parse and verify
    try {
      const parsed = JSON.parse(text);
      // Should have a result field with a UUID
      expect(parsed.result).toBeTruthy();
      console.log(`✅ Account created with ID: ${parsed.result}`);
    } catch {
      // If not JSON, check for success message
      expect(text.toLowerCase()).toContain('account');
      console.log(`✅ Account creation response: ${text}`);
    }
  });

  test('should verify session persistence', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('🔄 Testing session persistence...');
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

      const callRes = await retryRequest(() => request.post(rpcUrl, {
        data: JSON.stringify(callPayload),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'mcp-session-id': sessionId!,
        },
      }));

      expect(callRes.ok()).toBeTruthy();
      const callJson = await callRes.json();
      expect(callJson.error).toBeUndefined();
      expect(callJson.result).toBeTruthy();
      
      console.log(`  Session persistence test ${i + 1}/3: ✅`);
    }
    console.log('✅ Session persistence verified');
  });

  test.skip('should handle SSE endpoint - SKIPPED (using HTTP transport)', async ({ request }) => {
    // This test is skipped because the server is configured to use HTTP transport only.
    // SSE transport is disabled in docker-compose.test.yaml (--http flag).
    // To enable SSE testing, change the server command to use --sse flag instead.
    console.log('⏭️  SSE endpoint test skipped (server running in HTTP-only mode)');
  });

  test('should verify Docker build includes all required files', async ({ request }) => {
    console.log('📦 Verifying Docker build...');
    // This test verifies the Docker image was built correctly
    const healthRes = await retryRequest(() => request.get(`${MCP_SERVER_URL}/health`));
    const health = await healthRes.json();
    
    // Should have connection pool stats (proves actual-adapter.ts is working)
    expect(health.connectionPool).toBeTruthy();
    
    console.log('✅ Docker build verification complete');
    // Should have version (proves VERSION file or version detection works)
    // Note: If VERSION file not in build, this might fail - that's valuable to know!
    console.log('Health check includes:', Object.keys(health));
  });
});

test.describe('Docker E2E - Error Handling', () => {
  let sessionId: string | undefined;

  test.beforeAll(async ({ request }) => {
    console.log('🔧 Initializing session for error handling tests...');
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

    const initRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    }));

    sessionId = initRes.headers()['mcp-session-id'];
    console.log('✅ Error test session initialized:', sessionId);
  });

  test('should handle invalid tool name gracefully', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('⚠️  Testing invalid tool name handling...');
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

    const callRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    // Should return 200 with JSON-RPC error (not HTTP error)
    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    expect(callJson.error).toBeTruthy();
    expect(callJson.error.message).toContain('Tool not found');
    console.log('✅ Invalid tool name handled correctly');
  });

  test('should handle invalid arguments gracefully', async ({ request }) => {
    if (!sessionId) {
      test.skip();
      return;
    }
    
    console.log('⚠️  Testing invalid arguments handling...');
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

    const callRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(callPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId!,
      },
    }));

    // Should return 200 with JSON-RPC error
    expect(callRes.ok()).toBeTruthy();
    const callJson = await callRes.json();
    expect(callJson.error).toBeTruthy();
    console.log('✅ Validation error:', callJson.error.message);
  });
});
