// tests/unit/get_context.test.js
//
// #484: actual_get_context returns accounts, category groups and payees from ONE api session.
//
// The real adapter with its raw primitives stubbed BEFORE import (it destructures them at module
// load) and `_setSkipApiInitForTests(true)`. The single-lock-cycle property is proven from the TEST
// side with an intruder on the api lock, never with a counter in withActualApi's hot path:
//
//   the FIRST raw read enqueues `withApiLock(() => intruderRan = true)` without awaiting it. Every
//   LATER raw read asserts the lock is still held and the intruder has not run. After the call,
//   the intruder must have run. If the reads were split across sessions (three adapter.get* calls),
//   the unhinted intruder is a barrier budget affinity may not skip (#391), so it would be granted
//   between them. The teeth case at the end drives exactly that shape and requires the witness to
//   go red; recorded mutation proof: rewriting getContext as three adapter.get* calls fails case 1.
//
// Run: node tests/unit/get_context.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

(async () => {
  const apiMod = await import('@actual-app/api');
  const apiDefault = (apiMod.default || apiMod);
  apiDefault.sync = async () => {};

  let rawAccounts = [];
  let rawCategoryGroups = [];
  let rawPayees = [];
  let reads = { accounts: 0, groups: 0, payees: 0 };

  // Intruder witness (see header). `violations` collects every later read that saw the lock free
  // or the intruder already run.
  let intruder = null;
  let violations = [];
  const onRead = (label) => {
    if (!intruder) {
      const box = { ran: false };
      box.done = withApiLock(async () => { box.ran = true; });
      intruder = box;
      return;
    }
    if (!isApiLockHeld() || intruder.ran) violations.push(label);
  };

  apiDefault.getAccounts = async () => { reads.accounts++; onRead('accounts'); return rawAccounts; };
  apiDefault.getCategoryGroups = async () => { reads.groups++; onRead('groups'); return rawCategoryGroups; };
  apiDefault.getPayees = async () => { reads.payees++; onRead('payees'); return rawPayees; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const { withApiLock, isApiLockHeld } = await import('../../dist/src/lib/apiLock.js');
  adapterMod._setSkipApiInitForTests(true);
  const tool = (await import('../../dist/src/tools/get_context.js')).default;

  const FIX = {
    accounts: [
      { id: 'a1', name: 'Checking', offbudget: false, closed: false },
      { id: 'a2', name: 'Savings', offbudget: true, closed: false },
      { id: 'a3', name: 'Old Card', offbudget: false, closed: true },
    ],
    groups: [
      { id: 'g1', name: 'Everyday', is_income: false, hidden: false,
        categories: [{ id: 'c1', name: 'Groceries', hidden: false }, { id: 'c2', name: 'Dining', hidden: true }] },
      { id: 'g2', name: 'Archived', is_income: false, hidden: true,
        categories: [{ id: 'c3', name: 'Old', hidden: true }, { id: 'c4', name: 'Older', hidden: true }] },
    ],
    payees: [
      { id: 'p1', name: 'delta', transfer_acct: null },
      { id: 'p2', name: 'Alpha', transfer_acct: null },
      { id: 'p3', name: 'charlie', transfer_acct: null },
      { id: 'p4', name: 'Bravo', transfer_acct: null },
    ],
  };
  const closedTransfer = { id: 'p5', name: 'Old Card', transfer_acct: 'a3' };

  const reset = (payees = FIX.payees) => {
    rawAccounts = FIX.accounts; rawCategoryGroups = FIX.groups; rawPayees = payees;
    reads = { accounts: 0, groups: 0, payees: 0 };
    intruder = null; violations = [];
  };
  const run = async (input) => (await tool.call(input))?.result;
  const rejects = async (input) => { try { await tool.call(input); return null; } catch (e) { return e; } };
  const zodText = (e) => `${e?.message ?? ''} ${JSON.stringify(e?.issues ?? e?.errors ?? [])}`;

  console.log('\n[get_context] 1. defaults: 3 accounts (1 closed), 2 groups (1 hidden), 4 payees');
  {
    reset();
    const r = await run({});
    check(r?.accounts?.map((a) => a.id).join() === 'a1,a2', 'closed account excluded', JSON.stringify(r?.accounts));
    check(r?.categoryGroups?.length === 2, '2 groups');
    check(r?.categoryGroups?.[0]?.hidden === false && r?.categoryGroups?.[1]?.hidden === true, 'group hidden flag carried');
    check(r?.categoryGroups?.[1]?.categories?.length === 2, 'hidden group keeps its categories');
    check(r?.payees?.map((p) => p.name).join() === 'Alpha,Bravo,charlie,delta', 'payees sorted by name, case-insensitive', r?.payees?.map((p) => p.name).join());
    check(r?.payeesTruncated === false && r?.payeeTotal === 4, 'payeesTruncated false, payeeTotal 4');
    check(!('hint' in (r ?? {})), 'no hint when not truncated');
    check(intruder !== null && violations.length === 0, 'every later read ran with the lock held and the intruder waiting', violations.join());
    await intruder?.done;
    check(intruder?.ran === true, 'intruder ran after the call released the lock');
  }

  console.log('\n[get_context] 2. payeeLimit 2 with 4 payees');
  {
    reset();
    const r = await run({ payeeLimit: 2 });
    check(r?.payees?.map((p) => p.name).join() === 'Alpha,Bravo', 'first two by name', r?.payees?.map((p) => p.name).join());
    check(r?.payeesTruncated === true && r?.payeeTotal === 4, 'payeesTruncated true, payeeTotal 4');
    check(/Showing 2 of 4 payees/.test(r?.hint ?? '') && /actual_entities_search/.test(r?.hint ?? ''), 'hint names the count and the search tool', r?.hint);
    await intruder?.done;
  }

  console.log('\n[get_context] 3. equal names tie-break by id');
  {
    reset([{ id: 'z9', name: 'same', transfer_acct: null }, { id: 'a0', name: 'Same', transfer_acct: null }]);
    const r = await run({ payeeLimit: 1 });
    check(r?.payees?.[0]?.id === 'a0', 'lower id wins the tie', JSON.stringify(r?.payees));
    await intruder?.done;
  }

  console.log('\n[get_context] 4. closed account transfer payee');
  {
    reset([...FIX.payees, closedTransfer]);
    const def = await run({});
    check(!def?.payees?.some((p) => p.id === 'p5'), 'defaults omit the closed account transfer payee');
    check(def?.payeeTotal === 4, 'payeeTotal counts after that filter');
    await intruder?.done;
    reset([...FIX.payees, closedTransfer]);
    const all = await run({ includeClosed: true });
    check(all?.accounts?.length === 3 && all.accounts.find((a) => a.id === 'a3')?.closed === true, 'includeClosed returns the closed account flagged');
    check(all?.payees?.some((p) => p.id === 'p5'), 'includeClosed keeps its transfer payee');
    await intruder?.done;
    reset([...FIX.payees, closedTransfer]);
    const payeesOnly = await run({ includeAccounts: false, includeCategories: false });
    check(!('accounts' in payeesOnly) && !payeesOnly.payees.some((p) => p.id === 'p5'), 'closed filter still applies when accounts are not returned');
    check(reads.accounts === 1 && reads.groups === 0, 'accounts read for the filter, groups not read');
    await intruder?.done;
  }

  console.log('\n[get_context] 5. excluded sections are ABSENT, and not read');
  {
    reset();
    const r = await run({ includePayees: false });
    for (const k of ['payees', 'payeesTruncated', 'payeeTotal', 'hint']) check(!(k in r), `no ${k} key`);
    check(reads.payees === 0, 'getPayees never called');
    await intruder?.done;
    reset();
    const r2 = await run({ includeCategories: false });
    check(!('categoryGroups' in r2), 'no categoryGroups key');
    check(reads.groups === 0, 'getCategoryGroups never called');
    await intruder?.done;
  }

  console.log('\n[get_context] 6. schema refusals');
  {
    for (const bad of [0, 2001, 1.5]) {
      reset();
      const e = await rejects({ payeeLimit: bad });
      check(e && /payeeLimit/.test(zodText(e)), `payeeLimit ${bad} rejected naming payeeLimit`, zodText(e).slice(0, 160));
      check(reads.accounts + reads.groups + reads.payees === 0, `payeeLimit ${bad}: nothing read`);
    }
    reset();
    const e = await rejects({ includeAccounts: false, includeCategories: false, includePayees: false });
    const t = zodText(e);
    check(e && /includeAccounts/.test(t) && /includeCategories/.test(t) && /includePayees/.test(t), 'all sections off is rejected naming the three flags', t.slice(0, 200));
  }

  console.log('\n[get_context] 7. teeth: three separate sessions MUST trip the witness');
  {
    reset();
    await adapterMod.getAccounts();
    await adapterMod.getCategoryGroups();
    await adapterMod.getPayees();
    check(violations.length > 0, 'witness goes red when the reads span several lock cycles', `violations=${violations.join()}`);
    await intruder?.done;
  }

  if (failures > 0) {
    console.error(`\n[get_context] ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\n[get_context] All tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
