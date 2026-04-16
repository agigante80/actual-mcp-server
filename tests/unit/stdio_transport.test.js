// Unit test: verify that no process.stdout.write calls occur during stdio server startup.
// This is a CI-enforced safety guarantee — stdout writes in stdio mode corrupt JSON-RPC framing.

process.env.ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL ?? 'http://localhost:5006';
process.env.ACTUAL_BUDGET_SYNC_ID = process.env.ACTUAL_BUDGET_SYNC_ID ?? '00000000-0000-0000-0000-000000000000';
process.env.ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD ?? 'stub-password-for-unit-test';
// Set stdio mode so the Winston Console transport routes to stderr
process.env.MCP_STDIO_MODE = 'true';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.error(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

(async () => {
  console.error('Running stdio transport safety tests');

  // --- Test 1: Winston Console transport routes to stderr in stdio mode ---
  console.error('\n--- Test: logger routes all output to stderr when MCP_STDIO_MODE=true ---');
  {
    const stdoutWrites = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => {
      stdoutWrites.push(args[0]);
      return originalWrite(...args);
    };

    // Import logger AFTER MCP_STDIO_MODE is set
    const loggerMod = await import('../../dist/src/logger.js');
    const logger = loggerMod.default;

    // Emit log messages at various levels
    logger.error('test-error');
    logger.warn('test-warn');
    logger.info('test-info');
    logger.debug('test-debug');

    // Give Winston a tick to flush
    await new Promise(resolve => setTimeout(resolve, 50));

    // Restore
    process.stdout.write = originalWrite;

    assert(
      stdoutWrites.length === 0,
      `No process.stdout.write calls from logger (got ${stdoutWrites.length})`
    );
  }

  // --- Test 2: console.log is patched to route through Winston (not raw stdout) ---
  console.error('\n--- Test: console.log does not write raw bytes to stdout ---');
  {
    const stdoutWrites = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => {
      stdoutWrites.push(args[0]);
      return originalWrite(...args);
    };

    // console.* is patched inside logger.ts — re-import is a no-op, patch is already active
    console.log('test-console-log-in-stdio-mode');

    await new Promise(resolve => setTimeout(resolve, 50));

    process.stdout.write = originalWrite;

    assert(
      stdoutWrites.length === 0,
      `console.log does not write raw bytes to stdout (got ${stdoutWrites.length})`
    );
  }

  // --- Summary ---
  console.error(`\nStdio transport safety: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
