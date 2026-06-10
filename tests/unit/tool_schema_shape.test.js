// tests/unit/tool_schema_shape.test.js  (#223, deepened in #224)
// Guards against the CLASS of bug behind #217: a tool that publishes a SHAPELESS input
// schema property. The server advertises each tool to schema-driven MCP clients (Claude
// Code, Claude Desktop) via `z.toJSONSchema(tool.inputSchema)` (see src/index.ts and
// src/lib/ActualMCPConnection.ts). A node that serialises to an empty `{}` (no
// type/enum/$ref/anyOf/oneOf/allOf/const) gives those clients no shape to construct or
// send, so the tool is unusable from them even though the handler may work. #217 was
// exactly this: `txs: z.unknown()` published `"txs": {}`. This test fails the build (and
// names the offending `tool -> path`) if any such node reappears.
//
// Scope (#224 deepened the #223 shallow version): a recursive walk over the published
// schema descends into object `properties`, a record's `additionalProperties`, array
// `items`/`prefixItems`, union/intersection members (`anyOf`/`oneOf`/`allOf`), and through
// `$ref` (resolved against `$defs`, with a cycle guard). So it now catches a shapeless
// branch inside a union, a record of shapeless values, and a shapeless field inside a
// nested object, not just a bare top-level `z.unknown()`.
//
// Deliberate non-target (a legitimate OPEN object, not the #217 bug): a passthrough/loose
// object such as `z.looseObject({ shaped fields })` (the #217 fix itself) publishes
// `additionalProperties: {}` to mean "extra Actual fields are allowed". Its meaningful
// fields ARE shaped, and the extras are optional, so a client can construct it. The walk
// inspects `additionalProperties` ONLY for a pure map/record (an object with no named
// properties); when named shaped properties exist, the open catchall is left alone.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

// Documented allowlist for GENUINELY free-form fields a tool legitimately needs, keyed by
// the dotted path the walk produces. An entry skips that node AND its subtree, so it is
// pinned to the field (e.g. `...value`) rather than a fragile union index (e.g.
// `...value.anyOf[3]`). Add an entry only with a justification for why the field cannot
// carry a published shape. The entries below are Actual domain values that are polymorphic
// or open by design (verified against z.toJSONSchema): a rule action's `value` includes an
// object-valued branch (e.g. split actions) and its `options` is a free-form options bag
// (both `z.object({}).passthrough()` in src/tools/rules_*.ts), and a schedule's `date` is a
// date string OR an open `RecurConfig` object (src/tools/schedules_update.ts). These are
// documented for clients via `.describe()`; they are open, not unconstructible.
const ALLOWLIST = new Set([
  'actual_rules_create.actions.items.value',
  'actual_rules_create.actions.items.options',
  'actual_rules_create_or_update.actions.items.value',
  'actual_rules_create_or_update.actions.items.options',
  'actual_rules_update.fields.actions.items.value',
  'actual_rules_update.fields.actions.items.options',
  'actual_schedules_update.date',
]);

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const ok = (cond, l, d = '') => (cond ? pass(l) : fail(l, d));

// A JSON Schema node is "shapeless" if a client cannot tell what to send: it is missing,
// not an object, an empty `{}`, or carries none of the keys that convey a shape.
const SHAPE_KEYS = ['type', 'enum', '$ref', 'anyOf', 'oneOf', 'allOf', 'const'];
function isShapeless(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return true;
  if (Object.keys(node).length === 0) return true;
  return !SHAPE_KEYS.some((k) => node[k] !== undefined);
}

// Resolve a local JSON pointer ($ref like '#/$defs/Foo') against the root document.
function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let cur = root;
  for (const part of ref.slice(2).split('/')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

const MAX_DEPTH = 64; // backstop for any pathological nesting the $ref seen-set misses

// Recursively collect the shapeless nodes a client would be unable to construct, descending
// into every place a value still has to be built. `seen` tracks resolved $refs so a cyclic
// schema terminates. Paths are dotted (e.g. `tool.opts.raw`, `tool.uni.anyOf[1]`).
function walk(node, path, root, offenders, seen, depth) {
  if (ALLOWLIST.has(path)) return;          // documented free-form subtree, intentionally skipped
  if (depth > MAX_DEPTH) return;

  if (node && typeof node === 'object' && !Array.isArray(node) && typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return;        // cycle: already walking this definition
    seen.add(node.$ref);
    const target = resolveRef(root, node.$ref);
    if (target !== undefined) walk(target, path, root, offenders, seen, depth + 1);
    return;                                 // a $ref conveys shape via its target; nothing else on this node
  }

  if (isShapeless(node)) { offenders.push(path); return; }

  if (node.properties && typeof node.properties === 'object') {
    for (const [k, sub] of Object.entries(node.properties)) {
      walk(sub, `${path}.${k}`, root, offenders, seen, depth + 1);
    }
  }

  // additionalProperties: a pure map/record (no named properties) must publish shaped
  // VALUES; an open catchall on an object that has named shaped properties is a legitimate
  // passthrough (e.g. z.looseObject), so it is left alone (see the file header).
  const ap = node.additionalProperties;
  if (ap && typeof ap === 'object' && !Array.isArray(ap)) {
    const hasNamedProps = node.properties && Object.keys(node.properties).length > 0;
    if (!hasNamedProps) walk(ap, `${path}.additionalProperties`, root, offenders, seen, depth + 1);
  }

  if (node.type === 'array') {
    // A tuple publishes its element schemas under `prefixItems` and may omit `items`.
    const prefixItems = Array.isArray(node.prefixItems) ? node.prefixItems : [];
    if (prefixItems.length > 0) {
      prefixItems.forEach((sub, i) => walk(sub, `${path}.prefixItems[${i}]`, root, offenders, seen, depth + 1));
    } else if (node.items) {
      walk(node.items, `${path}.items`, root, offenders, seen, depth + 1);
    } else {
      offenders.push(`${path}.items`);      // array declaring neither items nor prefixItems
    }
  } else if (node.items && typeof node.items === 'object') {
    walk(node.items, `${path}.items`, root, offenders, seen, depth + 1);
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(node[key])) {
      node[key].forEach((sub, i) => walk(sub, `${path}.${key}[${i}]`, root, offenders, seen, depth + 1));
    }
  }
}

