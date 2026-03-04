/**
 * tests/shared/mcp-protocol.js
 *
 * Shared MCP response-parsing utilities used by both test suites:
 *   - tests/manual/   (Node.js, live stack, deploy-and-test.sh)
 *   - tests/e2e/      (Playwright, Docker, CI gate)
 *
 * Keeping parsing logic in one place ensures that both suites interpret
 * MCP responses identically. When the tool response shape changes, fix it here.
 *
 * DO NOT add transport, retry, or HTTP logic here — those differ per suite.
 *
 * Canonical TypeScript source: tests/shared/e2e-helpers.ts (exportResult).
 * This JS edition mirrors that logic for plain-JS callers in tests/manual/.
 * If the MCP response envelope changes, update both files.
 */

/**
 * Unwrap the raw MCP tool response envelope into the first meaningful value.
 *
 * MCP tools return:
 *   { content: [{ type: 'text', text: '{"result": [...], "id": "uuid", ...}' }] }
 *
 * This function:
 *   1. Extracts content[0].text
 *   2. JSON.parses it
 *   3. Returns the most specific identifier field found, or the full object
 *
 * Priority order: id → result → accountId → categoryId → payeeId → ruleId → full object
 *
 * Used by: tests/manual/ (tests/e2e/ uses the TypeScript version in e2e-helpers.ts)
 *
 * @param {any} mcpResponse - raw value returned by the Playwright callTool helper
 * @returns {any}
 */
export function extractResult(mcpResponse) {
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

/**
 * Unwrap the raw MCP tool response into the tool's logical result value.
 *
 * Similar to extractResult but prefers `result` over `id` — used by the
 * manual client's callTool which returns the already-unwrapped payload.
 *
 * Priority order: result → full object
 *
 * Used by: tests/manual/mcp-client.js (inside callTool, after parse)
 *
 * @param {any} parsed - already JSON.parsed content[0].text object
 * @returns {any}
 */
export function unwrapToolResult(parsed) {
  return parsed.result !== undefined ? parsed.result : parsed;
}
