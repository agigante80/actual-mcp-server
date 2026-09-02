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
import { readdirSync, readFileSync } from 'fs';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { UUID_PATTERN } = await import('../../dist/src/lib/constants.js');
const toolsIndex = await import('../../dist/src/tools/index.js');

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
  'actual_notes_get:id': 'accepts the synthetic budget-YYYY-MM month id as well as an entity UUID',
  'actual_notes_update:id': 'accepts the synthetic budget-YYYY-MM month id as well as an entity UUID',

  // CATEGORY B, decided by #388 and now closed. These stay bare strings ON PURPOSE, and the
  // reason is no longer "pending a decision", which is the kind of entry that quietly becomes
  // permanent.
  //
  // #380 left them because tightening them is a contract change rather than a sweep, and a blind
  // tightening would have DELETED the best message on the surface: `search_by_amount` detected a
  // name passed where an id belongs and answered with the correct UUID, which a ZodError cannot
  // do because the schema rejects before the handler runs. The surface answered that same mistake
  // three ways (resolve it, refuse it, or silently return an empty result), and THAT was the real
  // defect rather than the schema question that surfaced it.
  //
  // So the schema stays permissive and the answer lives in `adapter.resolveFilterId`, which every
  // one of these now calls: a well-formed id passes through untouched with no listing read, and a
  // name is resolved to its id inside a NotFoundRefusal. Tightening these to `CommonSchemas` ids
  // would re-delete the accommodation, so this exception is load bearing, not a deferral.
  'actual_bank_sync:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_get:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_filter:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_filter:categoryId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_filter:payeeId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_search_by_amount:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_search_by_category:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_search_by_month:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_search_by_payee:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_summary_by_category:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  'actual_transactions_summary_by_payee:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',
  // Moved here from CommonSchemas by #388: it is an optional filter, not a required lookup, and
  // under the strict schema a NAME got "Invalid uuid" with no way to learn the id.
  'actual_transactions_uncategorized:accountId': 'Category B: resolved by adapter.resolveFilterId (#388)',

  // NOT Actual entity UUIDs at all. An MCP session id is minted by this server and looks
  // like `stdio-2f72a857-...`; an imported_id comes from the BANK and its shape is the
  // aggregator's business, not ours. Typing either as a UUID would reject valid input.
  'actual_session_close:sessionId': 'an MCP session id minted by this server, not an Actual UUID',
  'actual_transactions_create:imported_id': "the bank's own identifier; shape is the aggregator's",
  'actual_transactions_import:txs.[].imported_id': "the bank's own identifier; shape is the aggregator's",
  'actual_transactions_update:fields.imported_id': "the bank's own identifier; shape is the aggregator's",

  // A nested value inside `fields`, alongside `account` and `category`, which are entity ids
  // too but are not id-SHAPED by name so this guard never sees them. Tightening one of the
  // three and not the others would be worse than tightening none. Decide the `fields.*`
  // group together, with Category B.
  'actual_transactions_update:fields.transfer_id': 'nested fields.* payload id; decide with Category B',
};

/** Strip comments so an id-shaped name inside prose is not read as a schema field. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Find id-shaped fields in the PUBLISHED schema that do not carry the UUID pattern.
 *
 * WHY THE PUBLISHED SCHEMA AND NOT THE SOURCE. The first version of this guard regexed
 * `src/tools/*.ts` for `^\s{2,4}(id|...Id):\s*(z\..*)$`, and it reported green while
 * `accounts_close.transferAccountId` and `transferCategoryId` sat on bounded strings three
 * lines below a UUID-typed `id`. The value group required `z.` on the field's own line, and
 * those declarations break after `z`. Four blind spots came from the same choice: a
 * multi-line declaration, deeper indentation, an aliased schema with no `z.` prefix, and any
 * PLURAL name (`mergeIds`, `*_ids`), which `[A-Za-z]+Id` cannot match at all.
 *
 * Walking `z.toJSONSchema(tool.inputSchema)` removes every one of those: it sees what
 * clients actually receive, at any nesting depth, however the schema was written. It is also
 * the right thing to assert, since the published contract is the thing this ticket is about.
 */
