// tests/unit/adapter_transaction_payee_name_guard.test.js
// #752: transaction create and import refuse a payee_name shared by two or more payees, listing
// the candidate ids, and write nothing. Same stubbing model as adapter_transaction_update_payee.test.js:
// the raw api functions are replaced before the adapter is imported.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const PT = '33333333-3333-4333-8333-333333333333';
const ACCT = '55555555-5555-4555-8555-555555555555';

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = (apiMod.default || apiMod);
  api.sync = async () => {};

  let payees = [];
  let payeeReads = 0;
  let adds = [];
  let imports = [];
  api.getAccounts = async () => [{ id: ACCT, name: 'Checking' }];
  api.getPayees = async () => { payeeReads++; return payees; };
  api.addTransactions = async (acct, txs) => { adds.push([acct, txs]); return txs.map((_, i) => `new-${i}`); };
  api.importTransactions = async (acct, txs) => { imports.push([acct, txs]); return { added: txs.map((_, i) => `imp-${i}`), updated: [], errors: [] }; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);
  const errors = await import('../../dist/src/lib/errors.js');
  const pf = await import('../../dist/src/lib/actual-adapter/payee-fields.js');

  const reset = (ps) => { payees = ps; payeeReads = 0; adds = []; imports = []; };
  const dup = () => [{ id: P1, name: 'PD' }, { id: P2, name: 'pd' }, { id: PT, name: 'Savings', transfer_acct: ACCT }];
  const refused = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };
  const text = (name, ids) => `Payee name "${name}" matches ${ids.length} payees, so it does not identify one: ${ids.join(', ')}. Nothing was written. Pass payee (the id you mean) instead of payee_name; actual_payees_get lists them.`;
  const row = (extra) => ({ account: ACCT, date: '2026-01-15', amount: -100, ...extra });
  const importRow = (extra) => ({ date: '2026-01-15', amount: -100, ...extra });

  console.log('\n[#752] create: an ambiguous payee_name is refused, typed, exact, nothing written');
  reset(dup());
  {
    const e = await refused(() => adapter.addTransactions([row({ payee_name: 'PD' })]));
    check(e && errors.isPreflightRefusal(e), 'typed refusal');
    check(e?.refusalKind === 'out-of-range', 'class is out-of-range', String(e?.refusalKind));
    check(e?.message === text('PD', [P1, P2]), 'exact message', e?.message);
    check(adds.length === 0, 'raw addTransactions never called');
    check(payeeReads === 1, 'payees read once', String(payeeReads));
  }

  console.log('\n[#752] import: an ambiguous payee_name is refused and none of the batch is written');
  reset(dup());
  {
    const e = await refused(() => adapter.importTransactions(ACCT, [importRow({ payee_name: 'Clean' }), importRow({ payee_name: 'PD' })]));
    check(e && errors.isPreflightRefusal(e) && e.refusalKind === 'out-of-range', 'typed out-of-range refusal');
    check(e?.message === text('PD', [P1, P2]), 'exact message', e?.message);
    check(imports.length === 0, 'raw importTransactions never called');
  }

  console.log('\n[#752] trimmed and case-insensitive; transfer payees ignored; stored trailing space not matched');
  reset(dup());
  {
    const e = await refused(() => adapter.addTransactions([row({ payee_name: '  pd ' })]));
    check(e?.message === text('pd', [P1, P2]), 'refused with the trimmed name', e?.message);
  }
  reset([{ id: P1, name: 'PD' }, { id: PT, name: 'PD', transfer_acct: ACCT }]);
  await adapter.addTransactions([row({ payee_name: 'PD' })]);
  check(adds.length === 1, 'one regular plus one transfer payee: allowed');
  reset([{ id: P1, name: 'PD' }, { id: P2, name: 'PD ' }]);
  await adapter.addTransactions([row({ payee_name: 'PD' })]);
  check(adds.length === 1, 'a stored name with a trailing space is not matched (upstream parity)');

  console.log('\n[#752] allowed inputs call the raw write exactly once');
  const allowed = [
    ['one match', [{ id: P1, name: 'PD' }], { payee_name: 'PD' }],
    ['no match', [{ id: P1, name: 'Other' }], { payee_name: 'Brand New' }],
    ['payee id present', dup(), { payee: P1, payee_name: 'PD' }],
    ['blank payee_name', dup(), { payee_name: '   ' }],
    ['null payee_name', dup(), { payee_name: null }],
    ['numeric payee_name', dup(), { payee_name: 42 }],
    ['no payee fields', dup(), {}],
  ];
  for (const [label, ps, extra] of allowed) {
    reset(ps);
    const e = await refused(() => adapter.addTransactions([row(extra)]));
    check(e === null && adds.length === 1, `create, ${label}`, e?.message);
    reset(ps);
    const e2 = await refused(() => adapter.importTransactions(ACCT, [importRow(extra)]));
    check(e2 === null && imports.length === 1, `import, ${label}`, e2?.message);
  }

  console.log('\n[#752] listing reads');
  reset(dup());
  await adapter.addTransactions([row({})]);
  check(payeeReads === 0, 'no row needs a lookup: no payee listing read', String(payeeReads));
  reset([{ id: P1, name: 'PD' }]);
  await adapter.importTransactions(ACCT, [importRow({ payee_name: 'PD' }), importRow({ payee_name: 'pd' }), importRow({ payee_name: ' PD ' })]);
  check(payeeReads === 1 && imports.length === 1, 'a batch naming the same payee three times reads the listing once', String(payeeReads));

  console.log('\n[#752] a batch with one ambiguous row among clean ones writes none');
  reset(dup());
  {
    const e = await refused(() => adapter.addTransactions([row({ payee_name: 'Fine' }), row({}), row({ payee_name: 'PD' })]));
    check(e && errors.isPreflightRefusal(e) && adds.length === 0, 'refused, raw add not called');
  }

  console.log('\n[#752] account guard still runs first');
  reset(dup());
  {
    const e = await refused(() => adapter.importTransactions('99999999-9999-4999-8999-999999999999', [importRow({ payee_name: 'PD' })]));
    check(e?.message?.includes('Account') && payeeReads === 0, 'unknown account refused before any payee read', e?.message);
  }

  console.log('\n[#752] pure helpers');
  check(JSON.stringify(pf.payeeNamesToResolve([
    { payee_name: ' A ' }, { payee_name: 'a' }, { payee_name: 'B', payee: null }, { payee_name: 'C', payee: P1 },
    { payee_name: '  ' }, { payee_name: 5 }, null, 'x', {},
  ])) === JSON.stringify(['A', 'B']), 'payeeNamesToResolve: distinct trimmed names of rows without a payee id');
  check(pf.payeeNamesToResolve('nope').length === 0 && pf.payeeNamesToResolve(undefined).length === 0, 'payeeNamesToResolve: non-array contributes nothing');
  check(pf.matchingPayees(' pd ', dup()).map((r) => r.id).join() === `${P1},${P2}`, 'matchingPayees: trimmed, case-insensitive, no transfer payee');
  {
    let err = null;
    try { pf.assertPayeeNamesUnambiguous(['Nope', 'PD'], dup()); } catch (e) { err = e; }
    check(err?.message === text('PD', [P1, P2]), 'assertPayeeNamesUnambiguous throws for the ambiguous name');
    check(pf.assertPayeeNamesUnambiguous(['Nope'], dup()) === undefined, 'assertPayeeNamesUnambiguous: no throw for a clean name');
  }
  {
    let err = null;
    try { pf.resolvePayeeName('pd', dup()); } catch (e) { err = e; }
    check(err?.message === text('pd', [P1, P2]), 'resolvePayeeName keeps the #743 text');
  }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll #752 checks passed');
})();