function findShapeless(toolName, published) {
  const offenders = [];
  walk(published, toolName, published, offenders, new Set(), 0);
  return offenders;
}

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const { z } = await import('zod');

  // ── Self-check: the deep walk must flag every shapeless form and none of the legitimate
  //    open/typed forms (proving it is neither vacuous nor over-eager) ──
  console.log('\n[#224] detector self-check (deep walk: flags shapeless, spares open/typed)');
  {
    const synthetic = z.object({
      good: z.string(),
      bad: z.unknown(),                              // {} -> flagged
      arrBad: z.array(z.unknown()),                  // { type:array, items:{} } -> .items flagged
      arrOk: z.array(z.string()),                    // typed items
      tupleOk: z.tuple([z.string(), z.number()]),    // prefixItems, no items: NOT flagged
      uni: z.union([z.string(), z.unknown()]),       // { anyOf:[{type},{}] } -> .anyOf[1] flagged (#224)
      rec: z.record(z.string(), z.unknown()),        // { type:object, additionalProperties:{} } -> flagged (#224)
      nested: z.object({ raw: z.unknown() }),        // { properties:{ raw:{} } } -> .raw flagged (#224)
      passthru: z.object({ a: z.string() }).passthrough(), // named props + open catchall: NOT flagged
    });
    const off = findShapeless('synthetic', z.toJSONSchema(synthetic));
    // flagged (the bug class, shallow + deep):
    ok(off.includes('synthetic.bad'), 'flags a bare z.unknown() property', JSON.stringify(off));
    ok(off.includes('synthetic.arrBad.items'), 'flags an array with z.unknown() items', JSON.stringify(off));
    ok(off.includes('synthetic.uni.anyOf[1]'), 'flags a shapeless branch inside a union (#224)', JSON.stringify(off));
    ok(off.includes('synthetic.rec.additionalProperties'), 'flags a record of shapeless values (#224)', JSON.stringify(off));
    ok(off.includes('synthetic.nested.raw'), 'flags a shapeless field inside a nested object (#224)', JSON.stringify(off));
    // NOT flagged (legitimately shaped or intentionally open):
    ok(!off.some((p) => p.startsWith('synthetic.good')), 'does not flag a typed string');
    ok(!off.includes('synthetic.arrOk.items') && !off.some((p) => p.startsWith('synthetic.arrOk.')),
      'does not flag a typed-array');
    ok(!off.some((p) => p.startsWith('synthetic.tupleOk')), 'does not flag a tuple (prefixItems present)');
    ok(!off.some((p) => p.startsWith('synthetic.passthru')),
      'does not flag a passthrough object (named props + open catchall is the #217 fix pattern)', JSON.stringify(off));
  }

  // ── Self-check: $ref handling resolves to the target and terminates on a cycle ──
  console.log('\n[#224] detector self-check ($ref resolution + cycle safety)');
  {
    const refToShapeless = {
      type: 'object',
      properties: { x: { $ref: '#/$defs/Empty' } },
      $defs: { Empty: {} },
    };
    ok(findShapeless('r', refToShapeless).includes('r.x'),
      'a $ref to a shapeless $def is flagged via its target');

    const cyclic = {
      type: 'object',
      properties: { self: { $ref: '#/$defs/Node' } },
      $defs: { Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
    };
    const off = findShapeless('c', cyclic);   // must return, not hang
    ok(Array.isArray(off) && off.length === 0, 'a $ref cycle terminates and is not flagged', JSON.stringify(off));
  }

  // ── The guard: every published tool schema must be fully shaped (modulo the allowlist) ──
  console.log('\n[#224] every tool publishes a fully-shaped input schema');
  const mod = await import('../../dist/src/tools/index.js');
  const tools = Object.values(mod).filter((t) => t && t.name && t.inputSchema);
  ok(tools.length > 0, `collected ${tools.length} tools with an inputSchema`);

  const offending = [];
  for (const tool of tools) {
    let published;
    try {
      published = z.toJSONSchema(tool.inputSchema); // the SAME call the server publishes with
    } catch (e) {
      fail(`${tool.name}: z.toJSONSchema threw`, e?.message ?? String(e));
      continue;
    }
    for (const p of findShapeless(tool.name, published)) offending.push(p);
  }
  ok(offending.length === 0,
    'no tool publishes a shapeless node (the #217 class), allowlist aside',
    offending.length ? `shapeless: ${offending.join(', ')}` : '');

  console.log('');
  if (failures === 0) console.log('[#224] All tool schema-shape guards passed ✓');
  else { console.error(`[#224] ${failures} guard(s) FAILED`); process.exit(2); }
})().catch((e) => { console.error('[#224] harness crashed:', e); process.exit(2); });
