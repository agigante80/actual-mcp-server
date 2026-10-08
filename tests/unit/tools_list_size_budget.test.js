// tests/unit/tools_list_size_budget.test.js
//
// #486: a size budget for tools/list. Every client pays for the full list on every message, so
// a tool that grows (or a new tool) should be a visible, deliberate decision rather than a
// slow erosion of the savings made by trimming the heaviest schemas.
//
// The list is built the way the server does: buildToolListEntries with z.toJSONSchema over
// the full registry (toolsets 'all'), measured as Buffer.byteLength(JSON.stringify(entries)).
// The check is a pure function; this file also runs it on fixtures so the guard itself is
// proven able to fail (a padded description, and a total ceiling 1 byte too low).
//
// Run: node tests/unit/tools_list_size_budget.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

// Raising either ceiling is a deliberate edit. Change the number AND replace the reason below
// in the same commit; a reviewer should be able to see why the list got heavier.
//   Total: 101,827 bytes after the #486 trim (83 tools), plus about 5% headroom.
//   Per tool: the heaviest entry after the #486 trim is 3,327 bytes (actual_rules_create_batch).
const TOTAL_CEILING = 106900;
const PER_TOOL_CEILING = 3600;

const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value));

/** Pure: returns the list of violations (empty when within budget). */
function checkBudget(entries, totalCeiling, perToolCeiling) {
  const problems = [];
  const hint = 'Raising a ceiling is a deliberate edit to tests/unit/tools_list_size_budget.test.js, with a comment stating why.';
  const total = sizeOf(entries);
  if (total > totalCeiling) {
    problems.push(`tools/list total is ${total} bytes, over the total ceiling of ${totalCeiling}. ${hint}`);
  }
  for (const entry of entries) {
    const size = sizeOf(entry);
    if (size > perToolCeiling) {
      problems.push(`${entry.name} is ${size} bytes, over the per-tool ceiling of ${perToolCeiling}. ${hint}`);
    }
  }
  return problems;
}

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[#486] tools/list size budget');

const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { z } = await import('zod');

await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
const names = manager.getToolNames();
const entries = buildToolListEntries(names, (name) => {
  const tool = manager.getTool(name);
  return { description: tool.description, schema: tool.inputSchema ? z.toJSONSchema(tool.inputSchema) : undefined };
});
const realTotal = sizeOf(entries);

await check('the registry is non-empty and every tool produced an entry', () => {
  assert.ok(names.length > 0);
  assert.strictEqual(entries.length, names.length);
});

await check('the real list is within the total and per-tool ceilings', () => {
  const problems = checkBudget(entries, TOTAL_CEILING, PER_TOOL_CEILING);
  assert.deepStrictEqual(problems, []);
});

await check('a clone with one description padded by 5120 bytes is reported, naming the tool and the per-tool ceiling', () => {
  const clone = JSON.parse(JSON.stringify(entries));
  const target = clone[0];
  target.description += 'x'.repeat(5120);
  const problems = checkBudget(clone, Number.MAX_SAFE_INTEGER, PER_TOOL_CEILING);
  assert.strictEqual(problems.length, 1);
  assert.ok(problems[0].includes(target.name), problems[0]);
  assert.ok(problems[0].includes(`per-tool ceiling of ${PER_TOOL_CEILING}`), problems[0]);
  assert.ok(problems[0].includes('deliberate edit'), problems[0]);
});

await check('a total ceiling 1 byte under the real total fails, naming the total and the ceiling', () => {
  const problems = checkBudget(entries, realTotal - 1, Number.MAX_SAFE_INTEGER);
  assert.strictEqual(problems.length, 1);
  assert.ok(problems[0].includes(`${realTotal} bytes`), problems[0]);
  assert.ok(problems[0].includes(`total ceiling of ${realTotal - 1}`), problems[0]);
  assert.ok(problems[0].includes('deliberate edit'), problems[0]);
});

await check('a total ceiling exactly at the real total passes', () => {
  assert.deepStrictEqual(checkBudget(entries, realTotal, Number.MAX_SAFE_INTEGER), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
