// #841: turn the experimental "Goal templates" setting ON in the E2E test budget, ON THE ACTUAL SERVER.
//
// The template tools (actual_budgets_apply_templates, actual_budgets_run_cleanup) refuse with a
// feature-disabled refusal while the budget's synced preference flags.goalTemplatesEnabled is not
// "true". That preference lives in the budget file, so it has to be saved and synced to the Actual
// server BEFORE the MCP container first downloads the budget: run-docker-e2e.sh runs the two
// bootstrap services (which call this script) in steps 4 and 4c, before the MCP container exists.
//
// Reads from the environment: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and the sync id from the file
// named by SYNC_ID_FILE (default /tmp/actual-sync-id.txt, written by scripts/import-test-budget.sh).
// Exits non-zero on any failure, so a bootstrap that cannot seed the flag fails the run loudly.

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '@actual-app/api';

const FLAG = 'flags.goalTemplatesEnabled';
const serverURL = process.env.ACTUAL_SERVER_URL;
const password = process.env.ACTUAL_PASSWORD;
const syncIdFile = process.env.SYNC_ID_FILE || '/tmp/actual-sync-id.txt';

if (!serverURL || !password) {
  console.error('enable-goal-templates: ACTUAL_SERVER_URL and ACTUAL_PASSWORD are required');
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'goal-templates-seed-'));
let code = 0;
try {
  const syncId = readFileSync(syncIdFile, 'utf8').trim();
  if (!syncId) throw new Error(`no sync id in ${syncIdFile}`);
  await api.init({ dataDir, serverURL, password });
  await api.downloadBudget(syncId);
  await api.internal.send('preferences/save', { id: FLAG, value: 'true' });
  // Read it back from the budget itself, then push the change to the server.
  const { data } = await api.runQuery(api.q('preferences').filter({ id: FLAG }).select('*'));
  if (!data || data.length !== 1 || data[0].value !== 'true') {
    throw new Error(`the preference did not read back as "true": ${JSON.stringify(data)}`);
  }
  await api.sync();
  console.log(`enable-goal-templates: ${FLAG} is "true" and synced to ${serverURL}`);
} catch (err) {
  console.error(`enable-goal-templates: FAILED: ${err && err.message ? err.message : err}`);
  code = 1;
} finally {
  try { await api.shutdown(); } catch { /* the exit code already says what happened */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* temp dir in the throwaway container */ }
}
process.exit(code);
