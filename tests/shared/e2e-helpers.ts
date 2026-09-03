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
 * A client-side pacer that keeps this suite under Actual's request ceiling BY CONSTRUCTION.
 *
 * THE NUMBERS, measured rather than guessed. Actual applies
 * `rateLimit({ windowMs: 60_000, max: 500 })` to every request (in its bundled `app.js`,
 * guarded by `NODE_ENV !== "development"`). We cannot simply switch the fixture to
 * development: that makes the server proxy to a React dev server it does not ship, and it
 * exits at boot with ERR_MODULE_NOT_FOUND on `http-proxy-middleware`.
 *
 * A full run of `docker-all-tools.e2e.spec.ts` puts 569 requests on that server, counted
 * from the Actual container's own log. Since #375 every test provisions and tears down its
 * own data, which is what pushed it there.
 *
 * So the suite is over the ceiling in TOTAL, and whether it trips depends only on how
 * tightly the requests bunch. Locally the run takes about 66 seconds and no single 60s
 * window quite reaches 500, so it passes. On a CI runner the same work finishes in 47
 * seconds, nearly every request lands inside one window, and everything from roughly the
 * 500th request onward fails with `PostError: Too many requests` for reasons unrelated to
 * what those tests assert. That is the inverted signal #375 exists to remove.
 *
 * WHY NOT RETRY. The first attempt at this backed off and retried the throttled call. That
 * is wrong for a CREATE, which is not idempotent: the write had already landed, so the retry
 * came back with `A 'E2E-Group-...' category group already exists.` Pacing has no such
 * hazard, because no request is ever sent twice.
 *
 * The budget is counted in TOOL CALLS, because that is what this layer can see. The AVERAGE
 * ratio is about 1.4 Actual requests per tool call, but it is not uniform: a write call is
 * op + sync (2 requests) and a read is 1, so a write-heavy BLOCK (the transactions and budgets
 * runs) peaks near 1.8. At 300 calls that block reached ~540 requests and tripped the limiter
 * (#383: 2 stdio failures at spec lines 686 to 697, over the SYNC path, after #422 removed the
 * relogin cascade that had masked the real ratio). 230 calls at 1.8 is ~415 requests, inside
 * 500 with margin, at the cost of a longer wall clock. The stdio leg is the tighter one: it
 * runs host-side over docker exec and never reached the old 300 budget, so lowering it is what
 * actually engages the pacer there.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CALLS_PER_WINDOW = 230;
const recentCallTimes: number[] = [];

/** Block until sending one more call keeps us inside the window budget. */
/**
 * Exported for #383: the stdio client paces through the SAME window as the HTTP one.
 *
 * Both transports drive the one Actual server, so its 500-requests-per-minute limiter counts
 * their calls together and they must not each believe they own the whole budget.
 *
 * READ THIS BEFORE RELYING ON IT: module scope shares this window only WITHIN A PROCESS, and the
 * two E2E legs are SEPARATE processes (HTTP inside the runner container, stdio on the host). So
 * the stdio leg starts with its counter at zero while Actual's window is still full from the HTTP
 * leg. An earlier version of this comment claimed the two legs shared a window; they do not, and
 * CI proved it: the stdio leg's first login was refused with "Too many requests", Playwright
 * restarted its worker after the failure, and the restart re-spawned the server and re-logged in,
 * 39 times. The cool-down in tests/e2e/run-docker-e2e.sh is what actually bridges the two
 * processes. This pacer covers calls within one leg.
 */
export async function pace(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recentCallTimes.length > 0 && now - recentCallTimes[0] >= RATE_WINDOW_MS) {
      recentCallTimes.shift();
    }
    if (recentCallTimes.length < RATE_MAX_CALLS_PER_WINDOW) {
      recentCallTimes.push(now);
      return;
    }
    // Wait exactly until the oldest call leaves the window, plus a small margin.
    const waitMs = RATE_WINDOW_MS - (now - recentCallTimes[0]) + 50;
    console.warn(
      `[pace] holding ${waitMs}ms: ${recentCallTimes.length} calls in the last 60s, budget ` +
        `is ${RATE_MAX_CALLS_PER_WINDOW} (Actual rate-limits at 500 requests/min)`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** True when a tool error is Actual's rate limiter rather than a real failure. */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /too many requests|rate ?limit/i.test(msg);
}

/**
 * `callTool`, paced so the suite cannot trip Actual's limiter.
 *
 * Deliberately does NOT retry. If a rate limit is seen despite the pacing then the budget
 * above is wrong, and the run should say so loudly rather than paper over it with a retry
 * that can duplicate a create.
 */
export async function callToolPaced(
  request: any,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  await pace();
  try {
    return await callTool(request, sessionId, toolName, args);
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new Error(
        `${(error as Error).message}\n\nThe E2E pacer did not keep this suite under Actual's ` +
          `500 requests/minute limit. Lower RATE_MAX_CALLS_PER_WINDOW in ` +
          `tests/shared/e2e-helpers.ts, or reduce how many entities the suite creates. Do NOT ` +
          `fix this by retrying: a retried create is not idempotent.`,
      );
    }
    throw error;
  }
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
