// tests/unit/prompt_template_calls.test.js
//
// #661 to #665: every tool call a prompt template spells out must be ACCEPTED by the strict
// compact schema of the tool it names. The per-prompt suites only check tool NAMES against
// requiredTools, so renaming `category_name` in search_transactions, or tightening the
// update_batch item, left them all green while the model following the prompt was refused at
// call time. Each row below is one call a template instructs, run through the real compact
// dispatcher with a stubbed callOperation; each argument key must also still appear in the
// rendered text, so a template that stops naming a key drops out of step loudly.
//
// Run: node tests/unit/prompt_template_calls.test.js   (needs `npm run build` first)

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
console.log('\n[prompt-template-calls]');

const { renderPrompt } = await import('../../dist/src/prompts/registry.js');
const { PROMPT_DEFINITIONS } = await import('../../dist/src/prompts/index.js');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool, legacyPhrases } = await import('../../dist/src/compact/dispatch.js');

const phrases = legacyPhrases(COMPACT_TOOLS);
let calls = 0;
const ops = { callOperation: async () => { calls++; return {}; } };
const tools = new Map(COMPACT_TOOLS.map((spec) => [spec.name, buildCompactTool(spec, ops, phrases)]));
const accepts = async (tool, input) => {
  calls = 0;
  await tools.get(tool).call(input);
  assert.strictEqual(calls, 1, `${tool} ${JSON.stringify(input)} must reach exactly one operation`);
};

const P1 = '123e4567-e89b-42d3-a456-426614174000';
const C1 = '223e4567-e89b-42d3-a456-426614174001';
const T1 = '323e4567-e89b-42d3-a456-426614174002';
const RANGE = { start_date: '2026-05-01', end_date: '2026-10-31' };

// prompt -> [arguments to render with, the calls its text instructs]
const TABLE = {
  monthly_review: [{ month: '2026-10' }, [
    ['get_context', { include_payees: false }],
    ['list_budget_months', { month: '2026-10' }],
    ['summarize_transactions', { report: 'by_category', ...RANGE, include_income: true }],
    ['search_transactions', { by: 'category', category_name: 'Food', ...RANGE, limit: 1000 }],
  ]],
  spending_check: [{ date: '2026-10-15' }, [
    ['list_budget_months', { month: '2026-10' }],
    ['summarize_transactions', { report: 'by_category', start_date: '2026-10-01', end_date: '2026-10-15' }],
  ]],
  spending_patterns: [{ months: '6' }, [
    ['summarize_transactions', { report: 'grouped', ...RANGE, group_by: 'month', include_income: true }],
    ['summarize_transactions', { report: 'grouped', ...RANGE, group_by: ['category', 'month'] }],
    ['list_budget_months', { month: '2026-10' }],
  ]],
  budget_cleanup: [{ date: '2026-10-15' }, [
    ...['payee', 'category', 'account'].map((g) => ['summarize_transactions', { report: 'grouped', ...RANGE, group_by: g, include_income: true, exclude_transfers: false }]),
    ...['payee', 'rule', 'category_group', 'account'].map((type) => ['list_entities', { type }]),
    ['list_budget_months', { month: '2026-10' }],
  ]],
  categorize_uncategorized: [{ since: '2026-10-01' }, [
    ['search_transactions', { by: 'uncategorized', include_transactions: true, limit: 50, start_date: '2026-10-01' }],
    ['search_transactions', { by: 'uncategorized', include_transactions: true, limit: 50, offset: 3, start_date: '2026-10-01' }],
    ['list_entities', { type: 'category' }],
    ['list_entities', { type: 'rule' }],
    ['summarize_transactions', { report: 'grouped', start_date: '2000-01-01', end_date: '2026-10-31', group_by: ['payee', 'category'], include_income: true, payee_ids: [P1] }],
    ['manage_transactions', { action: 'update_batch', updates: [{ id: T1, fields: { category: C1 } }] }],
    ['manage_rules', { action: 'create', conditions: [{ field: 'payee', op: 'is', value: P1 }], actions: [{ field: 'category', op: 'set', value: C1 }] }],
  ]],
};

await check('the table covers every registered prompt', () => {
  assert.deepStrictEqual(Object.keys(TABLE).sort(), PROMPT_DEFINITIONS.map((d) => d.name).sort());
});

// Selector keys are spelled as a phrase ("with by category", "report grouped", "type payee",
// "action create"), so the key word itself is in the text too.
for (const [name, [args, rows]] of Object.entries(TABLE)) {
  const def = PROMPT_DEFINITIONS.find((d) => d.name === name);
  const text = def ? JSON.stringify(renderPrompt(def, args)) : '';
  for (const [tool, input] of rows) {
    await check(`${name}: ${tool} ${JSON.stringify(input).slice(0, 70)}`, async () => {
      assert.ok(def, `${name} is registered`);
      assert.ok(text.includes(tool), `the text names ${tool}`);
      for (const key of Object.keys(input)) assert.ok(text.includes(key), `the text names the key ${key}`);
      await accepts(tool, input);
    });
  }
}

// Negative: the harness can refuse. A key no schema has, and an update_batch item with a key
// outside the strict item, must not reach an operation.
await check('a made-up key is refused', async () => {
  await assert.rejects(accepts('search_transactions', { by: 'category', category: 'Food' }));
  assert.strictEqual(calls, 0);
});
await check('an update_batch item outside the strict shape is refused', async () => {
  await assert.rejects(accepts('manage_transactions', { action: 'update_batch', updates: [{ id: T1, category: C1 }] }));
  assert.strictEqual(calls, 0);
});

console.log(`\n[prompt-template-calls] Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
