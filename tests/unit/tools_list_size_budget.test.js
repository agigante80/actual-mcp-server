// tests/unit/tools_list_size_budget.test.js
//
// #486: a size budget for tools/list. Every client pays for the full list on every message, so
// a tool that grows (or a new tool) should be a visible, deliberate decision rather than a
// slow erosion of the savings made by trimming the heaviest schemas.
//
// The list is built the way the server does: buildToolListEntries with z.toJSONSchema over
// getPublishedToolNames(), the list src/index.ts hands to both transports (toolsets 'all'), measured as Buffer.byteLength(JSON.stringify(entries)).
// The check is a pure function; this file also runs it on fixtures so the guard itself is
// proven able to fail (a padded description, and a total ceiling 1 byte too low).
//
// Run: node tests/unit/tools_list_size_budget.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY', 'MCP_TOOL_SURFACE']) delete process.env[k];

// Raising either ceiling is a deliberate edit. Change the number AND replace the reason below
// in the same commit; a reviewer should be able to see why the list got heavier.
//   Total: 101,827 bytes after the #486 trim (83 tools), plus about 5% headroom; raised for
//   #479 (actual_schedules_dates, the 85th tool) from 106,900 at 108,317 bytes, plus about 5%.
//   Per tool: the heaviest entry after the #486 trim was 3,327 bytes (actual_rules_create_batch).
//   Raised for #639 (parameter descriptions, a Glama TDQS input) from 3,600: the nested
//   descriptions on the schedule amount range and recur patterns added 254 bytes to
//   actual_schedules_update, now 3,824 bytes, plus about 2%. The #639 total is 111,333 bytes
//   (2,546 added), under the unchanged total ceiling.
//   Total raised for #641 (a display `title` on every tool, a Glama TDQS input) from 113,700:
//   85 titles added 2,469 bytes, so the list is 113,802 bytes, plus about 2%.
//   #642 (outputSchema on two tools) added 1,326 bytes, so the list is 115,128 bytes and the
//   heaviest entry 3,850: both still under the ceilings, so neither was raised.
//   Total raised for #640 (the 10 lowest TDQS descriptions rewritten) from 116,100: the
//   rewrites added 2,997 bytes net (the ticket caps them at 3,000), so the list is 118,125
//   bytes, plus about 2%. The heaviest entry is unchanged, so the per-tool ceiling is too.
//   Total raised for #711 (one condition operator map equal to Actual's: the rewritten operator
//   help in three rule tools and the described isbetween range in the shared condition schema
//   of four) from 120,500 by exactly the 1,455 bytes it added (120,492 to 121,947 measured).
//   Total raised for #761 to 122,926: #761 publishes `options` {outflow, inflow} on the condition
//   schema of the legacy rule tools. Measured after the rebase on develop (which carries #711 and
//   the other merged work) the legacy total is 122,862 bytes, so the ceiling is that plus 64.
//   The default compact surface total (42,932 measured) and every per-tool ceiling are unchanged.
//   Total raised for #745 (dates validated as real calendar days) from 122,926 to 123,709: the
//   17 legacy date keys that were a bare string now publish the date pattern. Measured after the
//   rebase on develop (which carries #761, #751 and #769) the legacy total is 123,701 bytes
//   (122,862 on develop before this change, so 839 added, validation and not description
//   growth), and the ceiling is that plus 8. The default compact surface total (42,932
//   measured) and every per-tool ceiling are unchanged.
//   Total raised for #747 (an unknown payee or category id is refused on transaction create and
//   update) from 123,709 to 123,776: three legacy descriptions grew by one clause each (122
//   bytes, description text only). Measured after the rebase on develop (which carries #766,
//   whose shorter rule descriptions took the total down to 123,646) the legacy total is
//   123,768 bytes, and the ceiling is that plus 8. The compact surface total and every
//   per-tool ceiling are unchanged.
//   Total raised for #750 (split search) from 123,776 to 124,168: five legacy search tools gained
//   one sentence ("With categoryName, a split is matched by its children; rows carry
//   parent_id.", and the categoryId or notes form on actual_transactions_filter). Measured after
//   the rebase on develop (which carries #747 and #766) the legacy total is 124,160 bytes
//   (123,768 on develop before this change, so 392 added, description text only), and the
//   ceiling is that plus 8. Every per-tool ceiling is unchanged.
//   Total raised for #793 (transfer payee refused on create) from 124,168 to 124,190:
//   actual_transactions_create says a transfer payee is refused and names
//   actual_transfers_create. Measured after the rebase on develop (which carries #750) the
//   legacy total is 124,182 bytes (124,160 before, so 22 added), and the ceiling is that plus 8.
//   2026-11-23, #767/#768/#816/#817 (one batch, ceiling set once): offbudget on account create,
//   the close refusal and delete detachedTransfers wording, account_group_id on account update,
//   and sort_order removed from the group tools. Measured after the rebase on develop (which
//   carries #750, #793 and #818) the legacy total went from 124,106 to 124,567 bytes, and the ceiling is that
//   plus 8. The compact total is 43,412 bytes (43,213 before the batch), under
//   COMPACT_TOTAL_CEILING; the per-tool ceiling is unchanged (heaviest entry 3,893 bytes).
//   Total raised for #801 (a name shared by several entities is refused by the name lookup) from
//   124,575 to 124,653: the actual_get_id_by_name description gained one sentence (78 bytes of
//   description text; the compact list_entities clause adds 54 to the compact total, which stays
//   under its own ceiling). Measured after #802 (which changes no description) the legacy total
//   is 124,645 bytes (124,567 on develop before #801), and the ceiling is that plus 8. Every
//   per-tool ceiling is unchanged.
//   Total raised for #749, #814 and #815 (one pull request) from 124,645 to 125,462: the legacy
//   import row is a closed object (additionalProperties:false plus described pass-through keys),
//   update and update_batch lose the null branch on account, date and amount, and the update_batch
//   item is strict with a reworded description. Measured after the rebase on develop (which carries
//   #801 and #802) the legacy total is 125,454 bytes (124,645 before, 809 added; the split child amount is now an integer check), and the ceiling
//   is that plus 8. The compact total is 43,491 bytes (43,466 before), under COMPACT_TOTAL_CEILING;
//   every per-tool ceiling is unchanged.
//   Total raised for #765/#759/#787 (one pull request, ceiling set once) from 125,462 to 126,092:
//   a transfer payee cannot be renamed and payee create stores notes (#765), income category
//   amounts are refused on an envelope budget and amounts are bounded (#759), and the budget
//   listing marks the active budget and the switch text states its scope (#787). Measured
//   after the rebase on develop (which carries #826) the legacy total is 126,084 bytes
//   (125,454 on develop before this change, so 630 added, description text only), and the
//   ceiling is that plus 8. The compact total is 43,856 bytes (43,491 before), under
//   COMPACT_TOTAL_CEILING. Every per-tool ceiling is unchanged (heaviest entry 3,893 bytes).
//   Total raised for #748 (a split's total is kept on update and delete) from 126,092 to 126,421:
//   one sentence each on the legacy update, update_batch and delete descriptions. Measured on
//   develop 126,084 bytes, after 126,413 (329 added), and the ceiling is that plus 8. The compact
//   total is 43,856 bytes (unchanged by this ticket) and every per-tool ceiling is unchanged.
//   Total raised for #756 (an explicit off-budget accountId is refused) from 126,421 to 126,541:
//   the actual_transactions_filter, _search_by_category and _search_by_month descriptions each
//   say an off-budget accountId is refused (description text only). Measured on develop at
//   126,413 bytes before and 126,533 after (120 added, 40 per tool), and the ceiling is the
//   measured total plus 8. The compact total is 43,831 bytes (43,856 before: the compact
//   search_transactions description was trimmed to pay for its new sentence, 3,874 bytes now,
//   3,899 before), under COMPACT_TOTAL_CEILING; every per-tool ceiling is unchanged.
//   Total lowered for #771 from 126,541 to 126,522: the actual_accounts_delete description now ends
//   `An id that does not exist is refused.` in place of `Deleting an account that does not exist
//   reports success.` (19 bytes fewer). Measured on develop at 126,533 bytes before and 126,514 after,
//   and the ceiling is the measured total plus 8. The compact total is 44,810 bytes (43,831 before,
//   the #758 description corrections), under COMPACT_TOTAL_CEILING; every per-tool ceiling is unchanged.
//   Total raised for the #758 review from 126,522 to 126,557: the legacy actual_query_run description
//   now says a bare table name `returns only { id } per row, so select the fields you need` in place
//   of `returns all its records` (35 bytes more, so the legacy text agrees with the compact one).
//   Measured at 126,514 before and 126,549 after; the ceiling is the measured total plus 8. The compact
//   total is 44,813 bytes (44,810 before), under COMPACT_TOTAL_CEILING; every per-tool ceiling is unchanged
//   (manage_budget_months was trimmed back under 3,900 after the envelope qualification).
//   Total raised for #755 (a cut search says so) from 126,557 to 127,066: the five legacy search
//   descriptions gain the hasMore sentence (and the entities search the total and truncated one),
//   description text only. Measured on develop at 126,549 bytes before and 127,058 after (509
//   added), and the ceiling is the measured total plus 8. The compact total is 44,852 bytes
//   (44,814 before), under COMPACT_TOTAL_CEILING: the compact search_transactions entry is under
//   3,900, paid for by shorter min_amount, max_amount, cleared and reconciled descriptions; list_entities is exactly 3,900 (the word "entity" was dropped from its Returns line).
//   Every per-tool ceiling is unchanged.
const TOTAL_CEILING = 127066;
const PER_TOOL_CEILING = 3900;
// The ceiling for the compact tools COMBINED (what the `compact` surface lists; the design
// record plans 15). The per-tool ceiling above applies to each compact entry unchanged. The
// `all` surface lists both, so its budget is the sum of the two ceilings, never a third number.
// #672 (get_context, list_entities) measured 6210 bytes, so the ceiling is that plus about 10%.
// #673 (search_transactions, summarize_transactions) raised the four-tool total to 13558 bytes (each
// new tool stays under the per-tool ceiling), so the ceiling is now that plus about 10%.
// #674 (list_budget_months, run_query) raised the six-tool total to 16863 bytes, so the ceiling is that plus about 10%.
// #675 (manage_transactions, 3858 bytes as measured here) raised the seven-tool total to 20809 bytes, so the ceiling is that plus about 10%.
// #676 (manage_accounts 2972, manage_categories 2000, manage_payees 1931 bytes) raised the ten-tool total to 27700 bytes, so the ceiling is that plus about 10%.
// #676 (manage_tags, 1229 bytes) raised the eleven-tool total to 28930 bytes, so the ceiling is that plus about 10%.
// #677 (manage_rules 3308, manage_schedules 2294 bytes) raised the thirteen-tool total to 34563 bytes, so the ceiling is that plus about 10%.
// #678 (manage_budget_months, manage_budget_files) completed the fifteen-tool compact surface at 40681 bytes, so the ceiling is that plus about 10%.
// #679 (set_note routing sentences in manage_accounts, manage_categories, manage_payees) grew the fifteen-tool total from 40681 to 41000 bytes (319 more), so the ceiling rose by the same 319, from 44800 to 45119.
// Each later compact ticket raises it by its own measured size, stated here.
const COMPACT_TOTAL_CEILING = 45119;

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
const { outputJsonSchema } = await import('../../dist/src/lib/tool-output.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;
const { z } = await import('zod');
const { getCanonicalCount } = await import('../../scripts/tool-count.mjs');

await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
const registered = manager.getToolNames();
const names = manager.getPublishedToolNames();
const entries = buildToolListEntries(names, (name) => {
  const tool = manager.getTool(name);
  // #642: the published list carries the output schema of a covered tool, so it is measured.
  return { description: tool.description, schema: tool.inputSchema ? z.toJSONSchema(tool.inputSchema) : undefined, outputSchema: outputJsonSchema(tool) };
});
const realTotal = sizeOf(entries);
console.log(`  measured: total ${realTotal} bytes, heaviest ${Math.max(...entries.map(sizeOf))} bytes`);

await check('the measured list is the full registry (published === registered === IMPLEMENTED_TOOLS)', () => {
  const canonical = getCanonicalCount();
  const counts = `published ${names.length}, registered ${registered.length}, IMPLEMENTED_TOOLS ${canonical}`;
  assert.ok(names.length === canonical && registered.length === canonical, counts);
  assert.strictEqual(entries.length, names.length, counts);
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

// ---- #671: the compact surface and the `all` surface ----

const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
const { buildCompactTool } = await import('../../dist/src/compact/dispatch.js');
const compactMeta = (spec) => {
  const tool = buildCompactTool(spec, { callOperation: async () => undefined });
  return { name: spec.name, description: tool.description, schema: z.toJSONSchema(tool.inputSchema) };
};
const compactEntries = buildToolListEntries(COMPACT_TOOLS.map((c) => c.name), (name) => compactMeta(COMPACT_TOOLS.find((c) => c.name === name)));
const compactTotal = sizeOf(compactEntries);
console.log(`  measured: compact ${compactEntries.length} tools, ${compactTotal} bytes; all-surface ${realTotal + compactTotal} bytes`);

await check('the compact tools are within the compact total and the per-tool ceiling', () => {
  assert.deepStrictEqual(checkBudget(compactEntries, COMPACT_TOTAL_CEILING, PER_TOOL_CEILING), []);
});

await check('the all surface (legacy plus compact) is within the sum of the two total ceilings', () => {
  assert.deepStrictEqual(checkBudget([...entries, ...compactEntries], TOTAL_CEILING + COMPACT_TOTAL_CEILING, PER_TOOL_CEILING), []);
});

await check('NEGATIVE: a compact entry padded past the per-tool ceiling, and a compact total 1 byte low, are both reported', () => {
  const fixture = [{ name: 'actual_fixture', description: 'x'.repeat(PER_TOOL_CEILING + 1), inputSchema: {}, annotations: {} }];
  const tooBig = checkBudget(fixture, COMPACT_TOTAL_CEILING, PER_TOOL_CEILING);
  assert.strictEqual(tooBig.length, 1);
  assert.ok(tooBig[0].includes('actual_fixture') && tooBig[0].includes('per-tool ceiling'), tooBig[0]);
  const low = checkBudget(fixture, sizeOf(fixture) - 1, Number.MAX_SAFE_INTEGER);
  assert.strictEqual(low.length, 1);
  assert.ok(low[0].includes('total ceiling'), low[0]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
