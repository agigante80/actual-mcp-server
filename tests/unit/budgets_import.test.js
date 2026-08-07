// tests/unit/budgets_import.test.js
//
// #334: unit tests for actual_budgets_import.
//
// This is the most side-effecting tool in the set: upstream importBudget creates a
// budget file AND loads it, so the session's active budget changes and the new
// budget is outside the BUDGET_N_* registry. The tests below therefore assert on
// three things beyond the happy path:
//
//   1. The exactly-one-of path/base64 contract, in both failing directions. A
//      schema that accepted both would silently pick one and ignore the other.
//   2. That base64 is decoded to real bytes and handed to the adapter as a
//      Uint8Array, not forwarded as a string (a string means "filesystem path" to
//      upstream, so getting this wrong would try to open a file named after the
//      base64 blob).
//   3. That the result MESSAGE tells the caller the active budget changed. That
//      warning is the only thing standing between an assistant and silently
//      operating on the wrong budget for the rest of the session.
//
// Run: node tests/unit/budgets_import.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const NEW_ID = '00000000-0000-0000-0000-0000000000ee';
// "PK\x03\x04" plus filler, base64-encoded: a plausible zip prefix.
const PAYLOAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const PAYLOAD_B64 = PAYLOAD.toString('base64');

(async () => {
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/budgets_import.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;
  const orig = adapter.importBudget;

  let seen = null;
  adapter.importBudget = async (input, opts) => { seen = { input, opts }; return { id: NEW_ID }; };

  console.log('\n[budgets_import] positive: a path is forwarded to the adapter unchanged');
  {
    seen = null;
    const r = (await tool.call({ path: './actual-data/exports/backup.zip' }))?.result;
    check(typeof seen?.input === 'string', 'the adapter receives a STRING for a path source');
    check(seen?.input === './actual-data/exports/backup.zip', 'the path is forwarded verbatim');
    check(seen?.opts?.type === 'actual', 'type defaults to "actual"');
    check(!('filename' in (seen?.opts ?? {})), 'filename is omitted when the caller did not supply one');
    check(r?.success === true, 'success is true');
    check(r?.budgetId === NEW_ID, 'the new budget id is returned');
    check(r?.source === 'path', 'source is reported as "path"');
  }

  console.log('\n[budgets_import] positive: base64 is DECODED to bytes, not forwarded as a string');
  {
    seen = null;
    const r = (await tool.call({ base64: PAYLOAD_B64 }))?.result;
    check(seen?.input instanceof Uint8Array, 'the adapter receives a Uint8Array, not a string');
    check(seen?.input?.length === PAYLOAD.length, `decoded length matches (${seen?.input?.length} vs ${PAYLOAD.length})`);
    check(Buffer.compare(Buffer.from(seen.input), PAYLOAD) === 0, 'decoded bytes are byte-identical to the original payload');
    check(r?.source === 'base64', 'source is reported as "base64"');
  }

  console.log('\n[budgets_import] positive: type and filename are forwarded');
  {
    seen = null;
    await tool.call({ base64: PAYLOAD_B64, type: 'ynab5', filename: 'my-ynab.zip' });
    check(seen?.opts?.type === 'ynab5', 'type ynab5 forwarded');
    check(seen?.opts?.filename === 'my-ynab.zip', 'filename forwarded when supplied');

    seen = null;
    await tool.call({ path: '/tmp/x.zip', type: 'ynab4' });
    check(seen?.opts?.type === 'ynab4', 'type ynab4 forwarded');
  }

  console.log('\n[budgets_import] positive: the result WARNS that the active budget changed');
  {
    const r = (await tool.call({ path: '/tmp/x.zip' }))?.result;
    const m = String(r?.message ?? '');
    check(/active/i.test(m), 'message says the budget is now active');
    check(/actual_budgets_switch/.test(m), 'message points at actual_budgets_switch to get back');
    check(m.includes(NEW_ID), 'message includes the new budget id');
  }

  console.log('\n[budgets_import] negative: the exactly-one-of contract');
  {
    let both = false;
    try { tool.inputSchema.parse({ path: '/tmp/a.zip', base64: PAYLOAD_B64 }); } catch (_) { both = true; }
    check(both, 'supplying BOTH path and base64 is rejected');

    let neither = false;
    try { tool.inputSchema.parse({}); } catch (_) { neither = true; }
    check(neither, 'supplying NEITHER path nor base64 is rejected');

    let typeOnly = false;
    try { tool.inputSchema.parse({ type: 'actual' }); } catch (_) { typeOnly = true; }
    check(typeOnly, 'a type with no source is rejected');
  }

  console.log('\n[budgets_import] negative: malformed inputs are rejected by the schema');
  {
    const BAD = [
      [{ base64: 'not valid base64!' }, 'base64 with invalid characters'],
      [{ base64: 'AAAA===' }, 'base64 with over-long padding'],
      [{ base64: '' }, 'empty base64'],
      [{ path: '' }, 'empty path'],
      [{ path: 'a'.repeat(4097) }, 'path over the 4096-character bound'],
      [{ path: '/tmp/a.zip', type: 'YNAB5' }, 'uppercase type (the union is lowercase)'],
      [{ path: '/tmp/a.zip', type: 'quicken' }, 'unsupported type'],
      [{ path: '/tmp/a.zip', overwrite: true }, 'unknown key (strict schema)'],
      [{ path: '/tmp/a.zip', filename: 'a'.repeat(121) }, 'filename over the 120-character bound'],
    ];
    for (const [input, why] of BAD) {
      let rejected = false;
      try { tool.inputSchema.parse(input); } catch (_) { rejected = true; }
      check(rejected, `schema rejects ${why}`);
    }
  }

  console.log('\n[budgets_import] negative: base64 that decodes to zero bytes is caught before the adapter');
  {
    // A single base64 character is syntactically valid but carries no complete
    // byte, so Buffer.from() returns an empty buffer. Without the explicit guard
    // this would reach upstream as a zero-byte zip and fail with a far vaguer error.
    seen = null;
    let threw = null;
    try { await tool.call({ base64: 'A' }); } catch (err) { threw = err; }
    check(threw instanceof Error, 'a zero-byte decode throws');
    check(/zero bytes/i.test(threw?.message ?? ''), 'the message names the problem');
    check(seen === null, 'the adapter was never called');
  }

  console.log('\n[budgets_import] negative: an adapter failure propagates unchanged');
  {
    adapter.importBudget = async () => { throw new Error('Error importing budget: invalid-zip-file'); };
    let threw = null;
    try { await tool.call({ path: '/tmp/broken.zip' }); } catch (err) { threw = err; }
    check(threw instanceof Error, 'the error is re-thrown');
    check(/invalid-zip-file/.test(threw?.message ?? ''), 'the upstream message is preserved');
  }

  console.log('\n[budgets_import] metadata');
  {
    check(tool.name === 'actual_budgets_import', 'tool name matches the registry entry');
    check(/active budget/i.test(tool.description), 'the description warns about the active-budget side effect');
  }

  adapter.importBudget = orig;

  console.log('');
  if (failures === 0) console.log('[budgets_import] All tests passed');
  else { console.error(`[budgets_import] ${failures} test(s) FAILED`); process.exit(2); }
})();
