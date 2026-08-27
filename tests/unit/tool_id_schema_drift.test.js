// tests/unit/tool_id_schema_drift.test.js
//
// #380: an id-shaped field in a tool schema must use CommonSchemas, or be on the documented
// exception list below.
//
// WHY. Before this, the surface described the same concept FOUR different ways: the shared
// schema, an inline `UUID_PATTERN` regex meaning the identical thing, a bounded
// `z.string().min(1).max(64)` from #356, and a bare `z.string()`. 33 of 41 id fields were on
// one of the loose forms, so `actual_accounts_update.id` was published as a UUID while
// `actual_categories_update.id` was published as any string. That is not a convention a
// reader can rely on, and the api-design-principles skill claimed it was one.
//
// The sweep is only half the fix. Tier four grew to 18 fields one tool at a time, and it
// will do so again unless something fails the build. That is this file.
//
// Run: node tests/unit/tool_id_schema_drift.test.js

import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS_DIR = join(ROOT, 'src', 'tools');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/**
 * Fields that are id-SHAPED by name but must NOT use a UUID schema. Each needs a reason,
 * because the whole point is that the next sweep does not "fix" one of these.
 */
const EXCEPTIONS = {
  // Synthetic ids, not entity rows. `budget-2026-01` is a legitimate value and #376 moved
  // the guard that depends on it into the adapter, so this is freshly load bearing.
  'notes_get.ts:id': 'accepts the synthetic budget-YYYY-MM month id as well as an entity UUID',
  'notes_update.ts:id': 'accepts the synthetic budget-YYYY-MM month id as well as an entity UUID',

  // CATEGORY B (#380): optional FILTER fields, not lookups. Tightening these is a real
  // behaviour change (today a caller passing a NAME gets an empty result; after, a schema
  // error), and transactions_search_by_amount deliberately DETECTS a name passed where an id
  // belongs and answers with the correct UUID. That accommodation would be deleted by a
  // blind sweep. Tracked as its own decision rather than folded in here.
  'bank_sync.ts:accountId': 'Category B: optional filter, pending the #380 follow-up decision',
  'transactions_filter.ts:accountId': 'Category B: optional filter',
  'transactions_filter.ts:categoryId': 'Category B: optional filter',
  'transactions_filter.ts:payeeId': 'Category B: optional filter',
  'transactions_search_by_amount.ts:accountId': 'Category B: optional filter',
  'transactions_search_by_category.ts:accountId': 'Category B: optional filter',
  'transactions_search_by_month.ts:accountId': 'Category B: optional filter',
  'transactions_search_by_payee.ts:accountId': 'Category B: optional filter',
  'transactions_summary_by_category.ts:accountId': 'Category B: optional filter',
  'transactions_summary_by_payee.ts:accountId': 'Category B: optional filter',

  // NOT Actual entity UUIDs at all. An MCP session id is minted by this server and looks
  // like `stdio-2f72a857-...`; an imported_id comes from the BANK and its shape is the
  // aggregator's business, not ours. Typing either as a UUID would reject valid input.
  'session_close.ts:sessionId': 'an MCP session id minted by this server, not an Actual UUID',
  'transactions_create.ts:imported_id': "the bank's own identifier; shape is the aggregator's",
  'transactions_import.ts:imported_id': "the bank's own identifier; shape is the aggregator's",
  'transactions_update.ts:imported_id': "the bank's own identifier; shape is the aggregator's",

  // A nested value inside `fields`, alongside `account` and `category`, which are entity ids
  // too but are not id-SHAPED by name so this guard never sees them. Tightening one of the
  // three and not the others would be worse than tightening none. Decide the `fields.*`
  // group together, with Category B.
  'transactions_update.ts:transfer_id': 'nested fields.* payload id; decide with Category B',
};

/** Strip comments so an id-shaped name inside prose is not read as a schema field. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Find id-shaped schema fields declared with a RAW zod string rather than CommonSchemas.
 *
 * Deliberately narrow: only top-level-looking `name: z.string()...` declarations whose name
 * is `id`, `*Id` or `*_id`. Nested `fields.*` payload ids are a separate question (they are
 * nullable update values, closer to Category B), and matching them here would make the
 * exception list longer than the rule.
 */
function looseIdFields(src) {
  const out = [];
  for (const m of strip(src).matchAll(/^\s{2,4}(id|[A-Za-z]+Id|[a-z]+_id)\s*:\s*(z\.[^\n]*)$/gm)) {
    if (!/CommonSchemas\./.test(m[2])) out.push({ field: m[1], decl: m[2].trim().slice(0, 60) });
  }
  return out;
}

console.log('\n[tool-id-schema-drift]');

const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

check('the tool set is real (an empty glob would pass every check below)', () => {
  assert.ok(files.length >= 70, `expected ~74 tool files, found ${files.length}`);
});

check('every id-shaped field uses CommonSchemas, or is a documented exception', () => {
  const offenders = [];
  for (const f of files) {
    for (const { field, decl } of looseIdFields(readFileSync(join(TOOLS_DIR, f), 'utf8'))) {
      const key = `${f}:${field}`;
      if (!(key in EXCEPTIONS)) offenders.push(`${key}  (${decl})`);
    }
  }
  assert.strictEqual(
    offenders.length,
    0,
    `id-shaped fields not using CommonSchemas:\n      ${offenders.join('\n      ')}\n` +
      `      Use CommonSchemas.<entity>Id, or add an entry to EXCEPTIONS here WITH A REASON.`,
  );
});

check('every exception still exists (a stale entry hides a real regression)', () => {
  const stale = Object.keys(EXCEPTIONS).filter((key) => {
    const [file, field] = key.split(':');
    if (!files.includes(file)) return true;
    return !looseIdFields(readFileSync(join(TOOLS_DIR, file), 'utf8')).some((x) => x.field === field);
  });
  assert.strictEqual(
    stale.length,
    0,
    `EXCEPTIONS entries that no longer match anything: ${stale.join(', ')}. ` +
      `Remove them, or the list will quietly permit a future field of the same name.`,
  );
});

check('no tool inlines UUID_PATTERN instead of using the shared schema', () => {
  // The same rule expressed twice is how a fifth tier appears. #380 converted the two
  // schedule tools; CommonSchemas.scheduleId exists now, so there is no reason to inline it.
  const inliners = files.filter((f) => /UUID_PATTERN/.test(strip(readFileSync(join(TOOLS_DIR, f), 'utf8'))));
  assert.strictEqual(inliners.length, 0, `inline UUID_PATTERN in: ${inliners.join(', ')}`);
});

// NEGATIVE fixture: prove the detector fires rather than passing over an empty set.
check('NEGATIVE: a bare z.string() id is detected', () => {
  const found = looseIdFields("const S = z.object({\n  id: z.string().describe('x'),\n});");
  assert.deepStrictEqual(found.map((f) => f.field), ['id'], 'detector must flag a bare id');
});

check('NEGATIVE: a CommonSchemas id is NOT flagged', () => {
  const found = looseIdFields("const S = z.object({\n  id: CommonSchemas.accountId.describe('x'),\n});");
  assert.deepStrictEqual(found, [], 'detector must not flag a properly typed id');
});

console.log(`\n[tool-id-schema-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
