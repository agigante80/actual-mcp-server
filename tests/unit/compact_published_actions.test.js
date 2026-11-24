// tests/unit/compact_published_actions.test.js
//
// #770: a compact tool publishes only the actions its policy lets a call reach, and its text names
// only the compact tools the same tools/list carries. Before this, MCP_TOOLSETS=chat listed
// manage_budget_months with seven actions of which four were refused, a selector enum and a
// description that offered them, and run_query pointing at three tools the preset hides.
//
//   - the published selector enum is exactly the reachable actions (and the full set under `all`);
//   - the description drops the clauses, "Returns" shapes and sibling names of what is not published;
//   - a call to a hidden action is STILL refused by the policy, naming MCP_TOOLSETS and listing the
//     enabled actions, and a bad selector value names only the published ones;
//   - every published selector value reaches the dispatcher under the chat preset;
//   - MCP_READ_ONLY hides the writers whole, the readers keep every action.
//
// The ops stub below runs the REAL policy checks (callOperation's own two) and nothing else, so no
// call reaches the adapter or a server.
//
// Run: node tests/unit/compact_published_actions.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[compact-published-actions]');

const { z } = await import('zod');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, availableActions } = await import('../../dist/src/compact/dispatch.js');
const { PRESETS, isOperationPublished, operationUnavailableError, readOnlyError } = await import('../../dist/src/lib/toolsets.js');
const { ToolUnavailableError } = await import('../../dist/src/lib/errors.js');
const { FULL_SURFACE } = await import('../../dist/src/compact/types.js');

const spec = (name) => COMPACT_TOOLS.find((c) => c.name === name);
const open = (settings) => manager.initialize({ toolsets: 'all', tools: '', readOnly: false, surface: 'compact', ...settings });
const selectorValues = (name) => {
  const props = z.toJSONSchema(manager.getTool(name).inputSchema).properties ?? {};
  return (props.action ?? props.topic)?.enum;
};
const description = (name) => manager.getTool(name).description;

/** The real policy checks, the way callOperation makes them, and nothing else. */
const policyOps = () => ({
  callOperation: async (legacy, _args, via) => {
    const policy = manager.policy;
    const err = readOnlyError(policy, legacy) ?? operationUnavailableError(policy, legacy, via);
    if (err) throw err;
    return { reached: legacy };
  },
});

const CHAT_ACTIONS = {
  get_context: ['structure', 'server', 'version', 'preferences'],
  manage_transactions: ['create', 'update', 'update_batch', 'delete'],
  manage_budget_months: ['set_amount', 'set_amount_batch', 'transfer'],
  manage_rules: ['create', 'create_batch'],
};

await open({ toolsets: 'chat' });

await check('chat preset: the selector enum of each tool is exactly the actions the preset can reach', () => {
  for (const [name, actions] of Object.entries(CHAT_ACTIONS)) assert.deepStrictEqual(selectorValues(name), actions, name);
});

await check('chat preset: the bare preset publishes list_budget_months with its month route (actual_budgets_get_months in the list)', () => {
  assert.ok(PRESETS.chat.includes('actual_budgets_get_months'));
  assert.ok(isOperationPublished(manager.policy, 'actual_budgets_get_months'));
  assert.ok(isOperationPublished(manager.policy, 'actual_budgets_get_month'));
  assert.ok(manager.getToolNames().length > 0);
});

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const cond = [{ field: 'imported_payee', op: 'is', value: 'x' }];
const act = [{ op: 'set', field: 'category', value: U }];
/** Minimal VALID fields per action, so a call gets past validation and meets the policy (#770 M2). */
const VALID = {
  get_context: { structure: {}, server: {}, version: {}, preferences: {} },
  manage_transactions: {
    create: { account: U, date: '2026-01-05', amount: 100 },
    update: { id: U, notes: 'n' },
    update_batch: { updates: [{ id: U, fields: { notes: 'n' } }] },
    delete: { id: U },
    import: { account_id: U, txs: [{ date: '2026-01-05', amount: 100 }] },
    merge: { ids: [U, V] },
    transfer: { from_account: U, to_account: V, amount: 100, date: '2026-01-05' },
  },
  manage_budget_months: {
    set_amount: { month: '2026-01', category_id: U, amount: 100 },
    set_amount_batch: { operations: [{ month: '2026-01', categoryId: U, amount: 100 }] },
    set_carryover: { month: '2026-01', category_id: U, flag: true },
    hold: { month: '2026-01', amount: 100 },
    reset_hold: { month: '2026-01' },
    transfer: { month: '2026-01', from_category_id: U, to_category_id: V, amount: 100 },
    set_note: { month: '2026-01', note: 'n' },
  },
  manage_rules: {
    create: { conditions: cond, actions: act },
    create_batch: { rules: [{ conditions: cond, actions: act }] },
    upsert: { conditions: cond, actions: act },
    update: { id: U, stage: 'pre' },
    delete: { id: U },
  },
};