const UUID_RE_TEXT = UUID_PATTERN.source;
const ID_NAME = /(^id$|Ids?$|_ids?$)/;

/** Walk a JSON Schema, yielding every [path, propertyName, subschema]. */
function* walkProps(schema, path = []) {
  if (!schema || typeof schema !== 'object') return;
  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    yield [[...path, name].join('.'), name, sub];
    yield* walkProps(sub, [...path, name]);
  }
  if (schema.items) yield* walkProps(schema.items, [...path, '[]']);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    for (const sub of schema[key] ?? []) yield* walkProps(sub, path);
  }
}

/** Does this subschema (possibly wrapped in anyOf for nullable/optional) enforce the UUID? */
function enforcesUuid(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (typeof sub.pattern === 'string' && sub.pattern.includes(UUID_RE_TEXT)) return true;
  // allOf: every branch must hold, so ONE enforcing branch enforces the whole.
  if ((sub.allOf ?? []).some(enforcesUuid)) return true;
  // anyOf/oneOf: the value satisfies ONE branch, so the field is only enforced when EVERY
  // non-null branch enforces. `.some()` here was a laundering hole: `z.union([accountId,
  // z.string().min(1)])` accepts any non-empty string and reported enforced, which is the
  // cheapest way for a future change to reverse #380 while looking like an addition
  // ("accept an id or a name"). The null branch is dropped first so the nullable shape
  // `anyOf: [{pattern: UUID}, {type: 'null'}]` still passes.
  for (const key of ['anyOf', 'oneOf']) {
    const branches = (sub[key] ?? []).filter((b) => b?.type !== 'null');
    if (branches.length && branches.every(enforcesUuid)) return true;
  }
  return false;
}

/** Id-shaped STRING properties in a tool's published schema that do not enforce the UUID. */
function looseIdFields(published) {
  const out = [];
  for (const [path, name, sub] of walkProps(published)) {
    if (!ID_NAME.test(name)) continue;
    // A plural name is usually an ARRAY of ids, where the constraint lives on `items`.
    // `payees_merge.mergeIds` is the live example, and the previous source-regex detector
    // could not express this case at all.
    const target = sub?.type === 'array' && sub.items ? sub.items : sub;
    const isStringy =
      target?.type === 'string' || (target?.anyOf ?? target?.oneOf ?? []).some((x) => x?.type === 'string');
    if (!isStringy) continue;
    if (!enforcesUuid(target)) out.push({ field: path, decl: JSON.stringify(target).slice(0, 70) });
  }
  return out;
}

console.log('\n[tool-id-schema-drift]');

// The compiled tools, with their published JSON Schema. Keyed by TOOL NAME so exception
// keys read as `tool_name:field.path` rather than as a filename.
const exported = Object.values(toolsIndex).map((m) => (m && m.default) || m);
const tools = exported
  .filter((t) => t && typeof t.name === 'string' && t.inputSchema)
  .map((t) => ({ name: t.name, published: z.toJSONSchema(t.inputSchema) }));

// The OLD source-walking detector read readdirSync(src/tools), so a tool could not remove
// itself from the walk by changing shape. This one duck-types, so it can. A `>= 70` floor
// against 74 live tools would let FOUR tools vanish and still report "7 passed, 0 failed",
// which is the silent-skip class that already cost this repo #366 and #382. Assert equality
// and NAME the dropped exports, so a factory that renames `inputSchema` fails loudly here
// instead of quietly shipping a tool with unchecked ids.
check('every exported tool is actually walked (a silent skip is the failure mode here)', () => {
  const dropped = exported.filter((t) => !(t && typeof t.name === 'string' && t.inputSchema));
  assert.strictEqual(
    tools.length,
    exported.length,
    `exports with no usable inputSchema: ${dropped.map((t) => t?.name ?? '<anonymous>').join(', ')}`,
  );
  assert.ok(tools.length > 0, 'an empty set would pass every check below');
});

check('the UUID pattern was resolved (without it, nothing enforces anything)', () => {
  assert.ok(UUID_PATTERN && UUID_PATTERN.source.includes('[0-9a-f]{8}'), 'UUID_PATTERN did not load');
});

