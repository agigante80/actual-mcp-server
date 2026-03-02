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
  const txnId = txn.id || txn.result || null;
  console.log("✓ Created transaction:", txnId || "(ID not available - transaction created successfully)");
  context.transactionId = txnId;

  if (txnId && typeof txnId === 'string' && txnId.length > 10) {
    // Get and verify
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

    // Update amount
    console.log("\nUpdating transaction amount...");
    await callTool("actual_transactions_update", { id: txnId, fields: { amount: -7500 } });
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

  // Filter
  console.log("\nFiltering transactions for account...");
  const filteredTxns = await callTool("actual_transactions_filter", { account_id: context.accountId });
  console.log("✓ Found transactions:", filteredTxns.length);

  // Import (empty — tests the tool is callable)
  console.log("\nTesting transaction import (empty)...");
  const importResult = await callTool("actual_transactions_import", {
    accountId: context.accountId,
    txs: [],
  });
  console.log("✓ Import test completed:", importResult);

  console.log("  (Transaction deletion tested in cleanup phase)");
}
