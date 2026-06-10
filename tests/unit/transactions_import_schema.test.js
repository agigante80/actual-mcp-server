// tests/unit/transactions_import_schema.test.js  (#217)
// Pins the published input-schema CONTRACT for actual_transactions_import (the thing
// schema-driven MCP clients consume), which the old `txs: z.unknown()` broke by publishing
// an empty `{}`. Asserts the typed-array shape, the open item (extra fields allowed), and the
// actionable validation errors for the failure modes.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const ok = (cond, l, d = '') => (cond ? pass(l) : fail(l, d));
const eq = (g, w, l) => ok(g === w, l, `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const { z } = await import('zod');
  const tool = (await import('../../dist/src/tools/transactions_import.js')).default;

  console.log('\n[#217] published tools/list schema is a typed array (was {} before)');
  const js = z.toJSONSchema(tool.inputSchema);
  const txs = js.properties.txs;
  eq(txs.type, 'array', 'txs is published as type "array" (regression: was a shapeless {})');
  ok(Array.isArray(txs.items?.required) && txs.items.required.includes('date') && txs.items.required.includes('amount'),
    'each txs item requires date and amount', JSON.stringify(txs.items?.required));
  ok((js.required || []).includes('accountId') && (js.required || []).includes('txs'),
    'accountId and txs are required at the top level', JSON.stringify(js.required));
  ok(txs.items?.additionalProperties !== false, 'item schema is OPEN (extra Actual fields not rejected)');

  console.log('\n[#217] InputSchema.parse: positive (incl. extra fields) and negatives');
  {
    const valid = { accountId: '00000000-0000-0000-0000-000000000001', txs: [{ date: '2024-01-15', amount: -1234, imported_id: 'x1', subtransactions: [{ amount: -1234 }], transfer_id: 't1' }] };
    const r = tool.inputSchema.safeParse(valid);
    ok(r.success, 'a valid array with EXTRA item fields (subtransactions/transfer_id) is accepted');
    ok(r.success && r.data.txs[0].subtransactions, 'the extra fields are passed through (loose object)');
    ok(!tool.inputSchema.safeParse({ accountId: '00000000-0000-0000-0000-000000000001', txs: [{ amount: 100 }] }).success, 'item without date is rejected');
    ok(!tool.inputSchema.safeParse({ accountId: '00000000-0000-0000-0000-000000000001', txs: [] }).success, 'empty txs array is rejected');
    ok(!tool.inputSchema.safeParse({ txs: [{ date: '2024-01-15', amount: 1 }] }).success, 'missing accountId is rejected');
    ok(!tool.inputSchema.safeParse({ accountId: '00000000-0000-0000-0000-000000000001' }).success, 'missing txs is rejected');
    ok(!tool.inputSchema.safeParse({ accountId: '00000000-0000-0000-0000-000000000001', txs: 'not-an-array' }).success, 'string txs is rejected (was accepted by z.unknown)');
  }

  console.log('\n[#217] actionable errors via callTool (the #206 formatter, nested paths)');
  {
    const manager = (await import('../../dist/src/actualToolsManager.js')).default;
    await manager.initialize();
    const acct = '00000000-0000-0000-0000-000000000001';
    const call = async (args) => { try { await manager.callTool('actual_transactions_import', args); return null; } catch (e) { return e?.message ?? String(e); } };
    eq(await call({ accountId: acct, txs: [{ amount: 100 }] }),
      'Validation error: txs.0.date is required (Date in YYYY-MM-DD format)',
      'date-less item gives an actionable, path-qualified error (not the cryptic adapter throw)');
    eq(await call({ accountId: acct, txs: [] }),
      'Validation error: txs: must be at least 1 item', 'empty array gives an actionable error');
    eq(await call({ txs: [{ date: '2024-01-15', amount: 1 }] }),
      'Validation error: accountId is required (Destination account UUID to import into)', 'missing accountId is actionable');
  }

  console.log('');
  if (failures === 0) console.log('[#217] All transactions_import schema tests passed ✓');
  else { console.error(`[#217] ${failures} test(s) FAILED`); process.exit(2); }
})().catch((e) => { console.error('[#217] harness crashed:', e); process.exit(2); });
