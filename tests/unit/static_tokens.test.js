// tests/unit/static_tokens.test.js
//
// MCP_STATIC_TOKENS: multiple static Bearer tokens, each bound to a principal and a budget
// allow-list (src/auth/static-tokens.ts), enforced through the existing ACL paths.
//
// Two layers:
//   parser  : parseStaticTokens / matchStaticToken by value: valid config, every refusal
//             (fail-fast, messages never echo a token), constant-work matching
//   adapter : the incident this exists for. Two agents share one server with different tokens;
//             agent A switches to budget X; a FRESH session of agent B (restricted to budget W)
//             must still land on W, cannot switch to X, only sees W in listings, and cannot
//             import. Driven through requestContext exactly as httpServer.ts populates it.
//
// Run: node tests/unit/static_tokens.test.js

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Registry: default "House" + "Payday" + "Charity". Set before importing the adapter.
process.env.ACTUAL_SERVER_URL = 'http://test-server:5006';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'house-sync';
process.env.BUDGET_DEFAULT_NAME = 'House';
process.env.BUDGET_1_NAME = 'Payday';
process.env.BUDGET_1_SYNC_ID = 'payday-sync';
process.env.BUDGET_2_NAME = 'Charity';
process.env.BUDGET_2_SYNC_ID = 'charity-sync';
// Charity lives on ANOTHER server with other credentials: a session starting on it must connect there.
process.env.BUDGET_2_SERVER_URL = 'http://charity-server:5006';
process.env.BUDGET_2_PASSWORD = 'pw-charity';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'static-tokens-'));

// Upstream budget files, stubbed BEFORE the adapter is imported (it destructures the api at load).
const apiMod = await import('@actual-app/api');
const apiDefault = apiMod.default || apiMod;
apiDefault.getBudgets = async () => [
  { id: 'f1', name: 'House', groupId: 'house-sync' },
  { id: 'f2', name: 'Payday', groupId: 'payday-sync' },
  { id: 'f3', name: 'Charity', groupId: 'charity-sync' },
  { id: 'f4', name: 'Imported', groupId: 'not-in-registry' },
];
apiDefault.sync = async () => {};

const { parseStaticTokens, matchStaticToken, MIN_TOKEN_LENGTH } = await import('../../dist/src/auth/static-tokens.js');
const adapter = await import('../../dist/src/lib/actual-adapter.js');
const { requestContext } = await import('../../dist/src/lib/requestContext.js');
const { connectToActualForSession } = await import('../../dist/src/actualConnection.js');
const { connectionPool } = await import('../../dist/src/lib/ActualConnectionPool.js');

let passed = 0, failed = 0;
function ok(m) { console.log(`  PASS: ${m}`); passed++; }
function bad(m) { console.error(`  FAIL: ${m}`); failed++; }
function assert(c, m) { c ? ok(m) : bad(m); }
function throwsMatching(fn, re, m) {
  try { fn(); bad(`${m} (did not throw)`); }
  catch (e) { re.test(String(e.message)) ? ok(m) : bad(`${m} (message: ${e.message})`); }
}

const REGISTRY = [
  { name: 'House', syncId: 'house-sync' },
  { name: 'Payday', syncId: 'payday-sync' },
  { name: 'Charity', syncId: 'charity-sync' },
];
const T_HOUSE = 'h'.repeat(MIN_TOKEN_LENGTH);
const T_TREASURY = 't'.repeat(MIN_TOKEN_LENGTH + 8);
const T_CHARITY = 'c'.repeat(MIN_TOKEN_LENGTH);
const ENV = { MCP_TOKEN_HOUSE: T_HOUSE, MCP_TOKEN_TREASURY: T_TREASURY, MCP_TOKEN_CHARITY: T_CHARITY };
const CONFIG = JSON.stringify({
  butler: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['House'] },
  treasury: { tokenEnv: 'MCP_TOKEN_TREASURY', budgets: ['house', 'PAYDAY', 'Charity'] },
  charity: { tokenEnv: 'MCP_TOKEN_CHARITY', budgets: ['Charity'] },
});

console.log('Running MCP_STATIC_TOKENS tests');

// ── parser ───────────────────────────────────────────────────────────────────
console.log('\n[parser] valid configuration');
assert(parseStaticTokens(undefined, ENV, REGISTRY).length === 0, 'unset → no entries (feature off)');
assert(parseStaticTokens('  ', ENV, REGISTRY).length === 0, 'blank → no entries');
const entries = parseStaticTokens(CONFIG, ENV, REGISTRY);
assert(entries.length === 3, 'three principals parsed');
const treasury = entries.find(e => e.principal === 'treasury');
assert(JSON.stringify(treasury.allowedSyncIds) === JSON.stringify(['house-sync', 'payday-sync', 'charity-sync']),
  'budget names resolve case-insensitively to sync ids, in configured order');

