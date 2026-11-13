// tests/unit/compact_search_transactions.test.js
//
// #673: the compact search_transactions tool. A stubbed callOperation records the exact legacy
// tool name and arguments every row produces (only the fields the caller passed, renamed to
// the legacy camelCase), and each refusal is proven to call nothing.
//
// Run: node tests/unit/compact_search_transactions.test.js   (needs `npm run build` first)

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
console.log('\n[compact-search-transactions]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'search_transactions');
assert.ok(spec, 'search_transactions is registered');

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

// ---- one positive per row, full field set, renamed ----

await check('by account forwards accountId, startDate, endDate', () =>
  expectCall({ by: 'account', account_id: A, start_date: '2026-01-01', end_date: '2026-01-31' }, 'actual_transactions_get', { accountId: A, startDate: '2026-01-01', endDate: '2026-01-31' }));
await check('by account with nothing else sends no arguments (no defaults)', () => expectCall({ by: 'account' }, 'actual_transactions_get', {}));
await check('by filter forwards all ten fields renamed, including false booleans', () =>
  expectCall({ by: 'filter', account_id: A, start_date: '2026-01-01', end_date: '2026-01-31', min_amount: -9000, max_amount: -100, category_id: 'c1', payee_id: 'p1', notes: 'rent', cleared: false, reconciled: true },
    'actual_transactions_filter',
    { accountId: A, startDate: '2026-01-01', endDate: '2026-01-31', minAmount: -9000, maxAmount: -100, categoryId: 'c1', payeeId: 'p1', notes: 'rent', cleared: false, reconciled: true }));
await check('by amount forwards the range, absolute_amount, category_name and limit', () =>
  expectCall({ by: 'amount', min_amount: -500, max_amount: 500, absolute_amount: 5000, account_id: A, category_name: 'Food', limit: 5 },
    'actual_transactions_search_by_amount', { minAmount: -500, maxAmount: 500, absoluteAmount: 5000, accountId: A, categoryName: 'Food', limit: 5 }));
await check('by category forwards category_name and the date and amount bounds', () =>
  expectCall({ by: 'category', category_name: 'Food', start_date: '2026-02-01', end_date: '2026-02-28', account_id: A, min_amount: -10, max_amount: 10, limit: 3 },
    'actual_transactions_search_by_category', { categoryName: 'Food', startDate: '2026-02-01', endDate: '2026-02-28', accountId: A, minAmount: -10, maxAmount: 10, limit: 3 }));
await check('by month forwards month, payee_name and category_name', () =>
  expectCall({ by: 'month', month: '2026-03', account_id: A, category_name: 'Food', payee_name: 'Shop', min_amount: 1, max_amount: 2, limit: 9 },
    'actual_transactions_search_by_month', { month: '2026-03', accountId: A, categoryName: 'Food', payeeName: 'Shop', minAmount: 1, maxAmount: 2, limit: 9 }));
await check('by month with no month sends no month (legacy defaults to the current one)', () => expectCall({ by: 'month' }, 'actual_transactions_search_by_month', {}));
await check('by payee forwards payee_name and the bounds', () =>
  expectCall({ by: 'payee', payee_name: 'Shop', start_date: '2026-01-01', end_date: '2026-12-31', account_id: A, category_name: 'Food', min_amount: 1, max_amount: 2, limit: 4 },
    'actual_transactions_search_by_payee', { payeeName: 'Shop', startDate: '2026-01-01', endDate: '2026-12-31', accountId: A, categoryName: 'Food', minAmount: 1, maxAmount: 2, limit: 4 }));
await check('by uncategorized forwards include_transactions, limit and offset', () =>
  expectCall({ by: 'uncategorized', start_date: '2026-01-01', end_date: '2026-01-31', account_id: A, include_transactions: true, limit: 20, offset: 40 },
    'actual_transactions_uncategorized', { startDate: '2026-01-01', endDate: '2026-01-31', accountId: A, includeTransactions: true, limit: 20, offset: 40 }));
await check('every call makes exactly one legacy call and returns its value unchanged', async () => {
  const r = await run({ by: 'filter', notes: 'x' });
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(r, { from: 'actual_transactions_filter' });
});

// ---- refusals: nothing is called ----

await check('NEGATIVE: a missing selector is refused naming by', () => refused({}, /by/));
await check('NEGATIVE: an unknown selector value is refused naming by', () => refused({ by: 'frobnicate' }, /by/));
await check('NEGATIVE: a field the row does not take is refused naming field and row (payee_name on amount)', () => refused({ by: 'amount', payee_name: 'x' }, /payee_name.*not valid for by: amount/));
await check('NEGATIVE: filter fields on another row are refused (category_id on category)', () => refused({ by: 'category', category_id: 'c' }, /category_id.*not valid for by: category/));
await check('NEGATIVE: absolute_amount on payee is refused', () => refused({ by: 'payee', absolute_amount: 1 }, /absolute_amount/));
await check('NEGATIVE: month on payee is refused', () => refused({ by: 'payee', month: '2026-01' }, /month/));
await check('NEGATIVE: an unknown field is refused', () => refused({ by: 'account', bogus: 1 }, /bogus/));
await check('NEGATIVE: a malformed date is refused', () => refused({ by: 'account', start_date: '2026/01/01' }, /start_date/));
await check('NEGATIVE: a malformed month is refused', () => refused({ by: 'month', month: '2026-3' }, /month/));
await check('NEGATIVE: a non-integer amount is refused', () => refused({ by: 'filter', min_amount: 1.5 }, /min_amount/));
await check('NEGATIVE: a zero limit is refused', () => refused({ by: 'amount', limit: 0 }, /limit/));
await check('NEGATIVE: a negative offset is refused', () => refused({ by: 'uncategorized', offset: -1 }, /offset/));
await check('a null field is treated as absent (clients that send null for every optional field)', () =>
  expectCall({ by: 'filter', account_id: null, category_id: null, start_date: '2026-01-01' }, 'actual_transactions_filter', { startDate: '2026-01-01' }));
await check('NEGATIVE: a null selector is still refused naming by', () => refused({ by: null }, /by/));
await check('NEGATIVE: by amount with no account and no date is refused in compact field names', () =>
  refused({ by: 'amount', absolute_amount: 5000 }, /account_id[^]*at least one of account_id, start_date, end_date/));
await check('by amount bounded by a date alone is accepted', () =>
  expectCall({ by: 'amount', absolute_amount: 5000, end_date: '2026-01-31' }, 'actual_transactions_search_by_amount', { absoluteAmount: 5000, endDate: '2026-01-31' }));
await check('NEGATIVE: a limit over 1000 is refused', () => refused({ by: 'uncategorized', limit: 5000 }, /limit/));
await check('NEGATIVE: camelCase legacy keys are refused', () => refused({ by: 'account', accountId: A }, /accountId/));

// ---- published shape and metadata ----

await check('published schema: flat object, by required, no oneOf or anyOf, every property typed and described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.type, 'object');
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(js.properties)));
  assert.deepStrictEqual(js.required, ['by']);
  assert.deepStrictEqual(js.properties.by.enum, ['account', 'filter', 'amount', 'category', 'month', 'payee', 'uncategorized']);
  for (const [k, v] of Object.entries(js.properties)) {
    if (k === 'by') continue;
    assert.ok(v.description, `${k} has no description`);
    assert.ok(v.type, `${k} is untyped`);
  }
  assert.ok(/d\{4\}-/.test(js.properties.start_date.pattern), 'dates keep the YYYY-MM-DD pattern');
  assert.strictEqual(js.properties.limit.type, 'integer');
});
await check('description: read-only, Returns, every action, siblings, no legacy name', () => {
  for (const w of ['Read-only', 'Returns', 'summarize_transactions', 'list_entities', 'run_query', 'account:', 'filter:', 'amount:', 'category:', 'month:', 'payee:', 'uncategorized:']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: read-only, and no row target is write-capable', () => {
  assert.strictEqual(annotationsFor('search_transactions').readOnlyHint, true);
  for (const n of compactLegacyNames(spec)) assert.ok(!WRITE_CAPABLE.has(n), n);
});
await check('compactLegacyNames covers the seven targets', () => {
  assert.deepStrictEqual([...compactLegacyNames(spec)].sort(), [
    'actual_transactions_filter', 'actual_transactions_get', 'actual_transactions_search_by_amount', 'actual_transactions_search_by_category',
    'actual_transactions_search_by_month', 'actual_transactions_search_by_payee', 'actual_transactions_uncategorized',
  ]);
});

// ---- 4b rewrite ----

await check('4b: a typed refusal naming a legacy tool is rewritten in place and stays a NotFoundRefusal', async () => {
  const err = new NotFoundRefusal('Account', 'abc', 'actual_transactions_filter');
  const t = buildCompactTool(spec, { callOperation: async () => { throw err; } }, phrases);
  const e = await t.call({ by: 'filter' }).catch((x) => x);
  assert.strictEqual(e, err);
  assert.ok(e instanceof NotFoundRefusal && isPreflightRefusal(e));
  assert.ok(!/actual_/.test(e.message) && /search_transactions with by filter/.test(e.message), e.message);
});
await check('4b: a returned top-level error string is rewritten', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ error: 'Unbounded query via actual_transactions_search_by_amount' }) }, phrases);
  const r = await t.call({ by: 'amount', start_date: '2026-01-01' });
  assert.ok(!/actual_/.test(r.error) && /search_transactions with by amount/.test(r.error), r.error);
});

console.log(`\n[compact-search-transactions] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
