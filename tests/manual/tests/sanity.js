/**
 * tests/sanity.js
 *
 * SANITY TESTS — protocol-level, read-only. Zero writes to Actual Budget.
 * Fastest level; use it to verify any fresh deployment.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 *
 * Environment:
 *   EXPECTED_TOOL_COUNT  Expected number of registered MCP tools (default: 51)
 */

const EXPECTED_TOOL_COUNT = parseInt(process.env.EXPECTED_TOOL_COUNT || '51', 10);

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

  // 2. Server info
  console.log("\nChecking server info...");
  await callTool("actual_server_info", {});
  console.log("✓ Server info returned successfully");

  // 3. Accounts list (assert array)
  console.log("\nListing accounts...");
  const accounts = await callTool("actual_accounts_list", {});
  if (!Array.isArray(accounts)) throw new Error("actual_accounts_list did not return an array");
  console.log(`✓ Accounts listed: ${accounts.length}`);

  // 4. Transactions filter (read-only)
  console.log("\nFiltering transactions...");
  await callTool("actual_transactions_filter", { account: null });
  console.log("✓ Transactions filter returned successfully");

  // 5. Valid SQL query
  console.log("\nRunning SQL query...");
  await callTool("actual_query_run", { query: "SELECT id FROM accounts LIMIT 1" });
  console.log("✓ SQL query executed successfully");

  // 6. GraphQL must be rejected
  console.log("\nChecking GraphQL rejection...");
  try {
    await callTool("actual_query_run", { query: "{transactions{id}}" });
    throw new Error("GraphQL syntax was accepted - should have been rejected");
  } catch (err) {
    if (err.message.includes("GraphQL syntax was accepted")) throw err;
    console.log("✓ GraphQL syntax correctly rejected");
  }

  // 7. Invalid SQL field must be rejected
  console.log("\nChecking invalid field rejection...");
  try {
    await callTool("actual_query_run", { query: "SELECT payee_name FROM transactions LIMIT 1" });
    throw new Error("Invalid field 'payee_name' was accepted - should have been rejected");
  } catch (err) {
    if (err.message.includes("payee_name' was accepted")) throw err;
    if (!err.message.includes("payee_name")) throw new Error(`Wrong error for invalid field: ${err.message}`);
    console.log("✓ Invalid SQL field correctly rejected");
  }

  console.log("\n✓ All sanity checks passed");
}
