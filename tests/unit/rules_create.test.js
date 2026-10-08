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
  check(r.threw && r.message === 'Operator "oneOf" expects an array of values, but got string. Example: {field: "category", op: "oneOf", value: ["uuid-1", "uuid-2"]}', 'oneOf with a non-array value throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'set', value: 'x' }]));
  check(r.threw && r.message === 'Action with op="set" requires a "field" property (e.g., "category", "payee", "notes", "cleared")', 'set without a field throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'append-notes', value: 5 }]));
  check(r.threw && r.message === 'Action "append-notes" requires a string value, but got number. Example: {op: "append-notes", value: "text to append"}', 'append-notes with a number throws', r.message);

  r = await attempt(rule([okCond], [{ op: 'prepend-notes', value: true }]));
  check(r.threw && r.message.startsWith('Action "prepend-notes" requires a string value, but got boolean.') && r.message.endsWith('"text to prepend"}'), 'prepend-notes with a boolean throws', r.message);

  r = await attempt(rule([{ field: 'amount', op: 'contains', value: 5 }], [okAct]));
  check(r.threw && r.message === 'Invalid operator "contains" for field "amount". Field "amount" is a number field and only supports: is, gte, lte, gt, lt, isapprox. Please use one of these operators instead.', 'contains on amount throws', r.message);
  check(calls.length === 0, '  and createRule is never called');
}

console.log('\n[#485] rules_create: what is deliberately NOT rejected');
{
  const r = await attempt(rule([{ field: 'bogus', op: 'is', value: 'x' }], [{ op: 'set', field: 'notes', value: 'n' }]));
  check(!r.threw, 'an unknown condition field with "is" does not throw', r.message);
  check(calls.length === 1, '  and reaches createRule');
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

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules_create characterisation checks passed');
process.exit(0);
