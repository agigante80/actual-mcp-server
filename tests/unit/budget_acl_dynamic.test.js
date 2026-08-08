// tests/unit/budget_acl_dynamic.test.js
//
// #338: dynamic budget ACL derived from Actual's own per-file access list.
//
// THE FIXTURE IS REAL. It was captured from a live multi-user Actual server
// (password-bootstrapped, OpenID added, two users created via /admin/users, file
// access granted via /admin/access) and read back through @actual-app/api. The
// blank second row is not invented for the test: it is this server's own
// password/service account, which owns every file the API creates and has no
// userName because it is not an OpenID user.
//
// That blank row is the reason these tests exist. A name-based matcher facing a
// principal whose claim resolves to empty would match it, and it carries
// owner: true, so the principal would gain access to every file on the server.
//
// Run: node tests/unit/budget_acl_dynamic.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const ALICE = '5311397e-769d-4b71-9326-d625a05aacb5';
const BOB   = '9e27753d-5a87-49c3-a6dd-a9e67aa95ae9';
const SVC   = 'a6067f04-5f64-4af4-961c-bfea8a2b6f8a'; // the password/service account
const FILE_A = 'c2966198-d981-440e-835a-14fc72be60ce';
const FILE_B = 'dd111111-2222-3333-4444-555555555555';

// Captured live payload, plus a second file so cross-user isolation is testable.
const FILES = [
  // A local (non-remote) entry: no usersWithAccess at all. Present in every real
  // getBudgets() response and must be skipped rather than crash the matcher.
  { id: 'My-Finances-1-abc', cloudFileId: FILE_A, groupId: 'g1', name: 'Test Budget' },
  {
    cloudFileId: FILE_A, state: 'remote', name: 'Test Budget', hasKey: false, owner: SVC,
    usersWithAccess: [
      { userId: ALICE, displayName: 'Alice', userName: 'alice', owner: false },
      { userId: SVC,   displayName: '',      userName: '',      owner: true  },
    ],
  },
  {
    cloudFileId: FILE_B, state: 'remote', name: 'Bob Budget', hasKey: false, owner: SVC,
    usersWithAccess: [
      { userId: BOB, displayName: 'Bob', userName: 'bob', owner: false },
      { userId: SVC, displayName: '',    userName: '',    owner: true  },
    ],
  },
];