await check('chat preset: a published action reaches the operation callback, a hidden one is refused by the policy', async () => {
  for (const [name, byAction] of Object.entries(VALID)) {
    const reached = [];
    const ops = {
      callOperation: async (legacy, args, via) => {
        const err = readOnlyError(manager.policy, legacy) ?? operationUnavailableError(manager.policy, legacy, via);
        if (err) throw err;
        reached.push(legacy);
        return { ok: true };
      },
    };
    const tool = buildCompactTool(spec(name), ops, undefined, {
      isAvailable: (l) => isOperationPublished(manager.policy, l),
      tools: new Set(manager.policy.published),
    });
    const published = new Set(selectorValues(name));
    for (const [action, fields] of Object.entries(byAction)) {
      const selector = name === 'get_context' ? 'topic' : 'action';
      const before = reached.length;
      const err = await tool.call({ [selector]: action, ...fields }).then(() => null, (e) => e);
      if (published.has(action)) {
        assert.strictEqual(err, null, `${name} ${action} is published and must succeed, got ${err?.message}`);
        assert.strictEqual(reached.length, before + 1, `${name} ${action} must reach the operation callback`);
      } else {
        assert.ok(err instanceof ToolUnavailableError, `${name} ${action} is hidden and must be refused by the policy, got ${err?.message}`);
        assert.strictEqual(reached.length, before, `${name} ${action} must not reach the operation callback`);
      }
    }
    // Every published action is covered by a fixture (a new action cannot slip past this test).
    for (const action of published) assert.ok(action in byAction, `${name}: no fixture for published action ${action}`);
  }
});

await check('chat preset: the description of each narrowed tool names no action and no sibling it does not publish', () => {
  const budget = description('manage_budget_months');
  for (const hidden of ['set_carryover', 'hold', 'reset_hold', 'set_note']) {
    assert.ok(!new RegExp(`(^|[ \\n])${hidden}[:,)]`).test(budget), `manage_budget_months must not offer ${hidden}: ${budget}`);
  }
  assert.ok(budget.includes('set_amount:') && budget.includes('transfer:'));
  assert.ok(!budget.includes('manage_budget_files') && !budget.includes('manage_categories'), 'siblings the chat preset hides');
  assert.ok(budget.includes('list_budget_months'), 'a sibling the preset publishes stays named');
  const query = description('run_query');
  for (const sibling of ['search_transactions', 'summarize_transactions', 'list_entities']) {
    assert.ok(!query.includes(sibling), `run_query must not name ${sibling}`);
  }
  assert.ok(query.includes('list_budget_months'));
  const rules = description('manage_rules');
  assert.ok(!/(^|\n)(upsert|update|delete):/.test(rules) && !rules.includes('list_entities') && !rules.includes('manage_schedules'));
  assert.ok(/(^|\n)create_batch:/.test(rules));
  const tx = description('manage_transactions');
  assert.ok(!/(^|\n| )(import|merge|transfer): /.test(tx), 'manage_transactions must not offer import, merge or transfer');
  assert.ok(!tx.includes('search_transactions') && !tx.includes('list_entities'));
  assert.ok(tx.startsWith('Create, change or delete transactions;'), tx.slice(0, 80));
});

await check('chat preset: the Returns line of a narrowed tool carries only the published shapes', () => {
  const budget = description('manage_budget_months');
  assert.ok(budget.includes('(set_amount)') && budget.includes('(transfer)'));
  assert.ok(!budget.includes('(hold)') && !budget.includes('(set_note)') && !budget.includes('reset_hold'));
  const rules = description('manage_rules');
  assert.ok(rules.includes('(create)') && rules.includes('(create_batch)') && !rules.includes('(upsert)') && !rules.includes('(update, delete)'));
});

await check('chat preset: a layout of at least 3 lines, each at most 400 characters, ending in Returns, holds for every narrowed tool', () => {
  for (const name of ['list_budget_months', 'manage_rules']) {
    const lines = description(name).split('\n');
    assert.ok(lines.length >= 3, `${name}: fewer than 3 lines`);
    assert.ok(lines.every((l) => l.length <= 400), `${name}: a line is longer than 400 characters`);
    assert.ok(lines[lines.length - 1].startsWith('Returns'), `${name}: last line must start with Returns`);
  }
});

