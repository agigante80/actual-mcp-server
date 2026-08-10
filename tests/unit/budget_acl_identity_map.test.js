// tests/unit/budget_acl_identity_map.test.js
//
// #345: AUTH_BUDGET_ACL_IDENTITY_MAP, an explicit `<sub>=<actual userName>`
// binding consulted before the claim precedence and AUTHORITATIVE when present.
//
// WHY THE AUTHORITATIVE RULE IS TESTED HERE AND NOT JUST DOCUMENTED. A map entry
// whose target matches no budget file must DENY, not fall through to the claim
// precedence. If it fell through, an operator typo would be masked by an
// accidental claim match: access granted through a path nobody intended, and no
// signal that the binding is wrong. The "bound to a non-existent userName denies
// even when the claims would have matched" case below is the one that pins that,
// and it is the case that goes green if someone later "helpfully" adds a fallback.
//
// Run: node tests/unit/budget_acl_identity_map.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);
const throws = (fn, substr, label) => {
  try { fn(); fail(label, 'did not throw'); }
  catch (err) {
    check(String(err.message).includes(substr), label, `message was: ${err.message}`);
  }
};

const ALICE = 'alice';
const BOB   = 'bob';
const SVC_UID = 'a6067f04-5f64-4af4-961c-bfea8a2b6f8a';
const FILE_A = '04946a24-bcd5-49ec-a8bb-b06a20082e9c';
const FILE_B = '739d4307-1707-4272-a14f-22aa20d3f6ec';

// Same shape as the live fixture in budget_acl_dynamic.test.js, including the
// blank service-account row that owns every file.
const FILES = [
  {
    cloudFileId: 'c2966198-d981-440e-835a-14fc72be60ce', groupId: FILE_A, state: 'remote', owner: SVC_UID,
    usersWithAccess: [
      { userId: '5311397e-769d-4b71-9326-d625a05aacb5', displayName: 'Alice', userName: ALICE, owner: false },
      { userId: SVC_UID, displayName: '', userName: '', owner: true },
    ],
  },
  {
    cloudFileId: 'dd111111-2222-3333-4444-555555555555', groupId: FILE_B, state: 'remote', owner: SVC_UID,
    usersWithAccess: [
      { userId: '9e27753d-5a87-49c3-a6dd-a9e67aa95ae9', displayName: 'Bob', userName: BOB, owner: false },
      { userId: SVC_UID, displayName: '', userName: '', owner: true },
    ],
  },
];

// The reporter's case on #317: an access token with an opaque sub and NOTHING
// else the precedence can use. Under the claim path this resolves to the sub,
// which matches no userName, so the principal is denied. That is the bug the map
// exists to fix, and it is asserted as red below before the map is applied.
const SUB_ONLY_TOKEN = { sub: 'opaque-idp-sub-alice' };

