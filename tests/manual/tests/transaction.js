/**
 * tests/transaction.js
 *
 * TRANSACTION TESTS — create, get, update, filter, import.
 *
 * Reads from context:  accountId (required), payeeId (optional), categoryId (optional)
 * Writes to context:   transactionId
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function transactionTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running TRANSACTION TESTS --");

  if (!context.accountId) {
    console.log("⚠ No account ID - skipping transaction tests");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Build create params, attaching optional payee / category from context
  const txnParams = {
    account: context.accountId,
    date: new Date().toISOString().split('T')[0],
    amount: -5000,
    notes: `MCP-Transaction-${timestamp}`,
  };
  if (context.payeeId) {
    txnParams.payee = context.payeeId;
    console.log("\n  Using MCP payee:", context.payeeId);
  }
  if (context.categoryId) {
    txnParams.category = context.categoryId;
    console.log("  Using MCP category:", context.categoryId);
  }

  console.log("\nCreating test transaction with MCP payee and category...");
  const txn = await callTool("actual_transactions_create", txnParams);
  console.log("✓ Created transaction (finding via notes filter...)");

  // actual_transactions_create does not return an ID — locate it by notes filter
  console.log("\nVerifying create: searching by notes...");
  const noteFilter = await callTool("actual_transactions_filter", {
    accountId: context.accountId,
    notes: `MCP-Transaction-${timestamp}`,
  });
  const noteResults = Array.isArray(noteFilter) ? noteFilter : (noteFilter.result || []);
  const createdTxn = noteResults.find(t => t.notes === `MCP-Transaction-${timestamp}`);
  if (!createdTxn) {
    console.log("  ❌ Verify create: transaction not found by notes filter");
  } else {
    context.transactionId = createdTxn.id;
    console.log(`  ✓ Verify create: found id="${createdTxn.id}"`);
    if (createdTxn.amount === -5000) console.log(`  ✓ Verify create: amount=${createdTxn.amount} (-$50.00)`);
    else console.log(`  ❌ Verify create: expected amount -5000, got ${createdTxn.amount}`);
    if (context.categoryId) {
      if (createdTxn.category === context.categoryId) console.log(`  ✓ Verify create: category="${createdTxn.category}"`);
      else console.log(`  ❌ Verify create: expected category "${context.categoryId}", got "${createdTxn.category}"`);
    }
  }

  // Get and update using the recovered ID
  if (context.transactionId) {
    console.log("\nUpdating transaction amount...");
    await callTool("actual_transactions_update", { id: context.transactionId, fields: { amount: -7500 } });
    console.log("✓ Transaction updated");

    // Verify update — re-filter by notes since there's no get-by-id tool
    const updateFilter = await callTool("actual_transactions_filter", {
      accountId: context.accountId,
      notes: `MCP-Transaction-${timestamp}`,
    });
    const updateResults = Array.isArray(updateFilter) ? updateFilter : (updateFilter.result || []);
    const updatedTxn = updateResults.find(t => t.id === context.transactionId);
    if (!updatedTxn) {
      console.log("  ❌ Verify update: transaction not found by notes filter after update");
    } else if (updatedTxn.amount === -7500) {
      console.log(`  ✓ Verify update: amount=${updatedTxn.amount} (-$75.00)`);
    } else {
      console.log(`  ❌ Verify update: expected amount -7500, got ${updatedTxn.amount}`);
    }
  } else {
    console.log("\n  ⚠ Skipping update/verify (transaction not found by notes filter)");
  }

  // Get transactions by date range (actual_transactions_get)
  console.log("\nGetting transactions by date range (actual_transactions_get)...");
  {
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const getTxnsResult = await callTool("actual_transactions_get", {
      accountId: context.accountId,
      startDate: yearStart,
      endDate: today,
    });
    const getTxnsArr = Array.isArray(getTxnsResult) ? getTxnsResult
      : Array.isArray(getTxnsResult?.result) ? getTxnsResult.result : null;
    if (getTxnsArr !== null && getTxnsArr.length >= 1) {
      console.log(`  ✓ Verify get: returned ${getTxnsArr.length} transaction(s) for year-to-date`);
    } else if (getTxnsArr !== null && getTxnsArr.length === 0) {
      console.log(`  ⚠ Verify get: returned 0 transactions YTD (account may be empty before today)`);
    } else {
      console.log(`  ❌ Verify get: expected array, got ${JSON.stringify(getTxnsResult).slice(0, 120)}`);
    }
  }

  // Filter (with correct param name and count assertion)
  console.log("\nFiltering transactions for account...");
  const filteredTxns = await callTool("actual_transactions_filter", { accountId: context.accountId });
  const filteredArr = Array.isArray(filteredTxns) ? filteredTxns : (filteredTxns.result || []);
  if (filteredArr.length >= 1) console.log(`  ✓ Found ${filteredArr.length} transaction(s) for account`);
  else console.log("  ❌ Filter returned 0 transactions (expected at least 1 after create)");

  // Import (empty — tests the tool is callable and returns no errors)
  console.log("\nTesting transaction import (empty)...");
  const importResult = await callTool("actual_transactions_import", {
    accountId: context.accountId,
    txs: [],
  });
  const importErrors = importResult?.errors ?? importResult?.result?.errors ?? null;
  if (importErrors === null) {
    console.log("✓ Import test completed (no errors field to assert)");
  } else if (Array.isArray(importErrors) && importErrors.length === 0) {
    console.log("  ✓ Verify import: errors=[] (no import errors)");
  } else {
    console.log(`  ❌ Verify import: expected errors=[], got ${JSON.stringify(importErrors)}`);
  }

  console.log("  (Transaction deletion tested in cleanup phase)");
}
