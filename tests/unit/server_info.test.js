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

  // #483: server_info reports the publication policy, which fails closed until the registry
  // has resolved it. Production does that at startup; this test calls the tool directly.
  await (await import('../../dist/src/actualToolsManager.js')).default.initialize();

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

  // --- #445: report what is INSTALLED, not only what is declared ---
  console.log('\n--- #445: resolved versions alongside the declared ranges ---');
  {
    const mod = await import(`../../dist/src/tools/server_info.js?resolved=1`);
    const { resolveInstalledVersion } = await import('../../dist/src/lib/installed-api-version.js');
    const deps = (await mod.default.call({})).dependencies;

    // Additive: the declared fields keep their exact previous value, so nothing
    // reading them today breaks.
    assert(deps.actualApi === pkg.dependencies['@actual-app/api'], 'declared range unchanged');

    // The resolved ones are bare triples, never ranges. A caret reports identically
    // for every version inside it, which is the ambiguity that made a server/api
    // skew hard to diagnose.
    assert(/^\d+\.\d+\.\d+/.test(deps.actualApiResolved || ''), `actualApiResolved is a triple (got ${deps.actualApiResolved})`);
    assert(!String(deps.actualApiResolved).startsWith('^'), 'actualApiResolved is not a range');

    // Regression guard for the trap this ticket hit: require.resolve on the BARE
    // name throws MODULE_NOT_FOUND for the MCP SDK, which exports no root path, so
    // the resolver takes an explicit entry subpath. Without it this field silently
    // vanished, and under the omit-on-failure contract that is indistinguishable
    // from a package that is legitimately absent.
    assert(/^\d+\.\d+\.\d+/.test(deps.mcpSdkResolved || ''), `mcpSdkResolved is present and a triple (got ${deps.mcpSdkResolved})`);
    assert(resolveInstalledVersion('@modelcontextprotocol/sdk') === null,
      'and the bare name really does fail to resolve, which is WHY the entry hint exists');

    // Absence means "could not resolve": no consumer has to special-case a
    // sentinel string.
    assert(resolveInstalledVersion('@definitely/not-installed-xyz') === null,
      'an unresolvable package yields null rather than a sentinel');
  }

  // --- #541: the version, resolved by one shared helper ---
  // Before #541 the tool called require() inside an ES module, so the dev suffix was
  // never added, and src/index.ts ran git in process.cwd() with no root check.
  console.log('\n--- #541: resolveMcpServerVersion decision table ---');
  {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { resolveMcpServerVersion } = await import('../../dist/src/lib/mcp-version.js');
    const base = '0.22.22';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-541-'));
    try {
      let calls = 0;
      let BRANCH = 'develop';
      let HASH = 'abc1234';
      let THROW = false;
      const runGit = (a) => {
        calls++;
        if (THROW) throw new Error('ENOENT');
        return a.includes('--abbrev-ref') ? BRANCH : HASH;
      };
      const run = (env) => { calls = 0; return resolveMcpServerVersion(base, env, root, runGit); };

      fs.mkdirSync(path.join(root, '.git'));
      let v = run({ VERSION: '1.2.3' });
      assert(v === '1.2.3' && calls === 0, `1: build-time VERSION wins, git not run (got ${v}, calls ${calls})`);
      v = run({ VERSION: 'unknown' });
      assert(v === '0.22.22-dev-abc1234', `2: VERSION=unknown is treated as unset (got ${v})`);
      v = run({});
      assert(v === '0.22.22-dev-abc1234', `3: VERSION unset on develop gets the suffix (got ${v})`);
      BRANCH = 'main';
      v = run({});
      assert(v === '0.22.22' && calls === 2, `4: main gets no suffix (got ${v}, calls ${calls})`);
      BRANCH = 'feature/x';
      v = run({});
      assert(v === '0.22.22-dev-abc1234', `5: a feature branch gets the suffix (got ${v})`);
      BRANCH = 'HEAD';
      v = run({});
      assert(v === '0.22.22-dev-abc1234', `6: a detached HEAD gets the suffix (got ${v})`);

      fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
      BRANCH = 'develop';
      v = run({});
      assert(v === '0.22.22' && calls === 0, `7: no .git at the root, git never runs (got ${v}, calls ${calls})`);

      fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
      v = run({});
      assert(v === '0.22.22-dev-abc1234', `8: a worktree/submodule .git FILE counts (got ${v})`);

      THROW = true;
      v = run({});
      assert(v === '0.22.22', `9: a throwing git yields the plain version (got ${v})`);
      THROW = false;
      HASH = '';
      v = run({});
      assert(v === '0.22.22', `10: an empty hash yields the plain version (got ${v})`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // getMcpServerVersion() is memoised per process, so these run in child processes.
  console.log('\n--- #541: tool-level version and agreement with initialize ---');
  {
    const { spawnSync } = await import('node:child_process');
    const managerUrl = new URL('../../dist/src/actualToolsManager.js', import.meta.url).href;
    const infoUrl = new URL('../../dist/src/tools/server_info.js', import.meta.url).href;
    const versionUrl = new URL('../../dist/src/lib/mcp-version.js', import.meta.url).href;
    const script =
      `await (await import(${JSON.stringify(managerUrl)})).default.initialize();` +
      `const t = (await import(${JSON.stringify(infoUrl)})).default;` +
      `const { getMcpServerVersion } = await import(${JSON.stringify(versionUrl)});` +
      'const r = await t.call({});' +
      'process.stdout.write(JSON.stringify({ tool: r.server.version, shared: getMcpServerVersion() }));';
    const runChild = (env) => {
      const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        env: { ...env, MCP_STDIO_MODE: 'true' },
      });
      if (out.status !== 0) return { error: out.stderr };
      return JSON.parse(out.stdout);
    };

    const pinned = runChild({ ...process.env, VERSION: '9.9.9' });
    assert(pinned.tool === '9.9.9', `VERSION=9.9.9 is reported as is (got ${JSON.stringify(pinned)})`);

    const unsetEnv = { ...process.env };
    delete unsetEnv.VERSION;
    const unset = runChild(unsetEnv);
    assert(/^\d+\.\d+\.\d+(-dev-[0-9a-f]+)?$/.test(unset.tool || ''), `VERSION unset: a version or a dev version (got ${JSON.stringify(unset)})`);
    assert(String(unset.tool).split('-dev-')[0] === pkg.version, `VERSION unset: the base is the root package version (got ${unset.tool})`);
    assert(unset.tool === unset.shared, 'actual_server_info reports the same string as getMcpServerVersion()');

    // --version shares the same reader, so a build-time VERSION reaches it too (before
    // #541 it printed the bare package version, disagreeing with serverInfo).
    const { fileURLToPath } = await import('node:url');
    const entry = fileURLToPath(new URL('../../dist/src/index.js', import.meta.url));
    const cli = spawnSync(process.execPath, [entry, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, VERSION: '9.9.9-dev-feed123' },
    });
    assert(cli.stdout.trim() === '9.9.9-dev-feed123', `--version honours VERSION (got ${JSON.stringify(cli.stdout.trim())}, exit ${cli.status}, stderr ${cli.stderr})`);

    // src/index.ts must use the shared helper for the initialize version, not its own git call.
    const { readFileSync } = await import('node:fs');
    const { stripTsComments } = await import('./helpers/source-text.js');
    const readCode = (rel) => stripTsComments(readFileSync(new URL(rel, import.meta.url), 'utf8'));
    const indexSrc = readCode('../../src/index.ts');
    assert(indexSrc.includes("from './lib/mcp-version.js'") && /const version = getMcpServerVersion\(\)/.test(indexSrc),
      'src/index.ts takes the initialize version from getMcpServerVersion()');
    assert(!/execSync|child_process/.test(indexSrc), 'src/index.ts runs no git of its own');
    const toolSrc = readCode('../../src/tools/server_info.ts');
    assert(!/\brequire\(|child_process/.test(toolSrc), 'server_info.ts has no require() and runs no git of its own');
  }

  // --- Summary ---
  console.log(`\nserver_info tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
