// tests/unit/budget_acl_userinfo.test.js
//
// #346: resolve the ACL principal from the IdP's UserInfo endpoint, which is the
// SAME document Actual derives user_name from.
//
// THE CASE THAT MATTERS MOST IS THE SUBJECT MISMATCH. OIDC Core 5.3.2 requires the
// client to verify that the `sub` in the UserInfo response equals the `sub` it
// already holds. Without that check, anything able to answer as the
// userinfo_endpoint (a compromised IdP, a misconfigured proxy, a hijacked DNS
// record) can return ANOTHER user's preferred_username and be handed that user's
// budgets. The "substituted subject" block below is the regression guard for it,
// and it must fail if someone removes the check.
//
// Run: node tests/unit/budget_acl_userinfo.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

const ISSUER = 'https://idp.example.test';
const USERINFO = `${ISSUER}/userinfo`;
const ALICE_SUB = 'opaque-idp-sub-alice';
const BOB_SUB   = 'opaque-idp-sub-bob';
const PRECEDENCE = ['preferred_username', 'login', 'email', 'id', 'sub'];

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

(async () => {
  const cfg = (await import('../../dist/src/config.js')).default;
  const mod = await import('../../dist/src/auth/userinfo-identity.js');
  const { resolveIdentityFromUserInfo, _resetUserInfoCache, _userInfoFetchCount } = mod;
  const { resolveUserInfoUri } = await import('../../dist/src/lib/oidc-discovery.js');

  // The module resolves the endpoint through discoverOidcMetadata, which performs a
  // real fetch. Point the issuer at a stub discovery document served by the same
  // injected fetch used for the UserInfo call itself.
  cfg.OIDC_ISSUER = ISSUER;
  cfg.AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS = 500;

  const makeFetch = (userinfoHandler) => async (url, init) => {
    const target = String(url);
    if (target.includes('.well-known/openid-configuration')) {
      return jsonResponse({
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: USERINFO,
      });
    }
    return userinfoHandler(target, init);
  };
  // discoverOidcMetadata uses the global fetch, so install the stub globally and
  // record what the UserInfo call was given.
  let lastInit = null;
  const install = (handler) => {
    globalThis.fetch = makeFetch((target, init) => {
      lastInit = { target, init };
      return handler(target, init);
    });
  };

  console.log('\n[userinfo] endpoint validation is stricter than the JWKS rule');
  {
    const doc = { userinfo_endpoint: USERINFO };
    check(resolveUserInfoUri(doc, ISSUER) === `${USERINFO}`, 'a same-origin https endpoint resolves');

    const tryIt = (d, label, substr) => {
      try { resolveUserInfoUri(d, ISSUER); fail(label, 'did not throw'); }
      catch (err) { check(String(err.message).includes(substr), label, err.message); }
    };
    tryIt({}, 'a missing userinfo_endpoint throws', 'no usable "userinfo_endpoint"');
    tryIt({ userinfo_endpoint: 'http://idp.example.test/userinfo' }, 'an http endpoint throws', 'must use https');
    tryIt({ userinfo_endpoint: 'https://u:p@idp.example.test/userinfo' }, 'embedded credentials throw', 'embedded credentials');
    // The cross-origin case has NO allowlist, unlike jwks_uri (#254), because this
    // request carries the caller's bearer token rather than fetching public keys.
    tryIt({ userinfo_endpoint: 'https://elsewhere.example.test/userinfo' },
      'a cross-origin endpoint throws with no allowlist escape', 'does not match the issuer origin');
  }

  console.log('\n[userinfo] the happy path reads the document Actual read');
  {
    _resetUserInfoCache();
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: 'alice', email: 'alice@example.test' }));
    const r = await resolveIdentityFromUserInfo('the-access-token', ALICE_SUB, PRECEDENCE);
    check(r.value === 'alice', 'resolves preferred_username from the UserInfo body');
    check(r.claim === 'preferred_username', 'and reports which claim won');
    check(r.failure === null, 'with no failure');
    check(String(lastInit.init.headers.Authorization) === 'Bearer the-access-token',
      "the caller's own access token is sent as a bearer credential");
    check(lastInit.target === USERINFO, 'to the discovered userinfo_endpoint');
  }

  console.log('\n[userinfo] THE DIVERGENCE THIS TICKET EXISTS FOR');
  {
    _resetUserInfoCache();
    // The access token carries only sub and email; UserInfo carries the
    // preferred_username Actual actually stored. Under the token source this
    // principal resolves to the email and is denied. This is #317's reporter.
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: 'alice' }));
    const r = await resolveIdentityFromUserInfo('tok', ALICE_SUB, PRECEDENCE);
    check(r.value === 'alice',
      'a claim absent from the access token is still found in the UserInfo response');
  }

  console.log('\n[userinfo] precedence and untrusted values');
  {
    _resetUserInfoCache();
    install(() => jsonResponse({ sub: ALICE_SUB, login: 'l', email: 'e@x' }));
    check((await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE)).claim === 'login',
      'falls through to login when preferred_username is absent');

    _resetUserInfoCache();
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: {}, email: 42, login: '   ' }));
    const r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.value === ALICE_SUB && r.claim === 'sub',
      'a non-string, a number and a blank are all treated as ABSENT, never coerced');
    check(r.value !== '[object Object]' && r.value !== '42',
      'and specifically nothing is stringified into an identity');
  }

  console.log('\n[userinfo] REGRESSION GUARD: substituted subject (OIDC Core 5.3.2)');
  {
    _resetUserInfoCache();
    // The attack: the endpoint answers alice's token with bob's identity.
    install(() => jsonResponse({ sub: BOB_SUB, preferred_username: 'bob' }));
    const r = await resolveIdentityFromUserInfo('alice-token', ALICE_SUB, PRECEDENCE);
    check(r.value === null, 'a response describing a different sub yields NO identity');
    check(r.failure === 'subject-mismatch', 'and is reported as a subject mismatch');
    check(r.value !== 'bob', "and specifically does not hand over the other user's identity");

    _resetUserInfoCache();
    install(() => jsonResponse({ preferred_username: 'alice' }));
    const missing = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(missing.failure === 'subject-mismatch',
      'a response with NO sub is a mismatch too, not an accepted absence');
  }

  console.log('\n[userinfo] failure dispositions are distinguishable');
  {
    _resetUserInfoCache();
    install(() => jsonResponse({ error: 'insufficient_scope' }, 401));
    let r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.failure === 'token-refused', '401 is token-refused (probably a missing openid scope)');

    _resetUserInfoCache();
    install(() => jsonResponse({}, 403));
    r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.failure === 'token-refused', '403 is token-refused too');

    _resetUserInfoCache();
    install(() => { throw new Error('connect ETIMEDOUT'); });
    r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.failure === 'unavailable', 'a transport error is unavailable, NOT token-refused');

    _resetUserInfoCache();
    install(() => ({ ok: true, status: 200, headers: { get: () => 'text/html' },
                     json: async () => { throw new Error('Unexpected token <'); } }));
    r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.failure === 'unavailable', 'an HTML error page is unavailable and does not throw');

    _resetUserInfoCache();
    install(() => jsonResponse({ sub: ALICE_SUB }, 200));
    r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.value === ALICE_SUB && r.claim === 'sub',
      'a body with only sub still resolves via the last precedence entry');

    _resetUserInfoCache();
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: '' }, 200));
    r = await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(r.value === ALICE_SUB, 'a blank preferred_username is skipped rather than ending the search');
  }

  console.log('\n[userinfo] caching: one request per principal per TTL');
  {
    _resetUserInfoCache();
    const before = _userInfoFetchCount();
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: 'alice' }));
    await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(_userInfoFetchCount() - before === 1, 'three resolutions for one sub make ONE outbound request');

    // Failures are NOT cached: a transient blip must not persist for the TTL.
    _resetUserInfoCache();
    const b2 = _userInfoFetchCount();
    install(() => jsonResponse({}, 401));
    await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    await resolveIdentityFromUserInfo('t', ALICE_SUB, PRECEDENCE);
    check(_userInfoFetchCount() - b2 === 2, 'a failure is retried rather than cached');
  }

  console.log('\n[userinfo] wiring: source, map precedence, and the default');
  {
    const dyn = await import('../../dist/src/auth/budget-acl-dynamic.js');
    const { resolvePrincipalAsync, IDENTITY_MAP_SOURCE, USERINFO_SOURCE, _resetDynamicAclCache } = dyn;

    check(USERINFO_SOURCE === 'userinfo', 'the userinfo source tag is stable');

    // Default source: no request is made at all.
    _resetUserInfoCache(); _resetDynamicAclCache();
    cfg.AUTH_BUDGET_ACL_IDENTITY_SOURCE = 'token';
    cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = '';
    cfg.AUTH_BUDGET_ACL_CLAIM = 'auto';
    let before = _userInfoFetchCount();
    install(() => jsonResponse({ sub: ALICE_SUB, preferred_username: 'from-userinfo' }));
    let r = await resolvePrincipalAsync({ preferred_username: 'from-token' }, ALICE_SUB, 'tok');
    check(r.value === 'from-token', 'the default source reads the access token');
    check(_userInfoFetchCount() === before, 'and makes NO outbound request');

    // userinfo source: the response wins.
    _resetUserInfoCache(); _resetDynamicAclCache();
    cfg.AUTH_BUDGET_ACL_IDENTITY_SOURCE = 'userinfo';
    r = await resolvePrincipalAsync({ preferred_username: 'from-token' }, ALICE_SUB, 'tok');
    check(r.value === 'from-userinfo', 'the userinfo source reads the UserInfo response');
    check(String(r.source).startsWith('userinfo:'), 'and tags the source so logs distinguish the two');

    // The map wins over UserInfo, and costs no request.
    _resetUserInfoCache(); _resetDynamicAclCache();
    cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = `${ALICE_SUB}=bound-name`;
    before = _userInfoFetchCount();
    r = await resolvePrincipalAsync({ preferred_username: 'from-token' }, ALICE_SUB, 'tok');
    check(r.value === 'bound-name', 'an explicit binding beats the UserInfo lookup');
    check(r.source === IDENTITY_MAP_SOURCE, 'and reports identity-map as the source');
    check(_userInfoFetchCount() === before,
      'and makes NO outbound request, so the map still works when the IdP is down');

    // A UserInfo failure DENIES rather than falling back to the token claims.
    _resetUserInfoCache(); _resetDynamicAclCache();
    cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = '';
    install(() => jsonResponse({}, 401));
    r = await resolvePrincipalAsync({ preferred_username: 'from-token' }, ALICE_SUB, 'tok');
    check(r.value === null,
      'REGRESSION GUARD: a UserInfo failure denies and does NOT fall back to the token claims');

    cfg.AUTH_BUDGET_ACL_IDENTITY_SOURCE = 'token';
    _resetUserInfoCache(); _resetDynamicAclCache();
  }

  console.log('\n[userinfo] config defaults');
  {
    const { configSchema } = await import('../../dist/src/config.js');
    const base = {
      ACTUAL_SERVER_URL: 'http://localhost:5006',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      ACTUAL_PASSWORD: 'x',
    };
    const parsed = configSchema.parse(base);
    check(parsed.AUTH_BUDGET_ACL_IDENTITY_SOURCE === 'token',
      'AUTH_BUDGET_ACL_IDENTITY_SOURCE defaults to token, so the IdP is not a dependency by default');
    check(parsed.AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS === 5000, 'the UserInfo timeout defaults to 5000ms');

    check(configSchema.safeParse({ ...base, AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'nonsense' }).success === false,
      'an unknown identity source is rejected at startup');

    // No disable value: a request on the auth path with no bound is how a slow IdP
    // becomes an outage.
    check(configSchema.parse({ ...base, AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS: '0' })
      .AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS === 5000, '0 does not disable the timeout, it falls back to the default');
    check(configSchema.parse({ ...base, AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS: '10' })
      .AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS === 250, 'a tiny value is clamped up to 250ms');
    check(configSchema.parse({ ...base, AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS: '999999' })
      .AUTH_BUDGET_ACL_USERINFO_TIMEOUT_MS === 60000, 'a huge value is clamped down to 60s');
  }

  console.log('');
  if (failures === 0) console.log('[userinfo] All tests passed');
  else { console.error(`[userinfo] ${failures} test(s) FAILED`); process.exit(2); }
})();
