/**
 * tests/roundtrip.js
 *
 * EXPORT / IMPORT ROUND TRIP (#332 / #334) plus PREFERENCES (#333).
 *
 * WHY THIS IS GATED, AND GATED HARD.
 *
 * actual_budgets_import does not just read a file: upstream importBudget CREATES a
 * budget file on the Actual server AND LOADS it, so the session's active budget
 * changes to the new copy. Two consequences drive the guards below:
 *
 *   1. It leaves a budget behind on the server. That is residue this suite cannot
 *      sweep (there is no delete-budget tool), so the import half only runs when
 *      MCP_TEST_BUDGET_SYNC_ID marks the target budget as DISPOSABLE. Without that
 *      marker the import is skipped and only the read-only export half runs.
 *   2. Every later test would silently run against the imported copy. This module
 *      therefore switches back to the original configured budget before returning,
 *      and the runner schedules it LAST.
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
    const prefs = unwrap(await callTool('actual_preferences_get', {}));
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
  // Remember where we started, so the import half can put the session back.
  // --------------------------------------------------------------------------
  let originalBudgetName = null;
  try {
    const available = unwrap(await callTool('actual_budgets_list_available', {}));
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
    const res = unwrap(await callTool('actual_budgets_export', { filename: 'mcp-integration-roundtrip.zip' }));
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
    const res = await callTool('actual_budgets_export', { filename: '../escape.zip' });
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
    const res = await callTool('actual_budgets_import', {});
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
  // switches back to the configured budget at the end, which stdio could not do
  // until it was given a synthetic session id, so this half was skipped over stdio.
  // It now runs on both transports.

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
    const beforeAccounts = unwrap(await callTool('actual_accounts_list', {}));
    const beforeCount = Array.isArray(beforeAccounts) ? beforeAccounts.length : 0;

    const res = unwrap(await callTool('actual_budgets_import', { path: exportedPath, type: 'actual' }));
    if (res?.success !== true || typeof res?.budgetId !== 'string') {
      fail(`budgets_import: expected { success: true, budgetId }, got ${JSON.stringify(res).slice(0, 160)}`);
    } else {
      console.log(`  ok budgets_import: restored ${exportedBytes} bytes as budget ${res.budgetId}`);

      // THE ROUND-TRIP ASSERTION. The imported budget is now loaded, so this reads
      // the restored copy. Equal account counts is what proves the export was
      // actually RESTORABLE rather than merely well-formed.
      const afterAccounts = unwrap(await callTool('actual_accounts_list', {}));
      const afterCount = Array.isArray(afterAccounts) ? afterAccounts.length : 0;
      if (afterCount !== beforeCount) {
        fail(`round trip: account count changed across export/import (${beforeCount} before, ${afterCount} after)`);
      } else {
        console.log(`  ok round trip verified: ${beforeCount} account(s) preserved through export and re-import`);
      }
    }
  } catch (err) {
    fail(['budgets_import round trip:', err.message].map(String).join(' '));
  } finally {
    // Always put the session back on a CONFIGURED budget, even if the assertions
    // above failed. Leaving it on the imported copy would corrupt the cleanup
    // phase, which deletes test entities by id.
    if (originalBudgetName) {
      try {
        const back = unwrap(await callTool('actual_budgets_switch', { budgetName: originalBudgetName }));
        if (back?.success === true) {
          console.log(`  ok switched back to the configured budget "${originalBudgetName}"`);
        } else {
          fail(`round trip: could not switch back to "${originalBudgetName}": ${JSON.stringify(back).slice(0, 160)}`);
        }
      } catch (err) {
        fail(['round trip switch-back:', err.message].map(String).join(' '));
      }
    } else {
      fail('round trip: the original budget name was never resolved, so the session was left on the imported budget.');
    }
  }
}
