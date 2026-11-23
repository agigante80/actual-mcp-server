// tests/unit/get_id_by_name_ambiguity.test.js
// #801: a name shared by several accounts, payees, categories or schedules is refused with the
// candidate ids instead of resolving silently to one of them. Stubbed raw api, the real adapter.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GRP_A = 'bbbbbbbb-0000-4000-8000-000000000001';
const GRP_B = 'bbbbbbbb-0000-4000-8000-000000000002';

(async () => {
  const apiMod = await import('@actual-app/api');
  const api = (apiMod.default || apiMod);
  api.sync = async () => {};

  let tableRows = {};
  let queries = [];
  let rawLookups = [];
  let groupReads = 0;
  api.runQuery = async (query) => {
    const state = query.state ?? {};
    queries.push({ table: state.table, filter: state.filterExpressions });
    return { data: tableRows[state.table] ?? [] };
  };
  api.getIDByName = async (type, name) => { rawLookups.push([type, name]); throw new Error(`Not found: ${type} ${name}`); };
  api.getCategoryGroups = async () => { groupReads++; return [{ id: GRP_A, name: 'Bills' }, { id: GRP_B, name: 'Fun' }]; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  const adapter = adapterMod.default;
  adapterMod._setSkipApiInitForTests(true);
  const errors = await import('../../dist/src/lib/errors.js');
  const pure = await import('../../dist/src/lib/actual-adapter/filter-ids.js');

  const reset = (rows) => { tableRows = rows; queries = []; rawLookups = []; groupReads = 0; };
  const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e }; } };
  const tail = 'Nothing was changed. Use the id of the one you mean.';

  console.log('\n[#801] two or more rows are refused for each of the four types');
  {
    reset({ accounts: [
      { id: id(1), name: 'Checking', closed: 0, offbudget: 0 },
      { id: id(2), name: 'Checking', closed: 1, offbudget: 1 },
    ] });
    const r = await attempt(() => adapter.getIDByName('accounts', 'Checking'));
    check(!r.ok && errors.isPreflightRefusal(r.error) && r.error.refusalKind === 'out-of-range', 'accounts: typed out-of-range refusal');
    check(r.error?.message === `Name "Checking" matches 2 accounts, so it does not identify one: ${id(1)} (open, on budget), ${id(2)} (closed, off budget). ${tail}`, 'accounts: exact text', r.error?.message);
    check(rawLookups.length === 0, 'accounts: the upstream lookup is not called');
    check(queries.length === 1 && queries[0].table === 'accounts', 'accounts: one query on the accounts table', JSON.stringify(queries));
    check(JSON.stringify(queries[0]?.filter ?? null).includes('Checking'), 'accounts: the query filters on the name (the serialized filterExpressions carry it)', JSON.stringify(queries[0]?.filter));
  }
  {
    reset({ payees: [
      { id: id(1), name: 'Savings', transfer_acct: null },
      { id: id(2), name: 'Savings', transfer_acct: id(9) },
    ] });
    const r = await attempt(() => adapter.getIDByName('payees', 'Savings'));
    check(r.error?.message === `Name "Savings" matches 2 payees, so it does not identify one: ${id(1)}, ${id(2)} (transfer payee). ${tail}`, 'payees: exact text, the transfer payee is marked', r.error?.message);
  }
  {
    reset({ categories: [
      { id: id(1), name: 'Misc', group: GRP_A, hidden: 0 },
      { id: id(2), name: 'Misc', group: GRP_B, hidden: 1 },
    ] });
    const r = await attempt(() => adapter.getIDByName('categories', 'Misc'));
    check(r.error?.message === `Name "Misc" matches 2 categories, so it does not identify one: ${id(1)} (group "Bills"), ${id(2)} (group "Fun", hidden). ${tail}`, 'categories: exact text with group names', r.error?.message);
    check(groupReads === 1, 'categories: the group names are read once, on the refusal path', String(groupReads));
  }
  {
    reset({ schedules: [
      { id: id(1), name: 'Rent', completed: 0, next_date: '2026-12-01' },
      { id: id(2), name: 'Rent', completed: 1, next_date: '2026-01-01' },
    ] });
    const r = await attempt(() => adapter.getIDByName('schedules', 'Rent'));
    check(r.error?.message === `Name "Rent" matches 2 schedules, so it does not identify one: ${id(1)} (next 2026-12-01), ${id(2)} (completed). ${tail}`, 'schedules: exact text', r.error?.message);
  }

  console.log('\n[#801] one row returns its id directly; zero rows pass the upstream error through');
  for (const [type, rows] of [['accounts', [{ id: id(1), name: 'A' }]], ['payees', [{ id: id(1), name: 'A' }]], ['categories', [{ id: id(1), name: 'A', group: GRP_A }]], ['schedules', [{ id: id(1), name: 'A' }]]]) {
    reset({ [type]: rows });
    const r = await attempt(() => adapter.getIDByName(type, 'A'));
    check(r.ok && r.value === id(1), `${type}: one match returns its id`, r.error?.message);
    check(rawLookups.length === 0 && groupReads === 0, `${type}: no second upstream call and no group read`);
    reset({});
    const z = await attempt(() => adapter.getIDByName(type, 'Nope'));
    check(!z.ok && z.error.message === `Not found: ${type} Nope` && rawLookups.length >= 1 && rawLookups.every((l) => l[0] === type && l[1] === "Nope"), `${type}: zero rows fall through to the upstream lookup (retried as before) and pass its error through`, z.error?.message);
  }

  console.log('\n[#801] twelve rows list ten ids and the rest as a count');
  {
    reset({ accounts: Array.from({ length: 12 }, (_, i) => ({ id: id(i + 1), name: 'Dup' })) });
    const r = await attempt(() => adapter.getIDByName('accounts', 'Dup'));
    const m = r.error?.message ?? '';
    check(m.startsWith('Name "Dup" matches 12 accounts, so it does not identify one: ') && m.includes(id(10)) && !m.includes(id(11)) && m.endsWith(` and 2 more. ${tail}`), 'ten ids then "and 2 more"', m);
  }

  console.log('\n[#801] a missing field degrades to no detail');
  {
    reset({ accounts: [{ id: id(1), name: 'X' }, { id: id(2), name: 'X' }] });
    const r = await attempt(() => adapter.getIDByName('accounts', 'X'));
    check(r.error?.message === `Name "X" matches 2 accounts, so it does not identify one: ${id(1)}, ${id(2)}. ${tail}`, 'no parentheses when the detail is empty', r.error?.message);
  }

  console.log('\n[#801] pure helpers');
  {
    const rows = [{ id: id(1), name: 'Dup' }, { id: id(2), name: ' dup ' }, { id: id(3), name: '' }, { id: id(4) }, { id: id(5), name: 'Other' }];
    check(pure.matchesByName(rows, 'DUP').map((r) => r.id).join() === `${id(1)},${id(2)}`, 'matchesByName returns every hit, trimmed and case-insensitive');
    check(pure.matchesByName(rows, '').length === 0 && pure.matchesByName(rows, '   ').length === 0, 'a blank value matches nothing, not even a blank name');
    check(pure.matchesByName(rows, 'Nothing').length === 0, 'no hit gives []');
    const e = pure.ambiguousNameRefusal('account', 'X', [{ id: 'a' }, { id: 'b', detail: 'open' }]);
    check(errors.isPreflightRefusal(e) && e.message === `Name "X" matches 2 accounts, so it does not identify one: a, b (open). ${tail}`, 'ambiguousNameRefusal text');
  }

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll #801 checks passed');
})();
