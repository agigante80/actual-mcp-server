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

  const accountsBefore = await callTool("list_entities", { type: "account" });
  console.log(`Accounts before: ${accountsBefore.length}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accountName = `MCP-Test-${timestamp}`;

  // Helper: verify account presence/absence in the live list.
  async function listAndVerify(label, id, expectPresent, check) {
    const all = await callTool("list_entities", { type: "account" });
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
  const newAcc = await callTool("manage_accounts", { action: "create", entity: "account", name: accountName, balance: 0 });
  const accountId = newAcc.id || newAcc.result || newAcc;
  console.log("✓ Created account:", accountName);
  console.log("  Account ID:", accountId);
  context.accountId = accountId;
  context.accountName = accountName;

  await listAndVerify("After creation", accountId, true,
    a => (a.name === accountName && !a.closed) || `expected name="${accountName}" closed=false`);

  // Balance
  console.log("\nGetting account balance...");
  const balance = await callTool("summarize_transactions", { report: "balance", account_id: accountId });
  const balanceVal = typeof balance === 'object' ? (balance.balance ?? balance.result) : balance;
  if (balanceVal === 0) console.log(`  ✓ Balance: ${balanceVal} (expected 0 for new account)`);
  else fail(`Balance: expected 0 for new account, got ${balanceVal}`);

  // FIXED(BUG-5): accounts_get_balance with non-existent id now returns actionable error
  console.log("\nNEGATIVE A4: accounts_get_balance with non-existent id...");
  {
    const badBalance = await callTool("summarize_transactions", { report: "balance", account_id: "00000000-0000-0000-0000-000000000000" });
    if (typeof badBalance?.error === 'string' && badBalance.error.includes('not found') && badBalance.error.includes('list_entities with type account')) {
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
  await callTool("manage_accounts", {
    action: "update",
    entity: "account",
    id: accountId,
    name: updatedName,
    offbudget: true,
  });
  console.log("✓ Account updated with multiple fields");

  await listAndVerify("After update", accountId, true,
    a => (a.name === updatedName && a.offbudget === true) ||
      `expected name="${updatedName}" offbudget=true, got name="${a.name}" offbudget=${a.offbudget}`);

  // REGRESSION: strict validation: invalid field
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("manage_accounts", { action: "update", entity: "account", id: accountId, invalidField: "should fail" });
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
  await callTool("manage_transactions", {
    action: "create",
    account: accountId,
    date: today,
    amount: 0,
    notes: "Test transaction for close/reopen lifecycle",
  });
  console.log("✓ Dummy transaction added (balance stays 0)");

  // Close
  console.log("\nClosing account...");
  await callTool("manage_accounts", { action: "close", id: accountId });
  console.log("✓ Account closed");

  await listAndVerify("After close", accountId, true,
    a => (a.closed === true) || `expected closed=true, got closed=${a.closed}`);

  // Reopen
  console.log("\nReopening account...");
  await callTool("manage_accounts", { action: "reopen", id: accountId });
  console.log("✓ Account reopened");

  await listAndVerify("After reopen", accountId, true,
    a => (a.closed === false) || `expected closed=false, got closed=${a.closed}`);

  // Reset offbudget to false: the update test set it to true, but downstream tests
  // (e.g. batch/uncategorized) create transactions in context.accountId and expect it
  // to be on-budget so those transactions appear in the uncategorized list.
  await callTool("manage_accounts", { action: "update", entity: "account", id: accountId, offbudget: false });
  await listAndVerify("After offbudget reset", accountId, true,
    a => (a.offbudget === false) || `expected offbudget=false, got offbudget=${a.offbudget}`);

  // manage_accounts delete account: uses a separate disposable account (no transactions)
  // so Actual hard-deletes it cleanly without tombstoning.
  console.log("\nTesting manage_accounts delete account...");
  const deleteTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deleteAccName = `MCP-Test-Del-${deleteTimestamp}`;
  const newDelAcc = await callTool("manage_accounts", { action: "create", entity: "account", name: deleteAccName, balance: 0 });
  const deleteAccId = newDelAcc.id || newDelAcc.result || newDelAcc;
  console.log(`✓ Created disposable account: ${deleteAccName} (${deleteAccId})`);
  await callTool("manage_accounts", { action: "delete", entity: "account", id: deleteAccId });
  console.log("✓ Account deleted");
  {
    const all = await callTool("list_entities", { type: "account" });
    const found = Array.isArray(all) ? all.find(a => a.id === deleteAccId) : null;
    if (!found) console.log(`  ✓ Verify delete: account no longer present in list`);
    else fail(`Verify delete: account still present after delete! ${JSON.stringify(found)}`);
  }

  // #425: summarize_transactions account_flow reconciles a selection's balance change end to end and
  // separates transfers from spending. Uses two disposable accounts so the run leaves no residue.
  // Original tool by @maxvanweenen (PR #399). Runs over BOTH transports via the dual-transport gate.
  console.log("\nTesting summarize_transactions account_flow (reconciliation + transfer separation)...");
  {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const flowA = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-Flow-A-${ts}`, balance: 0 });
    const flowB = await callTool("manage_accounts", { action: "create", entity: "account", name: `MCP-Flow-B-${ts}`, balance: 0 });
    const flowAId = flowA.id || flowA.result || flowA;
    const flowBId = flowB.id || flowB.result || flowB;
    const day = new Date().toISOString().slice(0, 10);
    // A category-free expense (-5000) counts as expenseOutflow; a within-selection transfer must not.
    await callTool("manage_transactions", { action: "create", account: flowAId, date: day, amount: -5000, notes: "flow expense" });
    await callTool("manage_transactions", { action: "transfer", from_account: flowAId, to_account: flowBId, amount: 3000, date: day });

    const flow = await callTool("summarize_transactions", {
      report: "account_flow",
      start_date: "2000-01-01", end_date: "2100-01-01", account_ids: [flowAId, flowBId],
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
      await callTool("summarize_transactions", { report: "account_flow", start_date: "2025-01-01", end_date: "2025-01-31", account_ids: [`MCP-Flow-A-${ts}`] });
      fail("account_flow_summary NEGATIVE: an account NAME was accepted (expected refusal)");
    } catch (err) {
      if (err.message.includes(flowAId)) console.log("  \u2713 NEGATIVE: an account NAME is refused with its resolved id");
      else fail(`account_flow_summary NEGATIVE: refused, but the message lacks the resolved id: ${err.message.slice(0, 140)}`);
    }

    // Clean up both disposable accounts (removes their transactions too), leaving zero residue.
    await callTool("manage_accounts", { action: "delete", entity: "account", id: flowAId });
    await callTool("manage_accounts", { action: "delete", entity: "account", id: flowBId });
    console.log("  \u2713 flow-summary disposable accounts deleted");
  }

  // ---------------------------------------------------------------------------
  // ACCOUNT GROUPS (#429). Actual 26.9.0+. Full lifecycle with read-back after every
  // write, and a negative case per mutating tool. Zero residue: the group is deleted.
  // ---------------------------------------------------------------------------
  {
    const gts = new Date().toISOString().replace(/[:.]/g, '-');
    const groupName = `MCP-AcctGroup-${gts}`;

    const before = await callTool("list_entities", { type: "account_group" });
    if (!Array.isArray(before)) fail(`account_groups_list: expected an array, got ${typeof before}`);
    else console.log(`  \u2713 account_groups_list returned ${before.length} group(s)`);

    const created = await callTool("manage_accounts", { action: "create", entity: "account_group", name: groupName });
    const groupId = typeof created === 'string' ? created : created?.id;
    if (!groupId) fail(`account_groups_create: no id returned: ${JSON.stringify(created)}`);
    else console.log(`  \u2713 account_groups_create returned id ${groupId}`);

    // READ-BACK: the group must be listed with the name we supplied.
    const afterCreate = await callTool("list_entities", { type: "account_group" });
    const found = Array.isArray(afterCreate) ? afterCreate.find(g => g.id === groupId) : null;
    if (!found) fail("account_groups_create: group NOT found in the list after creation");
    else if (found.name !== groupName) fail(`account_groups_create: name round-trip failed: ${found.name}`);
    else console.log("  \u2713 read-back: the group is listed with the name supplied");

    // UPDATE, then read back the new name.
    const renamed = `${groupName}-renamed`;
    await callTool("manage_accounts", { action: "update", entity: "account_group", id: groupId, name: renamed });
    const afterUpdate = await callTool("list_entities", { type: "account_group" });
    const updated = Array.isArray(afterUpdate) ? afterUpdate.find(g => g.id === groupId) : null;
    if (updated?.name === renamed) console.log("  \u2713 read-back: rename persisted");
    else fail(`account_groups_update: rename did not persist: ${JSON.stringify(updated)}`);

    // NEGATIVE (create): an empty name is refused at the schema layer, writing nothing.
    try {
      await callTool("manage_accounts", { action: "create", entity: "account_group", name: "" });
      fail("account_groups_create NEGATIVE: an empty name was accepted (expected a schema refusal)");
    } catch (err) {
      console.log("  \u2713 NEGATIVE: account_groups_create refuses an empty name");
    }

    // NEGATIVE: a group that does not exist is refused, and the message says how to list them.
    const ghost = "00000000-0000-4000-8000-000000000999";
    for (const action of ["update", "delete"]) {
      const tool = `manage_accounts ${action} account_group`;
      const args = action === "update"
        ? { action, entity: "account_group", id: ghost, name: "nope" }
        : { action, entity: "account_group", id: ghost };
      try {
        await callTool("manage_accounts", args);
        fail(`${tool} NEGATIVE: a nonexistent group was accepted (expected refusal)`);
      } catch (err) {
        if (/not found/i.test(err.message) && err.message.includes("list_entities with type account_group")) {
          console.log(`  \u2713 NEGATIVE: ${tool} refuses a nonexistent group and names the listing tool`);
        } else {
          fail(`${tool} NEGATIVE: refused, but the message is not actionable: ${err.message.slice(0, 140)}`);
        }
      }
    }

    // DELETE, then verify it is gone. Leaves zero residue.
    await callTool("manage_accounts", { action: "delete", entity: "account_group", id: groupId });
    const afterDelete = await callTool("list_entities", { type: "account_group" });
    const stillThere = Array.isArray(afterDelete) ? afterDelete.find(g => g.id === groupId) : null;
    if (stillThere) fail("account_groups_delete: the group is still listed after deletion");
    else console.log("  \u2713 read-back: the group is gone after deletion (zero residue)");
  }
}
