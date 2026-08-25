// tests/unit/payees_merge.test.js
// #356: actual_payees_merge must refuse a merge Actual would silently ignore, and must
// report the ids it actually merged rather than the count of what was requested.
//
// Upstream db.mergePayees:
//   if (payees[target].transfer_acct != null) { return; }        // whole call is a no-op
//   ids = ids.filter(id => payees[id].transfer_acct == null);    // sources silently dropped
// and it indexes payees[id] directly, so an unknown id throws
// "Cannot read properties of undefined (reading 'transfer_acct')".

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ✓ ${label}`);
const fail = (label, d = '') => { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);

  // getPayees returns transfer payees too, with `name` already COALESCEd to the owning
  // account's name. That is what makes a useful refusal message possible without a
  // second lookup.
  let payees = [];
  let mergeCalls = 0;
  let lastMergeArgs = null;
  apiDefault.getPayees = async () => payees;
  apiDefault.mergePayees = async (targetId, mergeIds) => {
    mergeCalls++;
    lastMergeArgs = [targetId, [...mergeIds]];
  };

  // The trailing sync in processWriteQueue must be a no-op, and the real init /
  // downloadBudget / shutdown must be disarmed, or the write queue tries to reach a
  // live Actual server. `_setSkipApiInitForTests` is the seam
  // tests/unit/adapter_with_write_session.test.js already uses for this.
  apiDefault.sync = async () => {};

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/payees_merge.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);

  // Note what this test is deliberately NOT doing: it does not stub
  // adapter.mergePayees. The guard under test lives in the adapter, so stubbing it
  // would make every assertion below vacuous. tests/unit/payees_delete.test.js stubs
  // the adapter method and therefore never exercises its pre-flight at all.

  const NORMAL_A = { id: 'p-normal-a', name: 'Kroger', transfer_acct: null };
  const NORMAL_B = { id: 'p-normal-b', name: 'Kroger Inc', transfer_acct: null };
  const TRANSFER = { id: 'p-transfer', name: 'Savings', transfer_acct: 'acct-savings' };

  const reset = (list) => { payees = list; mergeCalls = 0; lastMergeArgs = null; };

  console.log('\n[#356] payees_merge: positive, two normal payees');
  {
    reset([NORMAL_A, NORMAL_B]);
    const res = await tool.call({ targetId: 'p-normal-a', mergeIds: ['p-normal-b'] });
    check(res?.success === true,                          'returns success: true');
    check(Array.isArray(res?.mergedIds),                  'reports mergedIds');
    check(res?.mergedIds?.[0] === 'p-normal-b',           'mergedIds names the merged payee');
    check(res?.message?.includes('p-normal-b'),           'message names what was merged');
    check(mergeCalls === 1,                               'raw mergePayees called exactly once');
    check(lastMergeArgs?.[0] === 'p-normal-a',            'target forwarded unchanged');
    check(lastMergeArgs?.[1]?.[0] === 'p-normal-b',       'sources forwarded unchanged');
  }

  console.log('\n[#356] payees_merge: NEGATIVE, target is a transfer payee');
  {
    reset([NORMAL_A, TRANSFER]);
    let threw = null;
    try { await tool.call({ targetId: 'p-transfer', mergeIds: ['p-normal-a'] }); } catch (e) { threw = e; }
    check(threw instanceof Error,                            'throws instead of reporting success');
    check(!!threw && /transfer/i.test(threw.message),         'error says transfer payee');
    check(!!threw && threw.message.includes('Savings'),       'error names the payee (account name)');
    check(mergeCalls === 0,                                   'raw mergePayees NOT called');
  }

  console.log('\n[#356] payees_merge: NEGATIVE, a source is a transfer payee');
  {
    reset([NORMAL_A, NORMAL_B, TRANSFER]);
    let threw = null;
    try { await tool.call({ targetId: 'p-normal-a', mergeIds: ['p-normal-b', 'p-transfer'] }); } catch (e) { threw = e; }
    check(threw instanceof Error,                             'throws instead of silently dropping it');
    check(!!threw && /transfer/i.test(threw.message),          'error says transfer payee');
    check(!!threw && threw.message.includes('Savings'),        'error names the offending payee');
    check(mergeCalls === 0,                                    'raw mergePayees NOT called');
  }

  console.log('\n[#356] payees_merge: NEGATIVE, unknown id gives a clean not-found');
  {
    reset([NORMAL_A]);
    let threw = null;
    try { await tool.call({ targetId: 'p-normal-a', mergeIds: ['p-ghost'] }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                     'throws');
    check(!!threw && /not found/i.test(threw.message),                 'error says not found');
    check(!!threw && threw.message.includes('actual_payees_get'),      'error names the listing tool');
    check(!!threw && !/Cannot read properties/i.test(threw.message),
          'error is NOT the raw upstream TypeError');
    check(mergeCalls === 0,                                            'raw mergePayees NOT called');
  }

  console.log('\n[#356] payees_merge: NEGATIVE, unknown target');
  {
    reset([NORMAL_A]);
    let threw = null;
    try { await tool.call({ targetId: 'p-ghost', mergeIds: ['p-normal-a'] }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                 'throws');
    check(!!threw && /not found/i.test(threw.message),             'error says not found');
    check(mergeCalls === 0,                                        'raw mergePayees NOT called');
  }

  console.log('\n[#356] payees_merge: NEGATIVE, target also listed as a source');
  {
    reset([NORMAL_A, NORMAL_B]);
    let threw = null;
    try { await tool.call({ targetId: 'p-normal-a', mergeIds: ['p-normal-a'] }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws when target appears in mergeIds');
    check(mergeCalls === 0,       'raw mergePayees NOT called');
  }

  console.log('\n[#356] payees_merge: schema bounds');
  {
    reset([NORMAL_A, NORMAL_B]);
    let threw = null;
    try { await tool.call({ targetId: 'p-normal-a', mergeIds: [] }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects an empty mergeIds array');

    reset([NORMAL_A, NORMAL_B]);
    threw = null;
    try { await tool.call({ targetId: 'x'.repeat(65), mergeIds: ['p-normal-b'] }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects an over-long id (unbounded echo guard)');

    reset([NORMAL_A, NORMAL_B]);
    threw = null;
    try { await tool.call({ targetId: 'p-normal-a', mergeIds: new Array(201).fill('p-normal-b') }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects more than 200 merge sources');
    check(mergeCalls === 0,       'no write attempted on any Zod failure');
  }

  console.log('');
  if (failures === 0) console.log('[#356] All payees_merge tests passed ✓');
  else { console.error(`[#356] ${failures} test(s) FAILED`); process.exit(2); }
})();
