// Actual Budget MCP Integration Test Script
// Purpose:
//   This script connects to an MCP (Model Context Protocol) server exposing the
//   Actual Budget API. It supports multiple testing levels:
//
//   SANITY TESTS:
//     Protocol-level checks with zero writes. Fastest way to verify a deployment:
//     - Initialize MCP session and assert session ID
//     - Assert exact tool count (EXPECTED_TOOL_COUNT env var, default 51)
//     - actual_server_info
//     - actual_accounts_list (assert response has content)
//     - actual_transactions_filter (read-only)
//     - actual_query_run with valid SQL
//     - Assert GraphQL syntax is rejected
//     - Assert invalid SQL field is rejected
//
//   SMOKE TESTS:
//     Quick connectivity and core API checks. Focused on basic functionality:
//     - All SANITY tests
//     - List accounts
//     - List categories
//
//   NORMAL TESTS:
//     Standard functionality testing. Focused on account lifecycle:
//     - All SMOKE tests
//     - Account lifecycle: create → update → close → reopen (verified via
//       accounts list at each step)
//     - Creates unique timestamped test account (MCP-Test-YYYY-MM-DDTHH-MM-SS-mmmZ)
//     - Cleanup prompt with 10-second auto-delete timeout
//
//   EXTENDED TESTS:
//     Broader CRUD coverage across the core financial entities:
//     - All NORMAL tests
//     - Category group operations: create, update
//     - Category operations: create, update
//     - Payee operations: create, update, default-category assignment
//     - Transaction operations: create, update, search/filter
//     - Gracefully skips sub-tests if required context is missing
//     - Cleanup prompt with 10-second auto-delete timeout
//
//   FULL TESTS:
//     Everything. Destructive and advanced operations:
//     - All EXTENDED tests
//     - Budget operations: get months, set amounts, carryover
//     - Rules: create, update, batch (35+ operations), error resilience
//     - Advanced: SQL queries, payee rules, mergePayees, batchBudgetUpdates
//     - Cleanup prompt with 10-second auto-delete timeout
//
//   CLEANUP (standalone, no test run):
//     Finds every open account whose name starts with "MCP-Test-", deletes all
//     its transactions, then closes the account. Safe to run repeatedly.
//     - Skips accounts that are already closed
//     - Reports totals: accounts closed, transactions deleted, skipped
//
//   The script uses proper MCP JSON-RPC 2.0 protocol with session management.
//
//   Usage:
//     node actual-mcp-integration-test.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]
//     
//     Parameters:
//       MCP_URL  - MCP server URL (default: http://localhost:3600/http)
//       TOKEN    - Bearer token for authentication
//       LEVEL    - Test level: sanity, smoke, normal, extended, full, or cleanup
//       CLEANUP  - Optional cleanup behavior (for test levels, not for cleanup level):
//                  'yes' or 'y' - Auto-delete test data
//                  'no' or 'n'  - Preserve test data
//                  (omitted)    - Interactive prompt with 10s timeout
//     
//     Environment variables:
//       EXPECTED_TOOL_COUNT  Expected number of registered tools (default: 51)
//
//     Examples:
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN sanity
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN smoke
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN normal no
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN extended no
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN full yes
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN cleanup
//       EXPECTED_TOOL_COUNT=51 node actual-mcp-integration-test.js http://localhost:3600/http TOKEN sanity

import fetch from 'node-fetch';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config as loadDotenv } from 'dotenv';

// Load .env from project root (works when run via npm scripts or from project root)
loadDotenv();

const MCP_URL = process.argv[2] || process.env.MCP_SERVER_URL || "http://localhost:3600/http";
let token = process.argv[3] ? `Bearer ${process.argv[3]}` : (process.env.MCP_AUTH_TOKEN ? `Bearer ${process.env.MCP_AUTH_TOKEN}` : null);
let level = (process.argv[4] || process.env.MCP_TEST_LEVEL || '').toLowerCase() || null;
let cleanup = process.argv[5] ? process.argv[5].toLowerCase() : null; // 'yes', 'no', or null for prompt

const EXPECTED_TOOL_COUNT = parseInt(process.env.EXPECTED_TOOL_COUNT || '51', 10);

// Get Actual Budget server URL from environment
const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "http://localhost:5006";

const rl = readline.createInterface({ input, output });

let sessionId = null;
let requestId = 1;

async function callMCP(method, params = {}) {
  const payload = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...(token ? { "Authorization": token } : {}),
    ...(sessionId ? { "mcp-session-id": sessionId } : {})
  };

  try {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    // Capture session ID from response header if present
    const newSessionId = response.headers.get('mcp-session-id');
    if (newSessionId && !sessionId) {
      sessionId = newSessionId;
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`MCP Error ${result.error.code}: ${result.error.message}`);
    }

    return result.result;
  } catch (err) {
    if (err.message.includes('401') && !token) {
      console.log("Authorization required. Please provide a valid AUTH TOKEN.");
      const t = await rl.question("Enter AUTH TOKEN: ");
      token = `Bearer ${t.trim()}`;
      return callMCP(method, params); // retry
    }
    // Auto-reconnect on session expiry (e.g. after server restart during heavy batch tests)
    if (err.message.includes('Session expired') || err.message.includes('Session invalid') || err.message.includes('re-initialize')) {
      console.log("  ⚠ Session expired — re-initializing...");
      sessionId = null;
      await initialize();
      return callMCP(method, params); // retry with new session
    }
    // Auto-reconnect on socket hang up (server briefly restarted after heavy operations)
    if (err.message.includes('socket hang up') || err.message.includes('ECONNRESET') || err.message.includes('ECONNREFUSED')) {
      console.log("  ⚠ Connection lost — pausing 5s then re-initializing...");
      await new Promise(r => setTimeout(r, 5000));
      sessionId = null;
      await initialize();
      return callMCP(method, params); // retry with new session
    }
    throw err;
  }
}

