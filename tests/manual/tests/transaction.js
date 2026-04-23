/**
 * tests/transaction.js
 *
 * TRANSACTION TESTS — create, get, update, filter, import.
 *
 * Reads from context:  accountId (logged for reference only — not used for API calls; txAccountId is created locally), payeeId (optional), categoryId (optional)
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

  // Create a dedicated on-budget account for transaction tests so they are not affected
  // by the offbudget=true flag set in the account regression test (account.js).
  // Do NOT write txAccountId to context — it is local to this test block.
  const txAcctName = `MCP-Tx-${timestamp}`;
  const txAcctResult = await callTool("actual_accounts_create", { name: txAcctName, balance: 0 });
  const txAccountId = txAcctResult.id || txAcctResult.result || txAcctResult;
  console.log(`\n  ✓ Created dedicated transaction test account: ${txAcctName} (${txAccountId})`);

  // Build create params, attaching optional payee / category from context
  const txnParams = {
    account: txAccountId,
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
    accountId: txAccountId,
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

  // T3: transactions_create with non-existent account UUID — API may reject or silently succeed
  // Note: Pre-flight account check was removed (caused API session mixing that broke writes)
  // Now relies on the Actual API to handle invalid accounts
  console.log("\nNEGATIVE T3: transactions_create with non-existent account UUID...");
  {
    const today = new Date().toISOString().split('T')[0];
    try {
      const badTxn = await callTool("actual_transactions_create", {
        account: '00000000-0000-0000-0000-000000000000',
        date: today,
        amount: -100,
        notes: `MCP-T3-neg-${timestamp}`,
      });
      if (badTxn?.success === false && typeof badTxn?.error === 'string') {
        console.log(`  ✓ T3: error returned for nil-UUID account: ${badTxn.error.slice(0, 120)}`);
      } else {
        console.log(`  ⚠ T3: unexpected response (API may have accepted nil UUID): ${JSON.stringify(badTxn).slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`  ✓ T3: API rejected nil-UUID account (threw): ${String(e).slice(0, 120)}`);
    }
  }

  // Get and update using the recovered ID
  if (context.transactionId) {
    console.log("\nUpdating transaction amount...");
    await callTool("actual_transactions_update", { id: context.transactionId, fields: { amount: -7500 } });
    console.log("✓ Transaction updated");

    // Verify update — re-filter by notes since there's no get-by-id tool
    const updateFilter = await callTool("actual_transactions_filter", {
      accountId: txAccountId,
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
      accountId: txAccountId,
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

  // FIXED(BUG-7): transactions_get with non-existent accountId now returns actionable error
  console.log("\nNEGATIVE T4: transactions_get with non-existent accountId...");
  {
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const badGet = await callTool("actual_transactions_get", {
      accountId: '00000000-0000-0000-0000-000000000000',
      startDate: yearStart,
      endDate: today,
    });
    if (typeof badGet?.error === 'string' && badGet.error.includes('not found') && badGet.error.includes('actual_accounts_list')) {
      console.log(`  ✓ FIXED(BUG-7): transactions_get nil-UUID returns actionable error: ${badGet.error.slice(0, 120)}`);
    } else if (typeof badGet?.error === 'string') {
      console.log(`  ⚠ T4: error returned but message not actionable: ${badGet.error.slice(0, 120)}`);
    } else {
      console.log(`  ⚠ T4: unexpected response: ${JSON.stringify(badGet).slice(0, 120)}`);
    }
  }

  // Filter (with correct param name and count assertion)
  console.log("\nFiltering transactions for account...");
  const filteredTxns = await callTool("actual_transactions_filter", { accountId: txAccountId });
  const filteredArr = Array.isArray(filteredTxns) ? filteredTxns : (filteredTxns.result || []);
  if (filteredArr.length >= 1) console.log(`  ✓ Found ${filteredArr.length} transaction(s) for account`);
  else console.log("  ❌ Filter returned 0 transactions (expected at least 1 after create)");

  // Import with real data — import one transaction then read it back (T6)
  console.log("\nTesting transaction import (with data — T6 read-back)...");
  const importDate = new Date().toISOString().split('T')[0];
  const importAmount = -3300; // -$33.00, distinctive value
  const importNotes = `MCP-Import-${timestamp}`;
  const importResult = await callTool("actual_transactions_import", {
    accountId: txAccountId,
    txs: [
      {
        date: importDate,
        amount: importAmount,
        notes: importNotes,
      },
    ],
  });
  const importErrors = importResult?.errors ?? importResult?.result?.errors ?? null;
  if (importErrors === null) {
    console.log("✓ Import call completed (errors field not present)");
  } else if (Array.isArray(importErrors) && importErrors.length === 0) {
    console.log("  ✓ Verify import: errors=[] (no import errors)");
  } else {
    console.log(`  ❌ Verify import: expected errors=[], got ${JSON.stringify(importErrors)}`);
  }

  // T6: read-back — confirm imported transaction is present
  {
    const afterImport = await callTool("actual_transactions_filter", {
      accountId: txAccountId,
      notes: importNotes,
    });
    const afterArr = Array.isArray(afterImport) ? afterImport : (afterImport.result || []);
    const imported = afterArr.find(t => t.notes === importNotes && t.amount === importAmount);
    if (imported) {
      console.log(`  ✓ T6 Verify import read-back: found imported txn id="${imported.id}" amount=${imported.amount}`);
      // Delete the imported transaction so it doesn't pollute the account
      try {
        await callTool("actual_transactions_delete", { id: imported.id });
        console.log(`  ✓ Cleaned up imported transaction`);
      } catch (_) { /* best effort */ }
    } else if (afterArr.length >= 1) {
      console.log(`  ⚠ T6 Verify import read-back: ${afterArr.length} txn(s) found but none matched notes+amount (may be deduplicated)`);
    } else {
      console.log(`  ❌ T6 Verify import read-back: no transactions found after import`);
    }
  }

  // transactions_delete — negative UUID test then real delete + verify
  // NOTE(BUG-8): actual_transactions_delete with nil-UUID returns {success:true} — this is a known Actual API limitation.
  // The API does not distinguish between a successful delete and a no-op. See tool description for details.
  console.log("\nTesting transactions_delete (negative UUID)...");
  {
    const nilResult = await callTool("actual_transactions_delete", {
      id: '00000000-0000-0000-0000-000000000000',
    });
    // This is expected to return { success: true } — Actual's CRDT store accepts the operation silently
    if (nilResult?.success === true) {
      console.log("  ✓ NOTE(BUG-8): transactions_delete nil-UUID returns success:true (known API limitation — CRDT no-op)");
    } else {
      console.log("  ⚠ Unexpected response for nil-UUID delete:", JSON.stringify(nilResult).slice(0, 120));
    }
  }

  if (context.transactionId) {
    console.log("\nDeleting test transaction...");
    try {
      await callTool("actual_transactions_delete", { id: context.transactionId });
      console.log("✓ Delete call completed");

      // Verify deletion
      const afterDelete = await callTool("actual_transactions_filter", {
        accountId: txAccountId,
        notes: `MCP-Transaction-${timestamp}`,
      });
      const afterArr = Array.isArray(afterDelete) ? afterDelete : (afterDelete.result || []);
      const stillExists = afterArr.find(t => t.id === context.transactionId);
      if (stillExists) {
        console.log("  ❌ Verify delete: transaction still present in filter results");
      } else {
        console.log("  ✓ Verify delete: transaction no longer in filter results");
        context.transactionId = null;
      }
    } catch (err) {
      console.log("  ❌ Delete threw unexpectedly:", err.message?.slice(0, 120));
    }
  } else {
    console.log("  ⚠ Skipping delete (no transactionId in context)");
  }

  // ── actual_transactions_uncategorized tests ───────────────────────────────
  console.log("\n--- actual_transactions_uncategorized ---");

  // Positive — summary only (default mode)
  {
    const summary = await callTool("actual_transactions_uncategorized", {});
    if (typeof summary?.totalCount !== 'number') {
      console.log("  ❌ summary: totalCount not a number");
    } else if (typeof summary?.totalAmount !== 'number') {
      console.log("  ❌ summary: totalAmount not a number");
    } else if (!Array.isArray(summary?.byAccount)) {
      console.log("  ❌ summary: byAccount not an array");
    } else if ('transactions' in summary) {
      console.log("  ❌ summary: transactions key must be absent by default");
    } else {
      console.log(`  ✓ summary: totalCount=${summary.totalCount}, byAccount entries=${summary.byAccount.length}, transactions absent`);
    }
  }

  // Positive — with transactions (includeTransactions:true)
  {
    const listResult = await callTool("actual_transactions_uncategorized", {
      includeTransactions: true,
      limit: 5,
    });
    if (!Array.isArray(listResult?.transactions)) {
      console.log("  ❌ list: transactions not an array");
    } else if (typeof listResult?.hasMore !== 'boolean') {
      console.log("  ❌ list: hasMore not a boolean");
    } else if ((listResult?.transactions ?? []).length > 5) {
      console.log("  ❌ list: returned more than limit:5 transactions");
    } else {
      console.log(`  ✓ list: ${listResult.transactions.length} transactions returned, hasMore=${listResult.hasMore}`);
    }
  }

  // Negative — non-existent accountId → totalCount:0, byAccount:[]
  {
    const nilId = '00000000-0000-0000-0000-000000000000';
    const nilResult = await callTool("actual_transactions_uncategorized", { accountId: nilId });
    if (nilResult?.totalCount !== 0) {
      console.log(`  ❌ negative accountId: expected totalCount:0, got ${nilResult?.totalCount}`);
    } else if (!Array.isArray(nilResult?.byAccount) || nilResult.byAccount.length !== 0) {
      console.log("  ❌ negative accountId: expected byAccount:[]");
    } else {
      console.log("  ✓ negative accountId: totalCount:0 and byAccount:[] as expected");
    }
  }

  // Teardown: close then delete the dedicated transaction test account.
  // close() must come first — Actual tombstones (hard-deletes) accounts with zero
  // transactions on close(), making them unrecoverable. We need close() to set
  // closed=1 before delete() removes the record cleanly.
  try {
    await callTool("actual_accounts_close", { id: txAccountId });
    await callTool("actual_accounts_delete", { id: txAccountId });
    console.log(`\n  ✓ Cleaned up transaction test account (${txAccountId})`);
  } catch (err) {
    console.log(`\n  ⚠ Teardown: could not clean up transaction test account (${txAccountId}): ${err.message?.slice(0, 120)}`);
  }
}
