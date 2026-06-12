// tests/unit/httpServer_bind_host.test.js
//
// #239: the HTTP server ignored its configured bind host. startHttpServer accepts a
// bindHost parameter (and src/index.ts passes MCP_BRIDGE_BIND_HOST into it), but the
// app.listen(port, ...) call never forwarded the host, so MCP_BRIDGE_BIND_HOST had no
// effect and the server always bound to all interfaces.
//
// This boots startHttpServer on an ephemeral port (0) with an explicit loopback bind
// host and asserts the listener actually bound to it (listener.address().address). It
// also source-asserts the listen call forwards the host, mirroring the wiring guard in
// httpServer_oidc_auth_verification.test.js.
//
// Run: node tests/unit/httpServer_bind_host.test.js

import assert from 'assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Dummy env so config.ts parses offline (no real connection is made; routes are never hit).
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

const here = dirname(fileURLToPath(import.meta.url));

// Boot startHttpServer on port 0 with the given bind host; resolve its bound address.
async function boundAddressFor(bindHost) {
  const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
  const mcp = {}; // only dereferenced inside request handlers, never hit here
  const { listener, cleanup } = await startHttpServer(
    mcp, 0, '/', {}, [], 'desc', 'instr', {}, 'test', bindHost, undefined,
  );
  try {
    if (!listener.listening) {
      await new Promise((res, rej) => {
        listener.once('listening', res);
        listener.once('error', rej);
      });
    }
    return listener.address().address;
  } finally {
    await new Promise((res) => listener.close(res));
    // startHttpServer registers SIGTERM/SIGINT cleanup handlers; drop them so repeated
    // boots in one process do not leak listeners.
    process.removeListener('SIGTERM', cleanup);
    process.removeListener('SIGINT', cleanup);
  }
}

console.log('\n[httpServer-bind-host] behavioral: the configured host is honored');

const loopback = await boundAddressFor('127.0.0.1');
check(`binds to 127.0.0.1 when bindHost=127.0.0.1 (got ${loopback})`, loopback === '127.0.0.1');

const allV4 = await boundAddressFor('0.0.0.0');
check(`binds to 0.0.0.0 when bindHost=0.0.0.0 (got ${allV4})`, allV4 === '0.0.0.0');

console.log('\n[httpServer-bind-host] source wiring: listen forwards the host');
const src = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');
check(
  'app.listen receives bindHost as its second argument',
  /\.listen\(\s*port\s*,\s*bindHost\s*,/.test(src),
);

console.log(`\n[httpServer-bind-host] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
