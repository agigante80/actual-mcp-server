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

for (const name of ['list_budget_months', 'manage_budget_files', 'list_entities', 'summarize_transactions', 'search_transactions']) {
  await check(`${name}: the published description is laid out as short lines`, () => {
    const description = published.get(name);
    assert.ok(typeof description === 'string', `${name} is published`);
    assert.deepStrictEqual(layoutProblems(name, description), []);
    assert.ok(description.includes('\n'), `${name}: no newline in the published description`);
  });
}

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
