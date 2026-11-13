// tests/unit/residue_unreadable.test.js
//
// #583: findResidue used to map a listing that FAILED (error text, a thrown call, null, an
// unexpected object) to `[]`, so a budget the harness never read was certified clean by the
// zero-residue assertion, which is release-gate evidence. Readable is now decided by SHAPE and
// per tool (never by message text): findResidue reports the rest in `unreadable` without
// throwing, assertNoResidue throws ResidueUnreadableError before it counts anything, and the
// best-effort sweep names an unreadable listing instead of printing "budget already clean".
//
// Run: node tests/unit/residue_unreadable.test.js

import assert from 'assert';
// A namespace import, so a missing export fails the rows that use it rather than the whole file.
import * as residue from '../manual/residue.js';
// #680: calls go through the real compact dispatcher; the stub stays keyed by the LEGACY tool a
// compact call reaches, and `unreadable` names the compact listing (list_entities type X).
import { viaCompact } from './helpers/compact-call-tool.js';

const { findResidue, assertNoResidue, sweepResidue, ResidueUnreadableError } = residue;

const LISTINGS = [
  'actual_accounts_list', 'actual_payees_get', 'actual_categories_get', 'actual_category_groups_get',
  'actual_rules_get', 'actual_schedules_get', 'actual_tags_list',
];
const SWEEP_ENV = { MCP_TEST_BUDGET_SYNC_ID: 'budget-x', MCP_ACTIVE_BUDGET_SYNC_ID: 'budget-x' };
const PAYEE_ID = '00000000-0000-4000-8000-0000000000b1';
const TEST_PAYEE = { id: PAYEE_ID, name: 'MCP-Payee-1761000000000' };
// The label findResidue reports for each legacy listing the stub is keyed by.
const LABEL = {
  actual_accounts_list: 'list_entities type account',
  actual_payees_get: 'list_entities type payee',
  actual_categories_get: 'list_entities type category',
  actual_category_groups_get: 'list_entities type category_group',
  actual_rules_get: 'list_entities type rule',
  actual_schedules_get: 'list_entities type schedule',
  actual_tags_list: 'list_entities type tag',
};
const ERROR_TEXT = 'Error: budget not loaded';

// map: { tool: value | Error }. A listing tool not in the map returns []; an Error rejects.
function stub(map = {}) {
  const calls = [];
  const callTool = viaCompact(async (name, args) => {
    calls.push([name, args]);
    const v = Object.hasOwn(map, name) ? map[name] : (LISTINGS.includes(name) ? [] : {});
    if (v instanceof Error) throw v;
    return v;
  });
  return { callTool, calls };
}

async function quietly(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    return { value: await fn(), out: lines.join('\n') };
  } catch (error) {
    return { error, out: lines.join('\n') };
  } finally {
    console.log = log;
  }
}

const deletes = (calls) => calls.filter(([n]) => /_delete$|_close$/.test(n));
let passed = 0;
const failed = [];
async function row(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`  FAIL ${name}: ${err.message.split('\n')[0]}`);
  }
}

// Guard row: a readable empty budget still passes (also green on the code before #583).
await row('readable empty budget returns 0', async () => {
  const r = await quietly(() => assertNoResidue(stub().callTool));
  assert.strictEqual(r.error, undefined, `unexpected throw: ${r.error?.message}`);
  assert.strictEqual(r.value, 0);
});

await row('error text is unreadable', async () => {
  const r = await quietly(() => assertNoResidue(stub({ actual_categories_get: ERROR_TEXT }).callTool));
  assert.ok(r.error instanceof ResidueUnreadableError, `expected ResidueUnreadableError, got ${r.error ?? r.value}`);
  assert.deepStrictEqual(r.error.tools, [LABEL.actual_categories_get]);
  assert.ok(r.error.message.includes(LABEL.actual_categories_get), r.error.message);
});

await row('a thrown listing call is unreadable', async () => {
  const r = await quietly(() => assertNoResidue(stub({ actual_rules_get: new Error('429') }).callTool));
  assert.ok(r.error instanceof ResidueUnreadableError, `expected ResidueUnreadableError, got ${r.error ?? r.value}`);
  assert.deepStrictEqual(r.error.tools, [LABEL.actual_rules_get]);
});

await row('null and a foreign object are unreadable; findResidue never throws', async () => {
  const r = await quietly(() => findResidue(stub({ actual_tags_list: null, actual_payees_get: { error: 'x' } }).callTool));
  assert.strictEqual(r.error, undefined, `findResidue threw: ${r.error?.message}`);
  assert.deepStrictEqual([...r.value.unreadable].sort(), [LABEL.actual_payees_get, LABEL.actual_tags_list].sort());
});

await row('a foreign key does not make a listing readable', async () => {
  const r = await quietly(() => findResidue(stub({ actual_categories_get: { groups: [] } }).callTool));
  assert.ok(r.value.unreadable.includes(LABEL.actual_categories_get), JSON.stringify(r.value.unreadable));
});

await row('each tool is readable under its own key', async () => {
  const r = await quietly(() => findResidue(stub({
    actual_category_groups_get: { groups: [] },
    actual_rules_get: { rules: [] },
    actual_schedules_get: { schedules: [], count: 0 },
    actual_payees_get: { result: [] },
    actual_tags_list: { result: [] },
  }).callTool));
  assert.deepStrictEqual(r.value.unreadable, []);
});

await row('a partly read budget holding residue is never certified or counted', async () => {
  const r = await quietly(() => assertNoResidue(stub({
    actual_payees_get: { result: [TEST_PAYEE] },
    actual_schedules_get: ERROR_TEXT,
  }).callTool));
  assert.notStrictEqual(r.value, 1, 'counted a partly read budget');
  assert.ok(r.error instanceof ResidueUnreadableError, `expected ResidueUnreadableError, got ${r.error ?? r.value}`);
  assert.deepStrictEqual(r.error.tools, [LABEL.actual_schedules_get]);
});

await row('the sweep names an unreadable listing instead of "clean"', async () => {
  const s = stub({ actual_accounts_list: ERROR_TEXT });
  const r = await quietly(() => sweepResidue(s.callTool, SWEEP_ENV));
  assert.strictEqual(r.error, undefined, `sweep threw: ${r.error?.message}`);
  assert.ok(r.out.includes(LABEL.actual_accounts_list), r.out);
  assert.ok(!r.out.includes('budget already clean'), r.out);
  assert.deepStrictEqual(deletes(s.calls), []);
});

await row('the sweep still removes what it could read', async () => {
  const s = stub({ actual_payees_get: { result: [TEST_PAYEE] }, actual_schedules_get: ERROR_TEXT });
  const r = await quietly(() => sweepResidue(s.callTool, SWEEP_ENV));
  assert.strictEqual(r.error, undefined, `sweep threw: ${r.error?.message}`);
  assert.deepStrictEqual(deletes(s.calls), [['actual_payees_delete', { id: PAYEE_ID }]]);
  assert.ok(r.out.includes(LABEL.actual_schedules_get), r.out);
});

if (failed.length) {
  console.error(`residue_unreadable.test.js: ${failed.length} row(s) failed`);
  process.exit(1);
}
console.log(`residue_unreadable.test.js: ${passed} rows passed`);
