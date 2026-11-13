// tests/unit/config_tool_surface.test.js
//
// #671, #680: MCP_TOOL_SURFACE is compact (default since #680), legacy or all, trimmed and
// case-insensitive. Unset or empty means compact; anything else refuses startup with a message
// naming the variable. Since #680 every surface accepts MCP_TOOLSETS and MCP_TOOLS: under
// `compact` they are remapped to compact tools (resolvePublishedToolNames, covered by
// compact_default_surface.test.js, which also owns the unknown-name startup failure).
// Tested through configSchema.safeParse so the module-level process.exit never runs.
//
// Run: node tests/unit/config_tool_surface.test.js   (needs `npm run build` first)

import assert from 'assert';

const { configSchema } = await import('../../dist/src/config.js');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const base = {
  ACTUAL_SERVER_URL: 'http://localhost:5006',
  ACTUAL_PASSWORD: 'pw',
  ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
};
const surfaceOf = (extra) => configSchema.safeParse({ ...base, ...extra });

console.log('\n[config-tool-surface]');

for (const [raw, want] of [[undefined, 'compact'], ['', 'compact'], ['  ', 'compact'], ['legacy', 'legacy'], ['compact', 'compact'], ['all', 'all'], [' Compact ', 'compact'], ['ALL', 'all']]) {
  check(`${JSON.stringify(raw)} parses to ${want}`, () => {
    const r = surfaceOf(raw === undefined ? {} : { MCP_TOOL_SURFACE: raw });
    assert.strictEqual(r.success, true, JSON.stringify(r.error?.issues));
    assert.strictEqual(r.data.MCP_TOOL_SURFACE, want);
  });
}

for (const bad of ['banana', 'compat', 'legacy,compact', 'true', '0']) {
  check(`(negative) ${JSON.stringify(bad)}: rejected, naming the variable and the valid values`, () => {
    const r = surfaceOf({ MCP_TOOL_SURFACE: bad });
    assert.strictEqual(r.success, false);
    const text = JSON.stringify(r.error.issues);
    assert.match(text, /MCP_TOOL_SURFACE/);
    assert.match(text, /legacy.*compact.*all/);
  });
}

check('compact + MCP_TOOLSETS=chat: accepted (#680 R1, toolsets are remapped, not refused)', () => {
  const r = surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLSETS: 'chat' });
  assert.strictEqual(r.success, true, JSON.stringify(r.error?.issues));
  assert.strictEqual(r.data.MCP_TOOLSETS, 'chat');
});

check('default (unset) + MCP_TOOLSETS=chat and compact MCP_TOOLS: accepted', () => {
  const r = surfaceOf({ MCP_TOOLSETS: 'chat', MCP_TOOLS: 'list_entities' });
  assert.strictEqual(r.success, true, JSON.stringify(r.error?.issues));
  assert.strictEqual(r.data.MCP_TOOL_SURFACE, 'compact');
});

check('(negative) the schema does not judge MCP_TOOLS names: a legacy name parses, the resolver refuses it at startup', () => {
  const r = surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLS: 'actual_accounts_list' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_TOOLS, 'actual_accounts_list');
});

check('compact + MCP_TOOLSETS=all (or empty) and no MCP_TOOLS: accepted', () => {
  assert.strictEqual(surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLSETS: 'all' }).success, true);
  assert.strictEqual(surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLSETS: '' }).success, true);
});

check('compact + MCP_READ_ONLY=true: accepted (read-only is surface independent)', () => {
  assert.strictEqual(surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_READ_ONLY: 'true' }).success, true);
});

for (const surface of ['legacy', 'all']) {
  check(`${surface} + MCP_TOOLSETS=chat and MCP_TOOLS: accepted`, () => {
    assert.strictEqual(surfaceOf({ MCP_TOOL_SURFACE: surface, MCP_TOOLSETS: 'chat', MCP_TOOLS: 'actual_accounts_list' }).success, true);
  });
}

console.log(`\n[config-tool-surface] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
