// tests/unit/accounts_delete.test.js
//
// #347: actual_accounts_delete returned {success: true} for a CLOSED account
// while the account survived.
//
// WHY THIS MATTERS MORE THAN THE MISSING DELETION. Nothing is lost, so the
// consequence looks benign. The damage is to the CLAIM: the caller here is an LLM
// that acts on the result, and cleanup automation built on it accumulates residue
// forever while reporting healthy. Nine stale test accounts survived in a real
// budget from May to August for exactly this reason, and every deletion attempt
// along the way said "success".
//
// Run: node tests/unit/accounts_delete.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ok: ${l}`);
const fail = (l, d = '') => { console.error(`  FAIL: ${l}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (c, l, d = '') => c ? pass(l) : fail(l, d);
const rejects = async (fn, substr, label) => {
  try { const r = await fn(); fail(label, `did not throw; returned ${JSON.stringify(r)}`); }
  catch (err) { check(String(err.message).includes(substr), label, `message was: ${err.message}`); }
};

const OPEN_ID   = 'aaaaaaaa-1111-2222-3333-444444444444';
const CLOSED_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

(async () => {
  // #768: raw api stubs go in BEFORE the adapter import (it destructures them at module load) so
  // the REAL adapter.deleteAccount can be exercised below, before the tool tests replace it.
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  let transferRows = [];
  let rawDeletes = [];
  let lastQuery = null;
  apiDefault.runQuery = async (query) => { lastQuery = query.serialize(); return { data: transferRows }; };
  // #771: the raw delete can throw upstream's text, and the fresh read that follows is stubbed too.
  let rawDeleteError = null;
  let rawAccounts = [{ id: OPEN_ID }];
  let rawAccountsThrow = false;
  let rawAccountReads = 0;
  apiDefault.deleteAccount = async (id) => { rawDeletes.push(id); if (rawDeleteError) throw rawDeleteError; };
  apiDefault.getAccounts = async () => { rawAccountReads++; if (rawAccountsThrow) throw new Error('read failed'); return rawAccounts; };
  apiDefault.sync = async () => {};
  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  adapterMod._setSkipApiInitForTests(true);
  const adapter = adapterMod.default;
  const realDeleteAccount = adapter.deleteAccount;
  const tool = (await import('../../dist/src/tools/accounts_delete.js')).default;

  // Shaped after the real listing that exposed the bug: closed test accounts
  // alongside a live one.
  const ACCOUNTS = [
    { id: OPEN_ID,   name: 'MCP-Test-open',   closed: false, balance_current: 0 },
    { id: CLOSED_ID, name: 'MCP-Test-closed', closed: true,  balance_current: 0 },
  ];

  let deleted = [];
  // The delete is a no-op upstream for a closed account, so the stub mirrors that:
  // it removes the account ONLY when the account is open. Modelling the no-op is
  // the whole point; a stub that always removes could not reproduce the bug.
  let accounts = [...ACCOUNTS];
  adapter.getAccounts = async () => accounts;
  adapter.deleteAccount = async (id) => {
    deleted.push(id);
    const target = accounts.find((a) => a.id === id);
    if (target && target.closed !== true) accounts = accounts.filter((a) => a.id !== id);
    return { detachedTransfers };
  };
  let detachedTransfers = 0;
  const reset = () => { deleted = []; accounts = [...ACCOUNTS]; detachedTransfers = 0; };

  console.log('\n[accounts-delete] an OPEN account is deleted, unchanged behaviour');
  {
    reset();
    const res = await tool.call({ id: OPEN_ID });
    check(res?.success === true, 'reports success');
    check(res?.detachedTransfers === 0, 'reports detachedTransfers: 0 when there are no transfers (#768)');
    check(deleted.length === 1 && deleted[0] === OPEN_ID, 'and the adapter was actually asked to delete it');
    check(!accounts.some((a) => a.id === OPEN_ID), 'and the account is genuinely gone');
  }

  console.log('\n[#768] the tool carries the adapter count into its result');
  {
    reset();
    detachedTransfers = 2;
    const res = await tool.call({ id: OPEN_ID });
    check(res?.success === true && res?.detachedTransfers === 2, 'detachedTransfers: 2 reaches the tool result');
  }

  console.log('\n[#768] the real adapter counts the account\'s transfer rows before the delete');
  {
    for (const n of [0, 1, 2]) {
      transferRows = Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
      rawDeletes = [];
      const out = await realDeleteAccount(OPEN_ID);
      check(out?.detachedTransfers === n, `${n} transfer row(s) give detachedTransfers ${n}`, JSON.stringify(out));
      check(rawDeletes.length === 1 && rawDeletes[0] === OPEN_ID, 'and the raw delete ran once');
    }
  }

  console.log('\n[#768] the count query asks for this account\'s transfer rows, split children included');
  {
    transferRows = [{ id: 't0' }];
    lastQuery = null;
    await realDeleteAccount(OPEN_ID);
    const sq = JSON.stringify(lastQuery?.filterExpressions ?? []);
    check(lastQuery?.table === 'transactions', 'it queries the transactions table', JSON.stringify(lastQuery));
    check(sq.includes('"account":"' + OPEN_ID + '"'), 'it filters on this account', sq);
    check(/"transfer_id":\{"\$ne":null\}/.test(sq), 'it keeps only rows with a transfer_id (not null)', sq);
    check(lastQuery?.tableOptions?.splits === 'all', 'it reads with splits all, so split children count', JSON.stringify(lastQuery?.tableOptions));
  }

  console.log('\n[accounts-delete] REGRESSION GUARD: a CLOSED account is NOT falsely confirmed');
  {
    reset();
    await rejects(() => tool.call({ id: CLOSED_ID }), 'still exists after the delete',
      'a delete that leaves the account present throws instead of reporting success');
    check(accounts.some((a) => a.id === CLOSED_ID), 'and the account is indeed still there');
  }

  console.log('\n[accounts-delete] the error tells the caller what to do about it');
  {
    reset();
    try {
      await tool.call({ id: CLOSED_ID });
      fail('expected a throw');
    } catch (err) {
      check(err.message.includes('CLOSED'), 'it names the closed state as the cause');
      check(err.message.includes('actual_accounts_reopen'), 'and the tool that unblocks the delete');
    }
  }

  console.log('\n[accounts-delete] a tombstoned id reports success, not a false not-found');
  {
    // close() DELETES an account with zero transactions, and reopen() does not
    // clear the tombstone, so getAccounts() no longer lists it. The caller's
    // intent is already satisfied. A pre-check would have thrown "not found" here
    // and broken both the E2E suite and the repo's close-then-delete teardown.
    reset();
    accounts = accounts.filter((a) => a.id !== CLOSED_ID); // as if already tombstoned
    const res = await tool.call({ id: CLOSED_ID });
    check(res?.success === true, 'deleting an id that is already absent reports success (idempotent)');
  }

  console.log('\n[#771] an unknown id is refused with a next step, not reported as a success');
  {
    const { isPreflightRefusal, NotFoundRefusal } = await import('../../dist/src/lib/errors.js');
    const UNKNOWN = 'cccccccc-0000-0000-0000-000000000000';
    const upstream = new Error(`Account with ID ${UNKNOWN} not found.`);
    const run = async () => { try { await realDeleteAccount(UNKNOWN); return null; } catch (e) { return e; } };

    rawDeletes = []; rawDeleteError = upstream; rawAccounts = [{ id: OPEN_ID }]; rawAccountsThrow = false; rawAccountReads = 0;
    let err = await run();
    check(err instanceof NotFoundRefusal && isPreflightRefusal(err), 'upstream not-found plus an absent id is a NotFoundRefusal', String(err));
    check(/actual_accounts_list/.test(err?.message ?? '') && !/Account with ID/.test(err?.message ?? ''), 'it names the list tool and not upstream text', err?.message);
    check(rawDeletes.length === 1, 'the delete was attempted once (no retry)');

    rawAccounts = [{ id: UNKNOWN }];
    err = await run();
    check(err === upstream, 'NEGATIVE: the id is still listed, so the original error is rethrown unchanged', String(err));

    rawAccounts = [{ id: OPEN_ID }]; rawAccountsThrow = true;
    err = await run();
    check(err === upstream, 'NEGATIVE: the re-read fails, so the original error is rethrown unchanged', String(err));

    rawDeleteError = null; rawAccountsThrow = false; rawAccountReads = 0;
    await realDeleteAccount(UNKNOWN);
    check(rawAccountReads === 0, 'a delete that succeeds (a tombstoned id) reads nothing and is not refused');
  }

  console.log('\n[accounts-delete] schema validation still runs before any adapter call');
  {
    reset();
    try { await tool.call({}); } catch { /* expected: id is required */ }
    check(deleted.length === 0, 'a missing id is rejected by Zod before anything is deleted');
  }

  console.log('');
  if (failures === 0) console.log('[accounts-delete] All tests passed');
  else { console.error(`[accounts-delete] ${failures} test(s) FAILED`); process.exit(2); }
})();
