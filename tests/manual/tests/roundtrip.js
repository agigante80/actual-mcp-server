/**
 * tests/roundtrip.js
 *
 * EXPORT / IMPORT ROUND TRIP (#332 / #334) plus PREFERENCES (#333).
 *
 * WHY THIS IS GATED, AND GATED HARD.
 *
 * manage_budget_files import does not just read a file: upstream importBudget CREATES a
 * budget file on the Actual server. It does NOT move the session (#687): the next call
 * from every session reloads that session's own configured budget. Two consequences
 * drive the guards below:
 *
 *   1. It leaves a budget behind on the server. That is residue this suite cannot
 *      sweep (there is no delete-budget tool), so the import half only runs when
 *      MCP_TEST_BUDGET_SYNC_ID marks the target budget as DISPOSABLE. Without that
 *      marker the import is skipped and only the read-only export half runs.
 *   2. The import closes the open budget for every session while it runs, so the
 *      runner schedules this module LAST to keep that reload out of the other
 *      modules. The switch call at the end is a plain check of `switch`, not a
 *      rescue: the session is already on its configured budget.
 *
 * The export half is safe unconditionally: it only reads, and it writes a zip
 * inside the SERVER's export directory, never into the repo.
 *
 * Reads from context:  (none)
 * Writes to context:   (none)
 */

import { fail, skip } from '../assert.js';

/**
 * @param {{ callTool: Function }} client
 * @param {object} _context
 */
