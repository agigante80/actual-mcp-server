// #388: one answer to a NAME passed where an optional filter id belongs.
//
// The defect this pins is not "the schema was loose". It is that the surface answered the single
// most likely caller mistake THREE different ways: `search_by_amount` resolved the name and named
// the correct id, `transactions_get` refused with a bare not-found, and the other nine silently
// returned an EMPTY RESULT SET, which is the worst of the three because it reads as "no
// transactions match" and a model will believe it.
//
// Two properties are load bearing here and each is asserted rather than described:
//   1. The happy path reads NOTHING. A well-formed id must not cost a listing call, or this
//      change taxes every correct call to improve an incorrect one.
//   2. `verifyExists` is asymmetric ON PURPOSE. The tools that already paid for a listing keep
//      their existence check; the ones that never did are not made to pay for one. Removing the
//      asymmetry in either direction is a behaviour change, so both halves are pinned.
//
// Run: node tests/unit/filter_id_resolution.test.js

process.env.ACTUAL_SERVER_URL = 'http://test-server';
process.env.ACTUAL_PASSWORD = 'pw';
process.env.ACTUAL_BUDGET_SYNC_ID = 'budget-A';
process.env.MCP_BRIDGE_DATA_DIR = '/tmp/unit388';

let passed = 0, failed = 0;
const log = (s) => process.stderr.write(s + '\n');
const describe = (l) => log(`\n[#388-filter-ids] ${l}`);
const check = (c, m) => { if (c) { log(`  PASS: ${m}`); passed++; } else { log(`  FAIL: ${m}`); failed++; } };

const ACC = 'aaaaaaaa-0000-4000-8000-000000000001';
const CAT = 'bbbbbbbb-0000-4000-8000-000000000002';
const PAY = 'cccccccc-0000-4000-8000-000000000003';
const GRP = 'dddddddd-0000-4000-8000-000000000004';
const ABSENT = 'dddddddd-0000-4000-8000-00000000ffff';

// Count every listing read, so "the happy path reads nothing" is a measurement rather than a claim.
let reads = { accounts: 0, categories: 0, payees: 0 };
const apiMod = await import('@actual-app/api');
const api = apiMod.default || apiMod;
api.init = async () => {};
api.shutdown = async () => {};
api.sync = async () => {};
api.downloadBudget = async () => {};
api.getBudgetMonths = async () => ['2026-01'];
api.getAccounts = async () => { reads.accounts++; return [{ id: ACC, name: 'Checking' }]; };
api.getCategories = async () => { reads.categories++; return [{ id: CAT, name: 'Food' }]; };
api.getPayees = async () => { reads.payees++; return [{ id: PAY, name: 'Amazon' }]; };
// #424: category_group joined the resolver.
api.getCategoryGroups = async () => [{ id: GRP, name: 'Bills' }];

const pure = await import('../../dist/src/lib/actual-adapter/filter-ids.js');
const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
const { isPreflightRefusal } = await import('../../dist/src/lib/errors.js');
const apiState = await import('../../dist/src/lib/apiState.js');
apiState.setApiInitialized(true);
apiState.setLoadedBudgetSyncId('budget-A');

const attempt = async (fn) => {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, error: e }; }
};

// --- the pure matcher --------------------------------------------------------
describe('the pure half: what counts as an id, and what counts as a name');
{
  check(pure.isEntityId(ACC), 'a well-formed uuid is an id');
  check(!pure.isEntityId('Checking'), 'a name is not an id');
  check(!pure.isEntityId(''), 'the empty string is not an id');

  const rows = [{ id: ACC, name: 'Checking' }, { id: ABSENT, name: 'Savings' }];
  check(pure.matchByName(rows, 'checking')?.id === ACC, 'name matching is case-insensitive');
  check(pure.matchByName(rows, '  Checking  ')?.id === ACC, 'and trims, because a model pastes whitespace');
  check(pure.matchByName(rows, 'Nothing') === undefined, 'an unknown name matches nothing');
  // The empty string must never match a row with a blank or missing name, or a caller who sent
  // nothing at all would be told they meant some arbitrary entity.
  check(pure.matchByName([{ id: ACC, name: '' }, { id: ABSENT }], '') === undefined,
    'the empty string never matches, even against a blank name');
}

