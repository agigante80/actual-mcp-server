// tests/unit/tool_param_descriptions.test.js  (#639)
// Every input property a tool publishes in tools/list must carry a description, at any depth.
// A client's model sees only the published JSON Schema, so an undescribed field leaves it
// guessing the unit, format or meaning (cents or dollars, an id or a name, what a boolean
// turns on). Glama's Tool Definition Quality Score also grades "Parameter Semantics" from
// the same schema, nested objects included.
//
// The schema is built exactly as the server publishes it, z.toJSONSchema(tool.inputSchema),
// and walked through object `properties`, a record's `additionalProperties`, array `items`
// and `prefixItems`, union and intersection members (`anyOf`, `oneOf`, `allOf`) and local
// `$ref` (cycle-safe). A property counts as described when its node, or the node its `$ref`
// resolves to, has a non-empty `description`, or when it is a union whose branches all carry
// the same non-empty description.
//
// Zod 4 trap: `.describe()` must be the OUTERMOST call. `z.boolean().describe(...).nullable()`
// puts the description inside one anyOf branch, not on the property, and this guard flags it.
//
// Run: node tests/unit/tool_param_descriptions.test.js   (needs `npm run build` first)

process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

let failures = 0;
const pass = (l) => console.log(`  ✓ ${l}`);
const fail = (l, d = '') => { console.error(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const ok = (cond, l, d = '') => (cond ? pass(l) : fail(l, d));

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let cur = root;
  for (const part of ref.slice(2).split('/')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

const hasText = (d) => typeof d === 'string' && d.trim().length > 0;

function isDescribed(node, root) {
  if (!node || typeof node !== 'object') return false;
  if (hasText(node.description)) return true;
  if (typeof node.$ref === 'string') {
    const target = resolveRef(root, node.$ref);
    if (target && hasText(target.description)) return true;
  }
  for (const key of ['anyOf', 'oneOf']) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) {
      const first = branches[0]?.description;
      if (hasText(first) && branches.every((b) => b && b.description === first)) return true;
    }
  }
  return false;
}

const MAX_DEPTH = 64; // backstop for pathological nesting the $ref seen-set misses

// Collect the full path of every undescribed property. `seen` holds the $refs on the current
// descent only (copied per branch), so a cycle stops but a definition reused by two siblings
// is still checked under both.
function walk(node, path, root, out, seen, depth) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_DEPTH) return;
  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return;
    const target = resolveRef(root, node.$ref);
    if (target !== undefined) walk(target, path, root, out, new Set([...seen, node.$ref]), depth + 1);
    return;
  }
  if (node.properties && typeof node.properties === 'object') {
    for (const [key, sub] of Object.entries(node.properties)) {
      const p = `${path}.${key}`;
      if (!isDescribed(sub, root)) out.push(p);
      walk(sub, p, root, out, seen, depth + 1);
    }
  }
  const ap = node.additionalProperties;
  if (ap && typeof ap === 'object' && !Array.isArray(ap)) walk(ap, `${path}.additionalProperties`, root, out, seen, depth + 1);
  if (Array.isArray(node.prefixItems)) {
    node.prefixItems.forEach((sub, i) => walk(sub, `${path}.prefixItems[${i}]`, root, out, seen, depth + 1));
  }
  if (node.items && typeof node.items === 'object') walk(node.items, `${path}.items`, root, out, seen, depth + 1);
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(node[key])) node[key].forEach((sub, i) => walk(sub, `${path}.${key}[${i}]`, root, out, seen, depth + 1));
  }
}

function findUndescribed(name, schema) {
  const out = [];
  walk(schema, name, schema, out, new Set(), 0);
  return out;
}

