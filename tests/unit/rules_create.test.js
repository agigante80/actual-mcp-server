// tests/unit/rules_create.test.js
// #485: characterisation of actual_rules_create's input handling. It was written BEFORE the
// validation moved into src/lib/schemas/rules.ts and runs UNCHANGED after it, because it
// stubs adapter.createRule at the TOOL boundary (as rules_stage.test.js does). It therefore
// also stays valid across the adapter's reference guard, which lives below that boundary.
//
// Pins today's imperative rejections (message, throw or no throw, createRule call count),
// which no other unit file covered.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_create.test.js

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (label) => console.log(`  ok: ${label}`);
const fail = (label, d = '') => { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; };
const check = (cond, label, d = '') => cond ? pass(label) : fail(label, d);

const CAT = '11111111-1111-1111-1111-111111111111';

const adapterMod = await import('../../dist/src/lib/actual-adapter.js');
const adapter = adapterMod.default;
let calls = [];
adapter.createRule = async (rule) => { calls.push(rule); return 'rule-id-1'; };

const tool = (await import('../../dist/src/tools/rules_create.js')).default;

const attempt = async (input) => {
  calls = [];
  try {
    const res = await tool.call(input);
    return { threw: false, res, message: '' };
  } catch (e) {
    return { threw: true, res: null, message: String(e?.message ?? e) };
  }
};

const rule = (conditions, actions, extra = {}) => ({ conditions, actions, ...extra });
const okCond = { field: 'imported_payee', op: 'contains', value: 'X' };
const okAct = { op: 'set', field: 'category', value: CAT };

console.log('\n[#485] rules_create: valid input reaches the adapter once');
{
  const r = await attempt(rule([okCond], [okAct]));
  check(!r.threw, 'a valid rule does not throw', r.message);
  check(calls.length === 1, 'createRule called once', String(calls.length));
  check(r.res?.id === 'rule-id-1' && r.res?.success === true, 'returns { id, success: true }');
  check(calls[0]?.stage === null && calls[0]?.conditionsOp === 'and', 'post-parse defaults are sent (stage null, conditionsOp and)');
}

