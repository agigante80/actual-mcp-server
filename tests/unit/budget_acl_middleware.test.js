// tests/unit/budget_acl_middleware.test.js
//
// #338: proves the COMMON deployments are untouched by the dynamic-ACL work.
//
// The overwhelming majority of installs are not multi-user OIDC. They are either
// a static bearer token over HTTP, or stdio with no HTTP auth at all. Before this
// file, `budgetAclMiddleware` had NO direct test coverage of any kind, so adding a
// branch to it was unguarded: nothing would have failed if the new code had
// started running on those paths.
//
// The load-bearing assertions here are the NEGATIVE ones: that the dynamic
// resolver is never invoked unless a deployment has explicitly opted in with
// AUTH_BUDGET_ACL_SOURCE=actual. A dynamic-path regression on the common install
// would mean an upstream Actual call on every request, and a hard denial when
// that call fails, for users who never asked for the feature.
//
// Run: node tests/unit/budget_acl_middleware.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? 'sync-default';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

/** Minimal Express double: records what the middleware did. */
function makeCtx(auth) {
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = auth ? { auth } : {};
  const state = { nextCalled: false };
  const next = () => { state.nextCalled = true; };
  return { req, res, next, state };
}

/** Wait for the middleware's async branch to settle (it is fire-and-forget). */
const settle = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  const config = (await import('../../dist/src/config.js')).default;
  const { budgetAclMiddleware, _setAclForTests, _resetAclForTests } =
    await import('../../dist/src/auth/budget-acl.js');
  const dynamicMod = await import('../../dist/src/auth/budget-acl-dynamic.js');
  const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;

  // Tripwire: if the dynamic path runs, it must go through adapter.getBudgets().
  // Counting calls there proves whether the new code executed at all.
  let getBudgetsCalls = 0;
  const origGetBudgets = adapter.getBudgets;
  adapter.getBudgets = async () => { getBudgetsCalls++; return []; };

  const origProvider = config.AUTH_PROVIDER;
  const origSource = config.AUTH_BUDGET_ACL_SOURCE;
  const reset = () => { getBudgetsCalls = 0; dynamicMod._resetDynamicAclCache(); _resetAclForTests(); };

  // -------------------------------------------------------------------------
  console.log('\n[budget-acl-middleware] MOST COMMON: no OIDC at all (bearer token or stdio)');
  // -------------------------------------------------------------------------
  for (const provider of ['none', 'bearer', undefined]) {
    reset();
    config.AUTH_PROVIDER = provider;
    config.AUTH_BUDGET_ACL_SOURCE = 'static';
    const { req, res, next, state } = makeCtx(null);
    budgetAclMiddleware(req, res, next);
    await settle();
    check(state.nextCalled, `AUTH_PROVIDER=${provider}: request passes straight through`);
    check(res.statusCode === null, `AUTH_PROVIDER=${provider}: nothing is rejected`);
    check(req.allowedBudgets === undefined, `AUTH_PROVIDER=${provider}: no allowedBudgets is attached`);
    check(getBudgetsCalls === 0, `AUTH_PROVIDER=${provider}: the dynamic resolver is NEVER called`);
  }

  // -------------------------------------------------------------------------
  console.log('\n[budget-acl-middleware] the dynamic source cannot leak into a non-OIDC install');
  // -------------------------------------------------------------------------
  {
    // Even if someone sets the new var without OIDC, the provider gate wins.
    // Without this, a stray env var would put an upstream call on every request.
    reset();
    config.AUTH_PROVIDER = 'none';
    config.AUTH_BUDGET_ACL_SOURCE = 'actual';
    const { req, res, next, state } = makeCtx(null);
    budgetAclMiddleware(req, res, next);
    await settle();
    check(state.nextCalled, 'AUTH_BUDGET_ACL_SOURCE=actual without OIDC still passes through');
    check(getBudgetsCalls === 0, 'and still never calls the dynamic resolver');
    check(res.statusCode === null, 'and never rejects the request');
  }

  // -------------------------------------------------------------------------
  console.log('\n[budget-acl-middleware] OIDC with the DEFAULT static source');
  // -------------------------------------------------------------------------
  {
    reset();
    config.AUTH_PROVIDER = 'oidc';
    config.AUTH_BUDGET_ACL_SOURCE = 'static';

    // Unset ACL: every authenticated user is unrestricted (documented behaviour).
    _setAclForTests({});
    const a = makeCtx({ subject: 'alice-sub', claims: { email: 'alice@example.com' } });
    budgetAclMiddleware(a.req, a.res, a.next);
    await settle();
    check(a.state.nextCalled, 'unset ACL: request proceeds');
    check(JSON.stringify(a.req.allowedBudgets) === JSON.stringify(['*']), 'unset ACL: allowedBudgets is ["*"]');
    check(getBudgetsCalls === 0, 'unset ACL: the dynamic resolver is NEVER called');

    // Populated ACL: the mapped principal gets exactly its budgets.
    reset();
    _setAclForTests({ 'alice@example.com': ['sync-a'], 'group:admin': ['*'] });
    const b = makeCtx({ subject: 'alice-sub', claims: { email: 'alice@example.com' } });
    budgetAclMiddleware(b.req, b.res, b.next);
    await settle();
    check(b.state.nextCalled, 'mapped principal proceeds');
    check(JSON.stringify(b.req.allowedBudgets) === JSON.stringify(['sync-a']), 'mapped principal gets its own budgets');
    check(getBudgetsCalls === 0, 'mapped principal: the dynamic resolver is NEVER called');

    // Unmapped principal is refused by the static path, exactly as before.
    reset();
    _setAclForTests({ 'alice@example.com': ['sync-a'] });
    const c = makeCtx({ subject: 'mallory-sub', claims: { email: 'mallory@example.com' } });
    budgetAclMiddleware(c.req, c.res, c.next);
    await settle();
    check(!c.state.nextCalled, 'unmapped principal does NOT proceed');
    check(c.res.statusCode === 403, 'unmapped principal gets 403');
    check(getBudgetsCalls === 0, 'unmapped principal: the dynamic resolver is NEVER called');
  }

  // -------------------------------------------------------------------------
  console.log('\n[budget-acl-middleware] OIDC with the OPT-IN dynamic source');
  // -------------------------------------------------------------------------
  {
    // The positive control. If this did not run the resolver, the negative
    // assertions above would be vacuous: they would pass even if the dynamic
    // branch were dead code.
    reset();
    config.AUTH_PROVIDER = 'oidc';
    config.AUTH_BUDGET_ACL_SOURCE = 'actual';
    const d = makeCtx({ subject: 'alice-sub', claims: {} });
    budgetAclMiddleware(d.req, d.res, d.next);
    await settle();
    check(getBudgetsCalls === 1, 'opt-in: the dynamic resolver IS called (proves the guards above are real)');
    check(!d.state.nextCalled, 'opt-in with no matching file: request does not proceed');
    check(d.res.statusCode === 403, 'opt-in with no matching file: 403 rather than fail-open');
  }

  adapter.getBudgets = origGetBudgets;
  config.AUTH_PROVIDER = origProvider;
  config.AUTH_BUDGET_ACL_SOURCE = origSource;
  _resetAclForTests();

  console.log('');
  if (failures === 0) console.log('[budget-acl-middleware] All tests passed');
  else { console.error(`[budget-acl-middleware] ${failures} test(s) FAILED`); process.exit(2); }
})();
