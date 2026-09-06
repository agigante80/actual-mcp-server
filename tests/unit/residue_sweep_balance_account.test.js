// tests/unit/residue_sweep_balance_account.test.js
//
// #287: the integration residue sweep (tests/manual/residue.js sweepResidue) closed OPEN
// residue accounts with actual_accounts_close, which @actual-app/api rejects for a
// non-zero-balance account ("balance is non-zero: transferAccountId is required"). The
// failure was swallowed and the sweep printed an unconditional "Sweep removed N", so a
// balance-bearing account silently survived while the sweep claimed success, and the next
// run failed the zero-residue assertion.
//
// The fix: for each OPEN account, delete its transactions (zero the balance) then delete
// the account, falling back to close; and report honest { swept, failed } counts, never an
// unconditional success. sweepResidue takes an injectable callTool, so this is unit-testable
// with a mock, no live server.
//
// Run: node tests/unit/residue_sweep_balance_account.test.js

import assert from 'node:assert';
import { sweepResidue, assertNoResidue, EXIT_UNSAFE_BUDGET } from '../manual/residue.js';

const ACCT = 'MCP-Test-2026-07-10T20-46-50-942Z-Updated'; // matches TEST_OBJECT_RE (has a timestamp)
const ENV = { MCP_TEST_BUDGET_SYNC_ID: 'budget-x', MCP_ACTIVE_BUDGET_SYNC_ID: 'budget-x' };