(async () => {
  const { parseIdentityMap } = await import('../../dist/src/auth/identity-map.js');
  const mod = await import('../../dist/src/auth/budget-acl-dynamic.js');
  const { resolvePrincipal, matchAllowedFiles, IDENTITY_MAP_SOURCE, AUTO_CLAIM,
          collectKnownUserNames, runAclPreflight, _resetDynamicAclCache } = mod;

  console.log('\n[identity-map] parsing');
  {
    check(parseIdentityMap('').size === 0, 'an empty string parses to an empty map');
    check(parseIdentityMap(undefined).size === 0, 'undefined parses to an empty map');
    check(parseIdentityMap('   ').size === 0, 'a whitespace-only string parses to an empty map');

    const m = parseIdentityMap('a=alice,b=bob');
    check(m.size === 2 && m.get('a') === 'alice' && m.get('b') === 'bob', 'two entries parse');

    const spaced = parseIdentityMap(' a = alice , b = bob ');
    check(spaced.get('a') === 'alice' && spaced.get('b') === 'bob',
      'whitespace around entries, subs and userNames is trimmed');

    check(parseIdentityMap('a=alice,').size === 1, 'a trailing comma is tolerated');

    // An opaque Authentik-style sub, which is the realistic key shape.
    const real = parseIdentityMap('a1b2c3d4e5f6opaque=jdoe');
    check(real.get('a1b2c3d4e5f6opaque') === 'jdoe', 'an opaque sub maps to a readable userName');
  }

  console.log('\n[identity-map] malformed input is rejected at parse time');
  {
    throws(() => parseIdentityMap('noequals'), 'no "="', 'an entry without "=" throws');
    throws(() => parseIdentityMap('a=b=c'), 'more than one "="', 'an entry with two "=" throws');
    throws(() => parseIdentityMap('=alice'), 'blank sub', 'a blank sub throws');
    throws(() => parseIdentityMap('a=,b=bob'), 'blank userName', 'a blank userName throws');
    throws(() => parseIdentityMap('a=   '), 'blank userName', 'a whitespace-only userName throws');
    throws(() => parseIdentityMap('a=alice,a=bob'), 'duplicate sub', 'a duplicate sub throws');
  }

  console.log('\n[identity-map] THE ESCALATION GUARD: a blank target can never be configured');
  {
    // The service account owns every file and has a blank userName, so a binding
    // to '' would grant owner access to the whole deployment. It is rejected at
    // config-parse time, which is why the matcher never has to see it.
    throws(() => parseIdentityMap('some-sub='), 'service-account',
      'the blank-target error explains the service-account risk');
    check(matchAllowedFiles(FILES, '').length === 0,
      'and the matcher still refuses a blank principal independently');
  }

  console.log('\n[identity-map] resolution: the map wins, and it is authoritative');
  {
    const map = parseIdentityMap(`${SUB_ONLY_TOKEN.sub}=${ALICE}`);

    // RED FIRST: without the map this is the reporter's denial.
    const noMap = resolvePrincipal(SUB_ONLY_TOKEN, SUB_ONLY_TOKEN.sub, AUTO_CLAIM, new Map());
    check(matchAllowedFiles(FILES, noMap.value).length === 0,
      'RED: a sub-only token resolves to the sub and matches no budget');

    // GREEN: the binding resolves it to a real userName.
    const mapped = resolvePrincipal(SUB_ONLY_TOKEN, SUB_ONLY_TOKEN.sub, AUTO_CLAIM, map);
    check(mapped.value === ALICE, 'GREEN: the bound sub resolves to the mapped userName');
    check(mapped.source === IDENTITY_MAP_SOURCE, 'the source is reported as identity-map, not a claim');
    check(JSON.stringify(matchAllowedFiles(FILES, mapped.value)) === JSON.stringify([FILE_A]),
      "and it resolves to exactly alice's budget");
    check(matchAllowedFiles(FILES, mapped.value).includes(FILE_B) === false,
      "and NOT to bob's budget");
  }

  console.log('\n[identity-map] the map beats a conflicting claim');
  {
    // A token that WOULD have resolved to bob via preferred_username, bound to
    // alice by the operator. The operator's binding must win: a token claim can
    // never override an explicit binding.
    const token = { sub: 'sub-x', preferred_username: BOB };
    const map = parseIdentityMap(`sub-x=${ALICE}`);
    const r = resolvePrincipal(token, 'sub-x', AUTO_CLAIM, map);
    check(r.value === ALICE, 'the binding wins over a matching preferred_username');
    check(JSON.stringify(matchAllowedFiles(FILES, r.value)) === JSON.stringify([FILE_A]),
      "so the principal gets alice's budget, not bob's");
  }

  console.log('\n[identity-map] a bound sub that matches nothing DENIES (no claim fallback)');
  {
    // The typo case. preferred_username would have matched alice, but the
    // operator bound this sub to a userName that does not exist. Falling through
    // would grant access via a path they did not configure and hide the typo.
    const token = { sub: 'sub-y', preferred_username: ALICE };
    const map = parseIdentityMap('sub-y=typo-not-a-user');
    const r = resolvePrincipal(token, 'sub-y', AUTO_CLAIM, map);
    check(r.value === 'typo-not-a-user', 'the bound value is used verbatim');
    check(r.source === IDENTITY_MAP_SOURCE, 'and the source stays identity-map');
    check(matchAllowedFiles(FILES, r.value).length === 0,
      'REGRESSION GUARD: it matches nothing and does NOT fall back to the claim that would have matched');
  }

  console.log('\n[identity-map] an unmapped sub is unchanged from today');
  {
    const map = parseIdentityMap(`someone-else=${BOB}`);
    const token = { sub: 'sub-z', preferred_username: ALICE };
    const r = resolvePrincipal(token, 'sub-z', AUTO_CLAIM, map);
    check(r.value === ALICE, 'an unmapped sub falls through to the claim precedence');
    check(r.source === 'preferred_username', 'and reports the winning claim name');

    const empty = resolvePrincipal(token, 'sub-z', AUTO_CLAIM, new Map());
    check(empty.value === ALICE && empty.source === 'preferred_username',
      'an empty map behaves identically to no map at all');
  }

  console.log('\n[identity-map] the map key is the verified sub and nothing else');
  {
    // A principal must not be able to steer the lookup with any other claim.
    const map = parseIdentityMap(`real-sub=${ALICE}`);
    const attacker = { sub: 'attacker-sub', preferred_username: 'real-sub', email: 'real-sub' };
    const r = resolvePrincipal(attacker, 'attacker-sub', AUTO_CLAIM, map);
    check(r.source !== IDENTITY_MAP_SOURCE,
      'a claim whose VALUE equals a mapped sub does not trigger that binding');
    check(r.value === 'real-sub' && matchAllowedFiles(FILES, r.value).length === 0,
      'it resolves by the normal precedence and matches nothing');

    // The subject argument is authoritative for the key, falling back to a sub
    // claim only when the subject is absent.
    const viaClaim = resolvePrincipal({ sub: 'real-sub' }, undefined, AUTO_CLAIM, map);
    check(viaClaim.value === ALICE, 'a sub claim is used as the key when no subject is supplied');

    // A BLANK subject is treated as absent-and-unusable rather than falling back
    // to the sub claim, which is exactly what extractPrincipalValue already does
    // (`subject ?? claims['sub']` keeps a blank string, then rejects it). Keeping
    // the two functions in agreement matters more than the extra robustness: a
    // disagreement about what "the sub" means is how #343 happened. In production
    // this is unreachable anyway, because httpServer.ts rejects any token whose
    // `sub` is not a non-empty string. If it were ever reached, denying is right.
    const blankSubject = resolvePrincipal({ sub: 'real-sub' }, '   ', AUTO_CLAIM, map);
    check(blankSubject.value === null,
      'a blank subject resolves to nothing (fail closed) rather than keying the map on ""');
    check(matchAllowedFiles(FILES, blankSubject.value ?? '').length === 0,
      'and therefore matches no budget');
  }

  console.log('\n[identity-map] preflight diagnostics');
  {
    const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
    const orig = adapterMod.default.getBudgets;
    const logs = [];
    const loggerMod = await import('../../dist/src/lib/loggerFactory.js');
    const origCreate = loggerMod.createModuleLogger;

    check(JSON.stringify(collectKnownUserNames(FILES)) === JSON.stringify([ALICE, BOB]),
      'collectKnownUserNames returns the distinct non-blank userNames');
    check(collectKnownUserNames(FILES).includes('') === false,
      'and never reports the blank service-account row as an option');
    check(collectKnownUserNames(null).length === 0, 'a non-array payload yields no names');
    check(collectKnownUserNames([{ usersWithAccess: [{ userName: ALICE }, { userName: ALICE }] }]).length === 1,
      'duplicates across files are collapsed');

    // The preflight must never throw or block, whatever the upstream does.
    adapterMod.default.getBudgets = async () => { throw new Error('upstream down'); };
    let threw = false;
    try { await runAclPreflight(); } catch { threw = true; }
    check(threw === false, 'an unreachable Actual server does not make the preflight throw');

    adapterMod.default.getBudgets = async () => FILES;
    threw = false;
    try { await runAclPreflight(); } catch { threw = true; }
    check(threw === false, 'a healthy read completes without throwing');

    // The password-mode case: every userName blank, so nobody can ever resolve.
    adapterMod.default.getBudgets = async () => [
      { groupId: FILE_A, usersWithAccess: [{ userId: SVC_UID, userName: '', owner: true }] },
    ];
    threw = false;
    try { await runAclPreflight(); } catch { threw = true; }
    check(threw === false, 'a password-mode server (all userNames blank) warns rather than throwing');

    adapterMod.default.getBudgets = orig;
    void origCreate; void logs;
    _resetDynamicAclCache();
  }

  console.log('\n[identity-map] config defaults and validation');
  {
    const cfg = (await import('../../dist/src/config.js')).default;
    check(cfg.AUTH_BUDGET_ACL_IDENTITY_MAP === '',
      'AUTH_BUDGET_ACL_IDENTITY_MAP defaults to empty, so no existing deployment changes behaviour');

    const { configSchema } = await import('../../dist/src/config.js');
    const base = {
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      ACTUAL_PASSWORD: 'x',
    };
    const bad = configSchema.safeParse({ ...base, AUTH_BUDGET_ACL_IDENTITY_MAP: 'a=alice,a=bob' });
    check(bad.success === false, 'a duplicate sub fails config validation at startup');
    check(bad.success === false && JSON.stringify(bad.error.issues).includes('duplicate sub'),
      'and the error names the reason');

    const blank = configSchema.safeParse({ ...base, AUTH_BUDGET_ACL_IDENTITY_MAP: 'a=' });
    check(blank.success === false, 'a blank userName fails config validation at startup');

    const good = configSchema.safeParse({ ...base, AUTH_BUDGET_ACL_IDENTITY_MAP: 'a=alice' });
    check(good.success === true, 'a well-formed map passes');
  }

  console.log('');
  if (failures === 0) console.log('[identity-map] All tests passed');
  else { console.error(`[identity-map] ${failures} test(s) FAILED`); process.exit(2); }
})();
