/**
 * tests/smoke.js
 *
 * SMOKE TESTS — sanity checks plus extra read-only coverage:
 * account balances, category/group listing, recent transactions.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 */

import { sanityTests } from './sanity.js';

/**
 * @param {{ callTool: Function, listTools: Function }} client
 */
export async function smokeTests(client) {
  const { callTool } = client;
  console.log("\n-- Running SMOKE TESTS --");

  await sanityTests(client);

  // Categories
  console.log("\nTesting category list...");
  const categories = await callTool("actual_categories_get", {});
  const categoryCount = Array.isArray(categories) ? categories.length : 0;
  console.log(`✓ Found ${categoryCount} categories`);

  // Category groups
  console.log("\nTesting category groups...");
  const groups = await callTool("actual_category_groups_get", {});
  const groupCount = Array.isArray(groups)
    ? groups.length
    : (groups && typeof groups === 'object' ? Object.keys(groups).length : 0);
  console.log(`✓ Found ${groupCount} category groups`);

  // Accounts with balances
  console.log("\nListing accounts...");
  const accounts = await callTool("actual_accounts_list", {});
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log("  (no accounts found)");
  } else {
    for (const a of accounts) {
      const balData = await callTool("actual_accounts_get_balance", { id: a.id });
      const bal = typeof balData?.balance === 'number'
        ? (balData.balance / 100).toFixed(2)
        : 'n/a';
      console.log(`  • ${a.name}  [${a.id}]  balance: ${bal}`);
    }
  }

  // Last 3 transactions
  console.log("\nLast 3 transactions...");
  const txns = await callTool("actual_transactions_filter", { account: null });
  const recent = Array.isArray(txns) ? txns.slice(0, 3) : [];
  if (recent.length === 0) {
    console.log("  (no transactions found)");
  } else {
    recent.forEach(t =>
      console.log(`  • ${t.date}  ${(t.amount / 100).toFixed(2)}  ${t.notes || t.imported_payee || t.payee_name || ''}`.trimEnd())
    );
  }
}