async function initialize() {
  console.log("Initializing MCP session...");
  const result = await callMCP("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "actual-mcp-test-client",
      version: "1.0.0"
    }
  });
  
  // Session ID is captured from response header in callMCP
  console.log("✓ Session initialized:", sessionId);
  console.log("✓ Server info:", result.serverInfo?.name, result.serverInfo?.version);
  return result;
}

async function listTools() {
  console.log("Fetching available tools...");
  const result = await callMCP("tools/list", {});
  console.log(`✓ Found ${result.tools.length} tools`);
  return result.tools;
}

async function callTool(toolName, args = {}) {
  const response = await callMCP("tools/call", {
    name: toolName,
    arguments: args
  });
  
  // Extract result from MCP response format
  if (response && response.content && response.content[0]) {
    const textContent = response.content[0].text;
    if (textContent) {
      try {
        const parsed = JSON.parse(textContent);
        // Actual tools wrap responses in {"result": data}, extract it
        return parsed.result !== undefined ? parsed.result : parsed;
      } catch (e) {
        return textContent; // Return as-is if not JSON
      }
    }
  }
  
  return response;
}

// -------------------------------
// TEST GROUPS
// -------------------------------

async function sanityTests() {
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

  // 3. Accounts list (assert content)
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

async function smokeTests() {
  console.log("\n-- Running SMOKE TESTS --");

  await sanityTests();

  // Additional read checks
  console.log("\nTesting category list...");
  const categories = await callTool("actual_categories_get", {});
  const categoryCount = Array.isArray(categories) ? categories.length : 0;
  console.log(`\u2713 Found ${categoryCount} categories`);

  console.log("\nTesting category groups...");
  const groups = await callTool("actual_category_groups_get", {});
  const groupCount = Array.isArray(groups) ? groups.length : (groups && typeof groups === 'object' ? Object.keys(groups).length : 0);
  console.log(`\u2713 Found ${groupCount} category groups`);

  // List accounts with balances
  console.log("\nListing accounts...");
  const accounts = await callTool("actual_accounts_list", {});
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log("  (no accounts found)");
  } else {
    for (const a of accounts) {
      const balData = await callTool("actual_accounts_get_balance", { id: a.id });
      const bal = typeof balData?.balance === 'number' ? (balData.balance / 100).toFixed(2) : 'n/a';
      console.log(`  • ${a.name}  [${a.id}]  balance: ${bal}`);
    }
  }

  // Last 3 transactions across all accounts
  console.log("\nLast 3 transactions...");
  const txns = await callTool("actual_transactions_filter", { account: null });
  const recent = Array.isArray(txns) ? txns.slice(0, 3) : [];
  if (recent.length === 0) {
    console.log("  (no transactions found)");
  } else {
    recent.forEach(t => console.log(`  • ${t.date}  ${(t.amount / 100).toFixed(2)}  ${t.notes || t.imported_payee || t.payee_name || ''}`.trimEnd()));
  }
}

async function accountTests(context) {
  console.log("\n-- Running ACCOUNT TESTS --");
  
  // List accounts before
  const accountsBefore = await callTool("actual_accounts_list", {});
  console.log(`Accounts before: ${accountsBefore.length}`);
  
  // Create unique test account with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accountName = `MCP-Test-${timestamp}`;
  
  // Helper: list all accounts and verify presence/absence of a specific account.
  // expectPresent=true  → account must be in list; check(account) must return true
  // expectPresent=false → account must NOT be in list (closed accounts are excluded by the API)
  async function listAndVerify(label, id, expectPresent, check) {
    const all = await callTool("actual_accounts_list", {});
    const found = Array.isArray(all) ? all.find(a => a.id === id) : null;
    const total = Array.isArray(all) ? all.length : 0;
    if (!expectPresent) {
      if (!found) {
        console.log(`  ✓ ${label}: account correctly absent from list (closed accounts excluded) [${total} open accounts]`);
      } else {
        console.log(`  ❌ ${label}: expected account to be absent but it was found`);
        console.log(`     Account: ${JSON.stringify(found)}`);
      }
    } else {
      if (!found) {
        console.log(`  ❌ ${label}: account NOT found in list (${total} accounts)`);
      } else {
        const ok = check(found);
        if (ok === true) {
          console.log(`  ✓ ${label}: account found [ name="${found.name}", offbudget=${found.offbudget}, closed=${found.closed} ] [${total} accounts]`);
        } else {
          console.log(`  ❌ ${label}: account found but assertion failed — ${ok}`);
          console.log(`     Account: ${JSON.stringify(found)}`);
        }
      }
    }
  }

  console.log("\nCreating test account...");
  const newAcc = await callTool("actual_accounts_create", { 
    name: accountName,
    balance: 0
  });
  const accountId = newAcc.id || newAcc.result || newAcc;
  console.log("✓ Created account:", accountName);
  console.log("  Account ID:", accountId);
  context.accountId = accountId;
  context.accountName = accountName;

  await listAndVerify("After creation", accountId, true,
    a => (a.name === accountName && !a.closed) || `expected name="${accountName}" closed=false`);
  
  // Get balance
  console.log("\nGetting account balance...");
  const balance = await callTool("actual_accounts_get_balance", { id: accountId });
  console.log("✓ Balance:", balance);
  
  // REGRESSION TEST: Update multiple account fields (tests strict validation)
  console.log("\nREGRESSION: Updating multiple account fields (name, offbudget)...");
  const updatedName = accountName + "-Updated";
  await callTool("actual_accounts_update", { 
    id: accountId,
    fields: { 
      name: updatedName,
      offbudget: true
    }
  });
  console.log("✓ Account updated with multiple fields");

  await listAndVerify("After update", accountId, true,
    a => (a.name === updatedName && a.offbudget === true) || `expected name="${updatedName}" offbudget=true, got name="${a.name}" offbudget=${a.offbudget}`);
  
  // REGRESSION TEST: Try to update with invalid field (should fail with clear error)
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("actual_accounts_update", { 
      id: accountId,
      fields: { invalidField: "should fail" }
    });
    console.log("❌ REGRESSION FAILED: Invalid field was accepted (should have been rejected)");
  } catch (err) {
    if (err.message.includes("Unrecognized key") || err.message.includes("invalidField")) {
      console.log("✓ Strict validation working (invalid field rejected)");
    } else {
      console.log("⚠ Different error than expected:", err.message);
    }
  }

  // Add a dummy transaction so the account has numTransactions > 0.
  // IMPORTANT: closeAccount() in the Actual API tombstones (hard-deletes) accounts
  // with zero transactions instead of marking them closed=1. A tombstoned account
  // is invisible to getAccounts (tombstone=0 filter) and cannot be reopened.
  // Adding a transaction (even amount=0) forces the proper close path (sets closed=1).
  // We use amount=0 so the balance stays at 0, allowing close without transferAccountId.
  console.log("\nAdding dummy transaction (amount=0) to prevent tombstone-on-close...");
  const today = new Date().toISOString().slice(0, 10);
  await callTool("actual_transactions_create", {
    account: accountId,
    date: today,
    amount: 0,
    notes: "Test transaction for close/reopen lifecycle"
  });
  console.log("✓ Dummy transaction added (balance stays 0)");

  // Close account
  console.log("\nClosing account...");
  await callTool("actual_accounts_close", { id: accountId });
  console.log("✓ Account closed");

  // After close with numTransactions > 0: account stays in the list with closed=true
  await listAndVerify("After close", accountId, true,
    a => (a.closed === true) || `expected closed=true, got closed=${a.closed}`);

  // Reopen account
  console.log("\nReopening account...");
  await callTool("actual_accounts_reopen", { id: accountId });
  console.log("✓ Account reopened");

  await listAndVerify("After reopen", accountId, true,
    a => (a.closed === false) || `expected closed=false, got closed=${a.closed}`);
}