// Build a mock callTool from a per-tool behavior map. Each behavior is a function
// (args) => result | throws. Records every call for assertions.
function makeMock(overrides = {}) {
  const calls = [];
  const base = {
    actual_accounts_list: () => ({ result: [{ id: 'a1', name: ACCT, closed: false }] }),
    actual_payees_get: () => [],
    actual_categories_get: () => [],
    actual_category_groups_get: () => [],
    actual_rules_get: () => [],
    actual_schedules_get: () => [],
    actual_transactions_get: () => ({ result: [{ id: 't1' }, { id: 't2' }] }),
    actual_transactions_delete: () => ({ success: true }),
    actual_accounts_delete: () => ({ success: true }),
    actual_accounts_close: () => ({ success: true }),
  };
  const behaviors = { ...base, ...overrides };
  const callTool = async (name, args) => {
    calls.push({ name, args });
    const b = behaviors[name];
    if (!b) return { result: [] };
    return b(args); // may throw (rejected promise) since callTool is async
  };
  return { callTool, calls };
}
const names = (calls) => calls.map((c) => c.name);
const throwsWith = (msg) => () => { throw new Error(msg); };

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label}: ${err.message}`); failed++; }
}

console.log('\n[residue-sweep-balance-account] #287 sweep removes balance-bearing accounts and reports honestly');

// Positive 1: transactions deleted, then account deleted; counted as removed.
await check('deletes the account transactions then the account (swept:1, failed:0)', async () => {
  const { callTool, calls } = makeMock();
  const res = await sweepResidue(callTool, ENV);
  assert.deepStrictEqual(res, { swept: 1, failed: 0, skipped: false });
  const seq = names(calls);
  const delTxns = calls.filter((c) => c.name === 'actual_transactions_delete').map((c) => c.args.id);
  assert.deepStrictEqual(delTxns, ['t1', 't2'], 'both transactions deleted');
  assert.ok(seq.indexOf('actual_accounts_delete') > seq.lastIndexOf('actual_transactions_delete'),
    'account deleted AFTER its transactions');
  assert.ok(!seq.includes('actual_accounts_close'), 'close not used when delete succeeds');
});

// Positive 1b: the LIVE callTool unwraps actual_transactions_get to a BARE ARRAY (via
// unwrapToolResult), not {result:[...]}. list() absorbs both; assert the production shape
// still drives the per-transaction deletes, so this test mirrors the real unwrap.
await check('handles the live bare-array transactions_get shape (production unwrap)', async () => {
  const { callTool, calls } = makeMock({ actual_transactions_get: () => [{ id: 't1' }, { id: 't2' }] });
  const res = await sweepResidue(callTool, ENV);
  assert.deepStrictEqual(res, { swept: 1, failed: 0, skipped: false });
  const delTxns = calls.filter((c) => c.name === 'actual_transactions_delete').map((c) => c.args.id);
  assert.deepStrictEqual(delTxns, ['t1', 't2'], 'both transactions deleted from the bare-array shape');
});

// Fallback 2: delete fails, close succeeds -> still counted as removed.
await check('falls back to close when actual_accounts_delete fails (swept:1, failed:0)', async () => {
  const { callTool, calls } = makeMock({ actual_accounts_delete: throwsWith('delete refused') });
  const res = await sweepResidue(callTool, ENV);
  assert.deepStrictEqual(res, { swept: 1, failed: 0, skipped: false });
  const closeCalls = calls.filter((c) => c.name === 'actual_accounts_close').map((c) => c.args.id);
  assert.deepStrictEqual(closeCalls, ['a1'], 'close fallback invoked for the account');
});

// Negative 3 (the regression, was RED): every removal path fails -> honest report, no
// unconditional success. Capture console.log to assert the summary is honest.
await check('reports failure honestly when the account cannot be removed (swept:0, failed:1, no false success)', async () => {
  const { callTool } = makeMock({
    actual_transactions_get: throwsWith('boom'),
    actual_accounts_delete: throwsWith('balance is non-zero: transferAccountId is required'),
    actual_accounts_close: throwsWith('balance is non-zero: transferAccountId is required'),
  });
  const logged = [];
  const orig = console.log;
  console.log = (...a) => logged.push(a.join(' '));
  let res;
  try { res = await sweepResidue(callTool, ENV); }
  finally { console.log = orig; }
  const out = logged.join('\n');
  assert.deepStrictEqual(res, { swept: 0, failed: 1, skipped: false });
  assert.ok(/account remove .*failed/.test(out), 'an explicit per-account failure line is printed');
  assert.ok(/could NOT be removed/.test(out), 'the summary flags that the budget is not clean');
  assert.ok(!/✓ Sweep removed 1 object/.test(out), 'MUST NOT print the unconditional success that hid #287');
});

// Guard 4a: no designated disposable budget -> skip, delete nothing.
await check('#280 guard: skips (deletes nothing) when MCP_TEST_BUDGET_SYNC_ID is unset', async () => {
  const { callTool, calls } = makeMock();
  const res = await sweepResidue(callTool, {});
  assert.deepStrictEqual(res, { swept: 0, failed: 0, skipped: true });
  assert.ok(!names(calls).some((n) => /delete|close/.test(n)), 'no destructive call was made');
});

// Guard 4b: designated budget does not match the loaded budget -> throws (code 4), deletes nothing.
await check('#280 guard: throws EXIT_UNSAFE_BUDGET when designated != active budget', async () => {
  const { callTool, calls } = makeMock();
  await assert.rejects(
    () => sweepResidue(callTool, { MCP_TEST_BUDGET_SYNC_ID: 'budget-x', MCP_ACTIVE_BUDGET_SYNC_ID: 'other' }),
    (err) => err.code === EXIT_UNSAFE_BUDGET,
  );
  assert.ok(!names(calls).some((n) => /delete|close/.test(n)), 'no destructive call before the guard threw');
});

// #451: tags are swept too. Added when the tags integration module was added, because a fixture
// the sweep cannot SEE is one the zero-residue assertion silently certifies as absent, which
// weakens the dual-transport release gate (#280) rather than merely leaving a stray row.
// A tag's word lives in `tag`, not `name`, so it needs its own predicate: a test that only
// checked the delete call would pass with the collection filter matching nothing.
await check('sweeps a test TAG, and matches on the `tag` field not `name`', async () => {
  const TAG = 'MCP-Test-tag-1783679144993';
  const { callTool, calls } = makeMock({
    actual_accounts_list: () => ({ result: [] }),
    actual_tags_list: () => ({ result: [
      { id: 'tag-1', tag: TAG },
      { id: 'tag-2', tag: 'groceries' },          // a REAL user tag: must never be touched
      { id: 'tag-3', name: TAG },                 // wrong field: must not be treated as a match
    ] }),
    actual_tags_delete: () => ({ success: true }),
  });
  await sweepResidue(callTool, ENV);
  const deletes = calls.filter((c) => c.name === 'actual_tags_delete');
  assert.strictEqual(deletes.length, 1, `expected exactly one tag delete, got ${deletes.length}`);
  assert.strictEqual(deletes[0].args.id, 'tag-1', 'the wrong tag was deleted');
});

await check('a budget with only a stray test tag is NOT reported clean', async () => {
  // residueCount must include tags, or the sweep prints "already clean" and returns without
  // deleting, which is the failure mode this whole section exists to prevent.
  const { callTool, calls } = makeMock({
    actual_accounts_list: () => ({ result: [] }),
    actual_tags_list: () => ({ result: [{ id: 'tag-1', tag: 'MCP-Test-tag-1783679144993' }] }),
    actual_tags_delete: () => ({ success: true }),
  });
  await sweepResidue(callTool, ENV);
  assert.ok(calls.some((c) => c.name === 'actual_tags_delete'), 'the stray tag was never swept');
});

// Review of #451 caught the failure LISTING omitting tags while residueCount included them, so a
// tag-only failure printed "1 object(s) left behind:" followed by nothing at all. A gate that
// fails without naming what failed is barely better than one that does not fail: this is the
// exact case that fired on the first live run of the tags module, and the operator would have
// been told a count and no name.
await check('a tag-only residue failure NAMES the tag it found', async () => {
  const TAG = 'MCP-Test-tag-1783679144993';
  const { callTool } = makeMock({
    actual_accounts_list: () => ({ result: [] }),
    actual_tags_list: () => ({ result: [{ id: 'tag-1', tag: TAG }] }),
  });
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let total;
  try {
    total = await assertNoResidue(callTool);
  } finally {
    console.log = origLog;
  }
  assert.strictEqual(total, 1, 'the tag must be counted as residue');
  const output = lines.join('\n');
  assert.ok(/left behind/.test(output), `expected a failure line, got:\n${output}`);
  assert.ok(output.includes(TAG), `the failure listing must name the tag, got:\n${output}`);
});

// The sweep PREVIEW is the other printer, and it had the same tag omission. The existing sweep
// case above exercises the line but asserts only on the recorded callTool calls, so deleting the
// preview line again would leave the sweep under-reporting what it is about to delete with every
// test still green. The preview exists to be READ before anything is destroyed, so its content
// is the assertion.
await check('the sweep preview names the tag it is about to delete', async () => {
  const TAG = 'MCP-Test-tag-1783679144993';
  const { callTool } = makeMock({
    actual_accounts_list: () => ({ result: [] }),
    actual_tags_list: () => ({ result: [{ id: 'tag-1', tag: TAG }] }),
    actual_tags_delete: () => ({ success: true }),
  });
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await sweepResidue(callTool, ENV);
  } finally {
    console.log = origLog;
  }
  const output = lines.join('\n');
  assert.ok(/Sweep preview/.test(output), `expected a preview, got:\n${output}`);
  assert.ok(output.includes(TAG), `the preview must name the tag it will delete, got:\n${output}`);
});

console.log(`\n[residue-sweep-balance-account] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
