// #622: the installed process handlers in a real child process. A fatal rejection must
// exit 1 with exactly one sys_crash record on stderr and no reason text; a bank sync
// throw must be survived. Runs under MCP_STDIO_MODE=true, where winston also writes to
// stderr, so a double log would show as a second record. Imports from dist/, so
// `npm run build` must run first.
import assert from 'assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

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

function runChild(body) {
  const script = `
    const { attachProcessLogger } = await import('./dist/src/lib/processHandlersInstall.js');
    const { createModuleLogger } = await import('./dist/src/lib/loggerFactory.js');
    attachProcessLogger(createModuleLogger('PROCESS'));
    ${body}
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, MCP_STDIO_MODE: 'true', MCP_BRIDGE_STORE_LOGS: 'false' },
    encoding: 'utf8',
    timeout: 30000,
  });
}

console.log('[process-handlers-child] installed handlers in a child process');

check('a fatal rejection exits 1 with one sys_crash record and no reason text', () => {
  const r = runChild(`
    const reason = Object.assign(new Error('MSG_SENTINEL'), {
      request: { headers: { authorization: 'Bearer SENTINEL' } },
    });
    Promise.reject(reason);
  `);
  assert.strictEqual(r.status, 1, `exit ${r.status}, stderr: ${r.stderr}`);
  const crashes = r.stderr.split('\n').filter((l) => l.includes('sys_crash'));
  assert.strictEqual(crashes.length, 1, `sys_crash lines: ${crashes.length}`);
  assert.strictEqual(JSON.parse(crashes[0]).source, 'unhandledRejection');
  assert.ok(!r.stderr.includes('SENTINEL'), 'stderr carries reason text');
  assert.ok(!r.stdout.includes('SENTINEL'), 'stdout carries reason text');
});

check('a bank sync throw is survived and the process exits 0 on its own', () => {
  const r = runChild(`
    setTimeout(() => { throw new Error('Failed syncing account Jane Doe Savings: RATE_LIMIT_EXCEEDED'); }, 0);
    setTimeout(() => process.exit(0), 200);
  `);
  assert.strictEqual(r.status, 0, `exit ${r.status}, stderr: ${r.stderr}`);
  assert.ok(r.stderr.includes('bank_sync.exception_benign'), 'no survival record');
  assert.ok(!r.stderr.includes('sys_crash'));
  for (const s of ['Jane Doe', 'RATE_LIMIT_EXCEEDED']) assert.ok(!r.stderr.includes(s), `stderr contains ${s}`);
});

check('nothing reaches stdout under stdio mode', () => {
  const r = runChild(`Promise.reject(new Error('x'));`);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.stdout, '');
});

console.log(`\n[process-handlers-child] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
