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
check('#466: the field is validated by a .refine( chained after the default', /MCP_HTTP_BODY_LIMIT:\s*z\.string\(\)\.default\([^)]*\)\.refine\(/.test(configSrc));

// --- #466: the limit is validated at CONFIG time ---
// body-parser 2.3.0 throws an opaque TypeError on an unparseable limit (2.2.x ran with
// NO cap), and `bytes` silently misreads some values ("10 potatoes" is 10 bytes), reads
// a tiny fraction as a 0-byte cap and a huge value as Infinity, which 2.3.0 accepts as
// unlimited. Every accepted value must parse AND be a limit express.json accepts; every
// refused value must fail naming the variable.
const { configSchema, parseStrictByteSize } = await import('../../dist/src/config.js');
const cfgBase = { ACTUAL_SERVER_URL: 'http://localhost:5006', ACTUAL_PASSWORD: 'x', ACTUAL_BUDGET_SYNC_ID: 's' };
const parseLimit = (v) => configSchema.safeParse({ ...cfgBase, MCP_HTTP_BODY_LIMIT: v });

console.log('\n[httpServer-body-limit] #466 accept table');
// #468: each row pins the byte COUNT body-parser will enforce (values taken from
// bytes@3.1.2, the parser body-parser 2.3.0 uses). Acceptance alone cannot see a wrong
// multiplier: with kb = 1000, "512kb" is still accepted but becomes 512000 bytes.
// Hard-coded literals, never a value derived from the function under test.
const ACCEPT = [
  ['512kb', 524288], ['1mb', 1048576], ['1.5MB', 1572864], ['1048576', 1048576], ['512b', 512],
  ['512 kb', 524288], ['0.3kb', 307], ['7pb', 7881299347898368], ['9007199254740991', 9007199254740991],
];
for (const [v, bytes] of ACCEPT) {
  let builds = true;
  try { express.json({ limit: v }); } catch { builds = false; }
  check(`accepts ${JSON.stringify(v)} and express.json accepts it too`, parseLimit(v).success && builds);
  check(`${JSON.stringify(v)} is exactly ${bytes} bytes`, parseStrictByteSize(v) === bytes);
}
check('parseStrictByteSize refuses "1.5b" and "10 potatoes" (null, not a misread size)',
  parseStrictByteSize('1.5b') === null && parseStrictByteSize('10 potatoes') === null);
check('an unset limit still defaults to 512kb', configSchema.safeParse(cfgBase).data?.MCP_HTTP_BODY_LIMIT === '512kb');

console.log('\n[httpServer-body-limit] #466 reject table');
const huge = '9'.repeat(400) + 'pb';
for (const v of ['abc', '0kb', '0', '-1mb', '', '10 potatoes', '  512kb', '512kb ', '1.5', '1.5b', '1e6', '1,000', '0x10', '0.0001kb', huge, '99999999pb', '8pb']) {
  const r = parseLimit(v);
  const named = !r.success && r.error.issues.some((i) => i.path.includes('MCP_HTTP_BODY_LIMIT') && i.message.includes('MCP_HTTP_BODY_LIMIT'));
  check(`refuses ${JSON.stringify(v.length > 20 ? v.slice(0, 12) + '...' : v)} naming MCP_HTTP_BODY_LIMIT`, named);
}

console.log(`\n[httpServer-body-limit] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