console.log('\n[parser] refusals (fail fast, no token in messages)');
throwsMatching(() => parseStaticTokens('{not json', ENV, REGISTRY), /not valid JSON/, 'invalid JSON refused');
throwsMatching(() => parseStaticTokens('[]', ENV, REGISTRY), /JSON object/, 'array refused');
throwsMatching(() => parseStaticTokens('{}', ENV, REGISTRY), /no principals/, 'empty object refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ 'static-bearer': { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['House'] } }), ENV, REGISTRY),
  /reserved/, 'reserved principal "static-bearer" refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ 'bad name': { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['House'] } }), ENV, REGISTRY),
  /invalid principal/, 'principal with spaces refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_MISSING', budgets: ['House'] } }), ENV, REGISTRY),
  /unset or empty/, 'tokenEnv pointing to an unset variable refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'SHORT', budgets: ['House'] } }), { SHORT: 'abc' }, REGISTRY),
  /shorter than/, 'short token refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: [] } }), ENV, REGISTRY),
  /non-empty array/, 'empty budget list refused (EC-002)');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['Nope'] } }), ENV, REGISTRY),
  /unknown budget "Nope"/, 'unknown budget refused (EC-003)');
throwsMatching(() => parseStaticTokens(JSON.stringify({
  a: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['House'] },
  b: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['Charity'] },
}), ENV, REGISTRY), /not unique/, 'two principals with the same token refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['House'] } }), ENV, REGISTRY, T_HOUSE),
  /not unique/, 'token equal to MCP_SSE_AUTHORIZATION refused (EC-004)');
try {
  parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_HOUSE', budgets: ['Nope'] } }), ENV, REGISTRY);
} catch (e) {
  assert(!String(e.message).includes(T_HOUSE), 'error messages never contain the token value');
}

console.log('\n[parser] matching');
assert(matchStaticToken(T_HOUSE, entries)?.principal === 'butler', 'house token → butler');
assert(matchStaticToken(T_CHARITY, entries)?.principal === 'charity', 'charity token → charity');
assert(matchStaticToken('x'.repeat(MIN_TOKEN_LENGTH), entries) === undefined, 'unknown token → no match');
assert(matchStaticToken(T_HOUSE.slice(1), entries) === undefined, 'prefix of a token → no match');
const m = matchStaticToken(T_TREASURY, entries);
m.allowedSyncIds.push('tampered');
assert(!matchStaticToken(T_TREASURY, entries).allowedSyncIds.includes('tampered'), 'match returns a copy (entries are not mutable through it)');

// ── adapter: the incident ────────────────────────────────────────────────────
adapter._setSkipApiInitForTests(true);
async function run(ctx, fn) {
  return await new Promise((resolve, reject) => {
    requestContext.run(ctx, async () => { try { resolve(await fn()); } catch (e) { reject(e); } });
  });
}
const BUTLER = { principal: 'butler', allowedBudgets: ['house-sync'] };
const TREASURY = { principal: 'treasury', allowedBudgets: ['house-sync', 'payday-sync', 'charity-sync'] };
const CHARITY = { principal: 'charity', allowedBudgets: ['charity-sync'] };

