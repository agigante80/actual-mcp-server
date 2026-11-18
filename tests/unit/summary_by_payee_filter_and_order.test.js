// The by_payee summary must (a) pass its account filter to the query (#685: it validated
// accountId and never used it, so totals covered every account) and (b) return the payees
// with the largest spending, largest first (#686: the query capped the groups at `limit`
// with no ordering, then sorted the survivors by signed amount descending, which put
// refunds first and kept an arbitrary subset).
import assert from 'node:assert/strict';

const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
const tool = (await import('../../dist/src/tools/transactions_summary_by_payee.js')).default;

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name} -> ${e.message}`); }
};

let captured;
let rows = [];
adapter.runQuery = async (query) => { captured = JSON.parse(JSON.stringify(query.state ?? query)); return { data: rows }; };
// A well-formed id reads no listing; stub it anyway so the test never reaches Actual.
adapter.resolveFilterId = async (_kind, id) => id;

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const DATES = { startDate: '2026-01-01', endDate: '2026-01-31' };
const hasAccount = (state) => JSON.stringify(state.filterExpressions).includes('"account"');
const row = (name, totalAmount) => ({ 'payee.name': name, totalAmount, transactionCount: 1 });

// #685
await tool.call({ ...DATES, accountId: ACCOUNT });
check('the account filter reaches the query', () =>
  assert.ok(captured.filterExpressions.some((f) => f.account === ACCOUNT), JSON.stringify(captured.filterExpressions)));
await tool.call({ ...DATES });
check('NEGATIVE: no account filter without accountId', () => assert.equal(hasAccount(captured), false));

// #686
rows = [row('Small', -100), row('Rent', -90000), row('Mid', -5000)];
const top2 = await tool.call({ ...DATES, limit: 2 });
check('the limit keeps the two largest spenders, largest first', () =>
  assert.deepEqual(top2.summary.map((r) => r.payeeName), ['Rent', 'Mid']));
check('the query itself is not capped before the sort', () =>
  assert.ok(captured.limit == null, `query limit ${captured.limit}`));
check('totalAmount covers the returned rows only', () => assert.equal(top2.totalAmount, -95000));

rows = [row('Refund', 500), row('Rent', -90000)];
const all = await tool.call({ ...DATES });
check('NEGATIVE: a refund does not outrank spending', () =>
  assert.deepEqual(all.summary.map((r) => r.payeeName), ['Rent', 'Refund']));
rows = [row('Zeta', -700), row('Alpha', -700), row('Big', -900)];
const tied = await tool.call({ ...DATES });
check('equal totals come back in payee name order', () =>
  assert.deepEqual(tied.summary.map((r) => r.payeeName), ['Big', 'Alpha', 'Zeta']));

// A negative limit used to reach the query as an unlimited LIMIT; after the sort it would
// become slice(0, -3) and drop rows from the end, so the schema refuses it.
for (const bad of [-3, 0]) {
  let err;
  captured = undefined;
  try { await tool.call({ ...DATES, limit: bad }); } catch (e) { err = e; }
  check(`NEGATIVE: limit ${bad} is refused by the schema, naming limit and its minimum, before any query`, () => {
    assert.equal(err?.name, 'ZodError');
    assert.deepEqual(err.issues[0].path, ['limit']);
    assert.match(err.issues[0].message, />=\s*1|at least 1|greater than or equal to 1/i);
    assert.equal(captured, undefined);
  });
}
check('the legacy description states the ordering the code has', () => {
  assert.match(tool.description, /largest spending first/i);
  assert.doesNotMatch(tool.description, /highest first/i);
  assert.match(tool.description, /sum of the returned rows/i);
});

console.log(`[summary-by-payee-filter-and-order] Results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
