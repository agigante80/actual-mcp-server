// tests/unit/rules_stage342_cleanup.test.js
//
// #585: the integration module tests/manual/tests/rules.js creates a rule with no stage to
// prove #342 (condition value `MCP-Rule-stage-342`) and stored its id in
// context.ruleStage342Id, but its delete loop never covered that id, so every run leaked one
// rule (192 on the local test budget). This test drives the module with a stub client backed
// by an in-memory rule store and pins: the #342 rule is deleted and its context id cleared,
// and a delete that does not take effect is recorded as a failure with the id left set for
// the runner's CLEANUP PHASE.
//
// Run: node tests/unit/rules_stage342_cleanup.test.js

import assert from 'assert';
import { rulesTests } from '../manual/tests/rules.js';
import { failureList } from '../manual/assert.js';

const GHOST = '19999999-0000-4000-8000-000000000009';
const STAGE_342 = 'MCP-Rule-stage-342';

// opts.stickyDelete: a condition value whose rule survives manage_rules delete (a delete that
// "succeeds" without taking effect, the non-throwing failure the module must notice).
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
  // The module calls the compact tools: a call is (tool, selector value in `action` or `type`).
  const callTool = async (name, args) => {
    calls.push([name, args]);
    switch (`${name}/${args.action ?? args.type ?? ''}`) {
      case 'list_entities/rule':
        return { rules: rules.map(r => ({ ...r })) };
      case 'manage_rules/create':
        if (args.stage === 'default') throw new Error('Invalid stage');
        if (args.actions?.some(a => a.value === GHOST)) throw new Error(`Category ${GHOST} not found; available: cat-1`);
        return { id: create(args) };
      case 'manage_rules/create_batch': {
        const succeeded = [];
        const failed = [];
        args.rules.forEach((r, index) => {
          if (r.actions.some(a => a.value === GHOST)) failed.push({ index, error: `Category ${GHOST} not found; available: cat-1` });
          else if (r.conditions.some(c => c.field === 'bogus_field')) failed.push({ index, error: 'invalid field bogus_field' });
          else succeeded.push({ index, id: create(r) });
        });
        return { total: args.rules.length, successCount: succeeded.length, failureCount: failed.length, succeeded, failed };
      }
      case 'manage_rules/update': {
        const r = rules.find(x => x.id === args.id);
        const { action: _a, id: _i, ...fields } = args;
        if (r) Object.assign(r, fields);
        return {};
      }
      case 'manage_rules/delete': {
        if (args.id === '00000000-0000-0000-0000-000000000000') throw new Error('Rule not found');
        const i = rules.findIndex(x => x.id === args.id);
        if (i >= 0 && marker(rules[i]) !== opts.stickyDelete) rules.splice(i, 1);
        return { success: true };
      }
      default:
        return {};
    }
  };
  return { client: { callTool }, calls, rules };
}

async function run(opts) {
  const { client, calls, rules } = makeClient(opts);
  const context = { categoryId: 'cat-1' };
  const before = failureList().length;
  const log = console.log;
  console.log = () => {};
  try {
    await rulesTests(client, context);
  } finally {
    console.log = log;
  }
  return { calls, rules, context, added: failureList().slice(before) };
}

const deletedIds = (calls) => calls.filter(([n, a]) => n === 'manage_rules' && a.action === 'delete').map(([, a]) => a.id);

// S1 (positive): the #342 rule the module created is deleted, and its context id is cleared.
{
  const r = await run();
  assert.deepStrictEqual(r.added, [], `S1: no failures recorded, got ${JSON.stringify(r.added)}`);
  assert.ok(deletedIds(r.calls).includes('rule-342'), 'S1: manage_rules delete called with the #342 rule id');
  assert.strictEqual(r.context.ruleStage342Id, null, 'S1: context.ruleStage342Id cleared after a verified delete');
  assert.deepStrictEqual(r.rules, [], `S1: no rule left in the store, got ${JSON.stringify(r.rules.map(x => x.id))}`);
}

// S2 (negative): a delete that does not take effect is recorded, and the id stays set so the
// runner's CLEANUP PHASE can retry it.
{
  const r = await run({ stickyDelete: STAGE_342 });
  assert.ok(r.added.includes('Verify delete: ruleStage342Id still present in rules list'),
    `S2: verify-delete failure recorded, got ${JSON.stringify(r.added)}`);
  assert.strictEqual(r.context.ruleStage342Id, 'rule-342', 'S2: context.ruleStage342Id left set for the runner');
  assert.strictEqual(r.context.ruleId, null, 'S2: the other rules were still deleted and cleared');
}

console.log('rules_stage342_cleanup.test.js: all cases passed');
