// tests/unit/manual_support_compact.test.js
//
// #680: the compact tool surface is the default, and a legacy `actual_*` name is refused there.
// #681 migrated the modules in tests/manual/tests/; this guards the SUPPORT code around them
// (runner.js, residue.js, cleanup.js, mcp-client*.js, compact-calls.js): the first refused call
// in the cleanup phase used to end the whole run, so a legacy name creeping back into one of
// these files fails here instead of in a release gate.
//
//   1. No `actual_*` tool name appears in a support file, except the two session tools (they
//      have no compact tool). The hand-run repro scripts are listed with a reason.
//   2. Every call tests/manual/compact-calls.js builds is run through the REAL compact
//      dispatcher (strict zod validation, UUID ids, required `entity`) with the legacy layer
//      stubbed, and must reach the intended legacy tool with the intended arguments.
//   3. The own-key listings residue.js reads are the ones named in LISTING_KEY.
//
// Run: node tests/unit/manual_support_compact.test.js   (needs `npm run build`)

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { viaCompact } from './helpers/compact-call-tool.js';
import {
  LISTING_TYPES, LISTING_KEY, listCall, listingLabel, budgetFilesCall, accountTransactionsCall, REMOVE, remove,
} from '../manual/compact-calls.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok: ${name}`); passed += 1; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed += 1; }
};

const SESSION_TOOLS = ['actual_session_list', 'actual_session_close'];

const SUPPORT_FILES = [
  'tests/manual/runner.js',
  'tests/manual/residue.js',
  'tests/manual/cleanup.js',
  'tests/manual/mcp-client.js',
  'tests/manual/mcp-client-stdio.js',
  'tests/manual/compact-calls.js',
  'tests/manual/context.js',
  'tests/manual/assert.js',
  'tests/manual/index.js',
];

/** Hand-run diagnostics that probe the LEGACY tools on purpose; not part of the suite. */
const LEGACY_REPRO = {
  'tests/manual/repro-212.mjs': 'hand-run reproduction of #212 against the legacy update tools; not run by the suite or a release gate',
  'tests/manual/repro-delete-guards.mjs': 'hand-run reproduction of the legacy delete contract (#211); not run by the suite or a release gate',
};

const LEGACY_TOKEN = /\bactual_[a-z0-9_]*[a-z0-9]\b/g;

/** `file:line: message` for every legacy tool name that is not a session tool. */
function legacyProblems(file, text) {
  const problems = [];
  text.split('\n').forEach((line, idx) => {
    for (const m of line.matchAll(LEGACY_TOKEN)) {
      if (SESSION_TOOLS.includes(m[0])) continue;
      problems.push(`${file}:${idx + 1}: legacy tool name ${m[0]} in a manual support file`);
    }
  });
  return problems;
}

await check('no manual support file names a legacy actual_* tool (the session tools excepted)', () => {
  const problems = [];
  for (const f of SUPPORT_FILES) {
    if (!existsSync(join(ROOT, f))) { problems.push(`${f}: listed but missing`); continue; }
    problems.push(...legacyProblems(f, read(f)));
  }
  assert.deepStrictEqual(problems, []);
});

await check('every LEGACY_REPRO file exists, carries a reason, and still holds a legacy name', () => {
  const problems = [];
  for (const [f, why] of Object.entries(LEGACY_REPRO)) {
    if (why.trim().length < 15) problems.push(`${f}: needs a real reason`);
    if (!existsSync(join(ROOT, f))) { problems.push(`${f}: missing`); continue; }
    if (legacyProblems(f, read(f)).length === 0) problems.push(`${f}: no legacy name any more; drop it from LEGACY_REPRO`);
  }
  assert.deepStrictEqual(problems, []);
});

await check('SELF-CHECK: the guard can fail, and lets a session tool and a compact call pass', () => {
  const stray = legacyProblems('tests/manual/runner.js', "await callTool('actual_accounts_list', {});\n");
  assert.strictEqual(stray.length, 1, JSON.stringify(stray));
  assert.ok(/runner\.js:1: legacy tool name actual_accounts_list/.test(stray[0]), stray[0]);
  assert.deepStrictEqual(legacyProblems('x.js', "await callTool('actual_session_list', {});\n"), []);
  assert.deepStrictEqual(legacyProblems('x.js', "await callTool('list_entities', { type: 'account' });\n"), []);
});

