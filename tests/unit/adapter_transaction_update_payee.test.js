// tests/unit/adapter_transaction_update_payee.test.js
// #743: transaction update resolves payee_name in the adapter and accepts only an id in payee.
// Same stubbing model as transactions_update_guard.test.js: the raw api functions are replaced
// before the adapter is imported, and init/shutdown are disarmed.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const PT = '33333333-3333-4333-8333-333333333333';
const NEW_PREFIX = '44444444-4444-4444-8444-44444444444';
const ACCT = '55555555-5555-4555-8555-555555555555';

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = (apiMod.default || apiMod);
  api.sync = async () => {};

  let rows = [];            // pre-flight rows
  let payees = [];          // payee listing
  let updates = [];         // [id, payload]
  let creates = [];         // payload of every createPayee
  api.runQuery = async () => ({ data: rows });
  api.getPayees = async () => payees;
  api.updateTransaction = async (id, payload) => { updates.push([id, payload]); };
  api.createPayee = async (p) => { creates.push(p); const id = `${NEW_PREFIX}${creates.length}`; payees = [...payees, { id, name: p.name }]; return id; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);
  const errors = await import('../../dist/src/lib/errors.js');

  const reset = (ids, ps) => {
    rows = ids.map((id) => ({ id }));
    payees = ps;
    updates = []; creates = [];
  };
  const base = () => [
    { id: P1, name: 'Corner Shop' },
    { id: PT, name: 'Savings', transfer_acct: ACCT },
  ];
  const refused = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

  console.log('\n[#743] existing name (mixed case, padded) writes the existing id, creates nothing');
  reset(['t-1'], base());
  await adapter.updateTransaction('t-1', { payee_name: '  corner SHOP ' });
  check(updates.length === 1 && updates[0][1].payee === P1, 'payee is the existing id', JSON.stringify(updates));
  check(!('payee_name' in updates[0][1]), 'payee_name is not forwarded');
  check(creates.length === 0, 'createPayee never called');

  console.log('\n[#743] unknown name creates the payee with the trimmed name, once');
  reset(['t-1'], base());
  await adapter.updateTransaction('t-1', { payee_name: '  Brand New Co ', notes: 'x' });
  check(creates.length === 1 && creates[0].name === 'Brand New Co', 'createPayee called once with the trimmed name', JSON.stringify(creates));
  check(updates[0][1].payee === `${NEW_PREFIX}1` && updates[0][1].notes === 'x', 'new id written, other fields kept');

  console.log('\n[#743] a transfer payee with the same name is not matched');
  reset(['t-1'], base());
  await adapter.updateTransaction('t-1', { payee_name: 'savings' });
  check(creates.length === 1 && creates[0].name === 'savings', 'a new ordinary payee is created');
  check(updates[0][1].payee !== PT, 'the transfer payee is not used');

  console.log('\n[#743] payee: null and an id are forwarded');
  reset(['t-1'], base());
  await adapter.updateTransaction('t-1', { payee: null });
  check(updates.length === 1 && updates[0][1].payee === null, 'null forwarded');
  reset(['t-1'], base());
  await adapter.updateTransaction('t-1', { payee: P1 });
  check(updates[0][1].payee === P1 && creates.length === 0, 'an id is forwarded unchanged');

  console.log('\n[#743] refusals are typed, exact, and write nothing');
  const both = 'payee and payee_name cannot be used together. Pass payee (an id, or null to clear) or payee_name (a name to match or create), not both.';
  const blank = 'payee_name must be a non-empty name. To clear the payee pass payee: null.';
  const cases = [
    ['payee holding a name', { payee: 'Some Shop' },
      'payee must be a payee id. Got "Some Shop". To set a payee by name pass payee_name; actual_payees_get lists payees.'],
    ['payee and payee_name', { payee: P1, payee_name: 'X' }, both],
    ['payee null and payee_name', { payee: null, payee_name: 'X' }, both],
    ['payee_name null', { payee_name: null }, blank],
    ['payee_name blank', { payee_name: '   ' }, blank],
  ];
  for (const [label, fields, msg] of cases) {
    reset(['t-1'], base());
    const e = await refused(() => adapter.updateTransaction('t-1', fields));
    check(e && errors.isPreflightRefusal(e), `${label}: typed refusal`);
    check(e?.message === msg, `${label}: exact message`, e?.message);
    check(updates.length === 0 && creates.length === 0, `${label}: nothing written or created`);
  }
  {
    reset(['t-1'], base());
    const e = await refused(() => adapter.updateTransaction('t-1', { payee: 'x'.repeat(200) }));
    check(e?.message.includes('x'.repeat(80) + '...') && !e.message.includes('x'.repeat(81)), 'the echoed value is truncated to 80 characters');
  }

  console.log('\n[#743] ambiguous name is refused naming both ids');
  reset(['t-1'], [{ id: P1, name: 'Dup Co' }, { id: P2, name: 'dup co' }]);
  {
    const e = await refused(() => adapter.updateTransaction('t-1', { payee_name: 'dup co' }));
    check(e && errors.isPreflightRefusal(e) && e.refusalKind === 'out-of-range', 'typed out-of-range refusal');
    check(e?.message === `Payee name "dup co" matches 2 payees, so it does not identify one: ${P1}, ${P2}. Nothing was written. Pass payee (the id you mean) instead of payee_name; actual_payees_get lists them.`, 'exact message', e?.message);
    check(updates.length === 0 && creates.length === 0, 'nothing written or created');
  }

  console.log('\n[#743] a refused split update creates no payee');
  reset(['t-1'], base());
  rows = [{ id: 't-1', is_child: true, is_parent: false, amount: -100 }];
  {
    const e = await refused(() => adapter.updateTransaction('t-1', { payee_name: 'Never Created', subtransactions: [{ amount: -100 }] }));
    check(e && errors.isPreflightRefusal(e) && e.message.includes('split child'), 'refused by the split guard', e?.message);
    check(creates.length === 0 && updates.length === 0, 'createPayee called zero times');
  }

  console.log('\n[#743] batch: same new name creates one payee; refused item fails alone');
  reset(['t-1', 't-2'], base());
  {
    const res = await adapter.updateTransactionBatch([
      { id: 't-1', fields: { payee_name: 'Batch New Co' } },
      { id: 't-2', fields: { payee_name: 'batch new co' } },
    ]);
    check(res.succeeded.length === 2 && res.failed.length === 0, 'both succeed', JSON.stringify(res));
    check(creates.length === 1 && creates[0].name === 'Batch New Co', 'one createPayee call');
    check(updates.length === 2 && updates[0][1].payee === updates[1][1].payee, 'both use the same payee id');
  }
  reset(['t-1', 't-2'], base());
  {
    const res = await adapter.updateTransactionBatch([
      { id: 't-1', fields: { payee: 'A Name' } },
      { id: 't-2', fields: { payee_name: 'Corner Shop' } },
    ]);
    check(res.failed.length === 1 && res.failed[0].id === 't-1' && res.failed[0].error.includes('payee_name'), 'refused item in failed[]', JSON.stringify(res));
    check(res.succeeded.length === 1 && res.succeeded[0].id === 't-2' && updates.length === 1 && updates[0][1].payee === P1, 'the other item succeeds');
  }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll #743 checks passed');
})();
