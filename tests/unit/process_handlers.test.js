// #622: the process-level handlers write gated records only. Drives the pure factory in
// dist/src/lib/processHandlers.js with a recording exit, writeSync and logger, so no test
// exits. Imports from dist/, so `npm run build` must run first.
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { stripTsComments } from './helpers/source-text.js';

const { createProcessHandlers, categorizeError, errorRecordFields } = await import('../../dist/src/lib/processHandlers.js');
const { NotFoundRefusal, OutOfRangeRefusal } = await import('../../dist/src/lib/errors.js');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

/** A factory wired to recorders. `withLogger: false` models the pre-logger window. */
function harness({ withLogger = true } = {}) {
  const exits = [];
  const writes = [];
  const logs = [];
  const logger = {
    warn: (message, meta) => logs.push({ level: 'warn', message, meta }),
  };
  const handlers = createProcessHandlers({
    exit: (code) => exits.push(code),
    writeSync: (fd, text) => writes.push({ fd, text }),
    getLogger: () => (withLogger ? logger : undefined),
  });
  const records = () => writes.filter((w) => w.text.startsWith('{')).map((w) => JSON.parse(w.text));
  const allText = () => JSON.stringify({ writes, logs });
  return { handlers, exits, writes, logs, records, allText };
}

function sentinelReason(message = 'MSG_SENTINEL') {
  return Object.assign(new Error(message), {
    request: { headers: { authorization: 'Bearer SENTINEL' } },
    response: { data: 'DATA_SENTINEL' },
    type: 'TYPE_SENTINEL',
  });
}

const proxyReason = () =>
  new Proxy(new Error('x'), {
    get(t, k) {
      if (k === 'code') throw new Error('GETTER_SENTINEL');
      return Reflect.get(t, k);
    },
  });

console.log('[process-handlers] fatal paths');

check('fatal unhandledRejection: one gated sys_crash record, exit 1, logger untouched', () => {
  const h = harness();
  h.handlers.onUnhandledRejection(sentinelReason(), Promise.resolve());
  const recs = h.records();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(h.writes[0].fd, 2);
  assert.strictEqual(recs[0].level, 'error');
  assert.strictEqual(recs[0].event, 'sys_crash');
  assert.strictEqual(recs[0].source, 'unhandledRejection');
  assert.strictEqual(recs[0].error.type, 'Error');
  assert.strictEqual(recs[0].error.category, 'internal');
  assert.deepStrictEqual(h.exits, [1]);
  assert.strictEqual(h.logs.length, 0);
  for (const s of ['SENTINEL', 'Promise {']) assert.ok(!h.allText().includes(s), `output contains ${s}`);
});

check('fatal uncaughtException: gated record, no bank sync override, exit 1', () => {
  const h = harness();
  h.handlers.onUncaughtException(Object.assign(new Error('boom MSG_SENTINEL'), { config: { token: 'SENTINEL' } }));
  const recs = h.records();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].event, 'sys_crash');
  assert.strictEqual(recs[0].source, 'uncaughtException');
  assert.strictEqual(recs[0].error.category, 'internal');
  assert.deepStrictEqual(h.exits, [1]);
  assert.strictEqual(h.logs.length, 0);
  assert.ok(!h.allText().includes('SENTINEL'));
});

check('before the logger is attached, a fatal record holds only the gated fields', () => {
  const h = harness({ withLogger: false });
  h.handlers.onUnhandledRejection(sentinelReason());
  assert.strictEqual(h.writes.length, 1);
  const rec = h.records()[0];
  assert.deepStrictEqual(Object.keys(rec).sort(), ['error', 'event', 'level', 'source']);
  assert.deepStrictEqual(Object.keys(rec.error).sort(), ['category', 'safeMessage', 'type']);
  assert.strictEqual(rec.level, 'error');
  assert.ok(!h.allText().includes('SENTINEL'));
});

check('a non-Error reason is classed by type and not echoed (string, null)', () => {
  for (const [reason, type] of [['TOKEN_SENTINEL', 'string'], [null, 'null']]) {
    const h = harness();
    h.handlers.onUnhandledRejection(reason);
    assert.deepStrictEqual(h.exits, [1]);
    assert.strictEqual(h.records()[0].error.type, type);
    assert.ok(!h.allText().includes('TOKEN_SENTINEL'));
  }
});

check('a forged line cannot be injected through an upstream type', () => {
  const h = harness();
  const reason = Object.assign(new Error('x'), { type: 'X\n2026-11-04 00:00:00.000 error: forged' });
  h.handlers.onUnhandledRejection(reason);
  const lines = h.writes.map((w) => w.text).join('').split('\n');
  assert.ok(!lines.some((l) => l.startsWith('2026-11-04 00:00:00.000 error: forged')));
  assert.strictEqual(h.records()[0].error.type, 'Error');
});

