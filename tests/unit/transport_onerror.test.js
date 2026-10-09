// tests/unit/transport_onerror.test.js
//
// #504: the SDK reports transport and protocol errors through server.onerror, which
// nothing set. attachTransportErrorLogger installs a handler that logs a sanitized,
// rate-limited record with a CONSTANT message. Cases U1 to U9 follow the ticket.
//
// "Absent" assertions check the message AND every string value in meta, so a body hidden
// in meta fails too. U7 and U8 run in a fresh child process (order independent; an
// in-process stdout spy is defeated by the console hijack in src/logger.ts).
//
// Run: node tests/unit/transport_onerror.test.js (build first)

import assert from 'assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOD_PATH = join(ROOT, 'dist', 'src', 'lib', 'transportErrorLogger.js');
const MOD_URL = pathToFileURL(MOD_PATH).href;
const { attachTransportErrorLogger, createWindowLimiter, sanitizeTransportErrorDetail } = await import(MOD_URL);

let passed = 0;
let failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

const CANARY = 'secret-123';
const BATCH = 'Invalid Request: Batch must not exceed 100 messages';

function stubLogger(records) {
  return { warn: (m, meta) => records.push({ m, meta }), info() {}, debug() {}, error() {} };
}
function freshLimiter(clock = { t: 0 }) {
  return { clock, limiter: createWindowLimiter({ max: 50, windowMs: 60_000, now: () => clock.t }) };
}
function setup(transport = 'http', prev) {
  const records = [];
  const server = {};
  if (prev) server.onerror = prev;
  attachTransportErrorLogger(server, transport, { logger: stubLogger(records), limiter: freshLimiter().limiter });
  return { server, records };
}
function strings(rec) {
  return [rec.m, ...Object.values(rec.meta ?? {}).filter((v) => typeof v === 'string')];
}
function assertAbsent(records, needle) {
  for (const r of records) for (const s of strings(r)) assert.ok(!s.includes(needle), `leaked ${needle} in ${s}`);
}

console.log('transport_onerror');

check('U1 benign message is logged verbatim with a constant message', () => {
  const { server, records } = setup('http');
  server.onerror(new Error(BATCH));
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].m, 'MCP transport error');
  assert.strictEqual(records[0].meta.detail, BATCH);
  assert.strictEqual(records[0].meta.transport, 'http');
  assert.strictEqual(records[0].meta.errorName, 'Error');
});

check('U2a unknown message type payload is cut', () => {
  const { server, records } = setup();
  server.onerror(new Error(`Unknown message type: {"secret":"${CANARY}"}`));
  assert.strictEqual(records[0].meta.detail, 'Unknown message type: [payload omitted]');
  assertAbsent(records, CANARY);
});

check('U2b progress notification payload is cut', () => {
  const { server, records } = setup();
  server.onerror(new Error(`Received a progress notification for an unknown token: {"params":{"x":"${CANARY}"}}`));
  assertAbsent(records, CANARY);
  assert.ok(records[0].meta.detail.endsWith('[payload omitted]'));
});

check('U2c unknown response id payload is cut', () => {
  const { server, records } = setup();
  server.onerror(new Error(`Received a response for an unknown message ID: {"id":"${CANARY}"}`));
  assertAbsent(records, CANARY);
});

check('U2d real JSON.parse SyntaxError does not leak the input', () => {
  const { server, records } = setup('stdio');
  let err;
  try { JSON.parse(`hello ${CANARY}`); } catch (e) { err = e; }
  server.onerror(err);
  assertAbsent(records, CANARY);
  assert.strictEqual(records[0].meta.errorName, 'SyntaxError');
});

check('U2e real ZodError does not leak the input', () => {
  const { server, records } = setup();
  const parsed = z.object({ a: z.number() }).safeParse({ a: CANARY });
  assert.ok(!parsed.success);
  server.onerror(parsed.error);
  assertAbsent(records, CANARY);
  assert.strictEqual(records[0].meta.errorName, 'ZodError');
});

check('U2f detail is capped at 200 code points', () => {
  const { server, records } = setup();
  server.onerror(new Error('x'.repeat(5000)));
  assert.strictEqual(Array.from(records[0].meta.detail).length, 200);
  const emoji = sanitizeTransportErrorDetail(new Error('\u{1F600}'.repeat(500)));
  assert.strictEqual(Array.from(emoji).length, 200);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(emoji), 'split surrogate pair');
});

check('U2g percent, C1 and bidi characters are stripped; message stays constant', () => {
  const { server, records } = setup();
  server.onerror(new Error('Bad Request: Unsupported protocol version: 9%o9 \u009b x\u202e y (supported versions: X)'));
  assert.strictEqual(records[0].m, 'MCP transport error');
  assert.strictEqual(records[0].meta.transport, 'http');
  const d = records[0].meta.detail;
  assert.ok(!d.includes('%'));
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(d));
});

check('U2h stack and cause are never logged', () => {
  const { server, records } = setup();
  const e = new Error(`Unknown message type: {"a":1}`, { cause: new Error(CANARY) });
  e.stack = `Error: ${CANARY}\n    at ${CANARY}`;
  server.onerror(e);
  assertAbsent(records, CANARY);
  const allowed = new Set(['transport', 'errorName', 'detail', 'suppressed']);
  for (const k of Object.keys(records[0].meta)) assert.ok(allowed.has(k), `unexpected meta key ${k}`);
});

