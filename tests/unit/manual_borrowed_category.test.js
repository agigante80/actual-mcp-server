// tests/unit/manual_borrowed_category.test.js
//
// #590: the integration modules borrow a PRE-EXISTING category when context.categoryId is null
// and stored its id in context.categoryId, the slot the runner's cleanup phase deletes. Every
// mutating run therefore deleted one real category per transport leg (run 1 of the v0.24.1 gate
// deleted "Misc" over HTTP and "Income" over stdio, after which no starting balance could book
// as income and the hold test failed deterministically). This test drives the rules module with
// a stub client and pins: a borrowed id is marked borrowed and never deleted, a created id is
// still deleted, and (statically) every borrow site in tests/manual/tests/ goes through the
// helper, so a fourth site cannot reintroduce the bug.
//
// Run: node tests/unit/manual_borrowed_category.test.js

import assert from 'assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesTests } from '../manual/tests/rules.js';
import { borrowCategory, isBorrowedCategory, shouldDeleteCategory } from '../manual/context.js';
import { failureList } from '../manual/assert.js';

const PRE_EXISTING = { id: 'cat-pre-existing', name: 'Misc', group_id: 'grp-pre' };
const STAGE_342 = 'MCP-Rule-stage-342';
const GHOST = '19999999-0000-4000-8000-000000000009';
const ghostError = `Category ${GHOST} not found. Available: cat-pre-existing, cat-created`;
const setsGhost = (r) => r.actions.some(a => a.field === 'category' && a.value === GHOST);

// opts.preExisting: whether the budget already has a category to borrow.
function makeClient(opts = {}) {
  const calls = [];
  const rules = [];
  let next = 0;
  const marker = (r) => r.conditions?.[0]?.value;
  const create = (r) => {
    const id = marker(r) === STAGE_342 ? 'rule-342' : `rule-${++next}`;
    rules.push({ id, stage: r.stage ?? null, conditions: r.conditions, actions: r.actions.map(a => ({ op: 'set', ...a })) });
    return id;
  };
  const callTool = async (name, args) => {
    calls.push([name, args]);
    switch (name) {
      case 'actual_categories_get':
        return opts.preExisting
          ? [{ id: 'grp-pre', name: 'Usual Expenses', is_income: false, categories: [PRE_EXISTING] }]
          : [];
      case 'actual_category_groups_create':
        return { id: 'grp-created' };
      case 'actual_categories_create':
        return { id: 'cat-created' };
      case 'actual_categories_delete':
      case 'actual_category_groups_delete':
        return { success: true };
      case 'actual_rules_get':
        return { rules: rules.map(r => ({ ...r })) };
      case 'actual_rules_create':
        if (args.stage === 'default') throw new Error('Invalid stage');
        if (setsGhost(args)) throw new Error(ghostError);
        return { id: create(args) };
      case 'actual_rules_create_batch': {
        const succeeded = [];
        const failed = [];
        args.rules.forEach((r, index) => {
          if (r.conditions.some(c => c.field === 'bogus_field')) failed.push({ index, error: 'invalid field bogus_field' });
          else if (setsGhost(r)) failed.push({ index, error: ghostError });
          else succeeded.push({ index, id: create(r) });
        });
        return { total: args.rules.length, successCount: succeeded.length, failureCount: failed.length, succeeded, failed };
      }
      case 'actual_rules_update': {
        const r = rules.find(x => x.id === args.id);
        if (r) Object.assign(r, args.fields);
        return {};
      }
      case 'actual_rules_delete': {
        if (args.id === '00000000-0000-0000-0000-000000000000') throw new Error('Rule not found');
        const i = rules.findIndex(x => x.id === args.id);
        if (i >= 0) rules.splice(i, 1);
        return { success: true };
      }
      default:
        return {};
    }
  };
  return { client: { callTool }, calls };
}

async function run(opts) {
  const { client, calls } = makeClient(opts);
  const context = {};
  const before = failureList().length;
  const log = console.log;
  console.log = () => {};
  try {
    await rulesTests(client, context);
  } finally {
    console.log = log;
  }
  return { calls, context, added: failureList().slice(before) };
}

const deletedCategoryIds = (calls) => calls.filter(([n]) => n === 'actual_categories_delete').map(([, a]) => a.id);

// The runner's cleanup decision is the exported shouldDeleteCategory(); S5 pins that runner.js
// really calls it, so these rows exercise the same function the runner runs.
const cleanupWouldDelete = shouldDeleteCategory;

// S1 (positive): a borrowed category is marked borrowed, used as the working id, never deleted by
// the module, and the cleanup decision leaves it alone.
{
  const r = await run({ preExisting: true });
  assert.deepStrictEqual(r.added, [], `S1: no failures recorded, got ${JSON.stringify(r.added)}`);
  assert.strictEqual(r.context.categoryId, PRE_EXISTING.id, 'S1: the borrowed id is the working category');
  assert.ok(isBorrowedCategory(r.context, PRE_EXISTING.id), 'S1: the borrowed id is recorded as borrowed');
  assert.ok(!deletedCategoryIds(r.calls).includes(PRE_EXISTING.id), 'S1: the module never deleted the borrowed category');
  assert.strictEqual(cleanupWouldDelete(r.context), false, 'S1: the cleanup phase leaves the borrowed category in place');
}

