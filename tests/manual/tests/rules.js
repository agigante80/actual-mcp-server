/**
 * tests/rules.js
 *
 * RULES TESTS — create (with and without 'op'), update, verify.
 * Regression test: rule action without 'op' field should default to 'set'.
 *
 * Reads from context:  categoryId (used as rule action value)
 * Writes to context:   ruleId, ruleWithoutOpId
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function rulesTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running RULES TESTS --");

  // Ensure we have a categoryId for rule actions — fetch one from the live server if context is null
  if (!context.categoryId) {
    const catData = await callTool("actual_categories_get", {});
    const raw = catData.result || catData.categories || catData;
    const flatCats = Array.isArray(raw)
      ? raw.flatMap(g => g.categories || [g]).filter(c => c && c.id && !c.hidden)
      : [];
    const firstCat = flatCats[0];
    if (firstCat) {
      context.categoryId = firstCat.id;
      console.log(`  ℹ Using existing category for rule actions: "${firstCat.name}" (${firstCat.id})`);
    } else {
      console.log("  ⚠ No category available for rule action values — rules test may fail");
    }
  }

  // List existing rules
  console.log("\nGetting all rules...");
  const rulesData = await callTool("actual_rules_get", {});
  const rules = rulesData.rules || rulesData.result || rulesData || [];
  console.log("✓ Rules found:", Array.isArray(rules) ? rules.length : 0);

  // REGRESSION: create rule without 'op' field — should default to 'set'
  console.log("\nREGRESSION: Creating rule without 'op' field (should default to 'set')...");
  const ruleWithoutOp = await callTool("actual_rules_create", {
    stage: "pre",
    conditionsOp: "and",
    conditions: [{ field: "notes", op: "contains", value: "MCP-Rule-no-op-test" }],
    actions: [{ field: "category", value: context.categoryId }], // no 'op' — should default to 'set'
  });
  const ruleWithoutOpId = ruleWithoutOp.id || ruleWithoutOp.result || ruleWithoutOp;
  console.log("✓ Rule created without 'op' (defaulted to 'set'):", ruleWithoutOpId);
  context.ruleWithoutOpId = ruleWithoutOpId;

  // Verify ruleWithoutOp — action should have op='set' defaulted by the server
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd.rules || rd.result || rd || [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === ruleWithoutOpId) : null;
    if (!found) {
      console.log("  ❌ Verify ruleWithoutOp: not found in list (id:", ruleWithoutOpId, ")");
    } else {
      const action = found.actions?.[0];
      if (action?.op === 'set') console.log(`  ✓ Verify ruleWithoutOp: action.op defaulted to "set"`);
      else console.log(`  ❌ Verify ruleWithoutOp: expected action.op="set", got "${action?.op}" (rule: ${JSON.stringify(action)})`);
    }
  }

  // Create rule with explicit 'op'
  console.log("\nCreating test rule...");
  const newRule = await callTool("actual_rules_create", {
    stage: "pre",
    conditionsOp: "and",
    conditions: [{ field: "notes", op: "contains", value: "MCP-Rule-test-marker" }],
    actions: [{ op: "set", field: "category", value: context.categoryId }],
  });
  const ruleId = newRule.id || newRule.result || newRule;
  console.log("✓ Created rule:", ruleId);
  context.ruleId = ruleId;

  // Verify create
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd.rules || rd.result || rd || [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === ruleId) : null;
    if (!found) {
      console.log("  ❌ Verify create: rule not found in list (id:", ruleId, ")");
    } else {
      const cond = found.conditions?.[0];
      if (cond?.value === "MCP-Rule-test-marker") console.log(`  ✓ Verify create: condition value="${cond.value}"`);
      else console.log(`  ❌ Verify create: expected condition value "MCP-Rule-test-marker", got "${cond?.value}"`);
    }
  }

  // Update
  console.log("\nUpdating rule...");
  await callTool("actual_rules_update", {
    id: ruleId,
    fields: {
      stage: "pre",
      conditionsOp: "and",
      conditions: [{ field: "notes", op: "contains", value: "MCP-Rule-updated-marker" }],
      actions: [{ op: "set", field: "category", value: context.categoryId }],
    },
  });
  console.log("✓ Rule updated");

  // Verify update
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd.rules || rd.result || rd || [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === ruleId) : null;
    if (!found) {
      console.log("  ❌ Verify update: rule not found in list");
    } else {
      const cond = found.conditions?.[0];
      if (cond?.value === "MCP-Rule-updated-marker") console.log(`  ✓ Verify update: condition value="${cond.value}"`);
      else console.log(`  ❌ Verify update: expected condition value "MCP-Rule-updated-marker", got "${cond?.value}"`);
    }
  }

  // rules_delete — negative UUID test then real delete(s) + verify
  // FIXED(BUG-9): actual_rules_delete with nil-UUID now returns { success: false, error } actionable error
  console.log("\nTesting rules_delete (negative UUID)...");
  try {
    const nilResult = await callTool("actual_rules_delete", {
      id: '00000000-0000-0000-0000-000000000000',
    });
    const success = nilResult?.success ?? nilResult?.result?.success;
    if (success === false || nilResult?.error) {
      console.log("  ✓ Negative nil-UUID delete: returned error/false correctly");
    } else {
      console.log("  ⚠ Negative nil-UUID delete: unexpectedly accepted (result:", JSON.stringify(nilResult).slice(0, 120), ")");
    }
  } catch (err) {
    console.log("  ✓ Negative nil-UUID delete: threw as expected:", err.message?.slice(0, 80));
  }

  // Helper to list all rule IDs
  async function allRuleIds() {
    const rd = await callTool("actual_rules_get", {});
    const arr = rd.rules || rd.result || rd || [];
    return Array.isArray(arr) ? arr.map(r => r.id) : [];
  }

  for (const [label, idKey] of [['ruleId', 'ruleId'], ['ruleWithoutOpId', 'ruleWithoutOpId']]) {
    const id = context[idKey];
    if (!id) { console.log(`  ⚠ Skipping delete of ${label} (not in context)`); continue; }
    console.log(`\nDeleting ${label} (${id})...`);
    try {
      await callTool("actual_rules_delete", { id });
      console.log("✓ Delete call completed");
      const ids = await allRuleIds();
      if (ids.includes(id)) {
        console.log(`  ❌ Verify delete: ${label} still present in rules list`);
      } else {
        console.log(`  ✓ Verify delete: ${label} no longer in rules list`);
        context[idKey] = null;
      }
    } catch (err) {
      console.log(`  ❌ Delete of ${label} threw unexpectedly:`, err.message?.slice(0, 120));
    }
  }
}
