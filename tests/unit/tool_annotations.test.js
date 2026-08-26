// tests/unit/tool_annotations.test.js
//
// #379: the annotations in src/lib/tool-annotations.ts must MATCH REALITY.
//
// The MCP spec is blunt that annotations are hints and that clients must treat them as
// untrusted. That cuts both ways: because nothing downstream can verify them, an annotation
// that lies is worse than none at all, and the only place it can be checked is here.
//
// The check is a call-graph derivation, not a restatement of the table: for each tool, find
// its `adapter.*` call sites, then ask whether those adapter methods reach
// `queueWriteOperation`. A tool claiming `readOnlyHint: true` whose adapter path writes is
// a lie, and this test fails naming it.
//
// WHY THE DERIVATION NEEDS EXCEPTIONS, and why they are listed rather than inferred. Four
// tools mutate something WITHOUT going through the write queue, so the call graph says
// "read" and reality says "write". They are excluded from READ_ONLY in the table and named
// here with the reason. Deriving the classification purely from the call graph would have
// annotated `actual_bank_sync` as read-only, which is exactly the lying annotation this
// test exists to prevent.
//
// Run: node tests/unit/tool_annotations.test.js

import assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

/**
 * Strip comments before any analysis. A docblock that MENTIONS `queueWriteOperation` in
 * prose would otherwise be read as a call: that exact false positive classified
 * `adapter.getNote` as a write while building this table, because `updateNote`'s docblock
 * sits between the two declarations.
 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Which adapter methods reach the write queue? */
function classifyAdapterMethods() {
  let src = stripComments(read('src/lib/actual-adapter.ts'));
  // Cut the default-export object: it lists every method name, and without this the LAST
  // function's slice swallows it and is misread as writing.
  // The default-export object lists EVERY method name, so without cutting it off the last
  // function's slice swallows it and is misread as writing. The first version of this looked
  // for `const adapter = {`, which does not exist (the file ends `export default {`), so the
  // cut silently never ran. Asserted, not assumed: a guard whose safety step is a no-op is
  // the kind of thing this file exists to catch.
  const cut = src.indexOf('\nexport default {');
  if (cut === -1) throw new Error('could not find the default-export block to cut; the classifier would misread the last function');
  src = src.slice(0, cut);

  const fns = [...src.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)];
  const writes = new Set();
  const reads = new Set();
  fns.forEach((m, i) => {
    const end = i + 1 < fns.length ? fns[i + 1].index : src.length;
    const body = src.slice(m.index, end);
    (/\b(queueWriteOperation|batchBudgetUpdates)\s*\(/.test(body) ? writes : reads).add(m[1]);
  });
  return { writes, reads };
}

