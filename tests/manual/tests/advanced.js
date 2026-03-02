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
import { batchUncategorizedRulesUpsertTests } from './batch_uncategorized_rules_upsert.js';

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

  // ── actual_get_id_by_name — all 4 supported types ──────────────────────────
  console.log("\nTesting actual_get_id_by_name (all 4 supported types)...");

  // Type: 'accounts' — list accounts, pick first
  try {
    const accts = await callTool("actual_accounts_list", {});
    const firstAcct = Array.isArray(accts) && accts.length > 0 ? accts[0] : null;
    if (firstAcct?.name) {
      const res = await callTool("actual_get_id_by_name", { type: 'accounts', name: firstAcct.name });
      const resolvedId = res?.id ?? res?.result?.id;
      if (resolvedId === firstAcct.id) {
        console.log(`  ✓ get_id_by_name [accounts]: "${firstAcct.name}" → ${resolvedId}`);
      } else {
        console.log(`  ❌ get_id_by_name [accounts]: expected id=${firstAcct.id}, got ${JSON.stringify(res).slice(0, 120)}`);
      }
    } else {
      console.log("  ℹ get_id_by_name [accounts]: no accounts found to resolve — skipped");
    }
  } catch (err) {
    console.log("  ❌ get_id_by_name [accounts]:", err.message);
  }

  // Type: 'categories' — list categories, pick first
  try {
    const cats = await callTool("actual_categories_get", {});
    const flatCats = Array.isArray(cats) ? cats : [];
    const firstCat = flatCats.find(c => c?.name);
    if (firstCat?.name) {
      const res = await callTool("actual_get_id_by_name", { type: 'categories', name: firstCat.name });
      const resolvedId = res?.id ?? res?.result?.id;
      if (resolvedId === firstCat.id) {
        console.log(`  ✓ get_id_by_name [categories]: "${firstCat.name}" → ${resolvedId}`);
      } else {
        console.log(`  ❌ get_id_by_name [categories]: expected id=${firstCat.id}, got ${JSON.stringify(res).slice(0, 120)}`);
      }
    } else {
      console.log("  ℹ get_id_by_name [categories]: no categories found to resolve — skipped");
    }
  } catch (err) {
    console.log("  ❌ get_id_by_name [categories]:", err.message);
  }

  // Type: 'payees' — list payees, pick first non-transfer payee
  try {
    const payees = await callTool("actual_payees_get", {});
    const flatPayees = Array.isArray(payees) ? payees : [];
    // Transfer payees have transfer_acct set — skip them
    const firstPayee = flatPayees.find(p => p?.name && !p?.transfer_acct);
    if (firstPayee?.name) {
      const res = await callTool("actual_get_id_by_name", { type: 'payees', name: firstPayee.name });
      const resolvedId = res?.id ?? res?.result?.id;
      if (resolvedId === firstPayee.id) {
        console.log(`  ✓ get_id_by_name [payees]: "${firstPayee.name}" → ${resolvedId}`);
      } else {
        console.log(`  ❌ get_id_by_name [payees]: expected id=${firstPayee.id}, got ${JSON.stringify(res).slice(0, 120)}`);
      }
    } else {
      console.log("  ℹ get_id_by_name [payees]: no non-transfer payees found to resolve — skipped");
    }
  } catch (err) {
    console.log("  ❌ get_id_by_name [payees]:", err.message);
  }

  // Type: 'schedules' — list first, then resolve by name (may be empty in any budget)
  try {
    // actual_get_id_by_name for schedules — we must find a real schedule name to look up
    // Use actual_query_run to get the first schedule name from the DB
    const schedResult = await callTool("actual_query_run", { query: "SELECT id, name FROM schedules LIMIT 1" });
    const schedRows = schedResult?.result ?? (Array.isArray(schedResult) ? schedResult : []);
    const firstSched = Array.isArray(schedRows) && schedRows.length > 0 ? schedRows[0] : null;
    if (firstSched?.name) {
      const res = await callTool("actual_get_id_by_name", { type: 'schedules', name: firstSched.name });
      const resolvedId = res?.id ?? res?.result?.id;
      if (typeof resolvedId === 'string' && resolvedId.length > 0) {
        console.log(`  ✓ get_id_by_name [schedules]: "${firstSched.name}" → ${resolvedId}`);
      } else {
        console.log(`  ❌ get_id_by_name [schedules]: could not resolve "${firstSched.name}", got ${JSON.stringify(res).slice(0, 120)}`);
      }
    } else {
      console.log("  ℹ get_id_by_name [schedules]: no schedules in budget — skipped (expected for new/test budgets)");
    }
  } catch (err) {
    // DB query failure or schedule lookup failure — informational
    console.log("  ℹ get_id_by_name [schedules]: could not test — informational:", err.message);
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

  // SQL query validation — exercises the query-validator middleware via actual_query_run.
  // Valid queries should succeed; invalid ones should be rejected before execution.
  console.log("\nTesting query validation (actual_query_run)...");
  const queryValidationTests = [
    // valid
    { query: "SELECT * FROM transactions LIMIT 10",                                                              shouldPass: true,  label: "SELECT * with LIMIT" },
    { query: "SELECT id, date, amount, account FROM transactions",                                              shouldPass: true,  label: "specific fields" },
    { query: "SELECT id, date, amount, payee.name FROM transactions LIMIT 10",                                 shouldPass: true,  label: "join path payee.name" },
    { query: "SELECT id, amount, category.name FROM transactions WHERE amount < 0",                            shouldPass: true,  label: "join path category.name" },
    { query: "SELECT id, date, amount FROM transactions WHERE amount < 0 ORDER BY date DESC LIMIT 20",         shouldPass: true,  label: "WHERE + ORDER BY" },
    // invalid — validator should reject before hitting Actual
    { query: "SELECT id, payee_name FROM transactions LIMIT 5",                                                shouldPass: false, label: "invalid field payee_name" },
    { query: "SELECT id, category_name FROM transactions",                                                     shouldPass: false, label: "invalid field category_name" },
    { query: "SELECT * FROM transaction LIMIT 10",                                                             shouldPass: false, label: "singular table name" },
    { query: "SELECT id, amount FROM transactions WHERE payee_name = 'Test'",                                  shouldPass: false, label: "invalid field in WHERE" },
    { query: "SELECT id, payee_name, category_name FROM transactions",                                         shouldPass: false, label: "multiple invalid fields" },
    { query: "SELECT * FROM transactions WHERE account.id = '00000000-0000-0000-0000-000000000001'",           shouldPass: false, label: "invalid join path account.id" },
  ];
  let qvPassed = 0, qvFailed = 0;
  for (const { query, shouldPass, label } of queryValidationTests) {
    try {
      await callTool("actual_query_run", { query });
      if (shouldPass) {
        console.log(`  ✓ ${label}`);
        qvPassed++;
      } else {
        console.log(`  ❌ ${label}: expected rejection but query succeeded`);
        qvFailed++;
      }
    } catch (err) {
      if (!shouldPass) {
        console.log(`  ✓ ${label}: correctly rejected`);
        qvPassed++;
      } else {
        console.log(`  ❌ ${label}: expected success but got: ${err.message}`);
        qvFailed++;
      }
    }
  }
  console.log(`  Query validation: ${qvPassed}/${queryValidationTests.length} passed${qvFailed ? ` (${qvFailed} failed)` : ''}`);
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
  await batchUncategorizedRulesUpsertTests(client, context);
  await advancedTests(client, context);
}
