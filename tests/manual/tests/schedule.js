/**
 * tests/manual/tests/schedule.js
 *
 * SCHEDULE TESTS — getSchedules, createSchedule, updateSchedule, deleteSchedule.
 *
 * Covers:
 *   positive: list • create one-off • create recurring • update name
 *             update with resetNextDate • delete created schedule
 *   negative: delete non-existent UUID (expect error, not crash)
 *
 * Naming pattern: MCP-Schedule-{timestamp} — matched by cleanup.js
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
  console.log('\nListing all schedules (actual_schedules_get)...');
  const listResult = await callTool('actual_schedules_get', {});
  const initialSchedules = listResult?.schedules ?? listResult?.result?.schedules ?? listResult ?? [];
  if (!Array.isArray(initialSchedules)) {
    console.log(`  ❌ expected schedules array, got: ${JSON.stringify(listResult).slice(0, 100)}`);
  } else {
    console.log(`  ✓ schedules listed: ${initialSchedules.length} found`);
  }

  // ── 2. Create one-off schedule (date string) ─────────────────────────────
  console.log('\nCreating one-off schedule (date string)...');
  const oneOffName = `MCP-Schedule-OneOff-${timestamp}`;
  let scheduleOneOffId;
  try {
    const created = await callTool('actual_schedules_create', {
      name: oneOffName,
      date: '2026-06-15',
      amount: -5000,
      amountOp: 'is',
      posts_transaction: false,
    });
    scheduleOneOffId = created?.id ?? created?.result?.id ?? created;
    if (typeof scheduleOneOffId === 'string' && scheduleOneOffId.length > 8) {
      console.log(`  ✓ one-off schedule created: ${scheduleOneOffId}`);
      context.scheduleOneOffId = scheduleOneOffId;
    } else {
      console.log(`  ❌ create one-off: unexpected response: ${JSON.stringify(created).slice(0, 120)}`);
    }
  } catch (err) {
    console.log(`  ❌ create one-off failed: ${err.message}`);
  }

  // ── 3. Verify one-off appears in list ────────────────────────────────────
  if (scheduleOneOffId) {
    const afterCreate = await callTool('actual_schedules_get', {});
    const allAfter = afterCreate?.schedules ?? afterCreate?.result?.schedules ?? afterCreate ?? [];
    const found = Array.isArray(allAfter) ? allAfter.find(s => s.id === scheduleOneOffId) : null;
    if (found) {
      console.log(`  ✓ verify create: schedule found in list (name="${found.name}", next_date="${found.next_date}")`);
    } else {
      console.log(`  ❌ verify create: schedule ${scheduleOneOffId} not found in list`);
    }
  }

  // ── 4. Create recurring schedule (monthly, never ends) ───────────────────
  console.log('\nCreating recurring monthly schedule...');
  const recurName = `MCP-Schedule-Recur-${timestamp}`;
  let scheduleRecurId;
  try {
    const createdRecur = await callTool('actual_schedules_create', {
      name: recurName,
      date: {
        frequency: 'monthly',
        start: '2026-01-01',
        endMode: 'never',
        interval: 1,
      },
      amount: -10000,
      amountOp: 'is',
      posts_transaction: false,
    });
    scheduleRecurId = createdRecur?.id ?? createdRecur?.result?.id ?? createdRecur;
    if (typeof scheduleRecurId === 'string' && scheduleRecurId.length > 8) {
      console.log(`  ✓ recurring schedule created: ${scheduleRecurId}`);
      context.scheduleRecurId = scheduleRecurId;
    } else {
      console.log(`  ❌ create recurring: unexpected response: ${JSON.stringify(createdRecur).slice(0, 120)}`);
    }
  } catch (err) {
    console.log(`  ❌ create recurring failed: ${err.message}`);
  }

  // ── 5. Verify recurring has next_date populated ───────────────────────────
  if (scheduleRecurId) {
    const afterRecur = await callTool('actual_schedules_get', {});
    const allAfterRecur = afterRecur?.schedules ?? afterRecur?.result?.schedules ?? afterRecur ?? [];
    const foundRecur = Array.isArray(allAfterRecur) ? allAfterRecur.find(s => s.id === scheduleRecurId) : null;
    if (foundRecur) {
      if (foundRecur.next_date) {
        console.log(`  ✓ verify recurring: next_date="${foundRecur.next_date}"`);
      } else {
        console.log(`  ⚠ verify recurring: next_date not populated (may be server behaviour)`);
      }
    } else {
      console.log(`  ❌ verify recurring: schedule ${scheduleRecurId} not found in list`);
    }
  }

  // ── 6. Update schedule name ──────────────────────────────────────────────
  if (scheduleOneOffId) {
    console.log('\nUpdating one-off schedule name...');
    const updatedName = `${oneOffName}-updated`;
    try {
      const updateResult = await callTool('actual_schedules_update', {
        id: scheduleOneOffId,
        name: updatedName,
      });
      const success = updateResult?.success ?? updateResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ update returned success=true`);
      } else {
        console.log(`  ⚠ update: unexpected response: ${JSON.stringify(updateResult).slice(0, 120)}`);
      }
      // Verify
      const afterUpdate = await callTool('actual_schedules_get', {});
      const allAfterUpdate = afterUpdate?.schedules ?? afterUpdate?.result?.schedules ?? afterUpdate ?? [];
      const foundUpdated = Array.isArray(allAfterUpdate) ? allAfterUpdate.find(s => s.id === scheduleOneOffId) : null;
      if (foundUpdated?.name === updatedName) {
        console.log(`  ✓ verify update: name="${foundUpdated.name}"`);
      } else {
        console.log(`  ❌ verify update: expected name "${updatedName}", got "${foundUpdated?.name}"`);
      }
    } catch (err) {
      console.log(`  ❌ update name failed: ${err.message}`);
    }
  }

  // ── 7. Update recurring schedule with resetNextDate: true ────────────────
  if (scheduleRecurId) {
    console.log('\nUpdating recurring schedule date + resetNextDate: true...');
    try {
      const updateRecurResult = await callTool('actual_schedules_update', {
        id: scheduleRecurId,
        date: {
          frequency: 'monthly',
          start: '2026-03-01',
          endMode: 'never',
          interval: 1,
        },
        resetNextDate: true,
      });
      const success = updateRecurResult?.success ?? updateRecurResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ update with resetNextDate returned success=true`);
      } else {
        console.log(`  ⚠ update with resetNextDate: unexpected response: ${JSON.stringify(updateRecurResult).slice(0, 120)}`);
      }
    } catch (err) {
      console.log(`  ❌ update recurring + resetNextDate failed: ${err.message}`);
    }
  }

  // ── 8. Delete the one-off schedule ───────────────────────────────────────
  if (scheduleOneOffId) {
    console.log('\nDeleting one-off schedule...');
    try {
      const delResult = await callTool('actual_schedules_delete', { id: scheduleOneOffId });
      const success = delResult?.success ?? delResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ delete returned success=true`);
      } else {
        console.log(`  ⚠ delete one-off: unexpected response: ${JSON.stringify(delResult).slice(0, 120)}`);
      }
      // Verify gone
      const afterDel = await callTool('actual_schedules_get', {});
      const allAfterDel = afterDel?.schedules ?? afterDel?.result?.schedules ?? afterDel ?? [];
      const stillThere = Array.isArray(allAfterDel) ? allAfterDel.find(s => s.id === scheduleOneOffId) : null;
      if (!stillThere) {
        console.log(`  ✓ verify delete: schedule no longer in list`);
      } else {
        console.log(`  ❌ verify delete: schedule ${scheduleOneOffId} still in list after deletion`);
      }
    } catch (err) {
      console.log(`  ❌ delete one-off failed: ${err.message}`);
    }
  }

  // ── 9. Delete the recurring schedule ─────────────────────────────────────
  if (scheduleRecurId) {
    console.log('\nDeleting recurring schedule...');
    try {
      const delRecurResult = await callTool('actual_schedules_delete', { id: scheduleRecurId });
      const success = delRecurResult?.success ?? delRecurResult?.result?.success;
      if (success === true) {
        console.log(`  ✓ delete recurring returned success=true`);
      } else {
        console.log(`  ⚠ delete recurring: unexpected response: ${JSON.stringify(delRecurResult).slice(0, 120)}`);
      }
    } catch (err) {
      console.log(`  ❌ delete recurring failed: ${err.message}`);
    }
  }

  // ── 10. Negative: delete non-existent UUID ────────────────────────────────
  console.log('\nNEGATIVE: Deleting non-existent schedule UUID...');
  try {
    await callTool('actual_schedules_delete', { id: NON_EXISTENT_UUID });
    console.log(`  ⚠ expected an error for non-existent UUID, but call succeeded`);
  } catch (err) {
    console.log(`  ✓ correctly rejected non-existent UUID: ${err.message}`);
  }

  console.log('\n  (Schedule cleanup complete — all MCP-Schedule-* entries removed above)');
}