// IMPORTANT-3 (round 2): the rewrite to a published-schema walk silently RETIRED this
// check, and nothing replaced it. It guards a different property from everything else in
// this file: source-level duplication of the rule. `z.string().regex(UUID_PATTERN)` and
// `CommonSchemas.accountId` publish an IDENTICAL `pattern`, so the JSON Schema walk cannot
// tell them apart by construction. It has to be a source scan or it cannot exist at all.
check('no tool inlines UUID_PATTERN instead of using the shared schema', () => {
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  const inliners = files.filter((f) => /UUID_PATTERN/.test(strip(readFileSync(join(TOOLS_DIR, f), 'utf8'))));
  assert.strictEqual(
    inliners.length,
    0,
    `these tools express the UUID rule themselves instead of reusing CommonSchemas: ${inliners.join(', ')}. ` +
      'The same rule written twice is how a fifth tier of id validation appears.',
  );
});

// L5 (round 2): walkProps descends `properties`, `items` and the three combinators. It does
// NOT resolve `$ref`/`$defs`, nor descend `additionalProperties`/`patternProperties`/
// `prefixItems`. None are live today (verified: 0 of 74 published schemas emit any of them),
// but the failure mode if one appears is the bad one: a `$ref` node carries no `type`, so it
// is skipped SILENTLY rather than flagged. Assert the precondition instead of trusting it.
check('no published schema uses a node shape the walk cannot follow', () => {
  const unfollowable = [];
  for (const { name, published } of tools) {
    const seen = JSON.stringify(published);
    for (const key of ['$ref', '$defs', 'prefixItems', 'patternProperties']) {
      if (seen.includes(`"${key}"`)) unfollowable.push(`${name} (${key})`);
    }
  }
  assert.strictEqual(
    unfollowable.length,
    0,
    `walkProps cannot follow these and would skip their ids in silence: ${unfollowable.join(', ')}. ` +
      'Teach walkProps the shape before publishing it.',
  );
});

check('every id-shaped field enforces the UUID, or is a documented exception', () => {
  const offenders = [];
  for (const { name, published } of tools) {
    for (const { field, decl } of looseIdFields(published)) {
      const key = `${name}:${field}`;
      if (!(key in EXCEPTIONS)) offenders.push(`${key}  (${decl})`);
    }
  }
  assert.strictEqual(
    offenders.length,
    0,
    `id-shaped fields not enforcing the UUID pattern:\n      ${offenders.join('\n      ')}\n` +
      `      Use CommonSchemas.<entity>Id, or add an entry to EXCEPTIONS here WITH A REASON.`,
  );
});

check('every exception still matches something (a stale entry licenses a future field)', () => {
  const live = new Set();
  for (const { name, published } of tools) {
    for (const { field } of looseIdFields(published)) live.add(`${name}:${field}`);
  }
  const stale = Object.keys(EXCEPTIONS).filter((k) => !live.has(k));
  assert.strictEqual(stale.length, 0, `EXCEPTIONS entries matching nothing: ${stale.join(', ')}`);
});

// NEGATIVE fixtures: prove the detector fires, and that the CommonSchemas filter is the
// thing doing the work rather than an accident of the outer match.
check('NEGATIVE: a bare string id is detected', () => {
  const found = looseIdFields(z.toJSONSchema(z.object({ id: z.string() })));
  assert.deepStrictEqual(found.map((f) => f.field), ['id'], 'must flag an unpatterned id');
});

check('NEGATIVE: a UUID-patterned id is NOT detected', () => {
  const found = looseIdFields(z.toJSONSchema(z.object({ id: z.string().regex(UUID_PATTERN) })));
  assert.deepStrictEqual(found, [], 'must not flag a properly patterned id');
});

check('NEGATIVE: the detector sees NESTED and PLURAL ids, which the old regex could not', () => {
  const schema = z.object({
    updates: z.array(z.object({ id: z.string() })),
    mergeIds: z.array(z.string()),
  });
  const fields = looseIdFields(z.toJSONSchema(schema)).map((f) => f.field).sort();
  assert.deepStrictEqual(fields, ['mergeIds', 'updates.[].id'], `got ${JSON.stringify(fields)}`);
});

console.log(`\n[tool-id-schema-drift] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
