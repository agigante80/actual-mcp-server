#!/usr/bin/env node
// acl-e2e-verify.mjs
//
// #343: end-to-end verification of the dynamic budget ACL against the live
// environment built by scripts/acl-e2e.sh.
//
// WHY THIS EXISTS AS A SEPARATE STEP. The unit tests stub `adapter.getBudgets()`,
// so they prove the MATCHING rules and nothing about the identifier join. The
// defect this file was written for lived exactly there: v0.11.0 matched the OIDC
// `sub` against Actual's `userId`, which no unit fixture could falsify because the
// fixture author chose both values. Only a real server, which mints `userId`
// itself, settles it.
//
// Reads the fixture emitted by acl-e2e.sh and exercises the resolver against the
// running Actual instance. Positive AND negative, because "denied" is the correct
// answer in most of the interesting cases and a resolver that denies everything
// would pass a positive-only suite by accident.
//
// Usage: node scripts/acl-e2e-verify.mjs [path-to-fixture]

import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixturePath = process.argv[2] ?? '.release/acl-e2e-fixture.json';
const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));

// The adapter validates env at import, so set it before importing anything.
process.env.ACTUAL_SERVER_URL = fx.actualUrl;
process.env.ACTUAL_PASSWORD = fx.password;
process.env.ACTUAL_BUDGET_SYNC_ID = fx.syncIds.alice;
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'acl-verify-'));
process.env.AUTH_BUDGET_ACL_SOURCE = 'actual';

let failures = 0;
const ok = (l) => console.log(`  ok: ${l}`);
const bad = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const check = (c, l, d = '') => (c ? ok(l) : bad(l, d));

const {
  resolveAllowedBudgetsFromActual,
  extractPrincipalValue,
  _resetDynamicAclCache,
  AUTO_CLAIM,
} = await import('../dist/src/auth/budget-acl-dynamic.js');

const resolve = async (claims, subject = claims.sub) => {
  _resetDynamicAclCache();
  const principal = extractPrincipalValue(claims, subject, AUTO_CLAIM);
  return { principal, allowed: await resolveAllowedBudgetsFromActual(principal) };
};

/**
 * Fetch a REAL token from the mock IdP and return its decoded payload.
 *
 * Hand-written claim objects prove the matcher; they cannot prove that a token
 * actually CARRIES the claim the matcher needs. That distinction matters here:
 * Actual derives user_name from the UserInfo response while this server reads the
 * access token, and several IdPs omit `preferred_username` from access tokens. So
 * the scenarios below run against claims that came off the wire.
 */
const tokenClaims = async (scope) => {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'acl-e2e',
    client_secret: 'x',
    scope,
  });
  const res = await fetch(`${fx.idpUrl}/default/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`IdP token request failed for scope ${scope}: ${res.status}`);
  const { access_token: token } = await res.json();
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload;
};

console.log('\n[acl-e2e] the IdP issues tokens carrying the claims the join needs');
{
  const t = await tokenClaims('user-alice');
  check(typeof t.preferred_username === 'string' && t.preferred_username.length > 0,
    'the access token carries preferred_username', JSON.stringify(Object.keys(t)));
  check(t.sub !== fx.users.alice,
    'the token sub is NOT Actual\'s userId (the join must cross identifier spaces)');
  check(t.aud === fx.audience || (Array.isArray(t.aud) && t.aud.includes(fx.audience)),
    'the token carries the expected audience');
}

console.log('\n[acl-e2e] REAL tokens resolve, end to end');
{
  for (const [scope, expectKey] of [['user-alice', 'alice'], ['user-bob', 'bob']]) {
    const claims = await tokenClaims(scope);
    const r = await resolve(claims, claims.sub);
    console.log(`    ${scope}: principal=${r.principal} allowed=${JSON.stringify(r.allowed)}`);
    check(r.allowed.length === 1 && r.allowed[0] === fx.syncIds[expectKey],
      `${scope} resolves to exactly ${expectKey}'s budget from a real token`);
  }

  const ghost = await resolve(await tokenClaims('user-ghost'));
  check(ghost.allowed.length === 0, 'a real token for an unknown user is granted nothing');

  const blank = await resolve(await tokenClaims('user-blank'));
  check(blank.allowed.length === 0, 'a real token with blank identity claims is granted nothing');
}

