// #242: HTTP auth required-by-default. Exhaustive unit coverage of the pure
// predicate (isLoopbackHost, evaluateHttpAuthPosture) and the strict-boolean
// config coercion for the MCP_ALLOW_UNAUTHENTICATED opt-out, without booting a
// server. Imports from dist/, so `npm run build` must run first (the pipeline does).
import assert from 'assert';

const { isLoopbackHost, evaluateHttpAuthPosture, enforceHttpAuthPosture, findWeakTokenVars } = await import('../../dist/src/lib/authPosture.js');
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
check('#572 MCP_STATIC_TOKENS alone (exposed bind) -> serve', () => {
  // index.ts folds MCP_STATIC_TOKENS into hasStaticToken; auth_posture_wiring spawns it.
  const r = evaluateHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: true, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(r.decision, 'serve');
});
check('#572 no auth (exposed bind): the refusal names MCP_STATIC_TOKENS as a remedy', () => {
  const errors = [];
  let code = null;
  try {
    enforceHttpAuthPosture({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false },
      { error: (m) => errors.push(m), warn: () => {} }, (c) => { code = c; throw new Error('__exit__'); });
  } catch (e) { if (e.message !== '__exit__') throw e; }
  assert.strictEqual(code, 1);
  assert.strictEqual(errors.length, 1);
  assert.ok(/MCP_STATIC_TOKENS/.test(errors[0]), errors[0]);
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

console.log('\n[auth-posture] #611 weak tokens');
const STRONG = 'a'.repeat(32);
const PLACEHOLDER = 'replace-with-openssl-rand-hex-32';
// Runs the real decision chain for one env: findWeakTokenVars then enforce, with
// exit stubbed. Mirrors the index.ts inputs.
function runWeak(env, bindHost) {
  const oidcEnabled = env.AUTH_PROVIDER === 'oidc';
  const errors = []; const warns = []; let code = null;
  let decision = null;
  try {
    decision = enforceHttpAuthPosture({
      bindHost,
      hasStaticToken: !!env.MCP_SSE_AUTHORIZATION || !!env.MCP_STATIC_TOKENS?.trim(),
      oidcEnabled,
      allowUnauthenticated: env.MCP_ALLOW_UNAUTHENTICATED === 'true',
      weakTokenVars: findWeakTokenVars(env, { oidcEnabled }),
    }, { error: (m) => errors.push(m), warn: (m) => warns.push(m) }, (c) => { code = c; throw new Error('__exit__'); });
  } catch (e) { if (e.message !== '__exit__') throw e; }
  return { decision, code, errors, warns, all: errors.concat(warns).join('\n') };
}
check('positive: 32-char token on 0.0.0.0 serves with no token warning', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: STRONG }, '0.0.0.0');
  assert.strictEqual(r.decision, 'serve'); assert.strictEqual(r.code, null);
  assert.strictEqual(r.warns.length, 0); assert.strictEqual(r.errors.length, 0);
});
check('positive: short token on loopback serves, one warn naming the var and 32, no value', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: 'test' }, '127.0.0.1');
  assert.strictEqual(r.decision, 'serve'); assert.strictEqual(r.code, null);
  assert.strictEqual(r.warns.length, 1);
  assert.ok(/MCP_SSE_AUTHORIZATION/.test(r.warns[0]) && /32 characters/.test(r.warns[0]), r.warns[0]);
  assert.ok(!r.all.includes('test'), r.all);
});
check('positive: OIDC ignores a stale weak MCP_SSE_AUTHORIZATION', () => {
  assert.deepStrictEqual(findWeakTokenVars({ MCP_SSE_AUTHORIZATION: 'changeme' }, { oidcEnabled: true }), []);
  const r = runWeak({ AUTH_PROVIDER: 'oidc', MCP_SSE_AUTHORIZATION: 'changeme' }, '0.0.0.0');
  assert.strictEqual(r.decision, 'serve'); assert.strictEqual(r.code, null);
});
check('positive: empty token + opt-out stays serve-open-warn (compose open mode)', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: '', MCP_ALLOW_UNAUTHENTICATED: 'true' }, '0.0.0.0');
  assert.strictEqual(r.decision, 'serve-open-warn'); assert.strictEqual(r.code, null);
});
check('NEGATIVE: placeholder on 0.0.0.0 exits 1, names var and openssl, not the value, no opt-out hint', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: PLACEHOLDER }, '0.0.0.0');
  assert.strictEqual(r.code, 1); assert.strictEqual(r.errors.length, 1);
  assert.ok(/MCP_SSE_AUTHORIZATION/.test(r.errors[0]) && /openssl rand -hex 32/.test(r.errors[0]), r.errors[0]);
  assert.ok(!r.errors[0].includes(PLACEHOLDER), r.errors[0]);
  assert.ok(!/MCP_ALLOW_UNAUTHENTICATED/.test(r.errors[0]), r.errors[0]);
});
check('NEGATIVE: 31-char token on 0.0.0.0 exits 1 naming the var and the 32 minimum', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: 'a'.repeat(31) }, '0.0.0.0');
  assert.strictEqual(r.code, 1);
  assert.ok(/MCP_SSE_AUTHORIZATION/.test(r.errors[0]) && /32 characters/.test(r.errors[0]), r.errors[0]);
});
check('NEGATIVE: padded mixed-case placeholder on :: exits 1', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: ' Replace-With-OpenSSL-Rand-Hex-32 ' }, '::');
  assert.strictEqual(r.code, 1); assert.ok(/MCP_SSE_AUTHORIZATION/.test(r.errors[0]));
});
check('NEGATIVE: whitespace-only token on 0.0.0.0 exits 1', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: '   ' }, '0.0.0.0');
  assert.strictEqual(r.code, 1);
});
check('NEGATIVE: the opt-out does not rescue a weak token', () => {
  const r = runWeak({ MCP_SSE_AUTHORIZATION: 'changeme', MCP_ALLOW_UNAUTHENTICATED: 'true' }, '0.0.0.0');
  assert.strictEqual(r.code, 1); assert.ok(/MCP_SSE_AUTHORIZATION/.test(r.errors[0]));
  assert.strictEqual(r.warns.length, 0);
});
check('NEGATIVE: placeholder MCP_TOKEN_* on 0.0.0.0 exits 1 naming that var, not the value', () => {
  const env = {
    MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }),
    MCP_TOKEN_ALICE: PLACEHOLDER,
  };
  const r = runWeak(env, '0.0.0.0');
  assert.strictEqual(r.code, 1);
  assert.ok(/MCP_TOKEN_ALICE/.test(r.errors[0]) && !r.errors[0].includes(PLACEHOLDER), r.errors[0]);
});
check('positive: placeholder MCP_TOKEN_* on loopback warns once with the same wording', () => {
  const env = {
    MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }),
    MCP_TOKEN_ALICE: PLACEHOLDER,
  };
  const r = runWeak(env, '127.0.0.1');
  assert.strictEqual(r.code, null); assert.strictEqual(r.warns.length, 1);
  assert.ok(/^MCP_TOKEN_ALICE is shorter than 32 characters or an example placeholder/.test(r.warns[0]), r.warns[0]);
});
check('positive: a strong MCP_TOKEN_* and an unparsable MCP_STATIC_TOKENS are not weak here', () => {
  assert.deepStrictEqual(findWeakTokenVars({
    MCP_STATIC_TOKENS: JSON.stringify({ alice: { tokenEnv: 'MCP_TOKEN_ALICE', budgets: ['Alpha'] } }),
    MCP_TOKEN_ALICE: STRONG,
  }, { oidcEnabled: false }), []);
  assert.deepStrictEqual(findWeakTokenVars({ MCP_STATIC_TOKENS: '{not json' }, { oidcEnabled: false }), []);
});

console.log(`\n[auth-posture] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
