// tests/unit/manual_budget_no_borrowed_writes.test.js
//
// #591: tests/manual/tests/budget.js borrowed the first PRE-EXISTING expense category when
// context.categoryId was null (it always is at `full`: the category module deletes its own
// category first) and wrote every budget amount, the carryover flag and the transfer source onto
// it, never restoring them. The zero-residue assertion cannot see a changed amount on an object
// the suite did not add, so a real category's month budget silently drifted on every run.
//
// This drives budgetTests with a stateful stub budget and pins:
//   B1 (positive): with a pre-existing category budgeted at 12345, no budget write targets it and
//      its budgeted and carryover values for this month and next equal the pre-run values.
//   B2 (positive): the same holds when an earlier module left a BORROWED id in context.categoryId.
//   B4 (negative): when a pre-existing amount changes anyway, the module's own before/after
//      snapshot records a failure naming the cell. That snapshot is the live check on Actual.
//   B5 (negative): a snapshot that reads no category cells is a failure, not a vacuous pass.
//   B3 (negative): a call that throws mid-module still ends with every group and category the
//      module created deleted (nothing to restore: it is gone), and the pre-existing category
//      untouched.
//
// The stub's actual_categories_get returns the FLAT list the real tool returns (adapter
// getCategories: one entry per category with group_id and is_income). An earlier draft of this
// fix read that listing as groups; a stub in the shape the code expected could not catch it.
//
// Run: node tests/unit/manual_budget_no_borrowed_writes.test.js

import assert from 'assert';
import { budgetTests } from '../manual/tests/budget.js';
import { borrowCategory } from '../manual/context.js';
import { failureList } from '../manual/assert.js';

const PRE = { id: 'cat-pre-existing', name: 'Misc', budgeted: 12345, carryover: false };
const GROUP = 'grp-pre';

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

