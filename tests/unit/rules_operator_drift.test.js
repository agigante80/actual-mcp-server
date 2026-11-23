// tests/unit/rules_operator_drift.test.js
// #711: the rule condition operator map (CONDITION_FIELD_OPERATORS in src/lib/schemas/rules.ts)
// must equal what the installed @actual-app/api accepts, except for the exceptions recorded
// below. Upstream keeps the tables as two object literals in dist/index.js, `var TYPE_INFO = {`
// and `var FIELD_INFO = {`, which are not exported. This test cuts each literal out by its
// anchor, evaluates it in a node:vm context (the literals only use `new Set`), and derives the
// expected map: each FIELD_INFO field gets its type's ops minus its disallowedOps.
//
// It FAILS, never skips, when an anchor is missing or a literal does not evaluate: a silent skip
// after an upstream refactor would let the map drift again, which is the bug #711 fixed.
//
// Run via: npm run test:unit-js
// Or: node tests/unit/rules_operator_drift.test.js   (needs `npm run build` first)

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

process.env.ACTUAL_SERVER_URL ??= 'http://127.0.0.1:5999';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';

let failures = 0;
const check = (cond, label, d = '') => {
  if (cond) console.log(`  ok: ${label}`);
  else { console.error(`  FAIL: ${label}${d ? ' (' + d + ')' : ''}`); failures++; }
};
const fatal = (message) => { console.error(`  FAIL: ${message}`); process.exit(1); };

// The deliberate differences from upstream. Each one is written here, with its reason, so a
// change to it is a visible edit to this table and not a quiet edit to the map.
const EXCEPTIONS = {
  // #766: `transfer` and `parent` are upstream condition fields, but only for FILTER queries
  // (conditionsToAQL maps them to transfer_id and is_parent). A RULE is evaluated against the
  // object prepareTransactionForRules builds, which never sets either field, and Condition.eval
  // returns false for an undefined value under every operator. A rule on them is stored and never
  // fires, so the map omits them and RULE_NEVER_MATCHING_FIELDS refuses them. The check below
  // fails if that function ever starts to assign one, so this omission is then revisited.
  neverMatchingFields: ['transfer', 'parent'],
  // The type `saved` has no operators upstream, so no condition on it can be valid.
  omittedFields: ['saved', 'transfer', 'parent'],
  // Upstream accepts the text operators on the id fields, but a RULE never matches them:
  // Condition.eval compares the raw id, and only the filter path (conditionsToAQL) maps them to
  // a name. A rule "payee contains amazon" would be saved and never fire.
  refusedOps: {
    payee: ['contains', 'matches', 'doesNotContain'],
    account: ['contains', 'matches', 'doesNotContain'],
    category: ['contains', 'matches', 'doesNotContain'],
    category_group: ['contains', 'matches', 'doesNotContain'],
  },
  // Upstream's internal operator (shared/rules.ts internalOps); never offered to a caller.
  internalOps: ['and'],
};

/** Cut the object literal that starts at `var <name> = {` out of `src`, by balanced braces. */
function extractLiteral(src, name) {
  const anchor = `var ${name} = {`;
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`anchor "${anchor}" not found`);
  const start = at + anchor.length - 1;
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`literal "${name}" has no closing brace`);
}

function evaluateLiteral(src, name) {
  const text = extractLiteral(src, name);
  const value = vm.runInNewContext(`(${text})`, { Set }, { timeout: 1000 });
  if (!value || typeof value !== 'object') throw new Error(`literal "${name}" did not evaluate to an object`);
  return value;
}

/** The map upstream implies, minus the exceptions. Pure. */
function expectedMap(typeInfo, fieldInfo, exceptions) {
  const out = {};
  for (const [field, info] of Object.entries(fieldInfo)) {
    if (exceptions.omittedFields.includes(field)) continue;
    const type = typeInfo[info.type];
    if (!type || !Array.isArray(type.ops)) throw new Error(`FIELD_INFO.${field} has type "${info.type}", which TYPE_INFO does not define`);
    const disallowed = info.disallowedOps instanceof Set ? info.disallowedOps : new Set(info.disallowedOps ?? []);
    const refused = new Set([...(exceptions.refusedOps[field] ?? []), ...exceptions.internalOps]);
    out[field] = { type: info.type, operators: type.ops.filter((op) => !disallowed.has(op) && !refused.has(op)) };
  }
  return out;
}