// #344: EVERY identity below comes from fx.actualUserNames, which holds what
// ACTUAL derived and stored during a real OIDC login. Do not reintroduce a string
// literal here. The previous version of this file compared against 'alice' while
// acl-e2e.sh created a user named 'alice' and configured the IdP to mint
// 'alice', so all three agreed by construction and the assertion could not fail
// for the reason it exists. The fixture also proves WHICH claim won: the login
// supplied preferred_username and email as different strings.
const ALICE = fx.actualUserNames?.alice;
const BOB = fx.actualUserNames?.bob;
if (!ALICE || !BOB) {
  console.error('  FAIL: fixture has no actualUserNames; re-run scripts/acl-e2e.sh (#344)');
  process.exit(2);
}
console.log(`\n[acl-e2e] identities DERIVED by Actual: alice=${ALICE} bob=${BOB}`);

console.log('\n[acl-e2e] POSITIVE: each user reaches exactly their own budget');
{
  const a = await resolve({ sub: 'opaque-idp-sub-alice', preferred_username: ALICE, email: 'alice@example.test' });
  console.log(`    alice principal=${a.principal} allowed=${JSON.stringify(a.allowed)}`);
  check(a.principal === ALICE, 'alice resolves via preferred_username, not sub');
  check(a.allowed.length === 1 && a.allowed[0] === fx.syncIds.alice, "alice reaches her own budget");

  const b = await resolve({ sub: 'opaque-idp-sub-bob', preferred_username: BOB, email: 'bob@example.test' });
  console.log(`    bob   principal=${b.principal} allowed=${JSON.stringify(b.allowed)}`);
  check(b.allowed.length === 1 && b.allowed[0] === fx.syncIds.bob, 'bob reaches his own budget');
}

console.log('\n[acl-e2e] NEGATIVE: cross-user isolation');
{
  const a = await resolve({ sub: 'x', preferred_username: ALICE });
  const b = await resolve({ sub: 'x', preferred_username: BOB });
  check(!a.allowed.includes(fx.syncIds.bob), "alice CANNOT reach bob's budget");
  check(!b.allowed.includes(fx.syncIds.alice), "bob CANNOT reach alice's budget");
}

console.log('\n[acl-e2e] #345: a sub-only token is denied, then bound by the identity map');
{
  // #317's reporter, reproduced against a live server: an access token carrying an
  // opaque sub and NOTHING the precedence can use. RED first, so the fix is proved
  // to change something rather than asserted to.
  const cfg = (await import('../dist/src/config.js')).default;
  const dyn = await import('../dist/src/auth/budget-acl-dynamic.js');
  const subOnly = { sub: fx.subs.subonly };

  cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = '';
  dyn._resetDynamicAclCache();
  let r = await dyn.resolvePrincipalAsync(subOnly, subOnly.sub, 'token-unused');
  let allowed = await dyn.resolveAllowedBudgetsFromActual(r.value, r.source);
  check(allowed.length === 0, 'RED: a sub-only token reaches no budget at all');

  // GREEN: bind that sub to the userName Actual actually stored.
  cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = `${fx.subs.subonly}=${ALICE}`;
  dyn._resetDynamicAclCache();
  r = await dyn.resolvePrincipalAsync(subOnly, subOnly.sub, 'token-unused');
  check(r.source === 'identity-map', 'the binding is what resolved the principal');
  allowed = await dyn.resolveAllowedBudgetsFromActual(r.value, r.source);
  check(allowed.length === 1 && allowed[0] === fx.syncIds.alice,
    "GREEN: the bound sub now reaches exactly alice's budget");
  check(!allowed.includes(fx.syncIds.bob), "and still NOT bob's budget");

  // A binding to a userName nobody has must DENY, not fall back to a claim.
  cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = `${fx.subs.subonly}=nobody-has-this-name`;
  dyn._resetDynamicAclCache();
  r = await dyn.resolvePrincipalAsync({ ...subOnly, preferred_username: ALICE }, subOnly.sub, 'token-unused');
  allowed = await dyn.resolveAllowedBudgetsFromActual(r.value, r.source);
  check(allowed.length === 0,
    'a mis-bound sub is DENIED even though its preferred_username would have matched');

  cfg.AUTH_BUDGET_ACL_IDENTITY_MAP = '';
  dyn._resetDynamicAclCache();
}