function makeBudget({ preExisting, throwOn = null, driftOn = null }) {
  const groups = new Map(); // id -> { id, name, is_income, categories: [{ id, name }] }
  const cells = new Map();  // `${month}|${catId}` -> { budgeted, carryover }
  const accounts = new Map();
  const buffer = new Map();
  const writes = [];        // category ids every budget write targeted
  let seq = 0;
  if (preExisting) {
    groups.set(GROUP, { id: GROUP, name: 'Usual Expenses', is_income: false, categories: [{ id: PRE.id, name: PRE.name, group_id: GROUP }] });
  }
  groups.set('grp-income', { id: 'grp-income', name: 'Income', is_income: true, categories: [{ id: 'cat-income', name: 'Income', group_id: 'grp-income' }] });

  const allCats = () => [...groups.values()].flatMap(g => g.categories);
  const exists = (id) => allCats().some(c => c.id === id);
  const cell = (month, id) => {
    const key = `${month}|${id}`;
    if (!cells.has(key)) cells.set(key, id === PRE.id ? { budgeted: PRE.budgeted, carryover: PRE.carryover } : { budgeted: 0, carryover: false });
    return cells.get(key);
  };
  const month = (m) => {
    const expense = [...groups.values()].filter(g => !g.is_income);
    const budgeted = expense.flatMap(g => g.categories).reduce((s, c) => s + cell(m, c.id).budgeted, 0);
    const income = 1_000_000 + [...accounts.values()].reduce((s, b) => s + b, 0);
    return {
      month: m,
      forNextMonth: buffer.get(m) ?? 0,
      toBudget: income - budgeted - (buffer.get(m) ?? 0),
      categoryGroups: expense.map(g => ({ id: g.id, categories: g.categories.map(c => ({ id: c.id, ...cell(m, c.id) })) })),
    };
  };
  const setAmount = (m, id, amount) => {
    writes.push(id);
    if (!exists(id)) return { error: `Category ${id} not found` };
    cell(m, id).budgeted = amount;
    return { success: true };
  };

  const callTool = async (name, args) => {
    if (name === throwOn) throw new Error(`stub: ${name} failed`);
    // Simulates a write that lands on the pre-existing category through a path the writes log
    // does not see (another tool, a server-side side effect): only the drift check can catch it.
    if (name === driftOn) cell(new Date().toISOString().slice(0, 7), PRE.id).budgeted = 1;
    switch (name) {
      case 'actual_categories_get':
        return { result: [...groups.values()].flatMap(g => g.categories.map(c => ({ ...c, is_income: g.is_income }))) };
      case 'actual_category_groups_create': {
        const id = `grp-created-${++seq}`;
        groups.set(id, { id, name: args.name, is_income: false, categories: [] });
        return { id };
      }
      case 'actual_categories_create': {
        if (!groups.has(args.group_id)) throw new Error(`group ${args.group_id} not found`);
        const id = `cat-created-${++seq}`;
        groups.get(args.group_id).categories.push({ id, name: args.name, group_id: args.group_id });
        return { id };
      }
      case 'actual_categories_delete':
        for (const g of groups.values()) g.categories = g.categories.filter(c => c.id !== args.id);
        return { success: true };
      case 'actual_category_groups_delete':
        groups.delete(args.id);
        return { success: true };
      case 'actual_budgets_list_available':
        return { budgets: [{ name: 'Test', syncId: 's', serverUrl: 'http://x', hasEncryption: false }], count: 1 };
      case 'actual_budgets_switch':
        if (args.budgetName !== 'Test') return { error: `Budget "${args.budgetName}" not found` };
        return { success: true, budgetName: 'Test', budgetId: 'b', serverUrl: 'http://x' };
      case 'actual_transactions_filter':
        return [];
      case 'actual_budgets_get_all':
        return [];
      case 'actual_budgets_getMonth':
        return month(args.month);
      case 'actual_budgets_getMonths':
        return [month(args.start)];
      case 'actual_budgets_setAmount':
        return setAmount(args.month, args.categoryId, args.amount);
      case 'actual_budgets_setCarryover':
        writes.push(args.categoryId);
        cell(args.month, args.categoryId).carryover = args.flag;
        return { success: true };
      case 'actual_accounts_create': {
        const id = `acct-${++seq}`;
        accounts.set(id, args.balance ?? 0);
        return id;
      }
      case 'actual_accounts_delete':
        accounts.delete(args.id);
        return { success: true };
      case 'actual_budgets_holdForNextMonth':
        buffer.set(args.month, (buffer.get(args.month) ?? 0) + args.amount);
        return { held: args.amount, partial: false };
      case 'actual_budgets_resetHold':
        buffer.set(args.month, 0);
        return { success: true };
      case 'actual_budgets_transfer': {
        writes.push(args.fromCategoryId, args.toCategoryId);
        if (args.fromCategoryId === args.toCategoryId) throw new Error('Source and target categories must be different');
        const from = cell(args.month, args.fromCategoryId);
        if (from.budgeted < args.amount) throw new Error('Insufficient budget in source category');
        from.budgeted -= args.amount;
        cell(args.month, args.toCategoryId).budgeted += args.amount;
        return { success: true };
      }
      case 'actual_budget_updates_batch':
        if (args.operations.some(o => !/^\d{4}-\d{2}$/.test(o.month))) throw new Error('month must be YYYY-MM');
        for (const o of args.operations) setAmount(o.month, o.categoryId, o.amount);
        return { success: true, count: args.operations.length };
      default:
        throw new Error(`stub: unexpected tool ${name}`);
    }
  };
  return { client: { callTool }, writes, month, groups, exists };
}

async function run(opts, context = {}) {
  const budget = makeBudget(opts);
  const before = failureList().length;
  const log = console.log;
  console.log = () => {};
  let thrown = null;
  try {
    await budgetTests(budget.client, context);
  } catch (err) {
    thrown = err;
  } finally {
    console.log = log;
  }
  return { ...budget, context, thrown, added: failureList().slice(before) };
}

const thisMonth = new Date().toISOString().slice(0, 7);
const preCell = (r, m) => r.month(m).categoryGroups.flatMap(g => g.categories).find(c => c.id === PRE.id);

