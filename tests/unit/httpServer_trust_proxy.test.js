// tests/unit/httpServer_trust_proxy.test.js
//
// #543: the critical proxy-addr advisory (GHSA-jqcg-44mw-7w3h) is in Express's `trust proxy`
// subnet matching, which this server never enables. Pinned here so that stays true:
//   - the real HTTP server's app has `trust proxy` off;
//   - with the production wiring, X-Forwarded-For (IPv4 and IPv4-mapped IPv6) does not
//     change req.ip, which stays the loopback socket address;
//   - positive control: an app WITH trust proxy set does read the header, so the negative
//     assertion is not vacuous;
//   - the resolved proxy-addr is >= 2.0.8 (the fixed version).
//
// Run: node tests/unit/httpServer_trust_proxy.test.js

import { createRequire } from 'node:module';

if (process.env.NODE_ENV === 'test') delete process.env.NODE_ENV;
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';
delete process.env.AUTH_PROVIDER;

const require = createRequire(import.meta.url);
const express = require('express');

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { process.stderr.write(`  ok: ${label}\n`); passed++; }
  else { process.stderr.write(`  FAIL: ${label}${detail ? ` (${detail})` : ''}\n`); failed++; }
}

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1']);

async function ipSeenBy(app, forwardedFor) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { 'x-forwarded-for': forwardedFor } });
    return (await res.json()).ip;
  } finally { server.close(); }
}

function wiredApp({ trust } = {}) {
  const app = express();
  if (trust) app.set('trust proxy', trust);
  app.use(express.json({ limit: '512kb' }));
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

console.log('\n[#543] trust proxy stays off');

const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
const { app, listener, cleanup } = await startHttpServer(
  {}, 0, '/http', {}, ['actual_accounts_list'], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined,
);
try {
  check('the real HTTP server app has trust proxy off', !app.get('trust proxy'), String(app.get('trust proxy')));
} finally {
  await new Promise((res) => listener.close(res));
  await cleanup().catch(() => {});
}

for (const xff of ['203.0.113.9', '::ffff:10.0.0.1']) {
  const ip = await ipSeenBy(wiredApp(), xff);
  check(`X-Forwarded-For ${xff} does not change req.ip (got ${ip})`, LOOPBACK.has(ip) && ip !== xff, ip);
}

const trusted = await ipSeenBy(wiredApp({ trust: 'loopback' }), '203.0.113.9');
check(`positive control: with trust proxy 'loopback' the header IS read (got ${trusted})`, trusted === '203.0.113.9', trusted);

// Resolved from express's own location (the copy express actually loads). The name is held
// in a variable so knip does not read it as an undeclared dependency: proxy-addr is
// transitive by policy and must not become a direct one.
const transitive = 'proxy-addr';
const fromExpress = createRequire(require.resolve('express'));
const proxyAddrVersion = fromExpress(`${transitive}/package.json`).version;
const [maj, min, patch] = proxyAddrVersion.split('.').map(Number);
const fixed = maj > 2 || (maj === 2 && (min > 0 || patch >= 8));
check(`the proxy-addr express resolves is >= 2.0.8 (got ${proxyAddrVersion})`, fixed, proxyAddrVersion);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