(async () => {
  const { z } = await import('zod');

  // ── Fixture self-test: the walk must be able to fail, and only where it should ──
  console.log('\n[#639] fixture self-test');
  {
    const bad = z.object({
      top: z.string(),
      uni: z.union([z.string(), z.object({ inner: z.number() })]).describe('a union'),
      list: z.array(z.object({ el: z.boolean() })).describe('a list'),
    });
    const found = findUndescribed('f', z.toJSONSchema(bad)).sort();
    const want = ['f.list.items.el', 'f.top', 'f.uni.anyOf[1].inner'];
    ok(JSON.stringify(found) === JSON.stringify(want),
      'reports exactly the undescribed top-level, union-branch and array-item fields', JSON.stringify(found));

    const good = z.object({
      top: z.string().describe('t'),
      nul: z.boolean().nullable().optional().describe('outermost describe on a nullable'),
      uni: z.union([z.string(), z.object({ inner: z.number().describe('i') })]).describe('u'),
      list: z.array(z.object({ el: z.boolean().describe('e') })).describe('l'),
    });
    const none = findUndescribed('g', z.toJSONSchema(good));
    ok(none.length === 0, 'reports nothing on a fully described schema', JSON.stringify(none));

    const inner = z.object({ nul: z.boolean().describe('inner only').nullable() });
    const trap = findUndescribed('z', z.toJSONSchema(inner));
    ok(trap.includes('z.nul'), 'flags a describe() placed inside .nullable() (the Zod 4 trap)', JSON.stringify(trap));

    const shared = z.object({ d: z.string().describe('shared') });
    const viaRef = { type: 'object', properties: { a: { $ref: '#/$defs/S' }, b: { $ref: '#/$defs/S' } },
      $defs: { S: { description: 'S', ...z.toJSONSchema(shared) } } };
    ok(findUndescribed('r', viaRef).length === 0, 'a $ref whose target is described counts as described, reused twice');
    const cyc = { type: 'object', properties: { n: { $ref: '#/$defs/N' } },
      $defs: { N: { type: 'object', description: 'node', properties: { next: { $ref: '#/$defs/N' }, x: { type: 'string' } } } } };
    const cycFound = findUndescribed('c', cyc);
    ok(JSON.stringify(cycFound) === JSON.stringify(['c.n.x']), 'a cyclic $ref terminates and still reports its field', JSON.stringify(cycFound));
  }

  // ── The guard over the real registry ──
  console.log('\n[#639] every published input property carries a description');
  const mod = await import('../../dist/src/tools/index.js');
  const { getCanonicalCount } = await import('../../scripts/tool-count.mjs');
  const tools = Object.values(mod).filter((t) => t && t.name && t.inputSchema);
  const canonical = getCanonicalCount();
  ok(tools.length === canonical, `checked ${tools.length} tools, the canonical count is ${canonical}`);

  const undescribed = [];
  for (const tool of tools) {
    let published;
    try {
      published = z.toJSONSchema(tool.inputSchema);
    } catch (e) {
      fail(`${tool.name}: z.toJSONSchema threw`, e?.message ?? String(e));
      continue;
    }
    undescribed.push(...findUndescribed(tool.name, published));
  }
  ok(undescribed.length === 0, 'zero undescribed properties at any depth',
    undescribed.length ? `undescribed:\n    ${undescribed.join('\n    ')}` : '');

  // The guard catches a real field losing its description (not only synthetic fixtures).
  const txGet = tools.find((t) => t.name === 'actual_transactions_get');
  {
    const schema = z.toJSONSchema(txGet.inputSchema);
    delete schema.properties.startDate.description;
    const found = findUndescribed('actual_transactions_get', schema);
    ok(found.includes('actual_transactions_get.startDate'),
      'removing the startDate description is reported by its full path', JSON.stringify(found));
  }

  // ── Pins: #639 added descriptions only, no validation and no type change ──
  // The startDate pin records that #639 added no validation; it is not a wish to keep the gap.
  // A later ticket that adds a real YYYY-MM-DD check should replace this pin, not work around it.
  console.log('\n[#639] descriptions changed no validation');
  ok(txGet.inputSchema.safeParse({ startDate: '2026-13-01' }).success,
    'actual_transactions_get still accepts an unvalidated startDate string');
  {
    const r = txGet.inputSchema.safeParse({ accountId: 42 });
    ok(!r.success && r.error.issues.some((i) => i.path.join('.') === 'accountId'),
      'actual_transactions_get still rejects a numeric accountId at path accountId',
      r.success ? 'accepted' : JSON.stringify(r.error.issues));
  }

  console.log('');
  if (failures === 0) console.log('[#639] All parameter-description guards passed ✓');
  else { console.error(`[#639] ${failures} guard(s) FAILED`); process.exit(2); }
})().catch((e) => { console.error('[#639] harness crashed:', e); process.exit(2); });
