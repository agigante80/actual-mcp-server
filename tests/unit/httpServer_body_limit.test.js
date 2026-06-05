// tests/unit/httpServer_body_limit.test.js
//
// #168: express.json() must carry an explicit body-size limit so oversized
// payloads are rejected with HTTP 413 instead of buffered unbounded. We test
// two things:
//   1. behavioural: express.json({ limit }) actually returns 413 over the cap
//      and 200 under it (positive + negative);
//   2. wiring: httpServer.ts passes config.MCP_HTTP_BODY_LIMIT, and config.ts
//      defaults it (guards against the limit silently disappearing).
//
// Run: node tests/unit/httpServer_body_limit.test.js

import assert from 'assert';
import http from 'node:http';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

// --- Behavioural: stand up a minimal app with the same wiring shape ---
const app = express();
app.use(express.json({ limit: '1kb' }));
app.post('/', (_req, res) => res.status(200).json({ ok: true }));
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

function post(bodyStr) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyStr) } },
      (res) => { res.resume(); resolve(res.statusCode); },
    );
    req.on('error', () => resolve(-1));
    req.end(bodyStr);
  });
}

console.log('\n[httpServer-body-limit] behaviour');
const small = JSON.stringify({ a: 'x'.repeat(100) });        // well under 1kb
const big = JSON.stringify({ a: 'x'.repeat(4000) });         // well over 1kb
check('POSITIVE: body under the limit returns 200', (await post(small)) === 200);
check('NEGATIVE: body over the limit returns 413', (await post(big)) === 413);
server.close();

// --- Wiring: the production code must reference the config limit ---
const here = dirname(fileURLToPath(import.meta.url));
const httpServerSrc = readFileSync(resolve(here, '../../src/server/httpServer.ts'), 'utf8');
const configSrc = readFileSync(resolve(here, '../../src/config.ts'), 'utf8');

console.log('\n[httpServer-body-limit] wiring');
check('httpServer passes a limit to express.json', /express\.json\(\{\s*limit:/.test(httpServerSrc));
check('the limit is config.MCP_HTTP_BODY_LIMIT (not a bare literal)', /express\.json\(\{\s*limit:\s*config\.MCP_HTTP_BODY_LIMIT/.test(httpServerSrc));
check('config defines MCP_HTTP_BODY_LIMIT with a default', /MCP_HTTP_BODY_LIMIT:\s*z\.string\(\)\.default\(/.test(configSrc));

console.log(`\n[httpServer-body-limit] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
