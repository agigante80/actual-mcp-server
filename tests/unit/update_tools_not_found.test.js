// tests/unit/update_tools_not_found.test.js
// #360: four update tools reported {success: true} for an id that does not exist, and the
// write was not a harmless no-op.
//
// `db.update` does not run a SQL UPDATE. It sends CRDT messages, and the apply path INSERTs
// when the row was absent, so an unknown id CREATES a partial row that syncs to every
// client. For `accounts` and `payees` that row is visible in the listing with a null name;
// for `categories` it is an orphan (cat_group NULL) that NO tool can return, which is worse.
//
// The guards live in the adapter, next to the ones updateTag and updateRule already had, so
// this test exercises the REAL adapter methods: it installs raw api stubs BEFORE importing
// the adapter (actual-adapter.ts destructures them at module load) and disarms the session
// with _setSkipApiInitForTests. Stubbing the adapter method instead would make every
// assertion below vacuous.

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

  const KNOWN = 'known-id';
  const GHOST = '00000000-0000-4000-8000-000000000360';
  const writes = { account: 0, category: 0, group: 0, payee: 0 };

  apiDefault.sync = async () => {};
  // Mutable state, NOT a reassigned stub: actual-adapter.ts destructures the api functions
  // at module load, so `apiDefault.getAccounts = ...` after the import is captured by nobody.
  // The first version of the closed-account case below did exactly that and was vacuous.
  let accountsState = [{ id: KNOWN, name: 'Checking', closed: false }];
  apiDefault.getAccounts = async () => accountsState;
  apiDefault.getCategories = async () => [{ id: KNOWN, name: 'Food' }];
  apiDefault.getCategoryGroups = async () => [{ id: KNOWN, name: 'Expenses' }];
  apiDefault.getPayees = async () => [{ id: KNOWN, name: 'Kroger', transfer_acct: null }];
  apiDefault.updateAccount = async () => { writes.account++; };
  apiDefault.updateCategory = async () => { writes.category++; };
  apiDefault.updateCategoryGroup = async () => { writes.group++; };
  apiDefault.updatePayee = async () => { writes.payee++; };

  const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
  adapterMod._setSkipApiInitForTests(true);
  const adapter = adapterMod.default;

  // Each row: adapter method, the counter it should move, the entity word and the listing
  // tool the refusal must name. One shape, four tools, so one table rather than four files.
  const CASES = [
    { name: 'updateAccount',       call: (id) => adapter.updateAccount(id, { name: 'x' }),       key: 'account',  entity: 'Account',        listTool: 'actual_accounts_list' },
    { name: 'updateCategory',      call: (id) => adapter.updateCategory(id, { name: 'x' }),      key: 'category', entity: 'Category',       listTool: 'actual_categories_get' },
    { name: 'updateCategoryGroup', call: (id) => adapter.updateCategoryGroup(id, { name: 'x' }), key: 'group',    entity: 'Category group', listTool: 'actual_category_groups_get' },
    { name: 'updatePayee',         call: (id) => adapter.updatePayee(id, { name: 'x' }),         key: 'payee',    entity: 'Payee',          listTool: 'actual_payees_get' },
  ];

  for (const c of CASES) {
    console.log(`\n[#360] ${c.name}`);

    writes[c.key] = 0;
    let threw = null;
    try { await c.call(GHOST); } catch (e) { threw = e; }
    check(threw instanceof Error,                                'unknown id is refused');
    check(!!threw && /not found/i.test(threw.message),            'message says not found');
    check(!!threw && threw.message.includes(c.listTool),          `message names ${c.listTool}`);
    check(!!threw && threw.message.includes(GHOST),               'message names the offending id');
    check(writes[c.key] === 0,
      'the raw write was NOT called: this is what prevents the phantom row');

    writes[c.key] = 0;
    let ok = true;
    try { await c.call(KNOWN); } catch (e) { ok = false; fail(`${c.name}: a known id was refused`, e.message?.slice(0, 90)); }
    if (ok) {
      check(writes[c.key] === 1, 'a known id still reaches the raw write exactly once');
    }
  }

  console.log('\n[#360] a CLOSED account is still updatable');
  {
    // getAccounts filters `tombstone = 0`, not `closed = 0`, so the guard must not turn
    // "closed" into "missing". Renaming a closed account is legitimate.
    accountsState = [{ id: KNOWN, name: 'Old', closed: true }];
    writes.account = 0;
    let threw = null;
    try { await adapter.updateAccount(KNOWN, { name: 'Renamed' }); } catch (e) { threw = e; }
    check(threw === null,        'a closed account is not refused');
    check(writes.account === 1,  'the update still reached the raw call');

    // Prove the stub is actually live, so this case cannot go quietly vacuous again: with
    // the account absent, the same call MUST be refused.
    accountsState = [];
    writes.account = 0;
    let threw2 = null;
    try { await adapter.updateAccount(KNOWN, { name: 'Renamed' }); } catch (e) { threw2 = e; }
    check(threw2 instanceof Error, 'the mutable stub is live (an emptied list refuses)');
    check(writes.account === 0,    'and no write happened');
    accountsState = [{ id: KNOWN, name: 'Checking', closed: false }];
  }

  console.log('');
  if (failures === 0) console.log('[#360] All update-tool not-found tests passed ✓');
  else { console.error(`[#360] ${failures} test(s) FAILED`); process.exit(2); }
})();
