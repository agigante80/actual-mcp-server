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
  apiDefault.getAccounts = async () => {
    getCalls++;
    return accountsQueue.length > 1 ? accountsQueue.shift() : accountsQueue[0];
  };
  apiDefault.reopenAccount = async (_id) => { reopenCalls++; };

  const [tool, adapterMod] = await Promise.all([
    import('../../dist/src/tools/accounts_reopen.js').then(m => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
  ]);
  const adapter = adapterMod.default;

  const originalSession = adapter.withWriteSession;
  let sessionCalls = 0;
  adapter.withWriteSession = async (fn) => { sessionCalls++; return await fn(); };

  const reset = (queue) => { accountsQueue = queue; getCalls = 0; reopenCalls = 0; sessionCalls = 0; };

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
    check(sessionCalls === 1,      'exactly one withWriteSession cycle (#142)');
  }

  console.log('\n[#358] accounts_reopen: positive, already open is idempotent and truthful');
  {
    reset([
      [{ id: 'acct-1', name: 'Savings', closed: false }],
      [{ id: 'acct-1', name: 'Savings', closed: false }],
    ]);
    const res = await tool.call({ id: 'acct-1' });
    check(res?.success === true, 'reopening an open account still succeeds');
    check(reopenCalls === 1,     'the call is still made (idempotent upstream)');
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
    check(sessionCalls === 1, 'still exactly one withWriteSession cycle');
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
    check(sessionCalls === 0,     'no session opened on Zod failure');
    check(reopenCalls === 0,      'no write attempted on Zod failure');
  }

  adapter.withWriteSession = originalSession;
  console.log('');
  if (failures === 0) console.log('[#358] All accounts_reopen tests passed ✓');
  else { console.error(`[#358] ${failures} test(s) FAILED`); process.exit(2); }
})();
