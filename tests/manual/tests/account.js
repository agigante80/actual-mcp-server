/**
 * tests/account.js
 *
 * ACCOUNT TESTS — full account lifecycle: create → update → close → reopen.
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
        console.log(`  ❌ ${label}: expected account to be absent but it was found`);
        console.log(`     Account: ${JSON.stringify(found)}`);
      }
    } else {
      if (!found) {
        console.log(`  ❌ ${label}: account NOT found in list (${total} accounts)`);
      } else {
        const ok = check(found);
        if (ok === true) {
          console.log(`  ✓ ${label}: account found [ name="${found.name}", offbudget=${found.offbudget}, closed=${found.closed} ] [${total} accounts]`);
        } else {
          console.log(`  ❌ ${label}: account found but assertion failed — ${ok}`);
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
  else console.log(`  ❌ Balance: expected 0 for new account, got ${balanceVal}`);

  // FIXED(BUG-5): accounts_get_balance with non-existent id now returns actionable error
  console.log("\nNEGATIVE A4: accounts_get_balance with non-existent id...");
  {
    const badBalance = await callTool("actual_accounts_get_balance", { id: "00000000-0000-0000-0000-000000000000" });
    if (typeof badBalance?.error === 'string' && badBalance.error.includes('not found') && badBalance.error.includes('actual_accounts_list')) {
      console.log(`  ✓ FIXED(BUG-5): accounts_get_balance nil-UUID returns actionable error: ${badBalance.error.slice(0, 120)}`);
    } else if (typeof badBalance?.error === 'string') {
      console.log(`  ⚠ A4: error returned but message not actionable: ${badBalance.error.slice(0, 120)}`);
    } else {
      console.log(`  ⚠ A4: unexpected response: ${JSON.stringify(badBalance).slice(0, 120)}`);
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

  // REGRESSION: strict validation — invalid field
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("actual_accounts_update", { id: accountId, fields: { invalidField: "should fail" } });
    console.log("❌ REGRESSION FAILED: Invalid field was accepted (should have been rejected)");
  } catch (err) {
    if (err.message.includes("Unrecognized key") || err.message.includes("invalidField")) {
      console.log("✓ Strict validation working (invalid field rejected)");
    } else {
      console.log("⚠ Different error than expected:", err.message);
    }
  }

  // Add a dummy transaction (amount=0) so closeAccount sets closed=1 instead of tombstoning.
  // Actual tombstones (hard-deletes) accounts with zero transactions on close, making them
  // invisible to getAccounts and unrecoverable by reopen.
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

  // actual_accounts_delete — uses a separate disposable account (no transactions)
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
    else console.log(`  ❌ Verify delete: account still present after delete! ${JSON.stringify(found)}`);
  }
}
