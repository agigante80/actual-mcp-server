// tests/unit/batch_uncategorized_cleanup.test.js
//
// #519: the integration module batch_uncategorized_rules_upsert.js creates a disposable category
// group and category on a budget with no expense category, and removes them at the end. Since
// #517 a whole-call failure (rate limit, timeout, lock) is a thrown tool error, which used to skip
// that cleanup and leak the objects. The module body now runs in try/finally. This test drives the
// module with a stub client and pins: cleanup survives a throw, the ORIGINAL error propagates, and
// a borrowed (pre-existing) category is never deleted.
//
// Run: node tests/unit/batch_uncategorized_cleanup.test.js

import assert from 'assert';
import { batchUncategorizedRulesUpsertTests } from '../manual/tests/batch_uncategorized_rules_upsert.js';
import { failureList } from '../manual/assert.js';

// opts.throwOn: { toolName: Error }; opts.categories: payload for actual_categories_get.
function makeClient(opts) {
  const calls = [];
  let notes = null;
  const throwOn = opts.throwOn || {};
  // Plain closure, no `this`: the module destructures callTool.
  const callTool = async (name, args) => {
    calls.push([name, args]);
    if (throwOn[name]) throw throwOn[name];
    switch (name) {
      case 'actual_categories_get':
        return opts.categories;
      case 'actual_category_groups_create':
        return { id: 'grp-1' };
      case 'actual_categories_create':
        return { id: 'cat-1' };
      case 'actual_transactions_create':
        notes = args.notes;
        return {};
      case 'actual_transactions_uncategorized':
        return args && args.includeTransactions
          ? { transactions: [{ id: 'txn-1', notes }], totalCount: 1 }
          : { transactions: [] };
      case 'actual_rules_create_or_update':
        if ((args.conditions || []).some(c => c.field === 'payee')) throw new Error('operator');
        return {};
      default:
        return {};
    }
  };
  return { client: { callTool }, calls };
}

const idx = (calls, name, id) =>
  calls.findIndex(([n, a]) => n === name && (id === undefined || a.id === id));
const has = (calls, name) => calls.some(([n]) => n === name);

const NO_CATS = [];
const EXISTING = [{ id: 'g', is_income: false, categories: [{ id: 'existing-cat', name: 'Food', hidden: false }] }];

async function run(opts) {
  const { client, calls } = makeClient(opts);
  const context = { accountId: 'acct-1' };
  const before = failureList().length;
  let error = null;
  try {
    await batchUncategorizedRulesUpsertTests(client, context);
  } catch (e) {
    error = e;
  }
  return { calls, context, error, added: failureList().slice(before) };
}

const rateLimited = () => new Error('MCP Error -32603: rate limited');

// U1: disposable objects are removed (category first) after a throwing batch call.
{
  const r = await run({ categories: NO_CATS, throwOn: { actual_transactions_update_batch: rateLimited() } });
  assert.ok(r.error && /rate limited/.test(r.error.message), 'U1: original error propagates');
  const b = idx(r.calls, 'actual_transactions_update_batch');
  const c = idx(r.calls, 'actual_categories_delete', 'cat-1');
  const g = idx(r.calls, 'actual_category_groups_delete', 'grp-1');
  assert.ok(b >= 0 && b < c && c < g, `U1: order batch < cat delete < group delete (${b},${c},${g})`);
  assert.strictEqual(r.context.categoryId, null, 'U1: categoryId reset');
}

// U2: a failing cleanup neither stops the group delete nor masks the original error.
{
  const r = await run({
    categories: NO_CATS,
    throwOn: { actual_transactions_update_batch: rateLimited(), actual_categories_delete: new Error('delete failed') },
  });
  assert.ok(r.error && /rate limited/.test(r.error.message) && !/delete failed/.test(r.error.message), 'U2: original error wins');
  assert.ok(idx(r.calls, 'actual_category_groups_delete', 'grp-1') >= 0, 'U2: group delete still attempted');
  assert.ok(r.added.some(m => /cat-1.*residue/.test(m)), 'U2: category residue recorded via fail()');
}

// U3: group exists but the category create throws: group removed, no category delete.
{
  const r = await run({ categories: NO_CATS, throwOn: { actual_categories_create: new Error('create failed') } });
  assert.ok(r.error && /create failed/.test(r.error.message), 'U3: create error propagates');
  assert.ok(idx(r.calls, 'actual_category_groups_delete', 'grp-1') >= 0, 'U3: group deleted');
  assert.ok(!has(r.calls, 'actual_categories_delete'), 'U3: no category delete');
  assert.strictEqual(r.context.categoryId, undefined, 'U3: categoryId left unset');
}

// U4: borrowed category, everything succeeds: nothing deleted.
{
  const r = await run({ categories: EXISTING });
  assert.strictEqual(r.error, null, 'U4: resolves');
  assert.ok(!has(r.calls, 'actual_categories_delete') && !has(r.calls, 'actual_category_groups_delete'), 'U4: no deletes');
}

// U5: borrowed category, batch throws: still no deletes (never remove what we did not create).
{
  const r = await run({ categories: EXISTING, throwOn: { actual_transactions_update_batch: rateLimited() } });
  assert.ok(r.error && /rate limited/.test(r.error.message), 'U5: rejects');
  assert.ok(!has(r.calls, 'actual_categories_delete') && !has(r.calls, 'actual_category_groups_delete'), 'U5: no deletes');
}

console.log('batch_uncategorized_cleanup.test.js: all cases passed');
