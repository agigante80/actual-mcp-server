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

await check('chat preset: every published selector value reaches the dispatcher; none is refused', async () => {
  const FIELDS = {
    structure: {}, server: {}, version: {}, preferences: {},
  };
  for (const [name, actions] of Object.entries(CHAT_ACTIONS)) {
    const tool = buildCompactTool(spec(name), policyOps(), undefined, {
      isAvailable: (l) => isOperationPublished(manager.policy, l),
      tools: new Set(manager.policy.published),
    });
    for (const action of actions) {
      const selector = name === 'get_context' ? 'topic' : 'action';
      // Validation of the row's own fields is not under test: a field error is fine, a policy refusal is not.
      const err = await tool.call({ [selector]: action, ...FIELDS[action] }).then(() => null, (e) => e);
      assert.ok(!(err instanceof ToolUnavailableError), `${name} ${action} must not be refused by the policy, got ${err?.message}`);
    }
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
