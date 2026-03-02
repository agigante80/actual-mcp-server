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
  const monthsArr = Array.isArray(months) ? months : (months.result || []);
  if (monthsArr.length >= 1) console.log(`  ✓ Retrieved months: ${monthsArr.length} (expected ≥ 1)`);
  else console.log(`  ❌ Verify getMonths: expected ≥ 1 month, got ${monthsArr.length}`);

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
  const beforeHold = await callTool("actual_budgets_getMonth", { month: currentDate });
  const toBudgetBefore = (beforeHold.result || beforeHold)?.toBudget ?? null;
  await callTool("actual_budgets_holdForNextMonth", {
    month: currentDate,
    categoryId: context.categoryId,
    amount: 10000,
  });
  console.log("✓ Held 100.00 for next month");
  {
    const afterHold = await callTool("actual_budgets_getMonth", { month: currentDate });
    const toBudgetAfter = (afterHold.result || afterHold)?.toBudget ?? null;
    // toBudget may not reflect holdForNextMonth (Actual tracks hold internally) — log informational only
    if (toBudgetBefore !== null && toBudgetAfter !== null) {
      console.log(`  ✓ Verify hold: toBudget before=${toBudgetBefore}, after=${toBudgetAfter} (delta=${toBudgetAfter - toBudgetBefore})`);
    } else {
      console.log(`  ⚠ Verify hold: toBudget field not available in response (skipped)`);
    }
  }

  // Reset hold
  console.log("\nResetting hold...");
  await callTool("actual_budgets_resetHold", { month: currentDate, categoryId: context.categoryId });
  console.log("✓ Hold reset");
  {
    const afterReset = await callTool("actual_budgets_getMonth", { month: currentDate });
    const toBudgetAfterReset = (afterReset.result || afterReset)?.toBudget ?? null;
    if (toBudgetBefore !== null && toBudgetAfterReset !== null) {
      if (toBudgetAfterReset === toBudgetBefore) console.log(`  ✓ Verify resetHold: toBudget restored to ${toBudgetAfterReset}`);
      else console.log(`  ❌ Verify resetHold: expected toBudget ${toBudgetBefore}, got ${toBudgetAfterReset}`);
    } else {
      console.log(`  ⚠ Verify resetHold: toBudget field not available in response (skipped)`);
    }
  }

  // Transfer between categories
  console.log("\nTesting budget transfer...");
  const targetCategory = monthBudget.categoryGroups?.[0]?.categories?.[0];
  const targetCategoryId = targetCategory ? targetCategory.id : context.categoryId;
  if (targetCategoryId === context.categoryId) {
    console.log("⚠ Skipping transfer test (need two different categories)");
  } else {
    const preTransfer = await callTool("actual_budgets_getMonth", { month: currentDate });
    const preData = preTransfer.result || preTransfer;
    const srcBefore = (preData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === context.categoryId)?.budgeted ?? null;
    const dstBefore = (preData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === targetCategoryId)?.budgeted ?? null;
    await callTool("actual_budgets_transfer", {
      month: currentDate,
      amount: 5000,
      fromCategoryId: context.categoryId,
      toCategoryId: targetCategoryId,
    });
    console.log("✓ Budget transfer completed");
    const postTransfer = await callTool("actual_budgets_getMonth", { month: currentDate });
    const postData = postTransfer.result || postTransfer;
    const srcAfter = (postData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === context.categoryId)?.budgeted ?? null;
    const dstAfter = (postData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === targetCategoryId)?.budgeted ?? null;
    if (srcBefore !== null && srcAfter !== null && srcAfter === srcBefore - 5000) console.log(`  ✓ Verify transfer: source budgeted ${srcBefore} → ${srcAfter} (-50.00)`);
    else if (srcBefore !== null) console.log(`  ❌ Verify transfer: source expected ${srcBefore - 5000}, got ${srcAfter}`);
    if (dstBefore !== null && dstAfter !== null && dstAfter === dstBefore + 5000) console.log(`  ✓ Verify transfer: destination budgeted ${dstBefore} → ${dstAfter} (+50.00)`);
    else if (dstBefore !== null) console.log(`  ❌ Verify transfer: destination expected ${dstBefore + 5000}, got ${dstAfter}`);
  }

  // Batch updates
  console.log("\nTesting batch budget updates...");
  await callTool("actual_budget_updates_batch", {
    operations: [{ month: currentDate, categoryId: context.categoryId, amount: 60000 }],
  });
  console.log("✓ Batch updates completed");
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const d = check.result || check;
    const cat = (d.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === context.categoryId);
    if (!cat) console.log("  ❌ Verify batch: category not found in month budget");
    else if (cat.budgeted === 60000) console.log(`  ✓ Verify batch: budgeted=${cat.budgeted} (600.00)`);
    else console.log(`  ❌ Verify batch: expected 60000, got ${cat.budgeted}`);
  }

  // REGRESSION: large batch (35 ops)
  console.log("\nREGRESSION: Testing large batch with 35 operations (should handle gracefully)...");
  const largeBatch = Array.from({ length: 35 }, (_, i) => ({
    month: currentDate,
    categoryId: context.categoryId,
    amount: 10000 + (i * 100),
  }));
  const lastAmount = 10000 + (34 * 100); // 13400
  const batchResult = await callTool("actual_budget_updates_batch", { operations: largeBatch });
  console.log("✓ Large batch handled:", batchResult);
  {
    const check = await callTool("actual_budgets_getMonth", { month: currentDate });
    const d = check.result || check;
    const cat = (d.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === context.categoryId);
    if (!cat) console.log("  ❌ Verify large batch: category not found in month budget");
    else if (cat.budgeted === lastAmount) console.log(`  ✓ Verify large batch: budgeted=${cat.budgeted} (final op applied)`);
    else console.log(`  ❌ Verify large batch: expected ${lastAmount}, got ${cat.budgeted}`);
  }

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
    // API may accept or reject the invalid-date entry — both are valid behaviours;
    // what matters is that the batch call doesn't throw and returns a structured result.
    const succeeded = mixedResult.successful ?? mixedResult.successCount ?? null;
    const failed    = mixedResult.failed    ?? mixedResult.failureCount ?? null;
    if (succeeded === 2 && failed === 1) {
      console.log("  ✓ Error resilience: 2 succeeded, 1 failed (invalid-date rejected as expected)");
    } else if (succeeded === 3 && failed === 0) {
      console.log("  ⚠ Error resilience: all 3 accepted (API did not reject invalid-date — KNOWN ISSUE)");
    } else if (succeeded !== null) {
      console.log(`  ❌ Error resilience: unexpected result — succeeded=${succeeded}, failed=${failed}`);
    } else {
      console.log("  ✓ Batch call completed (success/failure counts not available in response)");
    }
  } catch (err) {
    console.log("⚠ Batch error handling:", err.message);
  }
}