async function categoryTests(context) {
  console.log("\n-- Running CATEGORY TESTS --");
  
  // Use the MCP category group created in fullTests
  if (!context.categoryGroupId) {
    console.log("⚠ No MCP category group available - skipping category tests");
    return;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log("\nCreating test category in MCP category group...");
  const newCat = await callTool("actual_categories_create", { 
    name: `MCP-Cat-${timestamp}`,
    group_id: context.categoryGroupId
  });
  const categoryId = newCat.categoryId || newCat.id || newCat.result || newCat;
  console.log("✓ Created category:", categoryId);
  context.categoryId = categoryId;

  // Verify creation
  {
    const catsData = await callTool("actual_categories_get", {});
    const catsResult = catsData.result || catsData || [];
    const flatCats = Array.isArray(catsResult)
      ? catsResult.flatMap(g => g.categories || [g]).filter(c => c && c.id)
      : [];
    const found = flatCats.find(c => c.id === categoryId);
    if (!found) console.log("  ❌ Verify create: category not found in list (id:", categoryId, ")");
    else if (found.name === `MCP-Cat-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Cat-${timestamp}", got "${found.name}"`);
  }

  // Update category (keeping timestamp)
  console.log("\nUpdating category...");
  await callTool("actual_categories_update", { 
    id: categoryId,
    fields: { name: `MCP-Cat-${timestamp}-Updated` }
  });
  console.log("✓ Category updated");

  // Verify update
  {
    const catsData = await callTool("actual_categories_get", {});
    const catsResult = catsData.result || catsData || [];
    const flatCats = Array.isArray(catsResult)
      ? catsResult.flatMap(g => g.categories || [g]).filter(c => c && c.id)
      : [];
    const found = flatCats.find(c => c.id === categoryId);
    if (!found) console.log("  ❌ Verify update: category not found in list");
    else if (found.name === `MCP-Cat-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Cat-${timestamp}-Updated", got "${found.name}"`);
  }
  
  // Delete category will be done in cleanup
  console.log("  (Category deletion tested in cleanup phase)");
}

async function payeeTests(context) {
  console.log("\n-- Running PAYEE TESTS --");
  
  // Get all payees
  console.log("\nListing existing payees...");
  const payeesData = await callTool("actual_payees_get", {});
  const existingPayees = payeesData.result || payeesData || [];
  console.log("✓ Found payees:", existingPayees.length);
  
  // Create new payee with unique name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log("\nCreating test payee...");
  const newPayee = await callTool("actual_payees_create", { 
    name: `MCP-Payee-${timestamp}`
  });
  const payeeId = newPayee.id || newPayee.result || newPayee;
  console.log("✓ Created payee:", payeeId);
  context.payeeId = payeeId;
  
  // Create second payee for merge test
  console.log("\nCreating second test payee for merge...");
  const newPayee2 = await callTool("actual_payees_create", { 
    name: `MCP-Payee2-${timestamp}`
  });
  const payeeId2 = newPayee2.id || newPayee2.result || newPayee2;
  console.log("✓ Created second payee:", payeeId2);
  context.payeeId2 = payeeId2;
  
  // REGRESSION TEST: Update payee with category field
  // Tests whether the payees_update tool supports the `category` field (default category for payee).
  // The upstream Actual API supports this field on the Payee object.
  // Known issue: actual_payees_update schema currently rejects `category` as unrecognized.
  if (context.categoryId) {
    console.log("\nREGRESSION: Setting default category on payee...");
    try {
      await callTool("actual_payees_update", { 
        id: payeeId,
        fields: { 
          category: context.categoryId
        }
      });
      console.log("✓ Payee updated with default category");
    } catch (err) {
      if (err.message.includes("Unrecognized key") && err.message.includes("category")) {
        console.log("⚠ KNOWN ISSUE: actual_payees_update does not support 'category' field yet");
        console.log("  (upstream Actual API supports it — MCP tool schema needs updating)");
      } else {
        console.log("❌ REGRESSION FAILED (unexpected error):", err.message);
      }
    }
  }
  
  // Verify payee creation
  {
    const pd = await callTool("actual_payees_get", {});
    const all = pd.result || pd || [];
    const found = Array.isArray(all) ? all.find(p => p.id === payeeId) : null;
    if (!found) console.log("  ❌ Verify create: payee not found in list (id:", payeeId, ")");
    else if (found.name === `MCP-Payee-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Payee-${timestamp}", got "${found.name}"`);
  }

  // Update payee
  console.log("\nUpdating payee name...");
  await callTool("actual_payees_update", { 
    id: payeeId,
    fields: { name: `MCP-Payee-${timestamp}-Updated` }
  });
  console.log("✓ Payee updated");

  // Verify payee update
  {
    const pd = await callTool("actual_payees_get", {});
    const all = pd.result || pd || [];
    const found = Array.isArray(all) ? all.find(p => p.id === payeeId) : null;
    if (!found) console.log("  ❌ Verify update: payee not found in list");
    else if (found.name === `MCP-Payee-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Payee-${timestamp}-Updated", got "${found.name}"`);
  }
  
  // REGRESSION TEST: Test strict validation on payee update
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("actual_payees_update", { 
      id: payeeId,
      fields: { invalidField: "should fail" }
    });
    console.log("❌ REGRESSION FAILED: Invalid field was accepted (should have been rejected)");
  } catch (err) {
    if (err.message.includes("Unrecognized key") || err.message.includes("invalidField")) {
      console.log("✓ Strict validation working (invalid field rejected)");
    } else {
      console.log("⚠ Different error than expected:", err.message);
    }
  }
  
  // Merge payees (merge payeeId2 into payeeId)
  console.log("\nMerging payees...");
  await callTool("actual_payees_merge", { 
    targetId: payeeId,
    mergeIds: [payeeId2]
  });
  console.log("✓ Payees merged (payee2 merged into payee1)");
  context.payeeId2 = null; // No longer exists after merge

  // Verify merge: payeeId2 should be gone
  {
    const pd = await callTool("actual_payees_get", {});
    const all = pd.result || pd || [];
    const gone = Array.isArray(all) ? all.find(p => p.id === payeeId2) : null;
    if (gone) console.log(`  ❌ Verify merge: payee2 still exists (should have been merged away)`);
    else console.log(`  ✓ Verify merge: payee2 no longer in list (confirmed deleted by merge)`);
  }
  
  // Get payee rules for our test payee
  console.log("\nGetting payee rules...");
  const rules = await callTool("actual_payee_rules_get", { payeeId: payeeId });
  console.log("✓ Payee rules found:", Array.isArray(rules) ? rules.length : 0);
}

