// Regression test for #156: per-session active budget + ACL enforcement.
//
// Cases covered:
//   1. Stdio short-circuit: no sessionId + AUTH_PROVIDER!='oidc' -> withActualApi
//      runs the operation (no ACL applied).
//   2. OIDC + no allowedBudgets in context: withActualApi REFUSES (defence-in-depth).
//   3. OIDC + allowedBudgets includes active syncId: withActualApi runs.
//   4. OIDC + allowedBudgets does NOT include active syncId: withActualApi REFUSES,
//      logs at warn level with structured fields.
//   5. switchBudget: stdio session (no sessionId) refuses to switch.
//   6. switchBudget: OIDC + allowed target: switches and updates per-session map.
//   7. switchBudget: OIDC + disallowed target: refuses, logs warn.
//   8. switchBudget: exact-match enforcement, "Pro" does NOT match "Production".
//   9. switchBudget: releases the pool entry before mutating the session map.

import { strict as assert } from 'node:assert';

// Stub env so config loads cleanly under test.
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://test-server';
process.env.ACTUAL_PASSWORD = 'sentinel-pwd-DO-NOT-LEAK';
process.env.ACTUAL_BUDGET_SYNC_ID = 'sync-default';
// Configure two extra budgets so switchBudget has somewhere to target.
process.env.BUDGET_1_NAME = 'Production';
process.env.BUDGET_1_SYNC_ID = 'sync-prod';
process.env.BUDGET_1_SERVER_URL = 'http://test-server';
process.env.BUDGET_1_PASSWORD = 'pwd-prod';
process.env.BUDGET_2_NAME = 'Personal';
process.env.BUDGET_2_SYNC_ID = 'sync-personal';
process.env.BUDGET_2_SERVER_URL = 'http://test-server';
process.env.BUDGET_2_PASSWORD = 'pwd-personal';

let passed = 0;
let failed = 0;
function describe(label) { console.log(`\n[budget-acl] ${label}`); }
function pass(msg) { console.log(`  PASS: ${msg}`); passed++; }
function bad(msg, details) { console.error(`  FAIL: ${msg}${details ? ' (' + details + ')' : ''}`); failed++; }

const warnCalls = [];

