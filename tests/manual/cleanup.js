/**
 * cleanup.js
 *
 * Standalone cleanup: finds all MCP-Test-* accounts, MCP-Cat-* categories,
 * MCP-Group-* category groups, and MCP-Payee-* payees created by integration
 * tests and removes them. Safe to run repeatedly.
 *
 * This module has no dependency on the test `context` object — it can run
 * independently of any test level.
 */

/**
 * @param {{ callTool: Function }} client
 */
export async function cleanupMcpTestAccounts(client) {
  const { callTool } = client;
  console.log("\n-- Running MCP TEST ACCOUNT CLEANUP --");
  console.log("Scanning for accounts whose name starts with \"MCP-Test-\"...");

  const accounts = await callTool("actual_accounts_list", {});
  const allAccounts = Array.isArray(accounts) ? accounts : [];
  const mcpTestAccounts = allAccounts.filter(a => a.name && a.name.startsWith("MCP-Test-"));
  console.log(`\n✓ Found ${mcpTestAccounts.length} MCP-Test-* account(s)`);
  if (mcpTestAccounts.length === 0) console.log("  (none found)");

  let totalDeleted = 0;
  let closedCount = 0;
  let alreadyClosedCount = 0;

  for (const account of mcpTestAccounts) {
    const closedLabel = account.closed ? " [already closed]" : "";
    console.log(`\nAccount: "${account.name}"${closedLabel}`);
    console.log(`  ID: ${account.id}`);

    if (account.closed) {
      console.log("  ⚠ Already closed — skipping");
      alreadyClosedCount++;
      continue;
    }

    const txns = await callTool("actual_transactions_filter", { accountId: account.id });
    const txnList = Array.isArray(txns) ? txns : [];
    console.log(`  Transactions: ${txnList.length}`);

    let deleted = 0;
    for (const txn of txnList) {
      if (!txn.id) continue;
      await callTool("actual_transactions_delete", { id: txn.id });
      deleted++;
    }
    if (deleted > 0) console.log(`  ✓ Deleted ${deleted} transaction(s)`);
    else console.log(`  (no transactions to delete)`);
    totalDeleted += deleted;

    await callTool("actual_accounts_close", { id: account.id });
    console.log(`  ✓ Account closed`);
    closedCount++;
  }

  // ---------- Rules ----------
  // Rules have no name field — detected by any condition with value starting with "MCP-Rule-"
  console.log("\n-- Scanning for MCP-Rule-* rules --");
  const rulesData = await callTool("actual_rules_get", {});
  const rulesList = rulesData.rules || rulesData.result || rulesData || [];
  const mcpRules = Array.isArray(rulesList)
    ? rulesList.filter(r =>
        Array.isArray(r.conditions) &&
        r.conditions.some(c => c.value && String(c.value).startsWith('MCP-Rule-'))
      )
    : [];
  console.log(`✓ Found ${mcpRules.length} MCP-Rule-* rule(s)`);
  let rulesDeleted = 0;
  for (const rule of mcpRules) {
    const marker = rule.conditions.find(c => c.value && String(c.value).startsWith('MCP-Rule-'))?.value;
    await callTool("actual_rules_delete", { id: rule.id });
    console.log(`  ✓ Deleted rule: condition value="${marker}"`);
    rulesDeleted++;
  }
  if (rulesDeleted === 0) console.log("  (none found)");

  // ---------- Schedules ----------
  console.log("\n-- Scanning for MCP-Schedule-* schedules --");
  let schedulesDeleted = 0;
  try {
    const schedulesData = await callTool('actual_schedules_get', {});
    const schedulesList = schedulesData?.schedules ?? schedulesData?.result?.schedules ?? schedulesData ?? [];
    const mcpSchedules = Array.isArray(schedulesList)
      ? schedulesList.filter(s => s && s.name && s.name.startsWith('MCP-Schedule-'))
      : [];
    console.log(`✓ Found ${mcpSchedules.length} MCP-Schedule-* schedules(s)`);
    for (const sched of mcpSchedules) {
      await callTool('actual_schedules_delete', { id: sched.id });
      console.log(`  ✓ Deleted schedule: "${sched.name}"`);
      schedulesDeleted++;
    }
    if (schedulesDeleted === 0) console.log('  (none found)');
  } catch (err) {
    console.log(`  ⚠ Schedule cleanup skipped (actual_schedules_get unavailable): ${err.message}`);
  }

  // ---------- Categories ----------
  console.log("\n-- Scanning for MCP-Cat-* categories --");
  const catsData = await callTool("actual_categories_get", {});
  const catsResult = catsData.result || catsData || [];
  const flatCats = Array.isArray(catsResult)
    ? catsResult.flatMap(g => (g.categories && Array.isArray(g.categories)) ? g.categories : (g.id ? [g] : []))
    : [];
  const mcpCats = flatCats.filter(c => c && c.id && c.name && c.name.startsWith("MCP-Cat-"));
  console.log(`✓ Found ${mcpCats.length} MCP-Cat-* categorie(s)`);
  let catsDeleted = 0;
  for (const cat of mcpCats) {
    await callTool("actual_categories_delete", { id: cat.id });
    console.log(`  ✓ Deleted category: "${cat.name}"`);
    catsDeleted++;
  }
  if (catsDeleted === 0) console.log("  (none found)");

  // ---------- Category Groups ----------
  console.log("\n-- Scanning for MCP-Group-* category groups --");
  const groupsData = await callTool("actual_category_groups_get", {});
  const groupsList = groupsData.groups || groupsData || [];
  const mcpGroups = Array.isArray(groupsList)
    ? groupsList.filter(g => g && g.id && g.name && g.name.startsWith("MCP-Group-"))
    : [];
  console.log(`✓ Found ${mcpGroups.length} MCP-Group-* group(s)`);
  let groupsDeleted = 0;
  for (const grp of mcpGroups) {
    await callTool("actual_category_groups_delete", { id: grp.id });
    console.log(`  ✓ Deleted category group: "${grp.name}"`);
    groupsDeleted++;
  }
  if (groupsDeleted === 0) console.log("  (none found)");

  // ---------- Payees ----------
  console.log("\n-- Scanning for MCP-Payee-* payees --");
  const payeesData = await callTool("actual_payees_get", {});
  const payeesList = payeesData.result || payeesData || [];
  const mcpPayees = Array.isArray(payeesList)
    ? payeesList.filter(p => p && p.id && p.name && p.name.startsWith("MCP-Payee"))
    : [];
  console.log(`✓ Found ${mcpPayees.length} MCP-Payee-* payee(s)`);
  let payeesDeleted = 0;
  for (const payee of mcpPayees) {
    await callTool("actual_payees_delete", { id: payee.id });
    console.log(`  ✓ Deleted payee: "${payee.name}"`);
    payeesDeleted++;
  }
  if (payeesDeleted === 0) console.log("  (none found)");

  // Summary
  console.log(`\n========================================`);
  console.log(`CLEANUP SUMMARY`);
  console.log(`========================================`);
  console.log(`  Accounts closed:          ${closedCount}`);
  console.log(`  Transactions deleted:      ${totalDeleted}`);
  console.log(`  Already closed (skipped):  ${alreadyClosedCount}`);
  console.log(`  Rules deleted:             ${rulesDeleted}`);
  console.log(`  Schedules deleted:         ${schedulesDeleted}`);
  console.log(`  Categories deleted:        ${catsDeleted}`);
  console.log(`  Category groups deleted:   ${groupsDeleted}`);
  console.log(`  Payees deleted:            ${payeesDeleted}`);

  // Post-cleanup verification — accounts
  console.log(`\n-- Verifying account state post-cleanup --`);
  const accountsAfter = await callTool("actual_accounts_list", {});
  const mcpAfter = (Array.isArray(accountsAfter) ? accountsAfter : [])
    .filter(a => a.name && a.name.startsWith("MCP-Test-"));

  let verifyFailed = 0;
  for (const a of mcpAfter) {
    if (a.closed) console.log(`  ✓ [CLOSED] "${a.name}"`);
    else { console.log(`  ❌ [STILL OPEN] "${a.name}" (id: ${a.id})`); verifyFailed++; }
  }
  if (mcpAfter.length === 0) console.log(`  (no MCP-Test-* accounts found in budget)`);
  else if (verifyFailed === 0) console.log(`\n✓ All ${mcpAfter.length} MCP-Test-* account(s) confirmed closed.`);
  else console.log(`\n❌ ${verifyFailed} account(s) are still open — manual intervention may be needed.`);

  // Post-cleanup verification — categories, groups, payees
  console.log(`\n-- Verifying category/group/payee state post-cleanup --`);

  const catsAfterResult = (await callTool("actual_categories_get", {})).result || [];
  const flatCatsAfter = Array.isArray(catsAfterResult)
    ? catsAfterResult.flatMap(g => (g.categories && Array.isArray(g.categories)) ? g.categories : (g.id ? [g] : []))
    : [];
  const mcpCatsAfter = flatCatsAfter.filter(c => c && c.id && c.name && c.name.startsWith("MCP-Cat-"));
  if (mcpCatsAfter.length === 0) console.log(`  ✓ No MCP-Cat-* categories remain`);
  else mcpCatsAfter.forEach(c => console.log(`  ❌ [STILL EXISTS] category: "${c.name}"`));

  const groupsAfterData = await callTool("actual_category_groups_get", {});
  const groupsAfterList = groupsAfterData.groups || groupsAfterData || [];
  const mcpGroupsAfter = Array.isArray(groupsAfterList)
    ? groupsAfterList.filter(g => g && g.id && g.name && g.name.startsWith("MCP-Group-"))
    : [];
  if (mcpGroupsAfter.length === 0) console.log(`  ✓ No MCP-Group-* category groups remain`);
  else mcpGroupsAfter.forEach(g => console.log(`  ❌ [STILL EXISTS] group: "${g.name}"`));

  const payeesAfterData = await callTool("actual_payees_get", {});
  const payeesAfterList = payeesAfterData.result || payeesAfterData || [];
  const mcpPayeesAfter = Array.isArray(payeesAfterList)
    ? payeesAfterList.filter(p => p && p.id && p.name && p.name.startsWith("MCP-Payee"))
    : [];
  if (mcpPayeesAfter.length === 0) console.log(`  ✓ No MCP-Payee-* payees remain`);
  else mcpPayeesAfter.forEach(p => console.log(`  ❌ [STILL EXISTS] payee: "${p.name}"`));
  const rulesAfterData = await callTool("actual_rules_get", {});
  const rulesAfterList = rulesAfterData.rules || rulesAfterData.result || rulesAfterData || [];
  const mcpRulesAfter = Array.isArray(rulesAfterList)
    ? rulesAfterList.filter(r =>
        Array.isArray(r.conditions) &&
        r.conditions.some(c => c.value && String(c.value).startsWith('MCP-Rule-'))
      )
    : [];
  if (mcpRulesAfter.length === 0) console.log(`  ✓ No MCP-Rule-* rules remain`);
  else mcpRulesAfter.forEach(r => {
    const marker = r.conditions.find(c => c.value && String(c.value).startsWith('MCP-Rule-'))?.value;
    console.log(`  ❌ [STILL EXISTS] rule: condition value="${marker}"`);
  });}
