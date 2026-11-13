/**
 * Systemic regression guard (#293): every tool's PUBLISHED JSON Schema must be
 * regex-compatible with strict MCP clients (OpenAI's Responses function-schema
 * validator in particular).
 *
 * The bug in #293 was that `actual_budgets_switch` used a Zod
 * `.regex(/^[\p{L}\p{N} ._\-]+$/u, ...)`. When serialized via z.toJSONSchema()
 * that becomes a JSON Schema `pattern` string of "^[\p{L}\p{N} ._\-]+$". That
 * pattern depends on the `u` flag (which a JSON Schema `pattern` cannot carry),
 * and OpenAI rejects `\p{...}` escapes ("... is not a 'regex'"), which disabled
 * the ENTIRE tool surface because a client forwards every tool in one request.
 *
 * This walks the same 71 published inputSchemas the server advertises over both
 * transports (both `src/index.ts` and `src/lib/ActualMCPConnection.ts` publish
 * via z.toJSONSchema()) and asserts, for every `pattern` at any depth:
 *   1. it contains no u-flag-only escape that a non-u regex silently misreads
 *      instead of throwing: Unicode-property escapes (`\p{...}` / `\P{...}`) and
 *      Unicode code-point escapes (`\u{...}`), and
 *   2. it compiles via `new RegExp(pattern)` WITHOUT the `u` flag.
 *
 * Check (2) alone is not enough: `new RegExp("^[\\p{L}]$")` and
 * `new RegExp("\\u{1F600}")` both compile without throwing when the `u` flag is
 * absent (the escapes are silently reinterpreted), so check (1) names the
 * u-flag-only constructs explicitly. This is a low-false-positive guard for the
 * known incompatible classes, not a full re-implementation of OpenAI's regex
 * subset validator.
 *
 * Reintroducing a u-flag-dependent pattern into any tool schema fails here,
 * before it can reach a client.
 *
 * Run via: npm run test:unit-js   (included in the chain)
 */

// Stub required env vars so the tool modules import without a .env
process.env.ACTUAL_SERVER_URL     = process.env.ACTUAL_SERVER_URL     ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD       = process.env.ACTUAL_PASSWORD       ?? 'stub-password-for-unit-test';

console.log('Running published-schema OpenAI/ECMA-262 compatibility guard (#293)');

(async () => {
  const { z } = await import('zod');
  const toolsIndex = await import('../../dist/src/tools/index.js');

  let failures = 0;
  let toolsChecked = 0;
  let patternsChecked = 0;

  // Collect every `pattern` string anywhere in a JSON Schema object.
  function collectPatterns(node, path, out) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => collectPatterns(child, `${path}[${i}]`, out));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pattern' && typeof value === 'string') {
        out.push({ path: `${path}.pattern`, pattern: value });
      }
      collectPatterns(value, `${path}.${key}`, out);
    }
  }

  const toolNames = Object.keys(toolsIndex).filter((n) => n !== 'default');

  // #676: the compact tools publish their own input schemas, so they are a second source.
  const { COMPACT_TOOLS } = await import('../../dist/src/compact/registry.js');
  const { buildCompactTool } = await import('../../dist/src/compact/dispatch.js');
  const compactBuilt = COMPACT_TOOLS.map((spec) => buildCompactTool(spec, { callOperation: async () => undefined }));
  const sources = [
    ...toolNames.map((name) => [name, toolsIndex[name]]),
    ...compactBuilt.map((tool) => [tool.name, tool]),
  ];

  for (const [name, tool] of sources) {
    if (!tool || !tool.inputSchema) continue;
    toolsChecked++;

    let published;
    try {
      published = z.toJSONSchema(tool.inputSchema);
    } catch (e) {
      console.error(`  FAIL [${name}]: z.toJSONSchema() threw: ${e.message}`);
      failures++;
      continue;
    }

    const patterns = [];
    collectPatterns(published, name, patterns);

    for (const { path, pattern } of patterns) {
      patternsChecked++;

      // (1) No u-flag-only escapes (\p{...}/\P{...} or \u{...}). These need the
      //     u flag a JSON Schema pattern cannot carry, and a non-u regex silently
      //     misreads them rather than throwing, so (2) alone would not catch them.
      if (/\\[pP]\{|\\u\{/.test(pattern)) {
        console.error(`  FAIL [${path}]: pattern uses a u-flag-only escape (\\p{...}/\\P{...}/\\u{...}), which OpenAI rejects: ${JSON.stringify(pattern)}`);
        failures++;
        continue;
      }

      // (2) Must compile as a plain (non-`u`) ECMA-262 regex, the way a client
      // that only receives the pattern string (no flags) would read it.
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern);
      } catch (e) {
        console.error(`  FAIL [${path}]: pattern is not a valid non-u regex: ${JSON.stringify(pattern)} (${e.message})`);
        failures++;
        continue;
      }

      console.log(`  ✓ ${path}: ${JSON.stringify(pattern)}`);
    }
  }

  // #642: the published OUTPUT schemas go to clients in the same tools/list, so the same rules
  // apply. Walk them the same way, with a fixture proving the walk can fail on one.
  let outputsChecked = 0;
  const outputProblems = (schema, label) => {
    const found = [];
    const pats = [];
    collectPatterns(schema, label, pats);
    for (const { path, pattern } of pats) {
      if (/\\[pP]\{|\\u\{/.test(pattern)) found.push(`${path} uses a u-flag-only escape`);
      else { try { new RegExp(pattern); } catch { found.push(`${path} is not a valid non-u regex`); } }
    }
    return found;
  };
  for (const name of toolNames) {
    const tool = toolsIndex[name];
    if (!tool || !tool.outputSchema) continue;
    outputsChecked++;
    for (const p of outputProblems(z.toJSONSchema(tool.outputSchema, { io: 'output' }), `${name}.outputSchema`)) {
      console.error(`  FAIL [${p}]`);
      failures++;
    }
  }
  if (outputsChecked === 0) {
    console.error('  FAIL: no tool outputSchemas were checked. The output walk would pass vacuously.');
    failures++;
  }
  const badOutput = z.toJSONSchema(z.object({ n: z.string().regex(/^[\p{L}]+$/u) }).loose(), { io: 'output' });
  if (outputProblems(badOutput, 'fixture').length !== 1) {
    console.error('  FAIL: the output-schema walk did not flag a u-flag-only pattern fixture.');
    failures++;
  }
  console.log(`Checked ${outputsChecked} output schema(s).`);

  console.log(`\nChecked ${toolsChecked} tool schema(s), ${patternsChecked} pattern(s).`);

  // Self-check: the guard must actually be exercising tools. If the index
  // stopped exporting tools (or none carry a schema), fail loudly rather than
  // pass vacuously.
  if (toolsChecked === 0) {
    console.error('  FAIL: no tool inputSchemas were checked (index empty?). Guard would pass vacuously.');
    failures++;
  }
  if (compactBuilt.length === 0) {
    console.error('  FAIL: no compact tool inputSchemas were checked (#676). The compact half would pass vacuously.');
    failures++;
  }
  console.log(`Checked ${compactBuilt.length} compact tool schema(s).`);

  if (failures > 0) {
    console.error(`\n❌ ${failures} published-schema compatibility failure(s).`);
    process.exit(1);
  }
  console.log('\n✅ All published tool schemas are OpenAI/ECMA-262 compatible.');
})().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
