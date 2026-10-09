// tests/unit/transactions_update_batch.test.js  (#517)
// actual_transactions_update_batch must report invalid input and whole-call failures
// as tool errors, not as a resolved result with failed: [{id: 'batch'}]. Per-item
// outcomes from the adapter must still resolve with the real ids.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'dummy';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const eq = (got, want, l) => got === want ? pass(l) : fail(l, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const ok = (cond, l, d = '') => cond ? pass(l) : fail(l, d);

const TOOL = 'actual_transactions_update_batch';
const ID1 = '50000000-0000-4000-8000-000000000001';
const ID2 = '50000000-0000-4000-8000-000000000002';
const HINT = '(Array of {id, fields} objects. Maximum 50 per batch (higher values risk timeout).)';

(async () => {
  const manager = (await import('../../dist/src/actualToolsManager.js')).default;
  await manager.initialize();
  const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
  const original = adapter.updateTransactionBatch;

  // Resolves to { result } or { error } so each case can assert which one it got.
  const call = async (args) => {
    try { return { result: await manager.callTool(TOOL, args) }; }
    catch (e) { return { error: e?.message ?? String(e) }; }
  };
  const rejectsWith = async (args, want, label) => {
    const r = await call(args);
    if (!('error' in r)) return fail(label, `resolved with ${JSON.stringify(r.result)}`);
    eq(r.error, want, label);
    ok(!r.error.includes('update_batch failed'), `${label}: no catch-all prefix`);
  };

  let adapterCalls = 0;
  adapter.updateTransactionBatch = async () => { adapterCalls++; return { succeeded: [], failed: [] }; };
  try {
    console.log('\n[#517] validation errors reject with the formatted message');
    await rejectsWith({ updates: 'not-an-array' },
      `Validation error: updates: expected array, received string ${HINT}`, 'updates not an array');
    await rejectsWith({}, `Validation error: updates is required ${HINT}`, 'updates missing');
    await rejectsWith({ updates: [] }, 'Validation error: updates: must be at least 1 item', 'updates empty');
    const fiftyOne = Array.from({ length: 51 }, (_, i) =>
      ({ id: `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`, fields: { notes: 'x' } }));
    await rejectsWith({ updates: fiftyOne }, 'Validation error: updates: must be at most 50 items', '51 items');
    await rejectsWith({ updates: [{ id: 'not-a-uuid', fields: {} }] },
      'Validation error: updates.0.id: Invalid transaction ID format (expected UUID)', 'non-UUID id');
    eq(adapterCalls, 0, 'adapter never called for invalid input');

    console.log('\n[#517] a whole-call failure rejects, unwrapped');
    adapter.updateTransactionBatch = async () => { throw new Error('No budget selected for this session'); };
    {
      const r = await call({ updates: [{ id: ID1, fields: { notes: 'x' } }] });
      ok('error' in r, 'adapter rejection surfaces as a tool error', JSON.stringify(r.result));
      ok(r.error?.includes('No budget selected for this session'), 'original message kept', r.error);
      ok(!r.error?.includes('update_batch failed'), 'no catch-all prefix', r.error);
    }

    console.log('\n[#521] an infrastructure abort from the adapter surfaces as a tool error');
    adapter.updateTransactionBatch = async () => {
      throw new Error(`Transaction batch aborted after 1 of 3 items (applied: ${ID1}; failed before the abort: none; outcome unknown: ${ID2}; not attempted: 1): read ECONNRESET. Read back with actual_transactions_get before retrying.`);
    };
    {
      const r = await call({ updates: [{ id: ID1, fields: { notes: 'x' } }, { id: ID2, fields: { notes: 'y' } }] });
      ok('error' in r, 'abort surfaces as a tool error', JSON.stringify(r.result));
      ok(r.error?.includes('Transaction batch aborted'), 'abort text kept', r.error);
      ok(r.error?.includes('actual_transactions_get before retrying'), 'read-back advice kept', r.error);
    }

    console.log('\n[#517] per-item outcomes still resolve with real ids');
    const notFound = `Transaction "${ID2}" not found. Use actual_transactions_get to list transactions.`;
    adapter.updateTransactionBatch = async () => ({ succeeded: [{ id: ID1 }], failed: [{ id: ID2, error: notFound }] });
    {
      const r = await call({ updates: [{ id: ID1, fields: { notes: 'a' } }, { id: ID2, fields: { notes: 'b' } }] });
      ok('result' in r, 'partial failure resolves', r.error);
      eq(r.result?.total, 2, 'total 2');
      eq(r.result?.successCount, 1, 'successCount 1');
      eq(r.result?.failureCount, 1, 'failureCount 1');
      eq(r.result?.failed?.[0]?.id, ID2, 'failed item carries the real id, not "batch"');
    }
  } finally {
    adapter.updateTransactionBatch = original;
  }

  console.log(failures ? `\n${failures} failure(s)` : '\nAll transactions_update_batch tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
