/**
 * tests/sanity.js
 *
 * SANITY TESTS: protocol-level, read-only. Zero writes to Actual Budget.
 * Fastest level; use it to verify any fresh deployment.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 *
 * Environment:
 *   EXPECTED_TOOL_COUNT  Expected number of registered MCP tools (default: 71)
 */

const EXPECTED_TOOL_COUNT = parseInt(process.env.EXPECTED_TOOL_COUNT || '71', 10);

/**
 * @param {{ listTools: Function, callTool: Function }} client
 */
export async function sanityTests(client) {
  const { listTools, callTool } = client;
  console.log("\n-- Running SANITY TESTS (read-only protocol checks) --");

  // 1. Tool count
  const tools = await listTools();
  if (tools.length !== EXPECTED_TOOL_COUNT) {
    throw new Error(`Expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}`);
  }
  console.log(`✓ Tool count: ${tools.length} (expected ${EXPECTED_TOOL_COUNT})`);

  // 2. Server info (MCP server)
  console.log("\nChecking MCP server info...");
  await callTool("actual_server_info", {});
  console.log("✓ Server info returned successfully");

  // 3. Actual Budget server version
  console.log("\nChecking Actual Budget server version...");
  const versionResult = await callTool("actual_server_get_version", {});
  if (typeof versionResult?.version === 'string') {
    console.log(`✓ Actual Budget server version: ${versionResult.version}`);
  } else if (typeof versionResult?.error === 'string') {
    // Non-fatal: version endpoint may not exist in older self-hosted builds
    console.log(`⚠ actual_server_get_version: server reported error: ${versionResult.error}`);
  } else {
    throw new Error(`actual_server_get_version: unexpected response: ${JSON.stringify(versionResult).slice(0, 120)}`);
  }

  // 4. Accounts list (assert array)
  console.log("\nListing accounts...");
  const accounts = await callTool("actual_accounts_list", {});
  if (!Array.isArray(accounts)) throw new Error("actual_accounts_list did not return an array");
  console.log(`✓ Accounts listed: ${accounts.length}`);

  // 5. Transactions filter (read-only)
  console.log("\nFiltering transactions...");
  await callTool("actual_transactions_filter", { account: null });
  console.log("✓ Transactions filter returned successfully");

  // 6. Valid SQL query
  console.log("\nRunning SQL query...");
  await callTool("actual_query_run", { query: "SELECT id FROM accounts LIMIT 1" });
  console.log("✓ SQL query executed successfully");

  // 7. GraphQL must be rejected
  console.log("\nChecking GraphQL rejection...");
  try {
    await callTool("actual_query_run", { query: "{transactions{id}}" });
    throw new Error("GraphQL syntax was accepted - should have been rejected");
  } catch (err) {
    if (err.message.includes("GraphQL syntax was accepted")) throw err;
    console.log("✓ GraphQL syntax correctly rejected");
  }

  // 8. Invalid SQL field must be rejected
  console.log("\nChecking invalid field rejection...");
  try {
    await callTool("actual_query_run", { query: "SELECT payee_name FROM transactions LIMIT 1" });
    throw new Error("Invalid field 'payee_name' was accepted - should have been rejected");
  } catch (err) {
    if (err.message.includes("payee_name' was accepted")) throw err;
    if (!err.message.includes("payee_name")) throw new Error(`Wrong error for invalid field: ${err.message}`);
    console.log("✓ Invalid SQL field correctly rejected");
  }

  // 9. Published tool schemas must be OpenAI/ECMA-262 regex-compatible (#293).
  //    This runs over whichever transport the suite is using, so the dual-transport
  //    gate (MCP_TEST_TRANSPORT=http and =stdio) exercises it on both. A tool
  //    schema whose `pattern` uses a \p{...} escape (needs the u flag, which a
  //    JSON Schema pattern cannot carry) is rejected by OpenAI's Responses
  //    function-schema validator and disables the entire tool set for that client.
  console.log("\nChecking published tool schemas are OpenAI-compatible...");
  const collectPatterns = (node, path, out) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => collectPatterns(child, `${path}[${i}]`, out));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pattern' && typeof value === 'string') out.push({ path: `${path}.pattern`, pattern: value });
      collectPatterns(value, `${path}.${key}`, out);
    }
  };
  let patternsChecked = 0;
  let sawBudgetsSwitch = false;
  for (const t of tools) {
    if (t.name === 'actual_budgets_switch') sawBudgetsSwitch = true;
    const found = [];
    collectPatterns(t.inputSchema, t.name, found);
    for (const { path, pattern } of found) {
      patternsChecked++;
      // Reject u-flag-only escapes (\p{...}/\P{...} or \u{...}): they need the u
      // flag a JSON Schema pattern cannot carry, and a non-u regex silently
      // misreads them rather than throwing, so the compile check below misses them.
      if (/\\[pP]\{|\\u\{/.test(pattern)) {
        throw new Error(`Published schema ${path} uses a u-flag-only escape OpenAI rejects: ${JSON.stringify(pattern)}`);
      }
      try {
        // Must compile as a plain (non-u) ECMA-262 regex, the way a client that
        // only receives the pattern string (no flags) reads it.
        new RegExp(pattern);
      } catch (err) {
        throw new Error(`Published schema ${path} is not a valid non-u regex: ${JSON.stringify(pattern)} (${err.message})`);
      }
    }
  }
  if (!sawBudgetsSwitch) {
    throw new Error("actual_budgets_switch not present in tools/list; #293 regression check could not run");
  }
  console.log(`✓ Published schemas OpenAI-compatible: ${patternsChecked} pattern(s) across ${tools.length} tools`);

  console.log("\n✓ All sanity checks passed");
}
