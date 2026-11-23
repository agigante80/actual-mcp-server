// tests/unit/rules_update_operators.test.js
// #703: actual_rules_update validates condition operators (#711: with the shared map). This file pins
// that the map accepts the tag operators on notes, refuses them elsewhere, and refuses a
// tag value with no tag in it, without reaching the adapter.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_update_operators.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};

const ID = '123e4567-e89b-42d3-a456-426614174000';
const adapter = (await import('../../dist/src/lib/actual-adapter.js')).default;
let calls = [];
adapter.updateRule = async (id, fields) => { calls.push({ id, fields }); return null; };
const tool = (await import('../../dist/src/tools/rules_update.js')).default;

const attempt = async (conditions) => {
  calls = [];
  try { await tool.call({ id: ID, fields: { conditions } }); return ''; }
  catch (e) { return String(e?.message ?? e); }
};

console.log('\n[#703] rules_update: tag operators on notes');
{
  let m = await attempt([{ field: 'notes', op: 'hasAnyTag', value: '#trip #food' }]);
  check(m === '' && calls.length === 1, 'notes hasAnyTag is accepted and written once', m);
  check(calls[0]?.fields?.conditions?.[0]?.op === 'hasAnyTag', '  and the condition reaches the adapter unchanged');
  m = await attempt([{ field: 'notes', op: 'hasTags', value: 'trip' }]);
  check(m === '' && calls.length === 1, 'notes hasTags without the leading # is accepted', m);

  m = await attempt([{ field: 'imported_payee', op: 'hasTags', value: '#trip' }]);
  check(m === 'Invalid operator "hasTags" for field "imported_payee". Field "imported_payee" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf.',
    'NEGATIVE: imported_payee hasTags is refused with the exact message', m);
  check(calls.length === 0, '  and updateRule is never called');

  m = await attempt([{ field: 'notes', op: 'hasTags', value: '' }]);
  check(m === 'Operator "hasTags" needs at least one tag in its value, for example "#trip" (field: notes). Nothing was written.',
    'NEGATIVE: notes hasTags "" is refused with the exact message', m);
  check(calls.length === 0, '  and updateRule is never called');
  m = await attempt([{ field: 'notes', op: 'hasAnyTag', value: '# #' }]);
  check(m === 'Operator "hasAnyTag" needs at least one tag in its value, for example "#trip" (field: notes). Nothing was written.',
    'NEGATIVE: notes hasAnyTag "# #" is refused', m);
  check(calls.length === 0, '  and updateRule is never called');
}

console.log('\n[#710] rules_update: array and boolean condition values');
{
  const A = '10000000-0000-4000-8000-00000000000a';
  let m = await attempt([{ field: 'payee', op: 'oneOf', value: [A, ID] }]);
  check(m === '' && calls.length === 1 && Array.isArray(calls[0].fields.conditions[0].value), 'payee oneOf [id, id] is accepted and reaches the adapter as an array', m);
  m = await attempt([{ field: 'cleared', op: 'is', value: true }]);
  check(m === '' && calls[0]?.fields?.conditions?.[0]?.value === true, 'cleared is true is accepted', m);

  m = await attempt([{ field: 'account', op: 'oneOf', value: [] }]);
  check(m === 'Operator "oneOf" requires a non-empty array of values (field: account). Example: {field: "account", op: "oneOf", value: ["uuid-1", "uuid-2"]}',
    'NEGATIVE: oneOf [] is refused with the exact message', m);
  check(calls.length === 0, '  and updateRule is never called');
  m = await attempt([{ field: 'account', op: 'oneOf', value: ['Checking'] }]);
  check(m.includes('expects IDs (UUIDs)') && m.includes('"Checking"') && calls.length === 0, 'NEGATIVE: a non-UUID array element is refused', m);
  m = await attempt([{ field: 'payee', op: 'isNot', value: [A] }]);
  check(m.includes('does not accept an array') && calls.length === 0, 'NEGATIVE: an array on isNot is refused', m);
  m = await attempt([{ field: 'cleared', op: 'is', value: 'yes' }]);
  check(m.includes('must be true or false') && calls.length === 0, 'NEGATIVE: cleared is "yes" is refused', m);
  m = await attempt([{ field: 'cleared', op: 'isNot', value: true }]);
  check(m.startsWith('Invalid operator "isNot" for field "cleared".') && calls.length === 0, 'NEGATIVE: cleared isNot is refused', m);
  m = await attempt([{ field: 'imported_payee', op: 'is', value: false }]);
  check(m.includes('does not accept a boolean') && calls.length === 0, 'NEGATIVE: a boolean on a text field is refused', m);
}

