import { fail } from '../assert.js';
/**
 * tests/budget.js
 *
 * BUDGET TESTS: get months, set amounts, carryover, hold, transfer, batch.
 * Regression tests for large batch (35 ops) and batch error resilience.
 *
 * Reads from context:  (none; #591: it creates its own categories, see below)
 * Writes to context:   (none)
 */

/** YYYY-MM of the month after `m`. */
function monthAfter(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

/**
 * #591: `budgeted` and `carryover` of every category in `months`, keyed `month|categoryId`.
 * Taken before the first write and again after cleanup, it is the live check that this module
 * changed no amount on a category it did not create (the residue sweep only sees additions).
 */
async function snapshotMonthCells(callTool, months) {
  const cells = new Map();
  for (const month of months) {
    const res = await callTool("actual_budgets_getMonth", { month });
    const data = res?.result || res;
    for (const group of data?.categoryGroups || []) {
      for (const cat of group.categories || []) {
        cells.set(`${month}|${cat.id}`, { budgeted: cat.budgeted, carryover: cat.carryover });
      }
    }
  }
  return cells;
}

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function budgetTests(client, context) {
  const { callTool } = client;
  console.log("\n-- Running BUDGET TESTS --");

  // Hoist timestamp to function scope: used by both the disposable category block and
  // the transfer test category created below.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  // #591: every budget write in this module (amounts, carryover, the transfer source, both
  // batches) goes to a category the module CREATED, never to a pre-existing one. It used to
  // borrow the budget's first expense category when context.categoryId was null, which at `full`
  // is always (category.js deletes its own category first), and leave that real category's month
  // budget at whatever the last test wrote. The zero-residue sweep cannot see a changed amount on
  // an object the suite did not add, so the drift was silent. A borrowed id an earlier module left
  // in context.categoryId is just as real, so this module neither reads nor writes that slot.
  //
  // Both categories live in a disposable group the module creates, never in a user's group, so
  // nothing here depends on the shape of the category listing and a leak can only ever be MCP-*
  // objects the residue sweep recognises. Expense, not income: Actual rejects budgeted amounts
  // and carryover on income categories, and a new group is an expense group. Everything the
  // module created is deleted in the finally below, whether the body finished or threw.
  let budgetOwnedGroupId = null;  // the disposable group both categories live in
  let budgetCatId = null;         // the category every budget write targets
  let budgetXferCatId = null;     // second disposable category for the transfer test

  // Snapshot of every category's month cells, taken after the budget-switch steps below and
  // before anything is created; null until then, so the compare in the finally is skipped.
  const snapshotMonths = [new Date().toISOString().slice(0, 7)];
  snapshotMonths.push(monthAfter(snapshotMonths[0]));
  let cellsBefore = null;

  try {
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
            fail(["First budget missing expected fields:", JSON.stringify(b)].map(String).join(" "));
          }
        }
      } else {
        fail(["actual_budgets_list_available: unexpected shape:", JSON.stringify(listRes).slice(0, 200)].map(String).join(" "));
      }
    } catch (err) {
      fail(["actual_budgets_list_available threw:", err.message].map(String).join(" "));
    }

    // #348: stdio CAN now switch budgets, so these assertions run on both transports.
    //
    // Until #348 the stdio process never entered a requestContext scope, so it had no
    // sessionId, no slot in the per-session budget map, and actual_budgets_switch
    // refused outright (#280 skipped these assertions for that reason). stdioServer.ts
    // now mints a synthetic per-process session id, which gives stdio its own slot
    // without reintroducing the process-global that #156 removed.
    //
    // The SKIP_SWITCH flag is GONE rather than set to false. A constant-false flag
    // leaves both branches dead while reading as though one is still live: the
    // sessionless branch below could never run, so a transport that genuinely lacked
    // sessions would fall through to fail() instead of the message that flag implied.

    // ── 2. actual_budgets_switch (positive) ──────────────────────────────────
    // Prefer a SAME-SERVER alternate budget so the test exercises the #172
    // fast path (no upstream re-auth) rather than hammering the Actual server's
    // login rate limiter on every cross-server switch. Fall back to any other
    // budget if no same-server alternate exists.
    console.log("\nTesting actual_budgets_switch (positive)...");
    const firstBudget = availableBudgets[0];
    const sameServerAlternate = availableBudgets.find(
      (b, i) => i > 0 && firstBudget && b.serverUrl === firstBudget.serverUrl,
    );
    const alternateBudget = sameServerAlternate
      || (availableBudgets.length > 1 ? availableBudgets[1] : availableBudgets[0]);
    let switchedToAlternate = false;
    if (alternateBudget) {
      try {
        const switchRes = await callTool("actual_budgets_switch", { budgetName: alternateBudget.name });
        if (switchRes?.success === true && switchRes?.budgetName && switchRes?.budgetId && switchRes?.serverUrl) {
          switchedToAlternate = availableBudgets.length > 1;
          console.log(`  ✓ actual_budgets_switch: switched to "${switchRes.budgetName}" (${switchRes.budgetId})`);
          if (availableBudgets.length === 1) {
            console.log("  ℹ only one budget configured: switched to same budget to verify mechanism");
          }
        } else {
          fail(["actual_budgets_switch: unexpected response:", JSON.stringify(switchRes).slice(0, 200)].map(String).join(" "));
        }
      } catch (err) {
        fail(["actual_budgets_switch threw:", err.message].map(String).join(" "));
      }
    } else {
      console.log("  ℹ actual_budgets_switch (positive): no budgets available: skipped");
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
      fail(`Could not fetch transactions after the budget switch: ${err.message}`);
    }

    // ── 4. actual_budgets_switch (negative: non-existent budget name) ────────
    console.log("\nTesting actual_budgets_switch (negative: unknown name)...");
    try {
      const badRes = await callTool("actual_budgets_switch", { budgetName: "__nonexistent_budget_MCP_test__" });
      const text = JSON.stringify(badRes);
      if (text.includes("not found") || text.includes("No budget") || text.includes("available") || badRes?.error) {
        console.log("  ✓ actual_budgets_switch [negative]: correctly returned not-found with context");
      } else {
        fail(["actual_budgets_switch [negative]: no useful error for unknown name:", text.slice(0, 200)].map(String).join(" "));
      }
    } catch (err) {
      if (err.message.includes("requires an MCP session")) {
        // Reachable only from a genuinely sessionless caller. Since #348 both
        // transports have a session, so this is a real failure rather than the
        // documented stdio behaviour it used to be.
        fail("actual_budgets_switch: the caller had no MCP session; since #348 both transports should have one");
      } else if (err.message.includes("not found") || err.message.includes("No budget") || err.message.includes("available")) {
        console.log("  ✓ actual_budgets_switch [negative]: threw with useful message");
      } else {
        fail(["actual_budgets_switch [negative]: unhelpful error:", err.message].map(String).join(" "));
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
          fail(["Failed to switch back:", JSON.stringify(backRes).slice(0, 200)].map(String).join(" "));
        }
      } catch (err) {
        fail(["Switch-back threw:", err.message].map(String).join(" "));
      }
    }

    // #591 round 2: the snapshot and the creates come AFTER the switch steps above. Taken
    // before them, a session that started on another budget (a persisted preference, or a
    // switch-back that failed) snapshotted and created in one budget and wrote and compared in
    // another: a false drift failure, plus the MCP-* group left behind in the first budget.
    // Nothing after this point switches budgets.
    cellsBefore = await snapshotMonthCells(callTool, snapshotMonths);
    if (cellsBefore.size === 0) {
      fail('Budget tests: the month snapshot read no category cells, so the amount-drift check cannot see anything (every real budget has at least an income category)');
    }

    const newGroup = await callTool("actual_category_groups_create", { name: `MCP-BudgetTest-Group-${ts}` });
    budgetOwnedGroupId = newGroup.id || newGroup.result || newGroup;
    console.log(`  ✓ Created disposable category group for budget tests: ${budgetOwnedGroupId}`);

    const newCat = await callTool("actual_categories_create", {
      name: `MCP-BudgetTest-Cat-${ts}`,
      group_id: budgetOwnedGroupId,
    });
    budgetCatId = newCat.categoryId || newCat.id || newCat.result || newCat;
    console.log(`  ✓ Created disposable category for budget writes: ${budgetCatId}`);

    const xferRes = await callTool("actual_categories_create", {
      name: `MCP-BudgetXfer-${ts}`,
      group_id: budgetOwnedGroupId,
    });
    budgetXferCatId = xferRes.categoryId || xferRes.id || xferRes.result || xferRes;
    console.log(`  ✓ Created second disposable category for transfer test: ${budgetXferCatId}`);

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
    else fail(`Verify getMonths: expected ≥ 1 month, got ${monthsArr.length}`);

    // Set amount
    console.log("\nSetting budget amount...");
    await callTool("actual_budgets_setAmount", {
      month: currentDate,
      categoryId: budgetCatId,
      amount: 50000,
    });
    console.log("✓ Budget amount set to 500.00");

    // Verify setAmount
    {
      const check = await callTool("actual_budgets_getMonth", { month: currentDate });
      const monthData = check.result || check;
      const catEntry = (monthData.categoryGroups || [])
        .flatMap(g => g.categories || [])
        .find(c => c.id === budgetCatId);
      if (!catEntry) fail("Verify setAmount: category not found in month budget");
      else if (catEntry.budgeted === 50000) console.log(`  ✓ Verify setAmount: budgeted=${catEntry.budgeted} (500.00)`);
      else fail(`Verify setAmount: expected 50000, got ${catEntry.budgeted}`);
    }

    // B4: budgets_setAmount with non-existent categoryId: pre-flight rejects nil/unknown UUIDs
    // Pre-flight validation is inside adapter.setBudgetAmount(): nil and unknown UUIDs both rejected.
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
          fail(`B4: unexpected response, the API may have accepted the nil UUID: ${JSON.stringify(badRes).slice(0, 120)}`);
        }
      } catch (e) {
        console.log(`  ✓ B4: API rejected nil-UUID categoryId (threw): ${String(e).slice(0, 120)}`);
      }
    }

    // Carryover
    console.log("\nSetting carryover...");
    await callTool("actual_budgets_setCarryover", {
      month: currentDate,
      categoryId: budgetCatId,
      flag: true,
    });
    console.log("✓ Carryover enabled");

    // Verify carryover
    {
      const check = await callTool("actual_budgets_getMonth", { month: currentDate });
      const monthData = check.result || check;
      const catEntry = (monthData.categoryGroups || [])
        .flatMap(g => g.categories || [])
        .find(c => c.id === budgetCatId);
      if (!catEntry) fail("Verify carryover: the category is not in the month budget, so the carryover check did not run at all.");
      else if (catEntry.carryover === true || catEntry.carryover === 1) console.log(`  ✓ Verify carryover: carryover=${catEntry.carryover} (enabled)`);
      else fail(`Verify carryover: carryover=${JSON.stringify(catEntry.carryover)} after enabling it. "The API may use a different field" is a question this test exists to answer.`);
    }

    // Hold for next month
    //
    // #369 item 1: this block used to pass on success OR on a /nothing was held/ refusal,
    // because the run could be pointed at any budget and To Budget was unknown. That made it
    // a check that CANNOT FAIL: a regression to always-refusing stayed green.
    //
    // The fixture is controllable. An on-budget account created with a positive starting
    // balance books that balance as INCOME for the month, and To Budget is computed from
    // income minus what is already allocated, so seeding one guarantees the success branch.
    console.log("\nHolding budget for next month...");
    const HOLD_AMOUNT = 10000;
    const holdSeedAccount = await callTool("actual_accounts_create", {
      name: `Hold-Seed-${Date.now()}`,
      balance: 500000,
    });
    const holdSeedId = (holdSeedAccount && holdSeedAccount.result) || holdSeedAccount;

    try {
      const beforeHold = await callTool("actual_budgets_getMonth", { month: currentDate });
      const beforeMonth = (beforeHold.result || beforeHold) ?? {};
      const toBudgetBefore = Number(beforeMonth.toBudget ?? 0);
      const heldBefore = Number(beforeMonth.forNextMonth ?? 0);
      // Failures route through fail() so they reach the runner's ledger (#281).
      const holdCheck = (cond, msg) => {
        if (cond) console.log(`  ✓ ${msg}`);
        else fail(`actual_budgets_holdForNextMonth: ${msg}`);
      };

      holdCheck(
        toBudgetBefore > HOLD_AMOUNT,
        `seeded income leaves more to budget (${toBudgetBefore}) than the hold asks for (${HOLD_AMOUNT})`,
      );
      // Upstream `resetHold` is `setBuffer(month, 0)`: it ZEROES the buffer, it does not
      // restore a previous value. So the two reset assertions below are only correct while
      // the month starts with no hold. Asserting that as a PRECONDITION makes them correct by
      // construction, and turns the one way this can go wrong into an accurate diagnosis: if
      // an earlier run died between the hold and its teardown (the runner's wall-clock
      // kill-switch exits 2), the leftover buffer would otherwise fail the reset checks and
      // blame a tool that behaved correctly. Month-level budget state is invisible to the
      // zero-residue sweep, so nothing else would report it.
      holdCheck(
        heldBefore === 0,
        `the month starts with no hold (found ${heldBefore}); a leftover hold is stale fixture ` +
          'state from an interrupted run, not a tool regression',
      );

      const res = await callTool("actual_budgets_holdForNextMonth", {
        month: currentDate,
        amount: HOLD_AMOUNT,
      });
      const payload = (res && res.result) || res || {};
      holdCheck(payload.held === HOLD_AMOUNT, `held exactly the requested ${HOLD_AMOUNT} cents`);
      holdCheck(!payload.partial, "a hold well inside To Budget is not clamped");

      // And the money actually moved. #355 exists because upstream can hold LESS than asked
      // (it clamps to what is left) or nothing at all, while reporting plain success.
      const afterHold = await callTool("actual_budgets_getMonth", { month: currentDate });
      const afterMonth = (afterHold.result || afterHold) ?? {};
      holdCheck(
        Number(afterMonth.forNextMonth ?? 0) - heldBefore === HOLD_AMOUNT,
        `forNextMonth advanced by exactly ${HOLD_AMOUNT}`,
      );

      // resetHold, asserted HERE rather than after the block, because this is where the
      // seeded income still exists and where the before-values are in scope. Undoing a hold
      // whose exact size we just established is the only place the reset can be checked
      // against a known number.
      console.log("\nResetting hold...");
      await callTool("actual_budgets_resetHold", { month: currentDate });
      const afterReset = await callTool("actual_budgets_getMonth", { month: currentDate });
      const resetMonth = (afterReset.result || afterReset) ?? {};
      holdCheck(
        Number(resetMonth.forNextMonth ?? 0) === heldBefore,
        `resetHold returned forNextMonth to its starting value (${heldBefore})`,
      );
      holdCheck(
        Number(resetMonth.toBudget ?? 0) === toBudgetBefore,
        `resetHold restored toBudget to ${toBudgetBefore}`,
      );
    } finally {
      // Undo BOTH effects, whatever happened, so the budget is left as found.
      //
      // The hold has to be released BEFORE the income is removed, and releasing it is not
      // optional: `forNextMonth` is month-level budget state, which the zero-residue sweep
      // does NOT cover (it looks at accounts, payees, categories and the like), so a
      // leftover hold would silently lower this month's To Budget by HOLD_AMOUNT on every
      // run and nothing would report it. The E2E twin registers the same reset as teardown.
      try {
        await callTool("actual_budgets_resetHold", { month: currentDate });
      } catch (err) {
        fail(`could not reset the hold for ${currentDate}: ${err.message}`);
      }
      try {
        await callTool("actual_accounts_delete", { id: holdSeedId });
      } catch (err) {
        fail(`could not remove the hold seed account ${holdSeedId}: ${err.message}. That is residue.`);
      }
    }

    // Transfer between categories
    console.log("\nTesting budget transfer...");
    // Both ids come from creates above; a failed create throws before this point, so there is
    // no "could not create" skip: a precondition this module builds itself is never a skip.
    const targetCategoryId = budgetXferCatId;
    {
      const preTransfer = await callTool("actual_budgets_getMonth", { month: currentDate });
      const preData = preTransfer.result || preTransfer;
      const srcBefore = (preData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === budgetCatId)?.budgeted ?? null;
      const dstBefore = (preData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === targetCategoryId)?.budgeted ?? null;
      await callTool("actual_budgets_transfer", {
        month: currentDate,
        amount: 5000,
        fromCategoryId: budgetCatId,
        toCategoryId: targetCategoryId,
      });
      console.log("✓ Budget transfer completed");
      const postTransfer = await callTool("actual_budgets_getMonth", { month: currentDate });
      const postData = postTransfer.result || postTransfer;
      const srcAfter = (postData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === budgetCatId)?.budgeted ?? null;
      const dstAfter = (postData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === targetCategoryId)?.budgeted ?? null;
      if (srcBefore !== null && srcAfter !== null && srcAfter === srcBefore - 5000) console.log(`  ✓ Verify transfer: source budgeted ${srcBefore} → ${srcAfter} (-50.00)`);
      else if (srcBefore !== null) fail(`Verify transfer: source expected ${srcBefore - 5000}, got ${srcAfter}`);
      if (dstBefore !== null && dstAfter !== null && dstAfter === dstBefore + 5000) console.log(`  ✓ Verify transfer: destination budgeted ${dstBefore} → ${dstAfter} (+50.00)`);
      else if (dstBefore !== null) fail(`Verify transfer: destination expected ${dstBefore + 5000}, got ${dstAfter}`);

      // #141 negative: insufficient funds. State must be unchanged after rejection.
      console.log("\nTesting budget transfer (negative): insufficient funds rejected atomically");
      const obscene = Math.max((srcAfter ?? 0) * 100, 100_000_000);
      let insufficientErr = null;
      try {
        await callTool("actual_budgets_transfer", {
          month: currentDate,
          amount: obscene,
          fromCategoryId: budgetCatId,
          toCategoryId: targetCategoryId,
        });
        fail(`Insufficient-funds transfer accepted (expected rejection)`);
      } catch (err) {
        insufficientErr = err.message || String(err);
        if (insufficientErr.includes("Insufficient budget")) {
          console.log(`  ✓ Insufficient-funds transfer correctly rejected`);
        } else {
          fail(`Wrong error for insufficient funds: ${insufficientErr}`);
        }
      }
      // Verify state unchanged (atomic rejection, no partial write).
      const postReject = await callTool("actual_budgets_getMonth", { month: currentDate });
      const postRejectData = postReject.result || postReject;
      const srcAfterReject = (postRejectData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === budgetCatId)?.budgeted ?? null;
      const dstAfterReject = (postRejectData.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === targetCategoryId)?.budgeted ?? null;
      if (srcAfterReject === srcAfter && dstAfterReject === dstAfter) {
        console.log(`  ✓ State unchanged after rejection (source=${srcAfterReject}, target=${dstAfterReject})`);
      } else {
        fail(`State changed after rejection (source ${srcAfter} → ${srcAfterReject}, target ${dstAfter} → ${dstAfterReject})`);
      }

      // #141 negative: same source and target rejected at the tool layer.
      console.log("\nTesting budget transfer (negative): same source and target rejected");
      try {
        await callTool("actual_budgets_transfer", {
          month: currentDate,
          amount: 100,
          fromCategoryId: budgetCatId,
          toCategoryId: budgetCatId,
        });
        fail(`Same source and target accepted (expected rejection)`);
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes("Source and target categories must be different")) {
          console.log(`  ✓ Same source and target correctly rejected`);
        } else {
          fail(`Same source and target rejected, but with an unexpected message: ${msg}`);
        }
      }
    }

    // Batch updates
    console.log("\nTesting batch budget updates...");
    await callTool("actual_budget_updates_batch", {
      operations: [{ month: currentDate, categoryId: budgetCatId, amount: 60000 }],
    });
    console.log("✓ Batch updates completed");
    {
      const check = await callTool("actual_budgets_getMonth", { month: currentDate });
      const d = check.result || check;
      const cat = (d.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === budgetCatId);
      if (!cat) fail("Verify batch: category not found in month budget");
      else if (cat.budgeted === 60000) console.log(`  ✓ Verify batch: budgeted=${cat.budgeted} (600.00)`);
      else fail(`Verify batch: expected 60000, got ${cat.budgeted}`);
    }

    // REGRESSION: large batch (35 ops)
    console.log("\nREGRESSION: Testing large batch with 35 operations (should handle gracefully)...");
    const largeBatch = Array.from({ length: 35 }, (_, i) => ({
      month: currentDate,
      categoryId: budgetCatId,
      amount: 10000 + (i * 100),
    }));
    const lastAmount = 10000 + (34 * 100); // 13400
    const batchResult = await callTool("actual_budget_updates_batch", { operations: largeBatch });
    console.log("✓ Large batch handled:", batchResult);
    {
      const check = await callTool("actual_budgets_getMonth", { month: currentDate });
      const d = check.result || check;
      const cat = (d.categoryGroups || []).flatMap(g => g.categories || []).find(c => c.id === budgetCatId);
      if (!cat) fail("Verify large batch: category not found in month budget");
      else if (cat.budgeted === lastAmount) console.log(`  ✓ Verify large batch: budgeted=${cat.budgeted} (final op applied)`);
      else fail(`Verify large batch: expected ${lastAmount}, got ${cat.budgeted}`);
    }

    // REGRESSION: batch error resilience
    console.log("\nREGRESSION: Testing batch error resilience (invalid-date should be rejected by Zod)...");
    const mixedBatch = [
      { month: currentDate, categoryId: budgetCatId, amount: 70000 },       // valid
      { month: "invalid-date", categoryId: budgetCatId, amount: 80000 },    // invalid month: Zod should reject
      { month: currentDate, categoryId: budgetCatId, amount: 90000 },       // valid
    ];
    try {
      const mixedResult = await callTool("actual_budget_updates_batch", { operations: mixedBatch });
      fail(["REGRESSION FAILED: batch accepted invalid-date (Zod month regex not enforced):", mixedResult].map(String).join(" "));
    } catch (err) {
      if (err.message.includes("YYYY-MM") || err.message.includes("invalid-date") || err.message.includes("month")) {
        console.log("✓ Error resilience: invalid-date correctly rejected by schema validation");
      } else {
        fail(`Batch rejected, but with an unexpected error: ${err.message}`);
      }
    }
  } finally {
    // Categories before their group. Each delete is attempted whatever happened above, and a
    // failed one is recorded: an MCP-* object left behind is residue.
    for (const [id, what] of [[budgetXferCatId, 'transfer test category'], [budgetCatId, 'budget-test category']]) {
      if (!id) continue;
      try {
        await callTool("actual_categories_delete", { id });
        console.log(`\n✓ Cleaned up disposable ${what} (${id})`);
      } catch (err) {
        fail(`Could not delete the disposable ${what} ${id}: ${err.message}. That is residue.`);
      }
    }
    if (budgetOwnedGroupId) {
      try {
        await callTool("actual_category_groups_delete", { id: budgetOwnedGroupId });
        console.log(`✓ Cleaned up disposable budget-test category group (${budgetOwnedGroupId})`);
      } catch (err) {
        fail(`Could not delete the disposable category group ${budgetOwnedGroupId}: ${err.message}. That is residue.`);
      }
    }
    // #591: every pre-existing category must end with the amounts it started with.
    if (cellsBefore) try {
      const cellsAfter = await snapshotMonthCells(callTool, snapshotMonths);
      const missing = [...cellsBefore.keys()].filter(key => !cellsAfter.has(key));
      if (missing.length) {
        fail(`Budget tests: ${missing.length} pre-existing category cell(s) are gone after the run (a deleted category, or the session is on another budget): ${missing.join(', ')}`);
      }
      const drift = [...cellsBefore].filter(([key, was]) => {
        const now = cellsAfter.get(key);
        return now && (now.budgeted !== was.budgeted || now.carryover !== was.carryover);
      }).map(([key, was]) => `${key}: was ${JSON.stringify(was)}, now ${JSON.stringify(cellsAfter.get(key))}`);
      if (drift.length) fail(`Budget tests changed ${drift.length} pre-existing category cell(s): ${drift.join('; ')}`);
      else if (!missing.length) console.log(`✓ No pre-existing category amount changed (${cellsBefore.size} cell(s) compared)`);
    } catch (err) {
      fail(`Could not re-read the months to check for amount drift: ${err.message}`);
    }
  }
}
