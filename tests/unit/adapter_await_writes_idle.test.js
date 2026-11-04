// tests/unit/adapter_await_writes_idle.test.js
//
// #632: awaitWritesIdle() (src/lib/actual-adapter.ts) is what the HTTP shutdown waits on before
// it closes sessions. A write still inside its WRITE_SESSION_DELAY_MS debounce window has not
// started yet, so a shutdown that only counted HTTP requests would exit 0 with that write unsent.
// These cases pin that the wait covers both a queued write and one mid-drain, and that it does
// not wait at all when the queue is idle.
//
// Each case runs in its own child process, for the reason adapter_write_queue_wakeup.test.js
// gives: the adapter's queue state is module-global and config is read once at load.
//
// Run: node tests/unit/adapter_await_writes_idle.test.js   (needs `npm run build` first)

import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADAPTER = pathToFileURL(join(ROOT, 'dist', 'src', 'lib', 'actual-adapter.js')).href;

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { console.log(`  ok: ${label}`); passed++; }
  else { console.error(`  FAIL: ${label}${detail ? ' -> ' + detail : ''}`); failed++; }
}

/** Run `body` in a child with the adapter loaded and the api stubbed; it must call emit(obj) once. */
function runInChild(body, timeoutMs = 20000) {
  const preamble = `
    const emit = (o) => process.stdout.write('@@' + JSON.stringify(o) + '@@');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const adapter = await import(${JSON.stringify(ADAPTER)});
    adapter._setSkipApiInitForTests(true);
    adapter._setApiInitializedForTests(true);
    const { withWriteSession, awaitWritesIdle } = adapter;
    const t0 = Date.now();
    const events = [];
    const mark = (e) => events.push([e, Date.now() - t0]);
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', preamble + body], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      ACTUAL_SERVER_URL: 'http://127.0.0.1:5999',
      ACTUAL_BUDGET_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      ACTUAL_PASSWORD: 'stub-password-for-unit-test',
      ACTUAL_OP_TIMEOUT_MS: '5000',
    },
  });
  const m = /@@(.*?)@@/s.exec(res.stdout || '');
  if (!m) return { __error: `child produced no result (status=${res.status}, signal=${res.signal})` };
  return JSON.parse(m[1]);
}

console.log('\n[adapter-await-writes-idle]');

{
  const r = runInChild(`
    await awaitWritesIdle();
    emit({ ms: Date.now() - t0 }); process.exit(0);
  `);
  check('idle queue: awaitWritesIdle resolves at once', typeof r.ms === 'number' && r.ms < 20, r.__error || `took ${r.ms}ms`);
}

{
  // The write is queued but its debounce timer has not fired: nothing is draining yet.
  const r = runInChild(`
    const w = withWriteSession(async () => { mark('write-ran'); return 'w'; });
    await awaitWritesIdle();
    mark('idle');
    await w;
    emit({ events }); process.exit(0);
  `);
  const order = (r.events ?? []).map((e) => e[0]);
  check(
    'a write in its debounce window: awaitWritesIdle stays pending until the write has run',
    order.join(',') === 'write-ran,idle',
    r.__error || `order was ${order.join(',') || '(none)'}`,
  );
}

{
  // A slow write that is already draining when the wait starts.
  const r = runInChild(`
    const w = withWriteSession(() => new Promise((res) => setTimeout(() => { mark('write-done'); res('w'); }, 300)));
    await sleep(150); // past the debounce: the drain is in progress
    mark('wait-start');
    await awaitWritesIdle();
    mark('idle');
    await w;
    emit({ events }); process.exit(0);
  `);
  const order = (r.events ?? []).map((e) => e[0]);
  check(
    'a write mid-drain: awaitWritesIdle resolves only after the drain finishes',
    order.join(',') === 'wait-start,write-done,idle',
    r.__error || `order was ${order.join(',') || '(none)'}`,
  );
}

console.log(`\n[adapter-await-writes-idle] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
