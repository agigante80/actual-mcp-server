import { fail } from '../assert.js';
/**
 * tests/account.js
 *
 * ACCOUNT TESTS: full account lifecycle: create → update → close → reopen.
 * Each step is verified by re-listing accounts.
 *
 * Reads from context:  (none)
 * Writes to context:   accountId, accountName
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function accountTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running ACCOUNT TESTS --");

  const accountsBefore = await callTool("actual_accounts_list", {});
  console.log(`Accounts before: ${accountsBefore.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accountName = `MCP-Test-${timestamp}`;

  // Helper: verify account presence/absence in the live list.
  async function listAndVerify(label, id, expectPresent, check) {
    const all = await callTool("actual_accounts_list", {});
    const found = Array.isArray(all) ? all.find(a => a.id === id) : null;
    const total = Array.isArray(all) ? all.length : 0;
    if (!expectPresent) {
      if (!found) {
        console.log(`  ✓ ${label}: account correctly absent from list (closed accounts excluded) [${total} open accounts]`);
      } else {
        fail(`${label}: expected account to be absent but it was found`);
        console.log(`     Account: ${JSON.stringify(found)}`);
      }
    } else {
      if (!found) {
        fail(`${label}: account NOT found in list (${total} accounts)`);
      } else {
        const ok = check(found);
        if (ok === true) {
          console.log(`  ✓ ${label}: account found [ name="${found.name}", offbudget=${found.offbudget}, closed=${found.closed} ] [${total} accounts]`);
        } else {
          fail(`${label}: account found but assertion failed: ${ok}`);
          console.log(`     Account: ${JSON.stringify(found)}`);
        }
      }
    }
  }

  // Create
  console.log("\nCreating test account...");
  const newAcc = await callTool("actual_accounts_create", { name: accountName, balance: 0 });
  const accountId = newAcc.id || newAcc.result || newAcc;
  console.log("✓ Created account:", accountName);
  console.log("  Account ID:", accountId);
  context.accountId = accountId;
  context.accountName = accountName;

  await listAndVerify("After creation", accountId, true,
    a => (a.name === accountName && !a.closed) || `expected name="${accountName}" closed=false`);

  // Balance
  console.log("\nGetting account balance...");
  const balance = await callTool("actual_accounts_get_balance", { id: accountId });
  const balanceVal = typeof balance === 'object' ? (balance.balance ?? balance.result) : balance;
  if (balanceVal === 0) console.log(`  ✓ Balance: ${balanceVal} (expected 0 for new account)`);
  else fail(`Balance: expected 0 for new account, got ${balanceVal}`);

  // FIXED(BUG-5): accounts_get_balance with non-existent id now returns actionable error
  console.log("\nNEGATIVE A4: accounts_get_balance with non-existent id...");
  {
    const badBalance = await callTool("actual_accounts_get_balance", { id: "00000000-0000-0000-0000-000000000000" });
    if (typeof badBalance?.error === 'string' && badBalance.error.includes('not found') && badBalance.error.includes('actual_accounts_list')) {
      console.log(`  ✓ FIXED(BUG-5): accounts_get_balance nil-UUID returns actionable error: ${badBalance.error.slice(0, 120)}`);
    } else if (typeof badBalance?.error === 'string') {
      fail(`A4: an error was returned but the message is not actionable: ${badBalance.error.slice(0, 120)}`);
    } else {
      fail(`A4: unexpected response: ${JSON.stringify(badBalance).slice(0, 120)}`);
    }
  }

  // REGRESSION: multi-field update
  console.log("\nREGRESSION: Updating multiple account fields (name, offbudget)...");
  const updatedName = accountName + "-Updated";
  await callTool("actual_accounts_update", {
    id: accountId,
    fields: { name: updatedName, offbudget: true },
  });
  console.log("✓ Account updated with multiple fields");

  await listAndVerify("After update", accountId, true,
    a => (a.name === updatedName && a.offbudget === true) ||
      `expected name="${updatedName}" offbudget=true, got name="${a.name}" offbudget=${a.offbudget}`);

  // REGRESSION: strict validation: invalid field
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("actual_accounts_update", { id: accountId, fields: { invalidField: "should fail" } });
    fail("REGRESSION FAILED: Invalid field was accepted (should have been rejected)");
  } catch (err) {
    if (err.message.includes("unexpected field") || err.message.includes("invalidField")) {
      console.log("✓ Strict validation working (invalid field rejected)");
    } else {
      fail(`Strict validation: threw a different error than expected: ${err.message}`);
    }
  }

  // Add a dummy transaction (amount=0) so closeAccount sets closed=1 instead of tombstoning.
  // Actual tombstones (hard-deletes) accounts with zero transactions on close, making them
  // invisible to getAccounts and unrecoverable by reopen.
  //
  // #357: that behaviour is now ASSERTED rather than only worked around here. This
  // fixture keeps a closable account for the close/reopen lifecycle below; the
  // remove-on-close path has its own case in tests/e2e/docker-all-tools.e2e.spec.ts and
  // in tests/unit/accounts_close.test.js. The workaround stays because the lifecycle
  // genuinely needs an account that survives being closed, not because the hazard is
  // undocumented.
  console.log("\nAdding dummy transaction (amount=0) to prevent tombstone-on-close...");
  const today = new Date().toISOString().slice(0, 10);
  await callTool("actual_transactions_create", {
    account: accountId,
    date: today,
    amount: 0,
    notes: "Test transaction for close/reopen lifecycle",
  });
  console.log("✓ Dummy transaction added (balance stays 0)");

  // Close
  console.log("\nClosing account...");
  await callTool("actual_accounts_close", { id: accountId });
  console.log("✓ Account closed");

  await listAndVerify("After close", accountId, true,
    a => (a.closed === true) || `expected closed=true, got closed=${a.closed}`);

  // Reopen
  console.log("\nReopening account...");
  await callTool("actual_accounts_reopen", { id: accountId });
  console.log("✓ Account reopened");

  await listAndVerify("After reopen", accountId, true,
    a => (a.closed === false) || `expected closed=false, got closed=${a.closed}`);

  // Reset offbudget to false: the update test set it to true, but downstream tests
  // (e.g. batch/uncategorized) create transactions in context.accountId and expect it
  // to be on-budget so those transactions appear in the uncategorized list.
  await callTool("actual_accounts_update", { id: accountId, fields: { offbudget: false } });
  await listAndVerify("After offbudget reset", accountId, true,
    a => (a.offbudget === false) || `expected offbudget=false, got offbudget=${a.offbudget}`);

  // actual_accounts_delete: uses a separate disposable account (no transactions)
  // so Actual hard-deletes it cleanly without tombstoning.
  console.log("\nTesting actual_accounts_delete...");
  const deleteTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deleteAccName = `MCP-Test-Del-${deleteTimestamp}`;
  const newDelAcc = await callTool("actual_accounts_create", { name: deleteAccName, balance: 0 });
  const deleteAccId = newDelAcc.id || newDelAcc.result || newDelAcc;
  console.log(`✓ Created disposable account: ${deleteAccName} (${deleteAccId})`);
  await callTool("actual_accounts_delete", { id: deleteAccId });
  console.log("✓ Account deleted");
  {
    const all = await callTool("actual_accounts_list", {});
    const found = Array.isArray(all) ? all.find(a => a.id === deleteAccId) : null;
    if (!found) console.log(`  ✓ Verify delete: account no longer present in list`);
    else fail(`Verify delete: account still present after delete! ${JSON.stringify(found)}`);
  }

  // #425: actual_account_flow_summary reconciles a selection's balance change end to end and
  // separates transfers from spending. Uses two disposable accounts so the run leaves no residue.
  // Original tool by @maxvanweenen (PR #399). Runs over BOTH transports via the dual-transport gate.
  console.log("\nTesting actual_account_flow_summary (reconciliation + transfer separation)...");
  {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const flowA = await callTool("actual_accounts_create", { name: `MCP-Flow-A-${ts}`, balance: 0 });
    const flowB = await callTool("actual_accounts_create", { name: `MCP-Flow-B-${ts}`, balance: 0 });
    const flowAId = flowA.id || flowA.result || flowA;
    const flowBId = flowB.id || flowB.result || flowB;
    const day = new Date().toISOString().slice(0, 10);
    // A category-free expense (-5000) counts as expenseOutflow; a within-selection transfer must not.
    await callTool("actual_transactions_create", { account: flowAId, date: day, amount: -5000, notes: "flow expense" });
    await callTool("actual_transfers_create", { from_account: flowAId, to_account: flowBId, amount: 3000, date: day });

    const flow = await callTool("actual_account_flow_summary", {
      startDate: "2000-01-01", endDate: "2100-01-01", accountIds: [flowAId, flowBId],
    });
    const f = flow?.result ?? flow;
    if (f?.external?.expenseOutflow === 5000) console.log("  \u2713 expenseOutflow === 5000 (uncategorized outflow counted)");
    else fail(`account_flow_summary: expected expenseOutflow 5000, got ${JSON.stringify(f?.external)}`);
    if (f?.transfers?.withinSelection === 3000 && f?.transfers?.netTransferEffect === 0) {
      console.log("  \u2713 within-selection transfer separated (withinSelection 3000, netTransferEffect 0)");
    } else {
      fail(`account_flow_summary: transfer not separated: ${JSON.stringify(f?.transfers)}`);
    }
    if (f?.reconciliation?.difference === 0) console.log("  \u2713 reconciliation.difference === 0 (exact)");
    else fail(`account_flow_summary: reconciliation not exact: ${JSON.stringify(f?.reconciliation)}`);

    // NEGATIVE: an account NAME is refused with the resolved id (#388), not an empty selection.
    try {
      await callTool("actual_account_flow_summary", { startDate: "2025-01-01", endDate: "2025-01-31", accountIds: [`MCP-Flow-A-${ts}`] });
      fail("account_flow_summary NEGATIVE: an account NAME was accepted (expected refusal)");
    } catch (err) {
      if (err.message.includes(flowAId)) console.log("  \u2713 NEGATIVE: an account NAME is refused with its resolved id");
      else fail(`account_flow_summary NEGATIVE: refused, but the message lacks the resolved id: ${err.message.slice(0, 140)}`);
    }

    // Clean up both disposable accounts (removes their transactions too), leaving zero residue.
    await callTool("actual_accounts_delete", { id: flowAId });
    await callTool("actual_accounts_delete", { id: flowBId });
    console.log("  \u2713 flow-summary disposable accounts deleted");
  }
}
