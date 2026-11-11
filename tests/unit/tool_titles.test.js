// tests/unit/tool_titles.test.js  (#641)
//
// Every published tool carries a human-readable `title` (MCP spec 2025-06-18 onward), from the
// single table in src/lib/tool-titles.ts, attached by the one tools/list builder both transports
// use (src/lib/tool-list-entry.ts, #379). Clients show the title instead of `actual_x_y`, and
// Glama's Tool Definition Quality Score reads it for "Purpose Clarity".
//
// The style rules are pure functions below. Each runs first on in-file fixtures (the negative
// scenarios of #641) so the guard is shown able to fail, then on the real table.
//
// Run: node tests/unit/tool_titles.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// The CI dummy env, set BEFORE anything imports src/config.ts (which exits on invalid env).
process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
for (const k of ['MCP_TOOLSETS', 'MCP_TOOLS', 'MCP_READ_ONLY']) delete process.env[k];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

// ---------------------------------------------------------------- the rules (pure functions)

/** Words allowed to keep capitals after the first word. Extend deliberately, with a reason. */
const ALLOWED_CAPS = new Set(['ID', 'SQL']);

/**
 * First words a read-only tool's title may start with, and a write tool's title may not.
 * Run, Aggregate and Filter are here because actual_query_run, actual_transactions_aggregate
 * and actual_transactions_filter are read-only (tool-annotations.ts READ_ONLY).
 */
const READ_VERBS = new Set([
  'Get', 'List', 'Find', 'Search', 'Summarize', 'Run', 'Aggregate', 'Show', 'Explain',
  'Detect', 'Resolve', 'Filter',
]);

/** Shape violations of one title, as rule names: empty, prefix, words, case. */
function shapeViolations(title) {
  if (typeof title !== 'string' || title.trim() === '') return ['empty'];
  const out = [];
  if (/^actual\b/i.test(title)) out.push('prefix');
  const words = title.split(' ');
  if (words.length < 2 || words.length > 5 || words.some((w) => w === '')) out.push('words');
  const [first, ...rest] = words;
  const firstOk = /^[A-Z][a-z]*$/.test(first ?? '');
  const restOk = rest.every((w) => w === w.toLowerCase() || ALLOWED_CAPS.has(w));
  if (!firstOk || !restOk) out.push('case');
  return out;
}

/** True when the title's first word agrees with the tool's readOnlyHint. */
function verbAgrees(title, readOnly) {
  const first = String(title).split(' ')[0];
  return readOnly ? READ_VERBS.has(first) : !READ_VERBS.has(first);
}

/** [{ title, tools }] for every title used by more than one tool. */
function duplicates(table) {
  const byTitle = new Map();
  for (const [name, title] of Object.entries(table)) {
    byTitle.set(title, [...(byTitle.get(title) ?? []), name]);
  }
  return [...byTitle].filter(([, tools]) => tools.length > 1).map(([title, tools]) => ({ title, tools }));
}

const missingFrom = (table, names) => names.filter((n) => !Object.prototype.hasOwnProperty.call(table, n));
const staleIn = (table, names) => Object.keys(table).filter((k) => !names.includes(k));

/** Published entries whose title is not the table's title for that tool. */
const titleMismatches = (entries, table) =>
  entries.filter((e) => e.title !== table[e.name]).map((e) => `${e.name}=${JSON.stringify(e.title)}`);

// ---------------------------------------------------------------- fixture self-tests

console.log('\n[#641] fixture self-tests: each rule can fail');

await check('NEGATIVE: a missing title is reported by name', () => {
  assert.deepStrictEqual(missingFrom({ actual_accounts_list: 'List accounts' }, ['actual_accounts_list', 'actual_budgets_resetHold']),
    ['actual_budgets_resetHold']);
});
await check('NEGATIVE: a stale key is reported by name', () => {
  assert.deepStrictEqual(staleIn({ actual_accounts_list: 'List accounts', actual_removed_tool: 'Remove thing' }, ['actual_accounts_list']),
    ['actual_removed_tool']);
});
await check('NEGATIVE: two tools sharing a title are reported with both names', () => {
  assert.deepStrictEqual(duplicates({ actual_a: 'List things', actual_b: 'List things', actual_c: 'Get other' }),
    [{ title: 'List things', tools: ['actual_a', 'actual_b'] }]);
});
await check('NEGATIVE: a write tool titled with a read verb fails the verb rule', () => {
  assert.strictEqual(verbAgrees('Get account', false), false, 'actual_accounts_delete as "Get account"');
  assert.strictEqual(verbAgrees('Delete account', true), false, 'a read-only tool starting with a write verb');
  assert.strictEqual(verbAgrees('Delete account', false), true);
  assert.strictEqual(verbAgrees('List accounts', true), true);
});
await check('NEGATIVE: a leading "Actual" fails the prefix rule', () => {
  assert.ok(shapeViolations('Actual accounts list').includes('prefix'));
});
await check('NEGATIVE: one word fails the word-count rule', () => {
  assert.deepStrictEqual(shapeViolations('List'), ['words']);
});
await check('NEGATIVE: six words fail the word-count rule', () => {
  assert.deepStrictEqual(shapeViolations('List all of the open accounts'), ['words']);
});
await check('NEGATIVE: a double space fails the word-count rule', () => {
  assert.ok(shapeViolations('List  accounts').includes('words'));
});
await check('NEGATIVE: title case fails the case rule', () => {
  assert.deepStrictEqual(shapeViolations('List Accounts'), ['case']);
});
await check('NEGATIVE: a lowercase first word fails the case rule', () => {
  assert.deepStrictEqual(shapeViolations('list accounts'), ['case']);
});
await check('NEGATIVE: an empty title fails', () => {
  assert.deepStrictEqual(shapeViolations(''), ['empty']);
  assert.deepStrictEqual(shapeViolations(undefined), ['empty']);
});
await check('POSITIVE: an allowed capital passes ("Resolve name to ID")', () => {
  assert.deepStrictEqual(shapeViolations('Resolve name to ID'), []);
});
await check('NEGATIVE: a published title that differs from the table is reported', () => {
  const table = { actual_accounts_list: 'List accounts' };
  assert.deepStrictEqual(titleMismatches([{ name: 'actual_accounts_list', title: 'List accounts' }], table), []);
  assert.deepStrictEqual(titleMismatches([{ name: 'actual_accounts_list', title: 'actual_accounts_list' }], table),
    ['actual_accounts_list="actual_accounts_list"']);
});

