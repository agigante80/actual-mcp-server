/**
 * tests/advanced.js
 *
 * Composite test suites that chain domain-specific test modules.
 *
 * extendedTests — categories, payees, transactions (all CRUD entities)
 * fullTests     — budgets, rules, advanced misc
 * advancedTests — bank sync, raw SQL query
 *
 * Reads from context:  populated by the individual test modules
 * Writes to context:   delegated to the individual test modules
 */

import { categoryGroupTests } from './category-group.js';
import { categoryTests } from './category.js';
import { payeeTests } from './payee.js';
import { transactionTests } from './transaction.js';
import { budgetTests } from './budget.js';
import { rulesTests } from './rules.js';

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function advancedTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running ADVANCED TESTS --");

  // Bank sync (optional — expected to fail on local budgets)
  console.log("\nChecking bank sync status...");
  try {
    const syncStatus = await callTool("actual_bank_sync", {});
    console.log("✓ Bank sync status retrieved:", syncStatus);
  } catch (err) {
    console.log("⚠ Bank sync not available (expected for local budgets):", err.message);
  }

  // Raw SQL query
  console.log("\nExecuting test query...");
  try {
    await callTool("actual_query_run", { query: "SELECT * FROM accounts LIMIT 1" });
    console.log("✓ Query executed successfully");
  } catch (err) {
    console.log("⚠ Query execution failed:", err.message);
  }
}

/**
 * EXTENDED: category groups, categories, payees, transactions.
 *
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function extendedTests(client, context) {
  console.log("\n========================================");
  console.log("EXTENDED TEST MODE - Categories, Payees, Transactions");
  console.log("========================================");

  await categoryGroupTests(client, context);
  await categoryTests(client, context);
  await payeeTests(client, context);
  await transactionTests(client, context);
}

/**
 * FULL: budgets, rules, advanced misc.
 *
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function fullTests(client, context) {
  console.log("\n========================================");
  console.log("FULL TEST MODE - Budgets, Rules, Advanced");
  console.log("========================================");

  await budgetTests(client, context);
  // Brief pause to let Actual Budget server recover after heavy batch operations
  await new Promise(r => setTimeout(r, 3000));
  await rulesTests(client, context);
  await advancedTests(client, context);
}
