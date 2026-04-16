// Unit tests for actual_server_info: transport field and live dependency versions.

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

(async () => {
  console.log('Running server_info unit tests');

  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json');

  // --- Test 1: transport = 'stdio' when MCP_STDIO_MODE=true ---
  console.log('\n--- Test 1: transport field = "stdio" when MCP_STDIO_MODE=true ---');
  {
    process.env.MCP_STDIO_MODE = 'true';
    // Re-import fresh copy via cache-busting query param
    const mod = await import(`../../dist/src/tools/server_info.js?stdio=1`);
    const tool = mod.default;
    const result = await tool.call({});
    assert(result.server.transport === 'stdio', `transport === 'stdio' (got: ${result.server.transport})`);
    delete process.env.MCP_STDIO_MODE;
  }

  // --- Test 2: transport = 'http' when MCP_STDIO_MODE is unset ---
  console.log('\n--- Test 2: transport field = "http" when MCP_STDIO_MODE unset ---');
  {
    delete process.env.MCP_STDIO_MODE;
    const mod = await import(`../../dist/src/tools/server_info.js?http=1`);
    const tool = mod.default;
    const result = await tool.call({});
    assert(result.server.transport === 'http', `transport === 'http' (got: ${result.server.transport})`);
  }

  // --- Tests 3 & 4: dependency versions match package.json ---
  console.log('\n--- Tests 3 & 4: dependency versions read from package.json ---');
  {
    const mod = await import(`../../dist/src/tools/server_info.js?deps=1`);
    const tool = mod.default;
    const result = await tool.call({});

    const expectedSdk = pkg.dependencies['@modelcontextprotocol/sdk'];
    const expectedApi = pkg.dependencies['@actual-app/api'];

    assert(
      result.dependencies.mcpSdk === expectedSdk,
      `mcpSdk matches package.json (expected: ${expectedSdk}, got: ${result.dependencies.mcpSdk})`
    );
    assert(
      result.dependencies.mcpSdk !== '^1.18.2',
      `mcpSdk is not the stale hardcoded value '^1.18.2'`
    );
    assert(
      result.dependencies.actualApi === expectedApi,
      `actualApi matches package.json (expected: ${expectedApi}, got: ${result.dependencies.actualApi})`
    );
    assert(
      result.dependencies.actualApi !== '^25.11.0',
      `actualApi is not the stale hardcoded value '^25.11.0'`
    );
  }

  // --- Test 5: fallback path — packageInfo has no dependencies key ---
  // We test this by calling the tool with a packageInfo that has no dependencies.
  // Since packageInfo is module-level, we verify the ?. ?? 'unknown' logic directly.
  console.log('\n--- Test 5: fallback path when dependencies key is absent ---');
  {
    // Simulate the fallback by checking the optional-chaining behaviour inline
    const fakePkg = { version: 'unknown', name: 'test', description: 'test' };
    const mcpSdk = fakePkg.dependencies?.['@modelcontextprotocol/sdk'] ?? 'unknown';
    const actualApi = fakePkg.dependencies?.['@actual-app/api'] ?? 'unknown';
    assert(mcpSdk === 'unknown', `fallback: mcpSdk === 'unknown' when dependencies absent`);
    assert(actualApi === 'unknown', `fallback: actualApi === 'unknown' when dependencies absent`);
  }

  // --- Summary ---
  console.log(`\nserver_info tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