console.log('\n[#711] rules_update: the shared operator map, same messages as actual_rules_create');
{
  const VALID = 'imported_payee, payee, payee_name, account, category, category_group, notes, amount, date, cleared, reconciled';
  for (const [label, c] of [
    ['account onBudget ""', { field: 'account', op: 'onBudget', value: '' }],
    ['amount isbetween {1000, 5000}', { field: 'amount', op: 'isbetween', value: { num1: 1000, num2: 5000 } }],
    ['date isapprox', { field: 'date', op: 'isapprox', value: '2026-11-01' }],
    ['imported_payee oneOf an array of text', { field: 'imported_payee', op: 'oneOf', value: ['AMAZON MKTP', 'AMZN'] }],
    ['payee_name contains', { field: 'payee_name', op: 'contains', value: 'amazon' }],
  ]) {
    const m = await attempt([c]);
    check(m === '' && calls.length === 1 && JSON.stringify(calls[0].fields.conditions[0]) === JSON.stringify(c), `${label} is accepted and reaches the adapter as written`, m);
  }
  for (const [label, c, message] of [
    ['payee_name gte', { field: 'payee_name', op: 'gte', value: 'x' },
      'Invalid operator "gte" for field "payee_name". Field "payee_name" is a string field and only supports: is, isNot, contains, matches, doesNotContain, oneOf, notOneOf, hasTags, hasAnyTag.'],
    ['payee contains', { field: 'payee', op: 'contains', value: 'amazon' },
      'Invalid operator "contains" for field "payee". Field "payee" is a id field and only supports: is, isNot, oneOf, notOneOf. To match by name use "payee_name" or "imported_payee".'],
    ['description', { field: 'description', op: 'contains', value: 'x' }, `Unknown condition field "description". Valid fields: ${VALID}.`],
    ['saved', { field: 'saved', op: 'is', value: 'x' }, `Unknown condition field "saved". Valid fields: ${VALID}.`],
    ['amount isbetween 5000', { field: 'amount', op: 'isbetween', value: 5000 },
      'Operator "isbetween" requires {num1, num2} in integer cents, for example {"num1": 1000, "num2": 5000} (field: amount).'],
    ['amount lt {num1, num2}', { field: 'amount', op: 'lt', value: { num1: 1, num2: 2 } }, 'Only "isbetween" takes a {num1, num2} value (field: amount, op: lt).'],
  ]) {
    const m = await attempt([c]);
    check(m === message, `NEGATIVE: ${label} is refused with the exact message`, m);
    check(calls.length === 0, '  and updateRule is never called');
  }
}

console.log('\n[#711] rules_update: text on an id field is refused with the exact message');
{
  const plural = { account: 'accounts', category: 'categories', category_group: 'category groups' };
  for (const field of ['account', 'category', 'category_group']) {
    const m = await attempt([{ field, op: 'is', value: 'Groceries' }]);
    check(m === `Field "${field}" expects an ID (UUID), but got text value "Groceries". Use the ${field} UUID from your budget data. List ${plural[field]} to find the correct UUID.`,
      `NEGATIVE: text on ${field} is refused with the exact message`, m);
    check(calls.length === 0, '  and updateRule is never called');
  }
  const m = await attempt([{ field: 'payee', op: 'is', value: 'Amazon' }]);
  check(m === 'Field "payee" expects a payee ID (UUID), but got text value "Amazon". To match payee names with text, use "imported_payee" field instead. Example: {field: "imported_payee", op: "contains", value: "Amazon"}',
    'NEGATIVE: text on payee is refused with the exact message', m);
  check(calls.length === 0, '  and updateRule is never called');
}

console.log('\n[#761] rules_update: unknown keys and condition options');
{
  const ACT = { op: 'set', field: 'category', value: ID };
  const run = async (fields) => { calls = []; try { await tool.call({ id: ID, fields }); return ''; } catch (e) { return String(e?.message ?? e); } };
  let m = await run({ actions: [{ ...ACT, bogus: true }] });
  check(/bogus/.test(m) && calls.length === 0, 'NEGATIVE: an unknown action key is refused naming it and nothing is written', m);
  m = await run({ conditions: [{ field: 'notes', op: 'contains', value: 'x', zzz: 1 }] });
  check(/zzz/.test(m) && calls.length === 0, 'NEGATIVE: an unknown condition key is refused naming it', m);
  m = await attempt([{ field: 'payee', op: 'is', value: ID, options: { outflow: true } }]);
  check(m === 'options is only valid on an amount condition' && calls.length === 0, 'NEGATIVE: options on a payee condition is refused with the exact message', m);
  m = await attempt([{ field: 'amount', op: 'is', value: 5, options: { outflow: true, inflow: true } }]);
  check(m === 'options cannot set both outflow and inflow', 'NEGATIVE: both flags are refused', m);
  m = await attempt([{ field: 'amount', op: 'gt', value: -5, options: { inflow: true } }]);
  check(m === 'an amount condition with outflow or inflow takes a positive value; the direction comes from the option', 'NEGATIVE: a negative value with a flag is refused', m);
  // A rule shaped as actual_rules_get returns it is accepted unchanged.
  const stored = {
    conditions: [{ field: 'amount', op: 'is', value: 5002, type: 'number', options: { outflow: true } }],
    actions: [{ op: 'set', field: 'notes', value: 'x', type: 'string', options: { template: 'Hi {{payee}}' } }],
  };
  m = await run(stored);
  check(m === '' && calls.length === 1, 'a rule shaped as actual_rules_get returns it is accepted', m);
  check(calls[0]?.fields?.conditions?.[0]?.options?.outflow === true && calls[0]?.fields?.actions?.[0]?.options?.template === 'Hi {{payee}}', '  and its condition options and action options reach the adapter');
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_update operator checks passed');
process.exit(0);
