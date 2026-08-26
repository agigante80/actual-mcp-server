// tests/unit/payees_delete.test.js
// Regression test: actual_payees_delete must route through the guarded
// adapter.deletePayee (pre-flight existence check), NOT the raw api.deletePayee,
// which throws a cryptic "Cannot destructure property 'transfer_acct' of null" on a
// non-existent id. adapter.deletePayee owns the single write-cycle (#142) and turns a
// missing id into an actionable "Payee not found" error.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  // #356: these raw stubs MUST be installed before the adapter module is imported.
  // actual-adapter.ts destructures the api functions at module load
  // (`const { getPayees: rawGetPayees } = api`), so a stub applied after the import is
  // captured by nobody and the real function runs.
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  let rawPayees = [];
  let rawDeleteCalls = 0;
  apiDefault.sync = async () => {};
  apiDefault.getPayees = async () => rawPayees;
  apiDefault.deletePayee = async () => { rawDeleteCalls++; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  const tool = (await import('../../dist/src/tools/payees_delete.js')).default;

  // Stub the guarded adapter method the tool now calls (property access at call time,
  // so reassignment is observed by the tool).
  let deleteCalls = 0;
  let lastId = null;
  let deleteThrows = null;
  const origDeletePayee = adapter.deletePayee;
  adapter.deletePayee = async (id) => { deleteCalls++; lastId = id; if (deleteThrows) throw deleteThrows; };

  const reset = () => { deleteCalls = 0; lastId = null; deleteThrows = null; };

  console.log('\npayees_delete: positive happy path');
  {
    reset();
    const res = await tool.call({ id: '11111111-1111-4111-8111-111111111111' });
    check(res?.success === true,    'returns success: true');
    check(deleteCalls === 1,        'adapter.deletePayee called exactly once');
    check(lastId === '11111111-1111-4111-8111-111111111111', 'called with the supplied id');
  }

  console.log('\npayees_delete: not-found / write-side error propagates as a throw');
  {
    reset();
    deleteThrows = new Error('Payee "p-missing" not found. Use actual_payees_get to list available payees.');
    let threw = null;
    try { await tool.call({ id: '22222222-2222-4222-8222-222222222222' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                'throws (does not swallow into success:false)');
    check(threw?.message?.includes('not found'), 'actionable not-found message');
    check(deleteCalls === 1,                     'adapter.deletePayee was attempted');
  }

  // ── #356: the adapter's OWN pre-flight, exercised for real ────────────────────
  // Everything above stubs adapter.deletePayee, so the guard inside it is never run.
  // These cases restore the real method and disarm the session instead, the seam
  // tests/unit/adapter_with_write_session.test.js uses, so the transfer-payee refusal
  // is actually tested rather than assumed.
  {
    adapter.deletePayee = origDeletePayee;

    adapterMod._setSkipApiInitForTests(true);

    console.log('\n[#356] payees_delete: NEGATIVE, a TRANSFER payee is refused');
    {
      // getPayees includes transfer payees and COALESCEs their name to the owning
      // account's name, which is why the message can name the account without a
      // second lookup.
      rawPayees = [{ id: '44444444-4444-4444-8444-444444444444', name: 'Savings', transfer_acct: 'acct-savings' }];
      rawDeleteCalls = 0;
      let threw = null;
      try { await tool.call({ id: '44444444-4444-4444-8444-444444444444' }); } catch (e) { threw = e; }
      check(threw instanceof Error,                                     'throws instead of reporting success');
      check(!!threw && /transfer/i.test(threw.message),                  'error says transfer payee');
      check(!!threw && threw.message.includes('Savings'),                'error names the owning account');
      check(!!threw && threw.message.includes('actual_accounts_delete'), 'error points at the account tool');
      check(rawDeleteCalls === 0,                                        'raw deletePayee NOT called');
    }

    console.log('\n[#356] payees_delete: positive, a normal payee still deletes');
    {
      rawPayees = [{ id: '55555555-5555-4555-8555-555555555555', name: 'Kroger', transfer_acct: null }];
      rawDeleteCalls = 0;
      const res = await tool.call({ id: '55555555-5555-4555-8555-555555555555' });
      check(res?.success === true, 'returns success: true');
      check(rawDeleteCalls === 1,  'raw deletePayee called exactly once');
    }

    console.log('\n[#356] payees_delete: NEGATIVE, unknown id is still a clean not-found');
    {
      rawPayees = [{ id: '55555555-5555-4555-8555-555555555555', name: 'Kroger', transfer_acct: null }];
      rawDeleteCalls = 0;
      let threw = null;
      try { await tool.call({ id: '66666666-6666-4666-8666-666666666666' }); } catch (e) { threw = e; }
      check(threw instanceof Error,                                'throws');
      check(!!threw && /not found/i.test(threw.message),            'actionable not-found message');
      check(!!threw && !/Cannot destructure/i.test(threw.message),  'not the raw upstream TypeError');
      check(rawDeleteCalls === 0,                                   'raw deletePayee NOT called');
    }

    // Put the stub back so the schema-rejection case below still counts calls.
    adapter.deletePayee = async (id) => { deleteCalls++; lastId = id; if (deleteThrows) throw deleteThrows; };
  }

  console.log('\npayees_delete: schema rejection');
  {
    reset();
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error,   'throws on missing id');
    check(deleteCalls === 0,        'adapter.deletePayee NOT called on Zod fail');
  }

  console.log('\n[#365] a non-UUID payee id is rejected at the SCHEMA, not by the adapter');
  {
    // Before #365 this tool took a bare bounded string, so 'not-a-uuid' parsed cleanly,
    // reached the adapter, and came back as "Payee not found" from a pre-flight READ.
    // Rejecting it at the boundary is both cheaper and a truer description of the
    // problem, and it makes payees_delete describe its id the same way payees_update
    // already did.
    reset();
    let threw = null;
    try { await tool.call({ id: 'not-a-uuid' }); } catch (e) { threw = e; }
    check(threw instanceof Error,      'a malformed id throws');
    check(/uuid/i.test(threw?.message ?? ''), 'and the message names the expected format');
    check(deleteCalls === 0,           'the adapter is never reached, so no read is paid for');
  }

  adapter.deletePayee = origDeletePayee;
  console.log('');
  if (failures === 0) console.log('All payees_delete tests passed ✓');
  else { console.error(`${failures} test(s) FAILED`); process.exit(2); }
})();
