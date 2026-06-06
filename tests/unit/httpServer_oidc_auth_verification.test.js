// tests/unit/httpServer_oidc_auth_verification.test.js
//
// #163 (OWASP A07): authenticateRequest() returned true for ANY request whenever
// AUTH_PROVIDER=oidc, inferring authentication from configuration instead of
// verifying the request principal. The fix requires req.auth.subject (the field
// the mcp-auth verifier and budget-acl.ts use) and rejects with 401 otherwise.
//
// authenticateRequest is a closure inside startHttpServer, so we (1) behaviourally
// test the principal predicate the fix relies on, and (2) source-assert the real
// OIDC branch verifies req.auth.subject and rejects when it is missing.
//
// Run: node tests/unit/httpServer_oidc_auth_verification.test.js

import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

// The predicate the fix uses to decide an OIDC request is authenticated.
const hasVerifiedSubject = (req) => Boolean(req?.auth?.subject);

console.log('\n[oidc-auth-verification] principal predicate');
check('POSITIVE: a request with req.auth.subject is authenticated', hasVerifiedSubject({ auth: { subject: 'user-123' } }) === true);
check('NEGATIVE: req.auth missing entirely is NOT authenticated', hasVerifiedSubject({}) === false);
check('NEGATIVE: req.auth present but no subject is NOT authenticated', hasVerifiedSubject({ auth: {} }) === false);
check('NEGATIVE: empty-string subject is NOT authenticated', hasVerifiedSubject({ auth: { subject: '' } }) === false);

console.log('\n[oidc-auth-verification] real code wiring');
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');

// Isolate the authenticateRequest function body (there are other AUTH_PROVIDER
// === 'oidc' checks elsewhere in the file, so anchor on the function name).
const fnStart = src.indexOf('const authenticateRequest');
const fnWindow = src.slice(fnStart, fnStart + 900);

check('OIDC branch no longer unconditionally returns true', !/if \(config\.AUTH_PROVIDER === 'oidc'\) return true;/.test(src));
check('authenticateRequest OIDC branch verifies req.auth.subject', /auth\?\.subject/.test(fnWindow));
check('authenticateRequest OIDC branch rejects with 401 when the principal is missing', /res\.status\(401\)/.test(fnWindow));

console.log(`\n[oidc-auth-verification] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
