// tests/unit/accounts_reopen.test.js
// #358: actual_accounts_reopen must refuse an id that is not an account, and must
// never let the raw reopen run for one.
//
// The bug this guards is not a mere false success. Upstream `reopenAccount` is a bare
// `db.update('accounts', {id, closed: 0})`, `db.update` sends CRDT messages, and the
// apply path INSERTs when the row was absent, so reopening an unknown id CREATES a
// nameless account that is visible in listings and syncs to other clients. The
// assertion that matters is therefore `rawReopenAccount` NOT being called.

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

  // getAccounts is called twice per successful call: once before the write and once
  // after, to verify the effect. The queue lets the test drive both independently.
  let accountsQueue = [];
  let getCalls = 0;
  let reopenCalls = 0;
  // #376: the witness samples the drain counter from INSIDE the raw stubs, which is what
  // distinguishes a read inside the drain from one before it. See helpers/write-cycle.mjs.
  let witness;
  apiDefault.getAccounts = async () => { witness?.noteRead();
    getCalls++;
    return accountsQueue.length > 1 ? accountsQueue.shift() : accountsQueue[0];
  };
  apiDefault.reopenAccount = async (_id) => { witness?.noteWrite(); reopenCalls++; };

  // #371 moved the guard into adapter.reopenAccount, so this exercises the REAL adapter
  // method. The raw api stubs above are installed BEFORE the adapter import on purpose:
  // actual-adapter.ts destructures them at module load.
  apiDefault.sync = async () => {};
  const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/accounts_reopen.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  witness = makeCycleWitness(adapterMod);

  const reset = (queue) => { accountsQueue = queue; getCalls = 0; reopenCalls = 0; witness.reset(); };

  console.log('\n[#358] accounts_reopen: positive, a closed account is reopened');
  {
    reset([
      [{ id: 'acct-1', name: 'Savings', closed: true }],   // before
      [{ id: 'acct-1', name: 'Savings', closed: false }],  // after
    ]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true,   'returns success: true');
    check(reopenCalls === 1,       'raw reopenAccount called exactly once');
    check(getCalls === 2,          'read before and verified after');
    // The #142 property, asserted for real. The previous sessionCalls check counted calls to
    // a pass-through stub, which proved nothing about the lock; this counts batches actually
    // dispatched by processWriteQueue.
    check(witness.sharedOneCycle(),
                                   'read, write and re-read shared ONE write-queue cycle');
  }

  console.log('\n[#358] accounts_reopen: positive, already open is a reported non-change');
  {
    // DELIBERATE REVERSAL, recorded so it is not re-litigated. This case previously
    // asserted `reopenCalls === 1`, on the reasoning that upstream's reopen is idempotent
    // so issuing it again is harmless. #369 item 5 established that it is not free:
    // upstream's reopen is a `db.update`, which in Actual is a CRDT MESSAGE that syncs to
    // every other client and bumps device state, for a change nobody made.
    //
    // Skipping the write is also the refusal taxonomy's rule 1 (the requested end state
    // already holds, so report SUCCESS naming the non-change) and it matches what
    // closeAccount has done with `already-closed` since #357.
    reset([
      [{ id: 'acct-1', name: 'Savings', closed: false }],
      [{ id: 'acct-1', name: 'Savings', closed: false }],
    ]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true,      'reopening an open account still succeeds');
    check(res?.alreadyOpen === true,  'and says so, rather than claiming it reopened anything');
    check(reopenCalls === 0,          'NO write is issued: a CRDT no-op still syncs to every client');
  }

  console.log('\n[#358] accounts_reopen: NEGATIVE, unknown id must not reach the write');
  {
    reset([[{ id: 'acct-1', name: 'Savings', closed: true }]]);
    let threw = null;
    try { await tool.call({ id: 'not-an-account' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                     'throws instead of reporting success');
    check(!!threw && /not found/i.test(threw.message),                'error says not found');
    check(!!threw && threw.message.includes('actual_accounts_list'),  'error names actual_accounts_list');
    check(!!threw && threw.message.includes('not-an-account'),        'error names the id');
    check(!!threw && /no transactions/i.test(threw.message),
          'error explains the close-removed-it case');
    check(reopenCalls === 0,
          'raw reopenAccount NOT called: this is what prevents the phantom account');
    check(getCalls === 1,     'refused after the pre-read, before any write');
  }

  console.log('\n[#358] accounts_reopen: NEGATIVE, the write had no effect');
  {
    reset([
      [{ id: 'acct-1', name: 'Savings', closed: true }],
      [{ id: 'acct-1', name: 'Savings', closed: true }],   // still closed afterwards
    ]);
    let threw = null;
    try { await tool.call({ id: 'acct-1' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                           'throws when the state did not change');
    check(!!threw && /still closed/i.test(threw.message),   'error says it is still closed');
    check(reopenCalls === 1,                                'the write was attempted');
  }

  console.log('\n[#358] accounts_reopen: schema rejection');
  {
    reset([[]]);
    let threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'throws on missing id');
    check(getCalls === 0,         'the adapter was never reached on a Zod failure');
    check(reopenCalls === 0,      'no write attempted on Zod failure');
  }

  console.log('');
  if (failures === 0) console.log('[#358] All accounts_reopen tests passed ✓');
  else { console.error(`[#358] ${failures} test(s) FAILED`); process.exit(2); }
})();