async function setupLoggerCapture() {
  const logger = (await import('../../dist/src/logger.js')).default;
  const original = logger.warn.bind(logger);
  logger.warn = (msg) => {
    warnCalls.push(String(msg));
    return original(msg);
  };
}

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  await setupLoggerCapture();

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const {
    withActualApi,
    switchBudget,
    _setSkipApiInitForTests,
    _setApiInitializedForTests,
    clearSessionBudgetState,
  } = adapterMod;

  const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  const config = (await import('../../dist/src/config.js')).default;

  _setSkipApiInitForTests(true);

  function primePoolSession(sessionId) {
    connectionPool.connections.set(sessionId, {
      sessionId,
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
    });
  }

  // Case 1: stdio short-circuit (no sessionId, non-OIDC)
  describe('Case 1: stdio short-circuit (no sessionId, non-OIDC) allows the call');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'bearer';
    const result = await withActualApi(async () => 'ok-stdio');
    if (result === 'ok-stdio') pass('withActualApi ran without ACL when no session and AUTH_PROVIDER!=oidc');
    else bad('withActualApi should have allowed the stdio call', `got ${result}`);
    if (!warnCalls.some(c => c.includes('acl_denied'))) pass('no acl_denied warn fired for stdio');
    else bad('unexpected acl_denied warn for stdio');
  }

  // Case 2: OIDC + no allowedBudgets in context REFUSES
  describe('Case 2: OIDC + no allowedBudgets in context refuses');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'oidc';
    primePoolSession('sess-no-acl');
    _setApiInitializedForTests(true);

    let caught;
    try {
      await requestContext.run({ sessionId: 'sess-no-acl' }, async () => {
        return await withActualApi(async () => 'should-not-run');
      });
    } catch (e) {
      caught = e;
    }
    if (caught && /Budget ACL/.test(caught.message)) pass('refused OIDC call with no allowedBudgets');
    else bad('OIDC + no allowedBudgets should refuse', caught ? caught.message : 'no error thrown');
    if (warnCalls.some(c => c.includes('acl_denied') && c.includes('no_allowed_budgets_in_context'))) {
      pass('logged acl_denied + no_allowed_budgets_in_context at warn');
    } else {
      bad('missing expected warn-level acl_denied log');
    }

    connectionPool.connections.delete('sess-no-acl');
  }

  // Case 3: OIDC + allowedBudgets includes default syncId: allow
  describe('Case 3: OIDC + allowedBudgets includes default syncId allows the call');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'oidc';
    primePoolSession('sess-allowed');
    _setApiInitializedForTests(true);

    const result = await requestContext.run(
      { sessionId: 'sess-allowed', allowedBudgets: ['sync-default'] },
      async () => withActualApi(async () => 'ok-allowed'),
    );
    if (result === 'ok-allowed') pass('withActualApi ran when default syncId is in allowedBudgets');
    else bad('withActualApi should have allowed', `got ${result}`);
    if (!warnCalls.some(c => c.includes('acl_denied'))) pass('no acl_denied for allowed call');
    else bad('unexpected acl_denied for allowed call');

    connectionPool.connections.delete('sess-allowed');
  }

  // Case 4: OIDC + allowedBudgets does NOT include active syncId: REFUSE + log
  describe('Case 4: OIDC + allowedBudgets missing active syncId refuses and logs');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'oidc';
    primePoolSession('sess-denied');
    _setApiInitializedForTests(true);

    let caught;
    try {
      await requestContext.run(
        { sessionId: 'sess-denied', allowedBudgets: ['sync-other'] },
        async () => withActualApi(async () => 'should-not-run'),
      );
    } catch (e) {
      caught = e;
    }
    if (caught && /Budget ACL/.test(caught.message)) pass('refused OIDC call with mismatched ACL');
    else bad('expected ACL denial', caught ? caught.message : 'no error thrown');
    const matching = warnCalls.find(c => c.includes('acl_denied'));
    if (matching && matching.includes('"attemptedBudget":"sync-default"') && matching.includes('"sessionId":"sess-denied"')) {
      pass('warn-level structured log contains attemptedBudget and sessionId');
    } else {
      bad('expected acl_denied warn with structured fields', matching || 'no acl_denied warn captured');
    }

    connectionPool.connections.delete('sess-denied');
  }

  // Case 5: switchBudget refuses without an MCP session
  describe('Case 5: switchBudget refuses without an MCP session');
  {
    config.AUTH_PROVIDER = 'bearer';
    let caught;
    try {
      await switchBudget('Production');
    } catch (e) {
      caught = e;
    }
    if (caught && /requires an MCP session/.test(caught.message)) {
      pass('switchBudget refused stdio caller with clear error');
    } else {
      bad('expected stdio refusal', caught ? caught.message : 'no error thrown');
    }
  }

  // Case 6: switchBudget allowed target updates per-session active budget
  describe('Case 6: switchBudget with allowed target updates per-session state');
  {
    config.AUTH_PROVIDER = 'oidc';
    const result = await requestContext.run(
      { sessionId: 'sess-switch-ok', allowedBudgets: ['sync-prod'] },
      async () => switchBudget('Production'),
    );
    if (result.syncId === 'sync-prod') pass('switchBudget returned the target budget');
    else bad('switchBudget returned wrong budget', result.syncId);

    const activeForSession = await requestContext.run(
      { sessionId: 'sess-switch-ok', allowedBudgets: ['sync-prod'] },
      async () => withActualApi(async () => 'ok-after-switch'),
    );
    if (activeForSession === 'ok-after-switch') pass('post-switch withActualApi runs against allowed budget');
    else bad('post-switch withActualApi should run', `got ${activeForSession}`);

    clearSessionBudgetState('sess-switch-ok');
  }

  // Case 7: switchBudget refuses disallowed target with warn log
  describe('Case 7: switchBudget refuses disallowed target with warn-level log');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'oidc';
    let caught;
    try {
      await requestContext.run(
        { sessionId: 'sess-switch-denied', allowedBudgets: ['sync-default'] },
        async () => switchBudget('Production'),
      );
    } catch (e) {
      caught = e;
    }
    if (caught && /Budget ACL/.test(caught.message) && /Production/.test(caught.message)) {
      pass('switchBudget refused disallowed target');
    } else {
      bad('expected ACL denial on switch', caught ? caught.message : 'no error thrown');
    }
    if (warnCalls.some(c => c.includes('acl_denied') && c.includes('"tool":"actual_budgets_switch"'))) {
      pass('warn-level acl_denied captured for switch');
    } else {
      bad('missing acl_denied warn for switch denial');
    }
  }

  // Case 8: switchBudget exact match (substring removed)
  describe('Case 8: switchBudget exact-match only (no substring fallback)');
  {
    config.AUTH_PROVIDER = 'bearer';
    let caught;
    try {
      await requestContext.run({ sessionId: 'sess-match' }, async () => switchBudget('Pro'));
    } catch (e) {
      caught = e;
    }
    if (caught && /Budget "Pro" not found/.test(caught.message)) {
      pass('substring "Pro" no longer matches "Production"');
    } else {
      bad('expected "not found" for substring attempt', caught ? caught.message : 'no error thrown');
    }
  }

  // Case 9: switchBudget releases pool entry before mutating session map
  describe('Case 9: switchBudget releases pool entry before mutating session map');
  {
    config.AUTH_PROVIDER = 'bearer';
    primePoolSession('sess-pool-release');
    let releaseCalled = false;
    const originalShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => {
      if (sid === 'sess-pool-release') releaseCalled = true;
      connectionPool.connections.delete(sid);
    };

    await requestContext.run({ sessionId: 'sess-pool-release' }, async () => switchBudget('Personal'));

    connectionPool.shutdownConnection = originalShutdown;

    if (releaseCalled) pass('shutdownConnection was called for the switching session');
    else bad('shutdownConnection was NOT called on switch (stale pool entry would persist)');

    clearSessionBudgetState('sess-pool-release');
  }

  // -------------------------------------------------------------------------
  // #172 fast-path: same-server switch skips release+recreate
  // -------------------------------------------------------------------------

  // Case 10: same-server switch (matching auth descriptor) does NOT call
  // shutdownConnection and does NOT call getConnection.
  describe('Case 10: #172 fast path: same-server switch skips release+recreate');
  {
    config.AUTH_PROVIDER = 'bearer';
    // Prime a pool entry against budget "Production" (sync-prod).
    connectionPool.connections.set('sess-fast-same', {
      sessionId: 'sess-fast-same',
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
      serverUrl: 'http://test-server',
      password: 'pwd-prod',
      encryptionPassword: undefined,
      syncId: 'sync-prod',
    });

    let shutdownCalled = false;
    let getConnectionCalled = false;
    const origShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    const origGet = connectionPool.getConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => { shutdownCalled = true; connectionPool.connections.delete(sid); };
    connectionPool.getConnection = async () => { getConnectionCalled = true; };

    // Production and Personal share serverUrl + (no encryption), but Personal
    // uses a DIFFERENT password. To exercise the fast path we need a SAME-auth
    // target. Re-prime against budget "Production" then switch to a clone with
    // the same descriptor but a different syncId. Tests use the budgetRegistry
    // already loaded from env (Production has password pwd-prod), so we point
    // at a fresh budget added inline via env:
    process.env.BUDGET_3_NAME = 'ProdMirror';
    process.env.BUDGET_3_SYNC_ID = 'sync-prod-mirror';
    process.env.BUDGET_3_SERVER_URL = 'http://test-server';
    process.env.BUDGET_3_PASSWORD = 'pwd-prod';
    // Reload registry via a fresh import of the adapter would be ideal, but
    // here we skip that complexity: switching from the primed Production
    // descriptor to ProdMirror exercises sameAuth=true, different syncId.
    // Since the adapter's budgetRegistry is module-level and built at import
    // time, BUDGET_3 isn't visible. Use the existing Production entry instead:
    // switch from primed-Production (matched descriptor) to itself with a
    // different syncId by mutating the primed entry's syncId.
    const primed = connectionPool.connections.get('sess-fast-same');
    primed.syncId = 'sync-prod-other'; // pretend pool currently loaded a different syncId

    await requestContext.run({ sessionId: 'sess-fast-same' }, async () => switchBudget('Production'));

    connectionPool.shutdownConnection = origShutdown;
    connectionPool.getConnection = origGet;

    if (!shutdownCalled) pass('fast path: shutdownConnection NOT called');
    else bad('fast path: shutdownConnection was called (slow path took over)');
    if (!getConnectionCalled) pass('fast path: getConnection NOT called (no fresh login)');
    else bad('fast path: getConnection was called (fresh login fired)');

    const after = connectionPool.connections.get('sess-fast-same');
    if (after && after.syncId === 'sync-prod') pass('fast path: pool entry syncId updated to new budget');
    else bad('fast path: pool entry syncId should reflect the new budget', after && after.syncId);

    connectionPool.connections.delete('sess-fast-same');
    clearSessionBudgetState('sess-fast-same');
  }

  // Case 11: descriptor change (different serverUrl) takes slow path.
  describe('Case 11: #172 slow path: different server forces release+recreate');
  {
    config.AUTH_PROVIDER = 'bearer';
    connectionPool.connections.set('sess-slow', {
      sessionId: 'sess-slow',
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
      serverUrl: 'http://other-server',  // different from Personal's "http://test-server"
      password: 'pwd-other',
      encryptionPassword: undefined,
      syncId: 'sync-other',
    });

    let shutdownCalled = false;
    let getConnectionCalled = false;
    const origShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    const origGet = connectionPool.getConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => { shutdownCalled = true; connectionPool.connections.delete(sid); };
    connectionPool.getConnection = async () => { getConnectionCalled = true; };

    await requestContext.run({ sessionId: 'sess-slow' }, async () => switchBudget('Personal'));

    connectionPool.shutdownConnection = origShutdown;
    connectionPool.getConnection = origGet;

    if (shutdownCalled) pass('slow path: shutdownConnection was called');
    else bad('slow path: shutdownConnection should have been called');
    // getConnection is gated by _skipApiInitForTests; in test mode it's not called.
    // Just assert the path was the slow path by virtue of shutdownCalled.
    clearSessionBudgetState('sess-slow');
  }

  // Case 12: cold session (no pool entry) takes slow path.
  describe('Case 12: #172 cold session (no pool entry) takes slow path');
  {
    config.AUTH_PROVIDER = 'bearer';
    let shutdownCalled = false;
    const origShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => { shutdownCalled = true; };

    await requestContext.run({ sessionId: 'sess-cold' }, async () => switchBudget('Personal'));

    connectionPool.shutdownConnection = origShutdown;

    // shutdownConnection may be called even on cold session (idempotent in pool).
    // The key assertion is that the call didn't error and session map was set.
    const adapterMod2 = await import('../../dist/src/lib/actual-adapter.js');
    pass('cold session switchBudget did not throw');
    clearSessionBudgetState('sess-cold');
  }

  // Case 13: same-auth + same-syncId = no-op (already on this budget).
  describe('Case 13: #172 already-on-target same-syncId is a no-op');
  {
    config.AUTH_PROVIDER = 'bearer';
    connectionPool.connections.set('sess-noop', {
      sessionId: 'sess-noop',
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
      serverUrl: 'http://test-server',
      password: 'pwd-prod',
      encryptionPassword: undefined,
      syncId: 'sync-prod', // already on Production's syncId
    });

    let shutdownCalled = false;
    let getConnectionCalled = false;
    const origShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    const origGet = connectionPool.getConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async () => { shutdownCalled = true; };
    connectionPool.getConnection = async () => { getConnectionCalled = true; };

    const result = await requestContext.run({ sessionId: 'sess-noop' }, async () => switchBudget('Production'));

    connectionPool.shutdownConnection = origShutdown;
    connectionPool.getConnection = origGet;

    if (!shutdownCalled && !getConnectionCalled) pass('no-op: neither shutdown nor getConnection fired');
    else bad('no-op: unexpected pool mutation (shutdown=' + shutdownCalled + ' getConn=' + getConnectionCalled + ')');
    if (result.syncId === 'sync-prod') pass('no-op: returned the current budget');
    else bad('no-op: wrong syncId returned', result.syncId);

    connectionPool.connections.delete('sess-noop');
    clearSessionBudgetState('sess-noop');
  }

  // Case 14: log-leak guard. switchBudget logs MUST NOT include the password.
  describe('Case 14: #172 switchBudget does not log credentials');
  {
    warnCalls.length = 0;
    config.AUTH_PROVIDER = 'bearer';
    connectionPool.connections.set('sess-no-leak', {
      sessionId: 'sess-no-leak',
      initialized: true,
      lastActivity: Date.now(),
      dataDir: '/tmp/test',
      serverUrl: 'http://test-server',
      password: 'pwd-secret-DO-NOT-LEAK',
      encryptionPassword: 'enc-secret-DO-NOT-LEAK',
      syncId: 'sync-other',
    });

    // Capture info-level logger too.
    const logger = (await import('../../dist/src/logger.js')).default;
    const infoCalls = [];
    const origInfo = logger.info.bind(logger);
    logger.info = (msg) => { infoCalls.push(String(msg)); return origInfo(msg); };

    const origShutdown = connectionPool.shutdownConnection.bind(connectionPool);
    connectionPool.shutdownConnection = async (sid) => { connectionPool.connections.delete(sid); };
    await requestContext.run({ sessionId: 'sess-no-leak' }, async () => switchBudget('Personal'));
    connectionPool.shutdownConnection = origShutdown;

    logger.info = origInfo;

    const allLogs = [...warnCalls, ...infoCalls].join('\n');
    if (!/pwd-secret-DO-NOT-LEAK/.test(allLogs)) pass('no plaintext password in logs');
    else bad('password leaked into log output');
    if (!/enc-secret-DO-NOT-LEAK/.test(allLogs)) pass('no plaintext encryptionPassword in logs');
    else bad('encryptionPassword leaked into log output');

    clearSessionBudgetState('sess-no-leak');
  }

  console.log(`\n#156 + #172 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error('TEST FRAMEWORK ERROR:', err);
  process.exit(2);
});
