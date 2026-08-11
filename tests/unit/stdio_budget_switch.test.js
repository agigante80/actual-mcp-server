// tests/unit/stdio_budget_switch.test.js
//
// #348: stdio gets a synthetic per-process session id so actual_budgets_switch
// works on both transports.
//
// THE PROPERTY THAT MUST NOT REGRESS IS #156's. The active budget used to be a
// process-global, which in multi-user HTTP mode let one user's switch change the
// budget for everyone across ACL boundaries. The replacement is a per-session map.
// This ticket does NOT reintroduce a global: it gives the stdio process its own
// session identity, so two stdio processes get two slots. The "does not leak
// between session ids" case below is the guard for that, and it is the one that
// must fail if someone later "simplifies" this into a shared variable.
//
// Run: node tests/unit/stdio_budget_switch.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '11111111-1111-1111-1111-111111111111';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';
// A second budget, so there is something to switch TO.
// NOTE ON REGISTRY ORDER: the env-default budget built from ACTUAL_* is entry
// [0] and is named "Default"; BUDGET_n_* entries are appended AFTER it. So the
// budget a fresh session resolves is "Default", not BUDGET_1. Getting this wrong
// makes the isolation assertions below look like leakage when they are fine.
process.env.BUDGET_1_NAME         = 'Primary';
process.env.BUDGET_1_SYNC_ID      = '11111111-1111-1111-1111-111111111111';
process.env.BUDGET_2_NAME         = 'Secondary';
process.env.BUDGET_2_SYNC_ID      = '22222222-2222-2222-2222-222222222222';
const ENV_DEFAULT = 'Default';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);
const rejects = async (fn, substr, label) => {
  try { await fn(); fail(label, 'did not throw'); }
  catch (err) { check(String(err.message).includes(substr), label, `message was: ${err.message}`); }
};

