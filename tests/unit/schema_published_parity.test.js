// tests/unit/schema_published_parity.test.js
//
// #588: the published JSON Schema must accept exactly what the Zod schema accepts.
//
// WHY. `UUID_PATTERN` carried the `i` flag. Zod honoured it, so the server accepted
// `2E1F5BDB-209B-43F9-AF2C-3CE28E380C00`, the fixed uppercase id Actual gives every budget's
// default Income group. `z.toJSONSchema()` dropped the flag silently (a JSON Schema `pattern`
// cannot carry one), so every client that validates arguments against `inputSchema` refused
// the call before it reached the server. 51 published id fields had the defect; no guard saw it,
// because the two existing schema guards read the pattern TEXT and never compared what the two
// sides accept.
//
// Three checks, two of them class-level so the next flag or format cannot come back in another
// shape:
//   1. regression: every published UUID pattern accepts the Income group id (the ticket's case);
//   2. no regex check anywhere in a tool's Zod schema carries a flag (flags are the one thing
//      `z.toJSONSchema()` cannot express, so the source must not rely on them);
//   3. parity: every string leaf with a regex is run through BOTH the Zod schema and the MCP SDK's
//      own Ajv validator (the configuration real clients run) on a shared fixture set, and the two
//      verdicts must agree on every fixture. This is the check that tests what clients do.
//
// Run: node tests/unit/schema_published_parity.test.js

import assert from 'assert';
import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD ??= 'stub-password-for-unit-test';

const toolsIndex = await import('../../dist/src/tools/index.js');
const { UUID_PATTERN } = await import('../../dist/src/lib/constants.js');
const { TAG_COLOR_PATTERN } = await import('../../dist/src/lib/schemas/common.js');
const { DATE_PATTERN } = await import('../../dist/src/lib/constants.js');
const { isCalendarDay } = await import('../../dist/src/lib/dates.js');
const { getCanonicalCount } = await import('../../scripts/tool-count.mjs');

/** The fixed id of the default Income category group in Actual's bundled `default-db.sqlite`. */
const INCOME_GROUP_ID = '2E1F5BDB-209B-43F9-AF2C-3CE28E380C00';

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const tools = Object.entries(toolsIndex)
  .filter(([name, t]) => name !== 'default' && t && t.inputSchema && typeof t.inputSchema.safeParse === 'function')
  .map(([name, t]) => ({ name, schema: t.inputSchema }));

// ---------------------------------------------------------------------------------------------
// Zod walker. Yields [path, leafSchema, regexCheckDef] for every string leaf that has a regex
// check. Wrapper types are enumerated EXPLICITLY and an unknown container fails the walk, so a
// new Zod construct cannot hide a string from the parity check.
// ---------------------------------------------------------------------------------------------
const LEAF_TYPES = new Set(['string', 'number', 'int', 'boolean', 'enum', 'literal', 'null', 'undefined', 'any', 'unknown', 'never', 'date', 'bigint']);

function* regexLeaves(schema, path) {
  const def = schema?._zod?.def;
  if (!def) throw new Error(`${path}: not a Zod schema`);
  switch (def.type) {
    case 'object':
      for (const [k, v] of Object.entries(def.shape)) yield* regexLeaves(v, `${path}.${k}`);
      if (def.catchall) yield* regexLeaves(def.catchall, `${path}.*`);
      return;
    case 'array':
      yield* regexLeaves(def.element, `${path}[]`);
      return;
    case 'tuple':
      for (const [i, item] of def.items.entries()) yield* regexLeaves(item, `${path}[${i}]`);
      if (def.rest) yield* regexLeaves(def.rest, `${path}[rest]`);
      return;
    case 'record':
      yield* regexLeaves(def.keyType, `${path}{key}`);
      yield* regexLeaves(def.valueType, `${path}{value}`);
      return;
    case 'union':
      for (const [i, o] of def.options.entries()) yield* regexLeaves(o, `${path}|${i}`);
      return;
    case 'intersection':
      yield* regexLeaves(def.left, `${path}&L`);
      yield* regexLeaves(def.right, `${path}&R`);
      return;
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly': case 'nonoptional': case 'catch':
      yield* regexLeaves(def.innerType, path);
      return;
    case 'pipe':
      yield* regexLeaves(def.in, path);
      return;
    case 'lazy':
      yield* regexLeaves(def.getter(), path);
      return;
    case 'string': {
      for (const c of def.checks ?? []) {
        const cd = c?._zod?.def;
        if (cd && cd.check === 'string_format' && cd.format === 'regex') yield [path, schema, cd];
      }
      return;
    }
    default:
      if (LEAF_TYPES.has(def.type)) return;
      throw new Error(`${path}: unhandled Zod type "${def.type}"; extend regexLeaves() so the parity check still sees every string`);
  }
}