await check('NEGATIVE: a hidden action is still refused naming MCP_TOOLSETS, and the refusal lists the enabled actions', async () => {
  const err = await manager.getTool('manage_budget_months').call({ action: 'hold', month: '2026-01', amount: 5 }).then(() => null, (e) => e);
  assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
  assert.strictEqual(err.setting, 'MCP_TOOLSETS');
  assert.strictEqual(
    err.message,
    'Tool "manage_budget_months with action hold" is not available: this server\'s MCP_TOOLSETS configuration does not enable that action. Enabled actions: set_amount, set_amount_batch, transfer.',
  );
});

await check('NEGATIVE: a selector value that exists nowhere names only the published actions', async () => {
  const err = await manager.getTool('manage_budget_months').call({ action: 'nope' }).then(() => null, (e) => e);
  assert.ok(err, 'must be refused');
  const text = JSON.stringify(err.issues ?? err.message);
  assert.ok(text.includes('Invalid option: expected one of \\"set_amount\\"|\\"set_amount_batch\\"|\\"transfer\\"'), text);
  assert.ok(!text.includes('set_note') || !/expected one of[^\]]*set_note/.test(text), 'the message must not offer set_note');
});

await check('NEGATIVE: a field that belongs only to a hidden action is refused naming the published actions only', async () => {
  const err = await manager.getTool('manage_budget_months').call({ action: 'transfer', month: '2026-01', flag: true }).then(() => null, (e) => e);
  assert.ok(err, 'must be refused');
  const text = String(err.message);
  assert.ok(/flag/.test(text), text);
  assert.ok(!/set_carryover/.test(text), `the refusal must not offer the hidden set_carryover: ${text}`);
});

await check('NEGATIVE: the formatted text a client receives for a bad selector lists exactly the published actions (M1)', async () => {
  const err = await manager.callTool('manage_budget_months', { action: 'nope' }).then(() => null, (e) => e);
  assert.ok(err, 'must be refused');
  assert.strictEqual(err.message, 'Validation error: action: allowed values: set_amount, set_amount_batch, transfer');
  assert.ok(!/hold|set_carryover|set_note/.test(err.message), `a hidden action leaked: ${err.message}`);
});

await check('NEGATIVE: a published action whose default route is hidden says which argument selects the enabled route (L1)', async () => {
  await open({ toolsets: 'analysis' });
  const err = await manager.getTool('list_entities').call({ type: 'payee' }).then(() => null, (e) => e);
  assert.ok(err instanceof ToolUnavailableError, `expected ToolUnavailableError, got ${err}`);
  assert.strictEqual(
    err.message,
    'Tool "list_entities with type payee" is not available: this server\'s MCP_TOOLSETS configuration does not enable that action. Only the payee call that sets sort is enabled.',
  );
  await open({ toolsets: 'chat' });
});

await check('default surface (toolsets all): every action is published and the text is the spec text, byte for byte', async () => {
  await open({ toolsets: 'all' });
  for (const s of COMPACT_TOOLS) {
    assert.strictEqual(description(s.name), s.description, `${s.name}: description`);
    const values = selectorValues(s.name);
    if (values) assert.deepStrictEqual(values, [...s.actions.keys()], `${s.name}: selector`);
  }
  for (const s of COMPACT_TOOLS) assert.strictEqual(s.describeFor ? s.describeFor(FULL_SURFACE) : s.description, s.description);
});

await check('MCP_READ_ONLY=true: the readers keep every action and name only published siblings', async () => {
  await open({ toolsets: 'all', readOnly: true });
  assert.deepStrictEqual(selectorValues('get_context'), ['structure', 'server', 'version', 'preferences']);
  assert.ok(description('run_query').includes('search_transactions'), 'a published reader stays named');
  for (const writer of ['manage_transactions', 'manage_budget_months', 'manage_rules']) {
    assert.ok(!manager.getToolNames().includes(writer), `${writer} is never a legacy name`);
    assert.ok(!manager.policy.published.includes(writer), `${writer} must be hidden whole under MCP_READ_ONLY`);
  }
  assert.ok(!description('list_budget_months').includes('manage_budget_months'), 'a hidden writer is no longer named');
});

await check('availableActions: a row survives on its route target alone, and nothing available returns the whole table', () => {
  const lbm = spec('list_budget_months');
  const onlyRoute = availableActions(lbm, (l) => l === 'actual_budgets_get_month');
  assert.deepStrictEqual([...onlyRoute.keys()], ['list']);
  assert.deepStrictEqual(onlyRoute.get('list').routes.map((r) => r.legacy), ['actual_budgets_get_month']);
  assert.deepStrictEqual([...availableActions(lbm, () => false).keys()], [...lbm.actions.keys()]);
});

await open({ toolsets: 'all' });
console.log(`\n[compact-published-actions] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
