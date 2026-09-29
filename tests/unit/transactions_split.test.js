// tests/unit/transactions_split.test.js
// #489: actual_transactions_split replaces a plain transaction with a split parent,
// preserving bank sync (imported_id, imported_payee) and reconciliation fields.
// The read pre-flight and writes MUST share ONE write-queue drain cycle.

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

  let queryResponse = [];
  let addedTransactions = [];
  let deleteCalls = [];
  let deleteShouldFail = false;
  let witness;

  apiDefault.sync = async () => {};
  apiDefault.runQuery = async (_query) => {
    witness?.noteRead();
    return queryResponse;
  };
  apiDefault.addTransactions = async (acct, txs) => {
    witness?.noteWrite();
    addedTransactions.push({ acct, txs });
    return txs.map((t) => t.id || 'stub-id');
  };
  apiDefault.deleteTransaction = async (id) => {
    deleteCalls.push(id);
    if (deleteShouldFail) {
      throw new Error('Simulated rawDeleteTransaction failure');
    }
    return null;
  };

  const { makeCycleWitness } = await import('./helpers/write-cycle.mjs');
  const [tool, adapterMod, errorsMod] = await Promise.all([
    import('../../dist/src/tools/transactions_split.js').then((m) => m.default),
    import('../../dist/src/lib/actual-adapter.js'),
    import('../../dist/src/lib/errors.js'),
  ]);
  const { isPreflightRefusal } = errorsMod;
  adapterMod._setSkipApiInitForTests(true);

  witness = makeCycleWitness(adapterMod);
  const reset = () => {
    queryResponse = [];
    addedTransactions = [];
    deleteCalls = [];
    deleteShouldFail = false;
    witness.reset();
  };

  const ORIG_ID = '00000000-0000-0000-0000-000000000001';
  const ACCT_ID = '11111111-1111-1111-1111-111111111111';
  const PAYEE_ID = '22222222-2222-2222-2222-222222222222';
  const CAT_ID = '33333333-3333-3333-3333-333333333333';

  console.log('\n[#489] transactions_split: schema validation');
  {
    const S = tool.inputSchema;
    check(S.safeParse({ id: ORIG_ID, subtransactions: [{ amount: -3000 }, { amount: -2000 }] }).success,
      'valid schema passes');
    check(!S.safeParse({ id: ORIG_ID, subtransactions: [{ amount: -5000 }] }).success,
      'fewer than 2 subtransactions rejected (<2)');
    check(!S.safeParse({ id: 'not-a-uuid', subtransactions: [{ amount: -3000 }, { amount: -2000 }] }).success,
      'invalid transaction id rejected');
  }

  console.log('\n[#489] transactions_split: positive happy path (bank sync fields preserved)');
  {
    reset();
    queryResponse = [
      {
        id: ORIG_ID,
        account: ACCT_ID,
        date: '2025-01-10',
        amount: -5000,
        payee: PAYEE_ID,
        notes: 'Original note',
        imported_id: 'bank-sync-orig-999',
        imported_payee: 'ORIGINAL PAYEE STORE #12',
        cleared: true,
        reconciled: false,
      },
    ];

    const res = await tool.call({
      id: ORIG_ID,
      subtransactions: [
        { amount: -3500, category: CAT_ID, notes: 'Groceries portion' },
        { amount: -1500, notes: 'Household portion' },
      ],
    });

    const r = res?.result;
    check(r !== undefined, 'returns { result } wrapper');
    check(r?.deleted === ORIG_ID, 'deleted matches original transaction ID');
    check(typeof r?.created === 'string' && r?.created !== ORIG_ID, 'created is a new distinct UUID');
    check(addedTransactions.length === 1, 'addTransactions called exactly once');

    const added = addedTransactions[0];
    check(added.acct === ACCT_ID, 'added into the correct account');
    check(added.txs.length === 1, 'single parent transaction added');

    const p = added.txs[0];
    check(p.id === r.created, 'added payload has the new explicit UUID');
    check(p.is_parent === true, 'added payload is marked as is_parent: true');
    check(p.amount === -5000, 'parent amount matches original amount (-5000)');
    check(p.date === '2025-01-10', 'date preserved');
    check(p.payee === PAYEE_ID, 'payee preserved');
    check(p.notes === 'Original note', 'notes preserved');
    check(p.imported_id === 'bank-sync-orig-999', 'imported_id preserved for bank sync reconciliation');
    check(p.imported_payee === 'ORIGINAL PAYEE STORE #12', 'imported_payee preserved');
    check(p.cleared === true, 'cleared flag preserved');
    check(p.reconciled === false, 'reconciled flag preserved');

    check(Array.isArray(p.subtransactions) && p.subtransactions.length === 2, 'has 2 subtransactions');
    check(p.subtransactions[0].amount === -3500 && p.subtransactions[0].category === CAT_ID, 'child 1 matches');
    check(p.subtransactions[1].amount === -1500, 'child 2 matches');

    check(deleteCalls.length === 1 && deleteCalls[0] === ORIG_ID, 'deleteTransaction called for original ID');
    check(witness.sharedOneCycle(), 'the existence read, add, and delete ran in the SAME write drain cycle', witness.describe());
  }

  console.log('\n[#489] transactions_split: amount sum mismatch refuses before write');
  {
    reset();
    queryResponse = [
      {
        id: ORIG_ID,
        account: ACCT_ID,
        date: '2025-01-10',
        amount: -5000,
      },
    ];

    let threw = null;
    try {
      await tool.call({
        id: ORIG_ID,
        subtransactions: [
          { amount: -3000 },
          { amount: -1000 }, // sum = -4000 != -5000
        ],
      });
    } catch (e) {
      threw = e;
    }

    check(threw instanceof Error, 'throws on amount mismatch');
    check(threw?.message?.includes('Expected -5000, got -4000'), 'error message details expected vs actual sum');
    check(addedTransactions.length === 0, 'addTransactions NOT called');
    check(deleteCalls.length === 0, 'deleteTransaction NOT called');
    check(witness.readInCycleNoWrite(), 'read ran inside drain and no write followed', witness.describe());
  }

  console.log('\n[#489] transactions_split: non-existent transaction id');
  {
    reset();
    queryResponse = [];

    let threw = null;
    try {
      await tool.call({
        id: ORIG_ID,
        subtransactions: [{ amount: -3000 }, { amount: -2000 }],
      });
    } catch (e) {
      threw = e;
    }

    check(threw instanceof Error, 'throws on not-found');
    check(isPreflightRefusal(threw), 'typed as PreflightRefusal');
    check(threw?.message?.includes('actual_transactions_get'), 'mentions actual_transactions_get');
    check(addedTransactions.length === 0, 'addTransactions NOT called');
    check(deleteCalls.length === 0, 'deleteTransaction NOT called');
    check(witness.readInCycleNoWrite(), 'read ran inside drain and no write followed', witness.describe());
  }

  console.log('\n[#489] transactions_split: already a split parent refuses');
  {
    reset();
    queryResponse = [
      {
        id: ORIG_ID,
        account: ACCT_ID,
        date: '2025-01-10',
        amount: -5000,
        is_parent: true,
      },
    ];

    let threw = null;
    try {
      await tool.call({
        id: ORIG_ID,
        subtransactions: [{ amount: -3000 }, { amount: -2000 }],
      });
    } catch (e) {
      threw = e;
    }

    check(threw instanceof Error, 'throws on existing split parent');
    check(threw?.message?.includes('actual_transactions_update'), 'guides user to actual_transactions_update');
    check(addedTransactions.length === 0, 'addTransactions NOT called');
    check(deleteCalls.length === 0, 'deleteTransaction NOT called');
    check(witness.readInCycleNoWrite(), 'read ran inside drain and no write followed', witness.describe());
  }

  console.log('\n[#489] transactions_split: child transaction refuses');
  {
    reset();
    queryResponse = [
      {
        id: ORIG_ID,
        account: ACCT_ID,
        date: '2025-01-10',
        amount: -2500,
        is_child: true,
        parent_id: '99999999-9999-9999-9999-999999999999',
      },
    ];

    let threw = null;
    try {
      await tool.call({
        id: ORIG_ID,
        subtransactions: [{ amount: -1500 }, { amount: -1000 }],
      });
    } catch (e) {
      threw = e;
    }

    check(threw instanceof Error, 'throws on child transaction');
    check(threw?.message?.includes('subtransaction'), 'error mentions subtransaction');
    check(addedTransactions.length === 0, 'addTransactions NOT called');
    check(deleteCalls.length === 0, 'deleteTransaction NOT called');
    check(witness.readInCycleNoWrite(), 'read ran inside drain and no write followed', witness.describe());
  }

  console.log('\n[#489] transactions_split: delete failure after creation reports warning');
  {
    reset();
    deleteShouldFail = true;
    queryResponse = [
      {
        id: ORIG_ID,
        account: ACCT_ID,
        date: '2025-01-10',
        amount: -5000,
      },
    ];

    const res = await tool.call({
      id: ORIG_ID,
      subtransactions: [{ amount: -3000 }, { amount: -2000 }],
    });

    const r = res?.result;
    check(r !== undefined, 'returns { result } wrapper');
    check(r?.deleted === null, 'deleted is null');
    check(typeof r?.created === 'string', 'created is still returned');
    check(typeof r?.warning === 'string' && r?.warning?.includes('could not be deleted'), 'warning is returned');
    check(addedTransactions.length === 1, 'create succeeded');
    check(deleteCalls.length === 1, 'delete was attempted');
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  } else {
    console.log('\nAll transactions_split tests passed.');
  }
})();
