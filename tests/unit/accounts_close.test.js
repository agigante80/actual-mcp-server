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
  apiDefault.getAccounts = async () =>
    accountsQueue.length > 1 ? accountsQueue.shift() : accountsQueue[0];
  let categories = [{ id: 'cat-9', name: 'Misc' }];
  apiDefault.getCategories = async () => categories;
  apiDefault.closeAccount = async (id, transferAccountId, transferCategoryId) => {
    closeCalls++;
    lastCloseArgs = [id, transferAccountId, transferCategoryId];
    if (closeThrows) throw closeThrows;
  };

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/accounts_close.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;
  const originalSession = adapter.withWriteSession;
  let sessionCalls = 0;
  adapter.withWriteSession = async (fn) => { sessionCalls++; return await fn(); };

  const OPEN = { id: 'acct-1', name: 'Checking', closed: false };
  const CLOSED = { id: 'acct-1', name: 'Checking', closed: true };
  const DEST = { id: 'acct-2', name: 'Savings', closed: false };
  const DEST_CLOSED = { id: 'acct-3', name: 'Old Savings', closed: true };

  const reset = (queue) => {
    accountsQueue = queue; closeCalls = 0; lastCloseArgs = null; closeThrows = null; sessionCalls = 0;
  };

  console.log('\n[#357] accounts_close: positive, an account with transactions closes');
  {
    reset([[OPEN], [CLOSED]]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true,             'returns success: true');
    check(res?.closed === true,              'reports that it is closed');
    check(closeCalls === 1,                  'raw closeAccount called exactly once');
    check(lastCloseArgs?.[1] === undefined,  'no transfer account passed when not supplied');
    check(sessionCalls === 1,                'exactly one withWriteSession cycle (#142)');
  }

  console.log('\n[#357] accounts_close: (b) a zero-transaction account is REMOVED, and says so');
  {
    // Upstream tombstones it, so it is simply gone from the post-read.
    reset([[OPEN], []]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true,                        'still a success: the account is gone');
    check(res?.removed === true,                        'flags that it was removed, not closed');
    check(/REMOVED/i.test(res?.message ?? ''),          'message says removed');
    check(/no transactions/i.test(res?.message ?? ''),  'message explains why');
    check(/cannot be reopened/i.test(res?.message ?? ''), 'message warns it cannot be reopened');
  }

  console.log('\n[#357] accounts_close: (a) already closed is idempotent and truthful');
  {
    reset([[CLOSED]]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true,                          'still succeeds: the requested state holds');
    check(res?.alreadyClosed === true,                    'flags that nothing changed');
    check(/already closed/i.test(res?.message ?? ''),      'message says already closed');
    check(closeCalls === 0,                                'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: (a) unknown id is refused');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: 'ghost' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                    'throws');
    check(!!threw && /not found/i.test(threw.message),                'says not found');
    check(!!threw && threw.message.includes('actual_accounts_list'),  'names the listing tool');
    check(!!threw && /REMOVED/i.test(threw.message),                  'mentions the removed-by-close case');
    check(closeCalls === 0,                                           'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: (c) transfer parameters are forwarded');
  {
    reset([[OPEN, DEST], [CLOSED, DEST]]);
    const res = await tool.call({
      id: 'acct-1',
      transferAccountId: 'acct-2',
      transferCategoryId: 'cat-9',
    });
    check(res?.success === true,              'succeeds with a transfer destination');
    check(lastCloseArgs?.[1] === 'acct-2',    'transferAccountId forwarded as the 2nd argument');
    check(lastCloseArgs?.[2] === 'cat-9',     'transferCategoryId forwarded as the 3rd argument');
  }

  console.log('\n[#357] accounts_close: (c) a non-zero balance without a destination is explained');
  {
    reset([[OPEN], [OPEN]]);
    closeThrows = new Error('balance is non-zero: transferAccountId is required');
    let threw = null;
    try { await tool.call({ id: 'acct-1' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                       'throws');
    check(!!threw && threw.message.includes('transferAccountId'),        'names the parameter to supply');
    check(!!threw && /non-zero balance/i.test(threw.message),            'explains why it is needed');
    check(!!threw && threw.message.includes('actual_accounts_list'),     'says how to find a destination');
  }

  console.log('\n[#357] accounts_close: unknown transfer destination is refused before the write');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: 'acct-1', transferAccountId: 'ghost-dest' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                                  'throws');
    check(!!threw && /destination/i.test(threw.message),             'error is about the destination');
    check(closeCalls === 0,                                          'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: a CLOSED transfer destination is refused');
  {
    // The balancing transaction would land somewhere hidden from most views.
    reset([[OPEN, DEST_CLOSED]]);
    let threw = null;
    try { await tool.call({ id: 'acct-1', transferAccountId: 'acct-3' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                              'throws');
    check(!!threw && /CLOSED/.test(threw.message),              'says the destination is closed');
    check(!!threw && threw.message.includes('Old Savings'),     'names the destination');
    check(closeCalls === 0,                                     'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: an unknown transfer CATEGORY is refused');
  {
    // Upstream forwards this id into transaction-add unchecked, so a bogus value would
    // write a closing transaction carrying a category that does not exist (#359's class).
    reset([[OPEN, DEST]]);
    categories = [{ id: 'cat-9', name: 'Misc' }];
    let threw = null;
    try {
      await tool.call({ id: 'acct-1', transferAccountId: 'acct-2', transferCategoryId: 'cat-ghost' });
    } catch (e) { threw = e; }
    check(threw instanceof Error,                                     'throws');
    check(!!threw && /category/i.test(threw.message),                  'error is about the category');
    check(!!threw && threw.message.includes('actual_categories_get'),  'names the listing tool');
    check(closeCalls === 0,                                            'raw closeAccount NOT called');
  }

  console.log('\n[#357] accounts_close: a known transfer category is accepted');
  {
    reset([[OPEN, DEST], [CLOSED, DEST]]);
    categories = [{ id: 'cat-9', name: 'Misc' }];
    const res = await tool.call({ id: 'acct-1', transferAccountId: 'acct-2', transferCategoryId: 'cat-9' });
    check(res?.success === true,            'succeeds with a valid category');
    check(lastCloseArgs?.[2] === 'cat-9',   'transferCategoryId still forwarded');
  }

  console.log('\n[#357] accounts_close: the write had no effect');
  {
    reset([[OPEN], [OPEN]]);
    let threw = null;
    try { await tool.call({ id: 'acct-1' }); } catch (e) { threw = e; }
    check(threw instanceof Error,                        'throws when the account is still open');
    check(!!threw && /still open/i.test(threw.message),   'says it is still open');
    check(closeCalls === 1,                              'the write was attempted');
  }

  console.log('\n[#357] accounts_close: schema');
  {
    reset([[OPEN]]);
    let threw = null;
    try { await tool.call({ id: 'acct-1', transferAccountId: 'acct-1' }); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects transferring to the account being closed');
    check(sessionCalls === 0,     'no session opened on Zod failure');

    reset([[OPEN]]);
    threw = null;
    try { await tool.call({}); } catch (e) { threw = e; }
    check(threw instanceof Error, 'rejects a missing id');
    check(closeCalls === 0,       'no write attempted');
  }

  adapter.withWriteSession = originalSession;
  console.log('');
  if (failures === 0) console.log('[#357] All accounts_close tests passed ✓');
  else { console.error(`[#357] ${failures} test(s) FAILED`); process.exit(2); }
})();
