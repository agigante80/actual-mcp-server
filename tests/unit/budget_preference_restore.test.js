// tests/unit/budget_preference_restore.test.js
//
// #189 restart-replay: end-to-end through the real adapter, prove that a budget
// switched in one session is restored on a FRESH session for the same principal
// (the "server restarted, client re-initialized" scenario), and that the live
// ACL still gates the restore.
//
// This exercises the wired path (switchBudget persist -> getActiveBudgetConfig
// restore -> pickAllowedPreferredBudget ACL re-check) against a real on-disk
// preference file, with _skipApiInitForTests so no upstream/pool I/O runs.
//
// Run: node tests/unit/budget_preference_restore.test.js

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Two budgets in the registry, plus a writable preference dir. Set before import.
process.env.ACTUAL_SERVER_URL = 'http://test-server:5006';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'default-sync';
process.env.BUDGET_DEFAULT_NAME = 'Default';
process.env.BUDGET_1_NAME = 'Second';
process.env.BUDGET_1_SYNC_ID = 'second-sync';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'pref-restore-'));

const adapter = await import('../../dist/src/lib/actual-adapter.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');

let passed = 0, failed = 0;
function ok(m) { console.log(`  PASS: ${m}`); passed++; }
function bad(m) { console.error(`  FAIL: ${m}`); failed++; }
function assert(c, m) { c ? ok(m) : bad(m); }

console.log('Running #189 budget-preference restart-replay test');

adapter._setSkipApiInitForTests(true); // no real downloadBudget / pool I/O

async function run(ctx, fn) {
  return await new Promise((resolve, reject) => {
    requestContext.run(ctx, async () => {
      try { resolve(await fn()); } catch (e) { reject(e); }
    });
  });
}

try {
  // 1) Session A (principal alice) switches to the "Second" budget. This persists
  //    the preference for alice and sets the in-session slot for session A.
  await run({ sessionId: 'sessA', principal: 'alice', allowedBudgets: ['*'] }, async () => {
    const r = await adapter.switchBudget('Second');
    assert(r.syncId === 'second-sync', 'switchBudget("Second") in session A returns the Second budget');
  });

  // 2) POSITIVE restart-replay: a FRESH session B for alice (no in-session slot,
  //    as after a restart + re-initialize) restores the persisted budget because
  //    the ACL permits it.
  await run({ sessionId: 'sessB', principal: 'alice', allowedBudgets: ['*'] }, async () => {
    const active = adapter._getActiveBudgetConfigForTests();
    assert(active.syncId === 'second-sync',
      'fresh session B for alice restores the Second budget (restart-replay)');
  });

  // 3) NEGATIVE (ACL): a fresh session for alice whose live ACL no longer permits
  //    the Second budget must NOT restore it; it falls back to the default.
  await run({ sessionId: 'sessC', principal: 'alice', allowedBudgets: ['default-sync'] }, async () => {
    const active = adapter._getActiveBudgetConfigForTests();
    assert(active.syncId === 'default-sync',
      'fresh session whose ACL excludes the preference falls back to default (no widening)');
  });

  // 4) NEGATIVE (different principal): bob has no stored preference, so a fresh
  //    session for bob gets the env-default budget, not alice's choice.
  await run({ sessionId: 'sessD', principal: 'bob', allowedBudgets: ['*'] }, async () => {
    const active = adapter._getActiveBudgetConfigForTests();
    assert(active.syncId === 'default-sync',
      "a different principal (bob) does not inherit alice's restored budget");
  });

  // 5) NEGATIVE (no principal): stdio-style call with no principal restores nothing.
  await run({ sessionId: 'sessE', allowedBudgets: ['*'] }, async () => {
    const active = adapter._getActiveBudgetConfigForTests();
    assert(active.syncId === 'default-sync',
      'a session with no principal restores nothing (env-default)');
  });
} catch (e) {
  bad(`unexpected throw: ${e && e.stack ? e.stack : e}`);
}

console.log(`\n[budget-preference-restore] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
