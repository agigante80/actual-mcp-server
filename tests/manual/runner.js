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
 *   EXPECTED_TOOL_COUNT   Expected number of MCP tools (default: 71)
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config as loadDotenv } from 'dotenv';

import { createClient } from './mcp-client.js';
import { createClient as createStdioClient } from './mcp-client-stdio.js';
import { sweepResidue, assertNoResidue, EXIT_RESIDUE, EXIT_UNSAFE_BUDGET } from './residue.js';
import { failureCount, failureList } from './assert.js';
import { sanityTests } from './tests/sanity.js';
import { smokeTests } from './tests/smoke.js';
import { accountTests } from './tests/account.js';
import { notesTests } from './tests/notes.js';
import { extendedTests, fullTests } from './tests/advanced.js';
import { cleanupMcpTestAccounts } from './cleanup.js';

// Load .env from project root
loadDotenv();

// Default targets the bearer instance (port 3601) — safe for automated tests.
// The OIDC instance (port 3600) requires a Casdoor JWT and cannot be tested without a browser.
const MCP_URL = process.argv[2] || process.env.MCP_SERVER_URL || "http://localhost:3601/http";
// #280: `http` (default) or `stdio`. Both run the SAME level-gated module suite.
const TRANSPORT = (process.env.MCP_TEST_TRANSPORT || 'http').toLowerCase();
const rawToken = process.argv[3] || process.env.MCP_AUTH_TOKEN || "MCP-BEARER-LOCAL-a9f3k2p8q7x1m4n6";
let level = (process.argv[4] || process.env.MCP_TEST_LEVEL || '').toLowerCase() || null;
let cleanup = process.argv[5] ? process.argv[5].toLowerCase() : null; // 'yes'|'no'|null
// Opt-in flags — none enabled by default.
// Set MCP_TEST_BANK_SYNC=true in the environment to include the bank sync test.
const testOpts = {
  bankSync: process.env.MCP_TEST_BANK_SYNC === 'true',
};

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "http://localhost:5006";

// ---------------------------------------------------------------------------
// Wall-clock guard — see issue #133.
// Per-level defaults match the documented "expected runtime" in tests/manual/README.md.
// MCP_TEST_MAX_RUNTIME_MS overrides for any single run (e.g. CI bisects).
// Exit code 2 (distinct from exit code 1 used for assertion failures) so
// schedulers can distinguish "tests failed" from "harness gave up — server bad".
// ---------------------------------------------------------------------------
const RUNTIME_BUDGETS_MS = {
  sanity: 60_000,
  smoke: 120_000,
  normal: 300_000,
  extended: 600_000,
  full: 900_000,
  cleanup: 120_000,
};

function startWallClockGuard(levelName) {
  const override = process.env.MCP_TEST_MAX_RUNTIME_MS;
  const budgetMs = override ? parseInt(override, 10) : (RUNTIME_BUDGETS_MS[levelName] || 600_000);
  let lastCompleted = '<startup>';
  const setLastCompleted = (label) => { lastCompleted = label; };
  const handle = setTimeout(() => {
    const minutes = Math.round(budgetMs / 60000);
    console.error(`\n❌ Aborted after ${minutes} min — server appears unhealthy. Last completed test: ${lastCompleted}`);
    process.exit(2);
  }, budgetMs);
  // Don't keep the event loop alive solely for the timer — `node` should exit
  // promptly on success even if some other handle is still cleaning up.
  if (typeof handle.unref === 'function') handle.unref();
  return {
    setLastCompleted,
    clear: () => clearTimeout(handle),
    budgetMs,
  };
}

