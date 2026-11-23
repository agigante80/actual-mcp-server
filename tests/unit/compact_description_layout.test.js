// tests/unit/compact_description_layout.test.js
//
// #683 (and #712 for search_transactions): compact tool descriptions are laid out as short lines so they scan (Glama scored
// each Conciseness 4, calling it one dense paragraph). First line: purpose and siblings; then one
// line per action, type or report; last line: the `Returns` sentence. The check is a pure
// function returning ALL problems, run here on the published descriptions (read the way
// tests/unit/tools_list_size_budget.test.js reads them) and on three fixtures that prove it can fail.
//
// Run: node tests/unit/compact_description_layout.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

const MAX_LINE = 400;

/** Pure: every layout problem of one description, each prefixed with the tool name. */
function layoutProblems(name, description) {
  const problems = [];
  const lines = description.split('\n');
  if (lines.length < 3) problems.push(`${name}: fewer than 3 lines`);
  lines.forEach((line, i) => {
    if (line.length > MAX_LINE) problems.push(`${name}: line ${i + 1} longer than ${MAX_LINE} characters`);
  });
  if (!lines[lines.length - 1].startsWith('Returns')) problems.push(`${name}: last line must start with "Returns"`);
  return problems;
}

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}
console.log('\n[compact-description-layout]');

const { z } = await import('zod');
const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool } = await import('../../dist/src/compact/dispatch.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');

const compactMeta = (spec) => {
  const tool = buildCompactTool(spec, { callOperation: async () => undefined });
  return { name: spec.name, description: tool.description, schema: z.toJSONSchema(tool.inputSchema) };
};
const entries = buildToolListEntries(COMPACT_TOOLS.map((c) => c.name), (name) => compactMeta(COMPACT_TOOLS.find((c) => c.name === name)));
const published = new Map(entries.map((e) => [e.name, e.description]));

// #714 (decided 2026-11-22): this list stays hand-kept. manage_rules joined it because its operator
// section was one 1,878-character line; the other nine one-line descriptions stay as they are by
// decision (layout did not move the Glama score beyond its 0.4 run-to-run noise). Do not turn this
// into a loop over every published tool without new evidence.
for (const name of ['list_budget_months', 'manage_budget_files', 'list_entities', 'summarize_transactions', 'search_transactions', 'manage_rules']) {
  await check(`${name}: the published description is laid out as short lines`, () => {
    const description = published.get(name);
    assert.ok(typeof description === 'string', `${name} is published`);
    assert.deepStrictEqual(layoutProblems(name, description), []);
    assert.ok(description.includes('\n'), `${name}: no newline in the published description`);
  });
}

const MANAGE_RULES_LINES = 14;
await check('#714: manage_rules has one line per action and one per condition field group', () => {
  const lines = published.get('manage_rules').split('\n');
  for (const action of ['create', 'create_batch', 'upsert', 'update', 'delete']) {
    assert.strictEqual(lines.filter((l) => l.startsWith(`${action}: `)).length, 1, `one line starting "${action}: "`);
  }
  for (const start of ['Conditions match by field and op: imported_payee, payee_name take ', 'notes takes ', 'id fields (', 'cleared, reconciled take ', 'amount takes ', 'date takes ']) {
    assert.strictEqual(lines.filter((l) => l.startsWith(start)).length, 1, `one line starting "${start}"`);
  }
  // The prefixes alone cannot see a group SPLIT over two lines (its first half still matches), so
  // the line count is pinned too: purpose, 5 actions, 6 groups, the note and the Returns line.
  assert.strictEqual(lines.length, MANAGE_RULES_LINES);
});
await check('#714 NEGATIVE: a condition group split over two lines changes the pinned line count', () => {
  const split = published.get('manage_rules').replace('\namount takes is, ', '\namount takes is,\n');
  assert.notStrictEqual(split, published.get('manage_rules'), 'the fixture really splits the amount group');
  assert.deepStrictEqual(layoutProblems('manage_rules', split), [], 'the generic layout rules do not see the split');
  assert.strictEqual(split.split('\n').length, MANAGE_RULES_LINES + 1);
});
await check('#714 NEGATIVE: manage_rules joined into one line is reported by name', () => {
  const problems = layoutProblems('manage_rules', published.get('manage_rules').replaceAll('\n', ' '));
  assert.deepStrictEqual(problems, [
    'manage_rules: fewer than 3 lines',
    'manage_rules: line 1 longer than 400 characters',
    'manage_rules: last line must start with "Returns"',
  ]);
});

await check('NEGATIVE: a single 1,200-character line is reported as fewer than 3 lines', () => {
  const problems = layoutProblems('fixture_tool', 'x'.repeat(1200));
  assert.ok(problems.includes('fixture_tool: fewer than 3 lines'), JSON.stringify(problems));
});
await check('NEGATIVE: a 401-character second line is reported', () => {
  const problems = layoutProblems('fixture_tool', ['Purpose.', 'y'.repeat(401), 'Returns { ok }.'].join('\n'));
  assert.ok(problems.includes('fixture_tool: line 2 longer than 400 characters'), JSON.stringify(problems));
  assert.strictEqual(problems.length, 1, JSON.stringify(problems));
});
await check('NEGATIVE: a last line that does not start with Returns is reported', () => {
  const problems = layoutProblems('fixture_tool', ['Purpose.', 'one: a, b.', 'Amounts are integer cents.'].join('\n'));
  assert.ok(problems.includes('fixture_tool: last line must start with "Returns"'), JSON.stringify(problems));
});

// #713: a read tool's description must not restate its readOnlyHint annotation. Compact surface
// only (the legacy tools are out of scope), case-sensitive so run_query's "read-only SQL query"
// (what the tool does) is not flagged. Kept apart from layoutProblems, which covers five tools.
const restatementProblems = (name, description) =>
  description.includes('Read-only') ? [`${name}: restates the readOnlyHint annotation (contains "Read-only")`] : [];
const READ_TOOLS = ['get_context', 'list_budget_months', 'list_entities', 'run_query', 'search_transactions', 'summarize_transactions'];
const readOnlyEntries = entries.filter((e) => e.annotations?.readOnlyHint === true);

await check('#713: the compact read tools are exactly the six expected (the check below is not vacuous)', () => {
  assert.deepStrictEqual(readOnlyEntries.map((e) => e.name).sort(), READ_TOOLS);
});
await check('#713: no compact read tool restates its readOnlyHint annotation', () => {
  assert.deepStrictEqual(readOnlyEntries.flatMap((e) => restatementProblems(e.name, e.description)), []);
});
await check('#713 NEGATIVE: a description with " Read-only." appended is reported by name', () => {
  assert.deepStrictEqual(restatementProblems('list_entities', published.get('list_entities').replaceAll('Read-only', '') + ' Read-only.'), [
    'list_entities: restates the readOnlyHint annotation (contains "Read-only")',
  ]);
});

console.log(`\n[compact-description-layout] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