console.log('\n[#485] rules_create: imperative rejections');
{
  let r = await attempt(rule([okCond], [{ op: 'set', field: 'category', value: 'not-a-uuid' }]));
  check(r.threw && r.message === 'Action field "category" expects a category ID (UUID), but got text value "not-a-uuid". Use the category UUID from your budget data. You can list categories to find the correct UUID.', 'set category "not-a-uuid" throws with the exact message', r.message);
  check(calls.length === 0, '  and createRule is never called');

  r = await attempt(rule([okCond], [{ op: 'set', field: 'payee', value: 'Amazon' }]));
  check(r.threw && r.message.startsWith('Action field "payee" expects a payee ID (UUID), but got text value "Amazon".'), 'set payee with text throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'set', field: 'account', value: 'Checking' }]));
  check(r.threw && r.message.startsWith('Action field "account" expects an account ID (UUID), but got text value "Checking".'), 'set account with text throws', r.message);

  r = await attempt(rule([{ field: 'payee', op: 'is', value: 'Amazon' }], [okAct]));
  check(r.threw && r.message === 'Field "payee" expects a payee ID (UUID), but got text value "Amazon". To match payee names with text, use "imported_payee" field instead. Example: {field: "imported_payee", op: "contains", value: "Amazon"}', 'payee condition with a non-UUID value throws', r.message);
  check(calls.length === 0, '  and createRule is never called');

  r = await attempt(rule([{ field: 'category', op: 'is', value: 'Food' }], [okAct]));
  check(r.threw && r.message === 'Field "category" expects an ID (UUID), but got text value "Food". Use the category UUID from your budget data. List categories to find the correct UUID.', 'category condition with a non-UUID value throws', r.message);

  r = await attempt(rule([{ field: 'account', op: 'is', value: 'Chk' }], [okAct]));
  check(r.threw && r.message.endsWith('List accounts to find the correct UUID.'), 'account condition with a non-UUID value throws', r.message);

  r = await attempt(rule([{ field: 'category', op: 'oneOf', value: CAT }], [okAct]));
  check(r.threw && r.message === 'Operator "oneOf" requires a non-empty array of values (field: category). Example: {field: "category", op: "oneOf", value: ["uuid-1", "uuid-2"]}', 'oneOf with a non-array value throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'set', value: 'x' }]));
  check(r.threw && r.message === 'Action with op="set" requires a "field" property (e.g., "category", "payee", "notes", "cleared")', 'set without a field throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'append-notes', value: 5 }]));
  check(r.threw && r.message === 'Action "append-notes" requires a string value, but got number. Example: {op: "append-notes", value: "text to append"}', 'append-notes with a number throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'prepend-notes', value: true }]));
  check(r.threw && r.message.startsWith('Action "prepend-notes" requires a string value, but got boolean.') && r.message.endsWith('"text to prepend"}'), 'prepend-notes with a boolean throws', r.message);

  r = await attempt(rule([{ field: 'amount', op: 'contains', value: 5 }], [okAct]));
  check(r.threw && r.message === 'Invalid operator "contains" for field "amount". Field "amount" is a number field and only supports: is, isapprox, isbetween, gt, gte, lt, lte.', 'contains on amount throws', r.message);
  check(calls.length === 0, '  and createRule is never called');
}

console.log('\n[#485] rules_create: what is deliberately NOT rejected');
{
  // #711: an unknown condition field used to pass here; it is now refused (see the #711 block).
  const r2 = await attempt(rule([okCond], [{ op: 'link-schedule', value: 'sched-1' }]));
  check(!r2.threw && calls.length === 1, 'link-schedule value is not validated');
}

console.log('\n[#485] rules_create: Zod-shape rejections never reach the adapter');
{
  for (const [label, input] of [
    ['stage "default"', rule([okCond], [okAct], { stage: 'default' })],
    ['conditionsOp "xor"', rule([okCond], [okAct], { conditionsOp: 'xor' })],
    ['missing actions', { conditions: [okCond] }],
    ['missing conditions', { actions: [okAct] }],
  ]) {
    const r = await attempt(input);
    check(r.threw && calls.length === 0, `${label} is rejected before the adapter`);
  }
}

console.log('\n[#486] rules_create: still-rejected probes keep their exact error after the schema prose trim');
{
  const issuesOf = async (input) => {
    calls = [];
    try { await tool.call(input); return null; } catch (e) { return e?.issues ?? null; }
  };
  const issues = await issuesOf(rule([okCond], [okAct], { stage: 'default' }));
  check(Array.isArray(issues) && issues.length === 1 && issues[0].code === 'invalid_value' && issues[0].path.join('.') === 'stage',
    'stage "default" is a Zod invalid_value at stage', JSON.stringify(issues));
  check(calls.length === 0, '  and createRule is never called');
  const r = await attempt(rule([{ field: 'amount', op: 'contains', value: 5 }], [okAct]));
  check(r.threw && r.message === 'Invalid operator "contains" for field "amount". Field "amount" is a number field and only supports: is, isapprox, isbetween, gt, gte, lt, lte.',
    'amount with "contains" and a numeric value is an Invalid operator error', r.message);
}

console.log('\n[#703] rules_create: tag operators on notes');
{
  let r = await attempt(rule([{ field: 'notes', op: 'hasTags', value: '#trip' }], [okAct]));
  check(!r.threw && calls.length === 1, 'notes hasTags "#trip" is accepted and written once', r.message);
  check(calls[0]?.conditions?.[0]?.op === 'hasTags' && calls[0]?.conditions?.[0]?.value === '#trip', '  and the condition reaches the adapter unchanged');
  r = await attempt(rule([{ field: 'notes', op: 'hasAnyTag', value: '#trip #food' }], [okAct]));
  check(!r.threw && calls.length === 1, 'notes hasAnyTag "#trip #food" is accepted', r.message);

  r = await attempt(rule([{ field: 'imported_payee', op: 'hasTags', value: '#trip' }], [okAct]));
  check(r.threw && r.message === 'Invalid operator "hasTags" for field "imported_payee". Field "imported_payee" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf.',
    'NEGATIVE: imported_payee hasTags is an Invalid operator error with the exact message', r.message);
  check(calls.length === 0, '  and createRule is never called');
  r = await attempt(rule([{ field: 'imported_payee', op: 'hasTags', value: '' }], [okAct]));
  check(r.threw && r.message.startsWith('Invalid operator "hasTags" for field "imported_payee".'), 'NEGATIVE: the operator check runs before the tag value check', r.message);
  // #711: `description` is not an Actual field, so it is now refused as an unknown field.
  r = await attempt(rule([{ field: 'description', op: 'hasAnyTag', value: '#trip' }], [okAct]));
  check(r.threw && r.message.startsWith('Unknown condition field "description".'), 'NEGATIVE: description hasAnyTag is refused as an unknown field', r.message);

  for (const [label, value] of [['""', ''], ['"#"', '#'], ['"   "', '   '], ['"##"', '##'], ['a number', 5]]) {
    r = await attempt(rule([{ field: 'notes', op: 'hasTags', value }], [okAct]));
    check(r.threw && r.message === 'Operator "hasTags" needs at least one tag in its value, for example "#trip" (field: notes). Nothing was written.',
      `NEGATIVE: notes hasTags with ${label} is refused with the exact message`, r.message);
    check(calls.length === 0, '  and createRule is never called');
  }
  r = await attempt(rule([{ field: 'notes', op: 'hasAnyTag', value: ' # ' }], [okAct]));
  check(r.threw && r.message === 'Operator "hasAnyTag" needs at least one tag in its value, for example "#trip" (field: notes). Nothing was written.',
    'NEGATIVE: notes hasAnyTag with no tag names its own operator', r.message);
  r = await attempt(rule([{ field: 'notes', op: 'contains', value: '#' }], [okAct]));
  check(!r.threw, 'other operators keep accepting "#" as a value', r.message);
}

console.log('\n[#710] array values for oneOf and notOneOf, booleans for the flag fields');
{
  const A = '10000000-0000-4000-8000-00000000000a';
  const B = '10000000-0000-4000-8000-00000000000b';
  let r = await attempt(rule([{ field: 'payee', op: 'oneOf', value: [A, B] }], [okAct]));
  check(!r.threw && calls.length === 1, 'payee oneOf [id, id] is accepted and written once', r.message);
  check(Array.isArray(calls[0]?.conditions?.[0]?.value) && calls[0].conditions[0].value.join() === `${A},${B}`, '  and the array reaches the adapter unchanged');
  r = await attempt(rule([{ field: 'category', op: 'notOneOf', value: [A] }], [okAct]));
  check(!r.threw && calls.length === 1, 'category notOneOf [id] is accepted', r.message);
  r = await attempt(rule([{ field: 'cleared', op: 'is', value: true }], [okAct]));
  check(!r.threw && calls[0]?.conditions?.[0]?.value === true, 'cleared is true is accepted and stays a boolean', r.message);
  r = await attempt(rule([{ field: 'reconciled', op: 'is', value: false }], [okAct]));
  check(!r.threw && calls[0]?.conditions?.[0]?.value === false, 'reconciled is false is accepted', r.message);
  r = await attempt(rule([{ field: 'transfer', op: 'is', value: false }], [okAct]));
  check(r.threw && r.message.startsWith('Condition field "transfer" never matches in a rule') && calls.length === 0, '#766 NEGATIVE: transfer is false is refused and nothing is written', r.message);

  for (const [label, value] of [['an empty array', []], ['a string', A]]) {
    r = await attempt(rule([{ field: 'payee', op: 'notOneOf', value }], [okAct]));
    check(r.threw && r.message === 'Operator "notOneOf" requires a non-empty array of values (field: payee). Example: {field: "payee", op: "notOneOf", value: ["uuid-1", "uuid-2"]}',
      `NEGATIVE: payee notOneOf with ${label} is refused with the exact message`, r.message);
    check(calls.length === 0, '  and createRule is never called');
  }
  // Review of #710: upstream drops an empty element, so [""] would become the match-everything
  // empty list; a repeated id would make one set of ids two rules for the upsert match.
  for (const value of [[''], ['Amazon', '  ']]) {
    r = await attempt(rule([{ field: 'payee_name', op: 'notOneOf', value }], [okAct]));
    check(r.threw && r.message === 'Operator "notOneOf" does not accept an empty value in its array (field: payee_name).',
      `NEGATIVE: an empty array element is refused (${JSON.stringify(value)})`, r.message);
    check(calls.length === 0, '  and createRule is never called');
  }
  r = await attempt(rule([{ field: 'payee', op: 'oneOf', value: [A, B, A] }], [okAct]));
  check(r.threw && r.message === `Operator "oneOf" lists "${A}" more than once (field: payee).`,
    'NEGATIVE: a repeated array element is refused naming it', r.message);
  check(calls.length === 0, '  and createRule is never called');
  r = await attempt(rule([{ field: 'payee', op: 'oneOf', value: [A, 'Amazon'] }], [okAct]));
  check(r.threw && r.message === 'Field "payee" expects IDs (UUIDs) with operator "oneOf", but the array holds "Amazon". List the payees to find the correct UUIDs.',
    'NEGATIVE: a non-UUID array element is refused naming it', r.message);
  r = await attempt(rule([{ field: 'category', op: 'oneOf', value: ['Food'] }], [okAct]));
  check(r.threw && r.message.endsWith('List the categories to find the correct UUIDs.'), 'NEGATIVE: category oneOf ["Food"] names categories', r.message);
  r = await attempt(rule([{ field: 'payee', op: 'is', value: [A] }], [okAct]));
  check(r.threw && r.message === 'Operator "is" does not accept an array (field: payee). Use "oneOf" or "notOneOf" for a list of values.',
    'NEGATIVE: an array on a single-value operator is refused', r.message);
  r = await attempt(rule([{ field: 'notes', op: 'contains', value: ['a'] }], [okAct]));
  check(r.threw && r.message.includes('does not accept an array'), 'NEGATIVE: notes contains [..] is refused', r.message);
  r = await attempt(rule([{ field: 'cleared', op: 'is', value: 'true' }], [okAct]));
  check(r.threw && r.message === 'Field "cleared" must be true or false with operator "is", but got string.',
    'NEGATIVE: cleared is "true" (a string) is refused', r.message);
  r = await attempt(rule([{ field: 'reconciled', op: 'is', value: 1 }], [okAct]));
  check(r.threw && r.message.includes('must be true or false'), 'NEGATIVE: reconciled is 1 is refused', r.message);
  r = await attempt(rule([{ field: 'cleared', op: 'isNot', value: true }], [okAct]));
  check(r.threw && r.message.startsWith('Invalid operator "isNot" for field "cleared". Field "cleared" is a boolean field and only supports: is.'),
    'NEGATIVE: cleared isNot is an Invalid operator error', r.message);
  r = await attempt(rule([{ field: 'notes', op: 'is', value: true }], [okAct]));
  check(r.threw && r.message === 'Field "notes" does not accept a boolean value (operator: is).', 'NEGATIVE: a boolean on a text field is refused', r.message);
  r = await attempt(rule([{ field: 'amount', op: 'gte', value: false }], [okAct]));
  check(r.threw && r.message.includes('does not accept a boolean'), 'NEGATIVE: a boolean on amount is refused', r.message);
  check(calls.length === 0, '  and createRule is never called');
}

console.log('\n[#711] one operator map, equal to what Actual accepts');
{
  const A = '10000000-0000-4000-8000-00000000000a';
  const VALID = 'imported_payee, payee, payee_name, account, category, category_group, notes, amount, date, cleared, reconciled';
  const { CONDITION_FIELD_OPERATORS: MAP } = await import('../../dist/src/lib/schemas/rules.js');
  check(MAP?.payee_name?.operators?.join() === 'is,isNot,contains,matches,doesNotContain,oneOf,notOneOf,hasTags,hasAnyTag',
    'the exported map holds payee_name with its nine operators', JSON.stringify(MAP?.payee_name));
  check(MAP?.category_group?.type === 'id' && MAP.category_group.operators.join() === 'is,isNot,oneOf,notOneOf',
    'the exported map holds category_group with the four id operators', JSON.stringify(MAP?.category_group));
  check(MAP && Object.keys(MAP).join(', ') === VALID, 'the map lists the fields in the documented order', MAP && Object.keys(MAP).join(', '));

  // Accepted conditions, each written once and reaching the adapter as sent.
  for (const [label, c] of [
    ['account onBudget ""', { field: 'account', op: 'onBudget', value: '' }],
    ['account offBudget ""', { field: 'account', op: 'offBudget', value: '' }],
    ['amount isbetween {1000, 5000}', { field: 'amount', op: 'isbetween', value: { num1: 1000, num2: 5000 } }],
    ['amount isbetween with negative cents', { field: 'amount', op: 'isbetween', value: { num1: -5000, num2: -1000 } }],
    ['date isapprox "2026-11-01"', { field: 'date', op: 'isapprox', value: '2026-11-01' }],
    ['imported_payee oneOf an array of text', { field: 'imported_payee', op: 'oneOf', value: ['AMAZON MKTP', 'AMZN'] }],
    ['payee_name notOneOf an array of text', { field: 'payee_name', op: 'notOneOf', value: ['Amazon'] }],
    ['payee_name contains "amazon"', { field: 'payee_name', op: 'contains', value: 'amazon' }],
    ['payee_name hasTags "#trip"', { field: 'payee_name', op: 'hasTags', value: '#trip' }],
    ['category_group is an id', { field: 'category_group', op: 'is', value: A }],
    ['category_group oneOf [id]', { field: 'category_group', op: 'oneOf', value: [A] }],
  ]) {
    const r = await attempt(rule([c], [okAct]));
    check(!r.threw && calls.length === 1, `${label} is accepted and written once`, r.message);
    check(JSON.stringify(calls[0]?.conditions?.[0]) === JSON.stringify(c), '  and the condition reaches the adapter as written', JSON.stringify(calls[0]?.conditions?.[0]));
  }

  // Refused before the adapter, each with its exact message.
  for (const [label, c, message] of [
    ['category onBudget', { field: 'category', op: 'onBudget', value: '' },
      'Invalid operator "onBudget" for field "category". Field "category" is a id field and only supports: is, isNot, oneOf, notOneOf.'],
    ['payee_name gte', { field: 'payee_name', op: 'gte', value: 'x' },
      'Invalid operator "gte" for field "payee_name". Field "payee_name" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf, hasTags, hasAnyTag.'],
    ['date isbetween', { field: 'date', op: 'isbetween', value: { num1: 1, num2: 2 } },
      'Invalid operator "isbetween" for field "date". Field "date" is a date field and only supports: is, isapprox, gt, gte, lt, lte.'],
    ['payee contains (a text operator on an id field)', { field: 'payee', op: 'contains', value: 'amazon' },
      'Invalid operator "contains" for field "payee". Field "payee" is a id field and only supports: is, isNot, oneOf, notOneOf. To match by name use "payee_name" or "imported_payee".'],
    ['category matches', { field: 'category', op: 'matches', value: 'Food' },
      'Invalid operator "matches" for field "category". Field "category" is a id field and only supports: is, isNot, oneOf, notOneOf. This field holds an id, so a text operator never matches in a rule.'],
    ['category_group doesNotContain', { field: 'category_group', op: 'doesNotContain', value: 'x' },
      'Invalid operator "doesNotContain" for field "category_group". Field "category_group" is a id field and only supports: is, isNot, oneOf, notOneOf. This field holds an id, so a text operator never matches in a rule.'],
    ['nosuchfield', { field: 'nosuchfield', op: 'is', value: 'x' }, `Unknown condition field "nosuchfield". Valid fields: ${VALID}.`],
    ['description', { field: 'description', op: 'contains', value: 'x' }, `Unknown condition field "description". Valid fields: ${VALID}.`],
    ['saved', { field: 'saved', op: 'is', value: 'x' }, `Unknown condition field "saved". Valid fields: ${VALID}.`],
    ['toString (a prototype key)', { field: 'toString', op: 'is', value: 'x' }, `Unknown condition field "toString". Valid fields: ${VALID}.`],
    ['amount isbetween 5000', { field: 'amount', op: 'isbetween', value: 5000 },
      'Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: amount).'],
    ['amount isbetween "1000-5000"', { field: 'amount', op: 'isbetween', value: '1000-5000' },
      'Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: amount).'],
    ['amount gt {num1, num2}', { field: 'amount', op: 'gt', value: { num1: 1000, num2: 5000 } },
      'Only "isbetween" takes a {num1, num2} value (field: amount, op: gt).'],
    ['category_group oneOf ["Groceries"]', { field: 'category_group', op: 'oneOf', value: ['Groceries'] },
      'Field "category_group" expects IDs (UUIDs) with operator "oneOf", but the array holds "Groceries". List the category groups to find the correct UUIDs.'],
    ['category_group is "Groceries" (text on an id field)', { field: 'category_group', op: 'is', value: 'Groceries' },
      'Field "category_group" expects an ID (UUID), but got text value "Groceries". Use the category_group UUID from your budget data. List category groups to find the correct UUID.'],
    ['imported_payee oneOf []', { field: 'imported_payee', op: 'oneOf', value: [] },
      'Operator "oneOf" requires a non-empty array of values (field: imported_payee). Example: {field: "imported_payee", op: "oneOf", value: ["uuid-1", "uuid-2"]}'],
  ]) {
    const r = await attempt(rule([c], [okAct]));
    check(r.threw && r.message === message, `NEGATIVE: ${label} is refused with the exact message`, r.message);
    check(calls.length === 0, '  and createRule is never called');
  }
  const r = await attempt(rule([{ field: 'description', op: 'contains', value: 'x' }], [okAct]));
  const listed = r.message.split('Valid fields: ')[1] ?? '';
  check(listed !== '' && !/\b(description|saved)\b/.test(listed), 'NEGATIVE: the valid-field list omits description and saved', listed);

  // A fractional bound passes Zod (the schema publishes plain numbers) and is refused here.
  const z = await attempt(rule([{ field: 'amount', op: 'isbetween', value: { num1: 10.5, num2: 20 } }], [okAct]));
  check(z.threw && z.message === 'Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: amount).' && calls.length === 0,
    'NEGATIVE: isbetween with a fractional bound is refused with the exact message, before the adapter', z.message);
}

console.log('\n[#761] rules_create: condition options and unknown keys');
{
  const { RuleItemSchema } = await import('../../dist/src/lib/schemas/rules.js');
  const OUT = { field: 'amount', op: 'is', value: 5002, options: { outflow: true } };
  const parsed = RuleItemSchema.parse(rule([okCond, OUT], [okAct]));
  check(parsed.conditions[1].options?.outflow === true, 'RuleItemSchema keeps options.outflow on an amount condition');
  let r = await attempt(rule([OUT], [okAct]));
  check(!r.threw && calls[0]?.conditions?.[0]?.options?.outflow === true, 'the outflow condition reaches createRule with its options', r.message);

  const refuse = async (label, conditions, actions, expected) => {
    const x = await attempt(rule(conditions, actions));
    const ok = x.threw && (expected instanceof RegExp ? expected.test(x.message) : x.message === expected) && calls.length === 0;
    check(ok, `NEGATIVE: ${label}`, x.message);
  };
  await refuse('an unknown condition key is refused naming it', [{ ...okCond, zzz: 1 }], [okAct], /zzz/);
  await refuse('an unknown action key is refused naming it', [okCond], [{ ...okAct, bogus: true }], /bogus/);
  await refuse('options on a payee condition', [{ field: 'payee', op: 'is', value: CAT, options: { outflow: true } }], [okAct], 'options is only valid on an amount condition');
  await refuse('both flags', [{ ...OUT, options: { outflow: true, inflow: true } }], [okAct], 'options cannot set both outflow and inflow');
  const NEG = 'an amount condition with outflow or inflow takes a positive value; the direction comes from the option';
  await refuse('a negative value with outflow', [{ ...OUT, value: -5002 }], [okAct], NEG);
  await refuse('a negative isbetween bound with inflow', [{ field: 'amount', op: 'isbetween', value: { num1: -6000, num2: -4000 }, options: { inflow: true } }], [okAct], NEG);
  await refuse('an unknown key inside options', [{ ...OUT, options: { outflow: true, sideways: 1 } }], [okAct], /sideways/);
  await refuse('a non-boolean outflow', [{ ...OUT, options: { outflow: 'yes' } }], [okAct], /outflow.*boolean/is);
  r = await attempt(rule([{ ...OUT, value: -5002, options: { outflow: false } }], [okAct]));
  check(!r.threw, 'a false flag does not trigger the positive-value check', r.message);

  const batch = (await import('../../dist/src/tools/rules_create_batch.js')).default;
  let be;
  try { await batch.call({ rules: [rule([okCond], [okAct]), rule([{ ...okCond, zzz: 1 }], [okAct])] }); } catch (e) { be = e; }
  check(be && /zzz/.test(String(be.message)) && /rules/.test(String(be.message)) && /1/.test(String(be.message)), 'NEGATIVE: create_batch refuses an unknown key in rules[1] with its path', String(be && be.message));
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_create characterisation checks passed');
process.exit(0);