function assertCleanedUp(r, label) {
  assert.deepStrictEqual([...r.groups.keys()].sort(), [GROUP, 'grp-income'].sort(), `${label}: the disposable group was deleted`);
  assert.deepStrictEqual(
    [...r.groups.values()].flatMap(g => g.categories).map(c => c.id).filter(id => id.startsWith('cat-created')),
    [],
    `${label}: every category the module created is deleted`,
  );
}

function assertUntouched(r, label) {
  assert.strictEqual(r.thrown, null, `${label}: the module did not throw (${r.thrown?.message})`);
  assert.deepStrictEqual(r.added, [], `${label}: no failures recorded, got ${JSON.stringify(r.added)}`);
  assert.ok(!r.writes.includes(PRE.id), `${label}: a budget write targeted the pre-existing category (${r.writes.filter(w => w === PRE.id).length} times)`);
  for (const m of [thisMonth, nextMonth(thisMonth)]) {
    const c = preCell(r, m);
    assert.ok(c, `${label}: the pre-existing category still exists in ${m}`);
    assert.strictEqual(c.budgeted, PRE.budgeted, `${label}: budgeted for ${m} is ${c.budgeted}, expected the pre-run ${PRE.budgeted}`);
    assert.strictEqual(c.carryover, PRE.carryover, `${label}: carryover for ${m} changed`);
  }
  assert.ok(r.writes.length > 0, `${label}: the module did write budget amounts`);
  const NIL = '00000000-0000-0000-0000-000000000000'; // the module's deliberate unknown-id negative case
  assert.ok(r.writes.every(id => id === NIL || id.startsWith('cat-created')), `${label}: every budget write targeted a category the module created`);
  assertCleanedUp(r, label);
}

// B1: context.categoryId is null, the state budget.js always sees at `full`.
assertUntouched(await run({ preExisting: true }), 'B1');

// B2: an earlier module (rules.js, for example) left a borrowed id in the shared slot.
{
  const context = {};
  borrowCategory(context, PRE.id);
  const r = await run({ preExisting: true }, context);
  assertUntouched(r, 'B2');
  assert.strictEqual(r.context.categoryId, PRE.id, 'B2: the module leaves the shared slot as it found it');
}

// B3 (negative): the carryover call throws mid-module. The throw propagates (the runner records
// it), every group and category the module created is still deleted, and the pre-existing
// category was never written.
{
  const r = await run({ preExisting: true, throwOn: 'actual_budgets_setCarryover' });
  assert.ok(r.thrown && /setCarryover failed/.test(r.thrown.message), `B3: the stub throw propagated, got ${r.thrown?.message}`);
  assert.ok(r.writes.length > 0, 'B3: the module had written before the throw');
  assert.ok(!r.writes.includes(PRE.id), 'B3: no write targeted the pre-existing category');
  assertCleanedUp(r, 'B3');
}

// B4 (negative): a pre-existing amount changes during the run by a path no write targets. The
// module's before/after snapshot (the check the live `full` run relies on) records the drift.
{
  const r = await run({ preExisting: true, driftOn: 'actual_budgets_resetHold' });
  assert.strictEqual(r.thrown, null, `B4: the module did not throw (${r.thrown?.message})`);
  const drift = r.added.filter(f => /changed 1 pre-existing category cell/.test(JSON.stringify(f)));
  assert.strictEqual(drift.length, 1, `B4: the drift was recorded once, got ${JSON.stringify(r.added)}`);
  assert.ok(JSON.stringify(drift[0]).includes(PRE.id), 'B4: the failure names the drifted category');
  assertCleanedUp(r, 'B4');
}

// B5 (negative): a month snapshot with no category cells (here: the stub lists no expense
// category) would make the drift check vacuous, so the module records that as a failure.
{
  const r = await run({ preExisting: false });
  assert.ok(r.added.some(f => /snapshot read no category cells/.test(JSON.stringify(f))), `B5: an empty snapshot is a failure, got ${JSON.stringify(r.added)}`);
  assert.deepStrictEqual([...r.groups.keys()], ['grp-income'], 'B5: the disposable group was deleted');
}

console.log('manual_budget_no_borrowed_writes.test.js: all cases passed');
