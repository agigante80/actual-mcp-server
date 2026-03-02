// tests/unit/auth-acl.test.js
// Unit tests for src/auth/budget-acl.ts (CF-5: OIDC budget ACL)
//
// Tests the getAllowedBudgets() and canAccessBudget() functions using the
// _setAclForTests() helper to inject ACL maps without touching config/env.
//
// Run: node tests/unit/auth-acl.test.js  (or via npm run test:unit-js)

// Minimal env vars required for config.ts to parse without throwing
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID || 'unit-test-sync-id';
process.env.AUTH_PROVIDER = 'oidc';

import('../../dist/src/auth/budget-acl.js').then(({ getAllowedBudgets, canAccessBudget, _setAclForTests, _resetAclForTests }) => {
  let passed = 0;
  let failed = 0;

  function describe(label) {
    console.log(`\n[auth-acl] ${label}`);
  }

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  function assertDeepEqual(a, b, message) {
    const aStr = JSON.stringify([...a].sort());
    const bStr = JSON.stringify([...b].sort());
    assert(aStr === bStr, `${message} (got ${aStr}, expected ${bStr})`);
  }

  /** Build a mock Express request with the given auth claims */
  function mockReq({ sub, email, groups, claims } = {}) {
    return {
      auth: {
        token: 'fake-jwt',
        issuer: 'https://auth.example.com',
        clientId: 'test-client',
        scopes: ['read'],
        subject: sub,
        claims: { email, groups, ...claims },
      },
    };
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — empty ACL (no restrictions)')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({});

    const req = mockReq({ sub: 'user-123', email: 'alice@example.com' });
    assertDeepEqual(getAllowedBudgets(req), ['*'], 'returns ["*"] when ACL is empty');
    assert(canAccessBudget(req, 'any-budget-id'), 'canAccessBudget always true when ACL is empty');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — no req.auth (unauthenticated)')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({ 'alice@example.com': ['budget-1'] });

    const req = { auth: undefined };
    assertDeepEqual(getAllowedBudgets(req), [], 'returns [] when req.auth is undefined');
    assert(!canAccessBudget(req, 'budget-1'), 'canAccessBudget false when req.auth is undefined');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — matched by email')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'alice@example.com': ['budget-1', 'budget-2'],
      'bob@example.com': ['budget-3'],
    });

    const alice = mockReq({ email: 'alice@example.com' });
    const allowed = getAllowedBudgets(alice);
    assert(allowed.includes('budget-1'), 'email match: budget-1 allowed');
    assert(allowed.includes('budget-2'), 'email match: budget-2 allowed');
    assert(!allowed.includes('budget-3'), 'email match: budget-3 NOT allowed for alice');
    assert(canAccessBudget(alice, 'budget-1'), 'canAccessBudget true for allowed budget');
    assert(!canAccessBudget(alice, 'budget-3'), 'canAccessBudget false for disallowed budget');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — matched by sub claim')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'uid-abc-123': ['budget-42'],
    });

    const req = mockReq({ sub: 'uid-abc-123' });
    assertDeepEqual(getAllowedBudgets(req), ['budget-42'], 'sub match: correct budget returned');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — matched by group')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'group:admin': ['*'],
      'group:readers': ['budget-read-only'],
    });

    const admin = mockReq({ groups: ['admin', 'users'] });
    assertDeepEqual(getAllowedBudgets(admin), ['*'], 'group:admin gets wildcard ["*"]');
    assert(canAccessBudget(admin, 'any-budget'), 'admin canAccessBudget any budget');

    const reader = mockReq({ groups: ['readers'] });
    assertDeepEqual(getAllowedBudgets(reader), ['budget-read-only'], 'group:readers gets correct budget');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — wildcard via email')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'superuser@example.com': ['*'],
    });

    const su = mockReq({ email: 'superuser@example.com' });
    assertDeepEqual(getAllowedBudgets(su), ['*'], 'wildcard access via email');
    assert(canAccessBudget(su, 'any-budget-id'), 'wildcard grants any budget');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — user not in ACL at all')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'alice@example.com': ['budget-1'],
    });

    const stranger = mockReq({ sub: 'uid-stranger', email: 'stranger@example.com' });
    assertDeepEqual(getAllowedBudgets(stranger), [], 'unknown user gets empty list');
    assert(!canAccessBudget(stranger, 'budget-1'), 'unknown user cannot access any budget');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — union of sub + email + group budgets')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'uid-multi': ['budget-A'],
      'multi@example.com': ['budget-B'],
      'group:team': ['budget-C'],
    });

    const req = mockReq({ sub: 'uid-multi', email: 'multi@example.com', groups: ['team'] });
    const allowed = getAllowedBudgets(req);
    assert(allowed.includes('budget-A'), 'union: budget-A from sub');
    assert(allowed.includes('budget-B'), 'union: budget-B from email');
    assert(allowed.includes('budget-C'), 'union: budget-C from group');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  describe('getAllowedBudgets — roles claim (alternative to groups)')
  // ---------------------------------------------------------------------------
  {
    _setAclForTests({
      'group:finance': ['budget-finance'],
    });

    // Some IdPs use 'roles' instead of 'groups'
    const req = {
      auth: {
        token: 'fake-jwt',
        issuer: 'https://auth.example.com',
        clientId: 'test-client',
        scopes: ['read'],
        claims: { roles: ['finance'] },
      },
    };
    assertDeepEqual(getAllowedBudgets(req), ['budget-finance'], 'group mapped from roles claim');

    _resetAclForTests();
  }

  // ---------------------------------------------------------------------------
  console.log(`\n[auth-acl] Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error('[auth-acl] Failed to import module:', err);
  process.exit(1);
});
