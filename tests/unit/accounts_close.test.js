// tests/unit/accounts_close.test.js
// #357: actual_accounts_close had three defects on one code path.
//
//  (a) upstream returns silently for an unknown or already-closed account, so the tool
//      reported success for a close that never happened;
//  (b) upstream DELETES an account that has no transactions instead of closing it, while
//      the description promised the history was preserved;
//  (c) transferAccountId and transferCategoryId are documented parameters that the schema
//      did not accept, so an account with a non-zero balance could not be closed at all.

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

  // The tool reads before and after the write, so the fake serves a queue: the first
  // entry is the pre-read, the second the post-read.
  let accountsQueue = [];
  let closeCalls = 0;
  let lastCloseArgs = null;
  let closeThrows = null;
  let getCalls = 0;
  // #376: the witness samples the drain counter from INSIDE the raw stubs, which is what
  // distinguishes a read inside the drain from one before it. See helpers/write-cycle.mjs.
  let witness;
  apiDefault.getAccounts = async () => { witness?.noteRead();
    getCalls++;
    return accountsQueue.length > 1 ? accountsQueue.shift() : accountsQueue[0];
  };
  let categories = [{ id: '70000000-0000-4000-8000-000000000009', name: 'Misc' }];
  apiDefault.getCategories = async () => { witness?.noteRead(); return categories; };
  // #768: the balance read the pairing guard makes (upstream's all-dates sum of the account).
  let balance = 500;
  let balanceReads = 0;
  apiDefault.runQuery = async () => { witness?.noteRead(); balanceReads++; return { data: balance }; };
  let cutoffBalanceReads = 0;
  apiDefault.getAccountBalance = async () => { cutoffBalanceReads++; return 0; };
  apiDefault.closeAccount = async (id, transferAccountId, transferCategoryId) => { witness?.noteWrite();
    closeCalls++;
    lastCloseArgs = [id, transferAccountId, transferCategoryId];
    if (closeThrows) throw closeThrows;
  };

  // #371 moved the guard into adapter.closeAccount, so this test must exercise the REAL
  // adapter method. Stubbing adapter.closeAccount (or withWriteSession as a pass-through)
  // would stub away the thing under test. The raw api stubs above are installed BEFORE the
  // adapter import on purpose: actual-adapter.ts destructures them at module load.
  apiDefault.sync = async () => {};
  const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/accounts_close.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  adapterMod._setSkipApiInitForTests(true);
  witness = makeCycleWitness(adapterMod);

  const OPEN = { id: '60000000-0000-4000-8000-000000000001', name: 'Checking', closed: false };
  const CLOSED = { id: '60000000-0000-4000-8000-000000000001', name: 'Checking', closed: true };
  const DEST = { id: '60000000-0000-4000-8000-000000000002', name: 'Savings', closed: false };
  const OFF_DEST = { ...DEST, name: 'Mortgage', offbudget: true };
  const OFF_SRC = { ...OPEN, offbudget: true };
  const DEST_CLOSED = { id: '60000000-0000-4000-8000-000000000003', name: 'Old Savings', closed: true };

  const reset = (queue) => {
    accountsQueue = queue; balance = 500; balanceReads = 0; closeCalls = 0; lastCloseArgs = null; closeThrows = null; getCalls = 0;
    witness.reset();
  };

  console.log('\n[#357] accounts_close: positive, an account with transactions closes');
  {
    reset([[OPEN], [CLOSED]]);
    const res = await tool.call({ id: '60000000-0000-4000-8000-000000000001' });
    check(res?.success === true,             'returns success: true');
    check(res?.closed === true,              'reports that it is closed');
    check(closeCalls === 1,                  'raw closeAccount called exactly once');
    check(lastCloseArgs?.[1] === undefined,  'no transfer account passed when not supplied');
    check(getCalls === 2,                    'read before and verified after');
    // The #142 property asserted for real, not implied by a read count: one call must
    // dispatch exactly ONE write-queue batch.
    check(witness.sharedOneCycle(),
                          'read, write and re-read shared ONE write-queue cycle');
  }

  console.log('\n[#357] accounts_close: (b) a zero-transaction account is REMOVED, and says so');
  {
    // Upstream tombstones it, so it is simply gone from the post-read.
    reset([[OPEN], []]);
    const res = await tool.call({ id: '60000000-0000-4000-8000-000000000001' });
    check(res?.success === true,                        'still a success: the account is gone');
    check(res?.removed === true,                        'flags that it was removed, not closed');
    check(/REMOVED/i.test(res?.message ?? ''),          'message says removed');
    check(/no transactions/i.test(res?.message ?? ''),  'message explains why');
    check(/cannot be reopened/i.test(res?.message ?? ''), 'message warns it cannot be reopened');
  }

  console.log('\n[#357] accounts_close: (a) already closed is idempotent and truthful');
  {
    reset([[CLOSED]]);
    const res = await tool.call({ id: '60000000-0000-4000-8000-000000000001' });
    check(res?.success === true,                          'still succeeds: the requested state holds');
    check(res?.alreadyClosed === true,                    'flags that nothing changed');
    check(/already closed/i.test(res?.message ?? ''),      'message says already closed');
    check(closeCalls === 0,                                'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: (a) unknown id is refused');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: '99999999-0000-4000-8000-000000000001' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                    'throws');
    check(!!threw && /not found/i.test(threw.message),                'says not found');
    check(!!threw && threw.message.includes('actual_accounts_list'),  'names the listing tool');
    check(!!threw && /REMOVED/i.test(threw.message),                  'mentions the removed-by-close case');
    check(closeCalls === 0,                                           'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: (c) transfer parameters are forwarded');
  {
    reset([[OPEN, OFF_DEST], [CLOSED, OFF_DEST]]);
    const res = await tool.call({
      id: '60000000-0000-4000-8000-000000000001',
      transferAccountId: '60000000-0000-4000-8000-000000000002',
      transferCategoryId: '70000000-0000-4000-8000-000000000009',
    });
    check(res?.success === true,              'succeeds with a transfer destination');
    check(lastCloseArgs?.[1] === '60000000-0000-4000-8000-000000000002',    'transferAccountId forwarded as the 2nd argument');
    check(lastCloseArgs?.[2] === '70000000-0000-4000-8000-000000000009',     'transferCategoryId forwarded as the 3rd argument');
  }

  console.log('\n[#357] accounts_close: (c) a non-zero balance without a destination is explained');
  {
    reset([[OPEN], [OPEN]]);
    closeThrows = new Error('balance is non-zero: transferAccountId is required');
    let threw = null;
    try { await tool.call({ id: '60000000-0000-4000-8000-000000000001' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                       'throws');
    check(!!threw && threw.message.includes('transferAccountId'),        'names the parameter to supply');
    check(!!threw && /non-zero balance/i.test(threw.message),            'explains why it is needed');
    check(!!threw && threw.message.includes('actual_accounts_list'),     'says how to find a destination');
  }

  console.log('\n[#357] accounts_close: unknown transfer destination is refused before the write');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: '60000000-0000-4000-8000-000000000001', transferAccountId: '99999999-0000-4000-8000-000000000002' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                  'throws');
    check(!!threw && /destination/i.test(threw.message),             'error is about the destination');
    check(closeCalls === 0,                                          'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: a CLOSED transfer destination is refused');
  {
    // The balancing transaction would land somewhere hidden from most views.
    reset([[OPEN, DEST_CLOSED]]);
    let threw = null;
    try { await tool.call({ id: '60000000-0000-4000-8000-000000000001', transferAccountId: '60000000-0000-4000-8000-000000000003' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                              'throws');
    check(!!threw && /CLOSED/.test(threw.message),              'says the destination is closed');
    check(!!threw && threw.message.includes('Old Savings'),     'names the destination');
    check(closeCalls === 0,                                     'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: an unknown transfer CATEGORY is refused');
  {
    // Upstream forwards this id into transaction-add unchecked, so a bogus value would
    // write a closing transaction carrying a category that does not exist (#359's class).
    reset([[OPEN, OFF_DEST]]);
    categories = [{ id: '70000000-0000-4000-8000-000000000009', name: 'Misc' }];
    let threw = null;
    try {
      await tool.call({ id: '60000000-0000-4000-8000-000000000001', transferAccountId: '60000000-0000-4000-8000-000000000002', transferCategoryId: '99999999-0000-4000-8000-000000000003' });
    } catch (e) { threw = e; }
    check(threw instanceof Error,                                     'throws');
    check(!!threw && /category/i.test(threw.message),                  'error is about the category');
    check(!!threw && threw.message.includes('actual_categories_get'),  'names the listing tool');
    check(closeCalls === 0,                                            'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: a known transfer category is accepted');
  {
    reset([[OPEN, OFF_DEST], [CLOSED, OFF_DEST]]);
    categories = [{ id: '70000000-0000-4000-8000-000000000009', name: 'Misc' }];
    const res = await tool.call({ id: '60000000-0000-4000-8000-000000000001', transferAccountId: '60000000-0000-4000-8000-000000000002', transferCategoryId: '70000000-0000-4000-8000-000000000009' });
    check(res?.success === true,            'succeeds with a valid category');
    check(lastCloseArgs?.[2] === '70000000-0000-4000-8000-000000000009',   'transferCategoryId still forwarded');
  }

  console.log('\n[#357] accounts_close: the write had no effect');
  {
    reset([[OPEN], [OPEN]]);
    let threw = null;
    try { await tool.call({ id: '60000000-0000-4000-8000-000000000001' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                        'throws when the account is still open');
    check(!!threw && /still open/i.test(threw.message),   'says it is still open');
    check(closeCalls === 1,                              'the write was attempted');
  }

  // #768: a close that writes a closing row must pair the on/off-budget flags sensibly.
  const SRC = '60000000-0000-4000-8000-000000000001';
  const DST = '60000000-0000-4000-8000-000000000002';
  const CAT = '70000000-0000-4000-8000-000000000009';
  const refusedWith = async (args) => {
    let threw = null;
    try { await tool.call(args); } catch (e) { threw = e; }
    return threw;
  };
  const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

  console.log('\n[#768] accounts_close: on-budget into off-budget needs a category');
  {
    reset([[OPEN, OFF_DEST]]);
    const threw = await refusedWith({ id: SRC, transferAccountId: DST });
    check(!!threw && threw.message === 'Closing "Checking" into the off-budget account "Mortgage" needs transferCategoryId: the closing transaction would otherwise leave the budget as an uncategorised outflow. Nothing was written.',
      'refused with the exact message', threw && threw.message);
    check(!!threw && isPreflightRefusal(threw), 'it is a typed preflight refusal');
    check(closeCalls === 0, 'raw closeAccount NOT called');
    check(balanceReads === 1, 'the balance was read once');
  }
  console.log('\n[#768] accounts_close: with a category the close goes through and forwards it');
  {
    reset([[OPEN, OFF_DEST], [CLOSED, OFF_DEST]]);
    categories = [{ id: CAT, name: 'Misc' }];
    const res = await tool.call({ id: SRC, transferAccountId: DST, transferCategoryId: CAT });
    check(res?.success === true && lastCloseArgs?.[2] === CAT, 'closes with the category forwarded');
    check(balanceReads === 1 && witness.sharedOneCycle(), 'the balance read, the write and the re-read shared ONE write-queue cycle', witness.describe());
  }
  console.log('\n[#768] accounts_close: a category that cannot be kept is refused, naming both states');
  {
    categories = [{ id: CAT, name: 'Misc' }];
    const cases = [
      ['on-budget into on-budget', [OPEN, DEST], 'on-budget', 'on-budget', 'Checking', 'Savings'],
      ['off-budget into on-budget', [OFF_SRC, DEST], 'off-budget', 'on-budget', 'Checking', 'Savings'],
      ['off-budget into off-budget', [OFF_SRC, OFF_DEST], 'off-budget', 'off-budget', 'Checking', 'Mortgage'],
    ];
    for (const [label, list, sOn, dOn, sName, dName] of cases) {
      reset([list]);
      const threw = await refusedWith({ id: SRC, transferAccountId: DST, transferCategoryId: CAT });
      check(!!threw && threw.message === `transferCategoryId has no effect when closing "${sName}" (${sOn}) into "${dName}" (${dOn}): Actual keeps a category on the closing transaction only when an on-budget account is closed into an off-budget one. Omit it. Nothing was written.`,
        `${label}: refused with the exact message`, threw && threw.message);
      check(!!threw && isPreflightRefusal(threw), `${label}: typed refusal`);
      check(closeCalls === 0, `${label}: raw closeAccount NOT called`);
    }
  }
  console.log('\n[#768] accounts_close: a zero balance, or no destination, is unaffected');
  {
    reset([[OPEN, OFF_DEST], [CLOSED, OFF_DEST]]);
    balance = 0;
    const res = await tool.call({ id: SRC, transferAccountId: DST });
    check(res?.success === true && closeCalls === 1, 'zero balance into off-budget with no category closes');
    reset([[OPEN, DEST], [CLOSED, DEST]]);
    balance = 0;
    categories = [{ id: CAT, name: 'Misc' }];
    const res2 = await tool.call({ id: SRC, transferAccountId: DST, transferCategoryId: CAT });
    check(res2?.success === true && closeCalls === 1, 'zero balance with a category on two on-budget accounts is not refused');
    reset([[OPEN], [CLOSED]]);
    await tool.call({ id: SRC });
    check(balanceReads === 0, 'no destination: the balance is not read');
    // The cutoff trap: getAccountBalance stops at today and would call a future-dated-only account
    // zero, letting the unsafe pairing through. The guard must use the all-dates query instead.
    check(cutoffBalanceReads === 0, 'the cutoff-today balance (getAccountBalance) is never used');
  }

  console.log('\n[#357] accounts_close: schema');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: '60000000-0000-4000-8000-000000000001', transferAccountId: '60000000-0000-4000-8000-000000000001' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects transferring to the account being closed');
    check(getCalls === 0,         'the adapter was never reached on a Zod failure');

    reset([[OPEN]]);
    threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects a missing id');
    check(closeCalls === 0,       'no write attempted');
  }

  console.log('');
  if (failures === 0) console.log('[#357] All accounts_close tests passed ✓');
  else { console.error(`[#357] ${failures} test(s) FAILED`); process.exit(2); }
})();
