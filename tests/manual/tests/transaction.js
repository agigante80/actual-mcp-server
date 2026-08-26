import { fail } from '../assert.js';
/**
 * tests/transaction.js
 *
 * TRANSACTION TESTS: create, get, update, filter, import.
 *
 * Reads from context:  accountId (logged for reference only: not used for API calls; txAccountId is created locally), payeeId (optional), categoryId (optional)
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
  // Do NOT write txAccountId to context: it is local to this test block.
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

  // actual_transactions_create does not return an ID: locate it by notes filter
  console.log("\nVerifying create: searching by notes...");
  const noteFilter = await callTool("actual_transactions_filter", {
    accountId: txAccountId,
    notes: `MCP-Transaction-${timestamp}`,
  });
  const noteResults = Array.isArray(noteFilter) ? noteFilter : (noteFilter.result || []);
  const createdTxn = noteResults.find(t => t.notes === `MCP-Transaction-${timestamp}`);
  if (!createdTxn) {
    fail("Verify create: transaction not found by notes filter");
  } else {
    context.transactionId = createdTxn.id;
    console.log(`  ✓ Verify create: found id="${createdTxn.id}"`);
    if (createdTxn.amount === -5000) console.log(`  ✓ Verify create: amount=${createdTxn.amount} (-$50.00)`);
    else fail(`Verify create: expected amount -5000, got ${createdTxn.amount}`);
    if (context.categoryId) {
      if (createdTxn.category === context.categoryId) console.log(`  ✓ Verify create: category="${createdTxn.category}"`);
      else fail(`Verify create: expected category "${context.categoryId}", got "${createdTxn.category}"`);
    }
  }

  // T3: transactions_create with non-existent account UUID: API may reject or silently succeed
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

    // Verify update: re-filter by notes since there's no get-by-id tool
    const updateFilter = await callTool("actual_transactions_filter", {
      accountId: txAccountId,
      notes: `MCP-Transaction-${timestamp}`,
    });
    const updateResults = Array.isArray(updateFilter) ? updateFilter : (updateFilter.result || []);
    const updatedTxn = updateResults.find(t => t.id === context.transactionId);
    if (!updatedTxn) {
      fail("Verify update: transaction not found by notes filter after update");
    } else if (updatedTxn.amount === -7500) {
      console.log(`  ✓ Verify update: amount=${updatedTxn.amount} (-$75.00)`);
    } else {
      fail(`Verify update: expected amount -7500, got ${updatedTxn.amount}`);
    }

    // FIXED(#212): update / update_batch must surface a non-existent id, not report success.
    console.log("\nNEGATIVE (#212): transactions_update with a non-existent id...");
    try {
      const nilUpd = await callTool("actual_transactions_update", {
        id: '00000000-0000-0000-0000-000000000000',
        fields: { notes: 'repro-212' },
      });
      console.log("  ⚠ Expected a not-found error but tool returned:", JSON.stringify(nilUpd).slice(0, 120));
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('actual_transactions_get')) {
        console.log(`  ✓ FIXED(#212): transactions_update nil-id throws actionable error: ${msg.slice(0, 120)}`);
      } else {
        console.log(`  ⚠ Error thrown but message not actionable: ${msg.slice(0, 120)}`);
      }
    }

    console.log("\nNEGATIVE (#212): update_batch with a valid + non-existent id...");
    {
      const batch = await callTool("actual_transactions_update_batch", { updates: [
        { id: context.transactionId, fields: { notes: `MCP-Transaction-${timestamp}` } },
        { id: '00000000-0000-0000-0000-000000000000', fields: { notes: 'repro-212' } },
      ] });
      const isolated = batch?.successCount === 1 && batch?.failureCount === 1 &&
        (batch.failed || []).some(f => f.id === '00000000-0000-0000-0000-000000000000' && /not found/.test(f.error || ''));
      if (isolated) console.log("  ✓ FIXED(#212): update_batch routes the non-existent id into failed[] with a not-found message");
      else console.log("  ⚠ update_batch did not isolate the non-existent id:", JSON.stringify(batch).slice(0, 160));
    }
  } else {
    console.log("\n  ⚠ Skipping update/verify (transaction not found by notes filter)");
  }

  // #305: split-transaction create + edit-existing-split + negatives.
  console.log("\n[#305] Split transactions...");
  {
    const today = new Date().toISOString().split('T')[0];
    const splitNotes = `MCP-Split-${timestamp}`;
    const readParent = async () => {
      const got = await callTool("actual_transactions_get", { accountId: txAccountId, startDate: today, endDate: today });
      const rows = got.transactions || got.result || (Array.isArray(got) ? got : []);
      return rows.find(t => t.is_parent === true && (t.notes || '').includes(splitNotes));
    };

    await callTool("actual_transactions_create", {
      account: txAccountId, date: today, amount: -3000, notes: splitNotes,
      subtransactions: [{ amount: -2000 }, { amount: -1000 }],
    });
    const parent = await readParent();
    if (!parent) {
      fail("Verify split create: is_parent transaction not found");
    } else {
      const subs = parent.subtransactions || [];
      const sum = subs.reduce((a, s) => a + s.amount, 0);
      if (subs.length === 2 && sum === -3000) console.log(`  ✓ Split created: 2 children summing to ${sum}`);
      else fail(`Verify split create: expected 2 children summing to -3000, got ${subs.length} summing to ${sum}`);

      // Edit the existing split's children (only amount needed; account/date derived).
      await callTool("actual_transactions_update", { id: parent.id, fields: { subtransactions: [{ amount: -2500 }, { amount: -500 }] } });
      const edited = await readParent();
      const editedSubs = (edited && edited.subtransactions) || [];
      const editedSum = editedSubs.reduce((a, s) => a + s.amount, 0);
      if (editedSubs.length === 2 && editedSum === -3000) console.log(`  ✓ Split edited: children now [${editedSubs.map(s => s.amount).join(', ')}]`);
      else fail(`Verify split edit: expected 2 children summing to -3000, got ${editedSubs.length} summing to ${editedSum}`);
    }

    // NEGATIVE: children do not sum to the parent amount (rejected before the write).
    try {
      await callTool("actual_transactions_create", { account: txAccountId, date: today, amount: -3000, notes: `${splitNotes}-bad`, subtransactions: [{ amount: -2000 }, { amount: -500 }] });
      console.log("  ⚠ Expected a sum-mismatch rejection on create but it succeeded");
    } catch (err) {
      if (/sum to the parent amount/i.test(err.message || '')) console.log("  ✓ NEGATIVE: mismatched split sum rejected on create");
      else console.log(`  ⚠ create rejected but message unexpected: ${(err.message || '').slice(0, 120)}`);
    }

    // NEGATIVE: subtransactions on a plain (non-split) target is rejected (no plain-to-split conversion).
    if (context.transactionId) {
      try {
        await callTool("actual_transactions_update", { id: context.transactionId, fields: { subtransactions: [{ amount: -3750 }, { amount: -3750 }] } });
        console.log("  ⚠ Expected a non-split rejection but update succeeded");
      } catch (err) {
        if (/not a split/i.test(err.message || '')) console.log("  ✓ NEGATIVE: subtransactions on a plain transaction rejected");
        else console.log(`  ⚠ update rejected but message unexpected: ${(err.message || '').slice(0, 120)}`);
      }
    }

    // Delete the split we created. Without this the parent's -3000 stays on the
    // books, the account teardown below fails with "balance is non-zero:
    // transferAccountId is required", the account survives as OPEN residue, and
    // the zero-residue assertion exits 3 before the stdio half of the gate ever
    // runs. Deleting the parent removes its children with it.
    const leftover = await readParent();
    if (leftover) {
      try {
        await callTool("actual_transactions_delete", { id: leftover.id });
        const gone = await readParent();
        if (gone) fail("Split teardown: parent still present after delete (account balance will not return to zero)");
        else console.log("  ✓ Split teardown: parent and children deleted, balance back to zero");
      } catch (err) {
        fail(`Split teardown: could not delete split parent: ${(err.message || '').slice(0, 120)}`);
      }
    }
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
      fail(`Verify get: expected array, got ${JSON.stringify(getTxnsResult).slice(0, 120)}`);
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
  else fail("Filter returned 0 transactions (expected at least 1 after create)");

  // Import with real data: import one transaction then read it back (T6)
  console.log("\nTesting transaction import (with data: T6 read-back)...");
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
    fail(`Verify import: expected errors=[], got ${JSON.stringify(importErrors)}`);
  }

  // T6: read-back: confirm imported transaction is present
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
      fail(`T6 Verify import read-back: no transactions found after import`);
    }
  }

  // transactions_delete: negative UUID test then real delete + verify.
  // FIXED(BUG-8): actual_transactions_delete with a non-existent id now throws an
  // actionable "not found" error. The adapter pre-flights existence with a targeted
  // ActualQL query, since the raw Actual API silently no-ops (CRDT) and would otherwise
  // report success for a delete that removed nothing.
  console.log("\nTesting transactions_delete (negative UUID)...");
  {
    try {
      const nilResult = await callTool("actual_transactions_delete", {
        id: '00000000-0000-0000-0000-000000000000',
      });
      console.log("  ⚠ Expected a not-found error but tool returned:", JSON.stringify(nilResult).slice(0, 120));
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('actual_transactions_get')) {
        console.log(`  ✓ FIXED(BUG-8): transactions_delete nil-UUID throws actionable error: ${msg.slice(0, 120)}`);
      } else {
        console.log(`  ⚠ Error thrown but message not actionable: ${msg.slice(0, 120)}`);
      }
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
        fail("Verify delete: transaction still present in filter results");
      } else {
        console.log("  ✓ Verify delete: transaction no longer in filter results");
        context.transactionId = null;
      }
    } catch (err) {
      fail(["Delete threw unexpectedly:", err.message?.slice(0, 120)].map(String).join(" "));
    }
  } else {
    console.log("  ⚠ Skipping delete (no transactionId in context)");
  }

  // ── actual_transactions_uncategorized tests ───────────────────────────────
  console.log("\n--- actual_transactions_uncategorized ---");

  // Positive: summary only (default mode)
  {
    const summary = await callTool("actual_transactions_uncategorized", {});
    if (typeof summary?.totalCount !== 'number') {
      fail("summary: totalCount not a number");
    } else if (typeof summary?.totalAmount !== 'number') {
      fail("summary: totalAmount not a number");
    } else if (!Array.isArray(summary?.byAccount)) {
      fail("summary: byAccount not an array");
    } else if ('transactions' in summary) {
      fail("summary: transactions key must be absent by default");
    } else {
      console.log(`  ✓ summary: totalCount=${summary.totalCount}, byAccount entries=${summary.byAccount.length}, transactions absent`);
    }
  }

  // Positive: with transactions (includeTransactions:true)
  {
    const listResult = await callTool("actual_transactions_uncategorized", {
      includeTransactions: true,
      limit: 5,
    });
    if (!Array.isArray(listResult?.transactions)) {
      fail("list: transactions not an array");
    } else if (typeof listResult?.hasMore !== 'boolean') {
      fail("list: hasMore not a boolean");
    } else if ((listResult?.transactions ?? []).length > 5) {
      fail("list: returned more than limit:5 transactions");
    } else {
      console.log(`  ✓ list: ${listResult.transactions.length} transactions returned, hasMore=${listResult.hasMore}`);
    }
  }

  // Negative: non-existent accountId → totalCount:0, byAccount:[]
  {
    const nilId = '00000000-0000-0000-0000-000000000000';
    const nilResult = await callTool("actual_transactions_uncategorized", { accountId: nilId });
    if (nilResult?.totalCount !== 0) {
      fail(`negative accountId: expected totalCount:0, got ${nilResult?.totalCount}`);
    } else if (!Array.isArray(nilResult?.byAccount) || nilResult.byAccount.length !== 0) {
      fail("negative accountId: expected byAccount:[]");
    } else {
      console.log("  ✓ negative accountId: totalCount:0 and byAccount:[] as expected");
    }
  }

  // ── TRANSFERS (#366): actual_transfers_create had NO integration coverage ─────
  //
  // It had a unit test and nothing else. The only E2E reference lived in
  // tests/e2e/suites/transactions.ts, which never executes, and that call passes
  // `fromAccount`/`toAccount` while the schema requires `from_account`/`to_account`, so it
  // would have been rejected by Zod on its first run. This block is the real coverage.
  {
    console.log("\n-- Transfers --");
    const destName = `MCP-Tx-Dest-${timestamp}`;
    const destResult = await callTool("actual_accounts_create", { name: destName, balance: 0 });
    const destAccountId = destResult?.result ?? destResult?.id ?? destResult;

    if (typeof destAccountId !== "string") {
      fail(`transfers: could not create a destination account (got ${JSON.stringify(destResult)?.slice(0, 80)})`);
    } else {
      try {
        const transferAmount = 1234;
        const transferDate = new Date().toISOString().slice(0, 10);

        // The uncategorized count must not move: a transfer is not a spending gap (#119).
        const uncatBefore = await callTool("actual_transactions_uncategorized", {});
        const countBefore = uncatBefore?.totalCount ?? 0;

        const created = await callTool("actual_transfers_create", {
          from_account: txAccountId,
          to_account: destAccountId,
          amount: transferAmount,
          date: transferDate,
        });
        const transfer = created?.result ?? created;

        if (transfer?.success !== true) {
          fail(`transfers: create did not report success (got ${JSON.stringify(transfer)?.slice(0, 120)})`);
        } else {
          console.log("  ✓ transfers: create reported success");
        }

        // Both legs must exist, with opposite signs, on their own accounts.
        const fromTxns = await callTool("actual_transactions_get", { accountId: txAccountId });
        const toTxns = await callTool("actual_transactions_get", { accountId: destAccountId });
        const fromList = fromTxns?.result ?? fromTxns ?? [];
        const toList = toTxns?.result ?? toTxns ?? [];
        const debit = (Array.isArray(fromList) ? fromList : []).find(
          (t) => t?.amount === -transferAmount && t?.date === transferDate,
        );
        const credit = (Array.isArray(toList) ? toList : []).find(
          (t) => t?.amount === transferAmount && t?.date === transferDate,
        );

        if (!debit) {
          fail(`transfers: no -${transferAmount} leg on the source account`);
        } else if (!credit) {
          fail(`transfers: no +${transferAmount} leg on the destination account`);
        } else {
          console.log(`  ✓ transfers: both legs present (-${transferAmount} out, +${transferAmount} in)`);
          // Paired, not two unrelated transactions. This is what distinguishes a transfer.
          if (!debit.transfer_id || !credit.transfer_id) {
            fail("transfers: legs are not linked (transfer_id missing on one or both sides)");
          } else if (debit.transfer_id !== credit.id || credit.transfer_id !== debit.id) {
            fail(`transfers: legs are linked to the wrong rows (debit.transfer_id=${debit.transfer_id}, credit.id=${credit.id})`);
          } else {
            console.log("  ✓ transfers: the two legs reference each other via transfer_id");
          }
        }

        const uncatAfter = await callTool("actual_transactions_uncategorized", {});
        const countAfter = uncatAfter?.totalCount ?? 0;
        if (countAfter !== countBefore) {
          fail(`transfers [#119]: transfer changed the uncategorized count (before=${countBefore}, after=${countAfter})`);
        } else {
          console.log(`  ✓ transfers [#119]: uncategorized count unchanged (${countBefore})`);
        }

        // Negative cases. NOTE THE CONTRACT: adapter.createTransfer returns a structured
        // { success: false, error } for these; it does NOT throw. That differs from the
        // #350 tools, which throw on a refusal, and the divergence is tracked in #371.
        // Asserting a throw here would assert the wrong contract and fail against correct
        // code, which is exactly what the first version of this block did.
        const refusal = async (args, label, pattern) => {
          let res;
          try {
            res = await callTool("actual_transfers_create", args);
          } catch (err) {
            // A throw is also a refusal; accept it, but only for the right reason.
            const msg = err?.message ?? String(err);
            if (!pattern.test(msg)) fail(`transfers: ${label} threw for the wrong reason: ${msg.slice(0, 120)}`);
            else console.log(`  ✓ transfers: ${label} (thrown)`);
            return;
          }
          const payload = res?.result ?? res;
          if (payload?.success !== false) {
            fail(`transfers: ${label} was ACCEPTED (got ${JSON.stringify(payload)?.slice(0, 120)})`);
          } else if (!pattern.test(String(payload?.error ?? ""))) {
            fail(`transfers: ${label} refused for the wrong reason: ${String(payload?.error).slice(0, 120)}`);
          } else {
            console.log(`  ✓ transfers: ${label}`);
          }
        };

        await refusal(
          { from_account: txAccountId, to_account: txAccountId, amount: 100, date: transferDate },
          "same-account transfer refused",
          /different accounts/i,
        );
        await refusal(
          { from_account: txAccountId, to_account: "00000000-0000-0000-0000-000000000000", amount: 100, date: transferDate },
          "transfer to an unknown account refused",
          /not found/i,
        );

        // Negative: a non-positive amount is a schema error, not a zero-value transfer.
        try {
          await callTool("actual_transfers_create", {
            from_account: txAccountId,
            to_account: destAccountId,
            amount: 0,
            date: transferDate,
          });
          fail("transfers: a zero amount was accepted");
        } catch {
          console.log("  ✓ transfers: zero amount rejected by the schema");
        }
      } finally {
        // Zero residue, and it needs care since v0.12.0. The transfer leaves the SOURCE
        // account with a non-zero balance, and actual_accounts_close now correctly refuses
        // to close such an account without a transferAccountId (#357). The module teardown
        // below is close-then-delete, so leaving the balance behind made the whole run fail
        // its zero-residue assertion. Remove the debit leg here to put the source account
        // back at zero, then drop the destination account and its credit leg with it.
        try {
          const srcTxns = await callTool("actual_transactions_get", { accountId: txAccountId });
          const srcList = srcTxns?.result ?? srcTxns ?? [];
          for (const t of Array.isArray(srcList) ? srcList : []) {
            if (t?.amount === -1234) {
              await callTool("actual_transactions_delete", { id: t.id });
            }
          }
          await callTool("actual_accounts_delete", { id: destAccountId });
          console.log(`  ✓ transfers: cleaned up, source account back to a zero balance`);
        } catch (err) {
          console.log(`  ⚠ transfers: could not clean up: ${err.message?.slice(0, 120)}`);
        }
      }
    }
  }

  // Teardown: close then delete the dedicated transaction test account.
  // close() must come first: Actual tombstones (hard-deletes) accounts with zero
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
