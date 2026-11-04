// tests/unit/startup_record.test.js
//
// #623: the pure sys_startup builder (src/lib/startupRecord.ts). Every input is injected, so
// these cases need no server and no Actual. They pin:
//   - the allowlist: the record's keys are exactly STARTUP_RECORD_KEYS, minus the HTTP-only and
//     OIDC-only keys on the transports and auth modes that do not have them;
//   - privacy: no secret, hostname, bind address, budget name, principal name or URL path;
//   - the auth facts (mode, sharedBearerAccepted, issuerOrigin, staticPrincipals);
//   - bindScope, the paths booleans and the logging fields;
//   - parity with actual_server_info: both read collectVersionAndToolFacts.
//
// Run: node tests/unit/startup_record.test.js   (needs `npm run build` first)

import assert from 'assert';

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://127.0.0.1:5999';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

const {
  buildStartupRecord, collectVersionAndToolFacts,
  STARTUP_RECORD_KEYS, STARTUP_RECORD_HTTP_ONLY_KEYS, STARTUP_RECORD_OIDC_ONLY_KEYS,
} = await import('../../dist/src/lib/startupRecord.js');
const { parseBudgetRegistry, summarizeBudgetRegistry } = await import('../../dist/src/lib/budget-registry.js');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[startup-record]');

const SECRET = 'S3cretTokenValue0123456789abcdef0123456789';
const BUDGETS = summarizeBudgetRegistry(parseBudgetRegistry(
  { BUDGET_DEFAULT_NAME: 'PrivateHousehold', BUDGET_1_NAME: 'SideBusiness', BUDGET_1_SYNC_ID: '11111111-1111-4111-8111-111111111111', BUDGET_1_SERVER_URL: 'https://user:pw@actual.example.org/base' },
  { serverUrl: 'http://192.168.9.9:5006', password: SECRET, syncId: '00000000-0000-4000-8000-000000000000' },
));

const TOOLS = { published: 40, registered: 85, policy: { toolsets: ['chat'], readOnly: true } };

const httpTransport = (bindHost = '127.0.0.1', advertisedUrl = 'http://127.0.0.1:3655/http') => ({
  kind: 'http', bindHost, path: '/http', advertisedUrl,
  listener: { port: 3655, scheme: 'http', keepAliveMs: 65000 },
});

function inputs(over = {}) {
  return {
    env: {},
    logConfig: { useJson: true, level: 'info' },
    budgets: BUDGETS,
    tools: TOOLS,
    posture: 'serve',
    actualApiVerbose: false,
    limits: { opTimeoutMs: 30000, maxSessions: 15, idleTimeoutMs: 300000 },
    runtime: { container: false, timezone: 'Europe/Madrid', utcOffsetMinutes: 60 },
    transport: httpTransport(),
    ...over,
  };
}

/** Every key in the record as `group.key`, plus `event`. */
function keysOf(record) {
  const out = [];
  for (const [group, value] of Object.entries(record)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of Object.keys(value)) out.push(`${group}.${k}`);
    } else {
      out.push(group);
    }
  }
  return out.sort();
}

function expectedKeys({ http, oidc }) {
  const all = Object.entries(STARTUP_RECORD_KEYS).flatMap(([g, ks]) => (ks.length ? ks.map((k) => `${g}.${k}`) : [g]));
  return all
    .filter((k) => http || !STARTUP_RECORD_HTTP_ONLY_KEYS.includes(k))
    .filter((k) => oidc || !STARTUP_RECORD_OIDC_ONLY_KEYS.includes(k))
    .sort();
}

// ---------------------------------------------------------------- allowlist

await check('HTTP, non-OIDC: keys are exactly the allowlist minus the OIDC-only keys', () => {
  assert.deepStrictEqual(keysOf(buildStartupRecord(inputs())), expectedKeys({ http: true, oidc: false }));
});

await check('stdio: keys are exactly the allowlist minus the HTTP-only and OIDC-only keys', () => {
  const r = buildStartupRecord(inputs({ transport: { kind: 'stdio' }, posture: 'n/a' }));
  assert.deepStrictEqual(keysOf(r), expectedKeys({ http: false, oidc: false }));
  assert.deepStrictEqual(r.transport, { kind: 'stdio' });
  assert.strictEqual(r.auth.posture, 'n/a');
});