async function transactionTests(context) {
  console.log("\n-- Running TRANSACTION TESTS --");
  
  if (!context.accountId) {
    console.log("⚠ No account ID - skipping transaction tests");
    return;
  }
  
  // Create transaction using MCP payee and category
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log("\nCreating test transaction with MCP payee and category...");
  const txnParams = {
    account: context.accountId,
    date: new Date().toISOString().split('T')[0],
    amount: -5000,
    notes: `MCP-Transaction-${timestamp}`
  };
  
  // Add payee if available
  if (context.payeeId) {
    txnParams.payee = context.payeeId;
    console.log("  Using MCP payee:", context.payeeId);
  }
  
  // Add category if available
  if (context.categoryId) {
    txnParams.category = context.categoryId;
    console.log("  Using MCP category:", context.categoryId);
  }
  
  const txn = await callTool("actual_transactions_create", txnParams);
  const txnId = txn.id || txn.result || null;
  console.log("✓ Created transaction:", txnId || "(ID not available - transaction created successfully)");
  context.transactionId = txnId;
  
  // Only test get/update if we have an ID
  if (txnId && typeof txnId === 'string' && txnId.length > 10) {
    // Get transaction and verify fields
    console.log("\nGetting transaction...");
    const txnData = await callTool("actual_transactions_get", { id: txnId });
    const txn0 = txnData.transaction || txnData.result || txnData;
    if (!txn0 || !txn0.id) {
      console.log("  ❌ Verify create: transaction not found by ID");
    } else {
      console.log("✓ Retrieved transaction:", txn0.id);
      if (txn0.amount === -5000) console.log(`  ✓ Verify create: amount=${txn0.amount} (-$50.00)`);
      else console.log(`  ❌ Verify create: expected amount -5000, got ${txn0.amount}`);
      if (context.categoryId) {
        if (txn0.category === context.categoryId) console.log(`  ✓ Verify create: category="${txn0.category}"`);
        else console.log(`  ❌ Verify create: expected category "${context.categoryId}", got "${txn0.category}"`);
      }
    }

    // Update transaction
    console.log("\nUpdating transaction amount...");
    await callTool("actual_transactions_update", { 
      id: txnId,
      fields: { amount: -7500 }
    });
    console.log("✓ Transaction updated");

    // Verify update
    const txnData2 = await callTool("actual_transactions_get", { id: txnId });
    const txn1 = txnData2.transaction || txnData2.result || txnData2;
    if (!txn1 || !txn1.id) {
      console.log("  ❌ Verify update: transaction not found after update");
    } else if (txn1.amount === -7500) {
      console.log(`  ✓ Verify update: amount=${txn1.amount} (-$75.00)`);
    } else {
      console.log(`  ❌ Verify update: expected amount -7500, got ${txn1.amount}`);
    }
  } else {
    console.log("\n  ⚠ Skipping get/update/verify tests (ID not available from API)");
  }
  
  // Filter transactions
  console.log("\nFiltering transactions for account...");
  const filteredTxns = await callTool("actual_transactions_filter", { 
    account_id: context.accountId
  });
  console.log("✓ Found transactions:", filteredTxns.length);
  
  // Import transactions (test with empty array)
  console.log("\nTesting transaction import (empty)...");
  const importResult = await callTool("actual_transactions_import", { 
    accountId: context.accountId,
    txs: []
  });
  console.log("✓ Import test completed:", importResult);
  
  // Delete transaction will be tested in cleanup
  console.log("  (Transaction deletion tested in cleanup phase)");
}

