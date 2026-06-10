// tests/unit/tool_schema_shape.test.js  (#223)
// Guards against the CLASS of bug behind #217: a tool that publishes a SHAPELESS input
// schema property. The server advertises each tool to schema-driven MCP clients (Claude
// Code, Claude Desktop) via `z.toJSONSchema(tool.inputSchema)` (see src/index.ts and
// src/lib/ActualMCPConnection.ts). A property that serialises to an empty `{}` (no
// type/enum/$ref/anyOf/oneOf/allOf/const), or an array whose `items` are absent or empty,
// gives those clients no shape to construct or send, so the tool is unusable from them
// even though the handler may work. #217 was exactly this: `txs: z.unknown()` published
// `"txs": {}`. This test fails the build (and names `tool -> property`) if any such
// property reappears.
//
// Scope: shallow-but-useful (the #223 gate scoped it deliberately). It checks every
// top-level property and one level into the `items` of array properties, which catches the
// common form: a bare `z.unknown()` property or `z.array(z.unknown())`. It does NOT yet
// recurse into these deeper shapeless forms (tracked as a follow-up, see #224):
//   - a `{}` branch inside a union, e.g. z.union([z.string(), z.unknown()]) -> anyOf:[...,{}]
//   - the values of a record, e.g. z.record(z.string(), z.unknown()) -> additionalProperties:{}
//   - a shapeless field inside a nested object, e.g. z.object({ raw: z.unknown() })
// None of those exist in the current tool set; the guard passes today.

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

// Documented allowlist for any GENUINELY free-form field a tool legitimately needs. Keyed
// as `toolName.propertyName` (or `toolName.propertyName.items`). Empty today: there is no
// intentional free-form field in the tool set, so the guard is precise rather than a
// blanket ban on `z.unknown()`. Add an entry only with a comment justifying why the field
// cannot have a published shape.
const ALLOWLIST = new Set([
  // e.g. 'actual_some_tool.freeformPayload',
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

// Collect the shapeless offenders in one published schema. Returns an array of
// `property`/`property.items` paths that a client could not construct.
function findShapeless(toolName, published) {
  const offenders = [];
  const props = (published && published.properties) || {};
  for (const [propName, prop] of Object.entries(props)) {
    if (ALLOWLIST.has(`${toolName}.${propName}`)) continue;
    if (isShapeless(prop)) { offenders.push(propName); continue; }
    if (prop.type === 'array' && !ALLOWLIST.has(`${toolName}.${propName}.items`)) {
      // A tuple publishes its element schemas under `prefixItems` and may omit `items`
      // (z.toJSONSchema does this for z.tuple()). That is fully shaped, so do not flag a
      // missing/empty `items` when shaped `prefixItems` are present.
      const hasPrefixItems = Array.isArray(prop.prefixItems) && prop.prefixItems.length > 0;
      if (!hasPrefixItems && isShapeless(prop.items)) offenders.push(`${propName}.items`);
    }
  }
  return offenders;
}

(async () => {
  await import('../../dist/src/lib/node-polyfills.js');
  const { z } = await import('zod');

  // ── Self-check: the detector must catch a synthetic shapeless schema (not vacuous) ──
  console.log('\n[#223] detector self-check (must flag synthetic shapeless properties)');
  {
    const synthetic = z.object({
      good: z.string(),
      bad: z.unknown(),                          // publishes {}
      arrBad: z.array(z.unknown()),              // publishes { type: array, items: {} }
      arrOk: z.array(z.string()),                // typed items, must NOT be flagged
      tupleOk: z.tuple([z.string(), z.number()]), // publishes prefixItems, no items: must NOT be flagged
    });
    const offenders = findShapeless('synthetic_tool', z.toJSONSchema(synthetic));
    ok(offenders.includes('bad'), 'flags a z.unknown() property as shapeless', JSON.stringify(offenders));
    ok(offenders.includes('arrBad.items'), 'flags an array with z.unknown() items', JSON.stringify(offenders));
    ok(!offenders.includes('good') && !offenders.includes('arrOk') && !offenders.includes('arrOk.items'),
      'does NOT flag typed string / typed-array properties', JSON.stringify(offenders));
    ok(!offenders.includes('tupleOk') && !offenders.includes('tupleOk.items'),
      'does NOT flag a tuple (prefixItems present, items absent)', JSON.stringify(offenders));
  }

  // ── The guard: every published tool schema must be fully shaped ──
  console.log('\n[#223] every tool publishes a fully-shaped input schema');
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
    for (const prop of findShapeless(tool.name, published)) {
      offending.push(`${tool.name} -> ${prop}`);
    }
  }
  ok(offending.length === 0,
    'no tool publishes a shapeless property (the #217 class)',
    offending.length ? `shapeless: ${offending.join(', ')}` : '');

  console.log('');
  if (failures === 0) console.log('[#223] All tool schema-shape guards passed ✓');
  else { console.error(`[#223] ${failures} guard(s) FAILED`); process.exit(2); }
})().catch((e) => { console.error('[#223] harness crashed:', e); process.exit(2); });