const leaves = [];
check('every registered tool is walked (a silent skip is the failure mode here)', () => {
  // Pinned to IMPLEMENTED_TOOLS, not a floor: a tool that stops exporting an inputSchema must
  // fail here rather than quietly leave the walk.
  const canonical = getCanonicalCount();
  assert.strictEqual(tools.length, canonical, `walked ${tools.length} tools, IMPLEMENTED_TOOLS has ${canonical}`);
  for (const { name, schema } of tools) for (const leaf of regexLeaves(schema, name)) leaves.push(leaf);
  assert.ok(leaves.length > 0, 'no regex leaf found at all');
});

/**
 * The id leaves. Two selectors, both kept on purpose: the shared rule by identity (so the check
 * follows UUID_PATTERN wherever it is used) AND any hex-class pattern by shape (so a hand-written
 * lowercase-only id regex, the exact #588 defect written locally, is still held to the Income id).
 */
// #699: the tag colour pattern is hex shaped but is a CSS colour, not an id. It is exempted by
// identity, so any OTHER hex-class pattern is still held to the Income id.
const isHexShaped = (re) => /a-f|A-F/.test(re.source) && re.source !== TAG_COLOR_PATTERN.source;
const uuidLeaves = leaves.filter(([, , cd]) => cd.pattern instanceof RegExp && (cd.pattern.source === UUID_PATTERN.source || isHexShaped(cd.pattern)));

// ---------------------------------------------------------------------------------------------
// 1. Regression: the Income group id passes every published UUID pattern.
// ---------------------------------------------------------------------------------------------
function collectPatterns(node, path, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((c, i) => collectPatterns(c, `${path}[${i}]`, out)); return; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'pattern' && typeof v === 'string') out.push({ path, pattern: v });
    else collectPatterns(v, `${path}.${k}`, out);
  }
}

check('every published UUID pattern accepts the uppercase Income group id (#588)', () => {
  const shared = uuidLeaves.filter(([, , cd]) => cd.pattern.source === UUID_PATTERN.source);
  assert.ok(shared.length > 0, 'no tool schema uses UUID_PATTERN; the id rule moved and this test must follow it');
  assert.ok(UUID_PATTERN.test(INCOME_GROUP_ID), 'the server-side rule itself must accept the Income group id');
  const offenders = [];
  for (const [path, leaf, cd] of uuidLeaves) {
    const out = [];
    collectPatterns(z.toJSONSchema(leaf, { io: 'input' }), path, out);
    // The published form of THIS check (a leaf may carry several regex checks, published as allOf).
    const published = out.find((o) => o.pattern === cd.pattern.source);
    assert.ok(published, `${path}: the regex check /${cd.pattern.source}/ was not published at all`);
    // A client only receives the pattern string: no flags, ever.
    if (!new RegExp(published.pattern).test(INCOME_GROUP_ID)) offenders.push(`${path}: ${published.pattern}`);
  }
  assert.strictEqual(offenders.length, 0, `published patterns rejecting ${INCOME_GROUP_ID}:\n      ${offenders.slice(0, 5).join('\n      ')}\n      (${offenders.length} of ${uuidLeaves.length})`);
});

// ---------------------------------------------------------------------------------------------
// 2. Class guard: no regex in any tool schema relies on a flag.
// ---------------------------------------------------------------------------------------------
check('no regex check in any tool schema carries a flag (z.toJSONSchema() cannot express one)', () => {
  const flagged = leaves.filter(([, , cd]) => cd.pattern instanceof RegExp && cd.pattern.flags !== '');
  assert.strictEqual(flagged.length, 0, `regex checks with flags:\n      ${flagged.map(([p, , cd]) => `${p}: /${cd.pattern.source}/${cd.pattern.flags}`).slice(0, 5).join('\n      ')}\n      (${flagged.length} total). Spell the rule out in the character class instead, or use .refine() so no pattern is published.`);
});

