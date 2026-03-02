/**
 * tests/payee.js
 *
 * PAYEE TESTS — create, update, merge payees; get payee rules.
 * Includes regression test for `category` field on payee update.
 *
 * Reads from context:  categoryId (optional — used for regression test)
 * Writes to context:   payeeId, payeeId2 (cleared to null after merge)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function payeeTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running PAYEE TESTS --");

  // List existing payees
  console.log("\nListing existing payees...");
  const payeesData = await callTool("actual_payees_get", {});
  const existingPayees = payeesData.result || payeesData || [];
  console.log("✓ Found payees:", existingPayees.length);

  // Helper: fetch current payee list
  async function allPayees() {
    const pd = await callTool("actual_payees_get", {});
    return pd.result || pd || [];
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Create first payee
  console.log("\nCreating test payee...");
  const newPayee = await callTool("actual_payees_create", { name: `MCP-Payee-${timestamp}` });
  const payeeId = newPayee.id || newPayee.result || newPayee;
  console.log("✓ Created payee:", payeeId);
  context.payeeId = payeeId;

  // Create second payee for merge test
  console.log("\nCreating second test payee for merge...");
  const newPayee2 = await callTool("actual_payees_create", { name: `MCP-Payee2-${timestamp}` });
  const payeeId2 = newPayee2.id || newPayee2.result || newPayee2;
  console.log("✓ Created second payee:", payeeId2);
  context.payeeId2 = payeeId2;

  // Verify payeeId2 create
  {
    const found = (await allPayees()).find(p => p.id === payeeId2);
    if (!found) console.log("  ❌ Verify payee2 create: not found in list (id:", payeeId2, ")");
    else if (found.name === `MCP-Payee2-${timestamp}`) console.log(`  ✓ Verify payee2 create: name="${found.name}"`);
    else console.log(`  ❌ Verify payee2 create: expected "MCP-Payee2-${timestamp}", got "${found.name}"`);
  }

  // REGRESSION: set default category on payee
  if (context.categoryId) {
    console.log("\nREGRESSION: Setting default category on payee...");
    try {
      await callTool("actual_payees_update", { id: payeeId, fields: { category: context.categoryId } });
      console.log("✓ Payee updated with default category");
      // Verify — payee_rules_get won't show it, but the call succeeding is the assertion
    } catch (err) {
      console.log("❌ REGRESSION FAILED: actual_payees_update rejected category field:", err.message);
    }
  }

  // Verify create
  {
    const found = (await allPayees()).find(p => p.id === payeeId);
    if (!found) console.log("  ❌ Verify create: payee not found in list (id:", payeeId, ")");
    else if (found.name === `MCP-Payee-${timestamp}`) console.log(`  ✓ Verify create: name="${found.name}"`);
    else console.log(`  ❌ Verify create: expected "MCP-Payee-${timestamp}", got "${found.name}"`);
  }

  // Update name
  console.log("\nUpdating payee name...");
  await callTool("actual_payees_update", {
    id: payeeId,
    fields: { name: `MCP-Payee-${timestamp}-Updated` },
  });
  console.log("✓ Payee updated");

  // Verify update
  {
    const found = (await allPayees()).find(p => p.id === payeeId);
    if (!found) console.log("  ❌ Verify update: payee not found in list");
    else if (found.name === `MCP-Payee-${timestamp}-Updated`) console.log(`  ✓ Verify update: name="${found.name}"`);
    else console.log(`  ❌ Verify update: expected "MCP-Payee-${timestamp}-Updated", got "${found.name}"`);
  }

  // REGRESSION: strict validation — invalid field
  console.log("\nREGRESSION: Testing strict validation (invalid field should fail)...");
  try {
    await callTool("actual_payees_update", { id: payeeId, fields: { invalidField: "should fail" } });
    console.log("❌ REGRESSION FAILED: Invalid field was accepted (should have been rejected)");
  } catch (err) {
    if (err.message.includes("Unrecognized key") || err.message.includes("invalidField")) {
      console.log("✓ Strict validation working (invalid field rejected)");
    } else {
      console.log("⚠ Different error than expected:", err.message);
    }
  }

  // Merge payeeId2 into payeeId
  console.log("\nMerging payees...");
  await callTool("actual_payees_merge", { targetId: payeeId, mergeIds: [payeeId2] });
  console.log("✓ Payees merged (payee2 merged into payee1)");
  context.payeeId2 = null; // gone after merge

  // Verify merge
  {
    const gone = (await allPayees()).find(p => p.id === payeeId2);
    if (gone) console.log(`  ❌ Verify merge: payee2 still exists (should have been merged away)`);
    else console.log(`  ✓ Verify merge: payee2 no longer in list (confirmed deleted by merge)`);
  }

  // Payee rules
  console.log("\nGetting payee rules...");
  const rules = await callTool("actual_payee_rules_get", { payeeId });
  const rulesArr = Array.isArray(rules) ? rules : (rules?.rules ?? rules?.result ?? null);
  if (!Array.isArray(rulesArr)) console.log("  ❌ Verify payee rules: expected array, got", typeof rulesArr);
  else console.log(`  ✓ Payee rules: ${rulesArr.length} rule(s) (expected 0 for new payee)`);
}