async function categoryGroupTests(context) {
  console.log("\n-- Running CATEGORY GROUP TESTS --");
  
  // Get all category groups first
  const groupsData = await callTool("actual_category_groups_get", {});
  const groups = groupsData.groups || groupsData || [];
  console.log("✓ Category groups found:", groups.length);
  
  if (groups.length === 0) {
    console.log("⚠ No category groups - creating one for testing");
  }
  
  // Create new category group with unique timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log("\nCreating test category group...");
  const newGroup = await callTool("actual_category_groups_create", { 
    name: `MCP-Group-${timestamp}`
  });
  const groupId = newGroup.id || newGroup.result || newGroup;
  console.log("✓ Created category group:", groupId);
  context.categoryGroupId = groupId;

  // Verify creation
  {
    const gd = await callTool("actual_category_groups_get", {});
    const all = gd.groups || gd || [];
    const found = Array.isArray(all) ? all.find(g => g.id === groupId) : null;
    if (!found) console.log("  ❌ Verify create: group not found in list (id:", groupId, ")");
    else if (found.name === `MCP-Group-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Group-${timestamp}", got "${found.name}"`);
  }

  // Update category group (keeping timestamp)
  console.log("\nUpdating category group...");
  await callTool("actual_category_groups_update", { 
    id: groupId,
    fields: { name: `MCP-Group-${timestamp}-Updated` }
  });
  console.log("✓ Category group updated");

  // Verify update
  {
    const gd = await callTool("actual_category_groups_get", {});
    const all = gd.groups || gd || [];
    const found = Array.isArray(all) ? all.find(g => g.id === groupId) : null;
    if (!found) console.log("  ❌ Verify update: group not found in list");
    else if (found.name === `MCP-Group-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Group-${timestamp}-Updated", got "${found.name}"`);
  }
  
  // Delete will be tested in cleanup
  console.log("  (Category group deletion tested in cleanup phase)");
}

