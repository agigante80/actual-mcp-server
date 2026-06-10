// tests/unit/logger_redaction.test.js  (#220)
// Verifies centralized secret/PII redaction: key-name denylist at any depth, the
// known-secret VALUE scrub (a secret under a benign key / inside the message), no
// over-redaction of benign fields, and the real logTransportWithDirection path masking
// an Authorization header end to end through the live logger.

// Set BEFORE importing the logger singleton (SECRET_VALUES + format are read at import).
process.env.MCP_STDIO_MODE = 'true';
process.env.LOG_FORMAT = 'json';
process.env.MCP_SSE_AUTHORIZATION = 'LIVE-SECRET-TOKEN-XYZ123';
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = 'hunter2-secret';

let failures = 0;
const out = (s) => process.stderr.write(s + '\n');
const pass = (l) => out(`  ✓ ${l}`);
const fail = (l, d = '') => { out(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const ok = (cond, l, d = '') => (cond ? pass(l) : fail(l, d));
const eq = (g, w, l) => ok(g === w, l, `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);

const capture = (fn) => {
  const chunks = [];
  const origErr = process.stderr.write.bind(process.stderr);
  const origOut = process.stdout.write.bind(process.stdout);
  const stdoutChunks = [];
  process.stderr.write = (...a) => { chunks.push(String(a[0])); return origErr(...a); };
  process.stdout.write = (...a) => { stdoutChunks.push(String(a[0])); return origOut(...a); };
  try { fn(); } finally { process.stderr.write = origErr; process.stdout.write = origOut; }
  return { stderr: chunks.join(''), stdout: stdoutChunks.join('') };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mod = await import('../../dist/src/logger.js');
  const { isSensitiveKey, collectSecretValues, redactRecord } = mod;
  const logger = mod.default;
  const { logTransportWithDirection } = mod;

  out('\n[#220] isSensitiveKey');
  for (const k of ['authorization', 'Authorization', 'password', 'encryptionPassword', 'cookie', 'Set-Cookie', 'token', 'client_secret', 'x-api-key'])
    ok(isSensitiveKey(k), `"${k}" is sensitive`);
  for (const k of ['accountId', 'durationMs', 'content-type', 'module', 'message'])
    ok(!isSensitiveKey(k), `"${k}" is not over-flagged`);

  out('\n[#220] collectSecretValues (length-guarded, secret-named only)');
  {
    const vals = collectSecretValues({ ACTUAL_PASSWORD: 'longpassword', BUDGET_1_PASSWORD: 'eightchr', MCP_SSE_AUTHORIZATION: 'tok-abcdef', SHORT_PASSWORD: 'short7x', FOO_BAR: 'notsecret-but-long' });
    ok(vals.includes('longpassword') && vals.includes('tok-abcdef') && vals.includes('eightchr'), 'collects secret-named values >= 8 chars');
    ok(!vals.includes('short7x'), 'skips too-short (<8) secret value');
    ok(!vals.includes('notsecret-but-long'), 'skips non-secret-named var');
  }

  out('\n[#220] redactRecord must NOT mutate a live nested object (copy-on-write)');
  {
    const liveHeaders = { authorization: 'Bearer REAL', 'content-type': 'json' };
    const meta = { headers: liveHeaders, note: 'x' };
    const result = redactRecord(meta, []);
    eq(liveHeaders.authorization, 'Bearer REAL', 'the caller\'s live nested object is NOT mutated');
    eq(result.headers.authorization, '[REDACTED]', 'the redacted copy masks the sensitive key');
    ok(result.headers !== liveHeaders, 'a new headers object is produced (copy-on-write)');
  }

  out('\n[#220] redactRecord: key-name at depth, value scrub, no over-redaction');
  {
    const rec = redactRecord({
      message: 'login with TOPSECRETVALUE done',
      headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'content-type': 'application/json' },
      password: 'p',
      note: 'embedded TOPSECRETVALUE here',
      accountId: 'acc-123',
      durationMs: 7,
    }, ['TOPSECRETVALUE']);
    eq(rec.headers.authorization, '[REDACTED]', 'nested authorization masked');
    eq(rec.headers.cookie, '[REDACTED]', 'nested cookie masked');
    eq(rec.headers['content-type'], 'application/json', 'benign header preserved');
    eq(rec.password, '[REDACTED]', 'password key masked');
    eq(rec.note, 'embedded [REDACTED] here', 'secret VALUE under a benign key scrubbed');
    eq(rec.message, 'login with [REDACTED] done', 'secret VALUE scrubbed from message');
    eq(rec.accountId, 'acc-123', 'benign value preserved');
    eq(rec.durationMs, 7, 'benign number preserved');
  }

  out('\n[#220] redactRecord idempotent + cycle-safe');
  {
    const once = redactRecord({ password: 'x', a: { b: { c: 'ok' } } }, []);
    const twice = redactRecord(once, []);
    eq(twice.password, '[REDACTED]', 're-redaction is a no-op (still [REDACTED])');
    const cyclic = { name: 'n' }; cyclic.self = cyclic;
    let threw = null; try { redactRecord(cyclic, []); } catch (e) { threw = e; }
    ok(threw === null, 'cyclic record does not throw');
  }

  out('\n[#220] live: logger masks Authorization header + known secret value over the wire');
  {
    const { stderr, stdout } = capture(() => {
      // `password` is a TOP-LEVEL sensitive key: it exercises the after-splat top-level
      // redaction path end to end (the exact path the splat-ordering bug lived in).
      logger.info('inbound', { headers: { authorization: 'Bearer abc.def' }, password: 'topsecretpw', note: 'LIVE-SECRET-TOKEN-XYZ123 here', accountId: 'a1' });
    });
    await sleep(20);
    ok(!stderr.includes('Bearer abc.def'), 'raw Authorization value (nested key) not in output', stderr.slice(0, 200));
    ok(!stderr.includes('topsecretpw'), 'top-level sensitive KEY masked end-to-end through the live pipeline');
    ok(!stderr.includes('LIVE-SECRET-TOKEN-XYZ123'), 'configured secret value scrubbed from output');
    ok(stderr.includes('[REDACTED]'), 'redaction marker present');
    ok(stderr.includes('a1'), 'benign field preserved');
    eq(stdout, '', 'stdout stays empty (stdio framing)');
  }

  out('\n[#220] live: logTransportWithDirection never emits a raw Authorization header');
  {
    const fakeReq = { method: 'POST', originalUrl: '/http', headers: { authorization: 'Bearer raw-token-zzz', 'content-type': 'application/json' } };
    const { stderr } = capture(() => {
      logTransportWithDirection('from', '127.0.0.1', fakeReq, { hello: 'world' });
    });
    await sleep(20);
    ok(!stderr.includes('raw-token-zzz'), 'logTransportWithDirection masks the Authorization header');
    ok(stderr.includes('[REDACTED]'), 'redaction applied on the transport-helper path');
  }

  out('');
  if (failures === 0) out('[#220] All redaction tests passed ✓');
  else { out(`[#220] ${failures} test(s) FAILED`); process.exit(2); }
})().catch((e) => { out(`[#220] harness crashed: ${e && e.stack ? e.stack : e}`); process.exit(2); });
