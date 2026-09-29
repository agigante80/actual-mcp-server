// tests/unit/config_oidc_assertion_refines.test.js
//
// #462: the three cross-variable refines that keep the Cloudflare assertion mode from
// shipping a silently dead deployment. Pure: configSchema.safeParse, no server boot.
//
// Run: node tests/unit/config_oidc_assertion_refines.test.js

import assert from 'node:assert';
const { configSchema } = await import('../../dist/src/config.js');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};
const oidc = { ...base, AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://team.cloudflareaccess.test', OIDC_RESOURCE: 'https://host/http' };
const JWKS = 'https://team.cloudflareaccess.test/cdn-cgi/access/certs';

const refused = (env, pathKey, ...names) => {
  const r = configSchema.safeParse(env);
  assert.strictEqual(r.success, false, 'parsed although it must be refused');
  const issue = r.error.issues.find((i) => i.path.includes(pathKey));
  assert.ok(issue, `no issue on path ${pathKey}: ${JSON.stringify(r.error.issues.map((i) => i.path))}`);
  for (const n of names) assert.ok(issue.message.includes(n), `message lacks ${n}: ${issue.message}`);
};
const parses = (env) => assert.strictEqual(configSchema.safeParse(env).success, true, JSON.stringify(configSchema.safeParse(env).error?.issues));

console.log('\n[config-oidc-assertion-refines] #462');

check('defaults parse: OIDC_TOKEN_SOURCE=authorization, OIDC_JWKS_URI unset', () => {
  const r = configSchema.safeParse(oidc);
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.OIDC_TOKEN_SOURCE, 'authorization');
  assert.strictEqual(r.data.OIDC_JWKS_URI, undefined);
});
check('OIDC_JWKS_URI="" is unset for the refines too (userinfo identity still parses with it)', () => {
  parses({ ...oidc, OIDC_JWKS_URI: '', AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo' });
});
check('the full Cloudflare recipe parses', () => {
  parses({ ...oidc, OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion', OIDC_JWKS_URI: JWKS, OIDC_ACCEPTED_AUDIENCES: 'aud-tag', OIDC_SCOPES: '' });
});
check('an unknown token source is refused (closed enum)', () => {
  assert.strictEqual(configSchema.safeParse({ ...oidc, OIDC_TOKEN_SOURCE: 'x-forwarded-jwt' }).success, false);
});
check('OIDC_JWKS_URI set + AUTH_BUDGET_ACL_IDENTITY_SOURCE=userinfo is refused, naming both', () => {
  refused({ ...oidc, OIDC_JWKS_URI: JWKS, AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo' }, 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'OIDC_JWKS_URI');
});
check('assertion mode + AUTH_BUDGET_ACL_IDENTITY_SOURCE=userinfo is refused independently of the JWKS knob, naming both', () => {
  refused({ ...oidc, OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion', AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo' }, 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'AUTH_BUDGET_ACL_IDENTITY_SOURCE', 'OIDC_TOKEN_SOURCE');
});
check('NEGATIVE CONTROL: discovery mode + userinfo identity still parses (the guard is scoped to the new bypass)', () => {
  parses({ ...oidc, AUTH_BUDGET_ACL_IDENTITY_SOURCE: 'userinfo' });
});
check('AUTH_PROVIDER=none + assertion mode is refused, naming AUTH_PROVIDER and OIDC_TOKEN_SOURCE', () => {
  refused({ ...base, AUTH_PROVIDER: 'none', OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion' }, 'OIDC_TOKEN_SOURCE', 'AUTH_PROVIDER', 'OIDC_TOKEN_SOURCE');
});
check('AUTH_PROVIDER=none + OIDC_JWKS_URI is refused, naming AUTH_PROVIDER', () => {
  refused({ ...base, AUTH_PROVIDER: 'none', OIDC_JWKS_URI: JWKS }, 'OIDC_TOKEN_SOURCE', 'AUTH_PROVIDER', 'OIDC_JWKS_URI');
});
check('assertion mode + OIDC_SCOPES=openid is refused, naming OIDC_SCOPES and OIDC_TOKEN_SOURCE', () => {
  refused({ ...oidc, OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion', OIDC_SCOPES: 'openid' }, 'OIDC_SCOPES', 'OIDC_SCOPES', 'OIDC_TOKEN_SOURCE');
});
check('assertion mode + whitespace-only OIDC_SCOPES parses (empty after trim)', () => {
  parses({ ...oidc, OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion', OIDC_SCOPES: '  ' });
});
check('discovery mode + OIDC_SCOPES=openid still parses (the scope rule is scoped to assertion mode)', () => {
  parses({ ...oidc, OIDC_SCOPES: 'openid' });
});
check('assertion mode + OIDC_SCOPES_SUPPORTED parses (advertising scopes does not violate assertion mode, #472)', () => {
  parses({ ...oidc, OIDC_TOKEN_SOURCE: 'cf-access-jwt-assertion', OIDC_JWKS_URI: JWKS, OIDC_SCOPES: '', OIDC_SCOPES_SUPPORTED: 'openid,offline_access' });
});

console.log(`\n[config-oidc-assertion-refines] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
