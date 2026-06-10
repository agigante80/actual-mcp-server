// tests/unit/logger_structured.test.js  (#219)
// Verifies the structured-logging foundation: the format/level resolution precedence,
// the JSON format carries metadata + error stack (the previously-dropped data), the
// no-meta path is clean, dev pretty stays human-readable, and stdio+json output still
// goes to stderr only (JSON-RPC stdout purity).

// stdio mode + json must be set BEFORE importing the logger singleton (read at import).
process.env.MCP_STDIO_MODE = 'true';
process.env.LOG_FORMAT = 'json';
process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';

let failures = 0;
const out = (s) => process.stderr.write(s + '\n'); // bypass the winston console hijack
const pass = (l) => out(`  ✓ ${l}`);
const fail = (l, d = '') => { out(`  ✗ FAIL: ${l}${d ? ` (${d})` : ''}`); failures++; };
const ok = (cond, l, d = '') => (cond ? pass(l) : fail(l, d));
const eq = (g, w, l) => ok(g === w, l, `got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { resolveLogConfig, buildLogFormat } = await import('../../dist/src/logger.js');
  const loggerSingleton = (await import('../../dist/src/logger.js')).default;
  // winston/logform store the final serialized line under Symbol.for('message') (this is
  // exactly triple-beam's MESSAGE export); use the well-known symbol so the test does not
  // depend on triple-beam being a hoisted/deduped transitive dependency.
  const MESSAGE = Symbol.for('message');

  const jsonLine = (info) => JSON.parse(buildLogFormat(true).transform({ ...info }, {})[MESSAGE]);
  const prettyLine = (info) => buildLogFormat(false, false).transform({ ...info }, {})[MESSAGE];

  out('\n[#219] resolveLogConfig precedence');
  eq(resolveLogConfig({ LOG_FORMAT: 'json' }).useJson, true, 'explicit LOG_FORMAT=json -> json');
  eq(resolveLogConfig({ LOG_FORMAT: 'pretty', NODE_ENV: 'production' }).useJson, false, 'explicit pretty wins over prod');
  eq(resolveLogConfig({ NODE_ENV: 'production' }).useJson, true, 'prod default -> json');
  eq(resolveLogConfig({}).useJson, false, 'dev default -> pretty');
  eq(resolveLogConfig({ NODE_ENV: 'production' }).level, 'info', 'prod default level is info');
  eq(resolveLogConfig({}).level, 'debug', 'dev default level is debug');
  eq(resolveLogConfig({ NODE_ENV: 'production', MCP_BRIDGE_LOG_LEVEL: 'warn' }).level, 'warn', 'explicit level wins in prod');

  out('\n[#219] JSON format carries metadata + error stack (the dropped-data fix)');
  {
    const err = new Error('boom');
    // mirrors createModuleLogger('TEST').error('op failed', err, { sessionId: 'abc' })
    const rec = jsonLine({ level: 'error', message: '[TEST] op failed', module: 'TEST', error: err.message, stack: err.stack, sessionId: 'abc' });
    eq(rec.level, 'error', 'level preserved');
    ok(typeof rec.message === 'string' && rec.message.includes('[TEST] op failed'), 'message includes module prefix');
    eq(rec.module, 'TEST', 'module promoted to a field');
    eq(rec.service, 'actual-mcp-server', 'service field present');
    eq(rec.context?.sessionId, 'abc', 'user metadata nested under context');
    ok(typeof rec.stack === 'string' && rec.stack.includes('boom'), 'error stack is present (was dropped before)');
    ok(typeof rec.timestamp === 'string' && rec.timestamp.includes('T'), 'ISO 8601 timestamp');
  }

  out('\n[#219] multi-transport idempotency (STORE_LOGS=true gives >1 transport sharing the info)');
  {
    // winston passes the SAME info object to every transport format; nesting must not
    // re-wrap context into context.context on the second/third pass.
    const info = { level: 'info', message: '[T] x', module: 'T', sessionId: 'abc' };
    buildLogFormat(true).transform(info, {}); // transport 1 mutates info in place
    const second = JSON.parse(buildLogFormat(true).transform(info, {})[MESSAGE]); // transport 2 sees it
    eq(second.context?.sessionId, 'abc', 'context still holds the field after a second transport pass');
    ok(!('context' in (second.context || {})), 'context is NOT double-nested (no context.context)');
  }

  out('\n[#219] JSON no-meta path is clean (negative)');
  {
    const rec = jsonLine({ level: 'info', message: '[TEST] hello', module: 'TEST' });
    eq(rec.message, '[TEST] hello', 'message intact');
    ok(!('context' in rec), 'no empty context key when there is no metadata');
    ok(!JSON.stringify(rec).includes('undefined'), 'no literal "undefined" leaks into the record');
    // an Error with no stack still serializes cleanly
    const rec2 = jsonLine({ level: 'error', message: '[TEST] x', module: 'TEST', error: 'plain', stack: undefined });
    ok(typeof JSON.stringify(rec2) === 'string', 'record with undefined stack serializes without throwing');
  }

  out('\n[#219] dev pretty format stays human-readable, not JSON');
  {
    const err = new Error('boom');
    const line = prettyLine({ level: 'error', message: '[TEST] op failed', module: 'TEST', error: err.message, stack: err.stack, sessionId: 'abc' });
    ok(line.includes('[TEST] op failed'), 'pretty line contains the prefixed message');
    ok(!line.trimStart().startsWith('{'), 'pretty line is not JSON');
    ok(line.includes('boom'), 'pretty line includes the error stack (no longer dropped)');
  }

  out('\n[#219] stdio + json: output goes to stderr only (stdout JSON-RPC purity)');
  {
    const stdoutWrites = [];
    const stderrChunks = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (...a) => { stdoutWrites.push(String(a[0])); return origOut(...a); };
    process.stderr.write = (...a) => { stderrChunks.push(String(a[0])); return origErr(...a); };

    loggerSingleton.error('purity-check-error');
    loggerSingleton.info('purity-check-info');
    await sleep(50);

    process.stdout.write = origOut;
    process.stderr.write = origErr;

    ok(stdoutWrites.length === 0, 'no stdout writes from the logger in stdio mode', `got ${stdoutWrites.length}`);
    const joined = stderrChunks.join('');
    ok(joined.includes('purity-check-error'), 'the log line was written to stderr');
    // and it is JSON (LOG_FORMAT=json), proving the format applies under stdio routing
    const jsonish = stderrChunks.find((c) => c.trimStart().startsWith('{') && c.includes('purity-check'));
    ok(!!jsonish, 'stderr output is JSON-formatted under LOG_FORMAT=json');
  }

  out('');
  if (failures === 0) out('[#219] All structured-logging tests passed ✓');
  else { out(`[#219] ${failures} test(s) FAILED`); process.exit(2); }
})().catch((e) => { out(`[#219] harness crashed: ${e && e.stack ? e.stack : e}`); process.exit(2); });