check('a throwing getter in uncaughtException yields the fixed fallback record once', () => {
  const h = harness();
  h.handlers.onUncaughtException(proxyReason());
  const recs = h.records();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].event, 'sys_crash');
  assert.strictEqual(recs[0].error.type, 'unknown');
  assert.strictEqual(recs[0].error.category, 'internal');
  assert.deepStrictEqual(h.exits, [1]);
  assert.ok(!h.allText().includes('GETTER_SENTINEL'));
});

check('a throwing getter in unhandledRejection does not throw and writes one record', () => {
  const h = harness();
  assert.doesNotThrow(() => h.handlers.onUnhandledRejection(proxyReason()));
  assert.strictEqual(h.records().length, 1);
  assert.deepStrictEqual(h.exits, [1]);
  assert.ok(!h.allText().includes('GETTER_SENTINEL'));
});

check('a failing stderr write still exits 1, once, and the handler does not throw', () => {
  const exits = [];
  const handlers = createProcessHandlers({
    exit: (code) => exits.push(code),
    writeSync: () => {
      throw new Error('EPIPE');
    },
    getLogger: () => undefined,
  });
  assert.doesNotThrow(() => handlers.onUnhandledRejection(new Error('x')));
  assert.deepStrictEqual(exits, [1]);
  exits.length = 0;
  assert.doesNotThrow(() => handlers.onUncaughtException(proxyReason()));
  assert.deepStrictEqual(exits, [1]);
});

console.log('\n[process-handlers] survivable paths');

check('benign rejection: one warn with process.rejection_benign, no write, no exit', () => {
  const h = harness();
  const reason = Object.assign(sentinelReason("Field 'x' does not exist in table"));
  h.handlers.onUnhandledRejection(reason);
  assert.strictEqual(h.logs.length, 1);
  assert.strictEqual(h.logs[0].level, 'warn');
  assert.strictEqual(h.logs[0].meta.event, 'process.rejection_benign');
  assert.strictEqual(h.writes.length, 0);
  assert.deepStrictEqual(h.exits, []);
});

check('benign record carries no upstream text', () => {
  const h = harness();
  h.handlers.onUnhandledRejection(sentinelReason("Field 'x' does not exist in table"));
  for (const s of ['SENTINEL', 'does not exist in table']) assert.ok(!h.allText().includes(s), `output contains ${s}`);
});

check('bank sync error is classified, not echoed, and survives', () => {
  const h = harness();
  h.handlers.onUncaughtException(new Error('Failed syncing account Jane Doe Savings: RATE_LIMIT_EXCEEDED'));
  assert.deepStrictEqual(h.exits, []);
  assert.strictEqual(h.logs.length, 1);
  assert.strictEqual(h.logs[0].meta.event, 'bank_sync.exception_benign');
  assert.strictEqual(h.logs[0].meta.error.category, 'upstream_unavailable');
  for (const s of ['Jane Doe', 'RATE_LIMIT_EXCEEDED']) assert.ok(!h.allText().includes(s), `output contains ${s}`);
});

check('before the logger is attached, a benign event is one warn JSON line', () => {
  const h = harness({ withLogger: false });
  h.handlers.onUnhandledRejection(new Error("Field 'x' does not exist in table"));
  assert.strictEqual(h.writes.length, 1);
  assert.strictEqual(h.records()[0].level, 'warn');
  assert.strictEqual(h.records()[0].event, 'process.rejection_benign');
  assert.deepStrictEqual(h.exits, []);
});

console.log('\n[process-handlers] Node-floor hint');

check('ERR_IMPORT_ASSERTION_TYPE_MISSING writes the three hint lines before the record', () => {
  const h = harness();
  h.handlers.onUnhandledRejection(Object.assign(new Error('MSG_SENTINEL'), { code: 'ERR_IMPORT_ASSERTION_TYPE_MISSING' }));
  assert.strictEqual(h.writes.length, 4);
  assert.ok(h.writes.slice(0, 3).every((w) => !w.text.startsWith('{')));
  assert.ok(h.writes.slice(0, 3).some((w) => w.text.includes('Import attributes')));
  assert.strictEqual(h.records()[0].error.code, 'ERR_IMPORT_ASSERTION_TYPE_MISSING');
  assert.ok(!h.allText().includes('MSG_SENTINEL'));
});

check('no hint for any other code', () => {
  const h = harness();
  h.handlers.onUnhandledRejection(Object.assign(new Error('x'), { code: 'ECONNRESET' }));
  assert.ok(!h.allText().includes('Import attributes'));
  assert.strictEqual(h.records()[0].error.code, 'ECONNRESET');
  assert.strictEqual(h.records()[0].error.category, 'upstream_unavailable');
});

console.log('\n[process-handlers] categorizeError table');