(async () => {
  const mod = await import('../../dist/src/auth/budget-acl-dynamic.js');
  const { matchAllowedFiles, extractPrincipalValue, resolveAllowedBudgetsFromActual, _resetDynamicAclCache } = mod;

  console.log('\n[budget-acl-dynamic] matching by userId (the default)');
  {
    check(JSON.stringify(matchAllowedFiles(FILES, ALICE, 'sub')) === JSON.stringify([FILE_A]),
      'alice resolves to exactly her own file');
    check(JSON.stringify(matchAllowedFiles(FILES, BOB, 'sub')) === JSON.stringify([FILE_B]),
      'bob resolves to exactly his own file');
    check(matchAllowedFiles(FILES, ALICE, 'sub').includes(FILE_B) === false,
      'alice does NOT get bob\'s file');
  }

  console.log('\n[budget-acl-dynamic] shared access (owner: false) is honoured');
  {
    // The whole point of the feature: a file shared with a household member
    // appears with owner: false and must still grant access.
    const shared = JSON.parse(JSON.stringify(FILES));
    shared[2].usersWithAccess.push({ userId: ALICE, displayName: 'Alice', userName: 'alice', owner: false });
    const allowed = matchAllowedFiles(shared, ALICE, 'sub');
    check(allowed.includes(FILE_A) && allowed.includes(FILE_B), 'alice reaches both her own and the shared file');
    check(allowed.length === 2, 'and exactly those two');
  }

  console.log('\n[budget-acl-dynamic] THE ESCALATION GUARD: the blank service-account row');
  {
    // These are the tests that justify matching on userId. Each one, if it
    // failed, would hand a principal owner access to every file on the server.
    check(matchAllowedFiles(FILES, '', 'sub').length === 0, 'an empty principal matches nothing');
    check(matchAllowedFiles(FILES, '', 'preferred_username').length === 0,
      'an empty principal matches nothing under NAME matching either');
    check(matchAllowedFiles(FILES, '   ', 'preferred_username').length === 0,
      'a whitespace-only principal does not match the blank userName');
    check(matchAllowedFiles(FILES, SVC, 'preferred_username').length === 0,
      'the service account UUID does not match by name');
  }

  console.log('\n[budget-acl-dynamic] opt-in name matching still works when configured');
  {
    check(JSON.stringify(matchAllowedFiles(FILES, 'alice', 'preferred_username')) === JSON.stringify([FILE_A]),
      'alice matches by userName when the claim is configured for it');
    check(matchAllowedFiles(FILES, 'alice', 'sub').length === 0,
      'but a userName does NOT match under the default sub/userId mode');
  }

  console.log('\n[budget-acl-dynamic] malformed upstream payloads fail closed');
  {
    for (const [payload, why] of [
      [null, 'null'], [undefined, 'undefined'], ['nope', 'a string'], [{}, 'an object'],
      [[], 'an empty array'], [[null, undefined], 'array of nullish'],
      [[{ cloudFileId: FILE_A }], 'entry with no usersWithAccess'],
      [[{ cloudFileId: FILE_A, usersWithAccess: 'no' }], 'usersWithAccess not an array'],
      [[{ usersWithAccess: [{ userId: ALICE }] }], 'entry with no cloudFileId'],
    ]) {
      check(matchAllowedFiles(payload, ALICE, 'sub').length === 0, `denies on ${why}`);
    }
  }

  console.log('\n[budget-acl-dynamic] extractPrincipalValue');
  {
    check(extractPrincipalValue({}, ALICE, 'sub') === ALICE, 'sub is read from the subject');
    check(extractPrincipalValue({ sub: ALICE }, undefined, 'sub') === ALICE, 'sub falls back to the claim');
    check(extractPrincipalValue({ preferred_username: 'alice' }, undefined, 'preferred_username') === 'alice',
      'a named claim is read');
    check(extractPrincipalValue({}, undefined, 'sub') === null, 'a missing claim yields null, not ""');
    check(extractPrincipalValue({ preferred_username: '' }, undefined, 'preferred_username') === null,
      'a BLANK claim yields null, not "" (this is the escalation guard)');
    check(extractPrincipalValue({ preferred_username: '   ' }, undefined, 'preferred_username') === null,
      'a whitespace claim yields null');
    check(extractPrincipalValue({ preferred_username: 42 }, undefined, 'preferred_username') === null,
      'a non-string claim yields null');
  }

  console.log('\n[budget-acl-dynamic] resolver fails closed and never returns a wildcard');
  {
    _resetDynamicAclCache();
    const nullResult = await resolveAllowedBudgetsFromActual(null);
    check(Array.isArray(nullResult) && nullResult.length === 0, 'a null principal denies');
    check(nullResult.includes('*') === false, 'and never returns the wildcard');

    // An upstream throw must deny, not propagate and not open up.
    const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
    const orig = adapterMod.default.getBudgets;
    adapterMod.default.getBudgets = async () => { throw new Error('ECONNREFUSED'); };
    _resetDynamicAclCache();
    const errResult = await resolveAllowedBudgetsFromActual(ALICE);
    check(Array.isArray(errResult) && errResult.length === 0, 'an upstream failure denies rather than throwing');
    check(errResult.includes('*') === false, 'and never returns the wildcard');

    // Happy path through the real resolver, including the scoped wildcard context.
    adapterMod.default.getBudgets = async () => FILES;
    _resetDynamicAclCache();
    const okResult = await resolveAllowedBudgetsFromActual(ALICE);
    check(JSON.stringify(okResult) === JSON.stringify([FILE_A]), 'resolves alice through the real code path');

    // The cache must be used: flip the stub to throw and expect the cached answer.
    adapterMod.default.getBudgets = async () => { throw new Error('should not be called'); };
    const cached = await resolveAllowedBudgetsFromActual(ALICE);
    check(JSON.stringify(cached) === JSON.stringify([FILE_A]), 'a second call is served from cache');

    adapterMod.default.getBudgets = orig;
    _resetDynamicAclCache();
  }

  console.log('\n[budget-acl-dynamic] the static path is untouched by default');
  {
    const cfg = (await import('../../dist/src/config.js')).default;
    check(cfg.AUTH_BUDGET_ACL_SOURCE === 'static', 'AUTH_BUDGET_ACL_SOURCE defaults to static');
    check(cfg.AUTH_BUDGET_ACL_CLAIM === 'sub', 'AUTH_BUDGET_ACL_CLAIM defaults to sub');
  }

  console.log('');
  if (failures === 0) console.log('[budget-acl-dynamic] All tests passed');
  else { console.error(`[budget-acl-dynamic] ${failures} test(s) FAILED`); process.exit(2); }
})();