export async function roundtripTests(client, _context) {
  const { callTool } = client;
  console.log('\n-- Running EXPORT/IMPORT ROUND TRIP TESTS --');

  const unwrap = (res) => (res && typeof res === 'object' && 'result' in res ? res.result : res);

  // --------------------------------------------------------------------------
  // Positive: preferences are readable and normalised
  // --------------------------------------------------------------------------
  try {
    const prefs = unwrap(await callTool('get_context', { topic: 'preferences' }));
    const okShape =
      prefs && typeof prefs.preferences === 'object' && !Array.isArray(prefs.preferences) && Array.isArray(prefs.keys);
    if (!okShape) {
      fail(`preferences_get: expected { preferences: object, keys: array }, got ${JSON.stringify(prefs).slice(0, 160)}`);
    } else if (prefs.count !== Object.keys(prefs.preferences).length) {
      fail(`preferences_get: count=${prefs.count} disagrees with ${Object.keys(prefs.preferences).length} keys`);
    } else {
      console.log(`  ok preferences_get: ${prefs.count} synced preference(s)`);
    }
  } catch (err) {
    fail(['preferences_get:', err.message].map(String).join(' '));
  }

  // --------------------------------------------------------------------------
  // Remember the configured budget name, for the switch check after the import.
  // --------------------------------------------------------------------------
  let originalBudgetName = null;
  try {
    const available = unwrap(await callTool('list_entities', { type: 'budget_file' }));
    const list = Array.isArray(available) ? available : available?.budgets;
    originalBudgetName = list?.[0]?.name ?? null;
  } catch {
    /* non-fatal: the import half skips itself when this is unknown */
  }

  // --------------------------------------------------------------------------
  // Positive: export produces a non-trivial zip with an accurate digest
  // --------------------------------------------------------------------------
  let exportedPath = null;
  let exportedBytes = 0;
  try {
    const res = unwrap(await callTool('manage_budget_files', { action: 'export', filename: 'mcp-integration-roundtrip.zip' }));
    if (res?.success !== true || typeof res?.path !== 'string') {
      fail(`budgets_export: expected { success: true, path }, got ${JSON.stringify(res).slice(0, 160)}`);
    } else if (!(res.bytes > 100)) {
      // A real budget export is never a handful of bytes. Without this the test
      // would pass on a truncated or empty zip, which is precisely the failure a
      // backup tool must never ship with.
      fail(`budgets_export: implausibly small export (${res.bytes} bytes) at ${res.path}`);
    } else if (!/^[0-9a-f]{64}$/.test(res.sha256 || '')) {
      fail(`budgets_export: sha256 is not a 64-character hex digest: ${res.sha256}`);
    } else {
      exportedPath = res.path;
      exportedBytes = res.bytes;
      console.log(`  ok budgets_export: ${res.bytes} bytes at ${res.path} (sha256 ${res.sha256.slice(0, 12)}...)`);
    }
  } catch (err) {
    fail(['budgets_export:', err.message].map(String).join(' '));
  }

  // --------------------------------------------------------------------------
  // Negative: a filename that would escape the export directory is refused
  // --------------------------------------------------------------------------
  try {
    const res = await callTool('manage_budget_files', { action: 'export', filename: '../escape.zip' });
    const payload = unwrap(res);
    const rejected = Boolean(res?.error || payload?.error || payload?.isError);
    if (rejected) {
      console.log('  ok budgets_export [traversal filename rejected]');
    } else {
      fail(`budgets_export: a traversal filename was ACCEPTED: ${JSON.stringify(payload).slice(0, 160)}`);
    }
  } catch (err) {
    // A thrown validation error is the same guard firing, so this is a pass.
    console.log(`  ok budgets_export [traversal filename rejected: ${String(err.message).slice(0, 60)}]`);
  }

  // --------------------------------------------------------------------------
  // Negative: import requires exactly one source
  // --------------------------------------------------------------------------
  try {
    const res = await callTool('manage_budget_files', { action: 'import' });
    const payload = unwrap(res);
    const rejected = Boolean(res?.error || payload?.error || payload?.isError);
    if (rejected) {
      console.log('  ok budgets_import [no source rejected]');
    } else {
      fail(`budgets_import: an empty request was ACCEPTED: ${JSON.stringify(payload).slice(0, 160)}`);
    }
  } catch (err) {
    console.log(`  ok budgets_import [no source rejected: ${String(err.message).slice(0, 60)}]`);
  }

  // --------------------------------------------------------------------------
  // The destructive half. Only against a budget explicitly marked disposable.
  // --------------------------------------------------------------------------
  // #348 removed the stdio transport guard that used to live here. The round trip
  // ends with a switch call, which stdio could not make until it was given a
  // synthetic session id, so this half was skipped over stdio. It now runs on both
  // transports.

  const disposable = (process.env.MCP_TEST_BUDGET_SYNC_ID || '').trim();
  if (!disposable) {
    skip(
      'budgets_import round trip: MCP_TEST_BUDGET_SYNC_ID is not set, so no budget is marked disposable. ' +
        'Importing would leave a budget on the server that this suite cannot delete.',
    );
    return;
  }
  if (!exportedPath) {
    skip('budgets_import round trip: the export step did not produce a path.');
    return;
  }

  try {
    const res = unwrap(await callTool('manage_budget_files', { action: 'import', path: exportedPath, type: 'actual' }));
    if (res?.success !== true || typeof res?.budgetId !== 'string') {
      fail(`budgets_import: expected { success: true, budgetId }, got ${JSON.stringify(res).slice(0, 160)}`);
    } else {
      // Upstream rejects an archive it cannot load, so success plus an id is the proof
      // the export was importable. An account-count comparison used to follow; it
      // compared the configured budget with itself and could not fail (#687).
      console.log(`  ok budgets_import: imported ${exportedBytes} bytes as new local budget ${res.budgetId}`);
      const message = String(res?.message ?? '');
      if (/LOADED|action switch|budgets_switch/.test(message) || !message.includes('stays on its configured budget')) {
        fail(`budgets_import: the message must say the session stays on its configured budget, got: ${message.slice(0, 200)}`);
      } else {
        console.log('  ok budgets_import: the message says the session stays on its configured budget');
      }
    }
  } catch (err) {
    fail(['budgets_import round trip:', err.message].map(String).join(' '));
  } finally {
    // A plain check that `switch` to the configured budget works after an import. The
    // session never left that budget (#687), so this is not a rescue.
    if (originalBudgetName) {
      try {
        const back = unwrap(await callTool('manage_budget_files', { action: 'switch', budget_name: originalBudgetName }));
        if (back?.success === true) {
          console.log(`  ok switch to the configured budget "${originalBudgetName}"`);
        } else {
          fail(`round trip: could not switch to "${originalBudgetName}": ${JSON.stringify(back).slice(0, 160)}`);
        }
      } catch (err) {
        fail(['round trip switch-back:', err.message].map(String).join(' '));
      }
    } else {
      fail('round trip: the original budget name was never resolved, so the switch check could not run.');
    }
  }
}