class AbortError extends Error {}
const table = [
  ['not-found refusal', errorRecordFields(new NotFoundRefusal('gone')).category, 'not_found'],
  ['out-of-range refusal', errorRecordFields(new OutOfRangeRefusal('far')).category, 'validation'],
  ['401', categorizeError({ httpStatus: 401 }), 'auth'],
  ['403', categorizeError({ httpStatus: 403 }), 'auth'],
  ['404', categorizeError({ httpStatus: 404 }), 'not_found'],
  ['408', categorizeError({ httpStatus: 408 }), 'timeout'],
  ['504', categorizeError({ httpStatus: 504 }), 'timeout'],
  ['ETIMEDOUT', categorizeError({ code: 'ETIMEDOUT' }), 'timeout'],
  ['409', categorizeError({ httpStatus: 409 }), 'conflict'],
  ['429', categorizeError({ httpStatus: 429 }), 'rate_limited'],
  ['400', categorizeError({ httpStatus: 400 }), 'validation'],
  ['422', categorizeError({ httpStatus: 422 }), 'validation'],
  ['500', categorizeError({ httpStatus: 500 }), 'upstream_unavailable'],
  ['599', categorizeError({ httpStatus: 599 }), 'upstream_unavailable'],
  ...['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].map((code) => [code, categorizeError({ code }), 'upstream_unavailable']),
  ['Node AbortError class', errorRecordFields(new AbortError('stop')).category, 'cancelled'],
  ['message text alone stays internal', errorRecordFields(new Error('401 Unauthorized timeout ECONNRESET')).category, 'internal'],
];
for (const [label, got, want] of table) {
  check(`category: ${label} -> ${want}`, () => assert.strictEqual(got, want));
}

check('httpStatus is read from status, statusCode or response.status', () => {
  assert.strictEqual(errorRecordFields(Object.assign(new Error('x'), { status: 429 })).httpStatus, 429);
  assert.strictEqual(errorRecordFields(Object.assign(new Error('x'), { statusCode: 503 })).httpStatus, 503);
  assert.strictEqual(errorRecordFields(Object.assign(new Error('x'), { response: { status: 401 } })).httpStatus, 401);
});

check('httpStatus gate omits a string, 99, 600 and 1.5', () => {
  for (const status of ['500', 99, 600, 1.5]) {
    const rec = errorRecordFields(Object.assign(new Error('x'), { status }));
    assert.ok(!('httpStatus' in rec), `status ${JSON.stringify(status)} was kept`);
  }
});

console.log('\n[process-handlers] static checks');

const read = (rel) => stripTsComments(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const handlersSrc = read('../../src/lib/processHandlers.ts');
const installSrc = read('../../src/lib/processHandlersInstall.ts');
const indexSrc = read('../../src/index.ts');

check('no console call in the two new modules', () => {
  assert.ok(!/\bconsole\./.test(handlersSrc), 'processHandlers.ts calls console');
  assert.ok(!/\bconsole\./.test(installSrc), 'processHandlersInstall.ts calls console');
});

check('neither new module imports the logger or the logger factory', () => {
  for (const [name, src] of [['processHandlers.ts', handlersSrc], ['processHandlersInstall.ts', installSrc]]) {
    assert.ok(!/from '\.\.?\/(lib\/)?logger(Factory)?\.js'/.test(src), `${name} imports the logger`);
    assert.ok(!/import\(\s*'[^']*logger(Factory)?\.js'/.test(src), `${name} dynamically imports the logger`);
  }
});

// The logger reads MCP_STDIO_MODE when winston is built, so nothing these modules pull in at
// load time, at any depth, may import it: walk the static relative imports transitively.
function staticImportClosure(entryRel) {
  const seen = new Set();
  const queue = [new URL(entryRel, import.meta.url)];
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const src = stripTsComments(readFileSync(url, 'utf8'));
    for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?'(\.{1,2}\/[^']+)\.js';/gm)) {
      queue.push(new URL(`${m[1]}.ts`, url));
    }
  }
  return [...seen].map((h) => h.slice(h.lastIndexOf('/src/') + 1));
}

check('no module in the static import closure of the handler install is the logger', () => {
  const closure = staticImportClosure('../../src/lib/processHandlersInstall.ts');
  assert.ok(closure.includes('src/lib/errors.ts'), `closure misses errors.ts: ${closure.join(', ')}`);
  const bad = closure.filter((f) => /\/(logger|loggerFactory)\.ts$/.test(f));
  assert.deepStrictEqual(bad, []);
});

check('src/index.ts catches a failure of the startup prelude, not only of main()', () => {
  assert.match(indexSrc, /\}\)\(\)\.catch\(\(err\) => \{\s*writeSync\(2, `Failed to start Actual MCP bridge: /);
});

check('src/index.ts imports the Node guard first and the handler install second', () => {
  const imports = [...indexSrc.matchAll(/^import [^\n]*$/gm)].map((m) => m[0]);
  assert.strictEqual(imports[0], "import './lib/node-version-guard.js';");
  assert.match(imports[1], /from '\.\/lib\/processHandlersInstall\.js';$/);
});

check('src/index.ts registers no process handler of its own', () => {
  assert.ok(!/process\.on\('(unhandledRejection|uncaughtException)'/.test(indexSrc));
  assert.match(indexSrc, /attachProcessLogger\(createModuleLogger\('PROCESS'\)\)/);
});

console.log(`\n[process-handlers] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
