// #242: startup-guard wiring test. Asserts the enforcement (not just the pure
// predicate): enforceHttpAuthPosture exits the process non-zero on a non-loopback
// bind with no auth, and does NOT exit on a loopback bind or a configured token.
// Uses the process.exit spy pattern from tests/unit/config_insecure_upstream.test.js
// (replace process.exit with a stub that records the code and throws a sentinel,
// restore in finally) so the exit is observed without killing the test runner.
import assert from 'assert';

const { enforceHttpAuthPosture } = await import('../../dist/src/lib/authPosture.js');

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

// Quiet capturing logger so the refuse/warn lines do not spam test output, and so
// we can assert the remediation message names the missing token.
function makeLog() {
  const errors = [];
  const warns = [];
  return { errors, warns, error: (m) => errors.push(m), warn: (m) => warns.push(m) };
}

// Run enforce with process.exit stubbed; returns { exited, decision, log }.
function runEnforce(input) {
  const realExit = process.exit;
  let exited = null;
  process.exit = (code) => { exited = code; throw new Error('__exit__'); };
  const log = makeLog();
  let decision = null;
  try {
    decision = enforceHttpAuthPosture(input, log);
  } catch (e) {
    if (e.message !== '__exit__') throw e;
  } finally {
    process.exit = realExit;
  }
  return { exited, decision, log };
}

console.log('[auth-posture-wiring] refuse path exits non-zero');
check('non-loopback + no auth + no opt-out -> process.exit(1)', () => {
  const { exited } = runEnforce({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(exited, 1);
});
check('refuse message names MCP_SSE_AUTHORIZATION (operator remediation)', () => {
  const { log } = runEnforce({ bindHost: '192.168.1.50', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(log.errors.length, 1);
  assert.ok(/MCP_SSE_AUTHORIZATION/.test(log.errors[0]), 'error should name the token env var');
  assert.ok(/MCP_ALLOW_UNAUTHENTICATED/.test(log.errors[0]), 'error should name the opt-out');
});

console.log('\n[auth-posture-wiring] safe paths do NOT exit');
check('loopback bind + no auth -> no exit, decision serve', () => {
  const { exited, decision } = runEnforce({ bindHost: '127.0.0.1', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(exited, null);
  assert.strictEqual(decision, 'serve');
});
check('configured token (exposed bind) -> no exit, decision serve', () => {
  const { exited, decision } = runEnforce({ bindHost: '0.0.0.0', hasStaticToken: true, oidcEnabled: false, allowUnauthenticated: false });
  assert.strictEqual(exited, null);
  assert.strictEqual(decision, 'serve');
});
check('oidc enabled (exposed bind) -> no exit, decision serve', () => {
  const { exited, decision } = runEnforce({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: true, allowUnauthenticated: false });
  assert.strictEqual(exited, null);
  assert.strictEqual(decision, 'serve');
});

console.log('\n[auth-posture-wiring] opt-out serves open with a loud warning, no exit');
check('opt-out -> no exit, decision serve-open-warn, warns once', () => {
  const { exited, decision, log } = runEnforce({ bindHost: '0.0.0.0', hasStaticToken: false, oidcEnabled: false, allowUnauthenticated: true });
  assert.strictEqual(exited, null);
  assert.strictEqual(decision, 'serve-open-warn');
  assert.strictEqual(log.warns.length, 1);
  assert.strictEqual(log.errors.length, 0);
});

console.log(`\n[auth-posture-wiring] Results: ${failed === 0 ? 'all passed' : failed + ' failed'}`);
process.exit(failed > 0 ? 1 : 0);
