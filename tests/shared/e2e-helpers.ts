/**
 * tests/shared/e2e-helpers.ts
 *
 * Shared HTTP / MCP test utilities for all Playwright E2E spec files.
 * Import from spec and suite files using the '.js' extension (ESM module resolution):
 *
 *   import { callTool, extractResult } from '../../shared/e2e-helpers.js';
 *
 * DO NOT add Playwright fixtures, test.describe, or test() calls here.
 * Transport, health, and envelope helpers only — no test assertions at module scope.
 *
 * Canonical TypeScript source for extractResult().
 * The JS edition in tests/shared/mcp-protocol.js mirrors this logic.
 * If the MCP response envelope changes, update both files.
 */

import { expect } from '@playwright/test';

export const HEALTH_CHECK_RETRIES = 10;
export const HEALTH_CHECK_DELAY_MS = 2000;
export const DEFAULT_MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://mcp-server-test:3600';
export const HTTP_PATH = '/http';

/**
 * Poll the MCP server's /health endpoint until status === 'ok' or retries exhausted.
 */
export async function waitForMCPHealth(
  request: any,
  url: string,
  maxRetries = HEALTH_CHECK_RETRIES,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const healthRes = await request.get(url);
      if (healthRes.ok()) {
        const healthData = await healthRes.json();
        if (healthData.status === 'ok') return true;
      }
    } catch {
      // retry silently
    }
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, HEALTH_CHECK_DELAY_MS));
    }
  }
  return false;
}

/**
 * Retry an async request function with exponential backoff.
 */
export async function retryRequest<T>(
  requestFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      console.warn(
        `Request attempt ${i + 1}/${maxRetries} failed:`,
        error instanceof Error ? error.message : String(error),
      );
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Send a tools/call JSON-RPC request to the MCP server.
 *
 * Asserts HTTP 200 and throws on JSON-RPC error — callers use try/catch for negative tests.
 *
 * @param request   Playwright APIRequestContext (from test fixture)
 * @param sessionId MCP session id from the initialize handshake
 * @param toolName  Tool name, e.g. 'actual_accounts_list'
 * @param args      Tool arguments (JSON-serializable object)
 * @param mcpUrl    Override MCP server URL; defaults to MCP_SERVER_URL env or DEFAULT_MCP_SERVER_URL
 */
export async function callTool(
  request: any,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  mcpUrl = DEFAULT_MCP_SERVER_URL,
): Promise<any> {
  const rpcUrl = `${mcpUrl}${HTTP_PATH}`;
  const payload = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 10000),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  // Typed explicitly: `request` is `any` (Playwright's APIRequestContext is not imported
  // here to keep this file usable from both spec and plain-node callers), so without this
  // the generic resolves to `unknown` and every use of `res` below is a type error. #375
  // added `npm run typecheck:e2e`, which is what surfaced it.
  const res = await retryRequest<{ ok(): boolean; json(): Promise<any> }>(() =>
    request.post(rpcUrl, {
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'mcp-session-id': sessionId,
      },
    }),
  );

  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  if (json.error) {
    throw new Error(`Tool ${toolName} failed: ${json.error.message}`);
  }
  return json.result;
}

/**
 * Is this a transient upstream RATE LIMIT rather than a real tool failure?
 *
 * Actual's server answers a burst of writes with `PostError: Too many requests, please try
 * again later.`, which reaches us as an ordinary JSON-RPC error, so `callTool` cannot tell
 * it apart from a genuine refusal without this check. It matters since #375: every test
 * provisions and tears down its own data, so the suite issues several times the writes it
 * used to, and a busy CI runner can bunch them tightly enough to trip the limiter. When
 * that happened, every test after it failed for a reason that had nothing to do with what
 * it was testing.
 */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /too many requests|rate ?limit/i.test(msg);
}

/**
 * `callTool` with backoff on an upstream rate limit, and ONLY on that.
 *
 * Deliberately narrow: a rate limit is transient and retrying is the correct response, while
 * every other tool error is a result the test wants to see immediately. Retrying more
 * broadly would turn a real refusal into a slow timeout and hide the failure the test exists
 * to catch.
 */
export async function callToolWithBackoff(
  request: any,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  maxRetries = 6,
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callTool(request, sessionId, toolName, args);
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error)) throw error;
      // 500ms, 1s, 2s, 4s, 8s, capped at 15s: about 30 seconds of patience in total.
      // Actual's limiter uses a rolling window measured in a minute, so the schedule has to
      // reach into the seconds to clear it; retrying immediately just extends the window.
      // The cap keeps a genuinely wedged server from stalling the suite for minutes.
      const delay = Math.min(500 * 2 ** attempt, 15_000);
      console.warn(
        `[rate limit] ${toolName} throttled by the Actual server, waiting ${delay}ms ` +
          `(attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Unwrap the raw MCP tool response envelope into the first meaningful value.
 *
 * MCP tools return:
 *   { content: [{ type: 'text', text: '{"id":"uuid", ...}' }] }
 *
 * Priority order: id → result → accountId → categoryId → payeeId → ruleId → full object
 *
 * This is the canonical TypeScript source. The JS edition in
 * tests/shared/mcp-protocol.js mirrors this logic — update both if the MCP
 * envelope changes.
 */
export function extractResult(mcpResponse: any): any {
  if (mcpResponse?.content?.[0]?.text) {
    try {
      const parsed = JSON.parse(mcpResponse.content[0].text);
      if (parsed.id !== undefined) return parsed.id;
      if (parsed.result !== undefined) return parsed.result;
      if (parsed.accountId !== undefined) return parsed.accountId;
      if (parsed.categoryId !== undefined) return parsed.categoryId;
      if (parsed.payeeId !== undefined) return parsed.payeeId;
      if (parsed.ruleId !== undefined) return parsed.ruleId;
      return parsed;
    } catch {
      return mcpResponse.content[0].text;
    }
  }
  return mcpResponse;
}
