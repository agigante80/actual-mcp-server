// tests/unit/config_tool_surface.test.js
//
// #671: MCP_TOOL_SURFACE is legacy (default), compact or all, trimmed and case-insensitive.
// Unset or empty means legacy; anything else refuses startup with a message naming the
// variable. `compact` replaces the legacy list, so it cannot be combined with MCP_TOOLSETS
// or MCP_TOOLS (both select legacy names); `all` and `legacy` accept them.
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

for (const [raw, want] of [[undefined, 'legacy'], ['', 'legacy'], ['  ', 'legacy'], ['legacy', 'legacy'], ['compact', 'compact'], ['all', 'all'], [' Compact ', 'compact'], ['ALL', 'all']]) {
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

check('compact + MCP_TOOLSETS=chat: rejected, naming MCP_TOOLSETS', () => {
  const r = surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLSETS: 'chat' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.issues.some((i) => i.path.join('.') === 'MCP_TOOLSETS'), JSON.stringify(r.error.issues));
});

check('compact + MCP_TOOLS=x: rejected, naming MCP_TOOLS', () => {
  const r = surfaceOf({ MCP_TOOL_SURFACE: 'compact', MCP_TOOLS: 'actual_accounts_list' });
  assert.strictEqual(r.success, false);
  assert.ok(r.error.issues.some((i) => i.path.join('.') === 'MCP_TOOLS'), JSON.stringify(r.error.issues));
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
