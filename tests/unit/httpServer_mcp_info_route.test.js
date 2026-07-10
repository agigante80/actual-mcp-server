// tests/unit/httpServer_mcp_info_route.test.js
//
// #286: the server-info probe (server description + tool list + advertisedUrl) used to
// live on /.well-known/oauth-protected-resource wrapped in a {jsonrpc,result} envelope,
// squatting the RFC 9728 reserved OAuth path with non-metadata. It now lives on the
// non-reserved /mcp-info as a BARE object. Consequences this test pins (runtime, over
// real HTTP, boot on loopback in the default AUTH_PROVIDER=none mode):
//   - GET /.well-known/oauth-protected-resource -> 404 (the regression: was 200 + envelope).
//     Correct: a static-bearer server has no authorization server to advertise.
//   - GET /mcp-info (and /mcp-info/http) -> 200, a BARE object (no jsonrpc/result), with
//     capabilities.tools and a tools array.
//   - GET /health -> 200 (sanity: the 404 above is "route moved", not "server down").
// Plus source-wiring guards: the reserved OAuth path is no longer an app.get() info
// handler, /mcp-info is, and the OIDC-mode RFC 9728 router is untouched (scenario 2).
//
// OIDC-mode /.well-known/oauth-protected-resource (mcpAuth.protectedResourceMetadataRouter)
// is NOT booted here: it needs a live IdP via the global fetch at startup and is mcp-auth's
// own tested code. The source assertion that its registration is unchanged is the
// offline-checkable guarantee that OIDC-mode serving is preserved.
//
// Run: node tests/unit/httpServer_mcp_info_route.test.js

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Dummy env so config.ts parses offline. AUTH_PROVIDER unset => defaults to 'none'.
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';
delete process.env.AUTH_PROVIDER;

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n[mcp-info-route] #286 server-info probe moved off the reserved OAuth path (runtime)');

const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
const mcp = {}; // only dereferenced inside protected request handlers, never hit here
const { listener, cleanup } = await startHttpServer(
  mcp, 0, '/', {}, ['actual_accounts_list', 'actual_transactions_get'], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined,
);
try {
  if (!listener.listening) {
    await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  }
  const { port } = listener.address();
  const base = `http://127.0.0.1:${port}`;

  // Sanity: server is up, so a 404 below means "route moved", not "server down".
  const health = await fetch(`${base}/health`);
  check(`server is up (GET /health -> ${health.status})`, health.status === 200);

  // Regression: the reserved OAuth path must 404 in AUTH_PROVIDER=none mode.
  const oauth = await fetch(`${base}/.well-known/oauth-protected-resource`);
  check(`GET /.well-known/oauth-protected-resource -> 404 in none mode (got ${oauth.status})`, oauth.status === 404);

  // The probe now lives on /mcp-info as a bare object.
  const info = await fetch(`${base}/mcp-info`);
  check(`GET /mcp-info -> 200 (got ${info.status})`, info.status === 200);
  const body = await info.json();
  check('GET /mcp-info body is a bare object (no jsonrpc/result envelope)',
    body && typeof body === 'object' && !('jsonrpc' in body) && !('result' in body));
  check('GET /mcp-info exposes capabilities.tools',
    body && typeof body.capabilities === 'object' && body.capabilities !== null && 'tools' in body.capabilities);
  check('GET /mcp-info exposes a tools array', Array.isArray(body && body.tools));

  // The /http variant mirrors it.
  const infoHttp = await fetch(`${base}/mcp-info/http`);
  const bodyHttp = await infoHttp.json().catch(() => null);
  check(`GET /mcp-info/http -> 200 bare object (got ${infoHttp.status})`,
    infoHttp.status === 200 && bodyHttp && !('jsonrpc' in bodyHttp));
} finally {
  await new Promise((res) => listener.close(res));
  process.removeListener('SIGTERM', cleanup);
  process.removeListener('SIGINT', cleanup);
}

console.log('\n[mcp-info-route] source wiring');
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');
check('no app.get() info handler remains on the reserved /.well-known/oauth-protected-resource path',
  !/app\.get\(\s*['"]\/\.well-known\/oauth-protected-resource/.test(src));
check('the server-info probe is registered on /mcp-info',
  /app\.get\(\s*['"]\/mcp-info['"]/.test(src));
check('OIDC-mode RFC 9728 router is untouched (scenario 2): protectedResourceMetadataRouter still registered',
  /mcpAuth\.protectedResourceMetadataRouter\(\)/.test(src));

console.log(`\n[mcp-info-route] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
