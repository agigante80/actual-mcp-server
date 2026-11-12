// tests/unit/tool_description_checklist.test.js
//
// #650: a mechanical floor under the tool descriptions rewritten for Glama's Tool Definition
// Quality Score (#640 and #650). The score itself comes from an LLM grader and cannot run in
// CI, so this guard checks the three things every rewrite was written to state, which the
// grader marked missing before:
//   (a) the return shape: a sentence starting "Returns" (a status-only tool names its status,
//       for example "Returns { success: true }"; there is no exemption);
//   (b) disambiguation: the description names at least one OTHER tool by its full name, and every
//       name it uses is published in the full set (getPublishedToolNames() with toolsets 'all'). Whether
//       a name is hidden under the `chat` preset is toolsets.test.js's job (its chat reference
//       check), not this file's;
//   (c) none of the filler phrases the grader penalised: "in Actual Budget.", "Perfect for",
//       "Ideal for".
// Only the listed tools are checked: the rest of the registry has not been rewritten yet, and
// adding a tool here is the deliberate step that holds it to the floor.
//
// Run: node tests/unit/tool_description_checklist.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

// #640: the 10 lowest TDQS baseline medians.
const REWRITTEN_640 = [
  'actual_transactions_create', 'actual_payees_create', 'actual_accounts_create', 'actual_accounts_update',
  'actual_transactions_filter', 'actual_transactions_search_by_category', 'actual_transactions_search_by_month',
  'actual_transactions_search_by_payee', 'actual_categories_update', 'actual_rules_get',
];
// #650: the 14 weakest on Glama's own TDQS for v0.27.1 that #640 had not rewritten.
const REWRITTEN_650 = [
  'actual_transactions_get', 'actual_category_groups_get', 'actual_budgets_get_month', 'actual_categories_delete',
  'actual_category_groups_create', 'actual_category_groups_update', 'actual_budgets_reset_hold', 'actual_budgets_transfer',
  'actual_categories_create', 'actual_payee_rules_get', 'actual_payees_update', 'actual_schedules_create',
  'actual_schedules_delete', 'actual_transactions_import',
];
const CHECKED = [...REWRITTEN_640, ...REWRITTEN_650];
const BANNED = ['in Actual Budget.', 'Perfect for', 'Ideal for'];

/** Pure: the checklist problems of one description (empty when it passes). */
function checklistProblems(name, description, published) {
  const problems = [];
  const text = description ?? '';
  if (!/(^|[.:]\s+|\n\s*)Returns\b/.test(text)) {
    problems.push(`${name}: no sentence starting "Returns" (state the return shape, or the status for a status-only tool)`);
  }
  const others = [...new Set(text.match(/\bactual_[A-Za-z_]+/g) ?? [])].filter((n) => n !== name);
  const unpublished = others.filter((n) => !published.has(n));
  if (others.length === 0) {
    problems.push(`${name}: names no other tool (say when to use a sibling instead)`);
  }
  // Every named tool must exist: one real sibling does not excuse a misspelled or removed one.
  if (unpublished.length > 0) {
    problems.push(`${name}: names unpublished tools (${unpublished.join(', ')})`);
  }
  for (const phrase of BANNED) {
    if (text.includes(phrase)) problems.push(`${name}: contains the filler phrase "${phrase}"`);
  }
  return problems;
}

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[#650] tool description checklist');

const manager = (await import('../../dist/src/actualToolsManager.js')).default;
await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
const published = new Set(manager.getPublishedToolNames());

await check('every checked tool is registered (a renamed tool cannot silently leave the guard)', () => {
  assert.strictEqual(new Set(CHECKED).size, 24);
  assert.deepStrictEqual(CHECKED.filter((n) => !published.has(n)), []);
});

await check('every checked description passes the checklist', () => {
  const problems = CHECKED.flatMap((n) => checklistProblems(n, manager.getTool(n).description, published));
  assert.deepStrictEqual(problems, []);
});

// The guard must be able to fail: one fixture per rule.
const GOOD = 'Lists x. Use actual_payees_get for payees instead. Returns { items }.';
await check('a passing fixture passes', () => {
  assert.deepStrictEqual(checklistProblems('actual_x_get', GOOD, published), []);
});
await check('rule (a): no "Returns" sentence is reported', () => {
  const p = checklistProblems('actual_x_get', 'Lists x. Use actual_payees_get instead. It returns items.', published);
  assert.ok(p.length === 1 && /Returns/.test(p[0]), p.join('; '));
});
await check('rule (b): no other tool named is reported; naming only itself does not count', () => {
  const p = checklistProblems('actual_x_get', 'Lists x, see actual_x_get. Returns { items }.', published);
  assert.ok(p.length === 1 && /names no other tool/.test(p[0]), p.join('; '));
});
await check('rule (b): naming only an unpublished tool is reported', () => {
  const p = checklistProblems('actual_x_get', 'Lists x. Use actual_nope_missing instead. Returns { items }.', published);
  assert.ok(p.length === 1 && /unpublished/.test(p[0]), p.join('; '));
});
await check('rule (b): one unpublished name beside a published one is still reported', () => {
  const p = checklistProblems('actual_x_get', 'Lists x. Use actual_payees_get or actual_payee_serch instead. Returns { items }.', published);
  assert.ok(p.length === 1 && p[0].includes('actual_payee_serch'), p.join('; '));
});
await check('rule (c): each filler phrase is reported', () => {
  for (const phrase of BANNED) {
    const p = checklistProblems('actual_x_get', `${GOOD} ${phrase} reconciliation`, published);
    assert.ok(p.length === 1 && p[0].includes(phrase), `${phrase}: ${p.join('; ')}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
