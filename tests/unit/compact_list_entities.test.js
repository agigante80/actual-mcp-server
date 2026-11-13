// tests/unit/compact_list_entities.test.js
//
// #672: the compact list_entities tool. A stubbed callOperation records the exact legacy tool
// name and arguments every call produces (default rows and every route), and each refusal is
// proven to call nothing.
//
// Run: node tests/unit/compact_list_entities.test.js   (needs `npm run build` first)

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
console.log('\n[compact-list-entities]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases, compactLegacyNames } = await import('../../dist/src/compact/dispatch.js');
const { WRITE_CAPABLE } = await import('../../dist/src/lib/toolsets.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { NotFoundRefusal, isPreflightRefusal } = await import('../../dist/src/lib/errors.js');

const spec = COMPACT_TOOLS.find((t) => t.name === 'list_entities');
assert.ok(spec, 'list_entities is registered');

const U = '123e4567-e89b-42d3-a456-426614174000';
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

// ---- default rows: one per type ----

const DEFAULTS = {
  account: 'actual_accounts_list',
  account_group: 'actual_account_groups_list',
  category: 'actual_categories_get',
  category_group: 'actual_category_groups_get',
  payee: 'actual_payees_get',
  tag: 'actual_tags_list',
  rule: 'actual_rules_get',
  schedule: 'actual_schedules_get',
  budget_file: 'actual_budgets_list_available',
};
for (const [type, legacy] of Object.entries(DEFAULTS)) {
  await check(`type ${type} alone calls ${legacy} with no arguments`, () => expectCall({ type }, legacy, {}));
}
await check('type note with id calls actual_notes_get with the id', () => expectCall({ type: 'note', id: U }, 'actual_notes_get', { id: U }));
await check('type note with a budget month id', () => expectCall({ type: 'note', id: 'budget-1970-01' }, 'actual_notes_get', { id: 'budget-1970-01' }));

// ---- routes ----

for (const [type, plural] of [['account', 'accounts'], ['category', 'categories'], ['payee', 'payees']]) {
  await check(`${type} + query calls actual_entities_search with type ${plural}`, () =>
    expectCall({ type, query: 'groc' }, 'actual_entities_search', { query: 'groc', type: plural }));
  await check(`${type} + name calls actual_get_id_by_name with type ${plural}`, () =>
    expectCall({ type, name: 'Cash' }, 'actual_get_id_by_name', { name: 'Cash', type: plural }));
}
await check('query with match_type and limit renames match_type to matchType', () =>
  expectCall({ type: 'account', query: 'x', match_type: 'fuzzy', limit: 5 }, 'actual_entities_search', { query: 'x', matchType: 'fuzzy', limit: 5, type: 'accounts' }));
await check('query accepts an array of strings', () =>
  expectCall({ type: 'category', query: ['a', 'b'] }, 'actual_entities_search', { query: ['a', 'b'], type: 'categories' }));
await check('payee + sort frequency calls actual_payees_common_list and does not forward sort', () =>
  expectCall({ type: 'payee', sort: 'frequency' }, 'actual_payees_common_list', {}));
await check('rule + payee_id calls actual_payee_rules_get with payeeId', () =>
  expectCall({ type: 'rule', payee_id: U }, 'actual_payee_rules_get', { payeeId: U }));
await check('schedule + name calls actual_get_id_by_name with type schedules', () =>
  expectCall({ type: 'schedule', name: 'Rent' }, 'actual_get_id_by_name', { name: 'Rent', type: 'schedules' }));
await check('schedule + schedule_id (+ start, end, count) calls actual_schedules_dates', () =>
  expectCall({ type: 'schedule', schedule_id: U, start: '1970-01-01', end: '1970-12-31', count: 3 }, 'actual_schedules_dates', { schedule_id: U, start: '1970-01-01', end: '1970-12-31', count: 3 }));
await check('schedule_id alone sends only the id', () => expectCall({ type: 'schedule', schedule_id: U }, 'actual_schedules_dates', { schedule_id: U }));
await check('budget_file scope configured calls actual_budgets_list_available and does not forward scope', () =>
  expectCall({ type: 'budget_file', scope: 'configured' }, 'actual_budgets_list_available', {}));
await check('budget_file scope server calls actual_budgets_get_all with no arguments', () =>
  expectCall({ type: 'budget_file', scope: 'server' }, 'actual_budgets_get_all', {}));
await check('exactly one callOperation per call and the legacy value is returned unwrapped', async () => {
  const r = await run({ type: 'tag' });
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(r, { from: 'actual_tags_list' });
});

// ---- negatives ----

await check('NEGATIVE: type is required', () => refused({}, /type/));
await check('NEGATIVE: unknown and prototype types are refused', async () => {
  await refused({ type: 'transaction' });
  await refused({ type: 'constructor' });
});
await check('NEGATIVE: query and name together are refused as mutually exclusive', () => refused({ type: 'account', query: 'x', name: 'y' }, /mutually exclusive/));
await check('NEGATIVE: sort with query is refused as mutually exclusive', () => refused({ type: 'payee', query: 'x', sort: 'frequency' }, /mutually exclusive/));
await check('NEGATIVE: schedule_id with name is refused as mutually exclusive', () => refused({ type: 'schedule', name: 'r', schedule_id: U }, /mutually exclusive/));
await check('NEGATIVE: sort is refused on a type that does not take it, naming the field and the valid type', () => refused({ type: 'account', sort: 'frequency' }, /sort.*payee/));
await check('NEGATIVE: sort other than frequency is refused', () => refused({ type: 'payee', sort: 'alpha' }, /sort/));
await check('NEGATIVE: match_type or limit without query is refused', async () => {
  await refused({ type: 'account', match_type: 'exact' }, /query: required with match_type/);
  await refused({ type: 'account', limit: 5 }, /query: required with limit/);
});
await check('NEGATIVE: start, end or count without schedule_id is refused', async () => {
  await refused({ type: 'schedule', start: '1970-01-01' }, /schedule_id: required with start/);
  await refused({ type: 'schedule', count: 2 }, /schedule_id: required with count/);
});
await check('NEGATIVE: query on a type with no search (tag, schedule, rule) is refused naming the valid types', async () => {
  await refused({ type: 'tag', query: 'x' }, /query.*not valid for type: tag/);
  await refused({ type: 'schedule', query: 'x' }, /query/);
  await refused({ type: 'rule', query: 'x' }, /query/);
});
await check('NEGATIVE: name on a type without name resolution is refused', () => refused({ type: 'tag', name: 'x' }, /name/));
await check('NEGATIVE: note without id, with a blank id, or with scope is refused', async () => {
  await refused({ type: 'note' }, /id: required for type: note/);
  await refused({ type: 'note', id: '' });
  await refused({ type: 'note', id: U, scope: 'server' }, /scope/);
});
await check('NEGATIVE: id on a type that does not take it is refused', () => refused({ type: 'account', id: U }, /"id"[^]*not valid for type: account; valid only for type: note/));
await check('NEGATIVE: malformed payee_id, schedule_id and dates are refused once, with their own message', async () => {
  await refused({ type: 'rule', payee_id: 'bad' }, /payee_id/);
  await refused({ type: 'schedule', schedule_id: 'bad' }, /schedule_id/);
  await refused({ type: 'schedule', schedule_id: U, start: '01/01/1970' }, /start/);
  seen.length = 0;
  const e = await tool.call({ type: 'rule', payee_id: 'bad' }).catch((x) => x);
  assert.strictEqual((e.message.match(/Invalid payee ID/g) ?? []).length, 1, e.message);
});
await check('NEGATIVE: limit and count out of range, empty query and name are refused', async () => {
  await refused({ type: 'account', query: 'x', limit: 0 });
  await refused({ type: 'account', query: 'x', limit: 101 });
  await refused({ type: 'schedule', schedule_id: U, count: 367 });
  await refused({ type: 'account', query: '' });
  await refused({ type: 'account', name: '' });
});
await check('NEGATIVE: scope other than configured or server is refused', () => refused({ type: 'budget_file', scope: 'all' }));
await check('NEGATIVE: scope on another type is refused', () => refused({ type: 'tag', scope: 'server' }, /scope/));
await check('NEGATIVE: an unknown key is refused', () => refused({ type: 'tag', bogus: 1 }, /bogus/));

// ---- published shape and metadata ----

await check('published schema: no oneOf/anyOf outside the query union, no outputSchema, every property described', () => {
  const js = z.toJSONSchema(tool.inputSchema);
  assert.strictEqual(tool.outputSchema, undefined);
  assert.strictEqual(js.oneOf, undefined);
  assert.strictEqual(js.anyOf, undefined);
  const { query, ...rest } = js.properties;
  assert.ok(query.anyOf, 'query is the one string-or-array union, as in the legacy entities_search');
  assert.ok(!/oneOf|anyOf/.test(JSON.stringify(rest)));
  for (const [k, v] of Object.entries(js.properties)) if (k !== 'type') assert.ok(v.description, `${k} has no description`);
  assert.deepStrictEqual(js.required, ['type']);
});
await check('description: read-only, Returns, every type, the sibling tool, no legacy name', () => {
  for (const w of ['Read-only', 'Returns', 'get_context', ...Object.keys(DEFAULTS), 'note']) assert.ok(spec.description.includes(w), w);
  assert.ok(!/actual_/.test(spec.description));
});
await check('annotations: read-only, and no row or route target is write-capable', () => {
  assert.strictEqual(annotationsFor('list_entities').readOnlyHint, true);
  for (const n of compactLegacyNames(spec)) assert.ok(!WRITE_CAPABLE.has(n), n);
});
await check('compactLegacyNames covers every default and route target of the shipped tool', () => {
  const names = compactLegacyNames(spec);
  for (const n of [...Object.values(DEFAULTS), 'actual_notes_get', 'actual_entities_search', 'actual_get_id_by_name', 'actual_payees_common_list', 'actual_payee_rules_get', 'actual_schedules_dates', 'actual_budgets_get_all']) assert.ok(names.includes(n), n);
});

// ---- 4b rewrite ----

await check('4b: a typed refusal naming a legacy tool is rewritten in place and stays a NotFoundRefusal', async () => {
  const err = new NotFoundRefusal('Account', 'abc', 'actual_accounts_list');
  const t = buildCompactTool(spec, { callOperation: async () => { throw err; } }, phrases);
  const e = await t.call({ type: 'account' }).catch((x) => x);
  assert.strictEqual(e, err);
  assert.ok(e instanceof NotFoundRefusal && isPreflightRefusal(e));
  assert.ok(!/actual_/.test(e.message) && /list_entities with type account/.test(e.message), e.message);
});
await check('4b: a returned top-level error string is rewritten to the route phrase', async () => {
  const t = buildCompactTool(spec, { callOperation: async () => ({ error: 'bad call to actual_entities_search' }) }, phrases);
  const r = await t.call({ type: 'account', query: 'x' });
  assert.ok(!/actual_/.test(r.error) && /list_entities with type and query/.test(r.error), r.error);
});

console.log(`\n[compact-list-entities] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
