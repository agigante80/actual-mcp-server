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

  // Session list (actual_session_list)
  console.log("\nListing active sessions...");
  try {
    const sessionList = await callTool("actual_session_list", {});
    const total = sessionList?.totalSessions ?? sessionList?.result?.totalSessions;
    if (typeof total === 'number' && total >= 1) {
      console.log(`  ✓ Verify session_list: totalSessions=${total}, activeSessions=${sessionList?.activeSessions ?? sessionList?.result?.activeSessions}`);
    } else {
      console.log(`  ❌ Verify session_list: expected totalSessions >= 1, got ${JSON.stringify(sessionList).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ session_list failed:", err.message);
  }

  // Session close — no sessionId, closes oldest idle session (or reports none to close)
  console.log("\nTesting session close (no-op, current session protected)...");
  try {
    const closeResult = await callTool("actual_session_close", {});
    const success = closeResult?.success ?? closeResult?.result?.success;
    const message = closeResult?.message ?? closeResult?.result?.message ?? '';
    if (success === true) {
      console.log(`  ✓ Verify session_close: closed session (${message})`);
    } else if (typeof message === 'string' && (
      message.includes('No other sessions') || message.includes('No sessions')
    )) {
      console.log(`  ✓ Verify session_close: correctly reported no closable sessions (${message})`);
    } else {
      console.log(`  ⚠ Verify session_close: unexpected response: ${JSON.stringify(closeResult).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ session_close failed:", err.message);
  }

  // ActualQL search/summary tools
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const monthStart = `${currentMonth}-01`;
  const today = new Date().toISOString().split('T')[0];

  // actual_transactions_search_by_month
  console.log("\nSearching transactions by month (actual_transactions_search_by_month)...");
  try {
    const byMonth = await callTool("actual_transactions_search_by_month", { month: currentMonth });
    const count = byMonth?.count ?? byMonth?.result?.count;
    const totalAmount = byMonth?.totalAmount ?? byMonth?.result?.totalAmount;
    if (typeof count === 'number' && typeof totalAmount === 'number') {
      console.log(`  ✓ Verify search_by_month: count=${count}, totalAmount=${totalAmount} cents`);
    } else {
      console.log(`  ❌ Verify search_by_month: unexpected response shape: ${JSON.stringify(byMonth).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ search_by_month failed:", err.message);
  }

  // actual_transactions_search_by_amount
  console.log("\nSearching transactions by amount range (actual_transactions_search_by_amount)...");
  try {
    const byAmount = await callTool("actual_transactions_search_by_amount", {
      minAmount: -100000000,
      maxAmount: 100000000,
      startDate: monthStart,
      endDate: today,
    });
    const transactions = byAmount?.transactions ?? byAmount?.result?.transactions ?? byAmount?.result ?? byAmount;
    if (Array.isArray(transactions)) {
      console.log(`  ✓ Verify search_by_amount: returned ${transactions.length} transaction(s)`);
    } else {
      console.log(`  ❌ Verify search_by_amount: expected array, got ${JSON.stringify(byAmount).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ search_by_amount failed:", err.message);
  }

  // actual_transactions_search_by_category (no filter — all categories)
  console.log("\nSearching transactions by category (actual_transactions_search_by_category)...");
  try {
    const byCategory = await callTool("actual_transactions_search_by_category", {
      startDate: monthStart,
      endDate: today,
    });
    const transactions = byCategory?.transactions ?? byCategory?.result?.transactions ?? byCategory?.result ?? byCategory;
    if (Array.isArray(transactions)) {
      console.log(`  ✓ Verify search_by_category: returned ${transactions.length} transaction(s)`);
    } else {
      console.log(`  ❌ Verify search_by_category: unexpected response: ${JSON.stringify(byCategory).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ search_by_category failed:", err.message);
  }

  // actual_transactions_search_by_payee (no filter — all payees)
  console.log("\nSearching transactions by payee (actual_transactions_search_by_payee)...");
  try {
    const byPayee = await callTool("actual_transactions_search_by_payee", {
      startDate: monthStart,
      endDate: today,
    });
    const transactions = byPayee?.transactions ?? byPayee?.result?.transactions ?? byPayee?.result ?? byPayee;
    if (Array.isArray(transactions)) {
      console.log(`  ✓ Verify search_by_payee: returned ${transactions.length} transaction(s)`);
    } else {
      console.log(`  ❌ Verify search_by_payee: unexpected response: ${JSON.stringify(byPayee).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ search_by_payee failed:", err.message);
  }

  // actual_transactions_summary_by_category
  console.log("\nSummarizing transactions by category (actual_transactions_summary_by_category)...");
  try {
    const sumByCat = await callTool("actual_transactions_summary_by_category", {
      startDate: monthStart,
      endDate: today,
    });
    const data = sumByCat?.summary ?? sumByCat?.result?.summary ?? sumByCat?.result ?? sumByCat;
    if (Array.isArray(data)) {
      console.log(`  ✓ Verify summary_by_category: returned ${data.length} category group(s)`);
    } else {
      console.log(`  ❌ Verify summary_by_category: unexpected response: ${JSON.stringify(sumByCat).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ summary_by_category failed:", err.message);
  }

  // actual_transactions_summary_by_payee
  console.log("\nSummarizing transactions by payee (actual_transactions_summary_by_payee)...");
  try {
    const sumByPayee = await callTool("actual_transactions_summary_by_payee", {
      startDate: monthStart,
      endDate: today,
    });
    const data = sumByPayee?.summary ?? sumByPayee?.result?.summary ?? sumByPayee?.result ?? sumByPayee;
    if (Array.isArray(data)) {
      console.log(`  ✓ Verify summary_by_payee: returned ${data.length} payee group(s)`);
    } else {
      console.log(`  ❌ Verify summary_by_payee: unexpected response: ${JSON.stringify(sumByPayee).slice(0, 120)}`);
    }
  } catch (err) {
    console.log("⚠ summary_by_payee failed:", err.message);
  }

  // Bank sync (optional — expected to fail on local budgets)
  // Use callMCP directly with maxRetries=1 to avoid infinite reconnect loop.
  console.log("\nChecking bank sync status...");
  try {
    const raw = await client.callMCP("tools/call", {
      name: "actual_bank_sync",
      arguments: {},
    }, 1 /* maxRetries */);
    // Unwrap MCP envelope
    const syncText = raw?.content?.[0]?.text;
    const syncStatus = syncText ? (() => { try { return JSON.parse(syncText); } catch { return syncText; } })() : raw;
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
