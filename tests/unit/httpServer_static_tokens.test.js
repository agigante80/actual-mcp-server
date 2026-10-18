// tests/unit/httpServer_static_tokens.test.js
//
// MCP_STATIC_TOKENS over real HTTP (in-process server on loopback, AUTH_PROVIDER=none):
//   - no token / unknown token / wrong scheme -> 401 (unchanged contract)
//   - the legacy MCP_SSE_AUTHORIZATION token and every per-principal token get initialize -> 200
//   - an invalid MCP_STATIC_TOKENS refuses startup (child process: config parses env once)
// Plus source guards for the wiring the runtime half cannot observe without a live Actual
// server: a matched static token sets req.staticPrincipal and req.allowedBudgets, and
// resolvePrincipal() prefers req.staticPrincipal over the shared 'static-bearer'.
//
// Run: node tests/unit/httpServer_static_tokens.test.js

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const LEGACY = 'legacy-token-for-unit-test-static-tokens-0001';
const T_A = 'a'.repeat(40);
const T_B = 'b'.repeat(40);

process.env.ACTUAL_SERVER_URL = 'http://127.0.0.1:9';
process.env.ACTUAL_BUDGET_SYNC_ID = 'house-sync';
process.env.ACTUAL_PASSWORD = 'stub-password-for-unit-test';
process.env.BUDGET_DEFAULT_NAME = 'House';
process.env.BUDGET_1_NAME = 'Charity';
process.env.BUDGET_1_SYNC_ID = 'charity-sync';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.MCP_SSE_AUTHORIZATION = LEGACY;
process.env.MCP_TOKEN_A = T_A;
process.env.MCP_TOKEN_B = T_B;
process.env.MCP_STATIC_TOKENS = JSON.stringify({
  agent_a: { tokenEnv: 'MCP_TOKEN_A', budgets: ['House'] },
  agent_b: { tokenEnv: 'MCP_TOKEN_B', budgets: ['Charity'] },
});
delete process.env.AUTH_PROVIDER;

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}`); failed++; }
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');

console.log('\n[static-tokens-http] auth over real HTTP');
const { startHttpServer } = await import('../../dist/src/server/httpServer.js');
const { listener, cleanup } = await startHttpServer({}, 0, '/http', {}, [], 'desc', 'instr', {}, 'test', '127.0.0.1', undefined);
try {
  if (!listener.listening) {
    await new Promise((res, rej) => { listener.once('listening', res); listener.once('error', rej); });
  }
  const { port } = listener.address();
  const url = `http://127.0.0.1:${port}/http`;
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  });
  const post = (auth) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body,
    signal: AbortSignal.timeout(20_000),
  }).then(r => r.status).catch(e => `error:${e.name}`);

  check('no Authorization header -> 401', (await post(undefined)) === 401);
  check('unknown token -> 401', (await post(`Bearer ${'z'.repeat(40)}`)) === 401);
  check('static token with a non-Bearer scheme -> 401', (await post(`Basic ${T_A}`)) === 401);
  check('prefix of a static token -> 401', (await post(`Bearer ${T_A.slice(1)}`)) === 401);
  const legacy = await post(`Bearer ${LEGACY}`);
  check(`legacy MCP_SSE_AUTHORIZATION: initialize answered 200 (got ${legacy})`, legacy === 200);
  const a = await post(`Bearer ${T_A}`);
  check(`agent_a token: initialize answered 200 (got ${a})`, a === 200);
  const b = await post(`bearer ${T_B}`);
  check(`agent_b token, scheme case-insensitive: initialize answered 200 (got ${b})`, b === 200);
} finally {
  await cleanup?.();
  listener.close?.();
}

console.log('\n[static-tokens-http] invalid MCP_STATIC_TOKENS refuses startup');
const boot = `
  const { startHttpServer } = await import(${JSON.stringify(join(ROOT, 'dist/src/server/httpServer.js'))});
  await startHttpServer({}, 0, '/http', {}, [], 'd', 'i', {}, 't', '127.0.0.1', undefined);
  console.log('__STARTED__');
  process.exit(0);
`;
const env = { ...process.env, MCP_STATIC_TOKENS: JSON.stringify({ agent_a: { tokenEnv: 'MCP_TOKEN_A', budgets: ['Nope'] } }) };
const child = spawnSync(process.execPath, ['--input-type=module', '-e', boot], { env, encoding: 'utf8', timeout: 60_000 });
check('server does not start with an unknown budget in MCP_STATIC_TOKENS', !child.stdout.includes('__STARTED__') && child.status !== 0);
check('the refusal names the problem', /unknown budget "Nope"/.test(child.stderr + child.stdout));
check('the refusal never prints a token value', !(child.stderr + child.stdout).includes(T_A));

console.log('\n[static-tokens-http] source wiring guards');
const src = readFileSync(resolve(ROOT, 'src/server/httpServer.ts'), 'utf8');
check('a matched static token sets req.staticPrincipal', /staticPrincipal\s*=\s*staticMatch\.principal/.test(src));
check('a matched static token sets req.allowedBudgets', /allowedBudgets\s*=\s*staticMatch\.allowedSyncIds/.test(src));
check('resolvePrincipal prefers req.staticPrincipal', /if \(staticPrincipal\) return staticPrincipal;/.test(src));
check('static tokens are compared through matchStaticToken (constant work)', /matchStaticToken\(token, staticTokens\)/.test(src));
check('a new session connects with its starting budget (initialBudgetForSession)', /initialBudgetForSession\(sid\)[\s\S]{0,200}connectToActualForSession\(sid, \{/.test(src));

console.log(`\n[static-tokens-http] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
