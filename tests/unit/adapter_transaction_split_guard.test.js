// tests/unit/adapter_transaction_split_guard.test.js
// #748: a split parent must equal the sum of its children. Upstream records a mismatch as a
// SplitTransactionError instead of refusing, so the adapter refuses the writes that would cause
// one: a parent amount alone, a child amount, deleting a child, and the same through update_batch.
// Real adapter, raw API stubbed BEFORE import; runQuery answers from an in-memory table by the
// serialized filter, so a read-then-write guard that reads the wrong rows is seen.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
let unhandled = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};
process.on('unhandledRejection', (err) => { unhandled++; console.error('unhandled rejection', err); process.exit(1); });

const P = 'p0000000-0000-0000-0000-000000000001';
const C1 = 'c0000000-0000-0000-0000-000000000001';
const C2 = 'c0000000-0000-0000-0000-000000000002';
const PLAIN = 'n0000000-0000-0000-0000-000000000001';

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = apiMod.default || apiMod;
  api.sync = async () => {};
  let table = [];
  let txnQueries = 0;
  const updates = [];
  const deletes = [];
  let createdPayees = 0;
  api.runQuery = async (query) => {
    const s = typeof query?.serialize === 'function' ? query.serialize() : query;
    if (s?.table !== 'transactions') return { data: [] };
    txnQueries++;
    const f = s.filterExpressions[0] || {};
    if (f.$or) {
      const pid = f.$or[0].id;
      return { data: table.filter((r) => r.id === pid || r.parent_id === pid) };
    }
    if (f.id && f.id.$oneof) return { data: table.filter((r) => f.id.$oneof.includes(r.id)) };
    return { data: table.filter((r) => r.id === f.id) };
  };
  api.updateTransaction = async (id, fields) => { updates.push({ id, fields }); };
  api.deleteTransaction = async (id) => { deletes.push(id); };
  api.getPayees = async () => [];
  api.createPayee = async () => { createdPayees++; return 'new-payee'; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);

  const seed = (children = [-600, -400], parentAmount = -1000) => {
    table = [
      { id: P, is_parent: true, is_child: false, amount: parentAmount, parent_id: null },
      ...children.map((amount, i) => ({ id: i === 0 ? C1 : i === 1 ? C2 : `c-${i}`, is_parent: false, is_child: true, amount, parent_id: P })),
      { id: PLAIN, is_parent: false, is_child: false, amount: -50, parent_id: null },
    ];
    updates.length = 0; deletes.length = 0; txnQueries = 0; createdPayees = 0;
  };
  const attempt = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

  console.log('\n[#748] negative: parent amount alone');
  seed();
  let e = await attempt(() => adapter.updateTransaction(P, { amount: -2000 }));
  check(isPreflightRefusal(e), 'typed refusal', e && e.message);
  check(e?.message === `Transaction "${P}" is a split parent: its children sum to -1000, so its amount cannot become -2000 on its own. Send subtransactions that sum to -2000 in the same update.`, 'exact message', e?.message);
  check(updates.length === 0, 'rawUpdateTransaction not called');

  console.log('\n[#748] negative: child amount');
  seed();
  e = await attempt(() => adapter.updateTransaction(C1, { amount: -100 }));
  check(isPreflightRefusal(e), 'typed refusal', e && e.message);
  check(e?.message === `Transaction "${C1}" is a split child of "${P}": changing its amount to -100 would make the children sum to -500, not the parent's -1000. Edit the parent with subtransactions that sum to its amount.`, 'exact message', e?.message);
  check(updates.length === 0, 'rawUpdateTransaction not called');

  console.log('\n[#748] negative: delete a child');
  seed();
  e = await attempt(() => adapter.deleteTransaction(C1));
  check(isPreflightRefusal(e), 'typed refusal', e && e.message);
  check(e?.message === `Transaction "${C1}" is a split child of "${P}": deleting it would leave the children summing to -400, not the parent's -1000. Update the parent with the remaining subtransactions, or delete the parent.`, 'exact message', e?.message);
  check(deletes.length === 0, 'rawDeleteTransaction not called');

  console.log('\n[#748] negative: batch refuses the split item, writes the plain one');
  seed();
  let r = await adapter.updateTransactionBatch([
    { id: P, fields: { amount: -2000 } },
    { id: PLAIN, fields: { notes: 'hello' } },
    { id: C2, fields: { amount: -1 } },
  ]);
  check(r.failed.length === 2 && r.failed[0].id === P && /is a split parent: its children sum to -1000/.test(r.failed[0].error), 'parent item failed with the parent message', JSON.stringify(r.failed));
  check(r.failed[1].id === C2 && r.failed[1].error.includes(`split child of "${P}"`), 'child item failed naming the parent');
  check(r.succeeded.length === 1 && r.succeeded[0].id === PLAIN && updates.length === 1 && updates[0].id === PLAIN, 'plain item written, others not');

  console.log('\n[#748] positive: allowed shapes');
  seed();
  e = await attempt(() => adapter.updateTransaction(P, { amount: -2000, subtransactions: [{ amount: -1200 }, { amount: -800 }] }));
  check(e === null, 'no refusal', e && e.message);
  check(updates.length === 1, 'parent edited through subtransactions that sum');
  seed([-600, -900]);
  e = await attempt(() => adapter.updateTransaction(P, { amount: -1500 }));
  check(e === null, 'no refusal', e && e.message);
  check(updates.length === 1, 'broken split (children -1500) repaired by amount -1500');
  seed();
  e = await attempt(() => adapter.updateTransaction(C1, { amount: -600 }));
  check(e === null, 'no refusal', e && e.message);
  check(updates.length === 1, 'child amount equal to stored is a no-op pass');
  seed();
  table.find((x) => x.id === C2).amount = -500; // children -600 + -500 = -1100; setting C1 to -500 gives -1000
  updates.length = 0;
  e = await attempt(() => adapter.updateTransaction(C1, { amount: -500 }));
  check(e === null, 'no refusal', e && e.message);
  check(updates.length === 1, 'child amount that keeps the sum equal to the parent is allowed');
  seed([-1000]);
  e = await attempt(() => adapter.deleteTransaction(C1));
  check(e === null, 'no refusal', e && e.message);
  check(deletes.length === 1, 'sole child can be deleted');
  seed();
  e = await attempt(() => adapter.deleteTransaction(P));
  check(e === null, 'no refusal', e && e.message);
  check(deletes.length === 1 && deletes[0] === P, 'deleting the parent is unchanged');
  seed();
  table.find((x) => x.id === C1).amount = 0;
  table.find((x) => x.id === C2).amount = -1000;
  e = await attempt(() => adapter.deleteTransaction(C1));
  check(e === null, 'no refusal', e && e.message);
  check(deletes.length === 1, 'child delete allowed when the remaining children still sum to the parent');

  console.log('\n[#748] no extra reads for non-split or non-amount updates');
  seed();
  e = await attempt(() => adapter.updateTransaction(PLAIN, { amount: -75 })); check(e === null, 'no refusal', e && e.message);
  check(txnQueries === 1, 'plain amount update reads once (the pre-flight)', String(txnQueries));
  seed(); e = await attempt(() => adapter.updateTransaction(P, { notes: 'n' })); check(e === null, 'no refusal', e && e.message);
  check(txnQueries === 1, 'parent notes-only: no family read', String(txnQueries));
  seed(); e = await attempt(() => adapter.updateTransaction(C1, { category: null })); check(e === null, 'no refusal', e && e.message);
  check(txnQueries === 1, 'child category-only: no family read', String(txnQueries));
  seed(); e = await attempt(() => adapter.updateTransaction(P, { amount: -1000 })); check(e === null, 'no refusal', e && e.message);
  check(txnQueries === 1, 'parent amount equal to stored: no family read', String(txnQueries));
  seed(); e = await attempt(() => adapter.updateTransaction(PLAIN, { notes: 'n' })); check(e === null, 'no refusal', e && e.message);
  check(txnQueries === 1, 'plain notes update: single read', String(txnQueries));

  console.log('\n[#748] batch: a repeated id is judged against its current amount');
  seed([-600, -500], -1000);
  r = await adapter.updateTransactionBatch([{ id: C1, fields: { amount: -500 } }, { id: C1, fields: { amount: -600 } }]);
  check(r.succeeded.length === 1 && r.failed.length === 1 && r.failed[0].id === C1, 'second write of the same child is refused, not skipped as unchanged', JSON.stringify(r));
  check(updates.length === 1 && updates[0].fields.amount === -500, 'only the first write was sent');
  seed([-600, -900], -1000);
  r = await adapter.updateTransactionBatch([{ id: P, fields: { amount: -1500 } }, { id: P, fields: { amount: -1000 } }]);
  check(r.succeeded.length === 1 && r.failed.length === 1 && /children sum to -1500/.test(r.failed[0].error), 'repair then revert is refused on the second item', JSON.stringify(r));

  seed([-600, -500], -1000);
  r = await adapter.updateTransactionBatch([{ id: C1, fields: { amount: -500 } }, { id: C2, fields: { amount: -400 } }]);
  check(r.succeeded.length === 1 && r.failed.length === 1 && r.failed[0].id === C2, 'a sibling item sees the amount this batch already sent', JSON.stringify(r));

  console.log('\n[#748] batch refusal text points at the single update');
  seed();
  r = await adapter.updateTransactionBatch([{ id: P, fields: { amount: -2000 } }]);
  check(r.failed[0]?.error === `Transaction "${P}" is a split parent: its children sum to -1000, so its amount cannot become -2000 on its own. Use actual_transactions_update with subtransactions that sum to -2000 for this split.`, 'exact batch message', r.failed[0]?.error);

  console.log('\n[#748] a refused update creates no payee');
  seed();
  e = await attempt(() => adapter.updateTransaction(P, { amount: -2000, payee_name: 'Brand New Payee' }));
  check(isPreflightRefusal(e), 'refused', e && e.message);
  check(createdPayees === 0, 'no payee created');

  await new Promise((res) => setTimeout(res, 20));
  check(unhandled === 0, 'no unhandled rejection');
  if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nOK');
  process.exit(0);
})().catch((err) => { console.error('test run rejected', err); process.exit(1); });
