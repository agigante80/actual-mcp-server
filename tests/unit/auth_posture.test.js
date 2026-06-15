// #242: HTTP auth required-by-default. Exhaustive unit coverage of the pure
// predicate (isLoopbackHost, evaluateHttpAuthPosture) and the strict-boolean
// config coercion for the MCP_ALLOW_UNAUTHENTICATED opt-out, without booting a
// server. Imports from dist/, so `npm run build` must run first (the pipeline does).
import assert from 'assert';

const { isLoopbackHost, evaluateHttpAuthPosture } = await import('../../dist/src/lib/authPosture.js');
const { configSchema } = await import('../../dist/src/config.js');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

console.log('[auth-posture] isLoopbackHost');
for (const h of [
  '127.0.0.1', '127.0.0.2', '127.1.2.3', // whole 127.0.0.0/8 block is loopback
  '::1', '0:0:0:0:0:0:0:1', // IPv6 loopback, compressed and longhand
  'localhost', 'LOCALHOST', ' 127.0.0.1 ',
  '::ffff:127.0.0.1', // IPv4-mapped IPv6 loopback
]) {
  check(`loopback: ${JSON.stringify(h)}`, () => assert.strictEqual(isLoopbackHost(h), true));
}
for (const h of ['0.0.0.0', '::', '192.168.1.50', '10.0.0.4', '203.0.113.7', '128.0.0.1', '127.0.0.1.evil.com', '', undefined]) {
  check(`exposed: ${JSON.stringify(h)}`, () => assert.strictEqual(isLoopbackHost(h), false));
}

console.log('\n[auth-posture] evaluateHttpAuthPosture');

check('non-loopback + no auth + no opt-out -> refuse', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'refuse');
});
check('specific LAN IP + no auth + no opt-out -> refuse', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '192.168.1.50', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'refuse');
});
check('undefined bind + no auth + no opt-out -> refuse (fail-safe)', () => {
  const r = evaluateHttpAuthPosture({ bindHost: undefined, hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'refuse');
});
check('non-loopback + no auth + opt-out -> serve-open-warn', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: true });
  assert.strictEqual(r.decision, 'serve-open-warn');
});
check('loopback + no auth -> serve', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '127.0.0.1', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'serve');
});
check('static token set (exposed bind) -> serve', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: true, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'serve');
});
check('oidc enabled (exposed bind) -> serve', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: true, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'serve');
});
check('opt-out does NOT downgrade a configured-auth serve (stays plain serve)', () => {
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: true, oidcEnabled: false, allowUnauthenticated: true });
  assert.strictEqual(r.decision, 'serve');
});

console.log('\n[auth-posture] MCP_ALLOW_UNAUTHENTICATED coercion boundary (config schema)');
// Mirror tests/unit/config_insecure_upstream.test.js: only the exact 'true' enables.
const base = { ACTUAL_SERVER_URL: 'https://actual:5006', ACTUAL_BUDGET_SYNC_ID: 'sync-1' };
for (const v of ['yes', '1', 'TRUE', 'True', '', 'false']) {
  check(`MCP_ALLOW_UNAUTHENTICATED=${JSON.stringify(v)} parses to false`, () => {
    const r = configSchema.safeParse({ ...base, MCP_ALLOW_UNAUTHENTICATED: v });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.data.MCP_ALLOW_UNAUTHENTICATED, false);
  });
}
check('MCP_ALLOW_UNAUTHENTICATED unset parses to false', () => {
  const r = configSchema.safeParse({ ...base });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_ALLOW_UNAUTHENTICATED, false);
});
check("MCP_ALLOW_UNAUTHENTICATED='true' parses to true", () => {
  const r = configSchema.safeParse({ ...base, MCP_ALLOW_UNAUTHENTICATED: 'true' });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.data.MCP_ALLOW_UNAUTHENTICATED, true);
});
check("a 'yes' opt-out still leaves an exposed no-auth bind at refuse", () => {
  const parsed = configSchema.safeParse({ ...base, MCP_ALLOW_UNAUTHENTICATED: 'yes' }).data;
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: parsed.MCP_ALLOW_UNAUTHENTICATED });
  assert.strictEqual(r.decision, 'refuse');
});

console.log(`\n[auth-posture] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