await check('HTTP under OIDC: issuerOrigin is the one extra key', () => {
  const r = buildStartupRecord(inputs({ env: { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://id.example.org/realms/x?client=y' } }));
  assert.deepStrictEqual(keysOf(r), expectedKeys({ http: true, oidc: true }));
});

await check('event is sys_startup', () => {
  assert.strictEqual(buildStartupRecord(inputs()).event, 'sys_startup');
});

// ---------------------------------------------------------------- privacy

await check('no secret, budget name, principal name, path or userinfo appears anywhere', () => {
  const env = {
    MCP_SSE_AUTHORIZATION: SECRET,
    MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['PrivateHousehold'] } }),
    MCP_TOKEN_ALICE: 'AliceTokenValue0123456789abcdef0123456789',
    MCP_BRIDGE_LOG_DIR: '/srv/private-logs',
    MCP_BRIDGE_DATA_DIR: '/srv/private-data',
    ACTUAL_PASSWORD: SECRET,
  };
  const text = JSON.stringify(buildStartupRecord(inputs({
    env, transport: httpTransport('10.1.2.3', 'https://ops:pw@mcp.example.org:8443/http?x=1'),
  })));
  for (const needle of [SECRET, 'AliceTokenValue', 'alice', 'PrivateHousehold', 'SideBusiness', 'private-logs',
    'private-data', '10.1.2.3', '192.168.9.9', 'actual.example.org', 'ops:', 'pw@', '?x=1']) {
    assert.ok(!text.includes(needle), `record contains ${needle}: ${text}`);
  }
});

await check('advertisedOrigin is an origin: no userinfo, path or query', () => {
  const r = buildStartupRecord(inputs({ transport: httpTransport('0.0.0.0', 'https://ops:pw@mcp.example.org:8443/http?x=1') }));
  assert.strictEqual(r.transport.advertisedOrigin, 'https://mcp.example.org:8443');
});

await check('budgets arrive as counts and schemes only', () => {
  const r = buildStartupRecord(inputs());
  assert.deepStrictEqual(r.budgets, { count: 2, distinctServers: 2, schemes: BUDGETS.schemes });
  assert.deepStrictEqual([...r.budgets.schemes].sort(), ['http', 'https']);
});

// ---------------------------------------------------------------- auth

await check('OIDC: mode oidc, issuer as origin, bearer not accepted, 0 static principals', () => {
  const r = buildStartupRecord(inputs({ env: {
    AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'https://u:p@id.example.org/realms/x', MCP_SSE_AUTHORIZATION: SECRET,
    MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['b'] } }),
  } }));
  assert.strictEqual(r.auth.mode, 'oidc');
  assert.strictEqual(r.auth.issuerOrigin, 'https://id.example.org');
  assert.strictEqual(r.auth.sharedBearerAccepted, false);
  assert.strictEqual(r.auth.staticPrincipals, 0);
});

await check('OIDC with an invalid issuer logs the sentinel, never the raw value', () => {
  const r = buildStartupRecord(inputs({ env: { AUTH_PROVIDER: 'oidc', OIDC_ISSUER: 'not a url with secret-bits' } }));
  assert.strictEqual(r.auth.issuerOrigin, '<invalid url>');
  assert.ok(!JSON.stringify(r).includes('secret-bits'));
});

await check('static tokens plus a bearer: mode static, bearer accepted, principals counted', () => {
  const r = buildStartupRecord(inputs({ env: {
    MCP_SSE_AUTHORIZATION: SECRET,
    MCP_STATIC_TOKENS: JSON.stringify({
      alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['b'] },
      bob: { tokenEnv: 'MCP_TOKEN_BOB', budgets: ['b'] },
    }),
  } }));
  assert.strictEqual(r.auth.mode, 'static');
  assert.strictEqual(r.auth.sharedBearerAccepted, true);
  assert.strictEqual(r.auth.staticPrincipals, 2);
});

await check('a malformed MCP_STATIC_TOKENS counts 0 instead of throwing', () => {
  const r = buildStartupRecord(inputs({ env: { MCP_STATIC_TOKENS: '{not json' } }));
  assert.strictEqual(r.auth.staticPrincipals, 0);
});

await check('bearer only: mode bearer; nothing: mode none', () => {
  assert.strictEqual(buildStartupRecord(inputs({ env: { MCP_SSE_AUTHORIZATION: SECRET } })).auth.mode, 'bearer');
  const none = buildStartupRecord(inputs({ posture: 'serve-open-warn' }));
  assert.strictEqual(none.auth.mode, 'none');
  assert.strictEqual(none.auth.sharedBearerAccepted, false);
  assert.strictEqual(none.auth.posture, 'serve-open-warn');
});

// ---------------------------------------------------------------- transport, paths, logging