/** The adapter methods a tool file calls. */
function adapterCallsOf(toolName) {
  const file = `src/tools/${toolName.replace(/^actual_/, '')}.ts`;
  if (!existsSync(join(ROOT, file))) return null;
  return [...new Set([...stripComments(read(file)).matchAll(/adapter\.(\w+)\s*\(/g)].map((m) => m[1]))];
}

/**
 * Tools that mutate WITHOUT the write queue. Each is excluded from READ_ONLY in the table;
 * this list is what stops the guard from demanding they be marked read-only.
 */
const NON_QUEUE_MUTATORS = {
  actual_bank_sync: 'runs through withActualApi (the read path) but IMPORTS transactions',
  actual_budgets_export: 'writes a zip into the server data directory',
  actual_budgets_switch: "changes the session's active budget and persists a preference",
  actual_session_close: 'closes a pooled connection: server state, not budget data',
};

console.log('\n[tool-annotations]');

const { writes, reads } = classifyAdapterMethods();
const toolsSrc = read('src/actualToolsManager.ts');
const names = [...toolsSrc.matchAll(/'(actual_[A-Za-z0-9_]+)'/g)]
  .map((m) => m[1])
  .filter((n, i, a) => a.indexOf(n) === i);

const { annotationsFor, _ANNOTATION_SETS } = await import('../../dist/src/lib/tool-annotations.js');

check('the derivation is real (guards against every check below passing over nothing)', () => {
  assert.ok(writes.size >= 20, `expected many write adapter methods, found ${writes.size}`);
  assert.ok(reads.size >= 10, `expected many read adapter methods, found ${reads.size}`);
  assert.ok(names.length >= 70, `expected ~74 tools, found ${names.length}`);
});

check('every tool declares all four annotation fields as booleans', () => {
  const bad = names.filter((n) => {
    const a = annotationsFor(n);
    return ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']
      .some((k) => typeof a[k] !== 'boolean');
  });
  assert.strictEqual(bad.length, 0, `incomplete annotations: ${bad.join(', ')}`);
});

check('THE ANTI-LYING CHECK: no readOnlyHint:true tool reaches the write queue', () => {
  const liars = names.filter((n) => {
    if (!annotationsFor(n).readOnlyHint) return false;
    const calls = adapterCallsOf(n);
    return calls !== null && calls.some((c) => writes.has(c));
  });
  assert.strictEqual(
    liars.length,
    0,
    `claim readOnlyHint:true but their adapter path queues a write: ${liars.join(', ')}`,
  );
});

check('the reverse: every readOnlyHint:false tool really does mutate', () => {
  const suspects = names.filter((n) => {
    if (annotationsFor(n).readOnlyHint) return false;
    if (n in NON_QUEUE_MUTATORS) return false;
    const calls = adapterCallsOf(n);
    return calls !== null && !calls.some((c) => writes.has(c));
  });
  assert.strictEqual(
    suspects.length,
    0,
    `declared as writing but no adapter call queues a write: ${suspects.join(', ')}.\n` +
      `      Either the annotation is wrong, or it mutates outside the write queue and needs\n` +
      `      an entry in NON_QUEUE_MUTATORS here explaining how.`,
  );
});

check('this server is a CLOSED world except for bank sync', () => {
  const open = names.filter((n) => annotationsFor(n).openWorldHint);
  assert.deepStrictEqual(
    open,
    ['actual_bank_sync'],
    'only bank sync reaches a third party (GoCardless / SimpleFIN); everything else is one Actual instance',
  );
});

check('THE COMPLETENESS CHECK: every tool is classified, so silence is impossible', () => {
  // Without this, a tool nobody classified fell through every set and published
  // `destructiveHint: false` plus `openWorldHint: false`, INVERTING the spec's conservative
  // defaults into positive safety claims about code nobody had looked at. Reproduced in
  // review by adding a plausible `actual_transactions_purge_all`: both guards stayed green.
  const { READ_ONLY, DESTRUCTIVE, ADDITIVE } = _ANNOTATION_SETS;
  const unclassified = names.filter(
    (n) => !READ_ONLY.has(n) && !DESTRUCTIVE.has(n) && !ADDITIVE.has(n),
  );
  assert.strictEqual(
    unclassified.length,
    0,
    `not classified in src/lib/tool-annotations.ts: ${unclassified.join(', ')}.\n` +
      `      Add each to READ_ONLY, DESTRUCTIVE or ADDITIVE. Leaving one out makes the server\n` +
      `      publish a safety claim about a tool nobody reviewed.`,
  );
});

check('a tool is in exactly ONE of the three classification sets', () => {
  const { READ_ONLY, DESTRUCTIVE, ADDITIVE } = _ANNOTATION_SETS;
  const overlapping = names.filter(
    (n) => [READ_ONLY, DESTRUCTIVE, ADDITIVE].filter((s2) => s2.has(n)).length > 1,
  );
  assert.strictEqual(overlapping.length, 0, `in more than one set: ${overlapping.join(', ')}`);
});

check('every *_delete tool is classified destructive', () => {
  // The converse of the old check, which asserted only that DESTRUCTIVE entries LOOK like
  // deletes. That was a naming tautology: it could not detect a MISSING entry, and it
  // rejected correct non-delete entries such as actual_transactions_update.
  const missing = names.filter((n) => /_delete$/.test(n) && !_ANNOTATION_SETS.DESTRUCTIVE.has(n));
  assert.strictEqual(missing.length, 0, `deletes not marked destructive: ${missing.join(', ')}`);
  // And the non-obvious members are present for reasons recorded at the set.
  for (const n of ['actual_accounts_close', 'actual_transactions_update', 'actual_payees_merge']) {
    assert.ok(_ANNOTATION_SETS.DESTRUCTIVE.has(n), `${n} must be marked destructive`);
  }
});

check('an unclassified tool publishes NO safety claim', () => {
  const a = annotationsFor('actual_definitely_not_a_real_tool');
  assert.strictEqual(a.readOnlyHint, false, 'must never default to read-only');
  assert.strictEqual(a.destructiveHint, undefined, 'must omit destructiveHint so the spec default (true) applies');
  assert.strictEqual(a.openWorldHint, undefined, 'must omit openWorldHint so the spec default (true) applies');
});

check('the classification sets name only real tools', () => {
  const known = new Set(names);
  const unknown = Object.values(_ANNOTATION_SETS)
    .flatMap((s) => [...s])
    .filter((n) => !known.has(n));
  assert.strictEqual(unknown.length, 0, `sets reference non-existent tools: ${unknown.join(', ')}`);
});

check('a tool whose OWN description claims upsert semantics is marked idempotent', () => {
  // Caught in review of this very change: `actual_tags_create` upserts on the tag word (its
  // description says so, and the E2E asserts the same id comes back), but the first draft
  // excluded every `*_create` from IDEMPOTENT as a rule. The guard cannot derive idempotence
  // from the call graph, so this reads the tool's own published claim instead: if a tool
  // TELLS clients it upserts, the annotation must agree with it.
  const liars = names.filter((n) => {
    const file = `src/tools/${n.replace(/^actual_/, '')}.ts`;
    if (!existsSync(join(ROOT, file))) return false;
    const desc = stripComments(read(file));
    const claimsUpsert = /\bupsert\b/i.test(desc);
    return claimsUpsert && !annotationsFor(n).idempotentHint;
  });
  assert.strictEqual(
    liars.length,
    0,
    `describe themselves as an upsert but are not marked idempotent: ${liars.join(', ')}`,
  );
});

// NEGATIVE fixtures: prove each comparator can fail, rather than passing over an empty set.
check('NEGATIVE: a read-only claim over a writing adapter path is detected', () => {
  const liars = ['actual_accounts_delete'].filter((n) => adapterCallsOf(n).some((c) => writes.has(c)));
  assert.deepStrictEqual(liars, ['actual_accounts_delete'], 'comparator must flag a writing tool');
});

check('NEGATIVE: the completeness comparator detects an unclassified name', () => {
  const { READ_ONLY, DESTRUCTIVE, ADDITIVE } = _ANNOTATION_SETS;
  const probe = ['actual_definitely_not_a_real_tool'].filter(
    (n) => !READ_ONLY.has(n) && !DESTRUCTIVE.has(n) && !ADDITIVE.has(n),
  );
  assert.deepStrictEqual(probe, ['actual_definitely_not_a_real_tool'], 'comparator must flag it');
});

console.log(`\n[tool-annotations] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
