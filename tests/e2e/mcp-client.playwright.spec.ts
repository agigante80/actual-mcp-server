import { test, expect } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const START_TIMEOUT = 60_000;  // Increased for Docker environment
const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 2000;

// Helper function to wait for MCP server health
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

// Helper function to retry a request
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

test.describe('MCP end-to-end (initialize, tools/list, tools/call, SSE)', () => {
  let serverProc: ChildProcessWithoutNullStreams | null = null;
  let advertisedUrl = 'http://localhost:3602';  // Docker MCP server port
  const httpPath = '/http';
  const useDockerServer = process.env.USE_DOCKER_MCP_SERVER !== 'false';  // Default to Docker server

  test.beforeAll(async ({ request }) => {
    if (useDockerServer) {
      // Use the MCP server running in Docker (localhost:3602)
      console.log('🐳 Using MCP server from Docker at', advertisedUrl);
      
      // Wait for MCP server to be healthy
      const isHealthy = await waitForMCPHealth(request, `${advertisedUrl}/health`);
      if (!isHealthy) {
        throw new Error('MCP server did not become healthy in time. Check Docker logs.');
      }
      
      return;  // Skip spawning a new server
    }

    // Original behavior: start the server as a child process
    console.log('🚀 Spawning local MCP server...');
    const node = process.execPath;
    const entry = path.join(ROOT, 'dist', 'src', 'index.js');
    const args = ['--debug', '--http'];  // No need for '--' when calling node directly
    
    // Provide minimal test env vars for E2E tests
    const testEnv = {
      ...process.env,
      ACTUAL_SERVER_URL: 'http://localhost:5007',
      ACTUAL_PASSWORD: 'test',
      ACTUAL_BUDGET_SYNC_ID: 'test-sync-id',
      ACTUAL_DATA_DIR: path.join(ROOT, 'test-actual-data'),
      LOG_LEVEL: 'info',
      MCP_BRIDGE_PORT: '3601',  // Use different port for E2E tests
      MCP_BRIDGE_PUBLIC_HOST: 'localhost',  // Force localhost instead of external IP
    };
    
    serverProc = spawn(node, [entry, ...args], { cwd: ROOT, env: testEnv });

    // capture stdout/stderr and wait for the advertised URL line
    let stdout = '';
    let stderr = '';
    let ready = false;
    const tStart = Date.now();

    function onStdout(chunk: Buffer) {
      const s = chunk.toString();
      stdout += s;
      console.log('[SERVER STDOUT]', s);  // Debug: show server output
      // look for MCP endpoint line
      const m = stdout.match(/MCP endpoint:\s*(https?:\/\/[^\s]+)/);
      if (m) {
        advertisedUrl = m[1].replace(/\/$/, '');
        ready = true;
      }
    }
    
    function onStderr(chunk: Buffer) {
      const s = chunk.toString();
      stderr += s;
      console.error('[SERVER STDERR]', s);  // Debug: show server errors
      // Also check stderr for endpoint (winston might log there)
      const m = s.match(/MCP endpoint:\s*(https?:\/\/[^\s]+)/);
      if (m) {
        advertisedUrl = m[1].replace(/\/$/, '');
        ready = true;
      }
    }

    serverProc.stdout.on('data', onStdout);
    serverProc.stderr.on('data', onStderr);

    // fail if server dies early
    serverProc.on('exit', (code, sig) => {
      if (!ready) {
        throw new Error(`Server exited early (code=${code} sig=${sig})\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
      }
    });

    // wait for ready or timeout
    while (!ready && Date.now() - tStart < START_TIMEOUT) {
      // small sleep
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      // dump captured output for debugging
      const dump = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}` || '(no output captured)';
      if (serverProc) serverProc.kill();
      throw new Error('Server did not advertise endpoint in time:\n' + dump);
    }
  });

  test.afterAll(async () => {
    if (serverProc) {
      serverProc.kill();
      serverProc = null;
    }
  });

  test('initialize -> tools/list -> tools/call -> SSE connect', async ({ request }) => {
    console.log('🧪 Starting E2E test...');
    
    // 1) probe well-known resource with retry
    const probeUrl = new URL('/.well-known/oauth-protected-resource', advertisedUrl).toString();
    const probeRes = await retryRequest(() => request.get(probeUrl));
    expect(probeRes.ok()).toBeTruthy();
    const probeJson = await probeRes.json();
    const probeResult = probeJson?.result ?? probeJson;
    expect(probeResult).toBeTruthy();
    expect(typeof probeResult.capabilities).toBe('object');
    expect(typeof probeResult.capabilities.tools === 'object' || Array.isArray(probeResult.tools)).toBeTruthy();
    console.log('✅ Well-known resource probe successful');

    // 2) initialize JSON-RPC with retry
    const rpcUrl = new URL(httpPath, advertisedUrl).toString();
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'playwright-mcp-client', version: '0.0.1' },
      },
    };

    const initRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    }));
    expect(initRes.ok()).toBeTruthy();
    const initJson = await initRes.json();
    expect(initJson?.result).toBeTruthy();

    // CRITICAL: capture session id header and store it for ALL subsequent requests
    let sessionId = initRes.headers()['mcp-session-id'];
    if (sessionId) {
      console.info('✅ Received session id header:', sessionId);
    } else {
      console.warn('⚠️  No session id header received from initialize');
    }

    // accept tools either as array or in capabilities.tools
    const initResult = initJson.result;
    let tools: string[] = [];
    if (Array.isArray(initResult.tools)) {
      tools = initResult.tools;
    } else if (initResult.capabilities && typeof initResult.capabilities.tools === 'object') {
      tools = Object.keys(initResult.capabilities.tools);
    }

    // fallback: if initialize didn't advertise tools, call tools/list RPC to discover them
    if (!tools || tools.length === 0) {
      console.warn('initialize did not include tools — falling back to tools/list RPC');
      const listPayloadFallback = { jsonrpc: '2.0', id: 9999, method: 'tools/list', params: {} };

      // try with session id first (most servers expect it), then without
      const tryHeaders = [
        { 'Content-Type': 'application/json', Accept: 'application/json', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
        { 'Content-Type': 'application/json', Accept: 'application/json' },
        { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      ];

      let fallbackRes = null;
      for (const h of tryHeaders) {
        fallbackRes = await request.post(rpcUrl, {
          data: JSON.stringify(listPayloadFallback),
          headers: h,
        });
        if (fallbackRes.ok()) break;
      }

      if (!fallbackRes || !fallbackRes.ok()) {
        const text = fallbackRes ? await fallbackRes.text() : '(no response)';
        throw new Error(`tools/list fallback failed: status=${fallbackRes?.status()} body=${text}`);
      }

      const fallbackJson = await fallbackRes.json();
      const listedFallback = fallbackJson?.result?.tools ?? [];
      tools = Array.isArray(listedFallback) ? listedFallback.map((t: any) => t.name ?? t) : [];
    }

    expect(Array.isArray(tools)).toBeTruthy();
    expect(tools.length).toBeGreaterThan(0);
    console.log(`✅ Discovered ${tools.length} tools from initialize`);

    // 3) call tools/list RPC to confirm (with retry and session)
    const listPayload = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const listRes = await retryRequest(() => request.post(rpcUrl, {
      data: JSON.stringify(listPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
    }));
    if (!listRes.ok()) {
      const text = await listRes.text();
      throw new Error(`tools/list failed: status=${listRes.status()} body=${text}`);
    }
    const listJson = await listRes.json();
    const listed = listJson?.result?.tools ?? [];
    expect(Array.isArray(listed)).toBeTruthy();
    console.log(`✅ tools/list confirmed: ${listed.length} tools available`);

    // 4) call each tool with retry (non-destructive; expect either result or error)
    console.log(`🔧 Testing ${listed.length} tools...`);
    let successCount = 0;
    let errorCount = 0;
    
    for (const t of listed) {
      const name = t.name;
      const callPayload = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1_000_000),
        method: 'tools/call',
        params: { name, arguments: {} },
      };
      
      try {
        const callRes = await retryRequest(() => request.post(rpcUrl, {
          data: JSON.stringify(callPayload),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
          },
        }), 2, 500);  // Reduced retries for tool calls to avoid long test times
        
        // call may return error object but HTTP should be ok (200)
        // If not ok, log the status and response for debugging
        if (!callRes.ok()) {
          const text = await callRes.text();
          console.warn(`⚠️  Tool ${name} returned HTTP ${callRes.status()}: ${text.substring(0, 200)}`);
          errorCount++;
          continue;
        }
        
        const callJson = await callRes.json();
        // either a result or an error object is acceptable; assert shape
        expect(callJson).toBeTruthy();
        if (callJson.error) {
          console.warn(`⚠️  Tool ${name} returned error:`, callJson.error.message || callJson.error);
          errorCount++;
        } else {
          expect(callJson.result || callJson).toBeTruthy();
          successCount++;
        }
      } catch (error) {
        console.warn(`⚠️  Tool ${name} failed with exception:`, error instanceof Error ? error.message : String(error));
        errorCount++;
      }
    }
    
    console.log(`📊 Tool test results: ${successCount} succeeded, ${errorCount} failed/errored`);
    // At least some tools should work (even if Actual server has issues, basic tools should respond)
    expect(successCount).toBeGreaterThan(0);

    // 5) SSE connect: verify SSE handshake headers and content-type (with retry)
    if (sessionId) {
      console.log('🔌 Testing SSE connection...');
      const sseRes = await retryRequest(() => request.get(rpcUrl, {
        headers: {
          Accept: 'text/event-stream',
          'mcp-session-id': sessionId,
        },
        // short timeout so test doesn't hang on a long-lived stream
        timeout: 5000,
      }));
      // server should reply with status 200 and content-type text/event-stream (or similar)
      expect(sseRes.status()).toBe(200);
      const ct = sseRes.headers()['content-type'] || '';
      expect(ct.includes('text/event-stream')).toBeTruthy();
      console.log('✅ SSE connection test passed');
    } else {
      // runtime skip: no session id available, skip SSE connect check
      console.log('⏭️  Skipping SSE connect check: no session id from initialize');
    }
    
    console.log('✅ All E2E tests completed successfully!');
  });
});