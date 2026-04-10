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

  // Hoist timestamp to function scope — used by both the disposable category block and
  // the transfer test category created below.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  // Ensure we have an expense categoryId — fetch fallback from live server if context was cleared.
  // Income categories cannot have budgeted amounts or carryover (Actual rejects them).
  // If no expense category exists at all, create a disposable one for the budget tests.
  // Also resolve xferGroupId here so we can create a second category for the transfer test
  // without a second round-trip that might miss freshly created categories.
  let budgetOwnedGroupId = null;  // set if we created a group here (cleaned up at end)
  let budgetOwnedCatId = null;    // set if we created a category here (cleaned up at end)
  let budgetXferCatId = null;     // second disposable category for transfer test (cleaned up at end)
  let xferGroupId = null;         // group_id for context.categoryId — used to create budgetXferCatId

  // Always fetch categories to resolve group membership, even when context.categoryId is
  // already set (the previous category test may have deleted its category, leaving a stale ID).
  const catData = await callTool("actual_categories_get", {});
  const raw = catData.result || catData.categories || catData;
  const allGroups = Array.isArray(raw) ? raw.filter(g => !g.is_income) : [];
  const flatCats = allGroups.flatMap(g => g.categories || [g]).filter(c => c && c.id && !c.hidden);

  if (!context.categoryId || !flatCats.some(c => c.id === context.categoryId)) {
    // context.categoryId is absent or stale — resolve from live data
    const firstCat = flatCats[0];
    if (firstCat) {
      context.categoryId = firstCat.id;
      xferGroupId = firstCat.group_id ?? allGroups.find(g => (g.categories || []).some(c => c.id === firstCat.id))?.id ?? null;
      console.log(`  ℹ Using existing category for budget tests: "${firstCat.name}" (${firstCat.id})`);
    } else {
      // No expense category in this budget — create a disposable one so tests can run.
      console.log("  ℹ No expense category found — creating disposable category group + category for budget tests...");
      const newGroup = await callTool("actual_category_groups_create", { name: `MCP-BudgetTest-Group-${ts}` });
      budgetOwnedGroupId = newGroup.id || newGroup.result || newGroup;
      console.log(`  ✓ Created disposable category group: ${budgetOwnedGroupId}`);

      const newCat = await callTool("actual_categories_create", {
        name: `MCP-BudgetTest-Cat-${ts}`,
        group_id: budgetOwnedGroupId,
      });
      budgetOwnedCatId = newCat.categoryId || newCat.id || newCat.result || newCat;
      context.categoryId = budgetOwnedCatId;
      xferGroupId = budgetOwnedGroupId;  // already known — no second lookup needed
      console.log(`  ✓ Created disposable category: ${budgetOwnedCatId}`);
    }
  } else {
    // context.categoryId is valid — find its group from the live data
    xferGroupId = allGroups.find(g => (g.categories || []).some(c => c.id === context.categoryId))?.id ?? null;
  }

  // Create a second disposable category for the transfer test.
  // xferGroupId was resolved above without an extra round-trip.
  if (xferGroupId) {
    const xferRes = await callTool("actual_categories_create", {
      name: `MCP-BudgetXfer-${ts}`,
      group_id: xferGroupId,
    });
    budgetXferCatId = xferRes.categoryId || xferRes.id || xferRes.result || xferRes;
    console.log(`  ✓ Created second disposable category for transfer test: ${budgetXferCatId}`);
  } else {
    console.log("  ⚠ Could not resolve owning group for context.categoryId — transfer test will be skipped");
  }

  const currentDate = new Date().toISOString().split('T')[0].substring(0, 7); // YYYY-MM

  // ── 1. actual_budgets_list_available ──────────────────────────────────────
  console.log("\nTesting actual_budgets_list_available...");
  let availableBudgets = [];
  let originalBudgetName = null;
  try {
    const listRes = await callTool("actual_budgets_list_available", {});
    if (listRes && Array.isArray(listRes.budgets) && typeof listRes.count === 'number') {
      availableBudgets = listRes.budgets;
      originalBudgetName = availableBudgets.length > 0 ? availableBudgets[0].name : null;
      console.log(`✓ actual_budgets_list_available: returned ${listRes.count} budget(s)`);
      if (listRes.count > 0) {
        const b = listRes.budgets[0];
        if (b.name && b.syncId && b.serverUrl && typeof b.hasEncryption === 'boolean') {
          console.log(`  ✓ First budget shape OK: name="${b.name}", syncId=${b.syncId}`);
        } else {
          console.log("  ❌ First budget missing expected fields:", JSON.stringify(b));
        }
      }
    } else {
      console.log("  ❌ actual_budgets_list_available: unexpected shape:", JSON.stringify(listRes).slice(0, 200));
    }
  } catch (err) {
    console.log("  ❌ actual_budgets_list_available threw:", err.message);
  }

  // ── 2. actual_budgets_switch (positive — prefer third budget if available, else second) ─
  console.log("\nTesting actual_budgets_switch (positive)...");
  const alternateBudget = availableBudgets.length > 2 ? availableBudgets[2]
    : (availableBudgets.length > 1 ? availableBudgets[1] : availableBudgets[0]);
  let switchedToAlternate = false;
  if (alternateBudget) {
    try {
      const switchRes = await callTool("actual_budgets_switch", { budgetName: alternateBudget.name });
      if (switchRes?.success === true && switchRes?.budgetName && switchRes?.budgetId && switchRes?.serverUrl) {
        switchedToAlternate = availableBudgets.length > 1;
        console.log(`  ✓ actual_budgets_switch: switched to "${switchRes.budgetName}" (${switchRes.budgetId})`);
        if (availableBudgets.length === 1) {
          console.log("  ℹ only one budget configured — switched to same budget to verify mechanism");
        }
      } else {
        console.log("  ❌ actual_budgets_switch: unexpected response:", JSON.stringify(switchRes).slice(0, 200));
      }
    } catch (err) {
      console.log("  ❌ actual_budgets_switch threw:", err.message);
    }
  } else {
    console.log("  ℹ actual_budgets_switch (positive): no budgets available — skipped");
  }

  // ── 3. Get last 5 transactions in current budget (confirms switch context) ─
  console.log("\nGetting last 5 transactions in switched budget (post-switch)...");
  try {
    const txRes = await callTool("actual_transactions_filter", { limit: 5 });
    const txArr = Array.isArray(txRes) ? txRes : (txRes?.transactions ?? txRes?.result ?? []);
    console.log(`  ✓ Retrieved ${txArr.length} transaction(s) from switched budget`);
    for (const tx of txArr.slice(0, 5)) {
      const date = tx.date ?? '?';
      const amount = typeof tx.amount === 'number' ? (tx.amount / 100).toFixed(2) : '?';
      const payee = tx.payee_name ?? tx.payee ?? '(no payee)';
      console.log(`    • ${date}  ${amount}  ${payee}`);
    }
  } catch (err) {
    console.log("  ⚠ Could not fetch transactions after switch:", err.message);
  }

  // ── 4. actual_budgets_switch (negative — non-existent budget name) ────────
  console.log("\nTesting actual_budgets_switch (negative — unknown name)...");
  try {
    const badRes = await callTool("actual_budgets_switch", { budgetName: "__nonexistent_budget_MCP_test__" });
    const text = JSON.stringify(badRes);
    if (text.includes("not found") || text.includes("No budget") || text.includes("available") || badRes?.error) {
      console.log("  ✓ actual_budgets_switch [negative]: correctly returned not-found with context");
    } else {
      console.log("  ❌ actual_budgets_switch [negative]: no useful error for unknown name:", text.slice(0, 200));
    }
  } catch (err) {
    if (err.message.includes("not found") || err.message.includes("No budget") || err.message.includes("available")) {
      console.log("  ✓ actual_budgets_switch [negative]: threw with useful message");
    } else {
      console.log("  ❌ actual_budgets_switch [negative]: unhelpful error:", err.message);
    }
  }

  // ── 5. Switch back to original budget before mutation tests ───────────────
  if (originalBudgetName && switchedToAlternate) {
    console.log(`\nSwitching back to original budget "${originalBudgetName}" before continuing...`);
    try {
      const backRes = await callTool("actual_budgets_switch", { budgetName: originalBudgetName });
      if (backRes?.success === true) {
        console.log(`  ✓ Switched back to "${backRes.budgetName}"`);
      } else {
        console.log("  ❌ Failed to switch back:", JSON.stringify(backRes).slice(0, 200));
      }
    } catch (err) {
      console.log("  ❌ Switch-back threw:", err.message);
    }
  }

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

  // B4: budgets_setAmount with non-existent categoryId — pre-flight rejects nil/unknown UUIDs
  // Pre-flight validation is inside adapter.setBudgetAmount() — nil and unknown UUIDs both rejected.
  console.log("\nNEGATIVE B4: budgets_setAmount with non-existent categoryId...");
  {
    try {
      const badRes = await callTool("actual_budgets_setAmount", {
        month: currentDate,
        categoryId: "00000000-0000-0000-0000-000000000000",
        amount: 99999,
      });
      if (typeof badRes?.error === 'string') {
        console.log(`  ✓ B4: error returned for nil-UUID categoryId: ${badRes.error.slice(0, 120)}`);
      } else {
        console.log(`  ⚠ B4: unexpected response (API may have accepted nil UUID): ${JSON.stringify(badRes).slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`  ✓ B4: API rejected nil-UUID categoryId (threw): ${String(e).slice(0, 120)}`);
    }
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
  await callTool("actual_budgets_resetHold", { month: currentDate });
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
  const targetCategoryId = budgetXferCatId;
  if (!targetCategoryId || targetCategoryId === context.categoryId) {
    console.log("⚠ Skipping transfer test (could not create second category)");
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
  console.log("\nREGRESSION: Testing batch error resilience (invalid-date should be rejected by Zod)...");
  const mixedBatch = [
    { month: currentDate, categoryId: context.categoryId, amount: 70000 },       // valid
    { month: "invalid-date", categoryId: context.categoryId, amount: 80000 },    // invalid month — Zod should reject
    { month: currentDate, categoryId: context.categoryId, amount: 90000 },       // valid
  ];
  try {
    const mixedResult = await callTool("actual_budget_updates_batch", { operations: mixedBatch });
    console.log("❌ REGRESSION FAILED: batch accepted invalid-date (Zod month regex not enforced):", mixedResult);
  } catch (err) {
    if (err.message.includes("YYYY-MM") || err.message.includes("invalid-date") || err.message.includes("month")) {
      console.log("✓ Error resilience: invalid-date correctly rejected by schema validation");
    } else {
      console.log("⚠ Batch rejected but with unexpected error:", err.message);
    }
  }

  // Clean up the second disposable category created for the transfer test.
  if (budgetXferCatId) {
    try {
      await callTool("actual_categories_delete", { id: budgetXferCatId });
      console.log(`\n✓ Cleaned up budget transfer test category (${budgetXferCatId})`);
    } catch (err) {
      console.log(`\n  ⚠ Could not delete budget transfer category ${budgetXferCatId}: ${err.message}`);
    }
  }

  // Clean up any disposable category/group we created at the start of this test.
  if (budgetOwnedCatId) {
    try {
      await callTool("actual_categories_delete", { id: budgetOwnedCatId });
      console.log(`\n✓ Cleaned up disposable budget-test category (${budgetOwnedCatId})`);
    } catch (err) {
      console.log(`\n  ⚠ Could not delete disposable category ${budgetOwnedCatId}: ${err.message}`);
    }
    context.categoryId = null;
  }
  if (budgetOwnedGroupId) {
    try {
      await callTool("actual_category_groups_delete", { id: budgetOwnedGroupId });
      console.log(`✓ Cleaned up disposable budget-test category group (${budgetOwnedGroupId})`);
    } catch (err) {
      console.log(`  ⚠ Could not delete disposable category group ${budgetOwnedGroupId}: ${err.message}`);
    }
  }

}
