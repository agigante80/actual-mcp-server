// tests/unit/transactions_merge_adapter.test.js
// #514: adapter.mergeTransactions pre-flight refusals and the raw call shape.
//
// Upstream mergeTransactions(ids: [string, string]) takes PLAIN STRING ids and returns the id of
// the KEPT transaction. The `{ id }[]` form belongs to the internal handler and throws
// "Invalid field type [object Object]" through the public API, so the happy path asserts the
// exact plain tuple with deepEqual. The raw layer is stubbed; the guards under test live in the
// adapter, so the adapter method itself is NOT stubbed.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

import assert from 'node:assert/strict';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACCT1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCT2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  let rows = [];
  let mergeCalls = [];
  let mergeReturn = B;
  // The stub returns only the columns the query selects, as the real server does, so
  // dropping a column a guard reads (transfer_id, #794) turns its cases red.
  apiDefault.runQuery = async (query) => {
    const cols = query?.state?.selectExpressions;
    if (!Array.isArray(cols) || cols.length === 0 || cols.includes('*')) return { data: rows };
    return { data: rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]]))) };
  };
  apiDefault.mergeTransactions = async (...args) => { mergeCalls.push(args); return mergeReturn; };
  apiDefault.sync = async () => {};

  const [adapterMod, errors] = await Promise.all([
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  const adapter = adapterMod.default;

  const row = (id, o = {}) => ({ id, account: ACCT1, amount: -1000, parent_id: null, is_child: false, ...o });
  const reset = (list, ret = B) => { rows = list; mergeCalls = []; mergeReturn = ret; };
  const refusal = async (ids) => adapter.mergeTransactions(ids).then(() => null, (e) => e);

  console.log('\n[#514] mergeTransactions: happy path');
  {
    reset([row(A), row(B)], B);
    const res = await adapter.mergeTransactions([A, B]);
    check(mergeCalls.length === 1, 'raw merge called exactly once');
    try { assert.deepEqual(mergeCalls[0], [[A, B]]); pass('raw merge got the plain string tuple'); }
    catch (e) { fail('raw merge got the plain string tuple', e.message); }
    check(res.keptId === B && res.deletedId === A, 'keptId is the returned id (second), deletedId the other', JSON.stringify(res));

    reset([row(A), row(B)], A);
    const res2 = await adapter.mergeTransactions([A, B]);
    check(res2.keptId === A && res2.deletedId === B, 'keptId is the returned id (first), deletedId the other', JSON.stringify(res2));
  }

  console.log('\n[#514] mergeTransactions: pre-flight refusals never reach the raw call');
  {
    reset([row(A)]);
    let e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && e instanceof errors.NotFoundRefusal, 'missing id is a NotFoundRefusal', String(e));
    check(e && e.message.includes(B) && e.message.includes('actual_transactions_get'), 'not-found names the missing id and the get tool', e?.message);
    check(mergeCalls.length === 0, 'not found: raw merge not called');

    reset([row(A), row(B, { account: ACCT2 })]);
    e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && e instanceof errors.OutOfRangeRefusal, 'different accounts is an OutOfRangeRefusal', String(e));
    check(e && e.message.includes(ACCT1) && e.message.includes(ACCT2), 'accounts message names both accounts', e?.message);
    check(mergeCalls.length === 0, 'different accounts: raw merge not called');

    reset([row(A), row(B, { amount: -1200 })]);
    e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && e instanceof errors.OutOfRangeRefusal, 'different amounts is an OutOfRangeRefusal', String(e));
    check(e && e.message.includes('-1000') && e.message.includes('-1200'), 'amounts message names both amounts', e?.message);
    check(mergeCalls.length === 0, 'different amounts: raw merge not called');

    // The child shares account AND amount with the other id, so only our guard can refuse it.
    reset([row(A), row(B, { is_child: true, parent_id: A })]);
    e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && e instanceof errors.OutOfRangeRefusal, 'split child (is_child) is an OutOfRangeRefusal', String(e));
    check(e && /split child/i.test(e.message), 'split child message says so', e?.message);
    check(mergeCalls.length === 0, 'split child: raw merge not called');

    reset([row(A, { parent_id: B, is_child: false }), row(B)]);
    e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && /split child/i.test(e.message), 'split child (parent_id only) is refused', e?.message);
    check(mergeCalls.length === 0, 'parent_id child: raw merge not called');
  }

  console.log('\n[#794] mergeTransactions: a shared transfer counterpart is refused');
  {
    const X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const Y = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    reset([row(A, { transfer_id: X }), row(B, { transfer_id: X })]);
    let e = await refusal([A, B]);
    check(errors.isPreflightRefusal(e) && e instanceof errors.OutOfRangeRefusal, 'shared counterpart is an OutOfRangeRefusal', String(e));
    check(e && e.message.includes(A) && e.message.includes(B) && e.message.includes(X), 'message names both ids and the counterpart', e?.message);
    check(e && e.message.includes('would delete that counterpart') && e.message.includes('Nothing was changed'), 'message states the consequence', e?.message);
    check(mergeCalls.length === 0, 'shared counterpart: raw merge not called');

    reset([row(A, { transfer_id: X }), row(B, { transfer_id: Y })]);
    await adapter.mergeTransactions([A, B]);
    check(mergeCalls.length === 1, 'distinct counterparts still reach the raw merge');

    reset([row(A, { transfer_id: X }), row(B, { transfer_id: null })]);
    await adapter.mergeTransactions([A, B]);
    check(mergeCalls.length === 1, 'one transfer row plus one plain row still reaches the raw merge');

    reset([row(A, { transfer_id: null }), row(B, { transfer_id: null })]);
    await adapter.mergeTransactions([A, B]);
    check(mergeCalls.length === 1, 'two null transfer_id values are not shared');

    reset([row(A, { transfer_id: '' }), row(B, { transfer_id: '' })]);
    await adapter.mergeTransactions([A, B]);
    check(mergeCalls.length === 1, 'two empty-string transfer_id values are not shared');

    reset([row(A, { transfer_id: X }), row(B, { transfer_id: X, amount: -1200 })]);
    e = await refusal([A, B]);
    check(e && e.message.includes('different amounts'), 'different amounts is still reported before the shared counterpart', e?.message);
    reset([row(A, { transfer_id: X }), row(B, { transfer_id: X, account: ACCT2 })]);
    e = await refusal([A, B]);
    check(e && e.message.includes('different accounts'), 'different accounts is still reported before the shared counterpart', e?.message);
  }

  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll transactions_merge adapter tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
