// tests/unit/budgets_import_syncid.test.js
//
// #349: an import changes which budget is loaded, so the connection pool's record
// of the loaded syncId must stop naming the previous one.
//
// THE BUG THIS PINS. switchBudget's #172 fast path skips the re-download when
// `currentEntry.syncId === found.syncId`, trusting that field as the record of
// what is loaded. importBudget never updated it, so a switch BACK to the
// configured budget hit the fast path, returned `{success: true}`, and left the
// session on the imported copy. Subsequent writes and deletes then landed in the
// WRONG BUDGET while the caller believed the switch happened.
//
// The assertion that matters is the last one: a switch after an import must
// actually re-download. Asserting only that updateLoadedSyncId was called would
// pass even if the fast path still matched.
//
// Run: node tests/unit/budgets_import_syncid.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '11111111-1111-1111-1111-111111111111';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
process.env.BUDGET_1_NAME         = 'Secondary';
process.env.BUDGET_1_SYNC_ID      = '22222222-2222-2222-2222-222222222222';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

const CONFIGURED_SYNC_ID = '22222222-2222-2222-2222-222222222222';

(async () => {
  // ORDER IS LOAD BEARING. actual-adapter.ts destructures the @actual-app/api
  // default export into raw* bindings at MODULE LOAD, so patching the module
  // object after importing the adapter has no effect: the adapter already holds
  // its own references and would call the real functions. Patch first, import the
  // adapter second.
  const api = await import('@actual-app/api');
  let downloads = 0;
  api.default.importBudget = async () => ({ id: '_imported-budget' });
  api.default.downloadBudget = async () => { downloads += 1; return { success: true }; };
  api.default.sync = async () => {};

  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  const adapter = await import('../../dist/src/lib/actual-adapter.js');
  const pool = await import('../../dist/src/lib/ActualConnectionPool.js');

  // The write queue calls api.init() on the legacy path, which reaches a real
  // server. The adapter exposes a hook for exactly this, used by the other
  // write-path unit tests; without it this test hits the network and fails on
  // authentication rather than on the behaviour under test.
  adapter._setSkipApiInitForTests(true);

  // A fake pool entry standing in for a live HTTP session already on the
  // configured budget. This is the state the bug needs.
  const entry = {
    serverUrl: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
    encryptionPassword: undefined,
    syncId: CONFIGURED_SYNC_ID,
    lastActivity: Date.now(),
  };
  // The adapter reads the entry via getConnectionInfo, not getEntry. Stubbing
  // the wrong accessor leaves currentEntry undefined, sameAuth false, and the
  // whole fast-path question untested.
  pool.connectionPool.getConnectionInfo = () => entry;
  pool.connectionPool.hasConnection = () => true;
  pool.connectionPool.shutdownConnection = async () => {};
  pool.connectionPool.getConnection = async () => ({});
  pool.connectionPool.updateLoadedSyncId = (sid, newSyncId) => { entry.syncId = newSyncId; };
  // The import path invalidates EVERY entry, not just the importing session's:
  // the api singleton is process-global, so one import changes what every pooled
  // session is looking at. The fake pool here holds a single entry.
  let invalidateAllCalls = 0;
  pool.connectionPool.invalidateAllLoadedSyncIds = (sentinel) => {
    invalidateAllCalls += 1; entry.syncId = sentinel; return 1;
  };

  const SESSION = 'http-session-349';

  console.log('\n[import-syncid] the pooled syncId is invalidated by an import');
  {
    check(entry.syncId === CONFIGURED_SYNC_ID, 'precondition: the pool believes the configured budget is loaded');

    await requestContext.run({ sessionId: SESSION }, () => adapter.default.importBudget('x', { type: 'actual' }));

    check(entry.syncId !== CONFIGURED_SYNC_ID,
      'after an import the pool no longer names the configured budget',
      `syncId is still ${entry.syncId}`);
    check(String(entry.syncId).startsWith('imported:'),
      'and it records that an imported budget is loaded');
    // A configured syncId is a UUID, so the sentinel can never compare equal to
    // one. That is what makes the fast path structurally unable to match.
    check(!/^[0-9a-f-]{36}$/.test(String(entry.syncId)),
      'the sentinel can never be mistaken for a configured syncId');
    check(invalidateAllCalls === 1,
      'and the invalidation is POOL-WIDE, so other sessions sharing the process-global api singleton are covered too');
  }

  console.log('\n[import-syncid] REGRESSION GUARD: a switch after an import RE-DOWNLOADS');
  {
    // The hook is turned OFF for the switch assertions on purpose. With it on,
    // switchBudget's same-auth reload branch deliberately SKIPS the real
    // downloadBudget ("tests verify the fast path was taken by spying on
    // shutdownConnection"), so the counter could never move and the test would
    // pass or fail for reasons unrelated to the bug. api.downloadBudget is looked
    // up as a property at call time, so the stub above is what actually runs.
    adapter._setSkipApiInitForTests(false);
    downloads = 0;
    const res = await requestContext.run({ sessionId: SESSION }, () => adapter.switchBudget('Secondary'));
    check(downloads > 0,
      'switching back after an import actually re-downloads the budget (no silent no-op)',
      `downloadBudget was called ${downloads} time(s)`);
    check(res?.syncId === CONFIGURED_SYNC_ID, 'and the switch reports the configured budget');
    check(entry.syncId === CONFIGURED_SYNC_ID, 'and the pool record is correct again afterwards');
  }

  console.log('\n[import-syncid] the #172 fast path still works when it legitimately should');
  {
    // Already on the configured budget with a matching auth descriptor: no
    // re-download. The fix must not disable the optimisation it guards.
    downloads = 0;
    await requestContext.run({ sessionId: SESSION }, () => adapter.switchBudget('Secondary'));
    check(downloads === 0,
      'a switch to the already-loaded budget still short-circuits (#172 preserved)',
      `downloadBudget was called ${downloads} time(s)`);
    adapter._setSkipApiInitForTests(true);
  }

  console.log('\n[import-syncid] a session-less import does not throw');
  {
    // CLI scripts and startup paths import outside any requestContext. There is
    // no pool entry to invalidate, and that must be a no-op rather than a crash.
    let threw = false;
    try { await adapter.default.importBudget('x', { type: 'actual' }); } catch { threw = true; }
    check(threw === false, 'importing with no session id is safe');
  }

  console.log('');
  if (failures === 0) console.log('[import-syncid] All tests passed');
  else { console.error(`[import-syncid] ${failures} test(s) FAILED`); process.exit(2); }
})();