(async () => {
  const { requestContext } = await import('../../dist/src/lib/requestContext.js');
  const adapter = await import('../../dist/src/lib/actual-adapter.js');
  const cfg = (await import('../../dist/src/config.js')).default;
  const { switchBudget, _getActiveBudgetConfigForTests } = adapter;

  // switchBudget performs real upstream work (pool release, budget download).
  // Stub the parts that would touch a server; the session bookkeeping under test
  // is pure.
  const pool = await import('../../dist/src/lib/ActualConnectionPool.js');
  pool.connectionPool.shutdownConnection = async () => {};
  pool.connectionPool.hasConnection = () => false;
  // COUNT the pool materialisations rather than silently swallowing them. The
  // first version of this test stubbed getConnection to a no-op, which made it
  // structurally incapable of catching the defect it should have caught: stdio
  // was creating a pool entry on every switch, contradicting the source comment
  // that said it did not. A stub that hides the behaviour under test is worse
  // than no test. Stubbing is still required, or switchBudget reaches a real
  // Actual server and trips its login rate limiter.
  let poolMaterialisations = 0;
  pool.connectionPool.getConnection = async () => { poolMaterialisations += 1; return {}; };
  adapter.default.downloadBudget = async () => ({ success: true });

  const active = (sessionId) =>
    requestContext.run({ sessionId }, () => _getActiveBudgetConfigForTests().name);

  console.log('\n[stdio-switch] a sessionless caller is still refused');
  {
    // Startup health checks and CLI scripts run outside any requestContext. The
    // refusal must survive for them: writing to a slot nobody reads is #347.
    await rejects(() => switchBudget('Secondary'), 'requires an MCP session',
      'switchBudget with NO requestContext scope still throws');
  }

  console.log('\n[stdio-switch] a synthetic session id makes the switch work');
  {
    const sid = 'stdio-11111111-2222-3333-4444-555555555555';
    check(active(sid) === ENV_DEFAULT, 'before switching, the session resolves the env-default budget');

    await requestContext.run({ sessionId: sid }, () => switchBudget('Secondary'));
    check(active(sid) === 'Secondary',
      'after switching, the SAME session resolves the new budget (the switch actually took effect)');
  }

  console.log('\n[stdio-switch] REGRESSION GUARD (#156): no leakage between sessions');
  {
    const a = 'stdio-aaaaaaaa-0000-0000-0000-000000000000';
    const b = 'stdio-bbbbbbbb-0000-0000-0000-000000000000';
    await requestContext.run({ sessionId: a }, () => switchBudget('Secondary'));
    check(active(a) === 'Secondary', 'session A sees its own switch');
    check(active(b) === ENV_DEFAULT,
      'session B is UNAFFECTED by session A (a process-global would fail this)');
    check(active(undefined) === ENV_DEFAULT,
      'and a sessionless caller still resolves the env-default');
  }

  console.log('\n[stdio-switch] an unknown budget is refused and changes nothing');
  {
    const sid = 'stdio-cccccccc-0000-0000-0000-000000000000';
    await requestContext.run({ sessionId: sid }, () => switchBudget('Secondary'));
    await rejects(
      () => requestContext.run({ sessionId: sid }, () => switchBudget('NoSuchBudget')),
      'not found in configuration',
      'switching to an unconfigured name throws the not-found error',
    );
    check(active(sid) === 'Secondary', 'and the previous selection is left intact');
  }

  console.log('\n[stdio-switch] the OIDC ACL is still enforced for a stdio caller');
  {
    // A stdio caller has no allowedBudgets. Under OIDC that must DENY: a local
    // pipe must not gain budget access an HTTP caller would need an ACL for.
    const prev = cfg.AUTH_PROVIDER;
    cfg.AUTH_PROVIDER = 'oidc';
    const sid = 'stdio-dddddddd-0000-0000-0000-000000000000';
    await rejects(
      () => requestContext.run({ sessionId: sid }, () => switchBudget('Secondary')),
      'No allowedBudgets in request context',
      'under AUTH_PROVIDER=oidc a context without allowedBudgets is denied',
    );
    cfg.AUTH_PROVIDER = prev;
  }

  console.log('\n[stdio-switch] REGRESSION GUARD: stdio stays OFF the pooled path');
  {
    // The property the source comment claims, asserted for real. switchBudget's
    // slow path materialises a connection-pool entry; for stdio that entry would
    // never be touched (connectionPool.touch() is called only from
    // httpServer.ts), so it would expire after the idle timeout and be shut down
    // by the cleanup sweep without the api lock, possibly mid-operation.
    const sid = 'stdio-eeeeeeee-0000-0000-0000-000000000000';
    poolMaterialisations = 0;
    await requestContext.run({ sessionId: sid, transport: 'stdio' }, () => switchBudget('Secondary'));
    check(poolMaterialisations === 0,
      'a stdio switch creates NO pool entry',
      `getConnection was called ${poolMaterialisations} time(s)`);
    check(active(sid) === 'Secondary', 'and the switch still takes effect via the legacy path');

    // The HTTP path is unchanged: it SHOULD materialise an entry.
    poolMaterialisations = 0;
    await requestContext.run({ sessionId: 'http-session-1', transport: 'http' }, () => switchBudget('Secondary'));
    check(poolMaterialisations === 1,
      'an HTTP switch still materialises a pool entry (the fix is scoped to stdio)');
  }

  console.log('\n[stdio-switch] the stdio server wraps dispatch, not connect()');
  {
    // The wrap must be around the CallToolRequestSchema handler. Around
    // server.connect() it would not propagate: the transport invokes handlers
    // from I/O events, outside that scope. Asserted statically because
    // exercising it needs a live stdio process.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/server/stdioServer.ts', 'utf8');
    check(/requestContext\.run\(\s*\{\s*sessionId: stdioSessionId\b/.test(src),
      'dispatch runs inside requestContext.run with the synthetic id');
    check(src.includes('const stdioSessionId = `stdio-${randomUUID()}`'),
      'the id is minted per process, not a shared constant');
    const connectIdx = src.indexOf('server.connect(transport)');
    const runIdx = src.indexOf('requestContext.run');
    check(runIdx !== -1 && runIdx < connectIdx,
      'the wrap is at the handler, which appears before connect() in this file');
    check(!/principal:/.test(src.slice(runIdx, runIdx + 400)),
      'no principal is placed in the store (that would trigger the #189 restore)');
    check(/transport: 'stdio'/.test(src),
      "the scope is marked transport:'stdio', which is what keeps it off the pooled path");
  }

  console.log('');
  if (failures === 0) console.log('[stdio-switch] All tests passed');
  else { console.error(`[stdio-switch] ${failures} test(s) FAILED`); process.exit(2); }
})();
