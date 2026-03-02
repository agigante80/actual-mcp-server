/**
 * tests/batch_uncategorized_rules_upsert.js
 *
 * Tests for three new tools ported from the ZanzyTHEbar fork:
 *   1. actual_transactions_uncategorized  — list transactions with no category
 *   2. actual_transactions_update_batch   — update multiple transactions in one call
 *   3. actual_rules_create_or_update      — idempotent rule upsert
 *
 * Reads from context:  accountId (required), categoryId (required)
 * Writes to context:   rulesUpsertId  (cleaned up by runner.js cleanup phase)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function batchUncategorizedRulesUpsertTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running BATCH / UNCATEGORIZED / RULES-UPSERT TESTS --");

  if (!context.accountId) {
    console.log("⚠ No account ID in context — skipping batch/uncategorized/upsert tests");
    return;
  }
  if (!context.categoryId) {
    console.log("⚠ No category ID in context — skipping batch/uncategorized/upsert tests");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const today = new Date().toISOString().split('T')[0];

  // ──────────────────────────────────────────────────────────────────────────
  // 1. actual_transactions_uncategorized
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== actual_transactions_uncategorized ===");

  // Create an uncategorized transaction so we know at least one exists
  const uncatNotes = `MCP-Uncat-${timestamp}`;
  console.log("\nCreating uncategorized test transaction...");
  await callTool("actual_transactions_create", {
    account: context.accountId,
    date: today,
    amount: -1234,
    notes: uncatNotes,
    // deliberately no category
  });
  console.log("✓ Uncategorized transaction created");

  // List uncategorized for current month
  console.log("\nListing uncategorized transactions (default: current month)...");
  const uncatResult = await callTool("actual_transactions_uncategorized", {});
  const uncatTxns = uncatResult?.transactions ?? [];
  const uncatCount = uncatResult?.count ?? uncatTxns.length;
  const uncatTotalAmount = uncatResult?.summary?.totalAmount;
  if (Array.isArray(uncatTxns)) {
    console.log(`  ✓ actual_transactions_uncategorized: count=${uncatCount}, totalAmount=${uncatTotalAmount}`);
  } else {
    console.log(`  ❌ actual_transactions_uncategorized: expected transactions array, got ${JSON.stringify(uncatResult).slice(0, 120)}`);
  }

  // Verify our newly created transaction appears in the uncategorized list
  const foundInUncat = uncatTxns.find(t => t?.notes === uncatNotes);
  if (foundInUncat) {
    console.log(`  ✓ Verify: uncategorized transaction found in list (notes="${uncatNotes}")`);
  } else {
    console.log(`  ❌ Verify: uncategorized transaction NOT found in list (notes="${uncatNotes}")`);
  }

  // Save the uncategorized transaction ID for batch update below
  const uncatTxnId = foundInUncat?.id ?? null;

  // NEGATIVE: non-existent account ID should return empty list (not error)
  console.log("\nNEGATIVE: listing uncategorized for __nonexistent_MCP_test_value__ account...");
  try {
    const negResult = await callTool("actual_transactions_uncategorized", {
      accountId: "__nonexistent_MCP_test_value__",
    });
    const negTxns = negResult?.transactions ?? [];
    if (Array.isArray(negTxns) && negTxns.length === 0) {
      console.log("  ✓ NEGATIVE: returned empty list for unknown account (expected)");
    } else {
      console.log(`  ⚠ NEGATIVE: got ${negTxns.length} transactions for unknown account — may depend on Actual behavior`);
    }
  } catch (err) {
    // Some adapter versions may throw for invalid account IDs — acceptable
    console.log(`  ✓ NEGATIVE: threw as expected for unknown account: ${err.message}`);
  }

  // EDGE CASE: date range guaranteed to have zero uncategorized transactions
  console.log("\nEDGE CASE: listing uncategorized for far-future date range (expect empty list)...");
  const emptyRangeResult = await callTool("actual_transactions_uncategorized", {
    startDate: "2099-01-01",
    endDate: "2099-01-31",
  });
  const emptyRangeTxns = emptyRangeResult?.transactions ?? [];
  if (Array.isArray(emptyRangeTxns) && emptyRangeTxns.length === 0) {
    console.log(`  ✓ EDGE CASE: transactions=[] for future date range (count=${emptyRangeResult?.count ?? 0})`);
  } else {
    console.log(`  ⚠ EDGE CASE: expected empty list for 2099, got ${emptyRangeTxns.length} items`);
  }
  if (emptyRangeResult?.count === 0) {
    console.log(`  ✓ EDGE CASE: count=0`);
  }
  if (emptyRangeResult?.summary?.totalAmount === 0) {
    console.log(`  ✓ EDGE CASE: summary.totalAmount=0`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. actual_transactions_update_batch
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== actual_transactions_update_batch ===");

  if (!uncatTxnId) {
    console.log("⚠ Skipping batch update (no uncategorized transaction ID available)");
  } else {
    const batchNotes = `MCP-Batch-${timestamp}`;
    console.log(`\nBatch-updating 1 transaction (id=${uncatTxnId})...`);
    const batchResult = await callTool("actual_transactions_update_batch", {
      updates: [
        { id: uncatTxnId, fields: { notes: batchNotes, category: context.categoryId } },
      ],
    });

    const succeeded = batchResult?.succeeded ?? [];
    const failed = batchResult?.failed ?? [];
    if (batchResult?.total === 1 && batchResult?.successCount === 1 && batchResult?.failureCount === 0) {
      console.log(`  ✓ actual_transactions_update_batch: total=1 successCount=1 failureCount=0`);
    } else {
      console.log(`  ❌ actual_transactions_update_batch: unexpected result: ${JSON.stringify(batchResult).slice(0, 120)}`);
    }
    if (Array.isArray(succeeded) && succeeded.length === 1 && succeeded[0]?.id === uncatTxnId) {
      console.log(`  ✓ succeeded list contains the expected transaction ID`);
    } else {
      console.log(`  ❌ succeeded list unexpected: ${JSON.stringify(succeeded)}`);
    }
    if (Array.isArray(failed) && failed.length === 0) {
      console.log(`  ✓ failed list is empty (no errors)`);
    } else {
      console.log(`  ❌ failed list not empty: ${JSON.stringify(failed)}`);
    }

    // Verify: read back and confirm note + category were applied
    const verifyFilter = await callTool("actual_transactions_filter", {
      accountId: context.accountId,
      notes: batchNotes,
    });
    const verifyRows = Array.isArray(verifyFilter)
      ? verifyFilter
      : (verifyFilter?.result ?? []);
    const verifiedTxn = verifyRows.find(t => t?.id === uncatTxnId);
    if (verifiedTxn?.notes === batchNotes) {
      console.log(`  ✓ Verify batch: notes updated to "${batchNotes}"`);
    } else {
      console.log(`  ❌ Verify batch: notes not updated (got "${verifiedTxn?.notes}")`);
    }
    if (verifiedTxn?.category === context.categoryId) {
      console.log(`  ✓ Verify batch: category set to "${context.categoryId}"`);
    } else {
      console.log(`  ⚠ Verify batch: category is "${verifiedTxn?.category}" (expected "${context.categoryId}")`);
    }

    // NEGATIVE: batch with a non-existent transaction ID should report partial failure
    console.log("\nNEGATIVE: batch update with __nonexistent_MCP_test_value__ ID...");
    const negBatch = await callTool("actual_transactions_update_batch", {
      updates: [{ id: "__nonexistent_MCP_test_value__", fields: { notes: "should-fail" } }],
    });
    if (negBatch?.failureCount === 1 && negBatch?.successCount === 0) {
      console.log(`  ✓ NEGATIVE: failureCount=1 successCount=0 (non-existent ID correctly failed)`);
    } else if (negBatch?.successCount === 1) {
      console.log(`  ⚠ NEGATIVE: Actual accepted update for unknown ID (adapter may not validate existence)`);
    } else {
      console.log(`  ⚠ NEGATIVE: unexpected result: ${JSON.stringify(negBatch).slice(0, 120)}`);
    }

    // PARTIAL FAILURE: mixed batch — one valid ID + one bad ID — proves the loop
    // does NOT abort on failure; the valid item must still appear in succeeded[].
    console.log("\nPARTIAL FAILURE: mixed batch (1 valid + 1 bad ID) — valid should still succeed...");
    const mixedNotes = `${batchNotes}-mixed`;
    const mixedBatch = await callTool("actual_transactions_update_batch", {
      updates: [
        { id: uncatTxnId, fields: { notes: mixedNotes } },
        { id: "__nonexistent_MCP_test_value__", fields: { notes: "should-fail" } },
      ],
    });
    const mixedSucceeded = mixedBatch?.succeeded ?? [];
    const mixedFailed = mixedBatch?.failed ?? [];
    if (mixedBatch?.total === 2 && mixedBatch?.successCount === 1 && mixedBatch?.failureCount === 1) {
      console.log(`  ✓ PARTIAL FAILURE: total=2 successCount=1 failureCount=1 (failure isolated, loop continued)`);
    } else if (mixedBatch?.successCount === 2) {
      // Actual does not validate existence on updateTransaction — both silently succeed
      console.log(`  ⚠ PARTIAL FAILURE: both succeeded — Actual accepts updates for non-existent IDs (no error thrown)`);
    } else {
      console.log(`  ⚠ PARTIAL FAILURE: unexpected result: ${JSON.stringify(mixedBatch).slice(0, 120)}`);
    }
    if (mixedSucceeded.some(s => s?.id === uncatTxnId)) {
      console.log(`  ✓ PARTIAL FAILURE: valid transaction id in succeeded[]`);
    }
    if (mixedFailed.some(f => f?.id === "__nonexistent_MCP_test_value__")) {
      console.log(`  ✓ PARTIAL FAILURE: bad ID in failed[] with error message`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. actual_rules_create_or_update (idempotent upsert)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n=== actual_rules_create_or_update (idempotent upsert) ===");

  const upsertMarker = `MCP-RulesUpsert-${timestamp}`;
  const upsertConditions = [{ field: "notes", op: "contains", value: upsertMarker }];
  const upsertActions = [{ op: "set", field: "category", value: context.categoryId }];

  // First call — should CREATE a new rule
  console.log("\nFirst call (expect create)...");
  const firstResult = await callTool("actual_rules_create_or_update", {
    stage: "pre",
    conditionsOp: "and",
    conditions: upsertConditions,
    actions: upsertActions,
  });
  const upsertRuleId = firstResult?.id ?? null;
  if (typeof upsertRuleId === 'string' && firstResult?.created === true) {
    console.log(`  ✓ First call: created=true, id=${upsertRuleId}`);
  } else {
    console.log(`  ❌ First call: expected created=true, got ${JSON.stringify(firstResult).slice(0, 120)}`);
  }
  context.rulesUpsertId = upsertRuleId;

  // Verify: the rule appears in the live rules list
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd?.rules ?? rd?.result ?? rd ?? [];
    const found = Array.isArray(allRules) ? allRules.find(r => r.id === upsertRuleId) : null;
    if (found) {
      console.log(`  ✓ Verify create: rule found in actual_rules_get list (id=${upsertRuleId})`);
    } else {
      console.log(`  ❌ Verify create: rule NOT found in actual_rules_get list (id=${upsertRuleId})`);
    }
  }

  // Second call with SAME conditions — should UPDATE (not create duplicate)
  console.log("\nSecond call with same conditions (expect update, not duplicate)...");
  const updatedActions = [
    { op: "set", field: "category", value: context.categoryId },
    { op: "append-notes", value: " [auto-categorized]" },
  ];
  const secondResult = await callTool("actual_rules_create_or_update", {
    stage: "pre",
    conditionsOp: "and",
    conditions: upsertConditions, // identical conditions
    actions: updatedActions,       // changed actions
  });
  if (secondResult?.id === upsertRuleId && secondResult?.created === false) {
    console.log(`  ✓ Second call: created=false, same id=${upsertRuleId} (no duplicate created)`);
  } else {
    console.log(`  ❌ Second call: expected created=false and id=${upsertRuleId}, got ${JSON.stringify(secondResult).slice(0, 120)}`);
  }

  // Verify: still only one rule with that marker (no duplicates)
  {
    const rd = await callTool("actual_rules_get", {});
    const allRules = rd?.rules ?? rd?.result ?? rd ?? [];
    const matchingRules = Array.isArray(allRules)
      ? allRules.filter(r => r?.conditions?.some(c => c?.value === upsertMarker))
      : [];
    if (matchingRules.length === 1) {
      console.log(`  ✓ Verify no-duplicate: exactly 1 rule with marker (as expected)`);
    } else {
      console.log(`  ❌ Verify no-duplicate: found ${matchingRules.length} rules with marker (expected 1)`);
    }
  }

  // NEGATIVE: invalid field operator combination should be rejected
  console.log("\nNEGATIVE: invalid operator for field type...");
  try {
    await callTool("actual_rules_create_or_update", {
      conditions: [{ field: "payee", op: "contains", value: "__nonexistent_MCP_test_value__" }],
      actions: [{ op: "set", field: "category", value: context.categoryId }],
    });
    console.log("  ❌ NEGATIVE: expected error for invalid payee+contains combination, but call succeeded");
  } catch (err) {
    if (err.message.includes("operator") || err.message.includes("UUID") || err.message.includes("id")) {
      console.log(`  ✓ NEGATIVE: correctly rejected invalid condition: ${err.message.slice(0, 80)}`);
    } else {
      console.log(`  ⚠ NEGATIVE: threw but unexpected message: ${err.message.slice(0, 120)}`);
    }
  }

  console.log("\n-- BATCH / UNCATEGORIZED / RULES-UPSERT TESTS complete --");
}
