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
// ---- #756: the named routes need their name ----

await check('#756 NEGATIVE: by category without category_name is refused naming the field', () => refused({ by: 'category', start_date: '2019-03-01' }, /category_name.*required for action: category/));
await check('#756 NEGATIVE: by category with a null category_name is refused naming the field', () => refused({ by: 'category', category_name: null }, /category_name/));
await check('#756 NEGATIVE: by payee without payee_name is refused naming the field', () => refused({ by: 'payee', account_id: A }, /payee_name.*required for action: payee/));
await check('#756 NEGATIVE: by payee with a null payee_name is refused naming the field', () => refused({ by: 'payee', payee_name: null }, /payee_name/));
await check('#756: by category and by payee with the name forward as before', async () => {
  await expectCall({ by: 'category', category_name: 'Food' }, 'actual_transactions_search_by_category', { categoryName: 'Food' });
  await expectCall({ by: 'payee', payee_name: 'Costco', account_id: A }, 'actual_transactions_search_by_payee', { payeeName: 'Costco', accountId: A });
});
await check('#756: by amount and by month still take their names as optional', async () => {
  await expectCall({ by: 'amount', absolute_amount: 5, account_id: A }, 'actual_transactions_search_by_amount', { absoluteAmount: 5, accountId: A });
  await expectCall({ by: 'month' }, 'actual_transactions_search_by_month', {});
});
await check('#756: the published schema still types category_name and payee_name and requires only by', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(js.properties.category_name.type, 'string');
  assert.strictEqual(js.properties.payee_name.type, 'string');
  assert.deepStrictEqual(js.required, ['by']);
});
await check('#756: the off-budget refusal reaches the caller naming search_transactions with by account, not the legacy tool', async () => {
  const { refuseOffBudgetAccount } = await import('../../dist/src/lib/search-account-guard.js');
  const throwing = buildCompactTool(spec, { callOperation: async () => refuseOffBudgetAccount([{ id: A, offbudget: true }], A) }, phrases);
  let e;
  try { await throwing.call({ by: 'filter', account_id: A }); } catch (x) { e = x; }
  assert.ok(e && isPreflightRefusal(e), 'a preflight refusal');
  assert.ok(e.message.includes(A) && e.message.includes('search_transactions with by account'), e.message);
  assert.ok(!e.message.includes('actual_transactions_get'), e.message);
});
await check('#756: the Behavior line says the names are needed and which routes refuse an off-budget account_id', () => {
  const line = spec.description.split('\n').find((l) => l.startsWith('Behavior:'));
  assert.ok(line.includes('category and payee need their name'), line);
  assert.ok(line.includes('filter, category, month refuse an off-budget account_id'), line);
});

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
await check('#755: the description names hasMore and says count and totalAmount cover the returned rows', () => {
  assert.ok(spec.description.includes('{ transactions, count, totalAmount, hasMore } for amount, category, month, payee'));
  assert.ok(/hasMore: more exist; count and totalAmount cover returned rows/.test(spec.description));
});
await check('description: Returns, every action, siblings, no legacy name', () => {
  for (const w of ['Returns', 'summarize_transactions', 'list_entities', 'run_query', 'account:', 'filter:', 'amount:', 'category:', 'month:', 'payee:', 'uncategorized:']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});

// #712: the description is one line per `by` mode, the behaviours on a line of their own, and
// the readOnlyHint annotation is not restated. Each check is a pure function over a description
// string, so the negatives below can feed it a mutated description and prove it can fail.
const ALL_FIELDS = new Set([...spec.actions.values()].flatMap((r) => Object.keys(r.fields.shape)));
/** Field names on a mode line: whole snake_case words that are a field of some row. `month` is
 *  both a mode and a field, so the `<mode>: ` prefix is cut off before the words are read. */
function modeLineProblems(description) {
  const problems = [];
  const lines = description.split('\n');
  for (const [mode, r] of spec.actions) {
    const mine = lines.filter((l) => l.startsWith(`${mode}: `));
    if (mine.length !== 1) { problems.push(`${mode}: ${mine.length} lines start with "${mode}: ", expected 1`); continue; }
    // Only the list before any parenthesis counts: a prose aside such as "(no limit)" names a
    // field without listing it.
    const listed = new Set((mine[0].slice(mode.length + 2).split('(')[0].match(/[a-z]+(?:_[a-z]+)*/g) ?? []).filter((w) => ALL_FIELDS.has(w)));
    const taken = Object.keys(r.fields.shape);
    for (const f of taken) if (!listed.has(f)) problems.push(`${mode} is missing ${f}`);
    for (const f of listed) if (!taken.includes(f)) problems.push(`${mode} lists ${f}, which its row does not take`);
  }
  return problems;
}
const BEHAVIOR_FACTS = ['off-budget', 'no limit', 'default 100', 'default 50', 'error field', 'Category or notes filters match a split by child (parent_id)'];
function behaviorProblems(description) {
  const mine = description.split('\n').filter((l) => l.startsWith('Behavior:'));
  if (mine.length === 0) return ['no line starts with "Behavior:"'];
  if (mine.length > 1) return [`${mine.length} lines start with "Behavior:", expected 1`];
  // #755: the Behavior text runs on into a `Limits:` line (a single line passed the 400 character cap).
  const block = [mine[0], ...description.split('\n').filter((l) => l.startsWith('Limits:'))].join('\n');
  return BEHAVIOR_FACTS.filter((fact) => !block.includes(fact)).map((fact) => `the Behavior line does not say "${fact}"`);
}
function restatementProblems(description) {
  return /read-only/i.test(description) ? ['search_transactions must not restate Read-only'] : [];
}
const mutateLine = (prefix, fn) => spec.description.split('\n').map((l) => (l.startsWith(prefix) ? fn(l) : l)).join('\n');

await check('#712: every mode has one line listing exactly the fields of its row', () => {
  assert.deepStrictEqual(modeLineProblems(spec.description), []);
});
await check('#712 NEGATIVE: a field dropped from the filter line is reported', () => {
  const mutated = mutateLine('filter: ', (l) => l.replace(' payee_id,', ''));
  assert.notStrictEqual(mutated, spec.description);
  assert.deepStrictEqual(modeLineProblems(mutated), ['filter is missing payee_id']);
});
await check('#712 NEGATIVE: a field the account row does not take is reported', () => {
  const mutated = mutateLine('account: ', (l) => l.replace(/\.$/, ', limit.'));
  assert.notStrictEqual(mutated, spec.description);
  assert.deepStrictEqual(modeLineProblems(mutated), ['account lists limit, which its row does not take']);
});
await check('#712 NEGATIVE: a field named only in a parenthesis does not count as listed', () => {
  const mutated = mutateLine('category: ', (l) => l.replace(', limit.', ' (no limit).'));
  assert.notStrictEqual(mutated, spec.description);
  assert.deepStrictEqual(modeLineProblems(mutated), ['category is missing limit']);
});
await check('#712: the behaviours sit on one Behavior line', () => {
  assert.deepStrictEqual(behaviorProblems(spec.description), []);
});
await check('#712 NEGATIVE: a description with no Behavior line is reported', () => {
  const mutated = spec.description.split('\n').filter((l) => !l.startsWith('Behavior:')).join('\n');
  assert.deepStrictEqual(behaviorProblems(mutated), ['no line starts with "Behavior:"']);
});
await check('#712 NEGATIVE: a Behavior line that loses a fact is reported', () => {
  const mutated = mutateLine('Limits:', (l) => l.replace('default 50', 'a default'));
  assert.deepStrictEqual(behaviorProblems(mutated), ['the Behavior line does not say "default 50"']);
});
await check('#712: the readOnlyHint annotation is not restated in the description', () => {
  assert.deepStrictEqual(restatementProblems(spec.description), []);
  assert.strictEqual(annotationsFor('search_transactions').readOnlyHint, true);
});
await check('#712 NEGATIVE: a restated Read-only is reported', () => {
  const lines = spec.description.split('\n');
  lines[0] += ' Read-only.';
  assert.deepStrictEqual(restatementProblems(lines.join('\n')), ['search_transactions must not restate Read-only']);
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

await check('#702: the notes field warns that the match is a substring (#trip also finds #tripod)', () => {
  assert.ok(z.toJSONSchema(tool.inputSchema).properties.notes.description.includes('#tripod'));
});
console.log(`\n[compact-search-transactions] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