check('U3a attach installs a function and logs nothing until invoked', () => {
  const records = [];
  const server = {};
  attachTransportErrorLogger(server, 'http', { logger: stubLogger(records), limiter: freshLimiter().limiter });
  assert.strictEqual(typeof server.onerror, 'function');
  assert.strictEqual(records.length, 0);
});

check('U3b hostile values never throw', () => {
  const { server, records } = setup();
  const throwingMessage = new Error('x');
  Object.defineProperty(throwingMessage, 'message', { get() { throw new Error('boom'); } });
  for (const v of [undefined, 'plain string', { toString() { throw new Error('boom'); } }, throwingMessage]) {
    server.onerror(v);
  }
  assert.deepStrictEqual(records.map((r) => r.meta.detail), ['[no message]', 'plain string', '[no message]', '[no message]']);
});

check('U3c a throwing logger does not throw', () => {
  const server = {};
  attachTransportErrorLogger(server, 'http', {
    logger: { warn() { throw new Error('log down'); }, info() {}, debug() {}, error() {} },
    limiter: freshLimiter().limiter,
  });
  server.onerror(new Error('x'));
});

check('U3d invalid error name falls back to Error', () => {
  const { server, records } = setup();
  const e = new Error('x');
  e.name = 'Bad Name<script>';
  server.onerror(e);
  assert.strictEqual(records[0].meta.errorName, 'Error');
});

check('U5 prior onerror is chained, and a throwing one does not block the record', () => {
  const calls = [];
  const { server, records } = setup('http', (e) => calls.push(e));
  const e = new Error('x');
  server.onerror(e);
  assert.deepStrictEqual(calls, [e]);
  assert.strictEqual(records.length, 1);
  const bad = setup('http', () => { throw new Error('prev down'); });
  bad.server.onerror(new Error('y'));
  assert.strictEqual(bad.records.length, 1);
});

check('U6 shared limiter bounds two sessions; next window reports suppressed', () => {
  const records = [];
  const { clock, limiter } = freshLimiter();
  const a = {};
  const b = {};
  attachTransportErrorLogger(a, 'http', { logger: stubLogger(records), limiter });
  attachTransportErrorLogger(b, 'http', { logger: stubLogger(records), limiter });
  for (let i = 0; i < 30; i++) { a.onerror(new Error('a')); b.onerror(new Error('b')); }
  assert.strictEqual(records.length, 50);
  clock.t = 61_000;
  a.onerror(new Error('later'));
  assert.strictEqual(records.length, 51);
  assert.strictEqual(records[50].meta.suppressed, 10);
  a.onerror(new Error('next'));
  assert.ok(!('suppressed' in records[51].meta));
});

function runChild(script, extraEnv = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, MCP_STDIO_MODE: 'true', LOG_FORMAT: 'json', ...extraEnv },
  });
}

check('U7 module limiter is shared across servers attached without a limiter', () => {
  const script = `
    const m = await import(${JSON.stringify(MOD_URL)});
    let n = 0;
    const logger = { warn() { n++; }, info() {}, debug() {}, error() {} };
    const s1 = {}; const s2 = {};
    m.attachTransportErrorLogger(s1, 'http', { logger });
    m.attachTransportErrorLogger(s2, 'http', { logger });
    for (let i = 0; i < 26; i++) { s1.onerror(new Error('a')); s2.onerror(new Error('b')); }
    process.stderr.write('COUNT=' + n + '\\n');
  `;
  const r = runChild(script);
  assert.ok(/COUNT=50\n/.test(r.stderr), `stderr: ${r.stderr}`);
});

check('U8 under stdio mode the record goes to stderr and stdout stays empty (with witness)', () => {
  const body = (invoke) => `
    const m = await import(${JSON.stringify(MOD_URL)});
    const s = {};
    m.attachTransportErrorLogger(s, 'stdio');
    ${invoke ? `s.onerror(new Error(${JSON.stringify(BATCH)}));` : ''}
    await new Promise((r) => setTimeout(r, 300));
  `;
  const hit = runChild(body(true));
  assert.strictEqual(hit.stdout, '', `stdout: ${hit.stdout}`);
  assert.ok(hit.stderr.includes('MCP transport error'), `stderr: ${hit.stderr}`);
  assert.ok(hit.stderr.includes(BATCH));
  const miss = runChild(body(false));
  assert.ok(!miss.stderr.includes('MCP transport error'));
});

check('U9 both call sites are wired once, after new Server( and before server.connect(', () => {
  for (const [file, kind] of [['src/server/httpServer.ts', 'http'], ['src/server/stdioServer.ts', 'stdio']]) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const call = `attachTransportErrorLogger(server, '${kind}');`;
    assert.strictEqual(src.split(call).length - 1, 1, `${file}: call count`);
    const iNew = src.indexOf('new Server(');
    const iCall = src.indexOf(call);
    const iConnect = src.indexOf('await server.connect(');
    assert.ok(iNew >= 0 && iNew < iCall, `${file}: call before new Server(`);
    assert.ok(iConnect > iCall, `${file}: connect before call`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
