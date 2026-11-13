// tests/unit/compact_summarize_transactions.test.js
//
// #673: the compact summarize_transactions tool. A stubbed callOperation records the exact legacy
// tool name and arguments every row produces (only the fields the caller passed, renamed to
// the legacy camelCase), and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_summarize_transactions.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[compact-summarize-transactions]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'summarize_transactions');
assert.ok(spec, 'summarize_transactions is registered');

const A = '123e4567-e89b-42d3-a456-426614174000';
const seen = [];
const ops = { callOperation: async (n, a) => { seen.push({ n, a }); return { from: n }; } };
const phrases = legacyPhrases(COMPACT_TOOLS);
const tool = buildCompactTool(spec, ops, phrases);
const run = async (input) => { seen.length = 0; return tool.call(input); };
const refused = async (input, re) => {
  seen.length = 0;
  let e;
  try { await tool.call(input); } catch (x) { e = x; }
  assert.ok(e, `expected a refusal for ${JSON.stringify(input)}`);
  const text = [e.message, ...(e.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`)].join(' | ');
  if (re) assert.ok(re.test(text), `${re} vs ${text}`);
  assert.strictEqual(seen.length, 0, 'a refusal must not call anything');
};
const expectCall = async (input, n, a) => {
  await run(input);
  assert.deepStrictEqual(seen, [{ n, a }], JSON.stringify(input));
};

// ---- one positive per row, renamed ----

await check('by_category forwards the dates, accountId and includeIncome (false kept)', () =>
  expectCall({ report: 'by_category', start_date: '2026-01-01', end_date: '2026-01-31', account_id: A, include_income: false },
    'actual_transactions_summary_by_category', { startDate: '2026-01-01', endDate: '2026-01-31', accountId: A, includeIncome: false }));
await check('by_category with nothing else sends no arguments (no defaults)', () => expectCall({ report: 'by_category' }, 'actual_transactions_summary_by_category', {}));
await check('by_payee forwards the dates, accountId and limit', () =>
  expectCall({ report: 'by_payee', start_date: '2026-01-01', end_date: '2026-01-31', account_id: A, limit: 10 },
    'actual_transactions_summary_by_payee', { startDate: '2026-01-01', endDate: '2026-01-31', accountId: A, limit: 10 }));
await check('grouped with one grouping forwards the string', () =>
  expectCall({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-03-31', group_by: 'month' },
    'actual_transactions_aggregate', { startDate: '2026-01-01', endDate: '2026-03-31', groupBy: 'month' }));
await check('grouped with an array of groupings forwards the array and every filter renamed', () =>
  expectCall({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-03-31', group_by: ['month', 'category'], account_ids: [A], category_ids: ['c'], category_group_ids: ['g'], payee_ids: ['p'], include_income: true, exclude_transfers: false },
    'actual_transactions_aggregate',
    { startDate: '2026-01-01', endDate: '2026-03-31', groupBy: ['month', 'category'], accountIds: [A], categoryIds: ['c'], categoryGroupIds: ['g'], payeeIds: ['p'], includeIncome: true, excludeTransfers: false }));
await check('account_flow forwards the dates and accountIds', () =>
  expectCall({ report: 'account_flow', start_date: '2026-01-01', end_date: '2026-01-31', account_ids: [A] },
    'actual_account_flow_summary', { startDate: '2026-01-01', endDate: '2026-01-31', accountIds: [A] }));
await check('recurring with months forwards the rest renamed', () =>
  expectCall({ report: 'recurring', months: 6, account_ids: [A], min_occurrences: 4, include_inactive: true },
    'actual_recurring_expenses_summary', { months: 6, accountIds: [A], minOccurrences: 4, includeInactive: true }));
await check('recurring with a start_date and no months', () =>
  expectCall({ report: 'recurring', start_date: '2026-01-01', end_date: '2026-06-30' }, 'actual_recurring_expenses_summary', { startDate: '2026-01-01', endDate: '2026-06-30' }));
await check('recurring with nothing sends no arguments', () => expectCall({ report: 'recurring' }, 'actual_recurring_expenses_summary', {}));
await check('balance sends account_id as id, and cutoff', () =>
  expectCall({ report: 'balance', account_id: A, cutoff: '2026-01-31' }, 'actual_accounts_get_balance', { id: A, cutoff: '2026-01-31' }));
await check('balance without cutoff sends only id', () => expectCall({ report: 'balance', account_id: A }, 'actual_accounts_get_balance', { id: A }));
await check('every call makes exactly one legacy call and returns its value unchanged', async () => {
  const r = await run({ report: 'by_payee' });
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(r, { from: 'actual_transactions_summary_by_payee' });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: a missing selector is refused naming report', () => refused({}, /report/));
await check('NEGATIVE: an unknown report is refused naming report', () => refused({ report: 'frobnicate' }, /report/));
await check('NEGATIVE: account_ids on by_payee is refused naming the field', () => refused({ report: 'by_payee', account_ids: [A] }, /account_ids.*not valid for report: by_payee/));
await check('NEGATIVE: account_id on account_flow is refused', () => refused({ report: 'account_flow', start_date: '2026-01-01', end_date: '2026-01-02', account_ids: [A], account_id: A }, /account_id/));
await check('NEGATIVE: limit on by_category is refused', () => refused({ report: 'by_category', limit: 3 }, /limit/));
await check('NEGATIVE: cutoff on recurring is refused', () => refused({ report: 'recurring', cutoff: '2026-01-01' }, /cutoff/));
await check('NEGATIVE: group_by on account_flow is refused', () => refused({ report: 'account_flow', start_date: '2026-01-01', end_date: '2026-01-02', account_ids: [A], group_by: 'month' }, /group_by/));
await check('NEGATIVE: grouped without group_by is refused', () => refused({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-01-02' }, /required for report: grouped.*group_by|group_by.*required for report: grouped/));
await check('NEGATIVE: grouped without dates is refused naming both', () => refused({ report: 'grouped', group_by: 'month' }, /start_date.*required|required.*start_date/));
await check('NEGATIVE: grouped with an empty group_by array is refused', () => refused({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-01-02', group_by: [] }, /group_by/));
await check('NEGATIVE: grouped with six groupings is refused', () => refused({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-01-02', group_by: ['month', 'category', 'category_group', 'payee', 'account', 'month'] }, /group_by/));
await check('NEGATIVE: grouped with an unknown grouping is refused', () => refused({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-01-02', group_by: 'week' }, /group_by/));
await check('NEGATIVE: grouped with end before start is refused', () => refused({ report: 'grouped', start_date: '2026-02-01', end_date: '2026-01-01', group_by: 'month' }, /end_date/));
await check('NEGATIVE: account_flow without account_ids is refused', () => refused({ report: 'account_flow', start_date: '2026-01-01', end_date: '2026-01-02' }, /account_ids/));
await check('NEGATIVE: account_flow with an empty account_ids is refused', () => refused({ report: 'account_flow', start_date: '2026-01-01', end_date: '2026-01-02', account_ids: [] }, /account_ids/));
await check('NEGATIVE: account_flow with end before start is refused', () => refused({ report: 'account_flow', start_date: '2026-02-01', end_date: '2026-01-01', account_ids: [A] }, /end_date/));
await check('NEGATIVE: recurring with both months and start_date is refused', () => refused({ report: 'recurring', months: 3, start_date: '2026-01-01' }, /months/));
await check('NEGATIVE: recurring with months 61 is refused', () => refused({ report: 'recurring', months: 61 }, /months/));
await check('NEGATIVE: recurring with min_occurrences 1 is refused', () => refused({ report: 'recurring', min_occurrences: 1 }, /min_occurrences/));
await check('NEGATIVE: balance without account_id is refused', () => refused({ report: 'balance' }, /account_id.*required|required.*account_id/));
await check('NEGATIVE: balance with an account name is refused naming account_id', () => refused({ report: 'balance', account_id: 'Checking' }, /account_id/));
await check('NEGATIVE: balance with a malformed cutoff is refused', () => refused({ report: 'balance', account_id: A, cutoff: '31-01-2026' }, /cutoff/));
await check('NEGATIVE: camelCase legacy keys are refused', () => refused({ report: 'by_payee', accountId: A }, /accountId/));

// ---- published shape and metadata ----

await check('published schema: flat object, report required, no root oneOf or anyOf, every property described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  assert.deepStrictEqual(js.required, ['report']);
  assert.deepStrictEqual(js.properties.report.enum, ['by_category', 'by_payee', 'grouped', 'account_flow', 'recurring', 'balance']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'report') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type || v.anyOf, `${k} is untyped`);
  }
  // group_by is the one deliberate union (a string or an array), as in the legacy tool.
  assert.ok(js.properties.group_by.anyOf, 'group_by is string or array');
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify({ ...js.properties, group_by: undefined })));
  assert.strictEqual(js.properties.account_ids.type, 'array');
});
await check('description: read-only, Returns, every report, siblings, no legacy name', () => {
  for (const w of ['Read-only', 'Returns', 'search_transactions', 'list_entities', 'run_query', 'by_category:', 'by_payee:', 'grouped:', 'account_flow:', 'recurring:', 'balance:']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: read-only, and no row target is write-capable', () => {
  assert.strictEqual(annotationsFor('summarize_transactions').readOnlyHint, true);
  for (const n of compactLegacyNames(spec)) assert.ok(!WRITE_CAPABLE.has(n), n);
});
await check('compactLegacyNames covers the six targets', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), [
    'actual_account_flow_summary', 'actual_accounts_get_balance', 'actual_recurring_expenses_summary',
    'actual_transactions_aggregate', 'actual_transactions_summary_by_category', 'actual_transactions_summary_by_payee',
  ]);
});

// ---- 4b rewrite ----

await check('4b: a typed refusal naming a legacy tool is rewritten in place and stays a NotFoundRefusal', async () => {
  const err = new NotFoundRefusal('Account', 'abc', 'actual_accounts_get_balance');
  const t = buildCompactTool(spec, { callOperation: async () => { throw err; } }, phrases);
  const e = await t.call({ report: 'balance', account_id: A }).catch((x) => x);
  assert.strictEqual(e, err);
  assert.ok(e instanceof NotFoundRefusal && isPreflightRefusal(e));
  assert.ok(!/actual_/.test(e.message) && /summarize_transactions with report balance/.test(e.message), e.message);
});
await check('4b: a returned top-level error string is rewritten', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ error: 'nope via actual_transactions_aggregate', balance: null }) }, phrases);
  const r = await t.call({ report: 'grouped', start_date: '2026-01-01', end_date: '2026-01-02', group_by: 'month' });
  assert.ok(!/actual_/.test(r.error) && /summarize_transactions with report grouped/.test(r.error), r.error);
});

console.log(`\n[compact-summarize-transactions] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