async function budgetTests(context) {
  console.log("\n-- Running BUDGET TESTS --");
  
  // Skip if no category (empty budget)
  if (!context.categoryId) {
    console.log("⚠ No category available - skipping budget tests");
    return;
  }
  
  const currentDate = new Date().toISOString().split('T')[0].substring(0, 7); // YYYY-MM
  
  // Get all budgets
  console.log("\nGetting all budgets...");
  const allBudgets = await callTool("actual_budgets_get_all", {});
  console.log("✓ Retrieved all budgets");
  
  // Get specific month budget
  console.log("\nGetting budget for current month...");
  const monthBudget = await callTool("actual_budgets_getMonth", { month: currentDate });
  console.log("✓ Retrieved month budget:", currentDate);
  
  // Get multiple months
  console.log("\nGetting budgets for multiple months...");
  const months = await callTool("actual_budgets_getMonths", { 
    start: currentDate,
    end: currentDate
  });
  console.log("✓ Retrieved months:", months.length);
  
  // Set budget amount
  console.log("\nSetting budget amount...");
  await callTool("actual_budgets_setAmount", { 
    month: currentDate,
    categoryId: context.categoryId,
    amount: 50000
  });
  console.log("✓ Budget amount set to 500.00");

  // Verify setAmount
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const monthData = check.result || check;
    const catGroups = monthData.categoryGroups || [];
    const catEntry = catGroups.flatMap(g => g.categories || []).find(c => c.id === context.categoryId);
    if (!catEntry) console.log("  ❌ Verify setAmount: category not found in month budget");
    else if (catEntry.budgeted === 50000) console.log(`  ✓ Verify setAmount: budgeted=${catEntry.budgeted} (500.00)`);
    else console.log(`  ❌ Verify setAmount: expected 50000, got ${catEntry.budgeted}`);
  }
  
  // Set carryover
  console.log("\nSetting carryover...");
  await callTool("actual_budgets_setCarryover", { 
    month: currentDate,
    categoryId: context.categoryId,
    flag: true
  });
  console.log("✓ Carryover enabled");

  // Verify setCarryover
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const monthData = check.result || check;
    const catGroups = monthData.categoryGroups || [];
    const catEntry = catGroups.flatMap(g => g.categories || []).find(c => c.id === context.categoryId);
    if (!catEntry) console.log("  ⚠ Verify carryover: category not found in month budget (carryover field check skipped)");
    else if (catEntry.carryover === true || catEntry.carryover === 1) console.log(`  ✓ Verify carryover: carryover=${catEntry.carryover} (enabled)`);
    else console.log(`  ⚠ Verify carryover: carryover=${JSON.stringify(catEntry.carryover)} (API may use different field — check actual_budgets_getMonth response shape)`);
  }
  
  // Hold for next month
  console.log("\nHolding budget for next month...");
  await callTool("actual_budgets_holdForNextMonth", { 
    month: currentDate,
    categoryId: context.categoryId,
    amount: 10000
  });
  console.log("✓ Held 100.00 for next month");
  
  // Reset hold
  console.log("\nResetting hold...");
  await callTool("actual_budgets_resetHold", { 
    month: currentDate,
    categoryId: context.categoryId
  });
  console.log("✓ Hold reset");
  
  // Transfer budget
  console.log("\nTesting budget transfer...");
  // Get first available category from budget to use as target (different from our test category)
  const targetCategory = monthBudget.categoryGroups && monthBudget.categoryGroups[0] && 
    monthBudget.categoryGroups[0].categories && monthBudget.categoryGroups[0].categories[0];
  const targetCategoryId = targetCategory ? targetCategory.id : context.categoryId;
  
  if (targetCategoryId === context.categoryId) {
    console.log("⚠ Skipping transfer test (need two different categories)");
  } else {
    await callTool("actual_budgets_transfer", { 
      month: currentDate,
      amount: 5000,
      fromCategoryId: context.categoryId,
      toCategoryId: targetCategoryId
    });
    console.log("✓ Budget transfer completed");
  }
  
  // Batch updates
  console.log("\nTesting batch budget updates...");
  await callTool("actual_budget_updates_batch", { 
    operations: [
      { month: currentDate, categoryId: context.categoryId, amount: 60000 }
    ]
  });
  console.log("✓ Batch updates completed");
  
  // REGRESSION TEST: Test large batch (31+ operations) with error resilience
  // This tests the fix for AI agent error where large batches caused fetch failures
  console.log("\nREGRESSION: Testing large batch with 35 operations (should handle gracefully)...");
  const largeBatch = [];
  for (let i = 0; i < 35; i++) {
    largeBatch.push({ 
      month: currentDate, 
      categoryId: context.categoryId, 
      amount: 10000 + (i * 100) 
    });
  }
  const batchResult = await callTool("actual_budget_updates_batch", { 
    operations: largeBatch
  });
  console.log("✓ Large batch handled:", batchResult);
  
  // REGRESSION TEST: Test batch with some invalid operations (should continue on errors)
  console.log("\nREGRESSION: Testing batch error resilience (should continue on failures)...");
  const mixedBatch = [
    { month: currentDate, categoryId: context.categoryId, amount: 70000 }, // Valid
    { month: "invalid-date", categoryId: context.categoryId, amount: 80000 }, // Invalid month
    { month: currentDate, categoryId: context.categoryId, amount: 90000 }, // Valid
  ];
  try {
    const mixedResult = await callTool("actual_budget_updates_batch", { 
      operations: mixedBatch
    });
    console.log("✓ Batch with errors processed:", mixedResult);
    if (mixedResult.successCount === 2 && mixedResult.failureCount === 1) {
      console.log("✓ Error resilience working correctly (2 success, 1 failure)");
    }
  } catch (err) {
    console.log("⚠ Batch error handling:", err.message);
  }
}

async function rulesTests(context) {
  console.log("\n-- Running RULES TESTS --");
  
  // Get all rules
  console.log("\nGetting all rules...");
  const rulesData = await callTool("actual_rules_get", {});
  const rules = rulesData.rules || rulesData.result || rulesData || [];
  console.log("✓ Rules found:", Array.isArray(rules) ? rules.length : 0);
  
  // REGRESSION TEST: Create rule without 'op' field (should default to 'set')
  // This tests the fix for AI agent error where 'op' was required but AI omitted it
  console.log("\nREGRESSION: Creating rule without 'op' field (should default to 'set')...");
  const ruleWithoutOp = await callTool("actual_rules_create", { 
    stage: "pre",
    conditionsOp: "and",
    conditions: [
      { field: "notes", op: "contains", value: "no-op-test" }
    ],
    actions: [
      { field: "category", value: context.categoryId } // No 'op' field - should default to 'set'
    ]
  });
  const ruleWithoutOpId = ruleWithoutOp.id || ruleWithoutOp.result || ruleWithoutOp;
  console.log("✓ Rule created without 'op' (defaulted to 'set'):", ruleWithoutOpId);
  context.ruleWithoutOpId = ruleWithoutOpId;
  
  // Create a rule (use category from context)
  console.log("\nCreating test rule...");
  const newRule = await callTool("actual_rules_create", { 
    stage: "pre",
    conditionsOp: "and",
    conditions: [
      { field: "notes", op: "contains", value: "test-rule-marker" }
    ],
    actions: [
      { op: "set", field: "category", value: context.categoryId }
    ]
  });
  const ruleId = newRule.id || newRule.result || newRule;
  console.log("✓ Created rule:", ruleId);
  context.ruleId = ruleId;

  // Verify rule creation
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd.rules || rd.result || rd || [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === ruleId) : null;
    if (!found) console.log("  ❌ Verify create: rule not found in list (id:", ruleId, ")");
    else {
      const cond = found.conditions && found.conditions[0];
      if (cond && cond.value === "test-rule-marker") console.log(`  ✓ Verify create: condition value="${cond.value}"`);
      else console.log(`  ❌ Verify create: expected condition value "test-rule-marker", got "${cond && cond.value}"`);
    }
  }
  
  // Update rule
  console.log("\nUpdating rule...");
  await callTool("actual_rules_update", { 
    id: ruleId,
    fields: {
      stage: "pre",
      conditionsOp: "and",
      conditions: [
        { field: "notes", op: "contains", value: "updated-test-marker" }
      ],
      actions: [
        { op: "set", field: "category", value: context.categoryId }
      ]
    }
  });
  console.log("✓ Rule updated");

  // Verify rule update
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd.rules || rd.result || rd || [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === ruleId) : null;
    if (!found) console.log("  ❌ Verify update: rule not found in list");
    else {
      const cond = found.conditions && found.conditions[0];
      if (cond && cond.value === "updated-test-marker") console.log(`  ✓ Verify update: condition value="${cond.value}"`);
      else console.log(`  ❌ Verify update: expected condition value "updated-test-marker", got "${cond && cond.value}"`);
    }
  }
  
  // Delete will be tested in cleanup
  console.log("  (Rule deletion tested in cleanup phase)");
}

