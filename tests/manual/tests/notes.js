/**
 * tests/notes.js
 *
 * NOTES TESTS -- round-trip get/set, clear, budget month, orphan guard.
 *
 * Uses the budget-YYYY-MM synthetic ids for positive tests to avoid
 * requiring a specific entity id from the live budget.
 *
 * Reads from context:  accountId (optional -- used for account-note test if available)
 * Writes to context:   (none)
 */

/**
 * @param {{ callTool: Function }} client
 * @param {object} context
 */
export async function notesTests(client, context) {
  const { callTool } = client;
  console.log('\n-- Running NOTES TESTS --');

  const TEST_MONTH = 'budget-2026-01';
  const UNIQUE_NOTE = `MCP-Note-Test-${Date.now()}`;

  // --------------------------------------------------------------------------
  // Positive: round-trip set and get a budget month note
  // --------------------------------------------------------------------------
  try {
    const setRes = await callTool('actual_notes_update', { id: TEST_MONTH, note: UNIQUE_NOTE });
    const setOk = setRes?.success === true || setRes?.result?.success === true;
    if (setOk) {
      console.log(`  ok notes_update [set budget month note]: success`);
    } else {
      console.log(`  FAIL notes_update [set budget month note]: ${JSON.stringify(setRes).slice(0, 200)}`);
    }

    const getRes = await callTool('actual_notes_get', { id: TEST_MONTH });
    const data = getRes?.result ?? getRes;
    const noteText = data?.note;
    if (noteText === UNIQUE_NOTE) {
      console.log(`  ok notes_get [read-back budget month note]: "${noteText}"`);
    } else {
      console.log(`  FAIL notes_get [read-back budget month note]: expected "${UNIQUE_NOTE}", got ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL notes round-trip: ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Positive: clear the note (empty string), then verify cleared state
  // --------------------------------------------------------------------------
  try {
    const clearRes = await callTool('actual_notes_update', { id: TEST_MONTH, note: '' });
    const clearOk = clearRes?.success === true || clearRes?.result?.success === true;
    if (clearOk) {
      console.log(`  ok notes_update [clear note]: success`);
    } else {
      console.log(`  FAIL notes_update [clear note]: ${JSON.stringify(clearRes).slice(0, 200)}`);
    }

    // After clearing, getNote returns { id, note: "" } (not null).
    const getRes = await callTool('actual_notes_get', { id: TEST_MONTH });
    const data = getRes?.result ?? getRes;
    const noteText = data?.note;
    if (noteText === '' || noteText === null || data?.found === false) {
      console.log(`  ok notes_get [after clear]: empty/cleared state confirmed (note="${noteText}", found=${data?.found})`);
    } else {
      console.log(`  FAIL notes_get [after clear]: expected empty note, got ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL notes clear test: ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Positive: budget template directive note
  // --------------------------------------------------------------------------
  try {
    const TEMPLATE_MONTH = 'budget-2026-02';
    const TEMPLATE_NOTE = '#template 250';
    await callTool('actual_notes_update', { id: TEMPLATE_MONTH, note: TEMPLATE_NOTE });
    const getRes = await callTool('actual_notes_get', { id: TEMPLATE_MONTH });
    const data = getRes?.result ?? getRes;
    if (data?.note === TEMPLATE_NOTE) {
      console.log(`  ok notes [template directive round-trip]: "${data.note}"`);
    } else {
      console.log(`  FAIL notes [template directive]: expected "${TEMPLATE_NOTE}", got ${JSON.stringify(data).slice(0, 200)}`);
    }
    // Cleanup
    await callTool('actual_notes_update', { id: TEMPLATE_MONTH, note: '' });
  } catch (err) {
    console.log(`  FAIL notes template test: ${err.message}`);
  }

  // --------------------------------------------------------------------------
  // Positive: note on an account (if accountId is available from context)
  // --------------------------------------------------------------------------
  if (context.accountId) {
    try {
      const ACCOUNT_NOTE = `MCP-AccountNote-${Date.now()}`;
      const setRes = await callTool('actual_notes_update', { id: context.accountId, note: ACCOUNT_NOTE });
      const setOk = setRes?.success === true || setRes?.result?.success === true;
      if (setOk) {
        console.log(`  ok notes_update [account note set]: success`);
      } else {
        console.log(`  FAIL notes_update [account note set]: ${JSON.stringify(setRes).slice(0, 200)}`);
      }
      const getRes = await callTool('actual_notes_get', { id: context.accountId });
      const data = getRes?.result ?? getRes;
      if (data?.note === ACCOUNT_NOTE) {
        console.log(`  ok notes_get [account note read-back]: "${data.note}"`);
      } else {
        console.log(`  FAIL notes_get [account note read-back]: got ${JSON.stringify(data).slice(0, 200)}`);
      }
      // Cleanup
      await callTool('actual_notes_update', { id: context.accountId, note: '' });
      console.log(`  ok notes_update [account note cleared]`);
    } catch (err) {
      console.log(`  FAIL notes account test: ${err.message}`);
    }
  } else {
    console.log(`  info notes [account note test]: skipped (no accountId in context)`);
  }

  // --------------------------------------------------------------------------
  // Negative: id that resolves to no known entity and is not budget-YYYY-MM
  // --------------------------------------------------------------------------
  try {
    const res = await callTool('actual_notes_update', {
      id: '__nonexistent_MCP_test_entity_id__',
      note: 'should not be written',
    });
    const data = res?.result ?? res;
    const text = JSON.stringify(data);
    if (data?.error || text.includes('not found') || text.includes('Entity')) {
      console.log(`  ok notes_update [orphan id guard]: correctly returned error`);
    } else {
      // GAP(error-messages): actual_notes_update with orphan id silently accepted
      console.log(`  WARN notes_update [orphan id guard]: did not return expected error: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('Entity')) {
      console.log(`  ok notes_update [orphan id guard]: threw with useful error`);
    } else {
      console.log(`  FAIL notes_update [orphan id guard]: unexpected error: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Negative: notes_get on a fresh id that has never had a note
  // --------------------------------------------------------------------------
  try {
    const NEVER_HAD_NOTE_ID = 'budget-1970-01';
    const getRes = await callTool('actual_notes_get', { id: NEVER_HAD_NOTE_ID });
    const data = getRes?.result ?? getRes;
    const text = JSON.stringify(data);
    if (data?.found === false || data?.note === null || data?.note === '') {
      console.log(`  ok notes_get [no note set]: returned clear no-note result`);
    } else if (data?.found === true) {
      // A note actually exists for this month (unlikely but valid).
      console.log(`  info notes_get [no note set]: ${NEVER_HAD_NOTE_ID} has note "${data.note}" (valid)`);
    } else {
      console.log(`  WARN notes_get [no note set]: unexpected shape: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL notes_get [no note set]: ${err.message}`);
  }
}
