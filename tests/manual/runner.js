/**
 * runner.js
 *
 * Main orchestrator. Parses CLI + env, creates the MCP client, dispatches to
 * test levels, handles the end-of-test cleanup prompt, and owns the top-level
 * try/catch. This is the only module that calls process.exit().
 *
 * Usage (via index.js):
 *   node tests/manual/index.js [MCP_URL] [TOKEN] [LEVEL] [CLEANUP]
 *
 * Parameters:
 *   MCP_URL  - MCP server URL (default: http://localhost:3601/http  ← bearer instance)
 *   TOKEN    - Bearer token (default: MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6)
 *   LEVEL    - sanity | smoke | normal | extended | full | cleanup
 *   CLEANUP  - yes | no | y | n  (default: interactive prompt with 10s timeout)
 *
 * Two MCP instances are running:
 *   Port 3600  actual-mcp-server-backend  AUTH_PROVIDER=oidc    (LibreChat/LobeChat users)
 *   Port 3601  actual-mcp-bearer-backend  AUTH_PROVIDER=none    (automated tests ← default)
 *
 * Environment variables:
 *   MCP_SERVER_URL        MCP server URL override
 *   MCP_AUTH_TOKEN        Bearer token override
 *   MCP_TEST_LEVEL        Test level override
 *   ACTUAL_SERVER_URL     Actual Budget server URL (shown in cleanup prompt)
 *   EXPECTED_TOOL_COUNT   Expected number of MCP tools (default: 60)
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config as loadDotenv } from 'dotenv';

import { createClient } from './mcp-client.js';
import { sanityTests } from './tests/sanity.js';
import { smokeTests } from './tests/smoke.js';
import { accountTests } from './tests/account.js';
import { extendedTests, fullTests } from './tests/advanced.js';
import { cleanupMcpTestAccounts } from './cleanup.js';

// Load .env from project root
loadDotenv();

// Default targets the bearer instance (port 3601) — safe for automated tests.
// The OIDC instance (port 3600) requires a Casdoor JWT and cannot be tested without a browser.
const MCP_URL = process.argv[2] || process.env.MCP_SERVER_URL || "http://localhost:3601/http";
const rawToken = process.argv[3] || process.env.MCP_AUTH_TOKEN || "MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6";
let level = (process.argv[4] || process.env.MCP_TEST_LEVEL || '').toLowerCase() || null;
let cleanup = process.argv[5] ? process.argv[5].toLowerCase() : null; // 'yes'|'no'|null

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "http://localhost:5006";

export async function run() {
  const rl = readline.createInterface({ input, output });

  try {
    const client = createClient({ url: MCP_URL, rl });

    // Set token from CLI / env, or prompt interactively
    if (rawToken) {
      client.setToken(`Bearer ${rawToken}`);
    } else {
      console.log("=== MCP Actual Budget Automated Tester ===");
      console.log(`Target: ${MCP_URL}`);
      const t = await rl.question("Enter AUTH TOKEN (leave blank if server allows none): ");
      if (t.trim()) client.setToken(`Bearer ${t.trim()}`);
    }

    // Prompt for level if not provided
    if (!level) {
      console.log("=== MCP Actual Budget Automated Tester ===");
      console.log(`Target: ${MCP_URL}`);
      level = (await rl.question(
        "Select test level (sanity / smoke / normal / extended / full / cleanup) [default: sanity]: "
      )).toLowerCase() || "sanity";
    }

    console.log("=== MCP Actual Budget Automated Tester ===");
    console.log(`Target: ${MCP_URL}`);
    console.log(`Test level: ${level.toUpperCase()}\n`);

    // Initialize MCP session
    await client.initialize();

    const context = {};

    // --- CLEANUP (standalone) ---
    if (level === "cleanup") {
      await cleanupMcpTestAccounts(client);
      return;
    }

    // --- SANITY ---
    if (level === "sanity") {
      await sanityTests(client);
      console.log("\n✓ Sanity checks completed successfully!");
      return;
    }

    // --- SMOKE ---
    await smokeTests(client);
    if (level === "smoke") {
      console.log("\n✓ Smoke test completed successfully!");
      return;
    }

    // --- NORMAL / EXTENDED / FULL ---
    await accountTests(client, context);

    if (level === "extended") {
      await extendedTests(client, context);
    } else if (level === "full") {
      await extendedTests(client, context);
      await fullTests(client, context);
    }
    // level === "normal" falls through here with no extra steps

    // -----------------------------------------------------------------------
    // End-of-test cleanup phase
    // -----------------------------------------------------------------------
    console.log("\n========================================");
    console.log("CLEANUP PHASE - Testing Delete Operations");
    console.log("========================================");

    // Show which budget was used
    let budgetName = "Unknown";
    try {
      const budgets = await client.callTool("actual_budgets_get_all", {});
      const activeBudget = budgets.result?.find(b => b.id === "_test-budget") || budgets.result?.[0];
      if (activeBudget) budgetName = activeBudget.name || "Test Budget";
    } catch { /* ignore */ }

    console.log(`\n📍 Actual Budget Server: ${ACTUAL_SERVER_URL}`);
    console.log(`📂 Budget Name: "${budgetName}"`);
    console.log(`   Open this budget in Actual Budget to verify the test data.`);
    console.log(`   Test data includes: Account "${context.accountName || 'MCP-Test-*'}", categories, payees, transactions, rules`);

    // Determine whether to delete
    let shouldDelete = true;
    if (context.accountId) {
      if (cleanup === 'no' || cleanup === 'n') {
        shouldDelete = false;
        console.log("\n✓ Test data preserved (cleanup=no)");
      } else if (cleanup === 'yes' || cleanup === 'y') {
        console.log("\n✓ Deleting test data (cleanup=yes)");
      } else {
        const answer = await Promise.race([
          rl.question("\nDelete all test data? (yes/no) [default: yes in 10s]: "),
          new Promise(resolve => setTimeout(() => resolve('timeout'), 10000)),
        ]);
        if (answer === 'timeout') {
          console.log("\n⏱️  Timeout - deleting test data by default...");
        } else if (answer.toLowerCase() === 'no' || answer.toLowerCase() === 'n') {
          shouldDelete = false;
          console.log("✓ Test data preserved");
        }
      }
    }

    if (shouldDelete) {
      const { callTool } = client;

      if (context.transactionId) {
        console.log("\nDeleting test transaction...");
        await callTool("actual_transactions_delete", { id: context.transactionId });
        console.log("✓ Transaction deleted");
      }
      if (context.ruleWithoutOpId) {
        console.log("\nDeleting test rule (without op)...");
        await callTool("actual_rules_delete", { id: context.ruleWithoutOpId });
        console.log("✓ Rule (without op) deleted");
      }
      if (context.rulesUpsertId) {
        console.log("\nDeleting test rule (upsert)...");
        await callTool("actual_rules_delete", { id: context.rulesUpsertId });
        console.log("✓ Rule (upsert) deleted");
      }
      if (context.ruleId) {
        console.log("\nDeleting test rule...");
        await callTool("actual_rules_delete", { id: context.ruleId });
        console.log("✓ Rule deleted");
      }
      if (context.payeeId) {
        console.log("\nDeleting test payee...");
        await callTool("actual_payees_delete", { id: context.payeeId });
        console.log("✓ Payee deleted");
      }
      if (context.categoryId) {
        console.log("\nDeleting test category...");
        await callTool("actual_categories_delete", { id: context.categoryId });
        console.log("✓ Category deleted");
      }
      if (context.categoryGroupId) {
        console.log("\nDeleting test category group...");
        await callTool("actual_category_groups_delete", { id: context.categoryGroupId });
        console.log("✓ Category group deleted");
      }
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
    rl.close();
  }
}
