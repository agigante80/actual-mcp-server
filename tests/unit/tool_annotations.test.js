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
  const cut = src.indexOf('\nconst adapter = {');
  if (cut !== -1) src = src.slice(0, cut);

  const fns = [...src.matchAll(/^export async function (\w+)\s*\(/gm)];
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

check('destructive is claimed only where something is removed or replaced', () => {
  const d = [..._ANNOTATION_SETS.DESTRUCTIVE];
  const odd = d.filter((n) => !/_delete$|_merge$|_close$|_import$/.test(n));
  assert.strictEqual(odd.length, 0, `unexpected destructive entries: ${odd.join(', ')}`);
  // accounts_close belongs precisely because Actual REMOVES a zero-transaction account.
  assert.ok(d.includes('actual_accounts_close'), 'accounts_close can delete the account (#357)');
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

check('NEGATIVE: an unclassified tool would be caught by the completeness check', () => {
  const a = annotationsFor('actual_totally_made_up');
  // An unknown name falls through every set, so it reads as a destructive, non-idempotent
  // write: the conservative answer, and the completeness check above pins it to the real list.
  assert.strictEqual(a.readOnlyHint, false, 'an unknown tool must never default to read-only');
});

console.log(`\n[tool-annotations] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
