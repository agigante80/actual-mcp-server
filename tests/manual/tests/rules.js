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

  console.log("  (Rule deletion tested in cleanup phase)");
}
