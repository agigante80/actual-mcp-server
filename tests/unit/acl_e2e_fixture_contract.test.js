// tests/unit/acl_e2e_fixture_contract.test.js
//
// #344: a DRIFT GUARD, in the style of the repo's other doc-to-code guards.
//
// The ACL E2E harness can only prove the identity join if Actual generates one
// side of it. Twice now that property has been quietly lost: v0.11.0 seeded the
// IdP's `sub` from Actual's own `userId` (#343), and after that was fixed the
// harness still created users with `POST /admin/users` passing userName "alice"
// while configuring the IdP to mint "alice", so both sides were literals chosen
// twelve lines apart in one file.
//
// Neither regression is visible in a diff review, and neither can be caught by
// running the harness, because a vacuous harness passes. So the properties are
// asserted statically here, where they run in CI on every commit without Docker.
//
// Run: node tests/unit/acl_e2e_fixture_contract.test.js

import { readFileSync } from 'node:fs';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);

const sh = readFileSync('scripts/acl-e2e.sh', 'utf8');
const verify = readFileSync('scripts/acl-e2e-verify.mjs', 'utf8');

console.log('\n[acl-e2e-contract] the harness drives Actual\'s REAL identity derivation');
{
  check(sh.includes('loginMethod\\":\\"openid') || sh.includes('loginMethod'),
    'acl-e2e.sh starts an OpenID login via POST /account/login');
  check(sh.includes('/openid/callback') || sh.includes('login_as'),
    'and completes the authorization-code flow through the callback');
  check(/ALICE_NAME=\$\(echo "\$USERS"/.test(sh),
    'it READS BACK the userName Actual stored rather than assuming it');
  check(sh.includes('actualUserNames'),
    'and emits it in the fixture as actualUserNames');

  // The specific regression: creating the POSITIVE-path users through the admin
  // API means Actual's precedence never runs and the join is self-consistent.
  const adminCreates = sh.match(/actual_api POST \/admin\/users/g) ?? [];
  check(adminCreates.length === 0,
    'no user on the positive path is created with POST /admin/users',
    `found ${adminCreates.length} admin-API user creation(s)`);
}

console.log('\n[acl-e2e-contract] the verifier compares against DERIVED names, not literals');
{
  check(verify.includes('fx.actualUserNames'),
    'acl-e2e-verify.mjs reads identities from the fixture');

  // A literal identity comparison is the exact shape that made the old assertion
  // vacuous. Scope labels ("user-alice") and property names (fx.syncIds.alice)
  // are fine and must not trip this; only quoted bare identities are the problem.
  const badLiterals = [
    /preferred_username:\s*'alice'/,
    /preferred_username:\s*"alice"/,
    /preferred_username:\s*'bob'/,
    /preferred_username:\s*"bob"/,
    /===\s*'alice'/,
    /===\s*"alice"/,
  ].filter((re) => re.test(verify));
  check(badLiterals.length === 0,
    'it contains no hardcoded identity literal on an assertion path',
    badLiterals.map(String).join(', '));

  check(verify.includes('#345') || verify.includes('identity-map'),
    'it exercises the identity map, including the deny-on-misbinding case');
}

console.log('\n[acl-e2e-contract] the anti-vacuity procedure stays documented');
{
  // A guard nobody knows how to re-run rots. The header must keep both the
  // command and the expected RED outcome.
  check(/rename/i.test(sh) && sh.includes('PATCH'),
    'acl-e2e.sh documents the rename that must turn the verifier red');
  check(/FAILED/.test(sh),
    'and states the expected failing outcome, so "still green" is recognisable as a bug');
}

console.log('');
if (failures === 0) console.log('[acl-e2e-contract] All tests passed');
else { console.error(`[acl-e2e-contract] ${failures} test(s) FAILED`); process.exit(2); }
