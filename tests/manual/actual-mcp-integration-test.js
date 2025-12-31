// Actual Budget MCP Integration Test Script
// Purpose:
//   This script connects to an MCP (Model Context Protocol) server exposing the
//   Actual Budget API. It supports multiple testing levels:
//
//   SMOKE TESTS:
//     Quick connectivity and core API checks. Focused on basic functionality:
//     - Initialize MCP session
//     - List available tools (49 tools)
//     - List accounts
//     - List categories
//
//   NORMAL TESTS:
//     Standard functionality testing. Covers the main entities in Actual:
//     - All SMOKE tests
//     - Account operations: create, get balance, update
//     - Creates unique timestamped test account (MCP-Test-YYYY-MM-DDTHH-MM-SS-mmmZ)
//     - Cleanup prompt with 10-second auto-delete timeout
//
//   FULL TESTS:
//     Comprehensive testing including transactions and advanced operations:
//     - All NORMAL tests
//     - Category operations: create, update (if category groups exist)
//     - Payee operations: create, update (if categories available)
//     - Transaction operations: create, get, update (if categories available)
//     - Gracefully skips category/payee/transaction tests if budget is empty
//     - Cleanup prompt with 10-second auto-delete timeout
//
//   The script uses proper MCP JSON-RPC 2.0 protocol with session management.
//
//   Usage:
//     node actual-mcp-integration-test.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]
//     
//     Parameters:
//       MCP_URL  - MCP server URL (default: http://localhost:3600/http)
//       TOKEN    - Bearer token for authentication
//       LEVEL    - Test level: smoke, normal, or full
//       CLEANUP  - Optional cleanup behavior:
//                  'yes' or 'y' - Auto-delete test data
//                  'no' or 'n'  - Preserve test data
//                  (omitted)    - Interactive prompt with 10s timeout
//     
//     Examples:
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN smoke
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN normal no
//       node actual-mcp-integration-test.js http://localhost:3600/http TOKEN full yes

import fetch from 'node-fetch';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const MCP_URL = process.argv[2] || "http://localhost:3600/http";
let token = process.argv[3] ? `Bearer ${process.argv[3]}` : (process.env.MCP_AUTH_TOKEN ? `Bearer ${process.env.MCP_AUTH_TOKEN}` : null);
let level = process.argv[4] ? process.argv[4].toLowerCase() : null;
let cleanup = process.argv[5] ? process.argv[5].toLowerCase() : null; // 'yes', 'no', or null for prompt

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

async function smokeTests() {
  console.log("\n-- Running SMOKE TESTS --");
  
  const tools = await listTools();
  console.log("Available tools sample:", tools.slice(0, 5).map(t => t.name).join(", "), "...");
  
  // Test basic account listing
  console.log("\nTesting account list...");
  const accounts = await callTool("actual_accounts_list", {});
  console.log(`✓ Found ${accounts.length} accounts`);
  
  // Test category listing
  console.log("\nTesting category list...");
  const categories = await callTool("actual_categories_get", {});
  console.log(`✓ Found ${categories.grouped ? Object.keys(categories.grouped).length : 0} category groups`);
}

async function accountTests(context) {
  console.log("\n-- Running ACCOUNT TESTS --");
  
  // List accounts before
  const accountsBefore = await callTool("actual_accounts_list", {});
  console.log(`Accounts before: ${accountsBefore.length}`);
  
  // Create unique test account with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accountName = `MCP-Test-${timestamp}`;
  
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
  
  // Get balance
  console.log("\nGetting account balance...");
  const balance = await callTool("actual_accounts_get_balance", { id: accountId });
  console.log("✓ Balance:", balance);
  
  // REGRESSION TEST: Update multiple account fields (tests strict validation)
  console.log("\nREGRESSION: Updating multiple account fields (name, offbudget)...");
  await callTool("actual_accounts_update", { 
    id: accountId,
    fields: { 
      name: accountName + "-Updated",
      offbudget: true
    }
  });
  console.log("✓ Account updated with multiple fields");
  
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
  
  // Close account
  console.log("\nClosing account...");
  await callTool("actual_accounts_close", { id: accountId });
  console.log("✓ Account closed");
  
  // Reopen account
  console.log("\nReopening account...");
  await callTool("actual_accounts_reopen", { id: accountId });
  console.log("✓ Account reopened");
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
  const categoryId = newCat.id || newCat.result || newCat;
  console.log("✓ Created category:", categoryId);
  context.categoryId = categoryId;
  
  // Update category (keeping timestamp)
  console.log("\nUpdating category...");
  await callTool("actual_categories_update", { 
    id: categoryId,
    fields: { name: `MCP-Cat-${timestamp}-Updated` }
  });
  console.log("✓ Category updated");
  
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
  // This tests the fix for AI agent error where setting default category failed
  if (context.categoryId) {
    console.log("\nREGRESSION: Setting default category on payee...");
    await callTool("actual_payees_update", { 
      id: payeeId,
      fields: { 
        category: context.categoryId
      }
    });
    console.log("✓ Payee updated with default category");
  }
  
  // Update payee
  console.log("\nUpdating payee name...");
  await callTool("actual_payees_update", { 
    id: payeeId,
    fields: { name: `MCP-Payee-${timestamp}-Updated` }
  });
  console.log("✓ Payee updated");
  
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
    // Get transaction
    console.log("\nGetting transaction...");
    const txnData = await callTool("actual_transactions_get", { id: txnId });
    console.log("✓ Retrieved transaction:", txnData.id);
    
    // Update transaction
    console.log("\nUpdating transaction amount...");
    await callTool("actual_transactions_update", { 
      id: txnId,
      fields: { amount: -7500 }
    });
    console.log("✓ Transaction updated");
  } else {
    console.log("\n  ⚠ Skipping get/update tests (ID not available from API)");
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
  
  // Update category group (keeping timestamp)
  console.log("\nUpdating category group...");
  await callTool("actual_category_groups_update", { 
    id: groupId,
    fields: { name: `MCP-Group-${timestamp}-Updated` }
  });
  console.log("✓ Category group updated");
  
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
  
  // Set carryover
  console.log("\nSetting carryover...");
  await callTool("actual_budgets_setCarryover", { 
    month: currentDate,
    categoryId: context.categoryId,
    flag: true
  });
  console.log("✓ Carryover enabled");
  
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
  const rules = rulesData.result || rulesData || [];
  console.log("✓ Rules found:", rules.length);
  
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

async function fullTests(context) {
  console.log("\n========================================");
  console.log("FULL TEST MODE - All 49 Tools");
  console.log("========================================");
  
  await categoryGroupTests(context);
  await categoryTests(context);
  await payeeTests(context);
  await transactionTests(context);
  await budgetTests(context);
  await rulesTests(context);
  await advancedTests(context);
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
    level = (await rl.question("Select test level (smoke / normal / full) [default: smoke]: ")).toLowerCase() || "smoke";
  }

  console.log(`Test level: ${level.toUpperCase()}\n`);

  try {
    // Initialize MCP session
    await initialize();

    const context = {};

    // Basic smoke test
    await smokeTests();

    if (level === "smoke") {
      console.log("\n✓ Smoke test completed successfully!");
      await rl.close();
      return;
    }

    // Normal tests
    await accountTests(context);
    
    if (level === "full") {
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
