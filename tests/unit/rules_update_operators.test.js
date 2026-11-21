// tests/unit/rules_update_operators.test.js
// #703: actual_rules_update validates condition operators with its own map. This file pins
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
  check(m === 'Invalid operator "hasTags" for field "imported_payee". Field "imported_payee" is a string field and only supports: contains, matches, doesNotContain, is, isNot. Please use one of these operators instead.',
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
  m = await attempt([{ field: 'parent', op: 'is', value: 'yes' }]);
  check(m.includes('must be true or false') && calls.length === 0, 'NEGATIVE: parent is "yes" is refused', m);
  m = await attempt([{ field: 'cleared', op: 'isNot', value: true }]);
  check(m.startsWith('Invalid operator "isNot" for field "cleared".') && calls.length === 0, 'NEGATIVE: cleared isNot is refused', m);
  m = await attempt([{ field: 'imported_payee', op: 'is', value: false }]);
  check(m.includes('does not accept a boolean') && calls.length === 0, 'NEGATIVE: a boolean on a text field is refused', m);
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_update operator checks passed');
process.exit(0);
