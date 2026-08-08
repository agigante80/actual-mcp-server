// tests/unit/budget_acl_dynamic.test.js
//
// #338/#343: dynamic budget ACL derived from Actual's own per-file access list.
//
// THE FIXTURE IS REAL. Captured from a live multi-user Actual server
// (password-bootstrapped, OpenID added, users created, access granted) and read
// back through @actual-app/api. Two properties of it are load bearing:
//
//   1. `userId` and `userName` are DIFFERENT identifier spaces. `userId` is a
//      UUID Actual mints for itself at account creation; `userName` holds the
//      identity it resolved from the IdP token. v0.11.0 matched the OIDC `sub`
//      against `userId` and therefore matched NOTHING, locking every user out of
//      every budget (#343). The fixture keeps both, with values that cannot be
//      confused, so that regression fails loudly instead of silently.
//   2. The blank row is this server's own password/service account. It owns every
//      file the API creates, has no `userName`, and carries `owner: true`. A
//      principal whose claim resolves to empty must never match it.
//
// Run: node tests/unit/budget_acl_dynamic.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

// Actual-internal UUIDs. These correspond to NOTHING any IdP issues.
const ALICE_UID = '5311397e-769d-4b71-9326-d625a05aacb5';
const BOB_UID   = '9e27753d-5a87-49c3-a6dd-a9e67aa95ae9';
const SVC_UID   = 'a6067f04-5f64-4af4-961c-bfea8a2b6f8a';
// The IdP-derived identities Actual stored in user_name.
const ALICE = 'alice';
const BOB   = 'bob';
// groupId is the "Sync ID" the ACL speaks in; cloudFileId is deliberately different.
const CLOUD_A = 'c2966198-d981-440e-835a-14fc72be60ce';
const CLOUD_B = 'dd111111-2222-3333-4444-555555555555';
const FILE_A  = '04946a24-bcd5-49ec-a8bb-b06a20082e9c';
const FILE_B  = '739d4307-1707-4272-a14f-22aa20d3f6ec';

const FILES = [
  // A local (non-remote) entry: no usersWithAccess. Present in every real
  // getBudgets() response and must be skipped rather than crash the matcher.
  { id: 'My-Finances-1-abc', cloudFileId: CLOUD_A, name: 'Test Budget' },
  {
    cloudFileId: CLOUD_A, groupId: FILE_A, state: 'remote', name: 'Test Budget', owner: SVC_UID,
    usersWithAccess: [
      { userId: ALICE_UID, displayName: 'Alice', userName: ALICE, owner: false },
      { userId: SVC_UID,   displayName: '',      userName: '',    owner: true  },
    ],
  },
  {
    cloudFileId: CLOUD_B, groupId: FILE_B, state: 'remote', name: 'Bob Budget', owner: SVC_UID,
    usersWithAccess: [
      { userId: BOB_UID, displayName: 'Bob', userName: BOB, owner: false },
      { userId: SVC_UID, displayName: '',    userName: '',  owner: true  },
    ],
  },
];

// Shaped after the real Authentik token the reporter supplied on #317.
const AUTHENTIK_TOKEN = {
  sub: 'a1b2c3d4e5f6opaque',
  email: 'alice@example.com',
  email_verified: true,
  name: 'Alice Example',
  preferred_username: ALICE,
};