// --- property 1: the happy path is free --------------------------------------
describe('a well-formed id costs no listing read, so a correct call is unchanged');
{
  reads = { accounts: 0, categories: 0, payees: 0 };
  const r = await attempt(() => adapter.resolveFilterId('account', ACC));
  check(r.ok && r.value === ACC, 'a well-formed id is returned untouched');
  check(reads.accounts === 0, `and NO listing was read (accounts read ${reads.accounts} times)`);

  // Deliberately including an id that does NOT exist: without verifyExists this must still pass
  // through, because checking would mean a listing read on every call.
  reads = { accounts: 0, categories: 0, payees: 0 };
  const r2 = await attempt(() => adapter.resolveFilterId('account', ABSENT));
  check(r2.ok && r2.value === ABSENT, 'a well-formed id that names nothing also passes through');
  check(reads.accounts === 0, 'and still reads no listing');
}

// --- property 2: a name is resolved, not swallowed ---------------------------
describe('a NAME is refused with the id it resolves to');
{
  for (const [kind, name, id] of [['account', 'Checking', ACC], ['category', 'Food', CAT], ['category_group', 'Bills', GRP], ['payee', 'Amazon', PAY]]) {
    const r = await attempt(() => adapter.resolveFilterId(kind, name));
    const msg = r.ok ? '(resolved instead of refusing)' : String(r.error.message);
    check(!r.ok && isPreflightRefusal(r.error) && msg.includes(id),
      `${kind}: "${name}" is refused and the message names ${id.slice(0, 8)}...`);
  }

  // #377: the decision is by TYPE, not by matching message prose.
  const r = await attempt(() => adapter.resolveFilterId('account', 'Checking'));
  check(!r.ok && r.error.refusalKind === 'not-found', 'the refusal is typed not-found, not a bare Error');

  // The ANSWER must come first. The generic not-found prefix would otherwise put "use the
  // listing tool" ahead of the id we just resolved, and that is the instruction a model follows.
  const lead = await attempt(() => adapter.resolveFilterId('account', 'Checking'));
  check(!lead.ok && !/^Account "Checking" not found/.test(lead.error.message),
    'the resolved message does NOT lead with the generic not-found line');
  check(!lead.ok && /^"Checking" is an account NAME/.test(lead.error.message),
    `it leads with the resolution, and the article agrees (${String(lead.error.message).slice(0, 42)})`);

  const unknown = await attempt(() => adapter.resolveFilterId('payee', 'NoSuchPayee'));
  check(!unknown.ok && /actual_payees_get/.test(unknown.error.message),
    'an unknown name names the listing tool instead');
  check(!unknown.ok && !/instead/.test(unknown.error.message),
    'and does NOT claim to have resolved anything');
}

// --- property 3: verifyExists, both halves -----------------------------------
describe('verifyExists is asymmetric on purpose, so both halves are pinned');
{
  reads = { accounts: 0, categories: 0, payees: 0 };
  const present = await attempt(() => adapter.resolveFilterId('account', ACC, { verifyExists: true }));
  check(present.ok && present.value === ACC, 'under verifyExists an existing id still passes');
  check(reads.accounts === 1, `and it DOES read the listing (read ${reads.accounts} times)`);

  const absent = await attempt(() => adapter.resolveFilterId('account', ABSENT, { verifyExists: true }));
  check(!absent.ok && isPreflightRefusal(absent.error),
    'under verifyExists a well-formed id that names nothing is refused');
  check(!absent.ok && !/instead/.test(absent.error.message),
    'and is NOT reported as a resolvable name, because it is not one');

  // The caller that already holds the listing must not be made to fetch it twice: this is what
  // keeps transactions_search_by_category (which reads accounts anyway) at one read, not two.
  reads = { accounts: 0, categories: 0, payees: 0 };
  const rows = [{ id: ACC, name: 'Checking' }];
  const supplied = await attempt(() => adapter.resolveFilterId('account', ACC, { verifyExists: true, rows }));
  check(supplied.ok && supplied.value === ACC, 'a supplied listing is used');
  check(reads.accounts === 0, `and no second read is paid (accounts read ${reads.accounts} times)`);
}

log(`\n[#388-filter-ids] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