// ---------------------------------------------------------------------------------------------
// 3. Parity: Zod verdict == SDK Ajv verdict on every fixture, for every regex leaf.
// ---------------------------------------------------------------------------------------------
const FIXTURES = [
  INCOME_GROUP_ID,
  INCOME_GROUP_ID.toLowerCase(),
  '12345678-1234-1234-1234-123456789abc', // well-formed, not RFC-versioned (imported budgets carry these)
  '2E1F5BDB-209B-43F9-AF2C-3CE28E380C0',  // one nibble short
  'not-an-id',
  '2025-01-15',
  '2025-13-45',
  '2025-1-5',
  '2018-02-30',                           // #745: shape-valid, not a real day
  '2019-04-31',
  '2024-02-29',
  '2025-01',
  '2025-1',
  '',
  'Ünïcode näme',
  ` ${INCOME_GROUP_ID} `,                 // surrounding whitespace: a .trim() leaf would accept it, the published schema not
  '2E1F5BDB-209B-43F9-AF2C-3CE28E380G00', // mixed case with a non-hex letter
  'ABCDEFGH-1234-1234-1234-123456789ABC',
];

/**
 * #745: the one deliberate disagreement. A date leaf is calendar-checked by Zod, but a JSON Schema
 * pattern cannot express leap years, so the published pattern stays shape-only. The direction is
 * safe (a client sends a date the server then refuses with a clear message). The exemption is as
 * narrow as the rule: the leaf's regex check is DATE_PATTERN by identity, Zod refuses, the
 * published schema accepts, and the fixture really is not a calendar day. Zod accepting MORE than
 * the published schema (the #588 direction) is never exempt.
 */
const exemptDateDisagreement = (cd, zodOk, ajvOk, fixture) =>
  cd.pattern === DATE_PATTERN && zodOk === false && ajvOk === true && isCalendarDay(fixture) === false;

check('parity: Zod and the SDK Ajv validator agree on every fixture for every regex leaf', () => {
  const validator = new AjvJsonSchemaValidator();
  const disagreements = [];
  // Every leaf is compared, none deduped by its published JSON: two leaves can publish the same
  // schema and still differ on the Zod side (.trim(), .toLowerCase(), .refine()), and that
  // difference is exactly what this check exists to see.
  for (const [path, leaf, cd] of leaves) {
    const published = z.toJSONSchema(leaf, { io: 'input' });
    const validate = validator.getValidator(published);
    for (const v of FIXTURES) {
      const zodOk = leaf.safeParse(v).success;
      const ajvOk = validate(v).valid === true;
      if (zodOk !== ajvOk && !exemptDateDisagreement(cd, zodOk, ajvOk, v)) disagreements.push(`${path} on ${JSON.stringify(v)}: zod=${zodOk} ajv=${ajvOk}`);
    }
  }
  assert.strictEqual(disagreements.length, 0, `Zod and the published schema disagree:\n      ${disagreements.slice(0, 6).join('\n      ')}\n      (${disagreements.length} total)`);
});

check('the ticket\'s exact call passes both sides: actual_categories_create with the uppercase group_id', () => {
  const tool = toolsIndex.categories_create;
  const input = { group_id: INCOME_GROUP_ID, name: 'Test', is_income: true };
  assert.strictEqual(tool.inputSchema.safeParse(input).success, true, 'Zod must accept it');
  const validate = new AjvJsonSchemaValidator().getValidator(z.toJSONSchema(tool.inputSchema, { io: 'input' }));
  assert.strictEqual(validate(input).valid, true, `published schema must accept it: ${JSON.stringify(validate(input).errorMessage ?? '')}`);
});

check('the date exemption is reached: shared date leaves exist and the calendar fixtures hit it (#745)', () => {
  const dateLeaves = leaves.filter(([, , cd]) => cd.pattern === DATE_PATTERN);
  assert.ok(dateLeaves.length > 0, 'no leaf carries DATE_PATTERN by identity; the exemption can never apply and the date rule moved');
  const [, leaf, cd] = dateLeaves[0];
  const validate = new AjvJsonSchemaValidator().getValidator(z.toJSONSchema(leaf, { io: 'input' }));
  assert.strictEqual(leaf.safeParse('2018-02-30').success, false);
  assert.strictEqual(validate('2018-02-30').valid, true, 'the published pattern stays shape-only');
  assert.strictEqual(exemptDateDisagreement(cd, false, true, '2018-02-30'), true);
});