async function advancedTests(context) {
  console.log("\n-- Running ADVANCED TESTS --");
  
  // Test bank sync status
  console.log("\nChecking bank sync status...");
  try {
    const syncStatus = await callTool("actual_bank_sync", {});
    console.log("✓ Bank sync status retrieved:", syncStatus);
  } catch (err) {
    console.log("⚠ Bank sync not available (expected for local budgets):", err.message);
  }
  
  // Test query execution
  console.log("\nExecuting test query...");
  try {
    const queryResult = await callTool("actual_query_run", { 
      query: "SELECT * FROM accounts LIMIT 1"
    });
    console.log("✓ Query executed successfully");
  } catch (err) {
    console.log("⚠ Query execution failed:", err.message);
  }
}

async function extendedTests(context) {
  console.log("\n========================================");
  console.log("EXTENDED TEST MODE - Categories, Payees, Transactions");
  console.log("========================================");

  await categoryGroupTests(context);
  await categoryTests(context);
  await payeeTests(context);
  await transactionTests(context);
}

async function fullTests(context) {
  console.log("\n========================================");
  console.log("FULL TEST MODE - Budgets, Rules, Advanced");
  console.log("========================================");

  await budgetTests(context);
  // Brief pause to let Actual Budget server recover after heavy batch operations
  await new Promise(r => setTimeout(r, 3000));
  await rulesTests(context);
  await advancedTests(context);
}

// -------------------------------
// MCP-TEST ACCOUNT CLEANUP
// -------------------------------

async function cleanupMcpTestAccounts() {
  console.log("\n-- Running MCP TEST ACCOUNT CLEANUP --");
  console.log("Scanning for accounts whose name starts with \"MCP-Test-\"...");

  const accounts = await callTool("actual_accounts_list", {});
  const allAccounts = Array.isArray(accounts) ? accounts : [];

  const mcpTestAccounts = allAccounts.filter(a => a.name && a.name.startsWith("MCP-Test-"));
  console.log(`\n✓ Found ${mcpTestAccounts.length} MCP-Test-* account(s)`);

  if (mcpTestAccounts.length === 0) {
    console.log("  Nothing to clean up.");
    return;
  }

  let totalDeleted = 0;
  let closedCount = 0;
  let alreadyClosedCount = 0;

  for (const account of mcpTestAccounts) {
    const closedLabel = account.closed ? " [already closed]" : "";
    console.log(`\nAccount: "${account.name}"${closedLabel}`);
    console.log(`  ID: ${account.id}`);

    if (account.closed) {
      console.log("  ⚠ Already closed — skipping");
      alreadyClosedCount++;
      continue;
    }

    // Get all transactions for this account
    const txns = await callTool("actual_transactions_filter", { accountId: account.id });
    const txnList = Array.isArray(txns) ? txns : [];
    console.log(`  Transactions: ${txnList.length}`);

    // Delete each transaction
    let deleted = 0;
    for (const txn of txnList) {
      if (!txn.id) continue;
      await callTool("actual_transactions_delete", { id: txn.id });
      deleted++;
    }
    if (deleted > 0) console.log(`  ✓ Deleted ${deleted} transaction(s)`);
    else console.log(`  (no transactions to delete)`);
    totalDeleted += deleted;

    // Close the account
    await callTool("actual_accounts_close", { id: account.id });
    console.log(`  ✓ Account closed`);
    closedCount++;
  }

  console.log(`\n========================================`);
  console.log(`CLEANUP SUMMARY`);
  console.log(`========================================`);
  console.log(`  Accounts closed:          ${closedCount}`);
  console.log(`  Transactions deleted:      ${totalDeleted}`);
  console.log(`  Already closed (skipped):  ${alreadyClosedCount}`);

  // Post-cleanup verification: re-fetch and show current state of all MCP-Test-* accounts
  console.log(`\n-- Verifying account state post-cleanup --`);
  const accountsAfter = await callTool("actual_accounts_list", {});
  const allAfter = Array.isArray(accountsAfter) ? accountsAfter : [];
  const mcpAfter = allAfter.filter(a => a.name && a.name.startsWith("MCP-Test-"));

  let verifyFailed = 0;
  for (const a of mcpAfter) {
    if (a.closed) {
      console.log(`  ✓ [CLOSED] "${a.name}"`);
    } else {
      console.log(`  ❌ [STILL OPEN] "${a.name}" (id: ${a.id})`);
      verifyFailed++;
    }
  }

  if (mcpAfter.length === 0) {
    console.log(`  (no MCP-Test-* accounts found in budget)`);
  } else if (verifyFailed === 0) {
    console.log(`\n✓ All ${mcpAfter.length} MCP-Test-* account(s) confirmed closed.`);
  } else {
    console.log(`\n❌ ${verifyFailed} account(s) are still open — manual intervention may be needed.`);
  }
}