// ---- 2. every call reaches the intended legacy tool ------------------------------------------

const ID = '00000000-0000-4000-8000-000000000001';

/** Run one compact call; return what the legacy layer saw. */
async function reach(call) {
  const seen = [];
  const callTool = viaCompact(async (name, args) => { seen.push({ name, args }); return { result: [] }; });
  await callTool(...call);
  return seen;
}

const EXPECT_REMOVE = {
  transaction: 'actual_transactions_delete',
  tag: 'actual_tags_delete',
  rule: 'actual_rules_delete',
  schedule: 'actual_schedules_delete',
  payee: 'actual_payees_delete',
  category: 'actual_categories_delete',
  group: 'actual_category_groups_delete',
  account: 'actual_accounts_delete',
  accountClose: 'actual_accounts_close',
};

await check('REMOVE has a row for every kind this test expects, and no other', () => {
  assert.deepStrictEqual(Object.keys(REMOVE).sort(), Object.keys(EXPECT_REMOVE).sort());
});

for (const [kind, legacyName] of Object.entries(EXPECT_REMOVE)) {
  await check(`remove(${kind}) reaches ${legacyName} with the id`, async () => {
    const seen = [];
    const callTool = viaCompact(async (name, args) => { seen.push({ name, args }); return { success: true }; });
    await remove(callTool, kind, ID);
    assert.strictEqual(seen.length, 1, JSON.stringify(seen));
    assert.strictEqual(seen[0].name, legacyName);
    assert.strictEqual(seen[0].args.id, ID, JSON.stringify(seen[0].args));
  });
}

await check('a delete without its id, a category delete without `entity`, and a non-UUID id are refused', async () => {
  const callTool = viaCompact(async () => ({ success: true }));
  await assert.rejects(() => callTool('manage_payees', { action: 'delete' }));
  await assert.rejects(() => callTool('manage_categories', { action: 'delete', id: ID }));
  await assert.rejects(() => callTool('manage_payees', { action: 'delete', id: 'not-a-uuid' }));
});

const EXPECT_LIST = {
  account: 'actual_accounts_list',
  payee: 'actual_payees_get',
  category: 'actual_categories_get',
  category_group: 'actual_category_groups_get',
  rule: 'actual_rules_get',
  schedule: 'actual_schedules_get',
  tag: 'actual_tags_list',
};

await check('LISTING_TYPES is exactly the seven listings the sweep reads', () => {
  assert.deepStrictEqual([...LISTING_TYPES].sort(), Object.keys(EXPECT_LIST).sort());
});

for (const [type, legacyName] of Object.entries(EXPECT_LIST)) {
  await check(`listCall(${type}) reaches ${legacyName}, with no paging argument`, async () => {
    const seen = await reach(listCall(type));
    assert.strictEqual(seen.length, 1, JSON.stringify(seen));
    assert.strictEqual(seen[0].name, legacyName);
    assert.ok(!('limit' in seen[0].args) && !('offset' in seen[0].args), `paged: ${JSON.stringify(seen[0].args)}`);
    assert.ok(listingLabel(type).includes(type));
  });
}

await check('budgetFilesCall reaches the server budget listing', async () => {
  const seen = await reach(budgetFilesCall());
  assert.strictEqual(seen.length, 1, JSON.stringify(seen));
  assert.strictEqual(seen[0].name, 'actual_budgets_get_all');
});

await check('accountTransactionsCall reaches the transactions listing for that account, unlimited', async () => {
  const seen = await reach(accountTransactionsCall(ID));
  assert.strictEqual(seen.length, 1, JSON.stringify(seen));
  assert.strictEqual(seen[0].name, 'actual_transactions_get');
  assert.strictEqual(seen[0].args.accountId, ID);
  assert.ok(!('limit' in seen[0].args), JSON.stringify(seen[0].args));
});

await check('a legacy name is refused by the compact client, as on a compact server', async () => {
  const callTool = viaCompact(async () => ({}));
  await assert.rejects(() => callTool('actual_accounts_list', {}), /not available/);
});

// ---- 3. the listing keys ---------------------------------------------------------------------

await check('LISTING_KEY names the own-key listings and only those', () => {
  assert.deepStrictEqual(LISTING_KEY, { category_group: 'groups', rule: 'rules', schedule: 'schedules' });
});

console.log(`\n[manual-support-compact] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
