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

// Registry: default "Alpha" + "Beta" + "Gamma". Set before importing the adapter.
process.env.ACTUAL_SERVER_URL = 'http://test-server:5006';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'alpha-sync';
process.env.BUDGET_DEFAULT_NAME = 'Alpha';
process.env.BUDGET_1_NAME = 'Beta';
process.env.BUDGET_1_SYNC_ID = 'beta-sync';
process.env.BUDGET_2_NAME = 'Gamma';
process.env.BUDGET_2_SYNC_ID = 'gamma-sync';
// Gamma lives on ANOTHER server with other credentials: a session starting on it must connect there.
process.env.BUDGET_2_SERVER_URL = 'http://gamma-server:5006';
process.env.BUDGET_2_PASSWORD = 'pw-gamma';
process.env.ALLOW_INSECURE_UPSTREAM = 'true';
process.env.MCP_BRIDGE_DATA_DIR = mkdtempSync(join(tmpdir(), 'static-tokens-'));

// Upstream budget files, stubbed BEFORE the adapter is imported (it destructures the api at load).
const apiMod = await import('@actual-app/api');
const apiDefault = apiMod.default || apiMod;
apiDefault.getBudgets = async () => [
  { id: 'f1', name: 'Alpha', groupId: 'alpha-sync' },
  { id: 'f2', name: 'Beta', groupId: 'beta-sync' },
  { id: 'f3', name: 'Gamma', groupId: 'gamma-sync' },
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
  { name: 'Alpha', syncId: 'alpha-sync' },
  { name: 'Beta', syncId: 'beta-sync' },
  { name: 'Gamma', syncId: 'gamma-sync' },
];
const T_ALICE = 'h'.repeat(MIN_TOKEN_LENGTH);
const T_BOB = 't'.repeat(MIN_TOKEN_LENGTH + 8);
const T_CAROL = 'c'.repeat(MIN_TOKEN_LENGTH);
const ENV = { MCP_TOKEN_ALICE: T_ALICE, MCP_TOKEN_BOB: T_BOB, MCP_TOKEN_CAROL: T_CAROL };
const CONFIG = JSON.stringify({
  alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] },
  bob: { tokenEnv: 'MCP_TOKEN_BOB', budgets: ['alpha', 'BETA', 'Gamma'] },
  carol: { tokenEnv: 'MCP_TOKEN_CAROL', budgets: ['Gamma'] },
});

console.log('Running MCP_STATIC_TOKENS tests');

// ── parser ───────────────────────────────────────────────────────────────────
console.log('\n[parser] valid configuration');
assert(parseStaticTokens(undefined, ENV, REGISTRY).length === 0, 'unset → no entries (feature off)');
assert(parseStaticTokens('  ', ENV, REGISTRY).length === 0, 'blank → no entries');
const entries = parseStaticTokens(CONFIG, ENV, REGISTRY);
assert(entries.length === 3, 'three principals parsed');
const bob = entries.find(e => e.principal === 'bob');
assert(JSON.stringify(bob.allowedSyncIds) === JSON.stringify(['alpha-sync', 'beta-sync', 'gamma-sync']),
  'budget names resolve case-insensitively to sync ids, in configured order');

console.log('\n[parser] refusals (fail fast, no token in messages)');
throwsMatching(() => parseStaticTokens('{not json', ENV, REGISTRY), /not valid JSON/, 'invalid JSON refused');
throwsMatching(() => parseStaticTokens('[]', ENV, REGISTRY), /JSON object/, 'array refused');
throwsMatching(() => parseStaticTokens('{}', ENV, REGISTRY), /no principals/, 'empty object refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ 'static-bearer': { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }), ENV, REGISTRY),
  /reserved/, 'reserved principal "static-bearer" refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ 'bad name': { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }), ENV, REGISTRY),
  /invalid principal/, 'principal with spaces refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_MISSING', budgets: ['Alpha'] } }), ENV, REGISTRY),
  /unset or empty/, 'tokenEnv pointing to an unset variable refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'SHORT', budgets: ['Alpha'] } }), { SHORT: 'abc' }, REGISTRY),
  /shorter than/, 'short token refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: [] } }), ENV, REGISTRY),
  /non-empty array/, 'empty budget list refused (EC-002)');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Nope'] } }), ENV, REGISTRY),
  /unknown budget "Nope"/, 'unknown budget refused (EC-003)');
