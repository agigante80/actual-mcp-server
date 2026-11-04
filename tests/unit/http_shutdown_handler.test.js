// tests/unit/http_shutdown_handler.test.js
//
// #632: every branch of createShutdownHandler (src/server/shutdown.ts), driven with injected
// effects so nothing exits. The spawn-level proof that a real SIGTERM ends the process is
// http_sigterm_exit_child.test.js; this file pins the branches a real signal cannot reach
// deterministically (a second signal, the deadline, a failing cleanup).
//
// Run: node tests/unit/http_shutdown_handler.test.js   (needs `npm run build` first)

import assert from 'assert';
import { readFileSync } from 'fs';
import { createShutdownGate, createShutdownHandler } from '../../dist/src/server/shutdown.js';

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  ok: ${label}`); passed++; }
  catch (err) { console.error(`  FAIL: ${label} -> ${err.message}`); failed++; }
}

console.log('\n[http-shutdown-handler]');

/** A handler whose effects are recorded in `calls`; `deadline()` fires the armed timer. */
function harness({ cleanup = async () => {}, closeListener = () => {}, awaitInFlight = async () => {} } = {}) {
  const calls = [];
  let armed;
  let budgetElapsed;
  const handler = createShutdownHandler({
    closeListener: () => { calls.push('close'); closeListener(); },
    awaitInFlight: async () => { calls.push('await'); await awaitInFlight(); },
    cleanup: async () => { calls.push('cleanup'); await cleanup(); },
    exit: (code) => calls.push(`exit:${code}`),
    logger: {
      info: (m) => calls.push(`info:${m}`),
      warn: (m) => calls.push(`warn:${m}`),
      error: (m) => calls.push(`error:${m}`),
    },
    deadlineMs: 8000,
    armDeadline: (fn, ms) => { armed = { fn, ms }; },
    // The in-flight budget only elapses when a test calls budget().
    waitBudget: (ms) => new Promise((r) => { budgetElapsed = () => { calls.push(`budget:${ms}`); r(); }; }),
  });
  return { handler, calls, deadline: () => armed.fn(), armedMs: () => armed?.ms, budget: () => budgetElapsed() };
}

const effects = (calls) => calls.filter((c) => !c.startsWith('info:'));

await check('SIGTERM: closes the listener, waits for in-flight work, cleans up, then exits 0', async () => {
  const h = harness();
  await h.handler.shutdown('SIGTERM');
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'cleanup', 'exit:0']);
  assert.strictEqual(h.armedMs(), 8000, 'the deadline was not armed with deadlineMs');
});

await check('isShuttingDown is false before a signal and true from the moment one arrives', async () => {
  const h = harness();
  assert.strictEqual(h.handler.isShuttingDown(), false);
  let seenDuringCleanup;
  const h2 = harness({ cleanup: async () => { seenDuringCleanup = h2.handler.isShuttingDown(); } });
  await h2.handler.shutdown('SIGINT');
  assert.strictEqual(seenDuringCleanup, true, 'new requests would not be refused during cleanup');
});

await check('a second signal during shutdown exits 1 at once and does not run cleanup again', async () => {
  let release;
  const h = harness({ cleanup: () => new Promise((r) => { release = r; }) });
  const first = h.handler.shutdown('SIGTERM');
  await new Promise((r) => setImmediate(r)); // let the first shutdown reach its cleanup
  await h.handler.shutdown('SIGTERM');
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'cleanup', 'warn:[SERVER] Second SIGTERM during shutdown, exiting now', 'exit:1']);
  release();
  await first;
});

await check('a cleanup that throws exits 1, logs only the error class, and never exits 0', async () => {
  const h = harness({ cleanup: async () => { throw new TypeError('secret budget name'); } });
  await h.handler.shutdown('SIGTERM');
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'cleanup', 'error:[SERVER] Shutdown cleanup failed', 'exit:1']);
  assert.ok(!h.calls.some((c) => c.includes('secret')), 'the error message reached the log');
});

await check('a listener close that throws exits 1 without running cleanup', async () => {
  const h = harness({ closeListener: () => { throw new Error('boom'); } });
  await h.handler.shutdown('SIGTERM');
  assert.deepStrictEqual(effects(h.calls), ['close', 'error:[SERVER] Shutdown cleanup failed', 'exit:1']);
});

await check('the deadline firing during a stuck cleanup exits 1', async () => {
  const h = harness({ cleanup: () => new Promise(() => {}) });
  void h.handler.shutdown('SIGTERM');
  await new Promise((r) => setImmediate(r));
  h.deadline();
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'cleanup', 'warn:[SERVER] Shutdown exceeded 8000ms, forcing exit', 'exit:1']);
});

await check('two handlers do not share state (several servers in one test process)', async () => {
  const a = harness();
  const b = harness();
  await a.handler.shutdown('SIGTERM');
  assert.strictEqual(b.handler.isShuttingDown(), false);
  await b.handler.shutdown('SIGTERM');
  assert.deepStrictEqual(effects(b.calls), ['close', 'await', 'cleanup', 'exit:0']);
});

await check('cleanup does not start until in-flight work has finished (a queued write is not cut)', async () => {
  let release;
  const h = harness({ awaitInFlight: () => new Promise((r) => { release = r; }) });
  const done = h.handler.shutdown('SIGTERM');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(effects(h.calls), ['close', 'await'], 'cleanup or exit ran while work was still in flight');
  release();
  await done;
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'cleanup', 'exit:0']);
});

await check('in-flight work that never finishes ends at the deadline with exit 1', async () => {
  const h = harness({ awaitInFlight: () => new Promise(() => {}) });
  void h.handler.shutdown('SIGTERM');
  await new Promise((r) => setImmediate(r));
  h.deadline();
  assert.deepStrictEqual(effects(h.calls), ['close', 'await', 'warn:[SERVER] Shutdown exceeded 8000ms, forcing exit', 'exit:1']);
});

await check('in-flight work past its budget (deadline minus 2 s): cleanup still runs, then exit 1, never 0', async () => {
  const h = harness({ awaitInFlight: () => new Promise(() => {}) });
  const done = h.handler.shutdown('SIGTERM');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(effects(h.calls), ['close', 'await'], 'cleanup ran before the budget elapsed');
  h.budget();
  await done;
  assert.deepStrictEqual(effects(h.calls), [
    'close', 'await', 'budget:6000',
    'warn:[SERVER] In-flight work still running after 6000ms, cleaning up anyway',
    'cleanup', 'exit:1',
  ]);
});

await check('the default budget never drops below half of a short deadline', async () => {
  let got;
  const handler = createShutdownHandler({
    closeListener: () => {}, awaitInFlight: async () => {}, cleanup: async () => {}, exit: () => {},
    logger: { info() {}, warn() {}, error() {} }, deadlineMs: 3000, armDeadline: () => {},
    waitBudget: (ms) => { got = ms; return new Promise(() => {}); },
  });
  await handler.shutdown('SIGTERM');
  assert.strictEqual(got, 1500);
});

// --- the 503 gate (createShutdownGate) ---

/** A fake response recording what the gate did; `close()` fires the response's close event. */
function fakeRes() {
  const r = { headers: {}, code: undefined, body: undefined, closers: [] };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.once = (ev, fn) => { if (ev === 'close') r.closers.push(fn); return r; };
  r.close = () => r.closers.splice(0).forEach((fn) => fn());
  return r;
}

await check('gate: before a shutdown it calls next and counts the request until its response closes', () => {
  let down = false;
  const g = createShutdownGate({ isShuttingDown: () => down }, '/mcp');
  const res = fakeRes();
  let nexted = false;
  g.middleware({ method: 'POST', path: '/mcp' }, res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
  assert.strictEqual(res.code, undefined, 'the gate answered a request it should have passed on');
  assert.strictEqual(g.inFlight(), 1);
  res.close();
  assert.strictEqual(g.inFlight(), 0);
});

await check('gate: once shutting down, every route gets 503 with Connection: close and next is never called', () => {
  const g = createShutdownGate({ isShuttingDown: () => true }, '/mcp');
  for (const req of [{ method: 'POST', path: '/mcp' }, { method: 'GET', path: '/health' }, { method: 'OPTIONS', path: '/.well-known/oauth-protected-resource' }]) {
    const res = fakeRes();
    let nexted = false;
    g.middleware(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, false, `${req.method} ${req.path} reached the routes during shutdown`);
    assert.strictEqual(res.code, 503, `${req.method} ${req.path} got ${res.code}, not 503`);
    assert.strictEqual(res.headers.Connection, 'close');
    assert.deepStrictEqual(res.body, { error: 'Server is shutting down' });
  }
  assert.strictEqual(g.inFlight(), 0, 'a refused request was counted as in flight');
});

await check('gate: the SSE stream (GET on the MCP path) is not counted, so it cannot stall the shutdown', () => {
  const g = createShutdownGate({ isShuttingDown: () => false }, '/mcp');
  g.middleware({ method: 'GET', path: '/mcp' }, fakeRes(), () => {});
  assert.strictEqual(g.inFlight(), 0);
  g.middleware({ method: 'GET', path: '/health' }, fakeRes(), () => {});
  assert.strictEqual(g.inFlight(), 1, 'a GET off the MCP path must still be counted');
});

await check('gate: the SSE stream is exempt however Express matched it (/MCP, /mcp/), but /mcpx is counted', () => {
  const g = createShutdownGate({ isShuttingDown: () => false }, '/mcp');
  for (const path of ['/MCP', '/mcp/', '/Mcp//']) g.middleware({ method: 'GET', path }, fakeRes(), () => {});
  assert.strictEqual(g.inFlight(), 0, 'a case or trailing-slash variant of the stream was counted and would stall the shutdown');
  g.middleware({ method: 'GET', path: '/mcpx' }, fakeRes(), () => {});
  assert.strictEqual(g.inFlight(), 1);
});

await check('gate: mounted as the first middleware in httpServer.ts, before the #612 host check', () => {
  const src = readFileSync(new URL('../../src/server/httpServer.ts', import.meta.url), 'utf8');
  const uses = [...src.matchAll(/app\.use\(([^)\n]*)/g)].map((m) => m[1]);
  assert.ok(uses.length > 1, 'found no app.use calls');
  assert.strictEqual(uses[0].trim(), 'shutdownGate.middleware', `the first app.use is ${uses[0]}, not the shutdown gate`);
});

await check('awaitInFlight in httpServer.ts waits for the request count to reach 0, then for queued writes', () => {
  const src = readFileSync(new URL('../../src/server/httpServer.ts', import.meta.url), 'utf8');
  const m = /awaitInFlight:\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},/.exec(src);
  assert.ok(m, 'no awaitInFlight block found in httpServer.ts');
  const body = m[1];
  const countWait = body.search(/while\s*\(\s*shutdownGate\.inFlight\(\)\s*>\s*0\s*\)/);
  const writesWait = body.search(/await\s+awaitWritesIdle\(\)/);
  assert.ok(countWait >= 0, 'awaitInFlight does not wait for in-flight requests');
  assert.ok(writesWait >= 0, 'awaitInFlight does not await awaitWritesIdle(): a queued write would be cut');
  assert.ok(countWait < writesWait, 'awaitWritesIdle() runs before the request count drains, so a request could queue a write after it');
});

console.log(`\n[http-shutdown-handler] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
