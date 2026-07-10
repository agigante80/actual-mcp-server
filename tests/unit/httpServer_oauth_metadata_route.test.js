// tests/unit/httpServer_oauth_metadata_route.test.js
//
// #285: the RFC 8414 route GET /.well-known/oauth-authorization-server must exist ONLY
// when AUTH_PROVIDER=oidc, and never in the default (AUTH_PROVIDER=none) mode. Scenario 4
// was previously guarded only by a source-scan regex that a code-review empirically showed
// could false-pass if the registration were moved out of the OIDC block. This is the
// RUNTIME companion: it boots the real startHttpServer in the default mode and asserts the
// route actually 404s while the server is otherwise up (so the 404 is "route absent", not
// "server down").
//
// The OIDC-mode bare-object RESPONSE BODY is not exercised here: startHttpServer fetches
// the IdP discovery doc via the global fetch at boot, which needs a live IdP. That path is
// covered by oidc_metadata_discovery.test.js (metadata served verbatim) plus the
// source-wiring handler-body assertion in httpServer_oidc_jwks_discovery.test.js. This
// runtime test deliberately covers only the part that needs no live IdP: route ABSENCE.
//
// Run: node tests/unit/httpServer_oauth_metadata_route.test.js

import assert from 'node:assert';

// Dummy env so config.ts parses offline. AUTH_PROVIDER is left unset => defaults to 'none'.
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';
delete process.env.AUTH_PROVIDER; // ensure default (none): the route must be absent

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

console.log('\n[oauth-metadata-route] #285 route is absent in AUTH_PROVIDER=none mode (runtime)');

const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
const mcp = {}; // only dereferenced inside protected request handlers, never hit here
// Boot on an ephemeral port bound to loopback (127.0.0.1 is #242-exempt, so AUTH_PROVIDER=none
// with no token is allowed to start).
const { listener, cleanup } = await startHttpServer(
  mcp, 0, '/', {}, [], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined,
);
try {
  if (!listener.listening) {
    await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  }
  const { port } = listener.address();
  const base = `http://127.0.0.1:${port}`;

  // Sanity: the server is actually up, so a 404 below means "route absent", not "server down".
  const health = await fetch(`${base}/health`);
  check(`server is up (GET /health -> ${health.status})`, health.status === 200);

  // The RFC 8414 route must NOT be registered in the default (none) auth mode.
  const meta = await fetch(`${base}/.well-known/oauth-authorization-server`);
  check(`GET /.well-known/oauth-authorization-server -> 404 in AUTH_PROVIDER=none (got ${meta.status})`, meta.status === 404);
} finally {
  await new Promise((res) => listener.close(res));
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);
}

console.log(`\n[oauth-metadata-route] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