throwsMatching(() => parseStaticTokens(JSON.stringify({
  a: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] },
  b: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Gamma'] },
}), ENV, REGISTRY), /not unique/, 'two principals with the same token refused');
throwsMatching(() => parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }), ENV, REGISTRY, T_ALICE),
  /not unique/, 'token equal to MCP_SSE_AUTHORIZATION refused (EC-004)');
try {
  parseStaticTokens(JSON.stringify({ a: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Nope'] } }), ENV, REGISTRY);
} catch (e) {
  assert(!String(e.message).includes(T_ALICE), 'error messages never contain the token value');
}

console.log('\n[parser] matching');
assert(matchStaticToken(T_ALICE, entries)?.principal === 'alice', 'alice token → alice');
assert(matchStaticToken(T_CAROL, entries)?.principal === 'carol', 'carol token → carol');
assert(matchStaticToken('x'.repeat(MIN_TOKEN_LENGTH), entries) === undefined, 'unknown token → no match');
assert(matchStaticToken(T_ALICE.slice(1), entries) === undefined, 'prefix of a token → no match');
const m = matchStaticToken(T_BOB, entries);
m.allowedSyncIds.push('tampered');
assert(!matchStaticToken(T_BOB, entries).allowedSyncIds.includes('tampered'), 'match returns a copy (entries are not mutable through it)');

// ── adapter: the incident ────────────────────────────────────────────────────
adapter._setSkipApiInitForTests(true);
async function run(ctx, fn) {
  return await new Promise((resolve, reject) => {
    requestContext.run(ctx, async () => { try { resolve(await fn()); } catch (e) { reject(e); } });
  });
}
const ALICE = { principal: 'alice', allowedBudgets: ['alpha-sync'] };
const BOB = { principal: 'bob', allowedBudgets: ['alpha-sync', 'beta-sync', 'gamma-sync'] };
const CAROL = { principal: 'carol', allowedBudgets: ['gamma-sync'] };

try {
  console.log('\n[adapter] a switch by another principal does not leak into a fresh session (CA-010)');
  await run({ sessionId: 'bob-1', ...BOB }, async () => {
    const r = await adapter.switchBudget('Gamma');
    assert(r.syncId === 'gamma-sync', 'bob switches to Gamma (allowed)');
  });
  await run({ sessionId: 'alice-fresh', ...ALICE }, async () => {
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'alpha-sync',
      "fresh alice session lands on Alpha, not on bob's Gamma");
  });

  console.log('\n[adapter] switch outside the allow-list is refused without OIDC (CA-003)');
  await run({ sessionId: 'alice-2', ...ALICE }, async () => {
    try { await adapter.switchBudget('Gamma'); bad('alice switch to Gamma was allowed'); }
    catch (e) { /Budget ACL/.test(e.message) ? ok('alice switch to Gamma refused by the ACL') : bad(`unexpected error: ${e.message}`); }
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'alpha-sync', 'refused switch leaves alice on Alpha');
  });

  console.log('\n[adapter] first permitted budget when the default is not allowed (CA-004)');
  await run({ sessionId: 'carol-fresh', ...CAROL }, async () => {
    assert(adapter._getActiveBudgetConfigForTests().syncId === 'gamma-sync',
      'fresh carol session starts on Gamma, not on the env default Alpha');
  });

  console.log('\n[adapter] listings and import for restricted callers (CA-005)');
  await run({ sessionId: 'alice-3', ...ALICE }, async () => {
    const names = adapter.getBudgetRegistry().map(b => b.name);
    assert(JSON.stringify(names) === JSON.stringify(['Alpha']), 'alice only lists Alpha');
    try { await adapter.importBudget(new Uint8Array([1, 2, 3])); bad('alice import was allowed'); }
    catch (e) { /actual_budgets_import is not available/.test(e.message) ? ok('alice import refused') : bad(`unexpected error: ${e.message}`); }
  });
  await run({ sessionId: 'bob-2', ...BOB }, async () => {
    assert(adapter.getBudgetRegistry().length === 3, 'bob lists its three budgets');
  });

  console.log('\n[adapter] reads go through withActualApi on the caller\'s own budget (CA-010)');
  // withActualApi runs the real ACL enforcement (_enforceBudgetAcl) before the operation; the
  // operation reports which budget it ran against.
  const readOn = (ctx) => run(ctx, () => adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId));
  assert(await readOn({ sessionId: 'alice-read', ...ALICE }) === 'alpha-sync',
    'a alice read runs against Alpha after bob moved to Gamma');

  console.log('\n[adapter] concurrent principals do not cross (EC-005)');
  // Interleave: each run yields between selection and read, so a shared slot would leak.
  const tick = () => new Promise(r => setImmediate(r));
  const results = await Promise.all([
    run({ sessionId: 'conc-bob', ...BOB }, async () => {
      await adapter.switchBudget('Beta');
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
    run({ sessionId: 'conc-alice', ...ALICE }, async () => {
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
    run({ sessionId: 'conc-carol', ...CAROL }, async () => {
      await tick();
      return adapter.withActualApi(async () => adapter._getActiveBudgetConfigForTests().syncId);
    }),
  ]);
  assert(JSON.stringify(results) === JSON.stringify(['beta-sync', 'alpha-sync', 'gamma-sync']),
    `three concurrent principals each read their own budget (got ${JSON.stringify(results)})`);

  console.log('\n[adapter] the first connection of a session is bound to its starting budget\'s server');
  const seen = [];
  const realGetConnection = connectionPool.getConnection.bind(connectionPool);
  connectionPool.getConnection = async (sid, override) => { seen.push({ sid, override }); };
  await run({ ...CAROL }, async () => {
    const start = adapter.initialBudgetForSession('carol-new');
    await connectToActualForSession('carol-new', {
      serverUrl: start.serverUrl, password: start.password, syncId: start.syncId, encryptionPassword: start.encryptionPassword,
    });
  });
  connectionPool.getConnection = realGetConnection;
  const ov = seen[0]?.override;
  assert(ov?.serverUrl === 'http://gamma-server:5006' && ov?.password === 'pw-gamma' && ov?.syncId === 'gamma-sync',
    `a carol session connects to Gamma's server with Gamma's credentials (got ${ov?.serverUrl})`);
  await run({ ...ALICE }, async () => {
    const start = adapter.initialBudgetForSession('alice-new');
    assert(start.serverUrl === 'http://test-server:5006' && start.syncId === 'alpha-sync', 'a alice session starts on Alpha on the default server');
  });

  console.log('\n[adapter] upstream budget-file listing (getBudgets) is filtered for restricted callers');
  await run({ sessionId: 'alice-files', ...ALICE }, async () => {
    const files = await adapter.getBudgets();
    assert(JSON.stringify(files.map(f => f.name)) === JSON.stringify(['Alpha']), `alice sees only Alpha's file (got ${JSON.stringify(files.map(f => f.name))})`);
  });
  await run({ sessionId: 'wild-files', principal: 'admin', allowedBudgets: ['*'] }, async () => {
    const files = await adapter.getBudgets();
    assert(files.length === 4, 'a wildcard ACL sees every file, including ones outside the registry');
  });

  console.log('\n[adapter] unrestricted callers keep today\'s behaviour');
  await run({ sessionId: 'legacy-1', principal: 'static-bearer' }, async () => {
    assert(adapter.getBudgetRegistry().length === 3, 'legacy token (no allow-list) lists every budget');
    const r = await adapter.switchBudget('Beta');
    assert(r.syncId === 'beta-sync', 'legacy token can switch to any budget');
  });
  assert(adapter.getBudgetRegistry().length === 3, 'outside a request (startup) the full registry is returned');
} catch (e) {
  bad(`unexpected exception: ${e.stack || e.message}`);
}

console.log(`\n[static-tokens] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
