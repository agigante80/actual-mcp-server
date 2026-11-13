import { fail } from '../assert.js';
/**
 * tests/manual/tests/schedule.js
 *
 * SCHEDULE TESTS: getSchedules, createSchedule, updateSchedule, deleteSchedule.
 *
 * Covers:
 *   positive: list • create one-off • create recurring • update name
 *             update with resetNextDate • delete created schedule
 *             isbetween range round-trip (#527)
 *             monthly last-day pattern: next_date is the month end (#478)
 *             a payee-less schedule LINKS a matching import (#547)
 *   negative: delete non-existent UUID (expect error, not crash)
 *             scalar amount with isbetween refused (#527)
 *             patterns on a weekly schedule refused (#478)
 *
 * Naming pattern: MCP-Schedule-{timestamp}: matched by cleanup.js
 *
 * Reads from context:  (none required)
 * Writes to context:   scheduleOneOffId, scheduleRecurId
 */

const NON_EXISTENT_UUID = '00000000-dead-beef-0000-000000000000';

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function scheduleTests(client, context) {
  const { callTool } = client;
  const timestamp = Date.now();
  console.log('\n-- Running SCHEDULE TESTS --');

  // ── 1. List existing schedules ───────────────────────────────────────────
  console.log('\nListing all schedules (list_entities schedule)...');
  const listResult = await callTool('list_entities', { type: 'schedule' });
  const initialSchedules = listResult?.schedules ?? listResult?.result?.schedules ?? listResult ?? [];
  if (!Array.isArray(initialSchedules)) {
    fail(`expected schedules array, got: ${JSON.stringify(listResult).slice(0, 100)}`);
  } else {
    console.log(`  ✓ schedules listed: ${initialSchedules.length} found`);
  }

  // ── 2. Create one-off schedule (date string) ─────────────────────────────
  console.log('\nCreating one-off schedule (date string)...');
  const oneOffName = `MCP-Schedule-OneOff-${timestamp}`;
  let scheduleOneOffId;
  try {
    const created = await callTool('manage_schedules', {
      action: 'create',
      name: oneOffName,
      date: '2026-06-15',
      amount: -5000,
      amount_op: 'is',
      posts_transaction: false,
    });
    scheduleOneOffId = created?.id ?? created?.result?.id ?? created;
    if (typeof scheduleOneOffId === 'string' && scheduleOneOffId.length > 8) {
      console.log(`  ✓ one-off schedule created: ${scheduleOneOffId}`);
      context.scheduleOneOffId = scheduleOneOffId;
    } else {
      fail(`create one-off: unexpected response: ${JSON.stringify(created).slice(0, 120)}`);
    }
  } catch (err) {
    fail(`create one-off failed: ${err.message}`);
  }

  // ── 3. Verify one-off appears in list ────────────────────────────────────
  if (scheduleOneOffId) {
    const afterCreate = await callTool('list_entities', { type: 'schedule' });
    const allAfter = afterCreate?.schedules ?? afterCreate?.result?.schedules ?? afterCreate ?? [];
    const found = Array.isArray(allAfter) ? allAfter.find(s => s.id === scheduleOneOffId) : null;
    if (found) {
      console.log(`  ✓ verify create: schedule found in list (name="${found.name}", next_date="${found.next_date}")`);
    } else {
      fail(`verify create: schedule ${scheduleOneOffId} not found in list`);
    }
  }

  // ── 4. Create recurring schedule (monthly, never ends) ───────────────────
  console.log('\nCreating recurring monthly schedule...');
  const recurName = `MCP-Schedule-Recur-${timestamp}`;
  let scheduleRecurId;
  try {
    const createdRecur = await callTool('manage_schedules', {
      action: 'create',
      name: recurName,
      date: {
        frequency: 'monthly',
        start: '2026-01-01',
        endMode: 'never',
        interval: 1,
      },
      amount: -10000,
      amount_op: 'is',
      posts_transaction: false,
    });
    scheduleRecurId = createdRecur?.id ?? createdRecur?.result?.id ?? createdRecur;
    if (typeof scheduleRecurId === 'string' && scheduleRecurId.length > 8) {
      console.log(`  ✓ recurring schedule created: ${scheduleRecurId}`);
      context.scheduleRecurId = scheduleRecurId;
    } else {
      fail(`create recurring: unexpected response: ${JSON.stringify(createdRecur).slice(0, 120)}`);
    }
  } catch (err) {
    fail(`create recurring failed: ${err.message}`);
  }

  // ── 5. Verify recurring has next_date populated ───────────────────────────
  if (scheduleRecurId) {
    const afterRecur = await callTool('list_entities', { type: 'schedule' });
    const allAfterRecur = afterRecur?.schedules ?? afterRecur?.result?.schedules ?? afterRecur ?? [];
    const foundRecur = Array.isArray(allAfterRecur) ? allAfterRecur.find(s => s.id === scheduleRecurId) : null;
    if (foundRecur) {
      if (foundRecur.next_date) {
        console.log(`  ✓ verify recurring: next_date="${foundRecur.next_date}"`);
      } else {
        fail(`verify recurring: next_date is not populated after creating a recurring schedule. "May be server behaviour" is a question this test exists to answer: if it turns out to be legitimate, convert it to noteTolerated WITH the evidence.`);
      }
    } else {
      fail(`verify recurring: schedule ${scheduleRecurId} not found in list`);
    }
  }

  // ── 6. Update schedule name ──────────────────────────────────────────────
  if (scheduleOneOffId) {
    console.log('\nUpdating one-off schedule name...');
    const updatedName = `${oneOffName}-updated`;
    try {
      const updateResult = await callTool('manage_schedules', {
        action: 'update',
        id: scheduleOneOffId,
        name: updatedName,
      });
      const success = updateResult?.success ?? updateResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ update returned success=true`);
      } else {
        fail(`update: unexpected response: ${JSON.stringify(updateResult).slice(0, 120)}`);
      }
      // Verify
      const afterUpdate = await callTool('list_entities', { type: 'schedule' });
      const allAfterUpdate = afterUpdate?.schedules ?? afterUpdate?.result?.schedules ?? afterUpdate ?? [];
      const foundUpdated = Array.isArray(allAfterUpdate) ? allAfterUpdate.find(s => s.id === scheduleOneOffId) : null;
      if (foundUpdated?.name === updatedName) {
        console.log(`  ✓ verify update: name="${foundUpdated.name}"`);
      } else {
        fail(`verify update: expected name "${updatedName}", got "${foundUpdated?.name}"`);
      }
    } catch (err) {
      fail(`update name failed: ${err.message}`);
    }
  }

  // ── 7. Update recurring schedule with resetNextDate: true ────────────────
  if (scheduleRecurId) {
    console.log('\nUpdating recurring schedule date + resetNextDate: true...');
    try {
      const updateRecurResult = await callTool('manage_schedules', {
        action: 'update',
        id: scheduleRecurId,
        date: {
          frequency: 'monthly',
          start: '2026-03-01',
          endMode: 'never',
          interval: 1,
        },
        reset_next_date: true,
      });
      const success = updateRecurResult?.success ?? updateRecurResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ update with resetNextDate returned success=true`);
      } else {
        fail(`update with resetNextDate: unexpected response: ${JSON.stringify(updateRecurResult).slice(0, 120)}`);
      }
    } catch (err) {
      fail(`update recurring + resetNextDate failed: ${err.message}`);
    }
  }

  // ── 7b. A payee-less schedule links a matching import (#547) ───────────
  // The proof is a LINK, not a read-back: before the fix the schedule listed fine and never
  // linked anything. Disposable account, deleted in the finally block (zero residue).
  console.log('\nLinking a payee-less schedule to a matching import (#547)...');
  {
    let linkAccId;
    let linkSchedId;
    try {
      const acc = await callTool('manage_accounts', { action: 'create', entity: 'account', name: `MCP-Test-Link547-${timestamp}`, balance: 0 });
      linkAccId = acc?.id ?? acc?.result ?? acc;
      const today = new Date().toISOString().slice(0, 10);
      const sched = await callTool('manage_schedules', {
        action: 'create',
        name: `MCP-Schedule-Link547-${timestamp}`,
        date: today,
        amount: -7547,
        amount_op: 'is',
        account: linkAccId,
        posts_transaction: false,
      });
      linkSchedId = sched?.id ?? sched?.result?.id ?? sched;
      const imported = await callTool('manage_transactions', {
        action: 'import',
        account_id: linkAccId,
        txs: [
          { date: today, amount: -7547, imported_id: `mcp-547-match-${timestamp}` },
          { date: today, amount: -2000, imported_id: `mcp-547-other-${timestamp}` },
        ],
      });
      const added = imported?.added ?? imported?.result?.added ?? [];
      if (added.length !== 2) fail(`#547 import: expected 2 added, got ${JSON.stringify(imported).slice(0, 120)}`);
      const got = await callTool('search_transactions', { by: 'account', account_id: linkAccId });
      const rows = Array.isArray(got) ? got : (got?.result ?? []);
      const match = rows.find((t) => t?.amount === -7547);
      const other = rows.find((t) => t?.amount === -2000);
      if (match?.schedule === linkSchedId) {
        console.log('  ✓ #547: the matching import is linked to the payee-less schedule');
      } else {
        fail(`#547: matching import not linked (schedule=${JSON.stringify(match?.schedule ?? null)})`);
      }
      if ((other?.schedule ?? null) === null) {
        console.log('  ✓ #547: a different amount is not linked');
      } else {
        fail(`#547: the -2000 import was linked to ${other.schedule}`);
      }
    } catch (err) {
      fail(`#547 link check failed: ${err.message}`);
    } finally {
      if (linkSchedId) {
        try { await callTool('manage_schedules', { action: 'delete', id: linkSchedId }); } catch (err) { fail(`#547 cleanup schedule: ${err.message}`); }
      }
      if (linkAccId) {
        try { await callTool('manage_accounts', { action: 'delete', entity: 'account', id: linkAccId }); } catch (err) { fail(`#547 cleanup account: ${err.message}`); }
      }
    }
  }

  // ── 8. Delete the one-off schedule ───────────────────────────────────────
  if (scheduleOneOffId) {
    console.log('\nDeleting one-off schedule...');
    try {
      const delResult = await callTool('manage_schedules', { action: 'delete', id: scheduleOneOffId });
      const success = delResult?.success ?? delResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ delete returned success=true`);
      } else {
        fail(`delete one-off: unexpected response: ${JSON.stringify(delResult).slice(0, 120)}`);
      }
      // Verify gone
      const afterDel = await callTool('list_entities', { type: 'schedule' });
      const allAfterDel = afterDel?.schedules ?? afterDel?.result?.schedules ?? afterDel ?? [];
      const stillThere = Array.isArray(allAfterDel) ? allAfterDel.find(s => s.id === scheduleOneOffId) : null;
      if (!stillThere) {
        console.log(`  ✓ verify delete: schedule no longer in list`);
      } else {
        fail(`verify delete: schedule ${scheduleOneOffId} still in list after deletion`);
      }
    } catch (err) {
      fail(`delete one-off failed: ${err.message}`);
    }
  }

  // ── 9. Delete the recurring schedule ─────────────────────────────────────
  if (scheduleRecurId) {
    console.log('\nDeleting recurring schedule...');
    try {
      const delRecurResult = await callTool('manage_schedules', { action: 'delete', id: scheduleRecurId });
      const success = delRecurResult?.success ?? delRecurResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ delete recurring returned success=true`);
      } else {
        fail(`delete recurring: unexpected response: ${JSON.stringify(delRecurResult).slice(0, 120)}`);
      }
    } catch (err) {
      fail(`delete recurring failed: ${err.message}`);
    }
  }

  // ── 9b. #527: an isbetween range round-trips; a scalar isbetween is refused ─
  console.log('\nCreating an isbetween range schedule (#527)...');
  {
    let rangeId;
    try {
      const created = await callTool('manage_schedules', {
        action: 'create',
        name: `MCP-Schedule-Range-${timestamp}`,
        date: '2026-06-15',
        amount: { num1: -10000, num2: -5000 },
        amount_op: 'isbetween',
        posts_transaction: false,
      });
      rangeId = created?.id ?? created?.result?.id ?? created;
      const after = await callTool('list_entities', { type: 'schedule' });
      const all = after?.schedules ?? after?.result?.schedules ?? after ?? [];
      const row = Array.isArray(all) ? all.find(s => s.id === rangeId) : null;
      if (row?.amountOp === 'isbetween' && row?.amount?.num1 === -10000 && row?.amount?.num2 === -5000) {
        console.log('  ✓ range schedule reads back as isbetween { num1: -10000, num2: -5000 }');
      } else {
        fail(`range read-back: unexpected row: ${JSON.stringify(row).slice(0, 160)}`);
      }
    } catch (err) {
      fail(`create range schedule failed: ${err.message}`);
    } finally {
      if (typeof rangeId === 'string') {
        try { await callTool('manage_schedules', { action: 'delete', id: rangeId }); } catch (err) { fail(`delete range schedule failed: ${err.message}`); }
      }
    }

    console.log('NEGATIVE: scalar amount with amountOp isbetween (#527)...');
    try {
      const bad = await callTool('manage_schedules', {
        action: 'create',
        name: `MCP-Schedule-Scalar-${timestamp}`,
        date: '2026-06-15',
        amount: -5000,
        amount_op: 'isbetween',
        posts_transaction: false,
      });
      fail(`Expected a refusal but the tool returned: ${JSON.stringify(bad).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('num1, num2')) {
        console.log(`  ✓ scalar isbetween refused: ${msg.slice(0, 120)}`);
      } else {
        fail(`Threw, but the message does not name the range form: ${msg.slice(0, 120)}`);
      }
    }
  }

  // ── 9c. #478: a monthly last-day pattern lands on the month end; weekly refuses patterns ─
  console.log('\nCreating a last-day-of-month schedule (#478)...');
  {
    // Upstream computes next_date from max(today, start): use the 3rd of next month.
    const now = new Date();
    const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    const m = (now.getMonth() + 1) % 12;
    const ymd = (day) => `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    let patternId;
    try {
      const created = await callTool('manage_schedules', {
        action: 'create',
        name: `MCP-Schedule-LastDay-${timestamp}`,
        date: { frequency: 'monthly', start: ymd(3), endMode: 'never', patterns: [{ type: 'day', value: -1 }] },
        amount: -5000,
        posts_transaction: false,
      });
      patternId = created?.id ?? created?.result?.id ?? created;
      const after = await callTool('list_entities', { type: 'schedule' });
      const all = after?.schedules ?? after?.result?.schedules ?? after ?? [];
      const row = Array.isArray(all) ? all.find(s => s.id === patternId) : null;
      if (row?.next_date === ymd(lastDay) && row?.date?.patterns?.[0]?.value === -1) {
        console.log(`  ✓ last-day schedule: next_date ${row.next_date}, patterns kept`);
      } else {
        fail(`last-day read-back: expected next_date ${ymd(lastDay)}, got ${JSON.stringify(row).slice(0, 200)}`);
      }
    } catch (err) {
      fail(`create last-day schedule failed: ${err.message}`);
    } finally {
      if (typeof patternId === 'string') {
        try { await callTool('manage_schedules', { action: 'delete', id: patternId }); } catch (err) { fail(`delete last-day schedule failed: ${err.message}`); }
      }
    }

    console.log('NEGATIVE: patterns on a weekly schedule (#478)...');
    let refused = false;
    try {
      await callTool('manage_schedules', {
        action: 'create',
        name: `MCP-Schedule-WeeklyPatterns-${timestamp}`,
        date: { frequency: 'weekly', start: ymd(3), patterns: [{ type: 'day', value: 1 }] },
        amount: -5000,
        posts_transaction: false,
      });
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes("only to frequency 'monthly'")) {
        refused = true;
        console.log(`  ✓ weekly patterns refused: ${msg.slice(0, 120)}`);
      } else {
        fail(`Threw, but the message does not name monthly: ${msg.slice(0, 120)}`);
      }
    }
    if (!refused) fail('Expected weekly patterns to be refused, but the create succeeded');
  }

  // 10. FIXED(BUG-11): Deleting a non-existent schedule UUID now THROWS an actionable error.
  console.log('\nNEGATIVE: Deleting non-existent schedule UUID...');
  {
    try {
      const nilResult = await callTool('manage_schedules', { action: 'delete', id: NON_EXISTENT_UUID });
      fail(`Expected a not-found error but the tool returned: ${JSON.stringify(nilResult).slice(0, 120)}`);
    } catch (err) {
      const msg = err.message || String(err);
      if (msg.includes('not found') && msg.includes('list_entities with type schedule')) {
        console.log(`  ✓ FIXED(BUG-11): schedules_delete nil-UUID throws actionable error: ${msg.slice(0, 120)}`);
      } else {
        fail(`Threw, but the message is not actionable: ${msg.slice(0, 120)}`);
      }
    }
  }

  console.log('\n  (Schedule cleanup complete: all MCP-Schedule-* entries removed above)');
}
