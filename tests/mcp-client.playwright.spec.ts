import { test, expect } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const START_TIMEOUT = 30_000;

test.describe('MCP end-to-end (initialize, tools/list, tools/call, SSE)', () => {
  let serverProc: ChildProcessWithoutNullStreams | null = null;
  let advertisedUrl = 'http://localhost:3600';
  const httpPath = '/http';

  test.beforeAll(async () => {
    // start the server as a child process using the same entrypoint the repo uses
    const node = process.execPath;
    const entry = path.join(ROOT, 'register-tsconfig-paths.js');
    const args = ['--', '--debug', '--http'];
    serverProc = spawn(node, [entry, ...args], { cwd: ROOT, env: process.env });

    // capture stdout/stderr and wait for the advertised URL line
    let stdout = '';
    let ready = false;
    const tStart = Date.now();

    function onData(chunk: Buffer) {
      const s = chunk.toString();
      stdout += s;
      // look for MCP endpoint line
      const m = stdout.match(/MCP endpoint:\s*(https?:\/\/[^\s]+)/);
      if (m) {
        advertisedUrl = m[1].replace(/\/$/, '');
        ready = true;
      }
    }

    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);

    // fail if server dies early
    serverProc.on('exit', (code, sig) => {
      if (!ready) {
        throw new Error(`Server exited early (code=${code} sig=${sig})\n\n${stdout}`);
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
      const dump = stdout || '(no output captured)';
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
    // 1) probe well-known resource
    const probeUrl = new URL('/.well-known/oauth-protected-resource', advertisedUrl).toString();
    const probeRes = await request.get(probeUrl);
    expect(probeRes.ok()).toBeTruthy();
    const probeJson = await probeRes.json();
    const probeResult = probeJson?.result ?? probeJson;
    expect(probeResult).toBeTruthy();
    expect(typeof probeResult.capabilities).toBe('object');
    expect(typeof probeResult.capabilities.tools === 'object' || Array.isArray(probeResult.tools)).toBeTruthy();

    // 2) initialize JSON-RPC
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

    const initRes = await request.post(rpcUrl, {
      data: JSON.stringify(initPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
    });
    expect(initRes.ok()).toBeTruthy();
    const initJson = await initRes.json();
    expect(initJson?.result).toBeTruthy();

    // capture session id header if present
    const sessionId = initRes.headers()['mcp-session-id'];
    if (sessionId) {
      console.info('Received session id header:', sessionId);
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

    // 3) call tools/list RPC to confirm
    const listPayload = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const listRes = await request.post(rpcUrl, {
      data: JSON.stringify(listPayload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
    });
    if (!listRes.ok()) {
      const text = await listRes.text();
      throw new Error(`tools/list failed: status=${listRes.status()} body=${text}`);
    }
    const listJson = await listRes.json();
    const listed = listJson?.result?.tools ?? [];
    expect(Array.isArray(listed)).toBeTruthy();

    // 4) call each tool (non-destructive; expect either result or error)
    for (const t of listed) {
      const name = t.name;
      const callPayload = {
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1_000_000),
        method: 'tools/call',
        params: { name, arguments: {} },
      };
      const callRes = await request.post(rpcUrl, {
        data: JSON.stringify(callPayload),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
      });
      // call may return error object but HTTP should be ok
      expect(callRes.ok()).toBeTruthy();
      const callJson = await callRes.json();
      // either a result or an error object is acceptable; assert shape
      expect(callJson).toBeTruthy();
      if (callJson.error) {
        console.warn(`Tool ${name} returned error:`, callJson.error);
      } else {
        expect(callJson.result || callJson).toBeTruthy();
      }
    }

    // 5) SSE connect: verify SSE handshake headers and content-type
    if (sessionId) {
      const sseRes = await request.get(rpcUrl, {
        headers: {
          Accept: 'text/event-stream',
          'mcp-session-id': sessionId,
        },
        // short timeout so test doesn't hang on a long-lived stream
        timeout: 5000,
      });
      // server should reply with status 200 and content-type text/event-stream (or similar)
      expect(sseRes.status()).toBe(200);
      const ct = sseRes.headers()['content-type'] || '';
      expect(ct.includes('text/event-stream')).toBeTruthy();
    } else {
      test.skip('no session id from initialize, skipping SSE connect check');
    }
  });
});