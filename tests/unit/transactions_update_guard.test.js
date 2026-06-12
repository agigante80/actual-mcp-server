// tests/unit/transactions_update_guard.test.js
// Regression test for #212: adapter.updateTransaction and updateTransactionBatch must
// reject a non-existent transaction id (the raw API silently no-ops, which would be
// reported as success). Mirrors the deleteTransaction guard from #211.
//
// Exercises the REAL adapter methods offline: init/shutdown are disarmed via
// _setSkipApiInitForTests, and the raw runQuery / updateTransaction functions are
// stubbed so we control which ids "exist".

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const NIL = '00000000-0000-0000-0000-000000000000';

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  // Controllable raw-function stubs (must be installed BEFORE the adapter imports them).
  let existingIds = new Set();   // which ids the existence query "finds"
  let updateCalls = [];          // ids passed to rawUpdateTransaction
  let runQueryCalls = 0;
  apiDefault.runQuery = async (_query) => { runQueryCalls++; return { data: [...existingIds].map((id) => ({ id })) }; };
  apiDefault.updateTransaction = async (id, _fields) => { updateCalls.push(id); };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);

  const reset = (ids) => { existingIds = new Set(ids); updateCalls = []; runQueryCalls = 0; };

  console.log('\n[#212] updateTransaction: existing id is updated');
  {
    reset(['t-1']);
    await adapter.updateTransaction('t-1', { notes: 'ok' });
    check(updateCalls.length === 1 && updateCalls[0] === 't-1', 'rawUpdateTransaction called for the existing id');
  }

  console.log('\n[#212] updateTransaction: missing id throws not-found, no update');
  {
    reset([]);
    let threw = null;
    try { await adapter.updateTransaction(NIL, { notes: 'bad' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                  'throws on missing id');
    check((threw?.message || '').includes('not found'),           'message says not found');
    check((threw?.message || '').includes('actual_transactions_get'), 'message names the list tool');
    check(updateCalls.length === 0,                               'rawUpdateTransaction NOT called');
  }

  console.log('\n[#212] updateTransactionBatch: valid + missing, one existence query');
  {
    reset(['t-1']); // only t-1 exists
    const res = await adapter.updateTransactionBatch([
      { id: 't-1', fields: { notes: 'ok' } },
      { id: NIL, fields: { notes: 'bad' } },
    ]);
    check(res.succeeded.length === 1 && res.succeeded[0].id === 't-1', 'valid id in succeeded');
    check(res.failed.length === 1 && res.failed[0].id === NIL,         'missing id in failed');
    check((res.failed[0]?.error || '').includes('not found'),          'failed entry carries not-found message');
    check(updateCalls.length === 1 && updateCalls[0] === 't-1',        'rawUpdateTransaction called only for the valid id');
    check(runQueryCalls === 1,                                         'exactly ONE existence query for the whole batch (no N-queries)');
  }

  console.log('\n[#212] updateTransactionBatch: all-missing batch');
  {
    reset([]); // nothing exists
    const res = await adapter.updateTransactionBatch([
      { id: NIL, fields: { notes: 'a' } },
      { id: 'also-missing', fields: { notes: 'b' } },
    ]);
    check(res.succeeded.length === 0,                                  'no successes');
    check(res.failed.length === 2,                                     'both ids in failed');
    check(res.failed.every((f) => (f.error || '').includes('not found')), 'each failed entry is not-found');
    check(updateCalls.length === 0,                                    'rawUpdateTransaction never called');
    check(runQueryCalls === 1,                                         'still exactly one existence query');
  }

  console.log('\n[#212] updateTransactionBatch: empty batch is a no-op (no query)');
  {
    reset([]);
    const res = await adapter.updateTransactionBatch([]);
    check(res.succeeded.length === 0 && res.failed.length === 0,       'returns empty succeeded/failed');
    check(runQueryCalls === 0,                                         'no existence query for an empty batch');
    check(updateCalls.length === 0,                                    'no update calls');
  }

  console.log('');
  if (failures === 0) console.log('[#212] All transactions_update guard tests passed ✓');
  else { console.error(`[#212] ${failures} test(s) FAILED`); process.exit(2); }
})();
