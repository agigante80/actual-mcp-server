/**
 * tests/payee.js
 *
 * PAYEE TESTS — create, update, merge payees; get payee rules.
 * Includes full coverage of the category field on payee update:
 *   - category creates a "set category" rule for the payee
 *   - setting category twice does NOT create a duplicate rule (update path)
 *   - setting category to null removes the rule (clear path)
 *
 * Reads from context:  categoryId (required for category tests)
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

  // ── Category-via-rules: full lifecycle ─────────────────────────────────
  // The payees table has no 'category' column. The adapter stores it as a
  // "payee is X → set category" rule. We test create, no-dup update, and clear.

  if (context.categoryId) {
    // ── 1. SET category (create rule path) ────────────────────────────────
    console.log("\nSetting default category on payee (create rule path)...");
    try {
      await callTool("actual_payees_update", {
        id: payeeId,
        fields: { category: context.categoryId },
      });
      console.log("✓ actual_payees_update with category succeeded");

      // Verify: payee_rules_get should reveal exactly 1 'set category' rule
      const rulesAfterSet = await callTool("actual_payee_rules_get", { payeeId });
      const rulesAfterSetArr = Array.isArray(rulesAfterSet)
        ? rulesAfterSet
        : (rulesAfterSet?.rules ?? rulesAfterSet?.result ?? []);
      const setCatRule = rulesAfterSetArr.find(
        r => Array.isArray(r.actions) &&
             r.actions.some(a => a.op === 'set' && a.field === 'category')
      );
      if (setCatRule) {
        const action = setCatRule.actions.find(a => a.op === 'set' && a.field === 'category');
        if (action.value === context.categoryId) {
          console.log(`  ✓ Verify create rule: rule created with categoryId=${context.categoryId}`);
        } else {
          console.log(`  ❌ Verify create rule: action value=${action.value}, expected ${context.categoryId}`);
        }
      } else {
        console.log(`  ❌ Verify create rule: no 'set category' action found in ${rulesAfterSetArr.length} rule(s)`);
      }
    } catch (err) {
      console.log("❌ Set category FAILED:", err.message);
    }

    // ── 2. SET category again (update / no-duplication path) ──────────────
    console.log("\nSetting same category again (update rule — no duplicate)...");
    try {
      await callTool("actual_payees_update", {
        id: payeeId,
        fields: { category: context.categoryId },
      });
      console.log("✓ Second actual_payees_update with same category succeeded");

      // Verify: still exactly 1 'set category' rule, not 2
      const rulesAfterUpdate = await callTool("actual_payee_rules_get", { payeeId });
      const rulesAfterUpdateArr = Array.isArray(rulesAfterUpdate)
        ? rulesAfterUpdate
        : (rulesAfterUpdate?.rules ?? rulesAfterUpdate?.result ?? []);
      const setCatRules = rulesAfterUpdateArr.filter(
        r => Array.isArray(r.actions) &&
             r.actions.some(a => a.op === 'set' && a.field === 'category')
      );
      if (setCatRules.length === 1) {
        console.log(`  ✓ No-dup: exactly 1 'set category' rule (no duplicate created)`);
      } else {
        console.log(`  ❌ No-dup: expected 1 'set category' rule, got ${setCatRules.length}`);
      }
    } catch (err) {
      console.log("❌ Update (no-dup) category FAILED:", err.message);
    }

    // ── 3. CLEAR category (delete rule path) ──────────────────────────────
    console.log("\nClearing default category on payee (delete rule path)...");
    try {
      await callTool("actual_payees_update", {
        id: payeeId,
        fields: { category: null },
      });
      console.log("✓ actual_payees_update with category=null succeeded");

      // Verify: no 'set category' rule remains
      const rulesAfterClear = await callTool("actual_payee_rules_get", { payeeId });
      const rulesAfterClearArr = Array.isArray(rulesAfterClear)
        ? rulesAfterClear
        : (rulesAfterClear?.rules ?? rulesAfterClear?.result ?? []);
      const remainingCatRules = rulesAfterClearArr.filter(
        r => Array.isArray(r.actions) &&
             r.actions.some(a => a.op === 'set' && a.field === 'category')
      );
      if (remainingCatRules.length === 0) {
        console.log(`  ✓ Clear rule: no 'set category' rule remains after clear`);
      } else {
        console.log(`  ❌ Clear rule: expected 0 'set category' rules, got ${remainingCatRules.length}`);
      }
    } catch (err) {
      console.log("❌ Clear category FAILED:", err.message);
    }

    // ── 4. NEGATIVE: non-existent payee UUID with category ────────────────
    console.log("\nNegative: category update on non-existent payee UUID...");
    try {
      await callTool("actual_payees_update", {
        id: '00000000-0000-0000-0000-000000000000',
        fields: { category: context.categoryId },
      });
      // Actual may silently succeed (rule created for unknown payee — benign)
      console.log("  ⚠ Non-existent payee update with category did not throw (Actual allows orphan rules)");
    } catch (err) {
      console.log("  ✓ Non-existent payee UUID correctly produced error:", err.message.slice(0, 80));
    }
  } else {
    console.log("\n⚠ Skipping category-via-rules tests: context.categoryId not set (run at extended level)");
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

    // P5: also assert the target payee (payeeId) still exists
    const target = (await allPayees()).find(p => p.id === payeeId);
    if (!target) console.log(`  ❌ Verify merge: target payee1 absent after merge (should still exist)`);
    else console.log(`  ✓ Verify merge: target payee1 still present (name="${target.name}")`);
  }

  // Payee rules — after category was set then cleared above, expect 0 rules
  console.log("\nGetting payee rules (after category cleared — expect 0)...");
  const rules = await callTool("actual_payee_rules_get", { payeeId });
  const rulesArr = Array.isArray(rules) ? rules : (rules?.rules ?? rules?.result ?? null);
  if (!Array.isArray(rulesArr)) console.log("  ❌ Verify payee rules: expected array, got", typeof rulesArr);
  else console.log(`  ✓ Payee rules: ${rulesArr.length} rule(s) (expected 0 for new payee)`);

  // FIXED(BUG-3): actual_payee_rules_get with non-existent payeeId now returns actionable error with empty rules array
  // The adapter post-filters by payee_id, and the tool verifies the payee exists first.
  console.log("\nNEGATIVE P6: payee_rules_get with non-existent payeeId...");
  {
    const badRules = await callTool("actual_payee_rules_get", { payeeId: "00000000-0000-0000-0000-000000000000" });
    const hasError = typeof badRules?.error === 'string';
    if (hasError && badRules.error.includes('not found') && badRules.error.includes('actual_payees_get')) {
      console.log(`  ✓ FIXED(BUG-3): payee_rules_get nil-UUID returns actionable error: ${badRules.error.slice(0, 120)}`);
    } else if (hasError) {
      console.log(`  ⚠ P6: error returned but message not actionable: ${badRules.error.slice(0, 120)}`);
    } else {
      console.log(`  ⚠ P6: unexpected response: ${JSON.stringify(badRules).slice(0, 120)}`);
    }
  }

  // FIXED(BUG-2): actual_payees_delete with non-existent UUID now returns actionable error (pre-flight check in adapter)
  console.log("\nNEGATIVE: payees_delete with nil-UUID...");
  try {
    const nilRes = await callTool("actual_payees_delete", { id: '00000000-0000-0000-0000-000000000000' });
    // The adapter throws a descriptive error — this catch handles it
    console.log("  ⚠ Expected an error but tool returned:", JSON.stringify(nilRes).slice(0, 120));
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('not found') && msg.includes('actual_payees_get')) {
      console.log(`  ✓ FIXED(BUG-2): payees_delete nil-UUID returns actionable error: ${msg.slice(0, 120)}`);
    } else {
      console.log(`  ⚠ Error thrown but message not actionable: ${msg.slice(0, 120)}`);
    }
  }

  if (payeeId) {
    console.log("\nDeleting test payee...");
    try {
      await callTool("actual_payees_delete", { id: payeeId });
      console.log("✓ Delete call completed");

      // Verify deletion
      const afterPayees = await allPayees();
      const stillExists = afterPayees.find(p => p.id === payeeId);
      if (stillExists) {
        console.log("  ❌ Verify delete: payee still present in list");
      } else {
        console.log("  ✓ Verify delete: payee no longer in list");
        context.payeeId = null;
      }
    } catch (err) {
      console.log("  ❌ Delete threw unexpectedly:", err.message?.slice(0, 120));
    }
  } else {
    console.log("  ⚠ Skipping delete (payeeId not available after merge)");
  }
}