check('NEGATIVE: a date leaf where Zod accepts more than the published pattern is still a disagreement (#745)', () => {
  const [, , cd] = leaves.find(([, , c]) => c.pattern === DATE_PATTERN);
  // zod=true, ajv=false: the #588 direction.
  assert.strictEqual(exemptDateDisagreement(cd, true, false, '2018-02-30'), false);
  // A real calendar day on which the two disagree is not exempt either.
  assert.strictEqual(exemptDateDisagreement(cd, false, true, '2024-02-29'), false);
  // A different regex leaf is never exempt.
  assert.strictEqual(exemptDateDisagreement({ pattern: /^\d{4}-\d{2}-\d{2}$/ }, false, true, '2018-02-30'), false);
});

// NEGATIVE fixtures: prove each detector fires.
check('NEGATIVE: the walker finds a flagged regex behind optional/nullable/array/union wrappers', () => {
  const s = z.object({ a: z.array(z.string().regex(/^x$/i)).optional(), b: z.union([z.string().regex(/^y$/m), z.number()]).nullable() });
  const found = [...regexLeaves(s, 't')].map(([p, , cd]) => `${p}:${cd.pattern.flags}`).sort();
  assert.deepStrictEqual(found, ['t.a[]:i', 't.b|0:m']);
});

check('NEGATIVE: a .trim() leaf publishes the same schema as a plain one but disagrees on padded input', () => {
  const plain = z.string().regex(UUID_PATTERN);
  const trimmed = z.string().trim().regex(UUID_PATTERN);
  assert.deepStrictEqual(z.toJSONSchema(trimmed, { io: 'input' }), z.toJSONSchema(plain, { io: 'input' }), 'premise: identical published JSON');
  const padded = ` ${INCOME_GROUP_ID} `;
  const validate = new AjvJsonSchemaValidator().getValidator(z.toJSONSchema(trimmed, { io: 'input' }));
  assert.strictEqual(trimmed.safeParse(padded).success, true);
  assert.strictEqual(validate(padded).valid, false, 'a dedupe by published JSON would have hidden this leaf');
});

check('NEGATIVE: a hand-written lowercase-only id regex is selected by shape and rejects the Income id', () => {
  const local = z.object({ id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/) });
  const found = [...regexLeaves(local, 't')].filter(([, , cd]) => cd.pattern.source !== UUID_PATTERN.source && isHexShaped(cd.pattern));
  assert.strictEqual(found.length, 1, 'the shape selector must pick up an id rule that is not UUID_PATTERN');
  const out = [];
  collectPatterns(z.toJSONSchema(found[0][1], { io: 'input' }), 't.id', out);
  assert.strictEqual(new RegExp(out[0].pattern).test(INCOME_GROUP_ID), false, 'and the Income id must expose it');
});

check('NEGATIVE: a leaf with two regex checks publishes both and each is matched to its own check', () => {
  const leaf = z.string().regex(UUID_PATTERN).regex(/^2/);
  const found = [...regexLeaves(z.object({ id: leaf }), 't')];
  assert.strictEqual(found.length, 2);
  const out = [];
  collectPatterns(z.toJSONSchema(leaf, { io: 'input' }), 't.id', out);
  for (const [, , cd] of found) assert.ok(out.some((o) => o.pattern === cd.pattern.source), `check /${cd.pattern.source}/ published`);
});

check('NEGATIVE: parity detects a case-insensitive regex as a disagreement', () => {
  const leaf = z.string().regex(/^[a-f]+$/i);
  const validate = new AjvJsonSchemaValidator().getValidator(z.toJSONSchema(leaf));
  assert.strictEqual(leaf.safeParse('ABC').success, true);
  assert.strictEqual(validate('ABC').valid, false, 'the flagless published pattern must reject what Zod accepts, which is the defect class');
});

console.log(`\n[schema-published-parity] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