console.log('\n[acl-e2e] REGRESSION #343: the opaque IdP sub must not resolve on its own');
{
  // The v0.11.0 defect. Pin it against the live server, where userId is minted by
  // Actual and cannot be chosen to make the test pass.
  const bySub = await resolve({ sub: 'opaque-idp-sub-alice' });
  check(bySub.allowed.length === 0, 'a token carrying ONLY an opaque sub resolves to nothing');

  _resetDynamicAclCache();
  const byUserId = await resolveAllowedBudgetsFromActual(fx.users.alice);
  check(byUserId.length === 0,
    "Actual's own userId resolves to nothing (it is not an IdP identity)",
    `userId=${fx.users.alice}`);
}

console.log('\n[acl-e2e] POSITIVE: precedence falls through to email');
{
  const e = await resolve({ sub: 'opaque-idp-sub-eo', email: 'alice@example.test' });
  // NOTE: this email is deliberately NOT the one the login supplied, so it must
  // not match. It exercises the precedence, not the join.
  console.log(`    email-only principal=${e.principal} allowed=${JSON.stringify(e.allowed)}`);
  check(e.principal === 'alice@example.test', 'resolves to email when preferred_username is absent');
  // Whether this GRANTS depends on how the Actual user was created. If the user's
  // userName is "alice", an email principal correctly matches nothing: the join is
  // exact, not fuzzy. Assert the safe property rather than guessing the fixture.
  check(!e.allowed.includes(fx.syncIds.bob), "an email principal never reaches bob's budget");
}

console.log('\n[acl-e2e] NEGATIVE: unknown and blank principals get nothing');
{
  const ghost = await resolve({ sub: 'opaque-idp-sub-ghost', preferred_username: 'nobody' });
  check(ghost.allowed.length === 0, 'an unknown user resolves to no budgets');
  check(!ghost.allowed.includes('*'), 'and never to a wildcard');

  // THE ESCALATION GUARD, live. The service account owns every file and has a
  // blank userName; a principal that resolves to empty must not match it.
  const blank = await resolve({ sub: '', preferred_username: '', email: '' });
  check(blank.principal === null, 'a token whose every identity claim is blank yields a null principal');
  check(blank.allowed.length === 0, 'and is granted NOTHING (never the service account row)');

  const missing = await resolve({});
  check(missing.allowed.length === 0, 'a token with no identity claims at all is granted nothing');
}

// NOT TESTED HERE: fail-closed on an unreachable Actual server.
//
// The obvious way to write it, repointing ACTUAL_SERVER_URL at a dead port and
// re-resolving, does NOT work: by this point the adapter already holds an open
// session, so the resolve succeeds against the live connection and the assertion
// passes for entirely the wrong reason. A test that green-lights a behaviour it
// never exercised is worse than an absent one, so it is absent.
//
// That path is covered deterministically in tests/unit/budget_acl_dynamic.test.js,
// where `adapter.getBudgets` is stubbed to throw and the resolver is asserted to
// return [] rather than a wildcard. Simulated failure is the right tool for a
// failure mode; a live environment is the right tool for the identifier join,
// which is what this file is for.

console.log('');
if (failures === 0) {
  console.log('[acl-e2e] ALL ACL SCENARIOS PASSED');
  process.exit(0);
}
console.error(`[acl-e2e] ${failures} scenario(s) FAILED`);
process.exit(2);