try {
  console.log('\n[adapter] a switch by another principal does not leak into a fresh session (CA-010)');
  await run({ sessionId: 'treasury-1', ...TREASURY }, async () => {
    const r = await adapter.switchBudget('Charity');
    assert(r.syncId === 'charity-sync', 'treasury switches to Charity (allowed)');
  });
  await run({ sessionId: 'butler-fresh', ...BUTLER }, async () => {
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'house-sync',
      "fresh butler session lands on House, not on treasury's Charity");
  });

  console.log('\n[adapter] switch outside the allow-list is refused without OIDC (CA-003)');
  await run({ sessionId: 'butler-2', ...BUTLER }, async () => {
    try { await adapter.switchBudget('Charity'); bad('butler switch to Charity was allowed'); }
    catch (e) { /Budget ACL/.test(e.message) ? ok('butler switch to Charity refused by the ACL') : bad(`unexpected error: ${e.message}`); }
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'house-sync', 'refused switch leaves butler on House');
  });

  console.log('\n[adapter] first permitted budget when the default is not allowed (CA-004)');
  await run({ sessionId: 'charity-fresh', ...CHARITY }, async () => {
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'charity-sync',
      'fresh charity session starts on Charity, not on the env default House');
  });

  console.log('\n[adapter] listings and import for restricted callers (CA-005)');
  await run({ sessionId: 'butler-3', ...BUTLER }, async () => {
    const names = adapter.getBudgetRegistry().map(b => b.name);
    assert(JSON.stringify(names) === JSON.stringify(['House']), 'butler only lists House');
    try { await adapter.importBudget(new Uint8Array([1, 2, 3])); bad('butler import was allowed'); }
    catch (e) { /actual_budgets_import is not available/.test(e.message) ? ok('butler import refused') : bad(`unexpected error: ${e.message}`); }
  });
  await run({ sessionId: 'treasury-2', ...TREASURY }, async () => {
    assert(adapter.getBudgetRegistry().length === 3, 'treasury lists its three budgets');
  });

  console.log('\n[adapter] reads go through withActualApi on the caller\'s own budget (CA-010)');
  // withActualApi runs the real ACL enforcement (_enforceBudgetAcl) before the operation; the
  // operation reports which budget it ran against.
  const readOn = (ctx) => run(ctx, () => adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId));
  assert(await readOn({ sessionId: 'butler-read', ...BUTLER }) === 'house-sync',
    'a butler read runs against House after treasury moved to Charity');

  console.log('\n[adapter] concurrent principals do not cross (EC-005)');
  // Interleave: each run yields between selection and read, so a shared slot would leak.
  const tick = () => new Promise(r => setImmediate(r));
  const results = await Promise.all([
    run({ sessionId: 'conc-treasury', ...TREASURY }, async () => {
      await adapter.switchBudget('Payday');
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
    run({ sessionId: 'conc-butler', ...BUTLER }, async () => {
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
    run({ sessionId: 'conc-charity', ...CHARITY }, async () => {
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
  ]);
  assert(JSON.stringify(results) === JSON.stringify(['payday-sync', 'house-sync', 'charity-sync']),
    `three concurrent principals each read their own budget (got ${JSON.stringify(results)})`);

  console.log('\n[adapter] the first connection of a session is bound to its starting budget\'s server');
  const seen = [];
  const realGetConnection = connectionPool.getConnection.bind(connectionPool);
  connectionPool.getConnection = async (sid, override) => { seen.push({ sid, override }); };
  await run({ ...CHARITY }, async () => {
    const start = adapter.initialBudgetForSession('charity-new');
    await connectToActualForSession('charity-new', {
      serverUrl: start.serverUrl, password: start.password, syncId: start.syncId, encryptionPassword: start.encryptionPassword,
    });
  });
  connectionPool.getConnection = realGetConnection;
  const ov = seen[0]?.override;
  assert(ov?.serverUrl === 'http://charity-server:5006' && ov?.password === 'pw-charity' && ov?.syncId === 'charity-sync',
    `a charity session connects to Charity's server with Charity's credentials (got ${ov?.serverUrl})`);
  await run({ ...BUTLER }, async () => {
    const start = adapter.initialBudgetForSession('butler-new');
    assert(start.serverUrl === 'http://test-server:5006' && start.syncId === 'house-sync', 'a butler session starts on House on the default server');
  });

  console.log('\n[adapter] upstream budget-file listing (getBudgets) is filtered for restricted callers');
  await run({ sessionId: 'butler-files', ...BUTLER }, async () => {
    const files = await adapter.getBudgets();
    assert(JSON.stringify(files.map(f => f.name)) === JSON.stringify(['House']), `butler sees only House's file (got ${JSON.stringify(files.map(f => f.name))})`);
  });
  await run({ sessionId: 'wild-files', principal: 'admin', allowedBudgets: ['*'] }, async () => {
    const files = await adapter.getBudgets();
    assert(files.length === 4, 'a wildcard ACL sees every file, including ones outside the registry');
  });

  console.log('\n[adapter] unrestricted callers keep today\'s behaviour');
  await run({ sessionId: 'legacy-1', principal: 'static-bearer' }, async () => {
    assert(adapter.getBudgetRegistry().length === 3, 'legacy token (no allow-list) lists every budget');
    const r = await adapter.switchBudget('Payday');
    assert(r.syncId === 'payday-sync', 'legacy token can switch to any budget');
  });
  assert(adapter.getBudgetRegistry().length === 3, 'outside a request (startup) the full registry is returned');
} catch (e) {
  bad(`unexpected exception: ${e.stack || e.message}`);
}

console.log(`\n[static-tokens] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
