// tests/unit/rules_required_lists_and_set_values.test.js
// #762: the four rule write tools refuse an empty `conditions` or `actions` list and a `set`
// action whose value cannot be stored in its field. Adapter methods are stubbed at the tool
// boundary, so "nothing written" is calls.length === 0.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_required_lists_and_set_values.test.js   (needs `npm run build` first)

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
adapter.createRule = async (r) => { calls.push({ m: 'createRule', r }); return { id: ID }; };
adapter.updateRule = async (id, fields) => { calls.push({ m: 'updateRule', id, fields }); return null; };
adapter.upsertRule = async (r) => { calls.push({ m: 'upsertRule', r }); return { id: ID, created: true }; };
adapter.createRulesBatch = async (pass, total) => {
  calls.push({ m: 'createRulesBatch', pass, total });
  return { succeeded: pass.map((p) => ({ index: p.index, id: ID })), failed: [] };
};
const create = (await import('../../dist/src/tools/rules_create.js')).default;
const update = (await import('../../dist/src/tools/rules_update.js')).default;
const upsert = (await import('../../dist/src/tools/rules_create_or_update.js')).default;
const batch = (await import('../../dist/src/tools/rules_create_batch.js')).default;

const COND = [{ field: 'notes', op: 'contains', value: 'x' }];
const ACT = [{ op: 'append-notes', value: ' [inv]' }];
const setAct = (field, value, options) => [{ op: 'set', field, value, ...(options ? { options } : {}) }];

const paths = {
  rules_create: (c, a) => create.call({ conditions: c, actions: a }),
  rules_update_conditions: (c) => update.call({ id: ID, fields: { conditions: c } }),
  rules_update_actions: (_c, a) => update.call({ id: ID, fields: { actions: a } }),
  rules_create_or_update: (c, a) => upsert.call({ conditions: c, actions: a }),
};
const attempt = async (fn) => {
  calls = [];
  try { await fn(); return ''; } catch (e) { return String(e?.message ?? e); }
};

const NO_COND = 'conditions must contain at least one condition, or the rule never matches';
const NO_ACT = 'actions must contain at least one action';

console.log('\n[#762] empty lists on every write path');
for (const [name, fn] of Object.entries(paths)) {
  if (name !== 'rules_update_actions') {
    const m = await attempt(() => fn([], ACT));
    check(m === NO_COND, `NEGATIVE: ${name} conditions [] refused with the exact message`, m);
    check(calls.length === 0, '  and the adapter is never called');
  }
  if (name !== 'rules_update_conditions') {
    const m = await attempt(() => fn(COND, []));
    check(m === NO_ACT, `NEGATIVE: ${name} actions [] refused with the exact message`, m);
    check(calls.length === 0, '  and the adapter is never called');
  }
}
{
  const m = await attempt(() => paths.rules_create([], []));
  check(m === NO_COND, 'both lists empty: the conditions message wins', m);
}
{
  const m = await attempt(() => paths.rules_create(COND, ACT));
  check(m === '' && calls.length === 1, 'POSITIVE: a valid rule is created', m);
}

console.log('\n[#762] create_batch: an empty item fails alone');
{
  calls = [];
  const res = (await batch.call({ rules: [{ conditions: [], actions: ACT }, { conditions: COND, actions: ACT }] })).result;
  check(res.failed.length === 1 && res.failed[0].index === 0 && res.failed[0].error === NO_COND, 'item 0 is in failed with the conditions message', JSON.stringify(res.failed));
  check(res.succeeded.length === 1 && res.succeeded[0].index === 1, 'item 1 is still created, original index kept', JSON.stringify(res.succeeded));
  check(calls.length === 1 && calls[0].pass.length === 1 && calls[0].pass[0].index === 1, 'only the valid item reaches createRulesBatch');
  const res2 = (await batch.call({ rules: [{ conditions: COND, actions: [] }] })).result;
  check(res2.failed[0]?.error === NO_ACT && res2.successCount === 0, 'actions [] item fails with the actions message', JSON.stringify(res2));
}