/** Every difference between the expected and the local map, both directions. Pure. */
function diffMaps(expected, local) {
  const problems = [];
  for (const [field, info] of Object.entries(expected)) {
    const mine = local[field];
    if (!mine) { problems.push(`upstream field "${field}" is missing from the local map`); continue; }
    if (mine.type !== info.type) problems.push(`field "${field}": local type "${mine.type}", upstream "${info.type}"`);
    for (const op of info.operators) if (!mine.operators.includes(op)) problems.push(`field "${field}": upstream operator "${op}" is missing from the local map`);
    for (const op of mine.operators) if (!info.operators.includes(op)) problems.push(`field "${field}": local operator "${op}" is not accepted upstream`);
    if (new Set(mine.operators).size !== mine.operators.length) problems.push(`field "${field}": the local map repeats an operator`);
  }
  for (const field of Object.keys(local)) {
    if (!Object.hasOwn(expected, field)) problems.push(`local field "${field}" is not an upstream field (or is a recorded omission)`);
  }
  return problems;
}

const require = createRequire(import.meta.url);
let distPath;
try {
  distPath = require.resolve('@actual-app/api');
} catch (err) {
  fatal(`cannot resolve @actual-app/api: ${err.message}`);
}
const src = readFileSync(distPath, 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../node_modules/@actual-app/api/package.json', import.meta.url), 'utf8'));

let typeInfo;
let fieldInfo;
try {
  typeInfo = evaluateLiteral(src, 'TYPE_INFO');
  fieldInfo = evaluateLiteral(src, 'FIELD_INFO');
} catch (err) {
  fatal(`could not read upstream's rule tables from ${distPath} (@actual-app/api ${pkg.version}): ${err.message}. ` +
    'Find where TYPE_INFO and FIELD_INFO moved and update this test; do NOT make it skip.');
}

const { CONDITION_FIELD_OPERATORS } = await import('../../dist/src/lib/schemas/rules.js');

console.log(`\n[#711] the local operator map equals upstream (@actual-app/api ${pkg.version}) with the recorded exceptions`);
{
  check(Object.keys(fieldInfo).length > 0 && Object.keys(typeInfo).length > 0, 'both upstream tables evaluated to non-empty objects');
  check(CONDITION_FIELD_OPERATORS && typeof CONDITION_FIELD_OPERATORS === 'object', 'CONDITION_FIELD_OPERATORS is exported from dist/src/lib/schemas/rules.js');
  const problems = diffMaps(expectedMap(typeInfo, fieldInfo, EXCEPTIONS), CONDITION_FIELD_OPERATORS ?? {});
  check(problems.length === 0, 'no drift in either direction', problems.join('; '));
  for (const field of EXCEPTIONS.omittedFields) {
    check(Object.hasOwn(fieldInfo, field), `recorded omission "${field}" is still an upstream field (else drop the exception)`);
    if (EXCEPTIONS.neverMatchingFields.includes(field)) continue; // checked against the rule engine below
    // The omission is only right while the field's type takes no operator. If upstream gives it
    // one, conditions on it become valid and this must fail, not stay hidden by the exception.
    const ops = typeInfo[fieldInfo[field]?.type]?.ops;
    check(Array.isArray(ops) && ops.length === 0, `recorded omission "${field}" still has no operators upstream (else add it to the map)`, String(ops));
  }
  for (const [field, ops] of Object.entries(EXCEPTIONS.refusedOps)) {
    const info = fieldInfo[field];
    const upstreamOps = info ? typeInfo[info.type].ops.filter((op) => !(info.disallowedOps?.has?.(op))) : [];
    check(ops.every((op) => upstreamOps.includes(op)), `recorded refusal on "${field}" is still accepted upstream (else drop the exception)`, ops.join(', '));
  }
}

/** The body of `async function prepareTransactionForRules`, cut out by balanced braces. */
function prepareBody(text) {
  const anchor = 'function prepareTransactionForRules(';
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`anchor "${anchor}" not found`);
  const open = text.indexOf('{', text.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error('prepareTransactionForRules has no closing brace');
}
/** The never-matching fields the body assigns (r.<f> =, r["<f>"] =, or an object key). Pure. */
function assignedNeverMatching(body, fields) {
  return fields.filter((f) => new RegExp(`\\b\\w+(?:\\.${f}|\\[["']${f}["']\\])\\s*(?:=|\\?\\?=|\\|\\|=)(?!=)|[{,]\\s*["']?${f}["']?\\s*:`).test(body));
}

console.log('\n[#766] upstream still never sets transfer or parent on the transaction a rule is evaluated against');
{
  let body = '';
  try { body = prepareBody(src); } catch (err) { fatal(`${err.message}. Find where prepareTransactionForRules moved and update this test; do NOT make it skip.`); }
  check(body.includes('payee_name') && body.includes('_account_name'), 'the cut body is the rule-preparation function (sets payee_name and _account_name)');
  const assigned = assignedNeverMatching(body, EXCEPTIONS.neverMatchingFields);
  check(assigned.length === 0, 'it assigns neither transfer nor parent (else revisit RULE_NEVER_MATCHING_FIELDS)', assigned.join(', '));
  // The check must be able to fail: a copy of the body that assigns one is reported.
  check(assignedNeverMatching(body.replace('return r;', 'r.transfer = false;\n\treturn r;'), EXCEPTIONS.neverMatchingFields).join() === 'transfer',
    'NEGATIVE: a body that assigns r.transfer is reported');
  check(assignedNeverMatching(body.replace('return r;', 'r["parent"] ??= false;\n\treturn r;'), EXCEPTIONS.neverMatchingFields).join() === 'parent',
    'NEGATIVE: a body that assigns r["parent"] is reported');
  check(assignedNeverMatching('const r = { ...trans, transfer: false };', EXCEPTIONS.neverMatchingFields).join() === 'transfer',
    'NEGATIVE: an object literal key is reported');
}

console.log('\n[#711] the drift check itself can fail (fixtures)');
{
  const expected = expectedMap(typeInfo, fieldInfo, EXCEPTIONS);
  // The fixtures mutate a copy of the real map; without one there is nothing to mutate.
  if (!CONDITION_FIELD_OPERATORS) fatal('CONDITION_FIELD_OPERATORS is not exported, so the fixtures cannot run');
  const clone = (m) => JSON.parse(JSON.stringify(m));

  const fewer = clone(CONDITION_FIELD_OPERATORS);
  fewer.amount.operators = fewer.amount.operators.filter((op) => op !== 'isbetween');
  const p1 = diffMaps(expected, fewer);
  check(p1.some((p) => p.includes('"isbetween" is missing')), 'NEGATIVE: a local map missing one operator is reported', p1.join('; '));

  const extraUpstream = { ...fieldInfo, new_field: { type: 'string' } };
  const p2 = diffMaps(expectedMap(typeInfo, extraUpstream, EXCEPTIONS), CONDITION_FIELD_OPERATORS);
  check(p2.some((p) => p.includes('upstream field "new_field" is missing')), 'NEGATIVE: an upstream field the local map lacks is reported', p2.join('; '));

  const extraLocal = clone(CONDITION_FIELD_OPERATORS);
  extraLocal.description = { type: 'string', operators: ['is'] };
  extraLocal.notes.operators.push('gte');
  const p3 = diffMaps(expected, extraLocal);
  check(p3.some((p) => p.includes('local field "description"')) && p3.some((p) => p.includes('local operator "gte"')),
    'NEGATIVE: a local field or operator upstream lacks is reported', p3.join('; '));

  let threw = '';
  try { extractLiteral('var OTHER = {};', 'TYPE_INFO'); } catch (err) { threw = err.message; }
  check(threw.includes('anchor "var TYPE_INFO = {" not found'), 'NEGATIVE: a missing anchor throws (the test then fails, never skips)', threw);
}

if (failures > 0) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll rules operator drift checks passed');
process.exit(0);
