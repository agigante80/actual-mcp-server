// tests/unit/docs_migration.test.js
//
// #669: the docs:check "migration" module (scripts/docs/migration.mjs). It generates the
// legacy-to-compact table in docs/guides/migrating-to-compact-tools.md from the compact
// registry. Covers: one row per IMPLEMENTED_TOOLS entry, a legacy tool reached from several
// compact actions listing all of them, the session tools marked legacy only, deterministic
// output, an unmapped tool and a build row without a note failing by name, the out-of-scope
// list imported rather than copied, and a guard that no client example names a registered
// legacy tool without MCP_TOOL_SURFACE=legacy.
//
// Run: node tests/unit/docs_migration.test.js   (needs `npm run build` first)

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[docs-migration]');

const migration = await import('../../scripts/docs/migration.mjs');
const { COMPACT_TOOLS, OUT_OF_SCOPE } = await import('../../dist/src/compact/registry.js');
const legacyNames = migration.readLegacyNames(ROOT);
const render = (over = {}) => migration.renderMigrationTable({
  legacyNames, compactTools: COMPACT_TOOLS, outOfScope: OUT_OF_SCOPE, ...over,
});
const rowsOf = (block) => block.split('\n').filter((l) => l.startsWith('| `actual_'));
const rowFor = (block, name) => rowsOf(block).find((l) => l.startsWith(`| \`${name}\` |`));

const block = render();

await check('the generator reads the same legacy names the manager registers', async () => {
  const manager = (await import('../../dist/src/actualToolsManager.js')).default;
  await manager.initialize();
  assert.deepStrictEqual([...legacyNames].sort(), [...manager.getToolNames()].sort());
});

await check('one row per IMPLEMENTED_TOOLS entry, each name once', () => {
  const names = rowsOf(block).map((l) => l.split('`')[1]);
  assert.strictEqual(names.length, legacyNames.length);
  assert.deepStrictEqual(names, legacyNames);
  assert.strictEqual(new Set(names).size, names.length);
});

await check('actual_notes_update lists all four set_note actions', () => {
  const row = rowFor(block, 'actual_notes_update');
  for (const tool of ['manage_accounts', 'manage_categories', 'manage_payees', 'manage_budget_months']) {
    assert.ok(row.includes(`\`${tool}\` (\`action: "set_note"\`)`), `${tool} missing: ${row}`);
  }
  assert.ok(row.includes('budget-<month>'), 'the build note is missing');
});

await check('the session tools are marked legacy only', () => {
  for (const n of OUT_OF_SCOPE) assert.ok(rowFor(block, n).includes('not in the compact surface; legacy only'), n);
  assert.strictEqual(OUT_OF_SCOPE.length, 2);
});

await check('a route row names its trigger and a fixed value is shown', () => {
  assert.ok(rowFor(block, 'actual_budgets_get_month').includes('when `month` is set'));
  assert.ok(rowFor(block, 'actual_get_id_by_name').includes('sets `type: "accounts"`'));
});

await check('two runs give identical bytes', () => {
  assert.strictEqual(render(), block);
});

await check('the committed guide is current', async () => {
  const result = await migration.check({ root: ROOT });
  assert.deepStrictEqual(result.problems, []);
  assert.ok(!result.skipped);
});

await check('NEGATIVE: a legacy tool with no mapping fails naming it', () => {
  assert.throws(() => render({ legacyNames: [...legacyNames, 'actual_brand_new_tool'] }), /actual_brand_new_tool is not mapped/);
});

await check('NEGATIVE: a build row without a note fails naming the row', () => {
  assert.throws(() => render({ notes: {} }), /build row manage_budget_months\.set_note has no entry in BUILD_NOTES/);
});

await check('NEGATIVE: a note for no build row fails naming the note', () => {
  assert.throws(() => render({ notes: { ...migration.BUILD_NOTES, 'manage_tags.create': 'stale' } }), /manage_tags\.create names no build row/);
});

await check('NEGATIVE: a stale block makes check() report it', async () => {
  const result = await migration.check({ root: ROOT, notes: { 'manage_budget_months.set_note': 'a different note' } });
  assert.strictEqual(result.problems.length, 1);
  assert.match(result.problems[0], /stale/);
});

await check('the out-of-scope list is imported, never redefined', () => {
  assert.ok(read('src/compact/registry.ts').includes('export const OUT_OF_SCOPE'));
  assert.ok(read('scripts/docs/migration.mjs').includes('mod.OUT_OF_SCOPE'));
  for (const f of ['scripts/docs/migration.mjs', 'tests/unit/compact_mapping_parity.test.js', 'tests/unit/new_tool_completeness.test.js', 'tests/unit/docs_migration.test.js']) {
    assert.ok(!/OUT_OF_SCOPE\s*=\s*\[/.test(read(f).replace(/\/\/[^\n]*/g, '')), `${f} defines its own list`);
  }
  assert.ok(read('tests/unit/compact_mapping_parity.test.js').includes('OUT_OF_SCOPE } = await import'));
});

// ------------------------------------------------------------ client examples guard

const registered = new Set(legacyNames);
/** Registered legacy tool names a file text mentions, unless it sets MCP_TOOL_SURFACE=legacy. */
function staleNames(text) {
  if (/MCP_TOOL_SURFACE["']?\s*[=:]\s*["']?legacy/.test(text)) return [];
  return [...new Set((text.match(/\bactual_[a-z_]+\b/g) ?? []).filter((n) => registered.has(n)))];
}

await check('no client example names a registered legacy tool without MCP_TOOL_SURFACE=legacy', () => {
  const dir = 'docs/guides/clients/examples';
  const files = readdirSync(join(ROOT, dir));
  assert.ok(files.length >= 7, 'the example files were not found');
  for (const f of files) assert.deepStrictEqual(staleNames(read(`${dir}/${f}`)), [], f);
});

await check('the example guard ignores the your_actual_password placeholder', () => {
  assert.deepStrictEqual(staleNames('"ACTUAL_PASSWORD": "your_actual_password"'), []);
});

await check('NEGATIVE: the example guard fails on a stale name and passes under legacy', () => {
  assert.deepStrictEqual(staleNames('"autoApprove": ["actual_accounts_list"]'), ['actual_accounts_list']);
  assert.deepStrictEqual(staleNames('"env": {"MCP_TOOL_SURFACE": "legacy"}, "tools": ["actual_accounts_list"]'), []);
});

console.log(`\n[docs migration] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