// ---------------------------------------------------------------- the real table

console.log('\n[#641] the real title table');

const { TOOL_TITLES, titleFor } = await import('../../dist/src/lib/tool-titles.js');
const { annotationsFor } = await import('../../dist/src/lib/tool-annotations.js');
const { buildToolListEntries } = await import('../../dist/src/lib/tool-list-entry.js');
const manager = (await import('../../dist/src/actualToolsManager.js')).default;

const implementedSrc = readFileSync(join(ROOT, 'src/actualToolsManager.ts'), 'utf8');
const implemented = [...implementedSrc.slice(0, implementedSrc.indexOf('];')).matchAll(/'(actual_[A-Za-z0-9_]+)'/g)]
  .map((m) => m[1]);

await check('IMPLEMENTED_TOOLS was read (guards against every check passing over nothing)', () => {
  assert.ok(implemented.length >= 80, `found only ${implemented.length} names`);
});
await check('every tool in IMPLEMENTED_TOOLS has a title', () => {
  assert.deepStrictEqual(missingFrom(TOOL_TITLES, implemented), []);
});
await check('no stale key: every TOOL_TITLES key is in IMPLEMENTED_TOOLS', () => {
  assert.deepStrictEqual(staleIn(TOOL_TITLES, implemented), []);
});
await check('titles are unique across the set', () => {
  assert.deepStrictEqual(duplicates(TOOL_TITLES), []);
});
await check('every title passes the shape rules (empty, prefix, words, case)', () => {
  const bad = Object.entries(TOOL_TITLES)
    .map(([name, title]) => [name, title, shapeViolations(title)])
    .filter(([, , v]) => v.length > 0)
    .map(([name, title, v]) => `${name} "${title}": ${v.join(', ')}`);
  assert.deepStrictEqual(bad, []);
});
await check('every title\'s first word agrees with the tool\'s readOnlyHint', () => {
  const bad = Object.entries(TOOL_TITLES)
    .filter(([name, title]) => !verbAgrees(title, annotationsFor(name).readOnlyHint === true))
    .map(([name, title]) => `${name} "${title}" (readOnlyHint ${annotationsFor(name).readOnlyHint})`);
  assert.deepStrictEqual(bad, []);
});
await check('two pinned titles: Create transaction, Release budget hold', () => {
  assert.strictEqual(TOOL_TITLES.actual_transactions_create, 'Create transaction');
  assert.strictEqual(TOOL_TITLES.actual_budgets_resetHold, 'Release budget hold');
});
await check('titleFor returns undefined for an unknown name, including an Object.prototype key', () => {
  assert.strictEqual(titleFor('actual_not_a_tool'), undefined);
  assert.strictEqual(titleFor('toString'), undefined);
});

// ---------------------------------------------------------------- the builder and fetchCapabilities

console.log('\n[#641] the published entries');

const resolveStub = () => ({ description: 'd', schema: { type: 'object', properties: {} } });

await check('buildToolListEntries publishes the table title, never annotations.title', () => {
  const [entry] = buildToolListEntries(['actual_transactions_create'], resolveStub);
  assert.strictEqual(entry.title, 'Create transaction');
  assert.strictEqual(entry.annotations.title, undefined);
});
await check('NEGATIVE: an unknown tool gets no title member at all, not an undefined one', () => {
  const [entry] = buildToolListEntries(['actual_not_a_tool'], resolveStub);
  assert.strictEqual('title' in JSON.parse(JSON.stringify(entry)), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(entry, 'title'), false);
});
await check('every registered tool, built through the shared builder, carries its table title', () => {
  const entries = buildToolListEntries(implemented, resolveStub);
  assert.deepStrictEqual(titleMismatches(entries, TOOL_TITLES), []);
});

await manager.initialize({ toolsets: 'all', tools: '', readOnly: false });
const { ActualMCPConnection } = await import('../../dist/src/lib/ActualMCPConnection.js');
const caps = await new ActualMCPConnection().fetchCapabilities();
const capList = caps.tools.list;

await check('fetchCapabilities lists the published tools, not the demo fallback', () => {
  assert.deepStrictEqual(capList.map((t) => t.name).sort(), manager.getPublishedToolNames().sort());
});
await check('fetchCapabilities publishes the builder\'s titles (no `title: tool.name` override)', () => {
  assert.deepStrictEqual(titleMismatches(capList, TOOL_TITLES), []);
});
await check('NEGATIVE: re-adding the old `title: tool.name` override is caught by the same check', () => {
  const overridden = capList.map((t) => ({ ...t, title: t.name }));
  assert.strictEqual(titleMismatches(overridden, TOOL_TITLES).length, capList.length);
});

console.log(`\n[#641] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