// S2 (negative): a category the module CREATED is still deleted by the module and cleared, and
// a created id is never reported as borrowed.
{
  const r = await run({ preExisting: false });
  assert.deepStrictEqual(r.added, [], `S2: no failures recorded, got ${JSON.stringify(r.added)}`);
  assert.ok(deletedCategoryIds(r.calls).includes('cat-created'), 'S2: the created category is deleted by the module');
  assert.strictEqual(r.context.categoryId, null, 'S2: context.categoryId cleared after the module deleted its own category');
  assert.strictEqual(isBorrowedCategory(r.context, 'cat-created'), false, 'S2: a created id is not borrowed');
}

// S3 (negative): a created id left in context (the module threw before its own cleanup) is still
// deleted by the cleanup phase, even when an earlier module borrowed a different id.
{
  const context = {};
  borrowCategory(context, PRE_EXISTING.id);
  context.categoryId = 'cat-created';
  assert.strictEqual(cleanupWouldDelete(context), true, 'S3: a created id is deleted even after a borrow');
  assert.strictEqual(isBorrowedCategory(context, null), false, 'S3: a null id is never borrowed');
}

// S4 (static guard): in tests/manual/tests/, every non-null assignment to context.categoryId
// must come from a category the module CREATED (a variable fed by an actual_categories_create
// result). A borrowed id can only enter the slot through borrowCategory(), whatever the variable
// is called.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'manual', 'tests');
  const offences = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    const src = readFileSync(join(dir, file), 'utf8');
    const createVars = new Set([...src.matchAll(/\b(\w+)\s*=\s*await\s+callTool\(\s*["']actual_categories_create["']/g)].map(m => m[1]));
    const createdIds = new Set();
    for (const v of createVars) {
      for (const m of src.matchAll(new RegExp(`\\b(\\w+)\\s*=\\s*${v}\\b`, 'g'))) createdIds.add(m[1]);
    }
    const code = src.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\/\/.*$/, ''))); // comment prose is not an assignment
    // A created-id variable is trusted at every site, so every assignment to it must itself come
    // from a create result (or clear it): `rulesOwnedCatId = firstCat.id` would launder a borrow.
    for (const v of createdIds) {
      code.forEach((line, i) => {
        for (const m of line.matchAll(new RegExp(`(?<![\\w.])${v}\\s*=(?!=)\\s*([^;,)]+)`, 'g'))) {
          const rhs = m[1].trim();
          if (rhs === 'null' || [...createVars].some(c => new RegExp(`^${c}\\b`).test(rhs))) continue;
          offences.push(`${file}:${i + 1}: ${v} = ${rhs}; a created-id variable may only hold an actual_categories_create result`);
        }
      });
    }
    code.forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w.])context\.categoryId\s*=(?!=)\s*([^;,)]+)/g)) {
        const rhs = m[1].trim();
        if (rhs === 'null') continue;
        if (createdIds.has(rhs)) continue;
        offences.push(`${file}:${i + 1}: context.categoryId = ${rhs}; is not a created id; a borrowed category must go through borrowCategory()`);
      }
    });
  }
  assert.deepStrictEqual(offences, [], `S4: borrow sites outside the helper:\n${offences.join('\n')}`);
}

// S5 (static guard): the runner's cleanup phase calls shouldDeleteCategory() before the only
// category delete it has, so S1 and S3 exercise the decision the runner really makes.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const runner = readFileSync(join(here, '..', 'manual', 'runner.js'), 'utf8');
  const guarded = /if \(shouldDeleteCategory\(context\)\) \{[\s\S]{0,200}?actual_categories_delete/.test(runner);
  assert.ok(guarded, 'S5: runner.js deletes context.categoryId without asking shouldDeleteCategory() first');
  const deletes = runner.match(/actual_categories_delete/g) ?? [];
  assert.strictEqual(deletes.length, 1, `S5: runner.js has ${deletes.length} category delete paths; the guard covers one`);
}

// S6 (static guard, #591): a module that WRITES budget amounts (setAmount, setCarryover, transfer,
// hold, batch) must not touch the shared category slot (dotted, optional, bracketed or
// destructured) or borrow a category in code. A borrow is
// safe only as a value; budget.js once wrote 42 amounts onto a borrowed category and never
// restored them, invisibly to the residue sweep. Such a module creates its own categories.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'manual', 'tests');
  const WRITES = /["'](actual_budgets_(setAmount|setCarryover|transfer|holdForNextMonth)|actual_budget_updates_batch)["']/;
  const offences = [];
  let writers = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    const src = readFileSync(join(dir, file), 'utf8');
    const code = src.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\/\/.*$/, ''))).join('\n');
    if (!WRITES.test(code)) continue;
    writers++;
    for (const m of code.matchAll(/\bcontext\s*(\?\.|\.|\[\s*['"])\s*categoryId|\{[^}]*\bcategoryId\b[^}]*\}\s*=\s*context\b|borrowCategory/g)) offences.push(`${file}: uses ${m[0]} and writes budget amounts`);
  }
  assert.ok(writers > 0, 'S6: no module writes budget amounts; the guard pattern no longer matches anything');
  assert.deepStrictEqual(offences, [], `S6: a budget-writing module borrows a category:\n${offences.join('\n')}`);
}

console.log('manual_borrowed_category.test.js: all cases passed');