(async () => {
  const mod = await import('../../dist/src/auth/budget-acl-dynamic.js');
  const { matchAllowedFiles, extractPrincipalValue, resolveAllowedBudgetsFromActual,
          _resetDynamicAclCache, ACTUAL_IDENTITY_PRECEDENCE, AUTO_CLAIM, resolvedClaimName } = mod;

  console.log('\n[budget-acl-dynamic] the join is on userName');
  {
    check(JSON.stringify(matchAllowedFiles(FILES, ALICE)) === JSON.stringify([FILE_A]),
      'alice resolves to exactly her own budget syncId');
    check(JSON.stringify(matchAllowedFiles(FILES, BOB)) === JSON.stringify([FILE_B]),
      'bob resolves to exactly his own budget syncId');
    check(matchAllowedFiles(FILES, ALICE).includes(FILE_B) === false, "alice does NOT get bob's budget");
  }

  console.log('\n[budget-acl-dynamic] REGRESSION #343: an Actual userId must never match');
  {
    // This is the defect that shipped in v0.11.0. Matching the OIDC sub against
    // userId returned [] for everyone. These pin BOTH halves: the UUID must not
    // match, and the resolved name must.
    check(matchAllowedFiles(FILES, ALICE_UID).length === 0,
      "alice's Actual userId matches nothing (it corresponds to no IdP claim)");
    check(matchAllowedFiles(FILES, BOB_UID).length === 0, "bob's Actual userId matches nothing");
    check(matchAllowedFiles(FILES, AUTHENTIK_TOKEN.sub).length === 0,
      'an opaque IdP sub matches nothing on its own');
    check(matchAllowedFiles(FILES, ALICE).length === 1,
      'but the resolved userName does match, so the join works via the precedence');
  }

  console.log("\n[budget-acl-dynamic] Actual's claim precedence, mirrored exactly");
  {
    check(JSON.stringify(ACTUAL_IDENTITY_PRECEDENCE) ===
      JSON.stringify(['preferred_username', 'login', 'email', 'id', 'sub']),
      'precedence matches upstream openid.ts byte for byte');

    check(extractPrincipalValue(AUTHENTIK_TOKEN, AUTHENTIK_TOKEN.sub, AUTO_CLAIM) === ALICE,
      'a real Authentik-shaped token resolves to preferred_username, not sub');

    check(extractPrincipalValue({ login: 'l' }, 's', AUTO_CLAIM) === 'l', 'falls through to login');
    check(extractPrincipalValue({ email: 'e@x' }, 's', AUTO_CLAIM) === 'e@x', 'falls through to email');
    check(extractPrincipalValue({ id: 'i' }, 's', AUTO_CLAIM) === 'i', 'falls through to id');
    check(extractPrincipalValue({}, 'the-sub', AUTO_CLAIM) === 'the-sub', 'falls through to sub last');

    // Order, not merely presence.
    check(extractPrincipalValue({ preferred_username: 'p', login: 'l', email: 'e' }, 's', AUTO_CLAIM) === 'p',
      'preferred_username wins over login and email');
    check(extractPrincipalValue({ login: 'l', email: 'e' }, 's', AUTO_CLAIM) === 'l', 'login wins over email');

    // A BLANK earlier claim must be skipped, not end the chain.
    check(extractPrincipalValue({ preferred_username: '   ', login: 'l' }, 's', AUTO_CLAIM) === 'l',
      'a blank preferred_username is skipped rather than ending the search');
    check(extractPrincipalValue({ preferred_username: 42, login: 'l' }, 's', AUTO_CLAIM) === 'l',
      'a non-string claim is skipped');
  }

  console.log('\n[budget-acl-dynamic] an explicit claim override pins one claim');
  {
    check(extractPrincipalValue(AUTHENTIK_TOKEN, AUTHENTIK_TOKEN.sub, 'email') === 'alice@example.com',
      'AUTH_BUDGET_ACL_CLAIM=email uses only email');
    check(extractPrincipalValue(AUTHENTIK_TOKEN, AUTHENTIK_TOKEN.sub, 'sub') === AUTHENTIK_TOKEN.sub,
      'AUTH_BUDGET_ACL_CLAIM=sub uses only sub');
    check(extractPrincipalValue({ preferred_username: 'p' }, 's', 'email') === null,
      'a pinned claim does NOT fall back to the precedence when absent');
  }

  console.log('\n[budget-acl-dynamic] THE ESCALATION GUARD: the blank service-account row');
  {
    check(matchAllowedFiles(FILES, '').length === 0, 'an empty principal matches nothing');
    check(matchAllowedFiles(FILES, '   ').length === 0, 'a whitespace principal matches nothing');
    check(matchAllowedFiles(FILES, SVC_UID).length === 0, 'the service account UUID matches nothing');
    check(extractPrincipalValue({}, undefined, AUTO_CLAIM) === null,
      'a token with NO usable claim yields null, never ""');
    check(extractPrincipalValue({ preferred_username: '', login: '', email: '' }, undefined, AUTO_CLAIM) === null,
      'a token whose every precedence claim is blank yields null');
  }

  console.log('\n[budget-acl-dynamic] WHITESPACE: identities are compared EXACTLY');
  {
    // Actual's user_name uniqueness is exact, so " alice" and "alice" are two
    // different accounts. Trimming both sides before comparing (which this did
    // until review) lets a user who can register " alice" at the IdP match the
    // real alice's access rows and read her budgets.
    check(matchAllowedFiles(FILES, ' alice').length === 0,
      'a leading-space principal does NOT match the exact userName "alice"');
    check(matchAllowedFiles(FILES, 'alice ').length === 0, 'a trailing-space principal does not match either');
    check(matchAllowedFiles(FILES, ALICE).length === 1, 'the exact value still matches');

    // The principal must be returned UNTRIMMED so the comparison above can fail.
    check(extractPrincipalValue({ preferred_username: ' alice' }, 's', AUTO_CLAIM) === ' alice',
      'extractPrincipalValue preserves surrounding whitespace rather than normalising it away');
    // ...but a whitespace-ONLY value is still treated as blank.
    check(extractPrincipalValue({ preferred_username: '   ' }, undefined, 'preferred_username') === null,
      'a whitespace-only claim is still blank, so it can never match the service-account row');

    // And a whitespace-only userName on the Actual side is skipped like a blank one.
    const spaced = JSON.parse(JSON.stringify(FILES));
    spaced[1].usersWithAccess[1].userName = '   ';
    check(matchAllowedFiles(spaced, '   ').length === 0, 'a whitespace-only userName is never matchable');
  }

  console.log('\n[budget-acl-dynamic] resolvedClaimName reports which claim won');
  {
    // #343 was a total silent denial partly because the logs said nothing useful.
    check(resolvedClaimName(AUTHENTIK_TOKEN, AUTHENTIK_TOKEN.sub, AUTO_CLAIM) === 'preferred_username',
      'reports preferred_username for an Authentik-shaped token');
    check(resolvedClaimName({ email: 'e@x' }, 's', AUTO_CLAIM) === 'email', 'reports the fallen-through claim');
    check(resolvedClaimName({}, 'the-sub', AUTO_CLAIM) === 'sub', 'reports sub when it is the last resort');
    check(resolvedClaimName({}, undefined, AUTO_CLAIM) === null, 'reports null when nothing resolves');
    check(resolvedClaimName(AUTHENTIK_TOKEN, AUTHENTIK_TOKEN.sub, 'email') === 'email', 'reports a pinned claim');
    check(resolvedClaimName({}, undefined, 'email') === null, 'reports null for an absent pinned claim');
  }

  console.log('\n[budget-acl-dynamic] shared access (owner: false) is honoured');
  {
    const shared = JSON.parse(JSON.stringify(FILES));
    shared[2].usersWithAccess.push({ userId: ALICE_UID, displayName: 'Alice', userName: ALICE, owner: false });
    const allowed = matchAllowedFiles(shared, ALICE);
    check(allowed.includes(FILE_A) && allowed.includes(FILE_B), 'alice reaches her own and the shared budget');
    check(allowed.length === 2, 'and exactly those two');
  }

  console.log('\n[budget-acl-dynamic] malformed upstream payloads fail closed');
  {
    for (const [payload, why] of [
      [null, 'null'], [undefined, 'undefined'], ['nope', 'a string'], [{}, 'an object'],
      [[], 'an empty array'], [[null, undefined], 'array of nullish'],
      [[{ groupId: FILE_A }], 'entry with no usersWithAccess'],
      [[{ groupId: FILE_A, usersWithAccess: 'no' }], 'usersWithAccess not an array'],
      [[{ usersWithAccess: [{ userName: ALICE }] }], 'entry with no groupId'],
      [[{ cloudFileId: CLOUD_A, usersWithAccess: [{ userName: ALICE }] }], 'cloudFileId but NO groupId'],
    ]) {
      check(matchAllowedFiles(payload, ALICE).length === 0, `denies on ${why}`);
    }
  }

  console.log('\n[budget-acl-dynamic] resolver fails closed and never returns a wildcard');
  {
    _resetDynamicAclCache();
    const nullResult = await resolveAllowedBudgetsFromActual(null);
    check(nullResult.length === 0 && !nullResult.includes('*'), 'a null principal denies, never a wildcard');

    const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
    const orig = adapterMod.default.getBudgets;

    adapterMod.default.getBudgets = async () => { throw new Error('ECONNREFUSED'); };
    _resetDynamicAclCache();
    const errResult = await resolveAllowedBudgetsFromActual(ALICE);
    check(errResult.length === 0 && !errResult.includes('*'), 'an upstream failure denies, never a wildcard');

    adapterMod.default.getBudgets = async () => FILES;
    _resetDynamicAclCache();
    check(JSON.stringify(await resolveAllowedBudgetsFromActual(ALICE)) === JSON.stringify([FILE_A]),
      'resolves alice through the real code path');

    adapterMod.default.getBudgets = async () => { throw new Error('should not be called'); };
    check(JSON.stringify(await resolveAllowedBudgetsFromActual(ALICE)) === JSON.stringify([FILE_A]),
      'a second call is served from cache');

    adapterMod.default.getBudgets = orig;
    _resetDynamicAclCache();
  }

  console.log('\n[budget-acl-dynamic] defaults');
  {
    const cfg = (await import('../../dist/src/config.js')).default;
    check(cfg.AUTH_BUDGET_ACL_SOURCE === 'static', 'AUTH_BUDGET_ACL_SOURCE defaults to static');
    check(cfg.AUTH_BUDGET_ACL_CLAIM === AUTO_CLAIM, 'AUTH_BUDGET_ACL_CLAIM defaults to "auto" (the precedence)');
  }

  console.log('');
  if (failures === 0) console.log('[budget-acl-dynamic] All tests passed');
  else { console.error(`[budget-acl-dynamic] ${failures} test(s) FAILED`); process.exit(2); }
})();
