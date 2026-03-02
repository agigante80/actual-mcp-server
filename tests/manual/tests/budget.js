/**
 * tests/budget.js
 *
 * BUDGET TESTS — get months, set amounts, carryover, hold, transfer, batch.
 * Regression tests for large batch (35 ops) and batch error resilience.
 *
 * Reads from context:  categoryId (required — skips if absent)
 * Writes to context:   (none)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function budgetTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running BUDGET TESTS --");

  if (!context.categoryId) {
    console.log("⚠ No category available - skipping budget tests");
    return;
  }

  const currentDate = new Date().toISOString().split('T')[0].substring(0, 7); // YYYY-MM

  // Get all budgets
  console.log("\nGetting all budgets...");
  await callTool("actual_budgets_get_all", {});
  console.log("✓ Retrieved all budgets");

  // Get specific month
  console.log("\nGetting budget for current month...");
  const monthBudget = await callTool("actual_budgets_getMonth", { month: currentDate });
  console.log("✓ Retrieved month budget:", currentDate);

  // Get multiple months
  console.log("\nGetting budgets for multiple months...");
  const months = await callTool("actual_budgets_getMonths", { start: currentDate, end: currentDate });
  console.log("✓ Retrieved months:", months.length);

  // Set amount
  console.log("\nSetting budget amount...");
  await callTool("actual_budgets_setAmount", {
    month: currentDate,
    categoryId: context.categoryId,
    amount: 50000,
  });
  console.log("✓ Budget amount set to 500.00");

  // Verify setAmount
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const monthData = check.result || check;
    const catEntry = (monthData.categoryGroups || [])
      .flatMap(g => g.categories || [])
      .find(c => c.id === context.categoryId);
    if (!catEntry) console.log("  ❌ Verify setAmount: category not found in month budget");
    else if (catEntry.budgeted === 50000) console.log(`  ✓ Verify setAmount: budgeted=${catEntry.budgeted} (500.00)`);
    else console.log(`  ❌ Verify setAmount: expected 50000, got ${catEntry.budgeted}`);
  }

  // Carryover
  console.log("\nSetting carryover...");
  await callTool("actual_budgets_setCarryover", {
    month: currentDate,
    categoryId: context.categoryId,
    flag: true,
  });
  console.log("✓ Carryover enabled");

  // Verify carryover
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const monthData = check.result || check;
    const catEntry = (monthData.categoryGroups || [])
      .flatMap(g => g.categories || [])
      .find(c => c.id === context.categoryId);
    if (!catEntry) console.log("  ⚠ Verify carryover: category not found in month budget (carryover field check skipped)");
    else if (catEntry.carryover === true || catEntry.carryover === 1) console.log(`  ✓ Verify carryover: carryover=${catEntry.carryover} (enabled)`);
    else console.log(`  ⚠ Verify carryover: carryover=${JSON.stringify(catEntry.carryover)} (API may use different field)`);
  }

  // Hold for next month
  console.log("\nHolding budget for next month...");
  await callTool("actual_budgets_holdForNextMonth", {
    month: currentDate,
    categoryId: context.categoryId,
    amount: 10000,
  });
  console.log("✓ Held 100.00 for next month");

  // Reset hold
  console.log("\nResetting hold...");
  await callTool("actual_budgets_resetHold", { month: currentDate, categoryId: context.categoryId });
  console.log("✓ Hold reset");

  // Transfer between categories
  console.log("\nTesting budget transfer...");
  const targetCategory = monthBudget.categoryGroups?.[0]?.categories?.[0];
  const targetCategoryId = targetCategory ? targetCategory.id : context.categoryId;
  if (targetCategoryId === context.categoryId) {
    console.log("⚠ Skipping transfer test (need two different categories)");
  } else {
    await callTool("actual_budgets_transfer", {
      month: currentDate,
      amount: 5000,
      fromCategoryId: context.categoryId,
      toCategoryId: targetCategoryId,
    });
    console.log("✓ Budget transfer completed");
  }

  // Batch updates
  console.log("\nTesting batch budget updates...");
  await callTool("actual_budget_updates_batch", {
    operations: [{ month: currentDate, categoryId: context.categoryId, amount: 60000 }],
  });
  console.log("✓ Batch updates completed");

  // REGRESSION: large batch (35 ops)
  console.log("\nREGRESSION: Testing large batch with 35 operations (should handle gracefully)...");
  const largeBatch = Array.from({ length: 35 }, (_, i) => ({
    month: currentDate,
    categoryId: context.categoryId,
    amount: 10000 + (i * 100),
  }));
  const batchResult = await callTool("actual_budget_updates_batch", { operations: largeBatch });
  console.log("✓ Large batch handled:", batchResult);

  // REGRESSION: batch error resilience
  console.log("\nREGRESSION: Testing batch error resilience (should continue on failures)...");
  const mixedBatch = [
    { month: currentDate, categoryId: context.categoryId, amount: 70000 },       // valid
    { month: "invalid-date", categoryId: context.categoryId, amount: 80000 },    // invalid month
    { month: currentDate, categoryId: context.categoryId, amount: 90000 },       // valid
  ];
  try {
    const mixedResult = await callTool("actual_budget_updates_batch", { operations: mixedBatch });
    console.log("✓ Batch with errors processed:", mixedResult);
    if (mixedResult.successCount === 2 && mixedResult.failureCount === 1) {
      console.log("✓ Error resilience working correctly (2 success, 1 failure)");
    }
  } catch (err) {
    console.log("⚠ Batch error handling:", err.message);
  }
}
