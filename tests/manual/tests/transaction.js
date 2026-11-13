import { fail, skip } from '../assert.js';
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
    skip("No account ID: skipping transaction tests");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Create a dedicated on-budget account for transaction tests so they are not affected
  // by the offbudget=true flag set in the account regression test (account.js).
  // Do NOT write txAccountId to context: it is local to this test block.
  const txAcctName = `MCP-Tx-${timestamp}`;
  const txAcctResult = await callTool("manage_accounts", { action: "create", entity: "account", name: txAcctName, balance: 0 });
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
  const txn = await callTool("manage_transactions", { action: "create", ...txnParams });
  console.log("✓ Created transaction (finding via notes filter...)");

  // manage_transactions create does not return an ID: locate it by notes filter
  console.log("\nVerifying create: searching by notes...");
  const noteFilter = await callTool("search_transactions", {
    by: "filter",
    account_id: txAccountId,
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
      const badTxn = await callTool("manage_transactions", {
        action: "create",
        account: '00000000-0000-0000-0000-000000000000',
        date: today,
        amount: -100,
        notes: `MCP-T3-neg-${timestamp}`,
      });
      if (badTxn?.success === false && typeof badTxn?.error === 'string') {
        console.log(`  ✓ T3: error returned for nil-UUID account: ${badTxn.error.slice(0, 120)}`);
      } else {
        fail(`T3: unexpected response, the API may have accepted the nil UUID: ${JSON.stringify(badTxn).slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`  ✓ T3: API rejected nil-UUID account (threw): ${String(e).slice(0, 120)}`);
    }
  }

  // Get and update using the recovered ID
  if (context.transactionId) {
    console.log("\nUpdating transaction amount...");
    await callTool("manage_transactions", { action: "update", id: context.transactionId, amount: -7500 });
    console.log("✓ Transaction updated");

    // Verify update: re-filter by notes since there's no get-by-id tool
    const updateFilter = await callTool("search_transactions", {
      by: "filter",
      account_id: txAccountId,
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
      const nilUpd = await callTool("manage_transactions", {
        action: "update",
        id: '00000000-0000-0000-0000-000000000000',
        notes: 'repro-212',
      });
      fail(`Expected a not-found error but the tool returned: ${JSON.stringify(nilUpd).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('search_transactions account')) {
        console.log(`  ✓ FIXED(#212): transactions_update nil-id throws actionable error: ${msg.slice(0, 120)}`);
      } else {
        fail(`Threw, but the message is not actionable: ${msg.slice(0, 120)}`);
      }
    }

    console.log("\nNEGATIVE (#212): update_batch with a valid + non-existent id...");
    {
      const batch = await callTool("manage_transactions", { action: "update_batch", updates: [
        { id: context.transactionId, fields: { notes: `MCP-Transaction-${timestamp}` } },
        { id: '00000000-0000-0000-0000-000000000000', fields: { notes: 'repro-212' } },
      ] });
      const isolated = batch?.successCount === 1 && batch?.failureCount === 1 &&
        (batch.failed || []).some(f => f.id === '00000000-0000-0000-0000-000000000000' && /not found/.test(f.error || ''));
      if (isolated) console.log("  ✓ FIXED(#212): update_batch routes the non-existent id into failed[] with a not-found message");
      else fail(`update_batch did not isolate the non-existent id: ${JSON.stringify(batch).slice(0, 160)}`);
    }
  } else {
    fail("Skipping update/verify: the transaction this module just created was not found by its own notes filter, so the steps that follow never ran.");
  }

  // #305: split-transaction create + edit-existing-split + negatives.
  console.log("\n[#305] Split transactions...");
  {
    const today = new Date().toISOString().split('T')[0];
    const splitNotes = `MCP-Split-${timestamp}`;
    const readParent = async () => {
      const got = await callTool("search_transactions", { by: "account", account_id: txAccountId, start_date: today, end_date: today });
      const rows = got.transactions || got.result || (Array.isArray(got) ? got : []);
      return rows.find(t => t.is_parent === true && (t.notes || '').includes(splitNotes));
    };

    await callTool("manage_transactions", {
      action: "create",
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
      await callTool("manage_transactions", { action: "update", id: parent.id, subtransactions: [{ amount: -2500 }, { amount: -500 }] });
      const edited = await readParent();
      const editedSubs = (edited && edited.subtransactions) || [];
      const editedSum = editedSubs.reduce((a, s) => a + s.amount, 0);
      if (editedSubs.length === 2 && editedSum === -3000) console.log(`  ✓ Split edited: children now [${editedSubs.map(s => s.amount).join(', ')}]`);
      else fail(`Verify split edit: expected 2 children summing to -3000, got ${editedSubs.length} summing to ${editedSum}`);
    }

    // NEGATIVE: children do not sum to the parent amount (rejected before the write).
    try {
      await callTool("manage_transactions", { action: "create", account: txAccountId, date: today, amount: -3000, notes: `${splitNotes}-bad`, subtransactions: [{ amount: -2000 }, { amount: -500 }] });
      fail("Expected a sum-mismatch rejection on create but it succeeded");
    } catch (err) {
      if (/sum to the parent amount/i.test(err.message || '')) console.log("  ✓ NEGATIVE: mismatched split sum rejected on create");
      else fail(`create rejected, but with an unexpected message: ${(err.message || '').slice(0, 120)}`);
    }

    // #489: subtransactions on a PLAIN transaction split it IN PLACE: same id, the parent becomes
    // a split, the children are the ones requested. A dedicated transaction with its own notes
    // marker, so the conversion cannot disturb context.transactionId, and it is deleted here
    // (deleting a parent removes its children) so the account still returns to a zero balance.
    {
      const plainNotes = `MCP-PlainToSplit-${timestamp}`;
      const readPlain = async () => {
        const got = await callTool("search_transactions", { by: "account", account_id: txAccountId, start_date: today, end_date: today });
        const rows = got.transactions || got.result || (Array.isArray(got) ? got : []);
        return rows.find(t => !t.parent_id && (t.notes || '') === plainNotes);
      };
      await callTool("manage_transactions", { action: "create", account: txAccountId, date: today, amount: -4000, notes: plainNotes });
      const plain = await readPlain();
      if (!plain) {
        fail("Plain-to-split: the plain transaction was not found after create");
      } else {
        try {
          // NEGATIVE first: a sum mismatch is refused and leaves the transaction plain.
          try {
            await callTool("manage_transactions", { action: "update", id: plain.id, subtransactions: [{ amount: -3000 }, { amount: -500 }] });
            fail("Plain-to-split: a mismatched sum was accepted");
          } catch (err) {
            if (/sum to the parent amount/i.test(err.message || '')) console.log("  ✓ NEGATIVE: mismatched split sum rejected on a plain target");
            else fail(`Plain-to-split: rejected with an unexpected message: ${(err.message || '').slice(0, 120)}`);
          }
          const res = await callTool("manage_transactions", { action: "update", id: plain.id, subtransactions: [{ amount: -2500 }, { amount: -1500 }] });
          const after = await readPlain();
          const kids = (after && after.subtransactions) || [];
          const kidSum = kids.reduce((n, c) => n + c.amount, 0);
          if (after && after.id === plain.id && after.is_parent === true && kids.length === 2 && kidSum === -4000
              && res && res.split && res.split.parent === plain.id) {
            console.log("  ✓ Plain-to-split: same id, now a split with 2 children summing to -4000");
          } else {
            fail(`Plain-to-split: expected the same id as a split with 2 children, got ${JSON.stringify({ id: after && after.id, is_parent: after && after.is_parent, kids: kids.length, kidSum, split: res && res.split })}`);
          }
        } finally {
          try { await callTool("manage_transactions", { action: "delete", id: plain.id }); }
          catch (err) { fail(`Plain-to-split teardown: ${(err.message || '').slice(0, 120)}`); }
        }
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
        await callTool("manage_transactions", { action: "delete", id: leftover.id });
        const gone = await readParent();
        if (gone) fail("Split teardown: parent still present after delete (account balance will not return to zero)");
        else console.log("  ✓ Split teardown: parent and children deleted, balance back to zero");
      } catch (err) {
        fail(`Split teardown: could not delete split parent: ${(err.message || '').slice(0, 120)}`);
      }
    }
  }

  // Get transactions by date range (search_transactions account)
  console.log("\nGetting transactions by date range (search_transactions account)...");
  {
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const getTxnsResult = await callTool("search_transactions", {
      by: "account",
      account_id: txAccountId,
      start_date: yearStart,
      end_date: today,
    });
    const getTxnsArr = Array.isArray(getTxnsResult) ? getTxnsResult
      : Array.isArray(getTxnsResult?.result) ? getTxnsResult.result : null;
    if (getTxnsArr !== null && getTxnsArr.length >= 1) {
      console.log(`  ✓ Verify get: returned ${getTxnsArr.length} transaction(s) for year-to-date`);
    } else if (getTxnsArr !== null && getTxnsArr.length === 0) {
      fail("Verify get: returned 0 transactions year-to-date, but this module created one earlier in the run, so the account cannot legitimately be empty.");
    } else {
      fail(`Verify get: expected array, got ${JSON.stringify(getTxnsResult).slice(0, 120)}`);
    }
  }

  // FIXED(BUG-7), then changed by #388: transactions_get with a non-existent accountId used to
  // RETURN `{ error }` and now THROWS a typed refusal, per #377's taxonomy (does-not-exist
  // throws). The assertion moved with it. Left as-is it would have gone on printing a warning
  // about an "unexpected response" while the tool worked correctly, and the run would still have
  // passed, which is #387.
  console.log("\nNEGATIVE T4: transactions_get with non-existent accountId...");
  {
    const today = new Date().toISOString().split('T')[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    try {
      const badGet = await callTool("search_transactions", {
        by: "account",
        account_id: '00000000-0000-0000-0000-000000000000',
        start_date: yearStart,
        end_date: today,
      });
      // #281's ledger, not a warning. Both branches below used to print and move on, so BUG-7
      // was only ever "observed", never asserted: the tool could have regressed to returning an
      // empty result and the release gate would still have gone green. That is #387 in miniature,
      // and it is cheap to close here even though the general fix is not.
      fail(`T4: expected a not-found refusal but tool returned: ${JSON.stringify(badGet).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('list_entities with type account')) {
        console.log(`  ✓ FIXED(BUG-7): transactions_get nil-UUID throws an actionable refusal: ${msg.slice(0, 120)}`);
      } else {
        fail(`T4: threw but the message is not actionable: ${msg.slice(0, 120)}`);
      }
    }
  }

  // Filter (with correct param name and count assertion)
  console.log("\nFiltering transactions for account...");
  const filteredTxns = await callTool("search_transactions", { by: "filter", account_id: txAccountId });
  const filteredArr = Array.isArray(filteredTxns) ? filteredTxns : (filteredTxns.result || []);
  if (filteredArr.length >= 1) console.log(`  ✓ Found ${filteredArr.length} transaction(s) for account`);
  else fail("Filter returned 0 transactions (expected at least 1 after create)");

  // Import with real data: import one transaction then read it back (T6)
  console.log("\nTesting transaction import (with data: T6 read-back)...");
  const importDate = new Date().toISOString().split('T')[0];
  const importAmount = -3300; // -$33.00, distinctive value
  const importNotes = `MCP-Import-${timestamp}`;
  const importResult = await callTool("manage_transactions", {
    action: "import",
    account_id: txAccountId,
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
    const afterImport = await callTool("search_transactions", {
      by: "filter",
      account_id: txAccountId,
      notes: importNotes,
    });
    const afterArr = Array.isArray(afterImport) ? afterImport : (afterImport.result || []);
    const imported = afterArr.find(t => t.notes === importNotes && t.amount === importAmount);
    if (imported) {
      console.log(`  ✓ T6 Verify import read-back: found imported txn id="${imported.id}" amount=${imported.amount}`);
      // Delete the imported transaction so it doesn't pollute the account
      try {
        await callTool("manage_transactions", { action: "delete", id: imported.id });
        console.log(`  ✓ Cleaned up imported transaction`);
      } catch (_) { /* best effort */ }
    } else if (afterArr.length >= 1) {
      fail(`T6 Verify import read-back: ${afterArr.length} transaction(s) found but none matched notes+amount. The notes carry a run timestamp, so deduplication cannot explain it.`);
    } else {
      fail(`T6 Verify import read-back: no transactions found after import`);
    }
  }

  // transactions_delete: negative UUID test then real delete + verify.
  // FIXED(BUG-8): manage_transactions delete with a non-existent id now throws an
  // actionable "not found" error. The adapter pre-flights existence with a targeted
  // ActualQL query, since the raw Actual API silently no-ops (CRDT) and would otherwise
  // report success for a delete that removed nothing.
  console.log("\nTesting transactions_delete (negative UUID)...");
  {
    try {
      const nilResult = await callTool("manage_transactions", {
        action: "delete",
        id: '00000000-0000-0000-0000-000000000000',
      });
      fail(`Expected a not-found error but the tool returned: ${JSON.stringify(nilResult).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('search_transactions account')) {
        console.log(`  ✓ FIXED(BUG-8): transactions_delete nil-UUID throws actionable error: ${msg.slice(0, 120)}`);
      } else {
        fail(`Threw, but the message is not actionable: ${msg.slice(0, 120)}`);
      }
    }
  }

  if (context.transactionId) {
    console.log("\nDeleting test transaction...");
    try {
      await callTool("manage_transactions", { action: "delete", id: context.transactionId });
      console.log("✓ Delete call completed");

      // Verify deletion
      const afterDelete = await callTool("search_transactions", {
        by: "filter",
        account_id: txAccountId,
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
    skip("Skipping delete (no transactionId in context)");
  }

  // ── search_transactions uncategorized tests ───────────────────────────────
  console.log("\n--- search_transactions uncategorized ---");

  // Positive: summary only (default mode)
  {
    const summary = await callTool("search_transactions", { by: "uncategorized" });
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
    const listResult = await callTool("search_transactions", {
      by: "uncategorized",
      include_transactions: true,
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
    const nilResult = await callTool("search_transactions", { by: "uncategorized", account_id: nilId });
    if (nilResult?.totalCount !== 0) {
      fail(`negative accountId: expected totalCount:0, got ${nilResult?.totalCount}`);
    } else if (!Array.isArray(nilResult?.byAccount) || nilResult.byAccount.length !== 0) {
      fail("negative accountId: expected byAccount:[]");
    } else {
      console.log("  ✓ negative accountId: totalCount:0 and byAccount:[] as expected");
    }
  }

  // ── TRANSFERS (#366): manage_transactions transfer had NO integration coverage ─────
  //
  // It had a unit test and nothing else. The only E2E reference lived in
  // tests/e2e/suites/transactions.ts, which never executes, and that call passes
  // `fromAccount`/`toAccount` while the schema requires `from_account`/`to_account`, so it
  // would have been rejected by Zod on its first run. This block is the real coverage.
  {
    console.log("\n-- Transfers --");
    const destName = `MCP-Tx-Dest-${timestamp}`;
    const destResult = await callTool("manage_accounts", { action: "create", entity: "account", name: destName, balance: 0 });
    const destAccountId = destResult?.result ?? destResult?.id ?? destResult;

    if (typeof destAccountId !== "string") {
      fail(`transfers: could not create a destination account (got ${JSON.stringify(destResult)?.slice(0, 80)})`);
    } else {
      try {
        const transferAmount = 1234;
        const transferDate = new Date().toISOString().slice(0, 10);

        // The uncategorized count must not move: a transfer is not a spending gap (#119).
        const uncatBefore = await callTool("search_transactions", { by: "uncategorized" });
        const countBefore = uncatBefore?.totalCount ?? 0;

        const created = await callTool("manage_transactions", {
          action: "transfer",
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
        const fromTxns = await callTool("search_transactions", { by: "account", account_id: txAccountId });
        const toTxns = await callTool("search_transactions", { by: "account", account_id: destAccountId });
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

        const uncatAfter = await callTool("search_transactions", { by: "uncategorized" });
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
            res = await callTool("manage_transactions", { action: "transfer", ...args });
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
          await callTool("manage_transactions", {
            action: "transfer",
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
        // account with a non-zero balance, and manage_accounts close now correctly refuses
        // to close such an account without a transferAccountId (#357). The module teardown
        // below is close-then-delete, so leaving the balance behind made the whole run fail
        // its zero-residue assertion. Remove the debit leg here to put the source account
        // back at zero, then drop the destination account and its credit leg with it.
        try {
          const srcTxns = await callTool("search_transactions", { by: "account", account_id: txAccountId });
          const srcList = srcTxns?.result ?? srcTxns ?? [];
          for (const t of Array.isArray(srcList) ? srcList : []) {
            if (t?.amount === -1234) {
              await callTool("manage_transactions", { action: "delete", id: t.id });
            }
          }
          await callTool("manage_accounts", { action: "delete", entity: "account", id: destAccountId });
          console.log(`  ✓ transfers: cleaned up, source account back to a zero balance`);
        } catch (err) {
          fail(`transfers: could not clean up: ${err.message?.slice(0, 120)}. That is residue.`);
        }
      }
    }
  }

  // #424: deterministic aggregation, exercised over BOTH transports by the dual-transport gate.
  console.log("\n#424: summarize_transactions grouped...");
  try {
    const aggRaw = await callTool("summarize_transactions", {
      report: "grouped",
      start_date: "2000-01-01", end_date: "2100-01-01", group_by: "month", account_ids: [txAccountId],
    });
    const agg = aggRaw?.result ?? aggRaw;
    if (!agg || !agg.totals || typeof agg.totals.expenseOutflow !== "number") {
      fail(`aggregate: expected a totals object with integer-cent fields, got ${JSON.stringify(agg)?.slice(0, 120)}`);
    } else {
      console.log(`  ✓ aggregate: returned totals (expenseOutflow=${agg.totals.expenseOutflow})`);
    }
  } catch (err) {
    fail(`aggregate: unexpected error: ${(err.message || String(err)).slice(0, 140)}`);
  }
  // NEGATIVE (#388/#424): a category NAME that EXISTS is refused WITH its resolved id (not silently
  // ignored, not a bare Invalid uuid). Self-contained: creates and deletes its own group + category.
  let aggGrpId, aggCatId;
  try {
    const grpRaw = await callTool("manage_categories", { action: "create", entity: "category_group", name: `AggGrp-${Date.now()}` });
    aggGrpId = grpRaw?.groupId || grpRaw?.id || grpRaw?.result || grpRaw;
    const aggCatName = `AggCat-${Date.now()}`;
    const catRaw = await callTool("manage_categories", { action: "create", entity: "category", name: aggCatName, group_id: aggGrpId });
    aggCatId = catRaw?.categoryId || catRaw?.id || catRaw?.result || catRaw;
    try {
      await callTool("summarize_transactions", {
        report: "grouped",
        start_date: "2000-01-01", end_date: "2100-01-01", group_by: "category", category_ids: [aggCatName],
      });
      fail("aggregate: a category NAME filter should be refused, but the call succeeded");
    } catch (err) {
      const msg = err.message || String(err);
      if (aggCatId && msg.includes(String(aggCatId))) {
        console.log(`  ✓ aggregate: a category name is refused with its resolved id (#388/#424)`);
      } else {
        fail(`aggregate: refused, but the message did not carry the resolved id ${aggCatId}: ${msg.slice(0, 120)}`);
      }
    }
  } finally {
    if (aggCatId) await callTool("manage_categories", { action: "delete", entity: "category", id: aggCatId }).catch(() => {});
    if (aggGrpId) await callTool("manage_categories", { action: "delete", entity: "category_group", id: aggGrpId }).catch(() => {});
  }

  // #426: recurring-expense detection, exercised over BOTH transports by the dual-transport gate.
  // Uses its OWN disposable account, not the shared txAccountId: manage_transactions create does not
  // return an id in this runner (the main flow above locates its txn by notes), so the seeded charges
  // cannot be deleted individually to zero the balance, and a non-zero balance makes accounts_close
  // fail (transferAccountId required). accounts_delete force-removes an account WITH transactions and
  // its rows in one call (proven by the #425 account_flow manual block), so a dedicated account is
  // torn down cleanly regardless of balance and leaves zero residue.
  console.log("\n#426: summarize_transactions recurring...");
  let recAccountId, recPayeeId, recPayeeName;
  const recAcctName = `MCP-Rec-${Date.now()}`;
  try {
    const recAcctRaw = await callTool("manage_accounts", { action: "create", entity: "account", name: recAcctName, balance: 0 });
    recAccountId = recAcctRaw.id || recAcctRaw.result || recAcctRaw;
    recPayeeName = `RecPayee-${Date.now()}`;
    const payeeRaw = await callTool("manage_payees", { action: "create", name: recPayeeName });
    recPayeeId = payeeRaw?.id || payeeRaw?.result || payeeRaw;
    for (const date of ["2025-06-15", "2025-07-15", "2025-08-15"]) {
      await callTool("manage_transactions", { action: "create", account: recAccountId, date, amount: -1599, payee: recPayeeId });
    }
    const recRaw = await callTool("summarize_transactions", {
      report: "recurring",
      start_date: "2025-01-01", end_date: "2025-08-31", account_ids: [recAccountId], min_occurrences: 3, include_inactive: true,
    });
    const rec = recRaw?.result ?? recRaw;
    const found = Array.isArray(rec?.series) ? rec.series.find(sery => sery.payeeName === recPayeeName) : null;
    if (found && found.frequency === "monthly" && found.latestAmount === 1599) {
      console.log(`  \u2713 recurring: monthly series detected (latestAmount=${found.latestAmount})`);
    } else {
      fail(`recurring: expected a monthly series at 1599 for ${recPayeeName}, got ${JSON.stringify(rec?.series)?.slice(0, 160)}`);
    }
    // NEGATIVE (#388/#426): an account NAME is refused with its resolved id.
    try {
      await callTool("summarize_transactions", { report: "recurring", start_date: "2025-01-01", end_date: "2025-12-31", account_ids: [recAcctName] });
      fail("recurring: an account NAME filter should be refused, but the call succeeded");
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes(String(recAccountId))) console.log(`  \u2713 recurring: an account name is refused with its resolved id (#388/#426)`);
      else fail(`recurring: refused, but the message did not carry the resolved id ${recAccountId}: ${msg.slice(0, 120)}`);
    }
  } catch (err) {
    fail(`recurring: unexpected error: ${(err.message || String(err)).slice(0, 140)}`);
  } finally {
    // accounts_delete removes the account and its seeded transactions in one call; then the payee.
    if (recAccountId) await callTool("manage_accounts", { action: "delete", entity: "account", id: recAccountId }).catch(() => {});
    if (recPayeeId) await callTool("manage_payees", { action: "delete", id: recPayeeId }).catch(() => {});
  }

  // #514: manage_transactions merge on a disposable account. manage_transactions create returns no
  // id in the runner, so both rows are located by listing the account and told apart by DATE.
  console.log("\nTesting transactions_merge...");
  let mergeAcctId = null;
  try {
    const mergeAcct = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-Merge-${timestamp}`, balance: 0 });
    mergeAcctId = mergeAcct.id || mergeAcct.result || mergeAcct;
    const listMerge = async () => {
      const r = await callTool("search_transactions", { by: "filter", account_id: mergeAcctId });
      return Array.isArray(r) ? r : (r.result || []);
    };
    // Rows to be KEPT carry empty notes: upstream fills only empty fields from the dropped row.
    await callTool("manage_transactions", { action: "create", account: mergeAcctId, date: '2026-10-01', amount: -1800, notes: '' });
    await callTool("manage_transactions", { action: "create", account: mergeAcctId, date: '2026-10-03', amount: -1800, notes: `MCP-Merge-Dropped-${timestamp}` });
    await callTool("manage_transactions", { action: "create", account: mergeAcctId, date: '2026-10-05', amount: -2000, notes: `MCP-Merge-Other-${timestamp}` });
    const before = await listMerge();
    const early = before.find(t => t.date === '2026-10-01' && t.amount === -1800);
    const late = before.find(t => t.date === '2026-10-03' && t.amount === -1800);
    const other = before.find(t => t.amount === -2000);
    if (!early || !late || !other) {
      fail(`merge: could not locate the three seeded rows (${before.length} found)`);
    } else {
      // NEGATIVE first: different amounts are refused naming both amounts, and both rows survive.
      try {
        await callTool("manage_transactions", { action: "merge", ids: [early.id, other.id] });
        fail("merge: different amounts should be refused, but the call succeeded");
      } catch (err) {
        const msg = err.message || String(err);
        if (/different amounts/i.test(msg) && msg.includes('-1800') && msg.includes('-2000')) console.log(`  \u2713 merge [negative]: different amounts refused naming both amounts`);
        else fail(`merge [negative]: refused, but the message is not actionable: ${msg.slice(0, 160)}`);
      }
      const afterRefusal = await listMerge();
      if (afterRefusal.length === 3) console.log(`  \u2713 merge [negative read-back]: all three rows unchanged`);
      else fail(`merge [negative read-back]: expected 3 rows, found ${afterRefusal.length}`);

      // POSITIVE: no imported_id on either, so the earlier date is kept. The earlier row is passed
      // FIRST so the second-id fallback would pick the other one: only the date rule passes this.
      const res = await callTool("manage_transactions", { action: "merge", ids: [early.id, late.id] });
      if (res?.success === true && res.keptId === early.id && res.deletedId === late.id) console.log(`  \u2713 merge: the earlier-dated row is kept (keptId=${res.keptId})`);
      else fail(`merge: expected keptId=${early.id} deletedId=${late.id}, got ${JSON.stringify(res).slice(0, 160)}`);
      const after = await listMerge();
      const keptRow = after.find(t => t.id === early.id);
      if (after.length === 2 && !after.some(t => t.id === late.id) && keptRow?.notes === `MCP-Merge-Dropped-${timestamp}`) {
        console.log(`  \u2713 merge [read-back]: one of the pair left, carrying the dropped row's notes`);
      } else {
        fail(`merge [read-back]: expected 2 rows with the kept one carrying the dropped notes, got ${JSON.stringify(after.map(t => ({ id: t.id, notes: t.notes }))).slice(0, 200)}`);
      }
    }
  } catch (err) {
    fail(`merge: unexpected error: ${(err.message || String(err)).slice(0, 140)}`);
  } finally {
    // accounts_delete removes the account and its transactions in one call.
    if (mergeAcctId) await callTool("manage_accounts", { action: "delete", entity: "account", id: mergeAcctId }).catch(() => {});
  }

  // #514: merging two TRANSFERS. The docker E2E skips this path (its server runs NODE_ENV=test,
  // where upstream deadlocks a transfer merge; see the note in docker-all-tools.e2e.spec.ts), so
  // this live run, on the production image, is its coverage. Two disposable accounts, deleted after.
  console.log("\nTesting transactions_merge on two transfers...");
  let xferSrcId = null;
  let xferDstId = null;
  try {
    const srcAcct = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-MergeXfer-Src-${timestamp}`, balance: 0 });
    xferSrcId = srcAcct.id || srcAcct.result || srcAcct;
    const dstAcct = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-MergeXfer-Dst-${timestamp}`, balance: 0 });
    xferDstId = dstAcct.id || dstAcct.result || dstAcct;
    const debitIds = [];
    for (const date of ['2026-10-01', '2026-10-03']) {
      const t = await callTool("manage_transactions", { action: "transfer", from_account: xferSrcId, to_account: xferDstId, amount: 2500, date });
      const r = t?.result ?? t;
      if (r?.from_id) debitIds.push(r.from_id);
    }
    const list = async (accountId) => {
      const r = await callTool("search_transactions", { by: "filter", account_id: accountId });
      return Array.isArray(r) ? r : (r.result || []);
    };
    if (debitIds.length !== 2) {
      fail(`merge transfers: expected two transfer debits, got ${debitIds.length}`);
    } else {
      const res = await callTool("manage_transactions", { action: "merge", ids: debitIds });
      const merged = res?.result ?? res;
      if (merged?.success === true && debitIds.includes(merged.keptId)) console.log(`  \u2713 merge transfers: merged (keptId=${merged.keptId})`);
      else fail(`merge transfers: unexpected result ${JSON.stringify(res).slice(0, 160)}`);
      const srcAfter = (await list(xferSrcId)).filter(t => t.amount === -2500);
      const dstAfter = (await list(xferDstId)).filter(t => t.amount === 2500);
      if (srcAfter.length === 1 && dstAfter.length === 1 && srcAfter[0].id === merged?.keptId && dstAfter[0].transfer_id === srcAfter[0].id) {
        console.log(`  \u2713 merge transfers [read-back]: one row in each account, linked`);
      } else {
        fail(`merge transfers [read-back]: expected one linked row per account, got src=${srcAfter.length} dst=${dstAfter.length} link=${dstAfter[0]?.transfer_id === srcAfter[0]?.id}`);
      }
    }
  } catch (err) {
    fail(`merge transfers: unexpected error: ${(err.message || String(err)).slice(0, 140)}`);
  } finally {
    if (xferSrcId) await callTool("manage_accounts", { action: "delete", entity: "account", id: xferSrcId }).catch(() => {});
    if (xferDstId) await callTool("manage_accounts", { action: "delete", entity: "account", id: xferDstId }).catch(() => {});
  }

  // #514: a plain categorised row merged with a transfer to an ON-BUDGET account. Upstream keeps
  // the transfer link and clears the category. Skipped in docker E2E for the same NODE_ENV=test
  // deadlock, so covered here. Disposable accounts, category group and category, deleted after.
  console.log("\nTesting transactions_merge of a plain row with a transfer...");
  let mixSrcId = null;
  let mixDstId = null;
  let mixGroupId = null;
  let mixCatId = null;
  try {
    const src = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-MergeMix-Src-${timestamp}`, balance: 0 });
    mixSrcId = src.id || src.result || src;
    const dst = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-MergeMix-Dst-${timestamp}`, balance: 0 });
    mixDstId = dst.id || dst.result || dst;
    const group = await callTool("manage_categories", { action: "create", entity: "category_group", name: `MCP-MergeMix-Group-${timestamp}` });
    mixGroupId = group.id || group.result || group;
    const cat = await callTool("manage_categories", { action: "create", entity: "category", name: `MCP-MergeMix-Cat-${timestamp}`, group_id: mixGroupId });
    mixCatId = cat.categoryId || cat.id || cat.result || cat;
    await callTool("manage_transactions", { action: "create", account: mixSrcId, date: '2026-10-01', amount: -1200, category: mixCatId });
    const t = await callTool("manage_transactions", { action: "transfer", from_account: mixSrcId, to_account: mixDstId, amount: 1200, date: '2026-10-03' });
    const debitId = (t?.result ?? t)?.from_id;
    const list = async () => {
      const r = await callTool("search_transactions", { by: "filter", account_id: mixSrcId });
      return (Array.isArray(r) ? r : (r.result || [])).filter(x => x.amount === -1200);
    };
    const plain = (await list()).find(x => !x.transfer_id);
    if (!plain || !debitId) {
      fail(`merge plain+transfer: could not locate the seeded rows (plain=${!!plain} debit=${!!debitId})`);
    } else if (plain.category !== mixCatId) {
      fail(`merge plain+transfer: the plain row was not seeded with the category (got ${plain.category})`);
    } else {
      await callTool("manage_transactions", { action: "merge", ids: [plain.id, debitId] });
      const after = await list();
      if (after.length === 1 && after[0].transfer_id && (after[0].category ?? null) === null) {
        console.log(`  \u2713 merge plain+transfer [read-back]: one row left, still a transfer, category cleared`);
      } else {
        fail(`merge plain+transfer [read-back]: expected one transfer row with no category, got ${JSON.stringify(after.map(x => ({ id: x.id, transfer_id: x.transfer_id, category: x.category }))).slice(0, 200)}`);
      }
    }
  } catch (err) {
    fail(`merge plain+transfer: unexpected error: ${(err.message || String(err)).slice(0, 140)}`);
  } finally {
    if (mixSrcId) await callTool("manage_accounts", { action: "delete", entity: "account", id: mixSrcId }).catch(() => {});
    if (mixDstId) await callTool("manage_accounts", { action: "delete", entity: "account", id: mixDstId }).catch(() => {});
    if (mixCatId) await callTool("manage_categories", { action: "delete", entity: "category", id: mixCatId }).catch(() => {});
    if (mixGroupId) await callTool("manage_categories", { action: "delete", entity: "category_group", id: mixGroupId }).catch(() => {});
  }

  // Teardown: close then delete the dedicated transaction test account.
  // close() must come first: Actual tombstones (hard-deletes) accounts with zero
  // transactions on close(), making them unrecoverable. We need close() to set
  // closed=1 before delete() removes the record cleanly.
  try {
    await callTool("manage_accounts", { action: "close", id: txAccountId });
    await callTool("manage_accounts", { action: "delete", entity: "account", id: txAccountId });
    console.log(`\n  ✓ Cleaned up transaction test account (${txAccountId})`);
  } catch (err) {
    fail(`Teardown: could not clean up the transaction test account (${txAccountId}): ${err.message?.slice(0, 120)}. That is residue.`);
  }
}