console.log('\n[#762] update keeps an omitted list');
{
  let m = await attempt(() => update.call({ id: ID, fields: { actions: ACT } }));
  check(m === '' && calls.length === 1 && !('conditions' in calls[0].fields), 'actions-only update sends no conditions key', m);
  m = await attempt(() => update.call({ id: ID, fields: { conditionsOp: 'or' } }));
  check(m === '' && calls.length === 1, 'a fields object with neither list is accepted', m);
}

console.log('\n[#762] set value types, shared by all three single-rule paths');
const matrix = [
  ['amount', 1000, true], ['amount', -500, true], ['amount', 0, true],
  ['amount', 'abc', false, 'Action "set" on field "amount" needs an integer value in cents, but got "abc".'],
  ['amount', 12.5, false, 'Action "set" on field "amount" needs an integer value in cents, but got 12.5.'],
  ['amount', '1000', false, 'Action "set" on field "amount" needs an integer value in cents, but got "1000".'],
  ['date', '2026-02-28', true],
  ['date', 'nodate', false, 'Action "set" on field "date" needs a date as YYYY-MM-DD (a real calendar day), but got "nodate".'],
  ['date', '2026-02-30', false, 'Action "set" on field "date" needs a date as YYYY-MM-DD (a real calendar day), but got "2026-02-30".'],
  ['date', 20260228, false, 'Action "set" on field "date" needs a date as YYYY-MM-DD (a real calendar day), but got 20260228.'],
];
for (const f of ['cleared', 'reconciled', 'transfer', 'parent']) {
  matrix.push([f, true, true], [f, false, true]);
  for (const bad of ['yes', 'false', 1]) {
    matrix.push([f, bad, false, `Action "set" on field "${f}" needs true or false, but got ${JSON.stringify(bad)}.`]);
  }
}
const setPaths = {
  rules_create: (a) => paths.rules_create(COND, a),
  rules_update: (a) => paths.rules_update_actions(COND, a),
  rules_create_or_update: (a) => paths.rules_create_or_update(COND, a),
};
for (const [field, value, ok, msg] of matrix) {
  for (const [name, fn] of Object.entries(setPaths)) {
    const m = await attempt(() => fn(setAct(field, value)));
    if (ok) check(m === '' && calls.length === 1, `${name}: set ${field} ${JSON.stringify(value)} accepted`, m);
    else {
      check(m === msg, `NEGATIVE: ${name}: set ${field} ${JSON.stringify(value)} refused with the exact message`, m);
      check(calls.length === 0, '  and the adapter is never called');
    }
  }
}
{
  calls = [];
  const res = (await batch.call({ rules: [{ conditions: COND, actions: setAct('amount', 'abc') }] })).result;
  check(res.failed[0]?.error === 'Action "set" on field "amount" needs an integer value in cents, but got "abc".' && calls.length === 0,
    'NEGATIVE: create_batch item set amount "abc" is in failed and nothing is sent', JSON.stringify(res));
}

console.log('\n[#762] template and formula are not type checked');
for (const [name, fn] of Object.entries(setPaths)) {
  let m = await attempt(() => fn(setAct('amount', 'x', { template: '{{amount}}' })));
  check(m === '' && calls.length === 1, `${name}: truthy options.template accepted`, m);
  m = await attempt(() => fn(setAct('cleared', 'x', { formula: 'TRUE()' })));
  check(m === '' && calls.length === 1, `${name}: truthy options.formula accepted`, m);
  m = await attempt(() => fn(setAct('amount', 'x', {})));
  check(m.includes('needs an integer value in cents'), `NEGATIVE: ${name}: options {} is still checked`, m);
  m = await attempt(() => fn(setAct('amount', 'x', { template: '' })));
  check(m.includes('needs an integer value in cents'), `NEGATIVE: ${name}: a falsy template is still checked`, m);
}
{
  const m = await attempt(() => paths.rules_create(COND, [{ op: 'set', field: 'notes', value: 'hello' }]));
  check(m === '' && calls.length === 1, 'a string field keeps accepting a string value', m);
}

if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall passed');