await check('bindScope: loopback, all-interfaces and specific', () => {
  const scope = (h) => buildStartupRecord(inputs({ transport: httpTransport(h) })).transport.bindScope;
  assert.strictEqual(scope('127.0.0.1'), 'loopback');
  assert.strictEqual(scope('::1'), 'loopback');
  assert.strictEqual(scope('0.0.0.0'), 'all-interfaces');
  assert.strictEqual(scope('::'), 'all-interfaces');
  assert.strictEqual(scope('10.1.2.3'), 'specific');
});

await check('HTTP listener facts come from the listener, keepAliveMs under limits', () => {
  const r = buildStartupRecord(inputs());
  assert.strictEqual(r.transport.port, 3655);
  assert.strictEqual(r.transport.scheme, 'http');
  assert.strictEqual(r.transport.path, '/http');
  assert.deepStrictEqual(r.limits, { opTimeoutMs: 30000, maxSessions: 15, idleTimeoutMs: 300000, keepAliveMs: 65000 });
});

await check('paths are booleans: custom only when the variable is set', () => {
  assert.deepStrictEqual(buildStartupRecord(inputs()).paths, { logDirCustom: false, dataDirCustom: false });
  const r = buildStartupRecord(inputs({ env: { MCP_BRIDGE_LOG_DIR: '/x', MCP_BRIDGE_DATA_DIR: '/y' } }));
  assert.deepStrictEqual(r.paths, { logDirCustom: true, dataDirCustom: true });
});

await check('logging: format, level and the file sink rule', () => {
  const pretty = buildStartupRecord(inputs({ logConfig: { useJson: false, level: 'debug' }, env: { MCP_BRIDGE_STORE_LOGS: 'true' } }));
  assert.deepStrictEqual(pretty.logging, { level: 'debug', format: 'pretty', fileSink: true });
  assert.strictEqual(buildStartupRecord(inputs({ env: { MCP_BRIDGE_STORE_LOGS: 'yes' } })).logging.fileSink, false);
});

await check('runtime: nodeEnv null when unset, injected container and timezone kept', () => {
  const r = buildStartupRecord(inputs({ runtime: { container: true, timezone: 'UTC', utcOffsetMinutes: 0 } }));
  assert.strictEqual(r.runtime.nodeEnv, null);
  assert.strictEqual(r.runtime.container, true);
  assert.strictEqual(r.runtime.timezone, 'UTC');
  assert.strictEqual(r.runtime.platform, process.platform);
  assert.strictEqual(buildStartupRecord(inputs({ env: { NODE_ENV: 'production' } })).runtime.nodeEnv, 'production');
});

// ---------------------------------------------------------------- tools and parity

await check('tools: published total, registered, readOnly and a copy of toolsets', () => {
  const r = buildStartupRecord(inputs());
  assert.deepStrictEqual(r.tools, { total: 40, registered: 85, readOnly: true, toolsets: ['chat'] });
  r.tools.toolsets.push('mutated');
  assert.deepStrictEqual(TOOLS.policy.toolsets, ['chat'], 'the builder must not share the policy array');
});

await check('parity: the record and actual_server_info report the same versions and counts', async () => {
  const manager = (await import('../../dist/src/actualToolsManager.js')).default;
  await manager.initialize();
  const info = await (await import('../../dist/src/tools/server_info.js')).default.call({});
  const facts = collectVersionAndToolFacts({
    published: manager.getPublishedToolNames().length,
    registered: manager.getRegisteredToolCount(),
    policy: manager.getToolPolicy(),
  });
  const r = buildStartupRecord(inputs({ tools: {
    published: manager.getPublishedToolNames().length,
    registered: manager.getRegisteredToolCount(),
    policy: manager.getToolPolicy(),
  } }));
  assert.deepStrictEqual(r.versions, facts.versions);
  assert.strictEqual(info.tools.total, r.tools.total, 'published count differs from actual_server_info');
  assert.strictEqual(info.tools.registered, r.tools.registered, 'registered count differs from actual_server_info');
  assert.strictEqual(info.server.version, r.versions.server);
  assert.strictEqual(info.runtime.node, r.versions.node);
  assert.strictEqual(info.dependencies.mcpSdkResolved, r.versions.mcpSdk ?? undefined);
  assert.strictEqual(info.dependencies.actualApiResolved, r.versions.actualApi ?? undefined);
  assert.ok(r.versions.actualApi, 'the installed @actual-app/api version resolves');
  assert.ok(r.versions.mcpSdk, 'the installed MCP SDK version resolves');
});

console.log(`\n[startup-record] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