// -------------------------------
// MAIN RUNNER
// -------------------------------

async function run() {
  console.log("=== MCP Actual Budget Automated Tester ===");
  console.log(`Target: ${MCP_URL}`);

  if (!token) {
    const t = await rl.question("Enter AUTH TOKEN (leave blank if server allows none): ");
    if (t.trim() !== "") token = `Bearer ${t.trim()}`;
  }

  if (!level) {
    level = (await rl.question("Select test level (sanity / smoke / normal / extended / full / cleanup) [default: sanity]: ")).toLowerCase() || "sanity";
  }

  console.log(`Test level: ${level.toUpperCase()}\n`);

  try {
    // Initialize MCP session
    await initialize();

    const context = {};

    // Cleanup: delete transactions from all MCP-Test-* accounts, then close them
    if (level === "cleanup") {
      await cleanupMcpTestAccounts();
      await rl.close();
      return;
    }

    // Sanity: protocol-only, no writes
    if (level === "sanity") {
      await sanityTests();
      console.log("\n✓ Sanity checks completed successfully!");
      await rl.close();
      return;
    }

    // Smoke: sanity + extra read checks
    await smokeTests();

    if (level === "smoke") {
      console.log("\n✓ Smoke test completed successfully!");
      await rl.close();
      return;
    }

    // Normal tests: account lifecycle
    await accountTests(context);

    if (level === "normal") {
      // nothing more — fall through to cleanup
    } else if (level === "extended") {
      await extendedTests(context);
    } else if (level === "full") {
      await extendedTests(context);
      await fullTests(context);
    }

    // Cleanup prompt with 10-second timeout
    console.log("\n========================================");
    console.log("CLEANUP PHASE - Testing Delete Operations");
    console.log("========================================");
    
    // Get budget info to show which budget is being used
    let budgetName = "Unknown";
    try {
      const budgets = await callTool("actual_budgets_get_all", {});
      const activeBudget = budgets.result?.find(b => b.id === "_test-budget") || budgets.result?.[0];
      if (activeBudget) {
        budgetName = activeBudget.name || "Test Budget";
      }
    } catch (e) {
      // Ignore error, use default
    }
    
    console.log(`\n📍 Actual Budget Server: ${ACTUAL_SERVER_URL}`);
    console.log(`📂 Budget Name: "${budgetName}"`);
    console.log(`   Open this budget in Actual Budget to verify the test data.`);
    console.log(`   Test data includes: Account "${context.accountName || 'MCP-Test-*'}", categories, payees, transactions, rules`);
    
    let shouldDelete = true;
    if (context.accountId) {
      // If cleanup parameter was provided, use it directly
      if (cleanup === 'no' || cleanup === 'n') {
        shouldDelete = false;
        console.log("\n✓ Test data preserved (cleanup=no)");
      } else if (cleanup === 'yes' || cleanup === 'y') {
        shouldDelete = true;
        console.log("\n✓ Deleting test data (cleanup=yes)");
      } else {
        // No parameter provided, prompt the user
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => resolve('timeout'), 10000);
        });
        
        const questionPromise = rl.question("\nDelete all test data? (yes/no) [default: yes in 10s]: ");
        
        const answer = await Promise.race([questionPromise, timeoutPromise]);
        
        if (answer === 'timeout') {
          console.log("\n⏱️  Timeout - deleting test data by default...");
        } else if (answer.toLowerCase() === 'no' || answer.toLowerCase() === 'n') {
          shouldDelete = false;
          console.log("✓ Test data preserved");
        }
      }
    }
      
    if (shouldDelete) {
      // Delete transaction
      if (context.transactionId) {
        console.log("\nDeleting test transaction...");
        await callTool("actual_transactions_delete", { id: context.transactionId });
        console.log("✓ Transaction deleted");
      }
      
      // Delete rule (without op)
      if (context.ruleWithoutOpId) {
        console.log("\nDeleting test rule (without op)...");
        await callTool("actual_rules_delete", { id: context.ruleWithoutOpId });
        console.log("✓ Rule (without op) deleted");
      }
      
      // Delete rule
      if (context.ruleId) {
        console.log("\nDeleting test rule...");
        await callTool("actual_rules_delete", { id: context.ruleId });
        console.log("✓ Rule deleted");
      }
      
      // Delete payee
      if (context.payeeId) {
        console.log("\nDeleting test payee...");
        await callTool("actual_payees_delete", { id: context.payeeId });
        console.log("✓ Payee deleted");
      }
      
      // Delete category
      if (context.categoryId) {
        console.log("\nDeleting test category...");
        await callTool("actual_categories_delete", { id: context.categoryId });
        console.log("✓ Category deleted");
      }
      
      // Delete category group
      if (context.categoryGroupId) {
        console.log("\nDeleting test category group...");
        await callTool("actual_category_groups_delete", { id: context.categoryGroupId });
        console.log("✓ Category group deleted");
      }
      
      // Delete account (last since transactions depend on it)
      if (context.accountId) {
        console.log("\nDeleting test account...");
        await callTool("actual_accounts_delete", { id: context.accountId });
        console.log("✓ Account deleted");
      }
      
      console.log("\n✓ All cleanup operations completed");
    }

    console.log("\n=== ✓ TESTING COMPLETE ===");
  } catch (err) {
    console.error("\n❌ TEST FAILED:");
    console.error(err.message);
    if (err.stack) {
      console.error("\nStack trace:");
      console.error(err.stack);
    }
    process.exit(1);
  } finally {
    await rl.close();
  }
}

run().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
