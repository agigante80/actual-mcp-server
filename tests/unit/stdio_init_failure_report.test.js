// #452: stdio must report the same closed initialization-failure diagnosis as HTTP.
// The handler is exercised directly so this test stays hermetic and can prove
// that ordinary tool errors are still propagated.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

process.env.ACTUAL_SERVER_URL ??= 'http://localhost:5006';
process.env.ACTUAL_PASSWORD ??= 'dummy';
process.env.ACTUAL_BUDGET_SYNC_ID ??= '00000000-0000-0000-0000-000000000000';
process.env.MCP_STDIO_MODE = 'true';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const stdioSource = readFileSync(resolve(root, 'src/server/stdioServer.ts'), 'utf8');

const { classifyInitFailure: classifyFromLibrary } = await import('../../dist/src/lib/init-failure.js');
const { classifyInitFailure: classifyFromHttp } = await import('../../dist/src/server/httpServer.js');
const { createStdioCallToolHandler } = await import('../../dist/src/server/stdioServer.js');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok: ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL: ${name}\n    ${err.message}`);
    failed += 1;
  }
}

console.log('\n[#452 stdio initialization failure reporting]');

await check('the classifier lives in a transport-neutral module and HTTP re-exports it', () => {
  const error = Object.assign(new Error('upstream schema details and credentials'), { code: 'invalid-schema' });
  assert.deepStrictEqual(classifyFromLibrary(error), classifyFromHttp(error));
  assert.strictEqual(classifyFromLibrary(error).cause, 'schema_too_new');
});

await check('stdio returns a fixed initialization sentence as an MCP tool error', async () => {
  const upstream = 'Make sure you are using the latest version of Actual at https://user:pass@example.test';
  const mcp = {
    executeTool: async () => {
      throw Object.assign(new Error(upstream), { code: 'invalid-schema' });
    },
  };
  const handler = createStdioCallToolHandler(mcp, 'stdio-test');
  const result = await handler({ params: { name: 'actual_accounts_list', arguments: {} } });
  assert.strictEqual(result.isError, true);
  assert.strictEqual(result.content.length, 1);
  assert.match(result.content[0].text, /Upgrade actual-mcp-server/);
  assert.doesNotMatch(result.content[0].text, /Make sure you are using the latest version/);
  assert.doesNotMatch(result.content[0].text, /user:pass|example\.test/);
});

await check('ordinary stdio tool errors remain failures with their original message', async () => {
  const ordinary = 'field does not exist: nope';
  const mcp = { executeTool: async () => { throw new Error(ordinary); } };
  const handler = createStdioCallToolHandler(mcp, 'stdio-test');
  await assert.rejects(
    () => handler({ params: { name: 'actual_accounts_list', arguments: {} } }),
    (error) => error instanceof Error && error.message === ordinary,
  );
});

await check('stdio does not duplicate the fixed sentence catalog', () => {
  assert.match(stdioSource, /classifyInitFailure/);
  assert.doesNotMatch(stdioSource, /Upgrade actual-mcp-server/);
  assert.doesNotMatch(stdioSource, /Authentication against the Actual server failed/);
  assert.doesNotMatch(stdioSource, /The configured budget was not found/);
});

console.log(`\n[#452] Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