export async function run() {
  const rl = readline.createInterface({ input, output });
  let guard = null;
  let client = null;

  // #280: the stdio transport spawns `docker exec`. An orphaned child holds the
  // container's data dir and is the documented cause of the data-dir contention hangs,
  // so tear it down on EVERY exit path, including signals. Idempotent by design.
  const teardown = async () => { try { await client?.close?.(); } catch { /* already gone */ } };
  const onSignal = (sig) => { teardown().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143)); };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  try {
    // #280: transport selection. `http` (default) preserves every existing behaviour;
    // `stdio` runs the SAME 13 modules over the other transport, which previously had
    // zero write-path coverage.
    client = TRANSPORT === 'stdio'
      ? createStdioClient({ container: process.env.MCP_STDIO_CONTAINER, rl })
      : createClient({ url: MCP_URL, rl });

    // Set token from CLI / env, or prompt interactively.
    // The stdio client's setToken() is a no-op: container access IS the authentication.
    if (rawToken) {
      client.setToken(`Bearer ${rawToken}`);
    } else if (TRANSPORT === 'stdio') {
      // No token needed over stdio; do not prompt.
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
    console.log(`Transport: ${TRANSPORT.toUpperCase()}`);
    console.log(`Test level: ${level.toUpperCase()}\n`);

    // Start the wall-clock guard now that we know the level. The guard fires
    // process.exit(2) if the suite is still running after the per-level budget.
    guard = startWallClockGuard(level);
    console.log(`Wall-clock guard armed: ${Math.round(guard.budgetMs / 1000)}s budget for level=${level} (override via MCP_TEST_MAX_RUNTIME_MS)\n`);

    // Initialize MCP session
    await client.initialize();
    guard.setLastCompleted('initialize');

    const context = {};

    // #280: start from a known-clean budget at mutating levels, so the suite's own count
    // assertions are stable and a previous crashed run cannot pollute this one. The sweep
    // refuses to touch a budget that has not been designated disposable AND is not the one
    // the server actually has loaded. See tests/manual/residue.js.
    const MUTATING = ['normal', 'extended', 'full'];
    if (MUTATING.includes(level)) {
      console.log('--- Pre-run residue sweep ---');
      try {
        await sweepResidue(client.callTool);
      } catch (err) {
        if (err.code === EXIT_UNSAFE_BUDGET) {
          console.error(`\n❌ ${err.message}`);
          await teardown();
          if (guard) guard.clear();
          rl.close();
          process.exit(EXIT_UNSAFE_BUDGET);
        }
        throw err;
      }
      guard.setLastCompleted('sweepResidue');
    }

    // --- CLEANUP (standalone) ---
    if (level === "cleanup") {
      await cleanupMcpTestAccounts(client);
      guard.setLastCompleted('cleanup');
      return;
    }

    // --- SANITY ---
    if (level === "sanity") {
      await sanityTests(client);
      guard.setLastCompleted('sanityTests');
      console.log("\n✓ Sanity checks completed successfully!");
      return;
    }

    // --- SMOKE ---
    await smokeTests(client);
    guard.setLastCompleted('smokeTests');
    if (level === "smoke") {
      console.log("\n✓ Smoke test completed successfully!");
      return;
    }

    // --- NORMAL / EXTENDED / FULL ---
    await accountTests(client, context);
    guard.setLastCompleted('accountTests');

    await notesTests(client, context);
    guard.setLastCompleted('notesTests');

    if (level === "extended") {
      await extendedTests(client, context);
      guard.setLastCompleted('extendedTests');
    } else if (level === "full") {
      await extendedTests(client, context);
      guard.setLastCompleted('extendedTests');
      await fullTests(client, context, testOpts);
      guard.setLastCompleted('fullTests');
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

    // #280 + #281: single end-of-suite decision. Evaluate BOTH the residue assertion and
    // the assertion-failure ledger, print BOTH verdicts, then exit with a defined
    // precedence. A failed assertion (exit 1) is the primary signal and wins the exit code,
    // but the residue leak is still reported. Exit 2 (runtime budget) and exit 4 (unsafe
    // budget) fire earlier where they already do and are unchanged.
    let residue = 0;
    if (['normal', 'extended', 'full'].includes(level)) {
      console.log("\n--- Post-run zero-residue assertion ---");
      residue = await assertNoResidue(client.callTool);
    }

    // #281: a failed assertion in any module now FAILS the run. Before this, modules printed
    // ❌ and the runner exited 0, so "the suite passed" meant "the runner reached the end".
    const failures = failureCount();
    if (failures > 0) {
      console.error(`\n❌ ${failures} assertion(s) FAILED. This run is a failure, not a pass:`);
      for (const f of failureList()) console.error(`   - ${f}`);
      if (residue > 0) {
        console.error(`\n(Also: ${residue} test object(s) survived cleanup; see the residue verdict above.)`);
      }
      await teardown();
      if (guard) guard.clear();
      rl.close();
      process.exit(1);
    }

    if (residue > 0) {
      console.error(`\n❌ ${residue} test object(s) survived cleanup. The next run cannot be validated against a dirty budget.`);
      await teardown();
      if (guard) guard.clear();
      rl.close();
      process.exit(EXIT_RESIDUE);
    }

    console.log("\n=== ✓ TESTING COMPLETE ===");

  } catch (err) {
    console.error("\n❌ TEST FAILED:");
    console.error(err.message);
    if (err.stack) {
      console.error("\nStack trace:");
      console.error(err.stack);
    }
    await teardown();
    process.exit(1);
  } finally {
    // Runs on the success path and on every non-exit() failure. teardown() is idempotent,
    // so calling it again from an exit path above is harmless.
    await teardown();
    if (guard) guard.clear();
    rl.close();
  }
}
